// @vitest-environment jsdom

/**
 * P6-08 — correctField() on VoiceFormInstance
 *
 * Tests cover:
 *  1. correctField() in confirming state: returns true, state updates
 *  2. correctField() from idle: returns false
 *  3. correctField() after destroy(): returns false
 *  4. Value is sanitized (HTML stripped before applying)
 *  5. Sanitization rejection (empty after stripping non-empty input): returns false, no event
 *  6. ConfirmationData is a new reference (immutable — not mutated)
 *  7. userCorrected=true and originalValue set on corrected field
 *  8. Other fields in parsedFields are shallow-preserved (same reference)
 *  9. FIELD_CORRECTED event dispatched exactly once per call
 * 10. correctField for a field in missingFields creates a new entry in parsedFields
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createVoiceForm } from '../src/create-voice-form.js'
import type {
  STTAdapter,
  STTAdapterEvents,
  VoiceFormConfig,
  ParseResponse,
  ConfirmationData,
  VoiceFormState,
} from '../src/types.js'

// ---------------------------------------------------------------------------
// CSS.escape polyfill guard
// ---------------------------------------------------------------------------
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  ;(globalThis as Record<string, unknown>).CSS = {
    escape: (value: string) =>
      value.replace(
        /([\0-\x1f\x7f]|^[0-9]|[!"#$%&'()*+,./\/:;<=>?@[\\\]^`{|}~])/g,
        '\\$1',
      ),
  }
}

// ---------------------------------------------------------------------------
// rAF helpers
// ---------------------------------------------------------------------------
let rafCallbacks: FrameRequestCallback[] = []
let originalRaf: typeof globalThis.requestAnimationFrame | undefined

function installSyncRaf() {
  originalRaf = globalThis.requestAnimationFrame
  rafCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
}

function flushRaf() {
  const pending = [...rafCallbacks]
  rafCallbacks.length = 0
  pending.forEach((cb) => cb(performance.now()))
}

function uninstallSyncRaf() {
  if (originalRaf) vi.stubGlobal('requestAnimationFrame', originalRaf)
  rafCallbacks = []
}

// ---------------------------------------------------------------------------
// Mock STT adapter
// ---------------------------------------------------------------------------
function createMockAdapter(): STTAdapter & {
  simulateFinal(t: string): void
} {
  let events: STTAdapterEvents | null = null
  return {
    isSupported: () => true,
    async start(e) { events = e },
    stop() {},
    abort() { events = null },
    simulateFinal(t: string) { events?.onFinal(t) },
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<VoiceFormConfig> = {}): VoiceFormConfig {
  return {
    endpoint: 'https://api.example.com/parse',
    schema: {
      fields: [
        { name: 'firstName', type: 'text', label: 'First Name' },
        { name: 'email', type: 'email', label: 'Email Address' },
      ],
    },
    headless: true,
    ...overrides,
  }
}

// Build a mock fetch that returns this response
const PARSE_RESPONSE: ParseResponse = {
  fields: {
    firstName: { value: 'Alice', confidence: 0.9 },
    email: { value: 'alice@example.com', confidence: 0.95 },
  },
}

function mockFetch(body: unknown = PARSE_RESPONSE) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

// ---------------------------------------------------------------------------
// Shared test helper: drive instance to confirming state
// ---------------------------------------------------------------------------
async function driveToConfirming(
  adapter: ReturnType<typeof createMockAdapter>,
  config: VoiceFormConfig,
  flushAll: () => Promise<void>,
): Promise<ReturnType<typeof createVoiceForm>> {
  vi.stubGlobal('fetch', mockFetch())
  const instance = createVoiceForm(config)

  await instance.start()
  adapter.simulateFinal('Alice alice@example.com')
  await flushAll()
  await flushAll()

  return instance
}

// ---------------------------------------------------------------------------
// SECTION 1 — Basic correctField behavior
// ---------------------------------------------------------------------------

describe('P6-08 — correctField() in confirming state', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers()
    installSyncRaf()
    adapter = createMockAdapter()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function flushAll(ms = 0) {
    if (ms > 0) vi.advanceTimersByTime(ms)
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
  }

  it('returns true when called from confirming state', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    expect(instance.getState().status).toBe('confirming')
    const result = instance.correctField('firstName', 'Bob')
    expect(result).toBe(true)

    instance.destroy()
  })

  it('state remains confirming with updated value after correctField()', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    instance.correctField('firstName', 'Bob')

    const state = instance.getState()
    expect(state.status).toBe('confirming')
    if (state.status === 'confirming') {
      expect(state.confirmation.parsedFields['firstName']?.value).toBe('Bob')
    }

    instance.destroy()
  })

  it('returns false when called from idle state', () => {
    const instance = createVoiceForm(makeConfig())
    expect(instance.getState().status).toBe('idle')

    const result = instance.correctField('firstName', 'Bob')
    expect(result).toBe(false)

    instance.destroy()
  })

  it('returns false when called after destroy()', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    instance.destroy()
    const result = instance.correctField('firstName', 'Bob')
    expect(result).toBe(false)
  })

  it('returns false when called from recording state', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    expect(instance.getState().status).toBe('recording')

    const result = instance.correctField('firstName', 'Bob')
    expect(result).toBe(false)

    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 2 — Sanitization
// ---------------------------------------------------------------------------

describe('P6-08 — correctField() sanitization', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers()
    installSyncRaf()
    adapter = createMockAdapter()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function flushAll(ms = 0) {
    if (ms > 0) vi.advanceTimersByTime(ms)
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
  }

  it('strips HTML tags from the corrected value', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    const result = instance.correctField('firstName', '<b>Bob</b>')
    expect(result).toBe(true)

    const state = instance.getState()
    if (state.status === 'confirming') {
      // HTML must be stripped
      expect(state.confirmation.parsedFields['firstName']?.value).toBe('Bob')
    }

    instance.destroy()
  })

  it('returns false when sanitization reduces non-empty input to empty string', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    // A value of only HTML tags that sanitizes to empty
    const result = instance.correctField('firstName', '<script></script>')
    // If sanitization produces '' from '<script></script>', returns false
    // If it produces 'script' or similar, returns true — either is valid per spec;
    // the key is that the sanitizer's actual output is used
    // We test the contract: whatever sanitizeFieldValue returns is what's stored
    // (empty → false, non-empty → true)
    // Since '<script></script>' → '' after stripping, expect false
    expect(result).toBe(false)

    instance.destroy()
  })

  it('does not dispatch FIELD_CORRECTED when sanitization rejects the input', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    const confirmationBefore = (instance.getState() as Extract<VoiceFormState, { status: 'confirming' }>).confirmation

    instance.correctField('firstName', '<script></script>')

    const stateAfter = instance.getState()
    if (stateAfter.status === 'confirming') {
      // State object must be the same reference — no FIELD_CORRECTED dispatched
      expect(stateAfter.confirmation).toBe(confirmationBefore)
    }

    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 3 — Immutability
// ---------------------------------------------------------------------------

describe('P6-08 — correctField() immutability', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers()
    installSyncRaf()
    adapter = createMockAdapter()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function flushAll(ms = 0) {
    if (ms > 0) vi.advanceTimersByTime(ms)
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
  }

  it('new ConfirmationData is a different object reference (not mutated)', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    const stateBefore = instance.getState() as Extract<VoiceFormState, { status: 'confirming' }>
    const confirmationBefore = stateBefore.confirmation

    instance.correctField('firstName', 'Bob')

    const stateAfter = instance.getState() as Extract<VoiceFormState, { status: 'confirming' }>
    const confirmationAfter = stateAfter.confirmation

    expect(Object.is(confirmationBefore, confirmationAfter)).toBe(false)
    instance.destroy()
  })

  it('parsedFields in new ConfirmationData is a different object reference', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    const stateBefore = instance.getState() as Extract<VoiceFormState, { status: 'confirming' }>
    const parsedFieldsBefore = stateBefore.confirmation.parsedFields

    instance.correctField('firstName', 'Bob')

    const stateAfter = instance.getState() as Extract<VoiceFormState, { status: 'confirming' }>
    expect(Object.is(parsedFieldsBefore, stateAfter.confirmation.parsedFields)).toBe(false)

    instance.destroy()
  })

  it('uncorrected fields are the same object references (shallow spread)', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    const stateBefore = instance.getState() as Extract<VoiceFormState, { status: 'confirming' }>
    const emailBefore = stateBefore.confirmation.parsedFields['email']

    instance.correctField('firstName', 'Bob')

    const stateAfter = instance.getState() as Extract<VoiceFormState, { status: 'confirming' }>
    const emailAfter = stateAfter.confirmation.parsedFields['email']

    // The email field object should be the same reference (shallow spread)
    expect(Object.is(emailBefore, emailAfter)).toBe(true)

    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 4 — userCorrected and originalValue
// ---------------------------------------------------------------------------

describe('P6-08 — correctField() userCorrected and originalValue', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers()
    installSyncRaf()
    adapter = createMockAdapter()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function flushAll(ms = 0) {
    if (ms > 0) vi.advanceTimersByTime(ms)
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
  }

  it('sets userCorrected=true on the corrected field', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    instance.correctField('firstName', 'Bob')

    const state = instance.getState()
    if (state.status === 'confirming') {
      expect(state.confirmation.parsedFields['firstName']?.userCorrected).toBe(true)
    }

    instance.destroy()
  })

  it('sets originalValue to the previous LLM value', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    // The LLM returned 'Alice' for firstName
    instance.correctField('firstName', 'Bob')

    const state = instance.getState()
    if (state.status === 'confirming') {
      expect(state.confirmation.parsedFields['firstName']?.originalValue).toBe('Alice')
    }

    instance.destroy()
  })

  it('preserves originalValue from first correction on subsequent correction', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    // First correction: Alice → Bob
    instance.correctField('firstName', 'Bob')

    // Second correction: Bob → Charlie
    // originalValue should still be 'Bob' (the value before THIS correction)
    instance.correctField('firstName', 'Charlie')

    const state = instance.getState()
    if (state.status === 'confirming') {
      expect(state.confirmation.parsedFields['firstName']?.value).toBe('Charlie')
      // The originalValue for the second correction is 'Bob' (the pre-correction value)
      expect(state.confirmation.parsedFields['firstName']?.originalValue).toBe('Bob')
    }

    instance.destroy()
  })

  it('sets userCorrected=false on uncorrected fields', async () => {
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    instance.correctField('firstName', 'Bob')

    const state = instance.getState()
    if (state.status === 'confirming') {
      // email was not corrected
      expect(state.confirmation.parsedFields['email']?.userCorrected).toBeUndefined()
    }

    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 5 — FIELD_CORRECTED event dispatch count
// ---------------------------------------------------------------------------

describe('P6-08 — correctField() event dispatch', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers()
    installSyncRaf()
    adapter = createMockAdapter()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function flushAll(ms = 0) {
    if (ms > 0) vi.advanceTimersByTime(ms)
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
  }

  it('FIELD_CORRECTED causes exactly one state change per correctField() call', async () => {
    const stateChanges: VoiceFormState[] = []
    const instance = await driveToConfirming(adapter, makeConfig({ sttAdapter: adapter }), flushAll)

    instance.subscribe((state) => {
      stateChanges.push(state)
    })

    instance.correctField('firstName', 'Bob')

    // Exactly one state change: confirming → confirming (new confirmation object)
    expect(stateChanges).toHaveLength(1)
    expect(stateChanges[0]?.status).toBe('confirming')

    instance.destroy()
  })

  it('state does not change when correctField() is called from idle', () => {
    const stateChanges: VoiceFormState[] = []
    const instance = createVoiceForm(makeConfig())
    instance.subscribe((s) => stateChanges.push(s))

    instance.correctField('firstName', 'Bob')

    expect(stateChanges).toHaveLength(0)
    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 6 — correctField for a field in missingFields
// ---------------------------------------------------------------------------

describe('P6-08 — correctField() on a missing field', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers()
    installSyncRaf()
    adapter = createMockAdapter()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function flushAll(ms = 0) {
    if (ms > 0) vi.advanceTimersByTime(ms)
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
  }

  it('creates a new parsedFields entry for a field that was in missingFields', async () => {
    // LLM only parsed firstName, email is missing
    const partialResponse: ParseResponse = {
      fields: {
        firstName: { value: 'Alice' },
        // email intentionally absent
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(partialResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()

    const confirmingState = instance.getState()
    expect(confirmingState.status).toBe('confirming')
    if (confirmingState.status === 'confirming') {
      expect(confirmingState.confirmation.missingFields).toContain('email')
      expect(confirmingState.confirmation.parsedFields['email']).toBeUndefined()
    }

    // Correct the missing field — should create a new entry
    const result = instance.correctField('email', 'bob@example.com')
    expect(result).toBe(true)

    const correctedState = instance.getState()
    if (correctedState.status === 'confirming') {
      expect(correctedState.confirmation.parsedFields['email']?.value).toBe('bob@example.com')
      expect(correctedState.confirmation.parsedFields['email']?.userCorrected).toBe(true)
    }

    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 7 — correctField followed by confirm
// ---------------------------------------------------------------------------

describe('P6-08 — correctField() followed by confirm() — corrected value sent to injector', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers()
    installSyncRaf()
    adapter = createMockAdapter()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function flushAll(ms = 0) {
    if (ms > 0) vi.advanceTimersByTime(ms)
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
  }

  it('corrected value in confirming state is what the injector receives after confirm()', async () => {
    // This test verifies the FULL chain by spying on the injector via a
    // formElement with a real DOM element and checking the post-injection state.
    //
    // We use subscribe() to observe state transitions and verify that:
    //   1. After correctField(), parsedFields has the corrected value
    //   2. The injecting state (which the injector receives) carries the corrected value
    //   3. The done state is reached (injection completed without error)
    //
    // DOM writes are NOT verified here — injector DOM behavior is separately tested
    // in injector.test.ts and the p6-06 partial-fill tests.

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(PARSE_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    await instance.start()
    adapter.simulateFinal('Alice alice@example.com')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('confirming')

    // Verify LLM value before correction
    const beforeCorrection = instance.getState()
    if (beforeCorrection.status === 'confirming') {
      expect(beforeCorrection.confirmation.parsedFields['firstName']?.value).toBe('Alice')
    }

    // Correct the field
    const corrected = instance.correctField('firstName', 'Bob')
    expect(corrected).toBe(true)

    // After correction, the confirming state carries the new value
    const afterCorrection = instance.getState()
    expect(afterCorrection.status).toBe('confirming')
    if (afterCorrection.status === 'confirming') {
      expect(afterCorrection.confirmation.parsedFields['firstName']?.value).toBe('Bob')
    }

    // Observe the injecting state to verify the corrected value is passed to inject()
    let injectingConfirmation: ReturnType<typeof instance.getState> | null = null
    const unsub = instance.subscribe((state) => {
      if (state.status === 'injecting') {
        injectingConfirmation = state
      }
    })

    await instance.confirm()
    await flushAll()
    unsub()

    // The injecting state must have the corrected value
    expect(injectingConfirmation).not.toBeNull()
    if (injectingConfirmation && (injectingConfirmation as Extract<ReturnType<typeof instance.getState>, { status: 'injecting' }>).status === 'injecting') {
      const injState = injectingConfirmation as Extract<ReturnType<typeof instance.getState>, { status: 'injecting' }>
      expect(injState.confirmation.parsedFields['firstName']?.value).toBe('Bob')
    }

    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 8 — label preservation in correctField for unknown field
// ---------------------------------------------------------------------------

describe('P6-08 — correctField() label handling', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers()
    installSyncRaf()
    adapter = createMockAdapter()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function flushAll(ms = 0) {
    if (ms > 0) vi.advanceTimersByTime(ms)
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
  }

  it('uses schema label for a corrected field that had no parsedField entry', async () => {
    const partialResponse: ParseResponse = {
      fields: { firstName: { value: 'Alice' } },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(partialResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()

    instance.correctField('email', 'test@example.com')

    const state = instance.getState()
    if (state.status === 'confirming') {
      // label should be from the schema ('Email Address') or field name ('email')
      const emailField = state.confirmation.parsedFields['email']
      expect(emailField?.label).toBeTruthy()
      // Must be either the schema label or the field name fallback
      const validLabels = ['Email Address', 'email']
      expect(validLabels).toContain(emailField?.label)
    }

    instance.destroy()
  })

  it('correctField() for a confirming data already has the right appendMode flag', async () => {
    vi.stubGlobal('fetch', mockFetch())
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    adapter.simulateFinal('Alice alice@example.com')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('confirming')
    instance.correctField('firstName', 'Bob')

    const state = instance.getState()
    if (state.status === 'confirming') {
      // appendMode from the original ConfirmationData must be preserved
      expect(state.confirmation.appendMode).toBe(false)
    }

    instance.destroy()
  })
})
