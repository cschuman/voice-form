// @vitest-environment jsdom

import React, { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVoiceForm } from '../src/use-voice-form.js'
import * as coreModule from '@voiceform/core'
import type { VoiceFormInstance, VoiceFormState, VoiceFormConfig } from '@voiceform/core'

// ---------------------------------------------------------------------------
// Mock @voiceform/core
// ---------------------------------------------------------------------------

vi.mock('@voiceform/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@voiceform/core')>()
  return {
    ...original,
    createVoiceForm: vi.fn(),
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockInstance = VoiceFormInstance & {
  _triggerStateChange: (state: VoiceFormState) => void
  _listeners: Set<(state: VoiceFormState) => void>
}

function makeMockInstance(): MockInstance {
  const listeners = new Set<(state: VoiceFormState) => void>()
  let currentState: VoiceFormState = { status: 'idle' }

  const instance: MockInstance = {
    _listeners: listeners,
    _triggerStateChange: (state: VoiceFormState) => {
      currentState = state
      listeners.forEach((l) => l(state))
    },
    getState: vi.fn(() => currentState),
    getParsedFields: vi.fn(() => null),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn().mockResolvedValue(undefined),
    updateSchema: vi.fn(),
    destroy: vi.fn(() => {
      listeners.clear()
    }),
    subscribe: vi.fn((listener: (state: VoiceFormState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  return instance
}

const minimalConfig: VoiceFormConfig = {
  endpoint: '/api/parse',
  schema: { fields: [{ name: 'test', type: 'text' }] },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVoiceForm', () => {
  let mockCreateVoiceForm: Mock
  let mockInstance: MockInstance

  beforeEach(() => {
    mockInstance = makeMockInstance()
    mockCreateVoiceForm = vi.mocked(coreModule.createVoiceForm)
    // Clear all call history and reset to default return value before each test
    mockCreateVoiceForm.mockReset()
    mockCreateVoiceForm.mockReturnValue(mockInstance)
  })

  it('returns instance and state', () => {
    const { result } = renderHook(() => useVoiceForm(minimalConfig))

    expect(result.current.instance).toBeDefined()
    expect(result.current.state).toBeDefined()
  })

  it('initial state is idle', () => {
    const { result } = renderHook(() => useVoiceForm(minimalConfig))

    expect(result.current.state.status).toBe('idle')
  })

  it('state updates when instance state changes', () => {
    const { result } = renderHook(() => useVoiceForm(minimalConfig))

    expect(result.current.state.status).toBe('idle')

    act(() => {
      mockInstance._triggerStateChange({ status: 'recording', interimTranscript: '' })
    })

    expect(result.current.state.status).toBe('recording')
  })

  it('instance is stable reference across re-renders', () => {
    const { result, rerender } = renderHook(() => useVoiceForm(minimalConfig))

    const firstInstance = result.current.instance
    rerender()
    const secondInstance = result.current.instance

    expect(firstInstance).toBe(secondInstance)
  })

  it('createVoiceForm is called exactly once per mount (no StrictMode)', () => {
    renderHook(() => useVoiceForm(minimalConfig))

    // Outside of StrictMode, createVoiceForm should be called exactly once
    expect(mockCreateVoiceForm).toHaveBeenCalledTimes(1)
  })

  it('destroy is called on unmount', () => {
    const { unmount } = renderHook(() => useVoiceForm(minimalConfig))

    expect(mockInstance.destroy).not.toHaveBeenCalled()
    unmount()
    expect(mockInstance.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroy is called exactly once on unmount even after multiple re-renders', () => {
    const { rerender, unmount } = renderHook(() => useVoiceForm(minimalConfig))

    rerender()
    rerender()
    rerender()

    unmount()
    expect(mockInstance.destroy).toHaveBeenCalledTimes(1)
  })

  it('Strict Mode: ref guard is used correctly — surviving instance is destroyed on unmount', () => {
    // In StrictMode (dev only), React's double-effect cycle causes the ref to
    // be set to null multiple times, so createVoiceForm may be called more than
    // once. The exact count is an implementation detail of React's StrictMode
    // internals and not part of the contract.
    //
    // What we DO verify:
    // 1. createVoiceForm is called more than once (StrictMode active)
    // 2. result.current.instance is the last instance created (persists)
    // 3. The surviving instance is destroyed on final unmount
    const instances: MockInstance[] = []

    mockCreateVoiceForm.mockImplementation(() => {
      const inst = makeMockInstance()
      instances.push(inst)
      return inst
    })

    const { result, unmount } = renderHook(() => useVoiceForm(minimalConfig), {
      wrapper: StrictMode,
    })

    // StrictMode causes more than one instance to be created
    expect(mockCreateVoiceForm.mock.calls.length).toBeGreaterThanOrEqual(2)

    // The surviving instance is the last one created by the ref guard
    const lastInstance = instances[instances.length - 1]
    expect(result.current.instance).toBe(lastInstance)

    // The last instance has NOT been destroyed yet
    expect(lastInstance!.destroy).not.toHaveBeenCalled()

    // Final unmount destroys the surviving instance exactly once
    unmount()
    expect(lastInstance!.destroy).toHaveBeenCalledTimes(1)
  })

  it('subscribe is called exactly once — stable reference prevents re-subscription on re-render', () => {
    // useSyncExternalStore uses referential equality to decide whether to
    // re-subscribe. If subscribe were unstable, it would call subscribe again
    // on each re-render. With empty-dep useCallback, it's stable.
    const { rerender } = renderHook(() => useVoiceForm(minimalConfig))

    // subscribe called once on initial mount
    const callsAfterMount = (mockInstance.subscribe as Mock).mock.calls.length
    expect(callsAfterMount).toBe(1)

    // Re-render multiple times — subscribe should NOT be called again
    rerender()
    rerender()
    rerender()

    expect((mockInstance.subscribe as Mock).mock.calls.length).toBe(callsAfterMount)
  })

  it('returns the correct UseVoiceFormResult shape', () => {
    const { result } = renderHook(() => useVoiceForm(minimalConfig))

    expect(result.current).toHaveProperty('instance')
    expect(result.current).toHaveProperty('state')
    expect(typeof result.current.instance.start).toBe('function')
    expect(typeof result.current.instance.stop).toBe('function')
    expect(typeof result.current.instance.cancel).toBe('function')
    expect(typeof result.current.instance.confirm).toBe('function')
    expect(typeof result.current.instance.destroy).toBe('function')
    expect(typeof result.current.instance.subscribe).toBe('function')
  })

  it('state reflects multiple sequential transitions', () => {
    const { result } = renderHook(() => useVoiceForm(minimalConfig))

    act(() => {
      mockInstance._triggerStateChange({ status: 'recording', interimTranscript: 'hello' })
    })
    expect(result.current.state.status).toBe('recording')

    act(() => {
      mockInstance._triggerStateChange({ status: 'processing', transcript: 'hello world' })
    })
    expect(result.current.state.status).toBe('processing')

    act(() => {
      mockInstance._triggerStateChange({ status: 'idle' })
    })
    expect(result.current.state.status).toBe('idle')
  })
})
