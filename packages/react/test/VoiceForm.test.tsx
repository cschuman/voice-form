// @vitest-environment jsdom
/**
 * Tests for packages/react/src/VoiceForm.tsx (P6-11)
 *
 * TDD: tests are written to the spec in V2_LOW_LEVEL_DESIGN.md section 8.4
 * and V2_TASKS.md P6-11 acceptance criteria.
 *
 * Acceptance criteria covered:
 * - Component renders a button
 * - Button reflects idle state
 * - Component re-renders on state change
 * - Render prop children receive instance and state
 * - Ref forwarding works (resolves to HTMLButtonElement in default UI mode)
 * - Ref is null in render-prop mode
 * - Unmount calls destroy
 * - VoiceForm.displayName === 'VoiceForm'
 * - Callback chaining: onDone + events.onDone both called
 * - Callback chaining: onError + events.onError both called
 */

import React, { createRef, StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { VoiceForm } from '../src/VoiceForm.js'
import * as coreModule from '@voiceform/core'
import type { VoiceFormInstance, VoiceFormState, VoiceFormConfig, InjectionResult, VoiceFormError } from '@voiceform/core'

// ---------------------------------------------------------------------------
// Mock @voiceform/core — same pattern as use-voice-form.test.tsx
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
    setSchema: vi.fn(),
    getSchema: vi.fn().mockReturnValue({ fields: [] }),
    correctField: vi.fn().mockReturnValue(false),
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

describe('VoiceForm component (P6-11)', () => {
  let mockCreateVoiceForm: Mock
  let mockInstance: MockInstance

  beforeEach(() => {
    mockInstance = makeMockInstance()
    mockCreateVoiceForm = vi.mocked(coreModule.createVoiceForm)
    mockCreateVoiceForm.mockReset()
    mockCreateVoiceForm.mockReturnValue(mockInstance)
  })

  afterEach(() => {
    cleanup()
  })

  // ── Basic rendering ───────────────────────────────────────────────────────

  it('renders a button in default UI mode', () => {
    render(<VoiceForm {...minimalConfig} />)
    // Should render at least one button element
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('button reflects idle state with appropriate label', () => {
    render(<VoiceForm {...minimalConfig} />)
    // In idle state the button should have a label indicating voice input is ready
    const btn = screen.getByRole('button')
    const label = btn.getAttribute('aria-label') ?? btn.textContent ?? ''
    expect(label.length).toBeGreaterThan(0)
    // data-voiceform-status should reflect idle
    expect(btn.getAttribute('data-voiceform-status')).toBe('idle')
  })

  it('button is not disabled in idle state', () => {
    render(<VoiceForm {...minimalConfig} />)
    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  // ── State-driven re-renders ───────────────────────────────────────────────

  it('component re-renders when instance state changes to recording', () => {
    render(<VoiceForm {...minimalConfig} />)

    act(() => {
      mockInstance._triggerStateChange({ status: 'recording', interimTranscript: '' })
    })

    const btn = screen.getByRole('button')
    expect(btn.getAttribute('data-voiceform-status')).toBe('recording')
  })

  it('component re-renders through multiple state transitions', () => {
    render(<VoiceForm {...minimalConfig} />)

    act(() => {
      mockInstance._triggerStateChange({ status: 'recording', interimTranscript: 'hello' })
    })
    expect(screen.getByRole('button').getAttribute('data-voiceform-status')).toBe('recording')

    act(() => {
      mockInstance._triggerStateChange({ status: 'processing', transcript: 'hello world' })
    })
    expect(screen.getByRole('button').getAttribute('data-voiceform-status')).toBe('processing')

    act(() => {
      mockInstance._triggerStateChange({ status: 'idle' })
    })
    expect(screen.getByRole('button').getAttribute('data-voiceform-status')).toBe('idle')
  })

  it('button is disabled during processing state', () => {
    render(<VoiceForm {...minimalConfig} />)

    act(() => {
      mockInstance._triggerStateChange({ status: 'processing', transcript: 'test' })
    })

    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  // ── Render prop mode ──────────────────────────────────────────────────────

  it('renders children as function when provided', () => {
    const childFn = vi.fn(({ state, instance }: { state: VoiceFormState; instance: VoiceFormInstance }) => (
      <div data-testid="custom-ui" data-status={state.status}>
        <button onClick={() => void instance.start()}>Custom Start</button>
      </div>
    ))

    render(<VoiceForm {...minimalConfig}>{childFn}</VoiceForm>)

    expect(screen.getByTestId('custom-ui')).toBeDefined()
    expect(childFn).toHaveBeenCalled()
  })

  it('render prop receives current state and instance', () => {
    let capturedState: VoiceFormState | null = null
    let capturedInstance: VoiceFormInstance | null = null

    render(
      <VoiceForm {...minimalConfig}>
        {({ state, instance }) => {
          capturedState = state
          capturedInstance = instance
          return <div />
        }}
      </VoiceForm>,
    )

    expect(capturedState).not.toBeNull()
    expect(capturedState?.status).toBe('idle')
    expect(capturedInstance).toBe(mockInstance)
  })

  it('render prop receives updated state on state change', () => {
    const states: string[] = []

    render(
      <VoiceForm {...minimalConfig}>
        {({ state }) => {
          states.push(state.status)
          return <div data-status={state.status} />
        }}
      </VoiceForm>,
    )

    act(() => {
      mockInstance._triggerStateChange({ status: 'recording', interimTranscript: '' })
    })

    expect(states).toContain('idle')
    expect(states).toContain('recording')
  })

  // ── Ref forwarding ────────────────────────────────────────────────────────

  it('ref resolves to the mic button HTMLButtonElement in default UI mode', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<VoiceForm ref={ref} {...minimalConfig} />)

    expect(ref.current).not.toBeNull()
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('ref.current is the actual button in the DOM', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<VoiceForm ref={ref} {...minimalConfig} />)

    const btn = screen.getByRole('button')
    expect(ref.current).toBe(btn)
  })

  it('ref.current is null in render-prop mode (ref forwarding is a no-op)', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <VoiceForm ref={ref} {...minimalConfig}>
        {() => <div>headless</div>}
      </VoiceForm>,
    )
    // In render prop mode the ref is not forwarded — it stays null
    expect(ref.current).toBeNull()
  })

  // ── Unmount / lifecycle ───────────────────────────────────────────────────

  it('calls destroy on the instance when the component unmounts', () => {
    const { unmount } = render(<VoiceForm {...minimalConfig} />)

    expect(mockInstance.destroy).not.toHaveBeenCalled()
    unmount()
    expect(mockInstance.destroy).toHaveBeenCalledTimes(1)
  })

  it('calls destroy exactly once even after re-renders', () => {
    const { rerender, unmount } = render(<VoiceForm {...minimalConfig} />)

    rerender(<VoiceForm {...minimalConfig} />)
    rerender(<VoiceForm {...minimalConfig} />)
    unmount()

    expect(mockInstance.destroy).toHaveBeenCalledTimes(1)
  })

  // ── displayName ───────────────────────────────────────────────────────────

  it('VoiceForm.displayName is "VoiceForm"', () => {
    expect(VoiceForm.displayName).toBe('VoiceForm')
  })

  // ── Callback chaining ─────────────────────────────────────────────────────

  it('calls both onDone prop and events.onDone when both are provided', () => {
    const onDoneProp = vi.fn()
    const onDoneConfig = vi.fn()
    const mockResult: InjectionResult = { success: true, fields: {} }

    // We need to capture the config passed to createVoiceForm to extract merged events
    let capturedConfig: VoiceFormConfig | null = null
    mockCreateVoiceForm.mockImplementation((cfg: VoiceFormConfig) => {
      capturedConfig = cfg
      return mockInstance
    })

    render(
      <VoiceForm
        {...minimalConfig}
        onDone={onDoneProp}
        events={{ onDone: onDoneConfig }}
      />,
    )

    // Simulate onDone being called through the merged config
    expect(capturedConfig).not.toBeNull()
    capturedConfig!.events?.onDone?.(mockResult)

    expect(onDoneConfig).toHaveBeenCalledWith(mockResult)
    expect(onDoneProp).toHaveBeenCalledWith(mockResult)
  })

  it('calls both onError prop and events.onError when both are provided', () => {
    const onErrorProp = vi.fn()
    const onErrorConfig = vi.fn()
    const mockError: VoiceFormError = {
      code: 'UNKNOWN',
      message: 'test error',
      recoverable: true,
    }

    let capturedConfig: VoiceFormConfig | null = null
    mockCreateVoiceForm.mockImplementation((cfg: VoiceFormConfig) => {
      capturedConfig = cfg
      return mockInstance
    })

    render(
      <VoiceForm
        {...minimalConfig}
        onError={onErrorProp}
        events={{ onError: onErrorConfig }}
      />,
    )

    capturedConfig!.events?.onError?.(mockError)

    expect(onErrorConfig).toHaveBeenCalledWith(mockError)
    expect(onErrorProp).toHaveBeenCalledWith(mockError)
  })

  // ── StrictMode ────────────────────────────────────────────────────────────

  it('works correctly in React StrictMode', () => {
    const instances: MockInstance[] = []
    mockCreateVoiceForm.mockImplementation(() => {
      const inst = makeMockInstance()
      instances.push(inst)
      return inst
    })

    const { unmount } = render(
      <StrictMode>
        <VoiceForm {...minimalConfig} />
      </StrictMode>,
    )

    // StrictMode double-invokes — at least one instance was created
    expect(instances.length).toBeGreaterThanOrEqual(1)

    // The component should still render a button
    const btn = screen.getByRole('button')
    expect(btn).toBeDefined()

    // Final unmount destroys the surviving instance
    unmount()
    const lastInstance = instances[instances.length - 1]!
    expect(lastInstance.destroy).toHaveBeenCalledTimes(1)
  })
})
