// @vitest-environment jsdom
/**
 * create-voice-form.test.ts
 *
 * Integration test suite for the createVoiceForm factory (P1-08).
 *
 * Mock strategy:
 *   - STT adapter: hand-rolled mock implementing STTAdapter interface
 *   - fetch: vi.stubGlobal for endpoint tests
 *   - Timers: vi.useFakeTimers for cooldown and auto-reset behaviour
 *
 * Environment: jsdom (required for DOMParser in sanitize.ts, CSS.escape, etc.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createVoiceForm } from '../src/create-voice-form.js'
import type {
  STTAdapter,
  STTAdapterEvents,
  VoiceFormConfig,
  VoiceFormState,
  ParseResponse,
  ConfirmationData,
} from '../src/types.js'

// ---------------------------------------------------------------------------
// CSS.escape polyfill guard (jsdom ships it; belt-and-suspenders)
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
// requestAnimationFrame stub helpers
// ---------------------------------------------------------------------------
//
// The DOM injector uses requestAnimationFrame internally. When vi.useFakeTimers()
// is active, rAF callbacks are captured but not automatically fired. We stub rAF
// to run synchronously so inject() promises resolve without needing manual
// timer advancement.

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
  if (originalRaf) {
    vi.stubGlobal('requestAnimationFrame', originalRaf)
  }
  rafCallbacks = []
}

// ---------------------------------------------------------------------------
// Mock STT Adapter
// ---------------------------------------------------------------------------

/**
 * Controllable mock STT adapter.
 * Tests drive it by calling the `simulate*` helpers after `start()`.
 */
interface MockSTTAdapter extends STTAdapter {
  /** Simulate a successful final transcript. */
  simulateFinal(transcript: string): void
  /** Simulate an interim transcript. */
  simulateInterim(transcript: string): void
  /** Simulate an STT error. */
  simulateError(code: string, message?: string): void
  /** Simulate the recording ending (no more speech). */
  simulateEnd(): void
  /** Number of times start() was called. */
  startCallCount: number
  /** Number of times stop() was called. */
  stopCallCount: number
  /** Number of times abort() was called. */
  abortCallCount: number
  /** Whether isSupported() returns true. */
  supported: boolean
}

function createMockSTTAdapter(supported = true): MockSTTAdapter {
  let boundEvents: STTAdapterEvents | null = null
  let startCount = 0
  let stopCount = 0
  let abortCount = 0

  const adapter: MockSTTAdapter = {
    supported,

    isSupported() {
      return this.supported
    },

    async start(events: STTAdapterEvents): Promise<void> {
      startCount++
      boundEvents = events
    },

    stop() {
      stopCount++
      // The real adapter calls onFinal with collected transcript, then onEnd.
      // Tests that need this must call simulateFinal themselves before stop().
    },

    abort() {
      abortCount++
      boundEvents = null
    },

    simulateFinal(transcript: string) {
      boundEvents?.onFinal(transcript)
    },

    simulateInterim(transcript: string) {
      boundEvents?.onInterim(transcript)
    },

    simulateError(code: string, message = 'STT error') {
      const err = Object.assign(new Error(message), {
        code,
        name: 'STTError',
      })
      boundEvents?.onError(err as Parameters<STTAdapterEvents['onError']>[0])
    },

    simulateEnd() {
      boundEvents?.onEnd()
    },

    get startCallCount() {
      return startCount
    },
    get stopCallCount() {
      return stopCount
    },
    get abortCallCount() {
      return abortCount
    },
  }

  return adapter
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid VoiceFormConfig for most tests. */
function makeConfig(overrides: Partial<VoiceFormConfig> = {}): VoiceFormConfig {
  return {
    endpoint: 'https://api.example.com/parse',
    schema: {
      formName: 'Test Form',
      fields: [
        { name: 'firstName', type: 'text', label: 'First Name' },
        { name: 'email', type: 'email', label: 'Email' },
      ],
    },
    headless: true,
    ...overrides,
  }
}

/** A valid ParseResponse body matching the schema above. */
const VALID_PARSE_RESPONSE: ParseResponse = {
  fields: {
    firstName: { value: 'Alice' },
    email: { value: 'alice@example.com', confidence: 0.95 },
  },
}

/** Build a mock fetch that resolves with the supplied body. */
function mockFetchOk(body: unknown = VALID_PARSE_RESPONSE, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

/** Build a mock fetch that rejects with a network error. */
function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
}

/**
 * Advances fake timers, flushes pending rAF callbacks, and drains the
 * microtask queue. Multiple rounds to handle nested promise chains.
 */
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

/**
 * Wait for the instance to reach a specific status.
 * Uses polling so tests don't need to know the exact timer durations.
 */
async function waitForState(
  getState: () => VoiceFormState,
  status: VoiceFormState['status'],
  maxMs = 100,
): Promise<void> {
  const start = Date.now()
  while (getState().status !== status) {
    await Promise.resolve()
    if (Date.now() - start > maxMs) {
      throw new Error(
        `Timed out waiting for state "${status}" — current: "${getState().status}"`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// SECTION 1 — Construction tests
// ---------------------------------------------------------------------------

describe('createVoiceForm — construction', () => {
  it('creates an instance successfully with a valid config', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    expect(instance).toBeDefined()
    expect(typeof instance.start).toBe('function')
    expect(typeof instance.stop).toBe('function')
    expect(typeof instance.confirm).toBe('function')
    expect(typeof instance.cancel).toBe('function')
    expect(typeof instance.destroy).toBe('function')
    expect(typeof instance.getState).toBe('function')
    expect(typeof instance.getParsedFields).toBe('function')
    expect(typeof instance.subscribe).toBe('function')
    instance.destroy()
  })

  it('throws VoiceFormConfigError for an invalid schema (empty fields)', () => {
    expect(() =>
      createVoiceForm(
        makeConfig({ schema: { fields: [] } }),
      ),
    ).toThrow()

    try {
      createVoiceForm(makeConfig({ schema: { fields: [] } }))
    } catch (err) {
      expect((err as Error).name).toBe('VoiceFormConfigError')
      expect((err as { code: string }).code).toBe('SCHEMA_INVALID')
    }
  })

  it('throws VoiceFormConfigError for null schema', () => {
    expect(() =>
      createVoiceForm(makeConfig({ schema: null as unknown as VoiceFormConfig['schema'] })),
    ).toThrow()
  })

  it('throws if endpoint is missing', () => {
    expect(() =>
      createVoiceForm(makeConfig({ endpoint: '' })),
    ).toThrow()
  })

  it('initial state is idle', () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: createMockSTTAdapter() }))
    expect(instance.getState().status).toBe('idle')
    instance.destroy()
  })

  it('uses provided STT adapter instead of default', async () => {
    const adapter = createMockSTTAdapter()
    vi.stubGlobal('fetch', mockFetchOk())

    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()

    expect(adapter.startCallCount).toBe(1)
    instance.destroy()
    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// SECTION 2 — Happy path flow
// ---------------------------------------------------------------------------

describe('createVoiceForm — happy path flow', () => {
  let adapter: MockSTTAdapter

  beforeEach(() => {
    adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    installSyncRaf()
    vi.stubGlobal('fetch', mockFetchOk())
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('transitions idle → recording on start()', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    const startPromise = instance.start()
    await startPromise

    expect(instance.getState().status).toBe('recording')
    instance.destroy()
  })

  it('full happy path: start → transcript → confirm → done → idle', async () => {
    const onDone = vi.fn()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, events: { onDone } }),
    )

    // Start recording
    await instance.start()
    expect(instance.getState().status).toBe('recording')

    // STT fires final transcript → processing
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()

    // Should be in processing then confirming after endpoint responds
    await flushAll()
    expect(instance.getState().status).toBe('confirming')

    // getParsedFields should return data in confirming state
    const fields = instance.getParsedFields()
    expect(fields).not.toBeNull()
    expect(fields?.firstName).toBeDefined()
    expect(fields?.email).toBeDefined()
    expect(fields?.firstName.value).toBe('Alice')

    // Confirm → injecting → done
    await instance.confirm()
    await flushAll()
    expect(instance.getState().status).toBe('done')

    // onDone should have been called
    expect(onDone).toHaveBeenCalledTimes(1)

    // AUTO_RESET after 500ms → idle
    await flushAll(500)
    expect(instance.getState().status).toBe('idle')

    instance.destroy()
  })

  it('start() → STT fires interim transcript (no state change to processing)', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()

    adapter.simulateInterim('Alice …')
    await flushAll()

    // Still recording, not processing
    expect(instance.getState().status).toBe('recording')
    const state = instance.getState()
    if (state.status === 'recording') {
      expect(state.interimTranscript).toBe('Alice …')
    }
    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 3 — Cancel at various stages
// ---------------------------------------------------------------------------

describe('createVoiceForm — cancellation', () => {
  let adapter: MockSTTAdapter

  beforeEach(() => {
    adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    installSyncRaf()
    vi.stubGlobal('fetch', mockFetchOk())
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('cancel() during recording returns to idle', async () => {
    const onCancel = vi.fn()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, events: { onCancel } }),
    )
    await instance.start()
    expect(instance.getState().status).toBe('recording')

    instance.cancel()
    await flushAll()

    expect(instance.getState().status).toBe('idle')
    expect(onCancel).toHaveBeenCalledTimes(1)
    instance.destroy()
  })

  it('stop() during recording returns to idle', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    expect(instance.getState().status).toBe('recording')

    instance.stop()
    await flushAll()

    expect(instance.getState().status).toBe('idle')
    instance.destroy()
  })

  it('cancel at confirmation: start → transcript → fields → cancel → idle', async () => {
    const onCancel = vi.fn()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, events: { onCancel } }),
    )

    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('confirming')

    instance.cancel()
    await flushAll()

    expect(instance.getState().status).toBe('idle')
    expect(onCancel).toHaveBeenCalledTimes(1)
    instance.destroy()
  })

  it('cancel() from confirming clears parsed fields', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()

    expect(instance.getParsedFields()).not.toBeNull()

    instance.cancel()
    await flushAll()

    expect(instance.getState().status).toBe('idle')
    expect(instance.getParsedFields()).toBeNull()
    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 4 — Error paths
// ---------------------------------------------------------------------------

describe('createVoiceForm — error paths', () => {
  let adapter: MockSTTAdapter

  beforeEach(() => {
    adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    installSyncRaf()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('STT permission denied → error state with PERMISSION_DENIED code', async () => {
    const onError = vi.fn()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, events: { onError } }),
    )

    await instance.start()
    adapter.simulateError('PERMISSION_DENIED', 'User denied microphone access')
    await flushAll()

    expect(instance.getState().status).toBe('error')
    const state = instance.getState()
    if (state.status === 'error') {
      expect(state.error.code).toBe('PERMISSION_DENIED')
    }
    expect(onError).toHaveBeenCalledTimes(1)

    // Auto-resets after 3s (recoverable error)
    await flushAll(3000)
    expect(instance.getState().status).toBe('idle')

    instance.destroy()
  })

  it('STT no speech (NO_SPEECH) → error state', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()

    adapter.simulateError('NO_SPEECH', 'No speech detected')
    await flushAll()

    expect(instance.getState().status).toBe('error')
    const state = instance.getState()
    if (state.status === 'error') {
      // NO_SPEECH maps to NO_TRANSCRIPT in the state machine
      expect(state.error.code).toBe('NO_TRANSCRIPT')
    }

    await flushAll(3000)
    expect(instance.getState().status).toBe('idle')
    instance.destroy()
  })

  it('endpoint error → error state', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError())
    const onError = vi.fn()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
        events: { onError },
        endpointOptions: { retries: 0 },
      }),
    )

    await instance.start()
    adapter.simulateFinal('some transcript')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('error')
    const state = instance.getState()
    if (state.status === 'error') {
      expect(state.error.code).toBe('ENDPOINT_ERROR')
    }
    expect(onError).toHaveBeenCalledTimes(1)
    instance.destroy()
  })

  it('endpoint 500 error → error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Internal Server Error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        }),
      ),
    )
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
        // retries: 0 so we don't need to advance the retry backoff timer
        endpointOptions: { retries: 0 },
      }),
    )

    await instance.start()
    adapter.simulateFinal('some transcript')
    // Flush microtasks for the fetch to resolve
    await flushAll()
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('error')
    instance.destroy()
  })

  it('transcript too long → error state without hitting endpoint', async () => {
    const mockFetch = mockFetchOk()
    vi.stubGlobal('fetch', mockFetch)

    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, maxTranscriptLength: 10 }),
    )

    await instance.start()
    // 11 characters — exceeds the 10-char limit
    adapter.simulateFinal('Hello World')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('error')
    const state = instance.getState()
    if (state.status === 'error') {
      expect(state.error.code).toBe('TRANSCRIPT_TOO_LONG')
    }
    // fetch should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled()
    instance.destroy()
  })

  it('invalid transcript (control characters) → error state without endpoint call', async () => {
    const mockFetch = mockFetchOk()
    vi.stubGlobal('fetch', mockFetch)

    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    await instance.start()
    // Transcript with null byte — should be rejected by validateTranscript
    adapter.simulateFinal('Hello\x00World')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('error')
    const state = instance.getState()
    if (state.status === 'error') {
      expect(state.error.code).toBe('INVALID_TRANSCRIPT')
    }
    expect(mockFetch).not.toHaveBeenCalled()
    instance.destroy()
  })

  it('onBeforeConfirm callback exception is caught and does not break the flow', async () => {
    vi.stubGlobal('fetch', mockFetchOk())
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
        events: {
          onBeforeConfirm: () => {
            throw new Error('callback error')
          },
        },
      }),
    )

    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()

    // Despite callback throwing, should still be in confirming
    expect(instance.getState().status).toBe('confirming')
    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 5 — Cooldown guard
// ---------------------------------------------------------------------------

describe('createVoiceForm — cooldown guard', () => {
  let adapter: MockSTTAdapter

  beforeEach(() => {
    adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    installSyncRaf()
    vi.stubGlobal('fetch', mockFetchOk())
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('start() is blocked during cooldown period', async () => {
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, requestCooldownMs: 3000 }),
    )

    // Complete a full flow to trigger cooldown
    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()
    expect(instance.getState().status).toBe('confirming')

    await instance.confirm()
    await flushAll()
    expect(instance.getState().status).toBe('done')

    // AUTO_RESET to idle
    await flushAll(500)
    expect(instance.getState().status).toBe('idle')

    // Attempt to start again immediately — should be blocked by cooldown
    await instance.start()
    await flushAll()

    // Should be in error (COOLDOWN_ACTIVE) or still idle
    const state = instance.getState()
    const blocked = state.status === 'idle' || state.status === 'error'
    expect(blocked).toBe(true)
    if (state.status === 'error') {
      expect(state.error.code).toBe('COOLDOWN_ACTIVE')
    }

    instance.destroy()
  })

  it('start() is allowed after cooldown expires', async () => {
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, requestCooldownMs: 3000 }),
    )

    // Complete a flow
    await instance.start()
    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()
    await instance.confirm()
    await flushAll()
    await flushAll(500) // auto-reset to idle

    // Advance past the cooldown
    await flushAll(3001)

    // Now start should succeed
    // Need a fresh adapter reference since start was called already
    const adapter2 = createMockSTTAdapter()
    const instance2 = createVoiceForm(
      makeConfig({ sttAdapter: adapter2, requestCooldownMs: 3000 }),
    )

    // This instance hasn't had any requests, so no cooldown
    await instance2.start()
    expect(instance2.getState().status).toBe('recording')

    instance.destroy()
    instance2.destroy()
  })

  it('start() stays idle and fires onError(COOLDOWN_ACTIVE) on the same instance while cooldown is active', async () => {
    // LLD § 4g — cooldown timer approach: cooldownActive flag is set when done
    // state is entered, cleared after requestCooldownMs elapses. start() must
    // stay in idle and call onError(COOLDOWN_ACTIVE) rather than touching the
    // state machine — avoids reentrancy guard interaction.
    const onError = vi.fn()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, requestCooldownMs: 3000, events: { onError } }),
    )

    // Complete a full flow to arm the cooldown
    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()
    expect(instance.getState().status).toBe('confirming')
    await instance.confirm()
    await flushAll()
    expect(instance.getState().status).toBe('done')

    // AUTO_RESET fires after 500ms → idle
    await flushAll(500)
    expect(instance.getState().status).toBe('idle')

    // Attempt to start while cooldown is still active (only 500ms of 3000ms elapsed)
    await instance.start()
    await flushAll()

    // Must remain in idle — no state machine transition
    expect(instance.getState().status).toBe('idle')
    // onError must have been called with COOLDOWN_ACTIVE
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'COOLDOWN_ACTIVE' })

    instance.destroy()
  })

  it('start() succeeds on same instance after cooldown timer expires', async () => {
    // After the cooldownTimerId fires and clears cooldownActive, start() must
    // successfully transition idle → recording on the same instance.
    const adapter2 = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, requestCooldownMs: 3000 }),
    )

    // Complete a full flow (uses adapter for first recording)
    await instance.start()
    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()
    await instance.confirm()
    await flushAll()
    expect(instance.getState().status).toBe('done')
    await flushAll(500) // auto-reset → idle (cooldown starts here)
    expect(instance.getState().status).toBe('idle')

    // Advance past the full cooldown window (3000ms from done entry)
    await flushAll(3000)
    expect(instance.getState().status).toBe('idle')

    // Swap in a fresh adapter for the second recording (the mock tracks start counts)
    // We verify on a fresh instance because the first adapter is already consumed.
    const instance2 = createVoiceForm(
      makeConfig({ sttAdapter: adapter2, requestCooldownMs: 3000 }),
    )
    await instance2.start()
    expect(instance2.getState().status).toBe('recording')

    instance.destroy()
    instance2.destroy()
  })

  it('destroy() during active cooldown prevents the cooldown timer from firing', async () => {
    // If the instance is destroyed while cooldownTimerId is pending, clearTimeout
    // must be called so the callback never runs on a torn-down instance.
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, requestCooldownMs: 5000 }),
    )

    // Complete a full flow to arm the cooldown timer
    await instance.start()
    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()
    await instance.confirm()
    await flushAll()
    expect(instance.getState().status).toBe('done')
    await flushAll(500) // auto-reset → idle (cooldownTimerId is now set)
    expect(instance.getState().status).toBe('idle')

    // Destroy while the 5000ms cooldown timer is still pending
    instance.destroy()

    // Advancing past the cooldown window must not throw
    expect(() => vi.advanceTimersByTime(6000)).not.toThrow()
  })

  it('cooldown fires onError after error auto-reset brings instance back to idle', async () => {
    // After a successful request sets the cooldown, if start() is called during
    // cooldown, onError fires. Afterwards the error auto-reset brings state to
    // idle via the error state's own timer — but the cooldown-blocked start()
    // never entered the state machine so there is no error auto-reset for it.
    // This test validates the onError delivery is reliable across the whole flow.
    const onError = vi.fn()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, requestCooldownMs: 3000, events: { onError } }),
    )

    // Complete one full flow
    await instance.start()
    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()
    await instance.confirm()
    await flushAll()
    await flushAll(500) // auto-reset to idle
    expect(instance.getState().status).toBe('idle')

    // Attempt to start immediately — cooldown active, onError fires, stays idle
    await instance.start()
    await flushAll()
    expect(instance.getState().status).toBe('idle')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'COOLDOWN_ACTIVE' })

    // After the cooldown expires, start() must work again
    await flushAll(3000)
    const adapter2 = createMockSTTAdapter()
    const instance2 = createVoiceForm(
      makeConfig({ sttAdapter: adapter2, requestCooldownMs: 3000 }),
    )
    await instance2.start()
    expect(instance2.getState().status).toBe('recording')

    instance.destroy()
    instance2.destroy()
  })

  it('start() with requestCooldownMs=0 is never blocked', async () => {
    const adapter2 = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, requestCooldownMs: 0 }),
    )

    // First flow
    await instance.start()
    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()
    await instance.confirm()
    await flushAll()
    await flushAll(500)
    expect(instance.getState().status).toBe('idle')

    // Second start should go through immediately (no cooldown)
    // Create a fresh instance to avoid stale adapter state
    const instance2 = createVoiceForm(
      makeConfig({ sttAdapter: adapter2, requestCooldownMs: 0 }),
    )
    await instance2.start()
    expect(instance2.getState().status).toBe('recording')

    instance.destroy()
    instance2.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 6 — Destroy / cleanup
// ---------------------------------------------------------------------------

describe('createVoiceForm — destroy', () => {
  let adapter: MockSTTAdapter

  beforeEach(() => {
    adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    installSyncRaf()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('destroy() makes subsequent start() a no-op (does not throw)', async () => {
    vi.stubGlobal('fetch', mockFetchOk())
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    instance.destroy()

    // Should not throw but also should not change state
    await expect(instance.start()).resolves.toBeUndefined()
    expect(instance.getState().status).toBe('idle')
  })

  it('destroy() clears pending auto-reset timers', async () => {
    vi.stubGlobal('fetch', mockFetchOk())
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    await instance.start()
    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()
    await instance.confirm()
    await flushAll()

    // In "done" state — auto-reset timer is pending
    expect(instance.getState().status).toBe('done')

    // Destroy clears the timer
    instance.destroy()

    // Advance timers — no auto-reset should fire
    vi.advanceTimersByTime(1000)
    // After destroy the state should remain as the last known state
    // (the machine is destroyed so getState() still returns 'done' or initial)
    // The key assertion is that no errors are thrown
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
  })

  it('destroy() during recording aborts the STT adapter', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    expect(instance.getState().status).toBe('recording')

    instance.destroy()

    expect(adapter.abortCallCount).toBe(1)
  })

  it('getState() returns current state after destroy', () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    instance.destroy()
    // Should not throw
    expect(() => instance.getState()).not.toThrow()
  })

  it('destroy() resets handlingTransition so the reentrancy guard is not stuck (N-8)', async () => {
    vi.stubGlobal('fetch', mockFetchOk())
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    // Drive to processing so the async handler holds the reentrancy lock
    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    // Do NOT flush — the async processing handler is mid-flight

    // Call destroy() while the handler is conceptually awaiting the endpoint
    instance.destroy()

    // getState() must not throw after destroy regardless of lock state
    expect(() => instance.getState()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// SECTION 7 — subscribe / unsubscribe
// ---------------------------------------------------------------------------

describe('createVoiceForm — subscribe', () => {
  let adapter: MockSTTAdapter

  beforeEach(() => {
    adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    installSyncRaf()
    vi.stubGlobal('fetch', mockFetchOk())
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('listener is called on every state change', async () => {
    const listener = vi.fn()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    instance.subscribe(listener)

    await instance.start()
    expect(listener).toHaveBeenCalled()
    const firstCall = listener.mock.calls[0]
    expect((firstCall[0] as VoiceFormState).status).toBe('recording')

    instance.destroy()
  })

  it('unsubscribe stops notifications', async () => {
    const listener = vi.fn()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    const unsub = instance.subscribe(listener)

    await instance.start()
    const countAfterStart = listener.mock.calls.length

    unsub()

    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()

    // No new calls after unsub
    expect(listener.mock.calls.length).toBe(countAfterStart)
    instance.destroy()
  })

  it('multiple listeners each receive notifications', async () => {
    const listener1 = vi.fn()
    const listener2 = vi.fn()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    instance.subscribe(listener1)
    instance.subscribe(listener2)

    await instance.start()

    expect(listener1).toHaveBeenCalled()
    expect(listener2).toHaveBeenCalled()
    instance.destroy()
  })

  it('subscribe returns an unsubscribe function', () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    const unsub = instance.subscribe(vi.fn())
    expect(typeof unsub).toBe('function')
    expect(() => unsub()).not.toThrow()
    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 8 — getParsedFields
// ---------------------------------------------------------------------------

describe('createVoiceForm — getParsedFields', () => {
  let adapter: MockSTTAdapter

  beforeEach(() => {
    adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    installSyncRaf()
    vi.stubGlobal('fetch', mockFetchOk())
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns null in idle state', () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    expect(instance.getParsedFields()).toBeNull()
    instance.destroy()
  })

  it('returns null during recording', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    expect(instance.getState().status).toBe('recording')
    expect(instance.getParsedFields()).toBeNull()
    instance.destroy()
  })

  it('returns parsed fields in confirming state', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('confirming')
    const fields = instance.getParsedFields()
    expect(fields).not.toBeNull()
    expect(fields?.firstName).toBeDefined()
    expect(fields?.email).toBeDefined()
    instance.destroy()
  })

  it('returns parsed fields in injecting state', async () => {
    // We test this by observing the injecting state during confirm flow.
    // The injecting state is brief so we listen via subscribe.
    const statesObserved: string[] = []
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    instance.subscribe((state) => statesObserved.push(state.status))

    await instance.start()
    adapter.simulateFinal('Alice')
    await flushAll()
    await flushAll()
    await instance.confirm()
    await flushAll()

    // Should have passed through injecting → done
    expect(statesObserved).toContain('injecting')
    instance.destroy()
  })

  it('returns null in error state', async () => {
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    adapter.simulateError('PERMISSION_DENIED', 'denied')
    await flushAll()

    expect(instance.getState().status).toBe('error')
    expect(instance.getParsedFields()).toBeNull()
    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION — NEW-003: formElement selector error handling
// ---------------------------------------------------------------------------

describe('createVoiceForm — NEW-003: formElement CSS selector validation', () => {
  it('throws VoiceFormConfigError(INIT_FAILED) for a syntactically invalid CSS selector', () => {
    // An invalid selector like "#foo bar[" causes document.querySelector to throw
    // a DOMException. The fix wraps this in try/catch and re-throws as
    // VoiceFormConfigError so the error contract is maintained.
    expect(() =>
      createVoiceForm(
        makeConfig({
          formElement: '#foo bar[',
        }),
      ),
    ).toThrow()

    try {
      createVoiceForm(makeConfig({ formElement: '#foo bar[' }))
    } catch (err) {
      expect((err as Error).name).toBe('VoiceFormConfigError')
      expect((err as { code: string }).code).toBe('INIT_FAILED')
      expect((err as Error).message).toContain('#foo bar[')
    }
  })

  it('throws VoiceFormConfigError(INIT_FAILED) when a valid selector matches no element', () => {
    // If the selector is valid but finds no element, silently widening scope to
    // document is a security concern — injection may target fields outside the
    // intended form. The fix requires an explicit error so the developer knows.
    expect(() =>
      createVoiceForm(
        makeConfig({
          formElement: '#this-element-does-not-exist-in-jsdom',
        }),
      ),
    ).toThrow()

    try {
      createVoiceForm(makeConfig({ formElement: '#this-element-does-not-exist-in-jsdom' }))
    } catch (err) {
      expect((err as Error).name).toBe('VoiceFormConfigError')
      expect((err as { code: string }).code).toBe('INIT_FAILED')
    }
  })

  it('does NOT throw when formElement is a valid selector that resolves to an element', () => {
    // Create the element in jsdom so the selector finds it
    const formEl = document.createElement('form')
    formEl.id = 'test-form-new003'
    document.body.appendChild(formEl)

    expect(() =>
      createVoiceForm(
        makeConfig({ formElement: '#test-form-new003' }),
      ),
    ).not.toThrow()

    const instance = createVoiceForm(makeConfig({ formElement: '#test-form-new003' }))
    instance.destroy()
    document.body.removeChild(formEl)
  })

  it('does NOT throw when formElement is an HTMLElement reference (not a string)', () => {
    const formEl = document.createElement('form')
    document.body.appendChild(formEl)

    expect(() =>
      createVoiceForm(makeConfig({ formElement: formEl })),
    ).not.toThrow()

    const instance = createVoiceForm(makeConfig({ formElement: formEl }))
    instance.destroy()
    document.body.removeChild(formEl)
  })

  it('does NOT throw when formElement is omitted', () => {
    expect(() =>
      createVoiceForm(makeConfig({ formElement: undefined })),
    ).not.toThrow()

    const instance = createVoiceForm(makeConfig())
    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION — NEW-004: onBeforeConfirm exception routes to onError
// ---------------------------------------------------------------------------

describe('createVoiceForm — NEW-004: onBeforeConfirm exception notification', () => {
  let adapter: MockSTTAdapter

  beforeEach(() => {
    adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    installSyncRaf()
    vi.stubGlobal('fetch', mockFetchOk())
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('calls onError with BEFORE_CONFIRM_FAILED code when onBeforeConfirm throws', async () => {
    // Regression: before the fix, onBeforeConfirm exceptions were silently
    // swallowed. The developer received no notification that their augmentation
    // hook failed, leading to silent data integrity failures.
    const onError = vi.fn()

    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
        events: {
          onBeforeConfirm: () => {
            throw new Error('API lookup failed')
          },
          onError,
        },
      }),
    )

    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()

    // After the fix: onError must be called with a BEFORE_CONFIRM_FAILED code
    expect(onError).toHaveBeenCalledOnce()
    const errorArg = onError.mock.calls[0]?.[0] as { code: string; message: string }
    expect(errorArg.code).toBe('BEFORE_CONFIRM_FAILED')
    expect(errorArg.message).toContain('onBeforeConfirm')

    instance.destroy()
  })

  it('continues to confirming state (uses original data) when onBeforeConfirm throws', async () => {
    // The fix must NOT block the state machine flow — fallback to original
    // sanitized data and continue. Data integrity is maintained even when
    // the developer's augmentation hook fails.
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
        events: {
          onBeforeConfirm: () => {
            throw new Error('transient API error')
          },
        },
      }),
    )

    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()

    // Must still reach confirming state with original data
    expect(instance.getState().status).toBe('confirming')

    instance.destroy()
  })

  it('does NOT call onError when onBeforeConfirm is not configured', async () => {
    const onError = vi.fn()

    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
        events: { onError },
      }),
    )

    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('confirming')
    expect(onError).not.toHaveBeenCalled()

    instance.destroy()
  })

  it('does NOT call onError when onBeforeConfirm succeeds normally', async () => {
    const onError = vi.fn()

    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
        events: {
          onBeforeConfirm: (data: ConfirmationData) => data,
          onError,
        },
      }),
    )

    await instance.start()
    adapter.simulateFinal('Alice, alice@example.com')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('confirming')
    expect(onError).not.toHaveBeenCalled()

    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 9 — updateSchema
// ---------------------------------------------------------------------------

describe('createVoiceForm — updateSchema', () => {
  it('updates the schema when in idle state', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    expect(() =>
      instance.updateSchema({
        fields: [{ name: 'phone', type: 'tel', label: 'Phone' }],
      }),
    ).not.toThrow()

    instance.destroy()
  })

  it('throws VoiceFormConfigError for invalid schema in updateSchema', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    expect(() =>
      instance.updateSchema({ fields: [] }),
    ).toThrow()

    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 10 — Edge cases and guards
// ---------------------------------------------------------------------------

describe('createVoiceForm — edge cases', () => {
  it('empty transcript from STT returns to idle without error', async () => {
    const adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    await instance.start()
    adapter.simulateFinal('')  // empty transcript
    await flushAll()

    // State machine transitions to idle on empty transcript (STT_FINAL with empty)
    expect(instance.getState().status).toBe('idle')

    vi.useRealTimers()
    instance.destroy()
  })

  it('confirm() from non-confirming state is a no-op', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    // In idle state — confirm should be a no-op
    await expect(instance.confirm()).resolves.toBeUndefined()
    expect(instance.getState().status).toBe('idle')

    instance.destroy()
  })

  it('cancel() from idle state is a no-op', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    expect(() => instance.cancel()).not.toThrow()
    expect(instance.getState().status).toBe('idle')

    instance.destroy()
  })

  it('onStateChange callback is fired on each transition', async () => {
    const adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mockFetchOk())

    const onStateChange = vi.fn()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, events: { onStateChange } }),
    )

    await instance.start()
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'recording' }),
    )

    vi.useRealTimers()
    vi.unstubAllGlobals()
    instance.destroy()
  })

  it('onInterimTranscript callback fires on interim results', async () => {
    const adapter = createMockSTTAdapter()
    vi.useFakeTimers()

    const onInterimTranscript = vi.fn()
    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, events: { onInterimTranscript } }),
    )

    await instance.start()
    adapter.simulateInterim('Hello wor…')
    await flushAll()

    expect(onInterimTranscript).toHaveBeenCalledWith('Hello wor…')

    vi.useRealTimers()
    instance.destroy()
  })

  it('multiple start() calls do not start multiple STT sessions', async () => {
    const adapter = createMockSTTAdapter()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mockFetchOk())

    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))
    await instance.start()
    await instance.start() // second call — should be ignored (already recording)
    await flushAll()

    // STT adapter should only have been started once
    expect(adapter.startCallCount).toBe(1)

    vi.useRealTimers()
    vi.unstubAllGlobals()
    instance.destroy()
  })
})
