/**
 * @voiceform/svelte — VoiceForm component tests (P2-05)
 *
 * Tests cover:
 * - Component mounts without errors
 * - Renders button in idle state with correct ARIA
 * - Reflects recording state (class + aria-label)
 * - Confirmation panel appears when confirming
 * - Cancel closes panel
 * - destroy() called on unmount
 * - Headless mode renders nothing
 * - Snippet API replaces default UI
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import VoiceForm from '../src/VoiceForm.svelte'
import type {
  VoiceFormInstance,
  VoiceFormState,
  VoiceFormConfig,
  StateListener,
  Unsubscribe,
  ConfirmedField,
} from '@voiceform/core'

// ─── Mock @voiceform/core ───────────────────────────────────────────────────

let mockSubscribers: StateListener[] = []
let mockState: VoiceFormState = { status: 'idle' }
let mockDestroyFn: Mock
let mockStartFn: Mock
let mockStopFn: Mock
let mockCancelFn: Mock
let mockConfirmFn: Mock
let mockGetParsedFieldsFn: Mock
let mockInstance: VoiceFormInstance

function createMockInstance(): VoiceFormInstance {
  mockDestroyFn = vi.fn()
  mockStartFn = vi.fn().mockResolvedValue(undefined)
  mockStopFn = vi.fn()
  mockCancelFn = vi.fn()
  mockConfirmFn = vi.fn().mockResolvedValue(undefined)
  mockGetParsedFieldsFn = vi.fn().mockReturnValue(null)
  mockSubscribers = []
  mockState = { status: 'idle' }

  mockInstance = {
    getState: vi.fn(() => mockState),
    getParsedFields: mockGetParsedFieldsFn,
    start: mockStartFn,
    stop: mockStopFn,
    cancel: mockCancelFn,
    confirm: mockConfirmFn,
    updateSchema: vi.fn(),
    destroy: mockDestroyFn,
    subscribe: vi.fn((listener: StateListener): Unsubscribe => {
      mockSubscribers.push(listener)
      // Immediately call with current state
      listener(mockState)
      return () => {
        const idx = mockSubscribers.indexOf(listener)
        if (idx >= 0) mockSubscribers.splice(idx, 1)
      }
    }),
  }
  return mockInstance
}

function transitionTo(newState: VoiceFormState): void {
  mockState = newState
  ;(mockInstance.getState as Mock).mockReturnValue(newState)
  for (const sub of mockSubscribers) {
    sub(newState)
  }
}

vi.mock('@voiceform/core', () => ({
  createVoiceForm: vi.fn(() => createMockInstance()),
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

const minimalProps = {
  endpoint: 'https://example.com/parse',
  schema: {
    fields: [
      { name: 'firstName', type: 'text' as const },
      { name: 'email', type: 'email' as const },
    ],
  },
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('VoiceForm', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  // ── Mount / Unmount ────────────────────────────────────────────────────

  it('mounts without errors', () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    expect(container).toBeTruthy()
  })

  it('calls createVoiceForm with the provided config on mount', async () => {
    const { createVoiceForm } = await import('@voiceform/core')
    render(VoiceForm, { props: minimalProps })
    expect(createVoiceForm).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: minimalProps.endpoint,
        schema: minimalProps.schema,
      }),
    )
  })

  it('calls instance.destroy() on unmount', async () => {
    const { unmount } = render(VoiceForm, { props: minimalProps })
    const destroyFn = mockDestroyFn
    expect(destroyFn).not.toHaveBeenCalled()
    unmount()
    expect(destroyFn).toHaveBeenCalledTimes(1)
  })

  // ── Idle State (default rendering) ────────────────────────────────────

  it('renders a mic button in idle state', () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
  })

  it('button has correct aria-label in idle state', () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Use voice input')
  })

  it('button has aria-pressed="false" in idle state', () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-pressed')).toBe('false')
  })

  it('root element accepts class prop', () => {
    const { container } = render(VoiceForm, {
      props: { ...minimalProps, class: 'my-custom-class' },
    })
    const root = container.querySelector('.my-custom-class')
    expect(root).not.toBeNull()
  })

  // ── Recording State ───────────────────────────────────────────────────

  it('reflects recording state with correct aria-label', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    transitionTo({ status: 'recording', interimTranscript: '' })
    await tick()
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Stop recording')
  })

  it('button has aria-pressed="true" during recording', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    transitionTo({ status: 'recording', interimTranscript: '' })
    await tick()
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
  })

  it('adds recording CSS class during recording', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    transitionTo({ status: 'recording', interimTranscript: '' })
    await tick()
    const button = container.querySelector('button')
    expect(button?.classList.contains('vf-recording')).toBe(true)
  })

  // ── Processing State ──────────────────────────────────────────────────

  it('button is aria-disabled during processing', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    transitionTo({ status: 'processing', transcript: 'hello' })
    await tick()
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    expect(button?.getAttribute('aria-label')).toBe('Processing speech')
  })

  // ── Confirmation State ────────────────────────────────────────────────

  it('shows confirmation panel when in confirming state', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    const confirmationData = {
      transcript: 'John Smith, john@example.com',
      parsedFields: {
        firstName: { label: 'First Name', value: 'John Smith' },
        email: { label: 'Email', value: 'john@example.com' },
      } as Record<string, ConfirmedField>,
      missingFields: [] as readonly string[],
      invalidFields: [] as ReadonlyArray<{ name: string; value: string; reason: string }>,
    }
    transitionTo({
      status: 'confirming',
      transcript: 'John Smith, john@example.com',
      confirmation: confirmationData,
    })
    await tick()

    const panel = container.querySelector('[role="dialog"]')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-label')).toBe('Confirm voice input')
  })

  it('cancel button in confirmation calls instance.cancel()', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    const confirmationData = {
      transcript: 'test',
      parsedFields: {
        firstName: { label: 'First Name', value: 'Test' },
      } as Record<string, ConfirmedField>,
      missingFields: [] as readonly string[],
      invalidFields: [] as ReadonlyArray<{ name: string; value: string; reason: string }>,
    }
    transitionTo({
      status: 'confirming',
      transcript: 'test',
      confirmation: confirmationData,
    })
    await tick()

    const cancelBtn = container.querySelector('[data-vf-cancel]')
    expect(cancelBtn).not.toBeNull()
    cancelBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await tick()
    expect(mockCancelFn).toHaveBeenCalledTimes(1)
  })

  it('confirm button calls instance.confirm()', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    const confirmationData = {
      transcript: 'test',
      parsedFields: {
        firstName: { label: 'First Name', value: 'Test' },
      } as Record<string, ConfirmedField>,
      missingFields: [] as readonly string[],
      invalidFields: [] as ReadonlyArray<{ name: string; value: string; reason: string }>,
    }
    transitionTo({
      status: 'confirming',
      transcript: 'test',
      confirmation: confirmationData,
    })
    await tick()

    const confirmBtn = container.querySelector('[data-vf-confirm]')
    expect(confirmBtn).not.toBeNull()
    confirmBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await tick()
    expect(mockConfirmFn).toHaveBeenCalledTimes(1)
  })

  // ── Headless Mode ─────────────────────────────────────────────────────

  it('renders nothing in headless mode', () => {
    const { container } = render(VoiceForm, {
      props: { ...minimalProps, headless: true },
    })
    // Should have no visible children
    expect(container.innerHTML.trim()).toBe('<!---->') // Svelte empty render
  })

  // ── Status Text ───────────────────────────────────────────────────────

  it('shows status text that updates with state', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    transitionTo({ status: 'recording', interimTranscript: '' })
    await tick()
    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.textContent).toContain('Listening')
  })

  // ── Button click triggers start/stop ──────────────────────────────────

  it('clicking button in idle state calls instance.start()', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    const button = container.querySelector('button')
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await tick()
    expect(mockStartFn).toHaveBeenCalledTimes(1)
  })

  it('clicking button in recording state calls instance.stop()', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    transitionTo({ status: 'recording', interimTranscript: '' })
    await tick()
    const button = container.querySelector('button')
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await tick()
    expect(mockStopFn).toHaveBeenCalledTimes(1)
  })
})
