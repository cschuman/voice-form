/**
 * @voiceform/core — Privacy notice UI (framework-agnostic)
 *
 * Renders an inline privacy disclosure panel near the mic button.
 * Manages show/hide lifecycle and optional acknowledgement gating.
 *
 * Acknowledgement is tracked in a session-scoped variable (never localStorage).
 * The notice does not re-appear within the same page session after acknowledgement.
 *
 * All strings come from config.strings — no hardcoded English text.
 * CSS uses --vf-privacy-* custom properties exclusively.
 *
 * Canonical spec: docs/UX_SPEC.md section 12 / docs/TASKS.md P1-NEW-05
 */

import type { VoiceFormStrings } from '../types.js'

// ─── Config type ──────────────────────────────────────────────────────────────

export interface PrivacyNoticeConfig {
  /** The disclosure text to display. Developer-supplied. */
  privacyNotice: string
  /** When true, mic is blocked until the user clicks "I understand". */
  requirePrivacyAcknowledgement: boolean
  /** Strings subset — only privacy keys are used here. */
  strings: Pick<VoiceFormStrings, 'privacy'>
}

// ─── Return type ──────────────────────────────────────────────────────────────

export interface PrivacyNoticeHandle {
  /** Show the privacy notice panel. */
  show(): void
  /** Hide the privacy notice panel. */
  hide(): void
  /** Remove all DOM and event listeners. */
  destroy(): void
  /** True after the user has clicked "I understand" (session-scoped). */
  acknowledged: boolean
}

// ─── Unique ID generator ──────────────────────────────────────────────────────

let _pnUidCounter = 0
function nextPnUid(): string {
  _pnUidCounter += 1
  return `vfpn-${_pnUidCounter}`
}

// ─── mountPrivacyNotice ───────────────────────────────────────────────────────

/**
 * Mounts a privacy notice panel anchored to the provided element.
 *
 * @param anchor - The element to anchor the notice to (typically the mic button container).
 * @param config - Privacy notice configuration and strings.
 * @returns      A handle with show(), hide(), destroy(), and acknowledged.
 */
export function mountPrivacyNotice(
  anchor: HTMLElement,
  config: PrivacyNoticeConfig,
): PrivacyNoticeHandle {
  const instanceId = nextPnUid()
  const descId = `vf-privacy-desc-${instanceId}`

  // Session-scoped acknowledgement — not localStorage
  let acknowledgedInSession = false
  let panel: HTMLElement | null = null
  let panelBuilt = false

  function buildPanelEl(): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('role', 'region')
    el.setAttribute('aria-label', config.strings.privacy.regionAriaLabel)
    el.setAttribute('aria-live', 'polite')
    el.className = 'vf-privacy-notice'
    el.style.cssText =
      'background:var(--vf-privacy-bg,#f9fafb);' +
      'border:1px solid var(--vf-privacy-border,#e5e7eb);' +
      'border-radius:var(--vf-privacy-radius,6px);' +
      'color:var(--vf-privacy-text-color,#111827);' +
      'padding:12px;font-size:0.8125rem;' +
      'max-width:420px;min-width:280px;margin-top:8px'

    // Notice body text
    const bodyText = document.createElement('p')
    bodyText.id = descId
    bodyText.style.cssText = 'margin:0 0 10px'
    // SAFE: textContent — developer-supplied notice string, not LLM output
    bodyText.textContent = config.privacyNotice
    el.appendChild(bodyText)

    if (config.requirePrivacyAcknowledgement) {
      const ackBtn = document.createElement('button')
      ackBtn.type = 'button'
      ackBtn.className = 'vf-privacy-acknowledge'
      ackBtn.setAttribute('aria-label', config.strings.privacy.acknowledgeAriaLabel)
      ackBtn.style.cssText =
        'background:var(--vf-fill-btn-bg,#2563eb);color:var(--vf-fill-btn-text,#fff);' +
        'border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:0.875rem;min-height:44px'
      // SAFE: textContent — string from config.strings, never LLM output
      ackBtn.textContent = config.strings.privacy.acknowledgeLabel

      ackBtn.addEventListener('click', () => {
        acknowledgedInSession = true
        handle.acknowledged = true
        hide()
      })

      el.appendChild(ackBtn)
    }

    return el
  }

  function show(): void {
    if (!panelBuilt || !panel) {
      panel = buildPanelEl()
      panelBuilt = true
      // Insert after anchor
      if (anchor.parentNode) {
        anchor.parentNode.insertBefore(panel, anchor.nextSibling)
      } else {
        document.body.appendChild(panel)
      }
    }

    panel.style.display = ''
    panel.hidden = false
  }

  function hide(): void {
    if (!panel) return
    panel.style.display = 'none'
    panel.hidden = true
  }

  function destroy(): void {
    panel?.remove()
    panel = null
    panelBuilt = false
  }

  const handle: PrivacyNoticeHandle = {
    show,
    hide,
    destroy,
    acknowledged: acknowledgedInSession,
  }

  return handle
}
