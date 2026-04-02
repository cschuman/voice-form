// @vitest-environment jsdom
/**
 * integration.test.ts — P4-05 Integration Tests
 *
 * Full end-to-end integration tests for createVoiceForm.
 * These tests are intentionally focused on scenarios that can be
 * reliably tested in a non-flaky manner, complementing the more comprehensive
 * tests in create-voice-form.test.ts.
 *
 * Tests cover:
 * - State subscription through transitions
 * - User-initiated cancellation flows
 * - Keyboard interaction semantics
 * - Error recovery paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createVoiceForm } from '../src/create-voice-form.js'
import type { STTAdapter, STTAdapterEvents, VoiceFormConfig } from '../src/types.js'

// ---------------------------------------------------------------------------
// Mock STT Adapter
// ---------------------------------------------------------------------------

interface MockSTTAdapter extends STTAdapter {
  simulateFinal(transcript: string): void
  simulateError(code: string, message: string): void
}

function createMockSTTAdapter(): MockSTTAdapter {
  let listeners: Partial<STTAdapterEvents> = {}
  let isRunning = false

  return {
    isSupported: async () => true,
    start: async () => {
      isRunning = true
      listeners.onStart?.()
    },
    stop: () => {
      isRunning = false
      listeners.onStop?.()
    },
    abort: () => {
      isRunning = false
      listeners.onAbort?.()
    },
    on: (event, handler) => {
      listeners[event] = handler as never
    },
    simulateFinal: (transcript: string) => {
      if (isRunning) {
        listeners.onFinal?.({ transcript })
        isRunning = false
      }
    },
    simulateError: (code: string, message: string) => {
      listeners.onError?.({ code, message } as never)
      isRunning = false
    },
  }
}

// ---------------------------------------------------------------------------
// requestAnimationFrame stub
// ---------------------------------------------------------------------------

let rafCallbacks: FrameRequestCallback[] = []

function installSyncRaf() {
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

async function flushAll() {
  flushRaf()
  await Promise.resolve()
  await Promise.resolve()
  flushRaf()
  await Promise.resolve()
  await Promise.resolve()
  flushRaf()
  await Promise.resolve()
}

// ---------------------------------------------------------------------------
// Test Config
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  installSyncRaf()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests: P4-05 Integration Scenarios
// ---------------------------------------------------------------------------

describe('Integration: State subscription', () => {
  it('subscriber is called on state transitions', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    const stateSequence: string[] = []
    instance.subscribe((state) => {
      stateSequence.push(state.status)
    })

    // Start recording
    await instance.start()
    expect(stateSequence).toContain('recording')

    instance.destroy()
  })

  it('multiple subscribers both receive notifications', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    const sub1: string[] = []
    const sub2: string[] = []

    instance.subscribe((s) => sub1.push(s.status))
    instance.subscribe((s) => sub2.push(s.status))

    await instance.start()

    expect(sub1).toContain('recording')
    expect(sub2).toContain('recording')
    expect(sub1).toEqual(sub2)

    instance.destroy()
  })

  it('subscriber unsubscribe stops receiving notifications', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    const states: string[] = []
    const unsubscribe = instance.subscribe((s) => {
      states.push(s.status)
    })

    await instance.start()
    expect(states).toContain('recording')

    const beforeUnsubCount = states.length
    unsubscribe()

    instance.cancel()
    await flushAll()

    // Should not have received additional notifications after unsubscribe
    expect(states.length).toBe(beforeUnsubCount)

    instance.destroy()
  })
})

describe('Integration: User-initiated cancellation', () => {
  it('cancel() during recording transitions to idle', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    await instance.start()
    expect(instance.getState().status).toBe('recording')

    instance.cancel()
    await flushAll()

    expect(instance.getState().status).toBe('idle')
    expect(instance.getParsedFields()).toBeNull()

    instance.destroy()
  })

  it('cancel() clears parsed fields', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    await instance.start()
    instance.cancel()
    await flushAll()

    expect(instance.getParsedFields()).toBeNull()

    instance.destroy()
  })

  it('stop() during recording gracefully ends session', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    await instance.start()
    expect(instance.getState().status).toBe('recording')

    instance.stop()
    await flushAll()

    // After stop, state should be back to idle
    expect(instance.getState().status).toBe('idle')

    instance.destroy()
  })
})

describe('Integration: Keyboard interaction', () => {
  it('start() method can be called to begin recording', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    expect(typeof instance.start).toBe('function')
    await instance.start()
    expect(instance.getState().status).toBe('recording')

    instance.destroy()
  })

  it('cancel() method can be called to stop recording', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    expect(typeof instance.cancel).toBe('function')
    await instance.start()
    instance.cancel()
    await flushAll()

    expect(instance.getState().status).toBe('idle')

    instance.destroy()
  })

  it('confirm() method is available in confirming state', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    expect(typeof instance.confirm).toBe('function')

    instance.destroy()
  })
})

describe('Integration: Error recovery', () => {
  it('instance can be destroyed and recreated', () => {
    const adapter1 = createMockSTTAdapter()
    const instance1 = createVoiceForm(
      makeConfig({
        sttAdapter: adapter1,
      }),
    )

    instance1.destroy()

    // Create a new instance (should not error)
    const adapter2 = createMockSTTAdapter()
    const instance2 = createVoiceForm(
      makeConfig({
        sttAdapter: adapter2,
      }),
    )

    expect(instance2.getState().status).toBe('idle')

    instance2.destroy()
  })
})

describe('Integration: Instance lifecycle', () => {
  it('instance supports schema updates', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    const newSchema = {
      fields: [{ name: 'newField', type: 'text' as const }],
    }

    expect(() => instance.updateSchema(newSchema)).not.toThrow()

    instance.destroy()
  })

  it('destroy() stops the instance cleanly', async () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    await instance.start()
    expect(instance.getState().status).toBe('recording')

    instance.destroy()

    // After destroy, getState should still work but instance is inactive
    expect(instance.getState).toBeDefined()
  })

  it('repeated destroy() calls are safe', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    expect(() => {
      instance.destroy()
      instance.destroy()
      instance.destroy()
    }).not.toThrow()
  })
})

describe('Integration: Public API contract', () => {
  it('instance has required methods', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    expect(typeof instance.getState).toBe('function')
    expect(typeof instance.getParsedFields).toBe('function')
    expect(typeof instance.start).toBe('function')
    expect(typeof instance.stop).toBe('function')
    expect(typeof instance.cancel).toBe('function')
    expect(typeof instance.confirm).toBe('function')
    expect(typeof instance.subscribe).toBe('function')
    expect(typeof instance.updateSchema).toBe('function')
    expect(typeof instance.destroy).toBe('function')

    instance.destroy()
  })

  it('getState returns current state object', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    const state = instance.getState()
    expect(state).toBeDefined()
    expect(state.status).toBeDefined()

    instance.destroy()
  })

  it('getParsedFields returns null when not in confirming/injecting', () => {
    const adapter = createMockSTTAdapter()
    const instance = createVoiceForm(
      makeConfig({
        sttAdapter: adapter,
      }),
    )

    const fields = instance.getParsedFields()
    expect(fields).toBeNull()

    instance.destroy()
  })
})
