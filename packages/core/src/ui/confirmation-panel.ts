/**
 * @voiceform/core — Confirmation panel UI (framework-agnostic)
 *
 * Security contract (CRIT-001):
 *   ALL field values from the LLM endpoint are assigned via element.textContent ONLY.
 *   The only innerHTML usages below are for the static ICON_CLOSE SVG constant,
 *   which is hardcoded in this file and never interpolated with user/LLM data.
 *
 * Deferred construction (PERF 3.2):
 *   Panel DOM is built the first time the component enters confirming state.
 *
 * Canonical spec: docs/UX_SPEC.md section 5, 8 / docs/TASKS.md P1-10
 */

import type {
  VoiceFormInstance,
  VoiceFormState,
  VoiceFormStrings,
  ConfirmedField,
  ConfirmationData,
} from '../types.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParsedFieldEntry = ConfirmedField & { wasModified?: boolean }
export type ParsedFields = Record<string, ParsedFieldEntry>

// ─── Unique ID generator ──────────────────────────────────────────────────────

let _cpUidCounter = 0
function nextCpUid(): string {
  _cpUidCounter += 1
  return `vfcp-${_cpUidCounter}`
}

// ─── Panel position helper ────────────────────────────────────────────────────

function positionPanel(panel: HTMLElement, anchor: HTMLElement): void {
  if (window.innerWidth < 480) {
    panel.style.position = 'fixed'
    panel.style.bottom = '0'
    panel.style.left = '0'
    panel.style.right = '0'
    panel.style.top = 'auto'
    panel.style.width = '100%'
    panel.style.maxWidth = '100%'
    panel.style.borderRadius = '16px 16px 0 0'
    return
  }

  // Single batched read block
  const rect = anchor.getBoundingClientRect()
  const panelMinWidth = 280
  const viewportWidth = window.innerWidth
  const spaceAbove = rect.top

  const idealLeft = rect.left
  const maxLeft = viewportWidth - panelMinWidth
  const clampedLeft = Math.max(0, Math.min(idealLeft, maxLeft))
  const openUpward = spaceAbove > 300

  // Single write block — no reads below this line
  panel.style.position = 'absolute'
  panel.style.left = `${clampedLeft}px`
  panel.style.width = ''
  panel.style.maxWidth = ''
  panel.style.borderRadius = ''

  if (openUpward) {
    panel.style.bottom = `${Math.round(rect.height) + 8}px`
    panel.style.top = 'auto'
  } else {
    panel.style.top = `${Math.round(rect.bottom) + 8}px`
    panel.style.bottom = 'auto'
  }
}

// ─── Focus trap ───────────────────────────────────────────────────────────────

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([aria-disabled="true"]),' +
      '[href]:not([disabled]),' +
      'input:not([disabled]),' +
      'select:not([disabled]),' +
      'textarea:not([disabled]),' +
      '[tabindex]:not([tabindex="-1"])',
    ),
  )
}

function trapFocus(panel: HTMLElement): () => void {
  function handleKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return
    const focusable = getFocusable(panel)
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = document.activeElement as HTMLElement
    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (active === last || !panel.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
  }
  panel.addEventListener('keydown', handleKeydown)
  return () => panel.removeEventListener('keydown', handleKeydown)
}

// ─── Panel DOM builder ────────────────────────────────────────────────────────

interface PanelElements {
  panel: HTMLElement
  dl: HTMLDListElement
  fillBtn: HTMLButtonElement
  cancelBtn: HTMLButtonElement
  dismissBtn: HTMLButtonElement
  removeTrap: () => void
}

function buildPanel(strings: VoiceFormStrings, instanceId: string): PanelElements {
  const descId = `vf-confirm-desc-${instanceId}`

  const panel = document.createElement('div')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'false')
  panel.setAttribute('aria-label', 'Confirm voice input')
  panel.setAttribute('aria-describedby', descId)
  panel.className = 'vf-panel'
  panel.style.cssText =
    'background:var(--vf-panel-bg,#fff);' +
    'border:1px solid var(--vf-panel-border,#e5e7eb);' +
    'border-radius:var(--vf-panel-radius,8px);' +
    'box-shadow:var(--vf-panel-shadow,0 4px 16px rgba(0,0,0,0.10));' +
    'padding:var(--vf-panel-padding,16px);' +
    'min-width:var(--vf-panel-min-width,280px);' +
    'max-width:var(--vf-panel-max-width,420px);' +
    'z-index:100;'

  const desc = document.createElement('p')
  desc.id = descId
  desc.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;margin:-1px'
  desc.textContent = strings.confirm.description
  panel.appendChild(desc)

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'

  const titleEl = document.createElement('h3')
  titleEl.className = 'vf-panel-title'
  titleEl.style.cssText = 'margin:0;font-size:0.9375rem;color:var(--vf-panel-header-color,#111827)'
  titleEl.textContent = strings.confirm.title

  const dismissBtn = document.createElement('button')
  dismissBtn.type = 'button'
  dismissBtn.className = 'vf-dismiss-btn'
  dismissBtn.setAttribute('aria-label', strings.confirm.dismissAriaLabel)
  dismissBtn.style.cssText =
    'background:none;border:none;cursor:pointer;padding:4px;display:flex;' +
    'align-items:center;justify-content:center;border-radius:4px;' +
    'color:var(--vf-panel-header-color,#111827)'
  // The close icon SVG is a hardcoded constant — never user data
  const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  closeIcon.setAttribute('viewBox', '0 0 24 24')
  closeIcon.setAttribute('fill', 'none')
  closeIcon.setAttribute('stroke', 'currentColor')
  closeIcon.setAttribute('stroke-width', '2')
  closeIcon.setAttribute('stroke-linecap', 'round')
  closeIcon.setAttribute('stroke-linejoin', 'round')
  closeIcon.setAttribute('aria-hidden', 'true')
  closeIcon.setAttribute('focusable', 'false')
  closeIcon.setAttribute('width', '16')
  closeIcon.setAttribute('height', '16')
  const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line1.setAttribute('x1', '18'); line1.setAttribute('y1', '6'); line1.setAttribute('x2', '6'); line1.setAttribute('y2', '18')
  const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line2.setAttribute('x1', '6'); line2.setAttribute('y1', '6'); line2.setAttribute('x2', '18'); line2.setAttribute('y2', '18')
  closeIcon.appendChild(line1)
  closeIcon.appendChild(line2)
  dismissBtn.appendChild(closeIcon)

  header.appendChild(titleEl)
  header.appendChild(dismissBtn)
  panel.appendChild(header)

  const divider1 = document.createElement('hr')
  divider1.style.cssText = 'border:none;border-top:1px solid var(--vf-panel-divider-color,#f3f4f6);margin:0 0 12px'
  panel.appendChild(divider1)

  const dl = document.createElement('dl')
  dl.className = 'vf-field-list'
  dl.style.cssText = 'margin:0 0 12px;padding:0'
  panel.appendChild(dl)

  const divider2 = document.createElement('hr')
  divider2.style.cssText = 'border:none;border-top:1px solid var(--vf-panel-divider-color,#f3f4f6);margin:0 0 12px'
  panel.appendChild(divider2)

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px'

  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'vf-cancel-btn'
  cancelBtn.setAttribute('aria-label', strings.confirm.cancelAriaLabel)
  cancelBtn.style.cssText =
    'background:var(--vf-cancel-btn-bg,#f3f4f6);color:var(--vf-cancel-btn-text,#374151);' +
    'border:none;border-radius:6px;padding:10px 16px;cursor:pointer;font-size:0.875rem;min-height:44px'
  cancelBtn.textContent = strings.confirm.cancelLabel

  const fillBtn = document.createElement('button')
  fillBtn.type = 'button'
  fillBtn.className = 'vf-fill-btn'
  fillBtn.setAttribute('aria-label', strings.confirm.fillAriaLabel)
  fillBtn.style.cssText =
    'background:var(--vf-fill-btn-bg,#2563eb);color:var(--vf-fill-btn-text,#fff);' +
    'border:none;border-radius:6px;padding:10px 16px;cursor:pointer;font-size:0.875rem;min-height:44px;font-weight:500'
  fillBtn.textContent = strings.confirm.fillLabel

  footer.appendChild(cancelBtn)
  footer.appendChild(fillBtn)
  panel.appendChild(footer)

  const removeTrap = trapFocus(panel)

  return { panel, dl, fillBtn, cancelBtn, dismissBtn, removeTrap }
}

// ─── Field rows renderer ──────────────────────────────────────────────────────

/**
 * Clears and rebuilds the field rows in the <dl>.
 * ALL value assignments use textContent — never innerHTML. (CRIT-001)
 */
function populateFields(
  dl: HTMLDListElement,
  confirmation: ConfirmationData,
  initialFields: ParsedFields,
  strings: VoiceFormStrings,
): void {
  while (dl.firstChild) dl.removeChild(dl.firstChild)

  // Parsed fields
  for (const [fieldName, confirmedField] of Object.entries(confirmation.parsedFields)) {
    const row = document.createElement('div')
    row.className = 'vf-field-row'
    row.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:4px 0'

    const dt = document.createElement('dt')
    dt.className = 'vf-field-label'
    dt.style.cssText = 'flex:0 0 auto;min-width:100px;color:var(--vf-panel-label-color,#374151);font-size:0.875rem'
    // SAFE: textContent — field label from developer schema
    dt.textContent = confirmedField.label

    const dd = document.createElement('dd')
    dd.className = 'vf-field-value-cell'
    dd.style.cssText = 'flex:1;margin:0;display:flex;align-items:center;gap:6px;color:var(--vf-panel-value-color,#111827);font-size:0.875rem'

    const valueSpan = document.createElement('span')
    valueSpan.className = 'vf-field-value'
    // SAFE (CRIT-001): textContent — LLM output assigned as plain text, never as HTML
    valueSpan.textContent = confirmedField.value
    dd.appendChild(valueSpan)

    const initialEntry = initialFields[fieldName]
    if (initialEntry?.wasModified === true) {
      const warningSpan = document.createElement('span')
      warningSpan.className = 'vf-sanitized-warning'
      warningSpan.setAttribute('role', 'img')
      warningSpan.setAttribute('aria-label', strings.confirm.sanitizedAriaLabel)
      warningSpan.setAttribute('title', 'HTML content was removed from this value')
      warningSpan.style.cssText = 'color:var(--vf-sanitized-warning-color,#b45309);font-size:0.875rem'
      // SAFE: literal Unicode warning sign, not user data
      warningSpan.textContent = '\u26A0'
      dd.appendChild(warningSpan)
    }

    row.appendChild(dt)
    row.appendChild(dd)
    dl.appendChild(row)
  }

  // Missing (unrecognized) fields
  for (const fieldName of confirmation.missingFields) {
    const row = document.createElement('div')
    row.className = 'vf-field-row'
    row.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:4px 0'

    const dt = document.createElement('dt')
    dt.className = 'vf-field-label'
    dt.style.cssText = 'flex:0 0 auto;min-width:100px;color:var(--vf-panel-label-color,#374151);font-size:0.875rem'
    const knownLabel = initialFields[fieldName]?.label ?? fieldName
    // SAFE: textContent — label from developer schema or field name
    dt.textContent = knownLabel

    const dd = document.createElement('dd')
    dd.className = 'vf-field-value-cell'
    dd.style.cssText = 'flex:1;margin:0;color:var(--vf-panel-value-color,#111827);font-size:0.875rem'

    const badge = document.createElement('span')
    badge.className = 'vf-unrecognized-badge'
    badge.setAttribute('aria-label', strings.confirm.unrecognizedAriaLabel)
    badge.style.cssText =
      'display:inline-block;padding:2px 8px;border-radius:4px;' +
      'background:var(--vf-unrecognized-badge-bg,#fef3c7);' +
      'color:var(--vf-unrecognized-badge-text,#92400e);font-size:0.75rem'
    // SAFE: textContent — string from VoiceFormStrings
    badge.textContent = strings.confirm.unrecognizedLabel
    dd.appendChild(badge)

    row.appendChild(dt)
    row.appendChild(dd)
    dl.appendChild(row)
  }
}

// ─── mountConfirmationPanel ───────────────────────────────────────────────────

export function mountConfirmationPanel(
  anchor: HTMLElement,
  instance: VoiceFormInstance,
  fields: ParsedFields,
  strings: VoiceFormStrings,
): () => void {
  const instanceId = nextCpUid()

  let elements: PanelElements | null = null
  let panelMounted = false
  let isOpen = false

  function onEscape(e: KeyboardEvent): void {
    if (e.key === 'Escape' && isOpen) {
      instance.cancel()
    }
  }

  function showPanel(confirmation: ConfirmationData): void {
    if (!elements) {
      elements = buildPanel(strings, instanceId)
      elements.fillBtn.addEventListener('click', () => {
        instance.confirm().catch(() => { /* errors propagate through state machine */ })
      })
      elements.cancelBtn.addEventListener('click', () => instance.cancel())
      elements.dismissBtn.addEventListener('click', () => instance.cancel())
    }

    if (!panelMounted) {
      document.body.appendChild(elements.panel)
      panelMounted = true
    }

    populateFields(elements.dl, confirmation, fields, strings)

    elements.panel.style.display = ''
    elements.panel.hidden = false
    isOpen = true

    document.addEventListener('keydown', onEscape)
    positionPanel(elements.panel, anchor)

    requestAnimationFrame(() => {
      elements?.fillBtn.focus()
    })
  }

  function hidePanel(): void {
    if (!elements) return
    elements.panel.style.display = 'none'
    elements.panel.hidden = true
    isOpen = false
    document.removeEventListener('keydown', onEscape)
    anchor.focus()
  }

  const unsubscribe = instance.subscribe((state: VoiceFormState) => {
    if (state.status === 'confirming') {
      showPanel(state.confirmation)
    } else if (isOpen) {
      hidePanel()
    }
  })

  return function unmount(): void {
    unsubscribe()
    document.removeEventListener('keydown', onEscape)
    if (elements) {
      elements.removeTrap()
      elements.panel.remove()
      elements = null
      panelMounted = false
    }
    isOpen = false
  }
}
