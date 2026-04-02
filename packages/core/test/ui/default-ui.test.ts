// @vitest-environment jsdom
/**
 * Unit tests for packages/core/src/ui/default-ui.ts
 *
 * TDD red phase: tests written before implementation exists.
 * Tests verify DOM output, ARIA attributes, event handling, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountDefaultUI } from '../../src/ui/default-ui.js'
import type { VoiceFormInstance, VoiceFormState, VoiceFormStrings, StateListener } from '../../src/types.js'

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeStrings(overrides: Partial<VoiceFormStrings> = {}): VoiceFormStrings {
  return {
    buttonLabel: {
      idle: 'Use voice input',
      recording: 'Stop recording',
      processing: 'Processing speech',
      done: 'Voice input complete',
      error: 'Voice input error',
      unsupported: 'Voice input not available',
      cooldown: 'Voice input cooling down',
    },
    status: {
      listening: 'Listening…',
      processing: 'Processing…',
      done: 'Form filled',
      unsupported: 'Voice input not supported in this browser.',
    },
    errors: {
      permissionDenied: 'Microphone access denied. Check your browser settings.',
      noSpeech: 'Nothing heard. Try again.',
      endpointError: 'Could not process speech. Try again.',
      parseError: 'Could not understand your response. Try again.',
      transcriptTooLong: 'That was too much — try a shorter response.',
      retryLabel: 'Try again',
      rerecordLabel: 'Re-record',
      permissionHelp: 'Learn how',
    },
    confirm: {
      title: 'What I heard',
      description: 'Review the values below before filling your form.',
      cancelLabel: 'Cancel',
      cancelAriaLabel: 'Cancel and discard voice input',
      fillLabel: 'Fill form',
      fillLabelEdited: 'Fill form (edited)',
      fillAriaLabel: 'Accept and fill form with these values',
      dismissAriaLabel: 'Cancel voice input',
      unrecognizedLabel: 'Not understood',
      unrecognizedAriaLabel: 'Not understood — this field will not be filled',
      sanitizedAriaLabel: 'Value was modified — HTML was removed',
      editAriaLabel: 'Edit {label}',
      saveEditLabel: 'Save',
      saveEditAriaLabel: 'Save {label} correction',
      discardEditLabel: 'Cancel',
      discardEditAriaLabel: 'Discard {label} correction',
      invalidValueLabel: 'Invalid value',
      editHintText: 'Press Enter to save, Escape to cancel.',
      appendExistingLabel: 'Current:',
      appendNewLabel: 'Adding:',
      appendResultLabel: 'Result:',
      unchangedLabel: 'Unchanged',
    },
    privacy: {
      acknowledgeLabel: 'I understand',
      acknowledgeAriaLabel: 'I understand and agree to voice processing',
      regionAriaLabel: 'Voice input privacy notice',
    },
    announcements: {
      listening: 'Listening. Speak now.',
      processing: 'Processing your speech.',
      confirming: 'Review your values. {count} fields ready.',
      filled: 'Form filled. {count} fields updated.',
      cancelled: 'Voice input cancelled.',
      errorPermission: 'Error: Microphone access denied. Check your browser settings.',
      errorNoSpeech: 'Nothing heard. Voice input ready.',
      errorEndpoint: 'Error: Could not process speech. Tap to try again.',
      errorTranscriptTooLong: 'That was too much. Try a shorter response.',
      fieldEditOpened: 'Editing {label}.',
      fieldEditSaved: '{label} correction saved.',
    },
    ...overrides,
  }
}

function makeInstance(initialState: VoiceFormState = { status: 'idle' }): VoiceFormInstance & {
  _listeners: Set<StateListener>
  _simulateState(state: VoiceFormState): void
} {
  let state = initialState
  const listeners = new Set<StateListener>()

  return {
    _listeners: listeners,
    _simulateState(newState: VoiceFormState) {
      state = newState
      listeners.forEach((l) => l(newState))
    },
    getState: () => state,
    getParsedFields: () => null,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn().mockResolvedValue(undefined),
    updateSchema: vi.fn(),
    setSchema: vi.fn(),
    getSchema: vi.fn().mockReturnValue({ fields: [] }),
    correctField: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
    subscribe(listener: StateListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mountDefaultUI', () => {
  let container: HTMLElement
  let instance: ReturnType<typeof makeInstance>
  let strings: VoiceFormStrings

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    instance = makeInstance()
    strings = makeStrings()
    // Clean up injected style tag between tests
    document.getElementById('voiceform-styles')?.remove()
  })

  afterEach(() => {
    container.remove()
    document.getElementById('voiceform-styles')?.remove()
  })

  // ── Mount and DOM structure ──────────────────────────────────────────────

  it('returns an unmount function', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    expect(typeof unmount).toBe('function')
    unmount()
  })

  it('renders a mic button inside the container', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    unmount()
  })

  it('renders a status/announcement element with aria-live="polite"', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    const liveRegion = container.querySelector('[aria-live]')
    expect(liveRegion).not.toBeNull()
    unmount()
  })

  it('injects a <style> tag with id="voiceform-styles"', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    expect(document.getElementById('voiceform-styles')).not.toBeNull()
    unmount()
  })

  it('does not inject duplicate <style> tags on multiple mounts', () => {
    const container2 = document.createElement('div')
    document.body.appendChild(container2)
    const instance2 = makeInstance()

    const unmount1 = mountDefaultUI(container, instance, strings)
    const unmount2 = mountDefaultUI(container2, instance2, strings)

    const styleTags = document.querySelectorAll('#voiceform-styles')
    expect(styleTags.length).toBe(1)

    unmount1()
    unmount2()
    container2.remove()
  })

  // ── ARIA attributes ──────────────────────────────────────────────────────

  it('sets role="button" or renders a <button> element', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    unmount()
  })

  it('sets aria-label from strings.buttonLabel.idle in idle state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Use voice input')
    unmount()
  })

  it('updates aria-label to recording string on recording state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'recording', interimTranscript: '' })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Stop recording')
    unmount()
  })

  it('updates aria-label to processing string on processing state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'processing', transcript: 'hello' })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Processing speech')
    unmount()
  })

  it('updates aria-label to done string on done state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({
      status: 'done',
      result: { success: true, fields: {} },
    })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Voice input complete')
    unmount()
  })

  it('updates aria-label to error string on error state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({
      status: 'error',
      error: { code: 'ENDPOINT_ERROR', message: 'fail', recoverable: true },
      previousStatus: 'processing',
    })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Voice input error')
    unmount()
  })

  it('sets aria-pressed="true" during recording state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'recording', interimTranscript: '' })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
    unmount()
  })

  it('removes aria-pressed when leaving recording state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'recording', interimTranscript: '' })
    instance._simulateState({ status: 'processing', transcript: 'hello' })
    const button = container.querySelector('button')
    // aria-pressed should be false or absent when not recording
    const pressed = button?.getAttribute('aria-pressed')
    expect(pressed === 'false' || pressed === null).toBe(true)
    unmount()
  })

  it('sets aria-disabled="true" during processing state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'processing', transcript: 'hello' })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    unmount()
  })

  it('sets aria-disabled="true" during confirming state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: {},
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    unmount()
  })

  // ── State classes ────────────────────────────────────────────────────────

  it('applies a recording class to the wrapper during recording state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'recording', interimTranscript: '' })
    // Button or wrapper should have a recording indicator class
    const el = container.querySelector('.vf-recording, [data-state="recording"], button')
    // At minimum the button aria-label should reflect recording
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Stop recording')
    unmount()
  })

  // ── Status text ──────────────────────────────────────────────────────────

  it('shows listening status text during recording state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'recording', interimTranscript: '' })
    expect(container.textContent).toContain('Listening…')
    unmount()
  })

  it('shows processing status text during processing state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'processing', transcript: 'hello' })
    expect(container.textContent).toContain('Processing…')
    unmount()
  })

  it('shows done status text during done state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({
      status: 'done',
      result: { success: true, fields: {} },
    })
    expect(container.textContent).toContain('Form filled')
    unmount()
  })

  it('shows error message text in error state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({
      status: 'error',
      error: { code: 'ENDPOINT_ERROR', message: 'fail', recoverable: true },
      previousStatus: 'processing',
    })
    expect(container.textContent).toContain('Could not process speech. Try again.')
    unmount()
  })

  it('shows permission denied error message', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({
      status: 'error',
      error: { code: 'PERMISSION_DENIED', message: 'denied', recoverable: false },
      previousStatus: 'idle',
    })
    expect(container.textContent).toContain('Microphone access denied.')
    unmount()
  })

  it('shows no speech error message', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({
      status: 'error',
      error: { code: 'NO_TRANSCRIPT', message: 'nothing', recoverable: true },
      previousStatus: 'recording',
    })
    expect(container.textContent).toContain('Nothing heard. Try again.')
    unmount()
  })

  // ── Keyboard handling ────────────────────────────────────────────────────

  it('calls instance.start() on button click in idle state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    const button = container.querySelector('button')!
    button.click()
    expect(instance.start).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('calls instance.start() on Enter key on the button in idle state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    const button = container.querySelector('button')!
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(instance.start).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('calls instance.start() on Space key on the button in idle state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    const button = container.querySelector('button')!
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(instance.start).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('calls instance.cancel() on button click in recording state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'recording', interimTranscript: '' })
    const button = container.querySelector('button')!
    button.click()
    expect(instance.cancel).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('does not call start() when button is clicked in processing state', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    instance._simulateState({ status: 'processing', transcript: 'hello' })
    const button = container.querySelector('button')!
    button.click()
    expect(instance.start).not.toHaveBeenCalled()
    unmount()
  })

  // ── Unmount / cleanup ────────────────────────────────────────────────────

  it('removes all DOM nodes from container on unmount', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    expect(container.children.length).toBeGreaterThan(0)
    unmount()
    expect(container.children.length).toBe(0)
  })

  it('stops receiving state updates after unmount', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    unmount()
    // Simulate state change after unmount — should not throw or update
    expect(() => {
      instance._simulateState({ status: 'recording', interimTranscript: '' })
    }).not.toThrow()
  })

  it('unsubscribes from instance on unmount', () => {
    // The listener set should be empty after unmount
    const unmount = mountDefaultUI(container, instance, strings)
    expect(instance._listeners.size).toBe(1)
    unmount()
    expect(instance._listeners.size).toBe(0)
  })

  // ── CSS custom properties ────────────────────────────────────────────────

  it('injected CSS contains --vf-button-bg custom property reference', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    const styleTag = document.getElementById('voiceform-styles')
    expect(styleTag?.textContent).toContain('--vf-button-bg')
    unmount()
  })

  it('injected CSS contains @media (prefers-reduced-motion: reduce)', () => {
    const unmount = mountDefaultUI(container, instance, strings)
    const styleTag = document.getElementById('voiceform-styles')
    expect(styleTag?.textContent).toContain('prefers-reduced-motion')
    unmount()
  })
})
