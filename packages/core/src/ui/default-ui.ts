/**
 * @voiceform/core — Default UI renderer (framework-agnostic)
 *
 * Renders a mic button + status region into any HTMLElement container.
 * Subscribes to VoiceFormInstance state changes and updates the DOM reactively.
 *
 * Design notes:
 *  - All CSS is injected once via a deduplicated <style id="voiceform-styles"> tag.
 *  - CSS uses only --vf-* custom properties (no hardcoded colours).
 *  - @media (prefers-reduced-motion: reduce) disables all animations.
 *  - All ARIA attributes are managed here and updated on every state transition.
 *  - All user-facing strings come from the VoiceFormStrings argument.
 *  - Returns an unmount() function that removes DOM, event listeners, and the
 *    state subscription.
 *
 * Security: icon SVG constants below are static, authored in this file only,
 * and are never interpolated with user-supplied data. They are safe for
 * button.innerHTML assignment. User-facing strings are always assigned via
 * .textContent — never via innerHTML.
 *
 * Canonical spec: docs/UX_SPEC.md section 4, 8, 9.2 / docs/TASKS.md P1-09
 */

import type { VoiceFormInstance, VoiceFormState, VoiceFormStrings } from '../types.js'

// ─── SVG Icon Constants ───────────────────────────────────────────────────────
// These are static, hardcoded SVG strings. They are never interpolated with
// user data. Assigning them via innerHTML is intentional and safe.

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
const ICON_MIC =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
  'width="20" height="20">' +
  '<rect x="9" y="2" width="6" height="12" rx="3"/>' +
  '<path d="M5 10a7 7 0 0 0 14 0"/>' +
  '<line x1="12" y1="17" x2="12" y2="22"/>' +
  '<line x1="8" y1="22" x2="16" y2="22"/>' +
  '</svg>'

const ICON_SPINNER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" aria-hidden="true" focusable="false" ' +
  'width="20" height="20" class="vf-spinner-icon">' +
  '<circle cx="12" cy="12" r="9" stroke-dasharray="40" stroke-dashoffset="10"/>' +
  '</svg>'

const ICON_CHECKMARK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
  'width="20" height="20">' +
  '<polyline points="4 12 9 17 20 7"/>' +
  '</svg>'

const ICON_WARNING =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
  'width="20" height="20">' +
  '<circle cx="12" cy="12" r="10"/>' +
  '<line x1="12" y1="8" x2="12" y2="13"/>' +
  '<circle cx="12" cy="16.5" r="0.5" fill="currentColor" stroke="none"/>' +
  '</svg>'
/* eslint-enable @typescript-eslint/no-unsafe-assignment */

// ─── Injected CSS ─────────────────────────────────────────────────────────────

const VOICEFORM_CSS =
  '/* voice-form default UI styles */' +
  '.vf-root{position:relative;display:inline-flex;flex-direction:column;align-items:center;gap:6px;font-family:var(--vf-button-font-family,inherit)}' +
  '.vf-mic-button{position:relative;display:inline-flex;align-items:center;justify-content:center;width:var(--vf-button-size,40px);height:var(--vf-button-size,40px);min-width:48px;min-height:48px;border-radius:var(--vf-button-radius,50%);background:var(--vf-button-bg,#f3f4f6);border:1px solid var(--vf-button-border,#d1d5db);color:var(--vf-button-icon-color,#374151);cursor:pointer;outline:none;transition:background 150ms ease,border-color 150ms ease;box-sizing:border-box;font-size:var(--vf-button-font-size,14px);overflow:visible}' +
  '.vf-mic-button:hover:not([aria-disabled="true"]){background:var(--vf-button-hover-bg,#e5e7eb);border-color:var(--vf-button-hover-border,#9ca3af)}' +
  '.vf-mic-button:focus-visible{outline:3px solid var(--vf-button-focus-ring,#3b82f6);outline-offset:2px}' +
  '.vf-mic-button[aria-disabled="true"]{cursor:not-allowed;background:var(--vf-button-bg-disabled,#f9fafb);color:var(--vf-button-icon-color-disabled,#9ca3af);opacity:0.7}' +
  '.vf-mic-button[data-state="recording"]{background:var(--vf-recording-bg,#ef4444);border:none;color:var(--vf-recording-icon-color,#ffffff)}' +
  '.vf-pulse-ring{position:absolute;inset:-4px;border-radius:50%;background:var(--vf-recording-ring-color,rgba(239,68,68,0.4));animation:vf-pulse 1.5s ease-out infinite;pointer-events:none;z-index:-1}' +
  '@keyframes vf-pulse{0%{transform:scale(1);opacity:0.6}100%{transform:scale(var(--vf-recording-ring-size,1.6));opacity:0}}' +
  '.vf-mic-button[data-state="processing"]{background:var(--vf-button-bg,#f3f4f6);color:var(--vf-processing-spinner-color,#6b7280)}' +
  '.vf-spinner-icon{animation:vf-spin 0.75s linear infinite}' +
  '@keyframes vf-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}' +
  '.vf-mic-button[data-state="done"]{background:var(--vf-success-bg,#22c55e);border:none;color:var(--vf-success-icon-color,#ffffff);transition:background 150ms ease-in}' +
  '.vf-mic-button[data-state="error"]{background:var(--vf-error-bg,#fef2f2);border-color:var(--vf-error-border,#fca5a5);color:var(--vf-error-icon-color,#dc2626)}' +
  '.vf-status{font-size:0.75rem;color:inherit;text-align:center;min-height:1.2em}' +
  '.vf-status[data-error="true"]{color:var(--vf-error-text-color,#991b1b)}' +
  '.vf-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
  '.vf-announcer{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;pointer-events:none}' +
  '.vf-privacy-notice{background:var(--vf-privacy-bg,#f9fafb);border:1px solid var(--vf-privacy-border,#e5e7eb);border-radius:var(--vf-privacy-radius,6px);color:var(--vf-privacy-text-color,#111827);padding:12px;font-size:0.8125rem;max-width:var(--vf-panel-max-width,420px);min-width:var(--vf-panel-min-width,280px);margin-top:8px}' +
  '@media (prefers-reduced-motion:reduce){' +
  '.vf-pulse-ring{animation:none;transform:scale(1);opacity:0.4;border:2px solid var(--vf-recording-ring-color,rgba(239,68,68,0.4));background:transparent}' +
  '.vf-spinner-icon{animation:none}' +
  '.vf-mic-button[data-state="done"]{transition:none}' +
  '}'

// ─── Unique instance ID generator ─────────────────────────────────────────────

let _uidCounter = 0
function nextUid(): string {
  _uidCounter += 1
  return `vf-${_uidCounter}`
}

// ─── Style injection — deduplicated across all instances ──────────────────────

/**
 * Injects the voice-form <style> tag into <head> exactly once.
 * Subsequent calls are no-ops (checked by id="voiceform-styles").
 */
function injectStyles(): void {
  if (document.getElementById('voiceform-styles')) return
  const style = document.createElement('style')
  style.id = 'voiceform-styles'
  style.textContent = VOICEFORM_CSS
  document.head.appendChild(style)
}

// ─── Error message mapping ────────────────────────────────────────────────────

function errorMessage(
  state: Extract<VoiceFormState, { status: 'error' }>,
  strings: VoiceFormStrings,
): string {
  switch (state.error.code) {
    case 'PERMISSION_DENIED':
      return strings.errors.permissionDenied
    case 'NO_TRANSCRIPT':
      return strings.errors.noSpeech
    case 'TRANSCRIPT_TOO_LONG':
      return strings.errors.transcriptTooLong
    case 'PARSE_FAILED':
    case 'INVALID_RESPONSE':
      return strings.errors.parseError
    default:
      return strings.errors.endpointError
  }
}

// ─── Announcement mapping ─────────────────────────────────────────────────────

function announcementText(state: VoiceFormState, strings: VoiceFormStrings): string {
  switch (state.status) {
    case 'recording':
      return strings.announcements.listening
    case 'processing':
      return strings.announcements.processing
    case 'confirming': {
      const count = Object.keys(state.confirmation.parsedFields).length
      const tpl = strings.announcements.confirming
      if (typeof tpl === 'function') return tpl(count)
      return (tpl as string).replace('{count}', String(count))
    }
    case 'done': {
      const count = Object.keys(state.result.fields).length
      const tpl = strings.announcements.filled
      if (typeof tpl === 'function') return tpl(count)
      return (tpl as string).replace('{count}', String(count))
    }
    case 'error': {
      switch (state.error.code) {
        case 'PERMISSION_DENIED':
          return strings.announcements.errorPermission
        case 'NO_TRANSCRIPT':
          return strings.announcements.errorNoSpeech
        case 'TRANSCRIPT_TOO_LONG':
          return strings.announcements.errorTranscriptTooLong
        default:
          return strings.announcements.errorEndpoint
      }
    }
    default:
      return ''
  }
}

// ─── Button activation ────────────────────────────────────────────────────────

function activateButton(state: VoiceFormState, instance: VoiceFormInstance): void {
  switch (state.status) {
    case 'idle':
    case 'error':
      instance.start().catch(() => {
        // Errors propagate through the state machine subscription — swallow here
      })
      break
    case 'recording':
      instance.cancel()
      break
    // Disabled states (processing, confirming, injecting, done): no-op
  }
}

// ─── mountDefaultUI ───────────────────────────────────────────────────────────

/**
 * Mounts the default voice-form UI (mic button + status text + ARIA live region)
 * into the provided container element.
 *
 * @param container - The HTMLElement to render into.
 * @param instance  - The VoiceFormInstance to subscribe to and control.
 * @param strings   - All user-facing strings (no hardcoded English text).
 * @returns         An unmount function. Call it to remove all DOM and listeners.
 */
export function mountDefaultUI(
  container: HTMLElement,
  instance: VoiceFormInstance,
  strings: VoiceFormStrings,
): () => void {
  injectStyles()

  const instanceId = nextUid()

  // ── Build DOM ──────────────────────────────────────────────────────────

  const root = document.createElement('div')
  root.className = 'vf-root'

  // Pulse ring — shown during recording, positioned inside the button element
  const pulseRing = document.createElement('span')
  pulseRing.className = 'vf-pulse-ring'
  pulseRing.setAttribute('aria-hidden', 'true')
  pulseRing.style.display = 'none'

  // Mic button — receives all icon swaps via static SVG constant assignment
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'vf-mic-button'
  button.setAttribute('aria-label', strings.buttonLabel.idle)
  button.setAttribute('data-state', 'idle')
  // SAFE: ICON_MIC is a static constant defined in this module, never user data
  button.innerHTML = ICON_MIC
  button.appendChild(pulseRing)

  // Visible status text beneath the button
  const statusEl = document.createElement('span')
  const statusId = `vf-status-${instanceId}`
  statusEl.id = statusId
  statusEl.className = 'vf-status'
  statusEl.setAttribute('role', 'status')

  // Screen-reader-only live announcer
  const announcer = document.createElement('span')
  announcer.className = 'vf-announcer'
  announcer.setAttribute('aria-live', 'polite')
  announcer.setAttribute('aria-atomic', 'true')

  button.setAttribute('aria-describedby', statusId)

  root.appendChild(button)
  root.appendChild(statusEl)
  root.appendChild(announcer)
  container.appendChild(root)

  // ── State → DOM update function ────────────────────────────────────────

  let currentState: VoiceFormState = instance.getState()

  function update(state: VoiceFormState): void {
    currentState = state

    button.setAttribute('data-state', state.status)
    button.removeAttribute('aria-pressed')
    button.removeAttribute('aria-disabled')
    statusEl.removeAttribute('data-error')
    statusEl.textContent = ''

    switch (state.status) {
      case 'idle':
        button.setAttribute('aria-label', strings.buttonLabel.idle)
        // SAFE: ICON_MIC is a static constant, never user data
        button.innerHTML = ICON_MIC
        button.appendChild(pulseRing)
        pulseRing.style.display = 'none'
        break

      case 'recording':
        button.setAttribute('aria-label', strings.buttonLabel.recording)
        button.setAttribute('aria-pressed', 'true')
        // SAFE: ICON_MIC is a static constant, never user data
        button.innerHTML = ICON_MIC
        button.appendChild(pulseRing)
        pulseRing.style.display = ''
        // SAFE: textContent assignment — not innerHTML
        statusEl.textContent = strings.status.listening
        break

      case 'processing':
        button.setAttribute('aria-label', strings.buttonLabel.processing)
        button.setAttribute('aria-disabled', 'true')
        button.setAttribute('aria-pressed', 'false')
        // SAFE: ICON_SPINNER is a static constant, never user data
        button.innerHTML = ICON_SPINNER
        pulseRing.style.display = 'none'
        // SAFE: textContent assignment — not innerHTML
        statusEl.textContent = strings.status.processing
        break

      case 'confirming':
      case 'injecting':
        button.setAttribute('aria-label', strings.buttonLabel.processing)
        button.setAttribute('aria-disabled', 'true')
        button.setAttribute('aria-pressed', 'false')
        // SAFE: ICON_MIC is a static constant, never user data
        button.innerHTML = ICON_MIC
        button.appendChild(pulseRing)
        pulseRing.style.display = 'none'
        break

      case 'done':
        button.setAttribute('aria-label', strings.buttonLabel.done)
        button.setAttribute('aria-disabled', 'true')
        // SAFE: ICON_CHECKMARK is a static constant, never user data
        button.innerHTML = ICON_CHECKMARK
        pulseRing.style.display = 'none'
        // SAFE: textContent assignment — not innerHTML
        statusEl.textContent = strings.status.done
        break

      case 'error': {
        button.setAttribute('aria-label', strings.buttonLabel.error)
        // SAFE: ICON_WARNING is a static constant, never user data
        button.innerHTML = ICON_WARNING
        pulseRing.style.display = 'none'
        // SAFE: errorMessage() returns a string from VoiceFormStrings, assigned via textContent
        statusEl.textContent = errorMessage(state, strings)
        statusEl.setAttribute('data-error', 'true')
        break
      }
    }

    // Fire ARIA live announcement
    const announcement = announcementText(state, strings)
    if (announcement) {
      announcer.textContent = ''
      // Defer so the browser observes the cleared → populated mutation
      Promise.resolve().then(() => {
        announcer.textContent = announcement
      })
    }
  }

  // Render initial state immediately
  update(instance.getState())

  // ── Event handlers ─────────────────────────────────────────────────────

  function onButtonClick(): void {
    activateButton(currentState, instance)
  }

  function onButtonKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activateButton(currentState, instance)
    }
  }

  button.addEventListener('click', onButtonClick)
  button.addEventListener('keydown', onButtonKeydown)

  // ── State subscription ─────────────────────────────────────────────────

  const unsubscribe = instance.subscribe((state) => {
    update(state)
  })

  // ── Unmount ────────────────────────────────────────────────────────────

  return function unmount(): void {
    unsubscribe()
    button.removeEventListener('click', onButtonClick)
    button.removeEventListener('keydown', onButtonKeydown)
    root.remove()
  }
}
