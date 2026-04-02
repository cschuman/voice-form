/**
 * @voiceform/core — State Machine
 *
 * Implements the voice-form state machine as described in:
 * docs/LOW_LEVEL_DESIGN.md § 3. State Machine
 *
 * Design decisions:
 *
 * 1. `transition()` is a pure function — it takes (state, event) and returns
 *    a new state with no side effects, no imports of browser APIs, and no
 *    mutation of its arguments. This makes it trivially testable and safe to
 *    call in any environment.
 *
 * 2. `createStateMachine()` wraps the pure reducer with a stateful subscribe /
 *    dispatch / destroy layer. Dispatch calls transition(), compares the result
 *    by reference, and notifies listeners only when the state actually changed.
 *
 * 3. Reentrancy guard: if a listener calls dispatch() while the machine is
 *    already in the middle of notifying listeners, the nested event is pushed
 *    onto a queue and processed after the current notification loop finishes.
 *    This prevents unbounded stack depth and ensures listeners always observe
 *    a stable, consistent state.
 *
 * 4. Invalid transitions: transition() returns the current state object
 *    unchanged (same reference). In non-production environments a console.warn
 *    is emitted. The dispatch() layer uses reference equality to detect no-ops
 *    and skips listener notification.
 *
 * Zero external dependencies — only imports from ./types.ts.
 */

import type {
  VoiceFormState,
  VoiceFormEvent,
  StateMachine,
} from './types.js'

// ─── Pure Transition Function ─────────────────────────────────────────────────

/**
 * Pure reducer for the voice-form state machine.
 *
 * Given the current state and an event, returns the next state. If the event
 * is not valid for the current state, returns the exact same state object
 * (same reference) so callers can use reference equality to detect no-ops.
 *
 * This function has no side effects and imports no browser APIs. It is safe
 * to call in any environment (Node.js, browser, Deno, test runners).
 *
 * @param state - The current VoiceFormState.
 * @param event - The VoiceFormEvent to apply.
 * @returns The next VoiceFormState (new object on valid transition, same
 *   reference on invalid transition).
 */
export function transition(
  state: VoiceFormState,
  event: VoiceFormEvent,
): VoiceFormState {
  switch (state.status) {
    case 'idle':
      return transitionFromIdle(state, event)

    case 'recording':
      return transitionFromRecording(state, event)

    case 'processing':
      return transitionFromProcessing(state, event)

    case 'confirming':
      return transitionFromConfirming(state, event)

    case 'injecting':
      return transitionFromInjecting(state, event)

    case 'done':
      return transitionFromDone(state, event)

    case 'error':
      return transitionFromError(state, event)
  }
}

// ─── Per-state transition handlers ───────────────────────────────────────────
// Each handler receives the narrowed state and the event, and returns either
// a new state object or the same state reference (invalid transition).

function transitionFromIdle(
  state: Extract<VoiceFormState, { status: 'idle' }>,
  event: VoiceFormEvent,
): VoiceFormState {
  if (event.type === 'START') {
    return { status: 'recording', interimTranscript: '' }
  }
  return warnInvalid(state, event)
}

function transitionFromRecording(
  state: Extract<VoiceFormState, { status: 'recording' }>,
  event: VoiceFormEvent,
): VoiceFormState {
  switch (event.type) {
    case 'STT_INTERIM':
      return { status: 'recording', interimTranscript: event.transcript }

    case 'STT_FINAL':
      // An empty or whitespace-only transcript means nothing was heard.
      if (event.transcript.trim() === '') {
        return { status: 'idle' }
      }
      return { status: 'processing', transcript: event.transcript }

    case 'STT_ERROR':
      return {
        status: 'error',
        error: {
          code: mapSttErrorCode(event.error.code),
          message: event.error.message,
          recoverable: true,
        },
        previousStatus: 'recording',
      }

    case 'CANCEL':
      return { status: 'idle' }

    default:
      return warnInvalid(state, event)
  }
}

function transitionFromProcessing(
  state: Extract<VoiceFormState, { status: 'processing' }>,
  event: VoiceFormEvent,
): VoiceFormState {
  switch (event.type) {
    case 'PARSE_SUCCESS':
      return {
        status: 'confirming',
        transcript: state.transcript,
        confirmation: event.confirmation,
      }

    case 'PARSE_ERROR':
      return {
        status: 'error',
        error: event.error,
        previousStatus: 'processing',
      }

    case 'CANCEL':
      return { status: 'idle' }

    default:
      return warnInvalid(state, event)
  }
}

function transitionFromConfirming(
  state: Extract<VoiceFormState, { status: 'confirming' }>,
  event: VoiceFormEvent,
): VoiceFormState {
  switch (event.type) {
    case 'CONFIRM':
      return { status: 'injecting', confirmation: state.confirmation }

    case 'CANCEL':
      return { status: 'idle' }

    case 'FIELD_CORRECTED':
      // Immutable update: produce a new state object with the new ConfirmationData.
      // CRITICAL (security review #1): NEVER mutate state.confirmation in place.
      // The event carries the fully-formed new ConfirmationData produced by
      // correctField() in the VoiceFormInstance layer.
      return {
        status: 'confirming',
        transcript: state.transcript,
        confirmation: event.confirmation, // new object, not mutated
      }

    default:
      return warnInvalid(state, event)
  }
}

function transitionFromInjecting(
  state: Extract<VoiceFormState, { status: 'injecting' }>,
  event: VoiceFormEvent,
): VoiceFormState {
  if (event.type === 'INJECTION_COMPLETE') {
    return { status: 'done', result: event.result }
  }
  return warnInvalid(state, event)
}

function transitionFromDone(
  state: Extract<VoiceFormState, { status: 'done' }>,
  event: VoiceFormEvent,
): VoiceFormState {
  if (event.type === 'AUTO_RESET') {
    return { status: 'idle' }
  }
  return warnInvalid(state, event)
}

function transitionFromError(
  state: Extract<VoiceFormState, { status: 'error' }>,
  event: VoiceFormEvent,
): VoiceFormState {
  if (event.type === 'ACKNOWLEDGE_ERROR' || event.type === 'AUTO_RESET') {
    return { status: 'idle' }
  }
  return warnInvalid(state, event)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps an STTErrorCode to the closest VoiceFormErrorCode.
 * Used when building the error state after an STT_ERROR event.
 */
function mapSttErrorCode(
  code: import('./types.js').STTErrorCode,
): import('./types.js').VoiceFormErrorCode {
  switch (code) {
    case 'NOT_SUPPORTED':
      return 'STT_NOT_SUPPORTED'
    case 'PERMISSION_DENIED':
      return 'PERMISSION_DENIED'
    case 'NO_SPEECH':
      return 'NO_TRANSCRIPT'
    case 'NETWORK_ERROR':
    case 'AUDIO_CAPTURE_FAILED':
    case 'ABORTED':
    case 'UNKNOWN':
    default:
      return 'UNKNOWN'
  }
}

/**
 * Logs a warning in non-production environments and returns the current state
 * reference unchanged. Using the same reference lets the dispatch layer detect
 * a no-op via reference equality without deep comparison.
 */
function warnInvalid(state: VoiceFormState, event: VoiceFormEvent): VoiceFormState {
  if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
    console.warn(
      `[voice-form] Invalid transition: ${state.status} + ${event.type} — event ignored.`,
    )
  }
  return state
}

// ─── State Machine Factory ────────────────────────────────────────────────────

/**
 * Creates a stateful state machine instance that wraps the pure `transition`
 * reducer with subscribe/dispatch/destroy semantics.
 *
 * @param initialState - Optional starting state. Defaults to `{ status: 'idle' }`.
 * @returns A `StateMachine` instance.
 *
 * @example
 * const machine = createStateMachine()
 * const unsub = machine.subscribe((state, event) => {
 *   console.log(state.status, event.type)
 * })
 * machine.dispatch({ type: 'START' })
 * unsub()
 * machine.destroy()
 */
export function createStateMachine(
  initialState: VoiceFormState = { status: 'idle' },
): StateMachine {
  let currentState: VoiceFormState = initialState

  /**
   * Using an Array instead of a Set so that subscribing the same function
   * twice results in it being called twice per dispatch — consistent with
   * the addEventListener model and required by the test suite.
   */
  let listeners: Array<(state: VoiceFormState, event: VoiceFormEvent) => void> = []

  /**
   * Reentrancy guard.
   * When a listener calls dispatch() while we are already iterating
   * through listeners, the nested event is pushed here and processed
   * once the outer loop completes.
   */
  let isDispatching = false
  const eventQueue: VoiceFormEvent[] = []

  /** Whether destroy() has been called. */
  let destroyed = false

  function processEvent(event: VoiceFormEvent): void {
    const nextState = transition(currentState, event)

    // Reference equality — warnInvalid() returns the same object for no-ops.
    if (nextState === currentState) {
      return
    }

    currentState = nextState

    // Snapshot the listener array before iterating so that subscribe/unsubscribe
    // calls made from within a listener don't affect the current notification round.
    const snapshot = listeners.slice()
    for (const listener of snapshot) {
      listener(currentState, event)
    }
  }

  return {
    getState(): VoiceFormState {
      return currentState
    },

    dispatch(event: VoiceFormEvent): void {
      if (destroyed) return

      if (isDispatching) {
        // Nested dispatch — queue and process after the current loop finishes.
        eventQueue.push(event)
        return
      }

      isDispatching = true
      try {
        processEvent(event)

        // Drain the queue. New items may be added during this loop (further
        // nested dispatches), so we check length on each iteration.
        while (eventQueue.length > 0) {
          // Non-null assertion is safe: we checked length above.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const queued = eventQueue.shift()!
          processEvent(queued)
        }
      } finally {
        isDispatching = false
      }
    },

    subscribe(
      listener: (state: VoiceFormState, event: VoiceFormEvent) => void,
    ): () => void {
      listeners.push(listener)

      return () => {
        const index = listeners.indexOf(listener)
        if (index !== -1) {
          listeners.splice(index, 1)
        }
      }
    },

    destroy(): void {
      destroyed = true
      listeners = []
      eventQueue.length = 0
    },
  }
}
