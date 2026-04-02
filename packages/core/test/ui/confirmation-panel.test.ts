// @vitest-environment jsdom
/**
 * Unit tests for packages/core/src/ui/confirmation-panel.ts
 *
 * TDD red phase: tests written before implementation exists.
 * Tests verify DOM structure, security constraints (textContent only),
 * ARIA attributes, focus management, event handling, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountConfirmationPanel } from '../../src/ui/confirmation-panel.js'
import type {
  VoiceFormInstance,
  VoiceFormState,
  VoiceFormStrings,
  ConfirmedField,
  StateListener,
} from '../../src/types.js'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Local alias for the parsed fields map used by the confirmation panel.
 * Each field may carry an optional wasModified flag for sanitization warning display.
 */
type ParsedFields = Record<string, ConfirmedField & { wasModified?: boolean }>

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeStrings(): VoiceFormStrings {
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
  }
}

function makeInstance(): VoiceFormInstance & {
  _listeners: Set<StateListener>
  _simulateState(state: VoiceFormState): void
} {
  let state: VoiceFormState = { status: 'idle' }
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

function makeFields(overrides: Partial<ParsedFields> = {}): ParsedFields {
  return {
    firstName: { label: 'First name', value: 'Jordan' },
    email: { label: 'Email', value: 'jordan@example.com' },
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mountConfirmationPanel', () => {
  let anchor: HTMLElement
  let instance: ReturnType<typeof makeInstance>
  let strings: VoiceFormStrings

  beforeEach(() => {
    anchor = document.createElement('button')
    anchor.type = 'button'
    anchor.textContent = 'mic'
    document.body.appendChild(anchor)
    instance = makeInstance()
    strings = makeStrings()
  })

  afterEach(() => {
    anchor.remove()
    // Clean up any panels left in DOM
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove())
  })

  // ── Return value ─────────────────────────────────────────────────────────

  it('returns an unmount function', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    expect(typeof unmount).toBe('function')
    unmount()
  })

  // ── Deferred DOM construction ─────────────────────────────────────────────

  it('does NOT render panel DOM immediately at init time', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    // Panel should not be in DOM until confirming state
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toBeNull()
    unmount()
  })

  it('renders the panel on first confirming state transition', () => {
    const fields = makeFields()
    const unmount = mountConfirmationPanel(anchor, instance, fields, strings)

    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: {
          firstName: { label: 'First name', value: 'Jordan' },
        },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    unmount()
  })

  it('hides the panel when state leaves confirming', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)

    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    // Panel is visible
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    // Move to idle
    instance._simulateState({ status: 'idle' })

    // Panel should be hidden (either removed or display:none)
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog) {
      const style = window.getComputedStyle(dialog as HTMLElement)
      const isHidden =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        (dialog as HTMLElement).hidden === true ||
        !(dialog as HTMLElement).isConnected
      expect(isHidden).toBe(true)
    }
    unmount()
  })

  // ── ARIA attributes ──────────────────────────────────────────────────────

  it('renders panel with role="dialog"', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    unmount()
  })

  it('renders panel with aria-label from strings', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })
    const dialog = document.querySelector('[role="dialog"]')
    // aria-label should be set from strings (e.g., "Confirm voice input" or confirm.title)
    const ariaLabel = dialog?.getAttribute('aria-label')
    expect(ariaLabel).toBeTruthy()
    unmount()
  })

  it('renders aria-modal="false" on the dialog', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('false')
    unmount()
  })

  // ── Field rendering ──────────────────────────────────────────────────────

  it('renders a <dl> element for field list', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })
    const dl = document.querySelector('dl')
    expect(dl).not.toBeNull()
    unmount()
  })

  it('renders <dt> for field label and <dd> for field value', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: {
          firstName: { label: 'First name', value: 'Jordan' },
          email: { label: 'Email', value: 'jordan@example.com' },
        },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })
    const dts = document.querySelectorAll('dt')
    const dds = document.querySelectorAll('dd')
    expect(dts.length).toBeGreaterThanOrEqual(2)
    expect(dds.length).toBeGreaterThanOrEqual(2)
    unmount()
  })

  // ── SECURITY: textContent only ───────────────────────────────────────────

  it('renders field values using textContent, not innerHTML (XSS protection)', () => {
    const maliciousValue = '<script>alert("xss")</script>'
    const unmount = mountConfirmationPanel(
      anchor,
      instance,
      { name: { label: 'Name', value: maliciousValue } },
      strings,
    )
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { name: { label: 'Name', value: maliciousValue } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    // The <script> tag must NOT be present as a DOM element
    const scripts = document.querySelectorAll('script')
    // Filter out any script tags that were there before (none expected, but defensive)
    const injectedScripts = Array.from(scripts).filter(
      (s) => s.textContent === 'alert("xss")',
    )
    expect(injectedScripts.length).toBe(0)

    // The literal text including angle brackets should appear as plain text
    const dd = document.querySelector('dd')
    if (dd) {
      // textContent should equal the malicious string literally (as text, not parsed HTML)
      expect(dd.textContent).toContain('script')
    }
    unmount()
  })

  it('does not parse HTML entities from field values', () => {
    const value = '<b>bold</b>'
    const unmount = mountConfirmationPanel(
      anchor,
      instance,
      { name: { label: 'Name', value: value } },
      strings,
    )
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { name: { label: 'Name', value: value } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    // There should be no <b> element injected from LLM output
    const boldTags = document.querySelectorAll('b')
    // Any bold elements should be from panel chrome, not from field values
    // Check that no dd contains a <b> child element
    const dds = document.querySelectorAll('dd')
    dds.forEach((dd) => {
      expect(dd.querySelector('b')).toBeNull()
    })
    unmount()
  })

  // ── wasModified warning ──────────────────────────────────────────────────

  it('shows a sanitization warning icon when wasModified is true', () => {
    const unmount = mountConfirmationPanel(
      anchor,
      instance,
      { name: { label: 'Name', value: 'Jordan', wasModified: true } },
      strings,
    )
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { name: { label: 'Name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const warningEl = document.querySelector('.vf-sanitized-warning')
    expect(warningEl).not.toBeNull()
    unmount()
  })

  it('sanitization warning has correct aria-label', () => {
    const unmount = mountConfirmationPanel(
      anchor,
      instance,
      { name: { label: 'Name', value: 'Jordan', wasModified: true } },
      strings,
    )
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { name: { label: 'Name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const warningEl = document.querySelector('.vf-sanitized-warning')
    expect(warningEl?.getAttribute('aria-label')).toBe('Value was modified — HTML was removed')
    unmount()
  })

  it('does not show sanitization warning when wasModified is false', () => {
    const unmount = mountConfirmationPanel(
      anchor,
      instance,
      { name: { label: 'Name', value: 'Jordan', wasModified: false } },
      strings,
    )
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { name: { label: 'Name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const warningEl = document.querySelector('.vf-sanitized-warning')
    expect(warningEl).toBeNull()
    unmount()
  })

  // ── Unrecognized fields ──────────────────────────────────────────────────

  it('renders "Not understood" badge for missing fields', () => {
    const unmount = mountConfirmationPanel(
      anchor,
      instance,
      {
        firstName: { label: 'First name', value: 'Jordan' },
        phone: { label: 'Phone', value: '' },
      },
      strings,
    )
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: ['phone'],
        invalidFields: [],
        appendMode: false,
      },
    })

    const badge = document.querySelector('.vf-unrecognized-badge')
    expect(badge).not.toBeNull()
    unmount()
  })

  it('unrecognized badge has correct aria-label', () => {
    const unmount = mountConfirmationPanel(
      anchor,
      instance,
      { firstName: { label: 'First name', value: 'Jordan' } },
      strings,
    )
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: {},
        missingFields: ['firstName'],
        invalidFields: [],
        appendMode: false,
      },
    })

    const badge = document.querySelector('.vf-unrecognized-badge')
    expect(badge?.getAttribute('aria-label')).toBe(
      'Not understood — this field will not be filled',
    )
    unmount()
  })

  // ── Buttons ──────────────────────────────────────────────────────────────

  it('renders a "Fill form" button', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const buttons = Array.from(document.querySelectorAll('button'))
    const fillBtn = buttons.find(
      (b) => b.textContent?.trim() === 'Fill form' || b.getAttribute('aria-label')?.includes('fill'),
    )
    expect(fillBtn).toBeDefined()
    unmount()
  })

  it('renders a "Cancel" button', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const buttons = Array.from(document.querySelectorAll('button'))
    const cancelBtn = buttons.find(
      (b) =>
        b.textContent?.trim() === 'Cancel' ||
        b.getAttribute('aria-label')?.toLowerCase().includes('cancel'),
    )
    expect(cancelBtn).toBeDefined()
    unmount()
  })

  it('calls instance.confirm() when Fill form button is clicked', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const buttons = Array.from(document.querySelectorAll('button'))
    const fillBtn = buttons.find(
      (b) =>
        b.textContent?.trim() === 'Fill form' ||
        b.getAttribute('aria-label')?.includes('fill') ||
        b.getAttribute('aria-label')?.includes('Accept'),
    )
    fillBtn?.click()
    expect(instance.confirm).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('calls instance.cancel() when Cancel button is clicked', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const buttons = Array.from(document.querySelectorAll('button'))
    const cancelBtn = buttons.find(
      (b) =>
        b.textContent?.trim() === 'Cancel' ||
        b.getAttribute('aria-label')?.toLowerCase().includes('cancel'),
    )
    cancelBtn?.click()
    expect(instance.cancel).toHaveBeenCalledTimes(1)
    unmount()
  })

  // ── Escape key ───────────────────────────────────────────────────────────

  it('calls instance.cancel() on Escape key when panel is open', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(instance.cancel).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('does not call cancel on Escape when panel is not open', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    // Panel has never opened
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(instance.cancel).not.toHaveBeenCalled()
    unmount()
  })

  // ── Title ────────────────────────────────────────────────────────────────

  it('renders the panel title from strings.confirm.title', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    expect(document.body.textContent).toContain('What I heard')
    unmount()
  })

  // ── Unmount / cleanup ────────────────────────────────────────────────────

  it('removes all DOM nodes on unmount', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    unmount()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('removes Escape key listener on unmount', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    unmount()
    // After unmount, Escape should NOT trigger cancel
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(instance.cancel).not.toHaveBeenCalled()
  })

  it('unsubscribes from instance on unmount', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)
    expect(instance._listeners.size).toBe(1)
    unmount()
    expect(instance._listeners.size).toBe(0)
  })

  // ── Escape key double-registration guard ─────────────────────────────────

  it('fires cancel exactly once on Escape even if showPanel was called twice in succession (N-7)', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)

    const confirmingState: VoiceFormState = {
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    }

    // Simulate two consecutive confirming transitions without a hide in between
    instance._simulateState(confirmingState)
    instance._simulateState(confirmingState)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    // cancel() must fire exactly once — not twice from a double-registered listener
    expect(instance.cancel).toHaveBeenCalledTimes(1)
    unmount()
  })

  // ── DOM reuse on subsequent confirming states ─────────────────────────────

  it('reuses the panel DOM for subsequent confirming states', () => {
    const unmount = mountConfirmationPanel(anchor, instance, makeFields(), strings)

    instance._simulateState({
      status: 'confirming',
      transcript: 'hello',
      confirmation: {
        transcript: 'hello',
        parsedFields: { firstName: { label: 'First name', value: 'Jordan' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const firstDialog = document.querySelector('[role="dialog"]')

    // Close
    instance._simulateState({ status: 'idle' })

    // Open again with new data
    instance._simulateState({
      status: 'confirming',
      transcript: 'hello again',
      confirmation: {
        transcript: 'hello again',
        parsedFields: { firstName: { label: 'First name', value: 'Alex' } },
        missingFields: [],
        invalidFields: [],
        appendMode: false,
      },
    })

    const secondDialog = document.querySelector('[role="dialog"]')

    // Same DOM node should be reused (or a new one appended — either is valid)
    // What matters is: only one dialog at a time, and it shows new data
    const allDialogs = document.querySelectorAll('[role="dialog"]')
    expect(allDialogs.length).toBe(1)
    unmount()
  })
})
