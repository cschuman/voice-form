/**
 * Unit tests for packages/core/src/state-machine.ts
 *
 * TDD red phase: these tests are written before the implementation exists.
 * They define the exact contract the state machine must fulfill.
 *
 * Coverage targets:
 *  - Every valid transition in the transition table (LLD § 3.2)
 *  - Representative invalid transitions — returns current state unchanged
 *  - subscribe / unsubscribe lifecycle
 *  - Multiple concurrent subscribers all receive notifications
 *  - destroy() clears all listeners (memory-leak prevention)
 *  - Reentrancy guard: a dispatch() inside a listener callback is queued
 *    and processed after the current transition resolves, not inline
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStateMachine, transition } from '../src/state-machine.js'
import type {
  VoiceFormState,
  VoiceFormEvent,
  STTError,
  VoiceFormError,
  InjectionResult,
  ConfirmationData,
  ParseResponse,
} from '../src/types.js'

// ─── Test Fixtures ────────────────────────────────────────────────────────────

/** Build a minimal STTError test fixture. */
function makeSttError(code: STTError['code'] = 'NETWORK_ERROR'): STTError {
  const err = new Error('STT failed') as STTError
  ;(err as { code: STTError['code'] }).code = code
  return err
}

/** Build a minimal VoiceFormError test fixture. */
function makeVoiceFormError(
  code: VoiceFormError['code'] = 'ENDPOINT_ERROR',
): VoiceFormError {
  return { code, message: 'Test error', recoverable: true }
}

/** Build a minimal ConfirmationData fixture. */
function makeConfirmationData(transcript = 'hello world'): ConfirmationData {
  return {
    transcript,
    parsedFields: { name: { label: 'Name', value: 'Alice' } },
    missingFields: [],
    invalidFields: [],
    appendMode: false,
  }
}

/** Build a minimal ParseResponse fixture. */
function makeParseResponse(): ParseResponse {
  return {
    fields: { name: { value: 'Alice' } },
  }
}

/** Build a minimal InjectionResult fixture. */
function makeInjectionResult(success = true): InjectionResult {
  return {
    success,
    fields: { name: { status: 'injected', value: 'Alice' } },
  }
}

// ─── Pure transition() function ───────────────────────────────────────────────

describe('transition() — pure reducer', () => {
  // ── idle transitions ────────────────────────────────────────────────────────

  describe('from idle', () => {
    const idle: VoiceFormState = { status: 'idle' }

    it('START → recording', () => {
      const next = transition(idle, { type: 'START' })
      expect(next.status).toBe('recording')
      if (next.status === 'recording') {
        expect(next.interimTranscript).toBe('')
      }
    })

    it('ignores STT_FINAL in idle state', () => {
      const next = transition(idle, { type: 'STT_FINAL', transcript: 'hello' })
      expect(next).toStrictEqual(idle)
    })

    it('ignores CONFIRM in idle state', () => {
      const next = transition(idle, { type: 'CONFIRM' })
      expect(next).toStrictEqual(idle)
    })

    it('ignores CANCEL in idle state', () => {
      const next = transition(idle, { type: 'CANCEL' })
      expect(next).toStrictEqual(idle)
    })

    it('ignores AUTO_RESET in idle state', () => {
      const next = transition(idle, { type: 'AUTO_RESET' })
      expect(next).toStrictEqual(idle)
    })
  })

  // ── recording transitions ───────────────────────────────────────────────────

  describe('from recording', () => {
    const recording: VoiceFormState = {
      status: 'recording',
      interimTranscript: '',
    }

    it('STT_FINAL (non-empty transcript) → processing', () => {
      const next = transition(recording, {
        type: 'STT_FINAL',
        transcript: 'hello world',
      })
      expect(next.status).toBe('processing')
      if (next.status === 'processing') {
        expect(next.transcript).toBe('hello world')
      }
    })

    it('STT_FINAL (empty transcript) → idle', () => {
      const next = transition(recording, { type: 'STT_FINAL', transcript: '' })
      expect(next.status).toBe('idle')
    })

    it('STT_FINAL (whitespace-only transcript) → idle', () => {
      const next = transition(recording, {
        type: 'STT_FINAL',
        transcript: '   ',
      })
      expect(next.status).toBe('idle')
    })

    it('STT_ERROR → error, carries previousStatus recording', () => {
      const next = transition(recording, {
        type: 'STT_ERROR',
        error: makeSttError('PERMISSION_DENIED'),
      })
      expect(next.status).toBe('error')
      if (next.status === 'error') {
        expect(next.previousStatus).toBe('recording')
      }
    })

    it('STT_INTERIM → recording (updates interimTranscript)', () => {
      const next = transition(recording, {
        type: 'STT_INTERIM',
        transcript: 'hel',
      })
      expect(next.status).toBe('recording')
      if (next.status === 'recording') {
        expect(next.interimTranscript).toBe('hel')
      }
    })

    it('CANCEL → idle', () => {
      const next = transition(recording, { type: 'CANCEL' })
      expect(next.status).toBe('idle')
    })

    it('ignores CONFIRM in recording state', () => {
      const next = transition(recording, { type: 'CONFIRM' })
      expect(next).toStrictEqual(recording)
    })

    it('ignores INJECTION_COMPLETE in recording state', () => {
      const next = transition(recording, {
        type: 'INJECTION_COMPLETE',
        result: makeInjectionResult(),
      })
      expect(next).toStrictEqual(recording)
    })
  })

  // ── processing transitions ──────────────────────────────────────────────────

  describe('from processing', () => {
    const processing: VoiceFormState = {
      status: 'processing',
      transcript: 'hello world',
    }

    it('PARSE_SUCCESS → confirming, carries transcript and confirmation', () => {
      const confirmation = makeConfirmationData('hello world')
      const next = transition(processing, {
        type: 'PARSE_SUCCESS',
        response: makeParseResponse(),
        confirmation,
      })
      expect(next.status).toBe('confirming')
      if (next.status === 'confirming') {
        expect(next.transcript).toBe('hello world')
        expect(next.confirmation).toStrictEqual(confirmation)
      }
    })

    it('PARSE_ERROR → error, carries previousStatus processing', () => {
      const next = transition(processing, {
        type: 'PARSE_ERROR',
        error: makeVoiceFormError('ENDPOINT_ERROR'),
      })
      expect(next.status).toBe('error')
      if (next.status === 'error') {
        expect(next.previousStatus).toBe('processing')
      }
    })

    it('CANCEL → idle', () => {
      const next = transition(processing, { type: 'CANCEL' })
      expect(next.status).toBe('idle')
    })

    it('ignores START in processing state', () => {
      const next = transition(processing, { type: 'START' })
      expect(next).toStrictEqual(processing)
    })

    it('ignores CONFIRM in processing state', () => {
      const next = transition(processing, { type: 'CONFIRM' })
      expect(next).toStrictEqual(processing)
    })
  })

  // ── confirming transitions ──────────────────────────────────────────────────

  describe('from confirming', () => {
    const confirmation = makeConfirmationData()
    const confirming: VoiceFormState = {
      status: 'confirming',
      transcript: 'hello world',
      confirmation,
    }

    it('CONFIRM → injecting, carries confirmation', () => {
      const next = transition(confirming, { type: 'CONFIRM' })
      expect(next.status).toBe('injecting')
      if (next.status === 'injecting') {
        expect(next.confirmation).toStrictEqual(confirmation)
      }
    })

    it('CANCEL → idle', () => {
      const next = transition(confirming, { type: 'CANCEL' })
      expect(next.status).toBe('idle')
    })

    it('ignores START in confirming state', () => {
      const next = transition(confirming, { type: 'START' })
      expect(next).toStrictEqual(confirming)
    })

    it('ignores INJECTION_COMPLETE in confirming state', () => {
      const next = transition(confirming, {
        type: 'INJECTION_COMPLETE',
        result: makeInjectionResult(),
      })
      expect(next).toStrictEqual(confirming)
    })

    // ── P6-02: FIELD_CORRECTED ──────────────────────────────────────────────────

    it('P6-02: FIELD_CORRECTED → confirming with new confirmation payload', () => {
      const correctedConfirmation: ConfirmationData = {
        transcript: 'hello world',
        parsedFields: {
          name: {
            label: 'Name',
            value: 'Alice Smith',
            userCorrected: true,
            originalValue: 'Alice',
          },
        },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      }
      const next = transition(confirming, {
        type: 'FIELD_CORRECTED',
        confirmation: correctedConfirmation,
      })
      expect(next.status).toBe('confirming')
      if (next.status === 'confirming') {
        expect(next.confirmation).toStrictEqual(correctedConfirmation)
        expect(next.transcript).toBe('hello world')
      }
    })

    it('P6-02: FIELD_CORRECTED returns a new state object reference (immutable update)', () => {
      const correctedConfirmation: ConfirmationData = {
        transcript: 'hello world',
        parsedFields: {
          name: { label: 'Name', value: 'Alice Corrected', userCorrected: true, originalValue: 'Alice' },
        },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      }
      const nextState = transition(confirming, {
        type: 'FIELD_CORRECTED',
        confirmation: correctedConfirmation,
      })
      // Must be a new reference — not the same object
      expect(nextState).not.toBe(confirming)
    })

    it('P6-02: FIELD_CORRECTED sets confirmation to the event payload, not the old confirmation', () => {
      const newConfirmation: ConfirmationData = {
        transcript: 'hello world',
        parsedFields: {
          name: { label: 'Name', value: 'Bob', userCorrected: true, originalValue: 'Alice' },
        },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      }
      const nextState = transition(confirming, {
        type: 'FIELD_CORRECTED',
        confirmation: newConfirmation,
      })
      if (nextState.status === 'confirming') {
        // Confirmation is the new one, not the original
        expect(nextState.confirmation).toBe(newConfirmation)
        expect(nextState.confirmation).not.toBe(confirmation)
      }
    })

    it('P6-02: FIELD_CORRECTED preserves transcript from existing state', () => {
      const confirming2: VoiceFormState = {
        status: 'confirming',
        transcript: 'specific transcript text',
        confirmation: makeConfirmationData(),
      }
      const next = transition(confirming2, {
        type: 'FIELD_CORRECTED',
        confirmation: {
          transcript: 'specific transcript text',
          parsedFields: {},
          missingFields: [],
          invalidFields: [],
          appendMode: false,
        },
      })
      if (next.status === 'confirming') {
        expect(next.transcript).toBe('specific transcript text')
      }
    })
  })

  // ── injecting transitions ───────────────────────────────────────────────────

  describe('from injecting', () => {
    const injecting: VoiceFormState = {
      status: 'injecting',
      confirmation: makeConfirmationData(),
    }

    it('INJECTION_COMPLETE → done, carries result', () => {
      const result = makeInjectionResult()
      const next = transition(injecting, {
        type: 'INJECTION_COMPLETE',
        result,
      })
      expect(next.status).toBe('done')
      if (next.status === 'done') {
        expect(next.result).toStrictEqual(result)
      }
    })

    it('ignores CONFIRM in injecting state', () => {
      const next = transition(injecting, { type: 'CONFIRM' })
      expect(next).toStrictEqual(injecting)
    })

    it('ignores CANCEL in injecting state', () => {
      const next = transition(injecting, { type: 'CANCEL' })
      expect(next).toStrictEqual(injecting)
    })
  })

  // ── done transitions ────────────────────────────────────────────────────────

  describe('from done', () => {
    const done: VoiceFormState = {
      status: 'done',
      result: makeInjectionResult(),
    }

    it('AUTO_RESET → idle', () => {
      const next = transition(done, { type: 'AUTO_RESET' })
      expect(next.status).toBe('idle')
    })

    it('ignores CONFIRM in done state', () => {
      const next = transition(done, { type: 'CONFIRM' })
      expect(next).toStrictEqual(done)
    })

    it('ignores START in done state', () => {
      const next = transition(done, { type: 'START' })
      expect(next).toStrictEqual(done)
    })
  })

  // ── error transitions ───────────────────────────────────────────────────────

  describe('from error', () => {
    const error: VoiceFormState = {
      status: 'error',
      error: makeVoiceFormError(),
      previousStatus: 'processing',
    }

    it('ACKNOWLEDGE_ERROR → idle', () => {
      const next = transition(error, { type: 'ACKNOWLEDGE_ERROR' })
      expect(next.status).toBe('idle')
    })

    it('AUTO_RESET → idle', () => {
      const next = transition(error, { type: 'AUTO_RESET' })
      expect(next.status).toBe('idle')
    })

    it('ignores START in error state', () => {
      const next = transition(error, { type: 'START' })
      expect(next).toStrictEqual(error)
    })

    it('ignores CANCEL in error state', () => {
      const next = transition(error, { type: 'CANCEL' })
      expect(next).toStrictEqual(error)
    })

    it('ignores CONFIRM in error state', () => {
      const next = transition(error, { type: 'CONFIRM' })
      expect(next).toStrictEqual(error)
    })
  })

  // ── explicitly invalid transitions ─────────────────────────────────────────

  describe('invalid transitions — state unchanged', () => {
    it('idle → confirming (no direct path)', () => {
      const idle: VoiceFormState = { status: 'idle' }
      // There is no CONFIRM event handler for idle; verifying CONFIRM returns idle
      const next = transition(idle, { type: 'CONFIRM' })
      expect(next).toStrictEqual(idle)
    })

    // ── P6-02: FIELD_CORRECTED ignored outside confirming ──────────────────────

    it('P6-02: FIELD_CORRECTED from idle → ignored (same state reference returned)', () => {
      const idle: VoiceFormState = { status: 'idle' }
      const correctedConfirmation: ConfirmationData = {
        transcript: 'test',
        parsedFields: { name: { label: 'Name', value: 'Alice' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      }
      const next = transition(idle, { type: 'FIELD_CORRECTED', confirmation: correctedConfirmation })
      // Same reference means the event was ignored
      expect(next).toBe(idle)
    })

    it('P6-02: FIELD_CORRECTED from recording → ignored (same state reference returned)', () => {
      const recording: VoiceFormState = { status: 'recording', interimTranscript: '' }
      const correctedConfirmation: ConfirmationData = {
        transcript: 'test',
        parsedFields: {},
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      }
      const next = transition(recording, { type: 'FIELD_CORRECTED', confirmation: correctedConfirmation })
      expect(next).toBe(recording)
    })

    it('P6-02: FIELD_CORRECTED from injecting → ignored (same state reference returned)', () => {
      const injecting: VoiceFormState = {
        status: 'injecting',
        confirmation: makeConfirmationData(),
      }
      const correctedConfirmation: ConfirmationData = {
        transcript: 'test',
        parsedFields: {},
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      }
      const next = transition(injecting, { type: 'FIELD_CORRECTED', confirmation: correctedConfirmation })
      expect(next).toBe(injecting)
    })

    it('idle → done (no direct path)', () => {
      const idle: VoiceFormState = { status: 'idle' }
      const next = transition(idle, {
        type: 'INJECTION_COMPLETE',
        result: makeInjectionResult(),
      })
      expect(next).toStrictEqual(idle)
    })

    it('recording → done (no direct path)', () => {
      const recording: VoiceFormState = {
        status: 'recording',
        interimTranscript: '',
      }
      const next = transition(recording, {
        type: 'INJECTION_COMPLETE',
        result: makeInjectionResult(),
      })
      expect(next).toStrictEqual(recording)
    })

    it('done → recording (no direct path)', () => {
      const done: VoiceFormState = {
        status: 'done',
        result: makeInjectionResult(),
      }
      const next = transition(done, { type: 'STT_FINAL', transcript: 'hello' })
      expect(next).toStrictEqual(done)
    })

    it('processing → injecting (no direct path)', () => {
      const processing: VoiceFormState = {
        status: 'processing',
        transcript: 'hi',
      }
      const next = transition(processing, {
        type: 'INJECTION_COMPLETE',
        result: makeInjectionResult(),
      })
      expect(next).toStrictEqual(processing)
    })
  })
})

// ─── createStateMachine() ─────────────────────────────────────────────────────

describe('createStateMachine()', () => {
  // ── initial state ───────────────────────────────────────────────────────────

  it('defaults to idle when no initial state is provided', () => {
    const machine = createStateMachine()
    expect(machine.getState()).toStrictEqual({ status: 'idle' })
  })

  it('accepts an explicit initial state', () => {
    const initial: VoiceFormState = {
      status: 'recording',
      interimTranscript: '',
    }
    const machine = createStateMachine(initial)
    expect(machine.getState()).toStrictEqual(initial)
  })

  // ── dispatch ────────────────────────────────────────────────────────────────

  it('dispatch() advances state through a valid transition', () => {
    const machine = createStateMachine()
    machine.dispatch({ type: 'START' })
    expect(machine.getState().status).toBe('recording')
  })

  it('dispatch() is a no-op on invalid transition (state unchanged)', () => {
    const machine = createStateMachine()
    machine.dispatch({ type: 'CONFIRM' }) // invalid from idle
    expect(machine.getState()).toStrictEqual({ status: 'idle' })
  })

  // ── subscribe ───────────────────────────────────────────────────────────────

  it('subscribe() listener is called with (newState, event) on valid transition', () => {
    const machine = createStateMachine()
    const listener = vi.fn()
    machine.subscribe(listener)

    machine.dispatch({ type: 'START' })

    expect(listener).toHaveBeenCalledOnce()
    const [newState, event] = listener.mock.calls[0] as [
      VoiceFormState,
      VoiceFormEvent,
    ]
    expect(newState.status).toBe('recording')
    expect(event).toStrictEqual({ type: 'START' })
  })

  it('subscribe() listener is NOT called on invalid transition', () => {
    const machine = createStateMachine()
    const listener = vi.fn()
    machine.subscribe(listener)

    machine.dispatch({ type: 'CONFIRM' }) // invalid from idle

    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribe function removes the listener', () => {
    const machine = createStateMachine()
    const listener = vi.fn()
    const unsubscribe = machine.subscribe(listener)

    unsubscribe()
    machine.dispatch({ type: 'START' })

    expect(listener).not.toHaveBeenCalled()
  })

  it('multiple subscribers all receive the transition notification', () => {
    const machine = createStateMachine()
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    const listenerC = vi.fn()

    machine.subscribe(listenerA)
    machine.subscribe(listenerB)
    machine.subscribe(listenerC)

    machine.dispatch({ type: 'START' })

    expect(listenerA).toHaveBeenCalledOnce()
    expect(listenerB).toHaveBeenCalledOnce()
    expect(listenerC).toHaveBeenCalledOnce()
  })

  it('unsubscribing one listener does not affect others', () => {
    const machine = createStateMachine()
    const listenerA = vi.fn()
    const listenerB = vi.fn()

    const unsubA = machine.subscribe(listenerA)
    machine.subscribe(listenerB)

    unsubA()
    machine.dispatch({ type: 'START' })

    expect(listenerA).not.toHaveBeenCalled()
    expect(listenerB).toHaveBeenCalledOnce()
  })

  it('subscribing the same function twice results in two calls', () => {
    const machine = createStateMachine()
    const listener = vi.fn()

    machine.subscribe(listener)
    machine.subscribe(listener)

    machine.dispatch({ type: 'START' })

    expect(listener).toHaveBeenCalledTimes(2)
  })

  // ── destroy ──────────────────────────────────────────────────────────────────

  it('destroy() clears all listeners — dispatch after destroy does not call them', () => {
    const machine = createStateMachine()
    const listener = vi.fn()
    machine.subscribe(listener)

    machine.destroy()
    machine.dispatch({ type: 'START' })

    expect(listener).not.toHaveBeenCalled()
  })

  it('destroy() can be called multiple times without throwing', () => {
    const machine = createStateMachine()
    expect(() => {
      machine.destroy()
      machine.destroy()
    }).not.toThrow()
  })

  it('getState() still works after destroy()', () => {
    const machine = createStateMachine()
    machine.destroy()
    expect(() => machine.getState()).not.toThrow()
  })

  // ── reentrancy guard ─────────────────────────────────────────────────────────

  it('dispatch inside a listener does not corrupt state (reentrancy guard)', () => {
    /**
     * Scenario: a listener calls dispatch() while the machine is already
     * notifying listeners from a prior transition.
     *
     * Expected behaviour: the inner dispatch is queued and processed after
     * all current listeners have been notified. State is consistent at every
     * observation point.
     */
    const machine = createStateMachine()
    const statesObserved: string[] = []

    machine.subscribe((state, event) => {
      statesObserved.push(state.status)

      // When we first enter recording, trigger STT_FINAL to advance to processing.
      // This inner dispatch must be deferred — not processed inline mid-notification.
      if (state.status === 'recording' && event.type === 'START') {
        machine.dispatch({ type: 'STT_FINAL', transcript: 'hello' })
      }
    })

    machine.dispatch({ type: 'START' })

    // After the outer START dispatch resolves, the queued STT_FINAL should have
    // run, landing us in processing.
    expect(machine.getState().status).toBe('processing')

    // The listener should have been called for both transitions in order:
    // first for recording (from START), then for processing (from STT_FINAL).
    expect(statesObserved).toEqual(['recording', 'processing'])
  })

  it('reentrancy: nested dispatch event is received by listener with correct state', () => {
    /**
     * Verifies that the queued dispatch actually notifies the subscriber with
     * the correct new state, not a stale snapshot.
     */
    const machine = createStateMachine()
    const events: string[] = []

    machine.subscribe((_state, event) => {
      events.push(event.type)
      if (event.type === 'START') {
        // Queue a cancel during the START notification
        machine.dispatch({ type: 'STT_FINAL', transcript: '' })
      }
    })

    machine.dispatch({ type: 'START' })

    // STT_FINAL(empty) from recording → idle is valid and should have fired
    expect(events).toContain('STT_FINAL')
    expect(machine.getState().status).toBe('idle')
  })

  // ── full happy-path walk-through ─────────────────────────────────────────────

  it('walks the full happy path: idle → recording → processing → confirming → injecting → done → idle', () => {
    const machine = createStateMachine()
    const statuses: string[] = []
    machine.subscribe((s) => statuses.push(s.status))

    const confirmation = makeConfirmationData()

    machine.dispatch({ type: 'START' })
    machine.dispatch({ type: 'STT_FINAL', transcript: 'Alice Smith' })
    machine.dispatch({
      type: 'PARSE_SUCCESS',
      response: makeParseResponse(),
      confirmation,
    })
    machine.dispatch({ type: 'CONFIRM' })
    machine.dispatch({
      type: 'INJECTION_COMPLETE',
      result: makeInjectionResult(),
    })
    machine.dispatch({ type: 'AUTO_RESET' })

    expect(statuses).toEqual([
      'recording',
      'processing',
      'confirming',
      'injecting',
      'done',
      'idle',
    ])
  })

  // ── error recovery path ──────────────────────────────────────────────────────

  it('error recovery path: idle → recording → error → idle (ACKNOWLEDGE_ERROR)', () => {
    const machine = createStateMachine()
    const statuses: string[] = []
    machine.subscribe((s) => statuses.push(s.status))

    machine.dispatch({ type: 'START' })
    machine.dispatch({ type: 'STT_ERROR', error: makeSttError('PERMISSION_DENIED') })
    machine.dispatch({ type: 'ACKNOWLEDGE_ERROR' })

    expect(statuses).toEqual(['recording', 'error', 'idle'])
    expect(machine.getState().status).toBe('idle')
  })

  it('error recovery path via AUTO_RESET instead of ACKNOWLEDGE_ERROR', () => {
    const machine = createStateMachine()

    machine.dispatch({ type: 'START' })
    machine.dispatch({ type: 'STT_ERROR', error: makeSttError('NO_SPEECH') })

    expect(machine.getState().status).toBe('error')

    machine.dispatch({ type: 'AUTO_RESET' })

    expect(machine.getState().status).toBe('idle')
  })

  // ── cancel from various states ───────────────────────────────────────────────

  it('CANCEL from recording → idle', () => {
    const machine = createStateMachine()
    machine.dispatch({ type: 'START' })
    expect(machine.getState().status).toBe('recording')

    machine.dispatch({ type: 'CANCEL' })
    expect(machine.getState().status).toBe('idle')
  })

  it('CANCEL from processing → idle', () => {
    const machine = createStateMachine({
      status: 'processing',
      transcript: 'test',
    })
    machine.dispatch({ type: 'CANCEL' })
    expect(machine.getState().status).toBe('idle')
  })

  it('CANCEL from confirming → idle', () => {
    const machine = createStateMachine({
      status: 'confirming',
      transcript: 'test',
      confirmation: makeConfirmationData(),
    })
    machine.dispatch({ type: 'CANCEL' })
    expect(machine.getState().status).toBe('idle')
  })
})
