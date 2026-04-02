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
 * P6-10: Field-level correction added per V2_LOW_LEVEL_DESIGN.md section 7
 */

import type {
  VoiceFormInstance,
  VoiceFormState,
  VoiceFormStrings,
  ConfirmedField,
  ConfirmationData,
  FieldSchema,
} from '../types.js'
import { sanitizeFieldValue } from '../utils/sanitize.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParsedFieldEntry = ConfirmedField & { wasModified?: boolean }
export type ParsedFields = Record<string, ParsedFieldEntry>

/**
 * Optional configuration for field-level correction support (P6-10).
 */
export interface ConfirmationPanelConfig {
  /**
   * When true, renders Edit buttons on each field row.
   * Clicking Edit opens an inline text input (or select for select/radio fields)
   * pre-populated with the current value.
   * Default: false. (FR-114)
   */
  allowFieldCorrection?: boolean

  /**
   * The form schema. Required when allowFieldCorrection is true so the panel
   * can determine field types and options for edit controls.
   */
  schema?: FieldSchema[]
}

/**
 * Internal edit state per field — ephemeral UI state, never dispatched to the
 * state machine. (LLD section 7.1)
 */
interface EditState {
  active: boolean
  draftValue: string
}

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

// ─── String resolution helper ─────────────────────────────────────────────────

function resolveString(
  tpl: string | ((label: string) => string),
  label: string,
): string {
  if (typeof tpl === 'function') return tpl(label)
  // Replace {label} placeholder if present
  return (tpl as string).replace('{label}', label)
}

// ─── sanitizeUserCorrection (LLD 7.3) ────────────────────────────────────────

function sanitizeUserCorrection(
  draftValue: string,
  fieldType: string,
  options: readonly string[] | undefined,
): { value: string; wasModified: boolean; rejected: boolean } {
  if (draftValue.trim() === '') {
    return { value: '', wasModified: false, rejected: false }
  }

  try {
    const result = sanitizeFieldValue(
      draftValue,
      fieldType as import('../types.js').FieldType,
      options as string[] | undefined,
    )
    const finalValue = typeof result.value === 'string' ? result.value : String(result.value)

    if (finalValue.trim() === '' && draftValue.trim() !== '') {
      return { value: draftValue, wasModified: true, rejected: true }
    }

    return { value: finalValue, wasModified: result.wasModified, rejected: false }
  } catch {
    return { value: draftValue, wasModified: false, rejected: true }
  }
}

// ─── Input type mapping (LLD 7, frontend design 4.5) ─────────────────────────

function inputTypeForField(fieldType: string): string {
  switch (fieldType) {
    case 'email': return 'email'
    case 'tel': return 'tel'
    case 'number': return 'number'
    case 'date': return 'date'
    default: return 'text'
  }
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

// ─── Edit row builder (P6-10) ─────────────────────────────────────────────────

/**
 * Renders or refreshes the inline edit controls for a field row.
 * Called when the user clicks the Edit button.
 *
 * Security: All user input is read via element.value and passed through
 * sanitizeUserCorrection before being sent to instance.correctField.
 * No user data is ever assigned via innerHTML.
 */
function openEditMode(
  row: HTMLElement,
  fieldName: string,
  fieldLabel: string,
  currentValue: string,
  fieldSchema: FieldSchema | undefined,
  instance: VoiceFormInstance,
  strings: VoiceFormStrings,
  editStates: Map<string, EditState>,
  instanceId: string,
  onEditClosed: () => void,
): void {
  // Mark this field as actively being edited
  editStates.set(fieldName, { active: true, draftValue: currentValue })
  row.classList.add('vf-field-row--editing')

  // Hide the static value + edit button; replace with edit controls
  const valueCell = row.querySelector<HTMLElement>('.vf-field-value-cell')
  if (!valueCell) return

  // Clear the value cell
  while (valueCell.firstChild) valueCell.removeChild(valueCell.firstChild)

  const labelId = `vf-label-${instanceId}-${fieldName}`
  const hintId = `vf-correction-hint-${instanceId}-${fieldName}`

  const fieldType = fieldSchema?.type ?? 'text'
  const isSelect = fieldType === 'select' || fieldType === 'radio'

  let editControl: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

  if (isSelect && fieldSchema?.options) {
    // Render <select> for select/radio fields
    const select = document.createElement('select')
    select.className = 'vf-field-correction-input'
    select.setAttribute('aria-labelledby', labelId)
    select.setAttribute('aria-describedby', hintId)
    select.setAttribute('autocomplete', 'off')

    for (const opt of fieldSchema.options) {
      const option = document.createElement('option')
      // SAFE: textContent — option text from developer schema, not user/LLM data
      option.textContent = opt
      option.value = opt
      if (opt === currentValue) option.selected = true
      select.appendChild(option)
    }

    editControl = select
  } else if (fieldType === 'textarea') {
    const textarea = document.createElement('textarea')
    textarea.className = 'vf-field-correction-input'
    textarea.setAttribute('aria-labelledby', labelId)
    textarea.setAttribute('aria-describedby', hintId)
    textarea.setAttribute('autocomplete', 'off')
    textarea.setAttribute('data-1p-ignore', '')
    textarea.setAttribute('data-lpignore', 'true')
    // SAFE: textContent — current value from state machine (already sanitized)
    textarea.value = currentValue
    editControl = textarea
  } else {
    const input = document.createElement('input')
    input.className = 'vf-field-correction-input'
    input.type = inputTypeForField(fieldType)
    input.setAttribute('aria-labelledby', labelId)
    input.setAttribute('aria-describedby', hintId)
    input.setAttribute('aria-required', 'false')
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('data-1p-ignore', '')
    input.setAttribute('data-lpignore', 'true')
    // SAFE: assigning via .value property — not innerHTML
    input.value = currentValue
    editControl = input
  }

  // sr-only hint for keyboard users
  const hintEl = document.createElement('span')
  hintEl.id = hintId
  hintEl.className = 'vf-sr-only'
  hintEl.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;margin:-1px'
  // SAFE: textContent — string from VoiceFormStrings
  hintEl.textContent = strings.confirm.editHintText

  // Save button
  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.className = 'vf-field-save-btn'
  // SAFE: textContent — string from VoiceFormStrings
  saveBtn.textContent = strings.confirm.saveEditLabel
  const saveAriaLabel = resolveString(strings.confirm.saveEditAriaLabel, fieldLabel)
  saveBtn.setAttribute('aria-label', saveAriaLabel)
  saveBtn.style.cssText =
    'background:var(--vf-fill-btn-bg,#2563eb);color:var(--vf-fill-btn-text,#fff);' +
    'border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:0.8125rem;min-height:36px'

  // Discard button
  const discardBtn = document.createElement('button')
  discardBtn.type = 'button'
  discardBtn.className = 'vf-field-discard-btn'
  // SAFE: textContent — string from VoiceFormStrings
  discardBtn.textContent = strings.confirm.discardEditLabel
  const discardAriaLabel = resolveString(strings.confirm.discardEditAriaLabel, fieldLabel)
  discardBtn.setAttribute('aria-label', discardAriaLabel)
  discardBtn.style.cssText =
    'background:var(--vf-cancel-btn-bg,#f3f4f6);color:var(--vf-cancel-btn-text,#374151);' +
    'border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:0.8125rem;min-height:36px'

  function doSave(): void {
    // SAFE: reading from .value property — not innerHTML
    const draft = editControl.value
    const result = sanitizeUserCorrection(draft, fieldType, fieldSchema?.options)

    if (result.rejected) {
      // Show inline invalid message — keep edit mode active
      // SAFE: textContent — string from VoiceFormStrings
      editControl.setAttribute('aria-invalid', 'true')
      return
    }

    const applied = instance.correctField(fieldName, result.value)
    if (applied) {
      // valueCell is non-null here — we returned early if null above
      closeEditMode(row, valueCell!, fieldName, editStates, fieldSchema, saveBtn, editControl, instance, strings, instanceId)
      onEditClosed()
    }
  }

  function doDiscard(): void {
    editStates.set(fieldName, { active: false, draftValue: '' })
    // valueCell is non-null here — we returned early if null above
    closeEditMode(row, valueCell!, fieldName, editStates, fieldSchema, discardBtn, editControl, instance, strings, instanceId)
    onEditClosed()
  }

  saveBtn.addEventListener('click', () => doSave())
  discardBtn.addEventListener('click', () => doDiscard())

  // Keyboard handling on the edit control
  editControl.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent
    if (ke.key === 'Escape') {
      ke.stopPropagation() // Don't bubble to the document Escape handler
      doDiscard()
    } else if (ke.key === 'Enter' && fieldType !== 'textarea') {
      ke.preventDefault()
      doSave()
    }
  })

  valueCell.appendChild(editControl)
  valueCell.appendChild(hintEl)
  valueCell.appendChild(saveBtn)
  valueCell.appendChild(discardBtn)

  // Focus the edit control immediately (LLD 7.4: focus management)
  editControl.focus()
  // Select all text for quick replacement (non-select, non-checkbox)
  if (editControl instanceof HTMLInputElement && editControl.type !== 'checkbox') {
    editControl.select()
  }
}

/**
 * Closes the edit mode for a field row and restores the static value display.
 * Focuses the edit button to return keyboard navigation context.
 */
function closeEditMode(
  row: HTMLElement,
  valueCell: HTMLElement,
  fieldName: string,
  editStates: Map<string, EditState>,
  fieldSchema: FieldSchema | undefined,
  returnFocusTarget: HTMLElement,
  editControl: HTMLElement,
  instance: VoiceFormInstance,
  strings: VoiceFormStrings,
  instanceId: string,
): void {
  editStates.set(fieldName, { active: false, draftValue: '' })
  row.classList.remove('vf-field-row--editing')

  // Get the current value from instance state (may have been updated by correctField)
  const currentState = instance.getState()
  let currentValue = ''
  if (currentState.status === 'confirming') {
    currentValue = currentState.confirmation.parsedFields[fieldName]?.value ?? ''
  }

  // Rebuild the static value display
  while (valueCell.firstChild) valueCell.removeChild(valueCell.firstChild)

  const labelId = `vf-label-${instanceId}-${fieldName}`
  const valueId = `vf-value-${instanceId}-${fieldName}`

  const valueSpan = document.createElement('span')
  valueSpan.className = 'vf-field-value'
  valueSpan.id = valueId
  // SAFE (CRIT-001): textContent — value from state machine (already sanitized)
  valueSpan.textContent = currentValue
  valueCell.appendChild(valueSpan)

  // Re-render the Edit button
  const editBtn = buildEditButton(fieldName, fieldSchema?.label ?? fieldName, valueId, labelId, strings)
  valueCell.appendChild(editBtn)

  // Focus returns to the edit button (LLD 7.4)
  editBtn.focus()

  // Wire the click handler again (the old button was removed)
  void (returnFocusTarget) // suppress unused-var; the old button is discarded
  editBtn.addEventListener('click', () => {
    const state = instance.getState()
    const val = state.status === 'confirming'
      ? (state.confirmation.parsedFields[fieldName]?.value ?? '')
      : ''
    // editControl will be rebuilt in openEditMode — pass current value
    void (editControl)
    // We need to re-run openEditMode here but we don't have all args.
    // The row-level rebuildValueCell function handles this.
  })
}

// ─── Build edit button ────────────────────────────────────────────────────────

function buildEditButton(
  fieldName: string,
  fieldLabel: string,
  valueId: string,
  _labelId: string,
  strings: VoiceFormStrings,
): HTMLButtonElement {
  const editBtn = document.createElement('button')
  editBtn.type = 'button'
  editBtn.className = 'vf-field-edit-btn'
  const editAriaLabel = resolveString(strings.confirm.editAriaLabel, fieldLabel)
  editBtn.setAttribute('aria-label', editAriaLabel)
  editBtn.setAttribute('aria-describedby', valueId)
  editBtn.style.cssText =
    'background:none;border:none;cursor:pointer;padding:4px 6px;' +
    'color:var(--vf-field-edit-btn-color,#6b7280);font-size:0.75rem;border-radius:3px;' +
    'min-height:28px'

  // Pencil icon (static SVG, safe for innerHTML)
  const pencilSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  pencilSvg.setAttribute('viewBox', '0 0 16 16')
  pencilSvg.setAttribute('fill', 'none')
  pencilSvg.setAttribute('stroke', 'currentColor')
  pencilSvg.setAttribute('stroke-width', '1.5')
  pencilSvg.setAttribute('width', '12')
  pencilSvg.setAttribute('height', '12')
  pencilSvg.setAttribute('aria-hidden', 'true')
  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path1.setAttribute('d', 'M11.5 2.5l2 2-9 9H2.5v-2l9-9z')
  pencilSvg.appendChild(path1)
  editBtn.appendChild(pencilSvg)

  void (_labelId) // suppress unused parameter warning
  void (fieldName)

  return editBtn
}

// ─── Field rows renderer ──────────────────────────────────────────────────────

/**
 * Clears and rebuilds the field rows in the <dl>.
 * ALL value assignments use textContent — never innerHTML. (CRIT-001)
 *
 * P6-10: When allowFieldCorrection is true, each parsed field row gets an Edit
 * button. Clicking Edit replaces the static display with an inline input.
 */
function populateFields(
  dl: HTMLDListElement,
  fillBtn: HTMLButtonElement,
  confirmation: ConfirmationData,
  initialFields: ParsedFields,
  strings: VoiceFormStrings,
  config: ConfirmationPanelConfig,
  instance: VoiceFormInstance,
  instanceId: string,
  editStates: Map<string, EditState>,
): void {
  while (dl.firstChild) dl.removeChild(dl.firstChild)

  const allowEdit = config.allowFieldCorrection === true
  const schemaMap = new Map<string, FieldSchema>(
    (config.schema ?? []).map((f) => [f.name, f]),
  )

  // Update fill button label — shows "Fill form (edited)" if any field was user-corrected
  const anyUserCorrected = Object.values(confirmation.parsedFields).some(
    (f) => f.userCorrected === true,
  )
  // SAFE: textContent — string from VoiceFormStrings
  fillBtn.textContent = anyUserCorrected
    ? strings.confirm.fillLabelEdited
    : strings.confirm.fillLabel

  // Parsed fields
  for (const [fieldName, confirmedField] of Object.entries(confirmation.parsedFields)) {
    const fieldSchema = schemaMap.get(fieldName)
    const fieldLabel = confirmedField.label

    const row = document.createElement('div')
    row.className = 'vf-field-row'
    row.setAttribute('role', 'row')
    row.setAttribute('data-field-name', fieldName)
    row.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:4px 0'

    const labelId = `vf-label-${instanceId}-${fieldName}`
    const valueId = `vf-value-${instanceId}-${fieldName}`

    const dt = document.createElement('dt')
    dt.className = 'vf-field-label'
    dt.id = labelId
    dt.setAttribute('role', 'rowheader')
    dt.style.cssText = 'flex:0 0 auto;min-width:100px;color:var(--vf-panel-label-color,#374151);font-size:0.875rem'
    // SAFE: textContent — field label from developer schema
    dt.textContent = fieldLabel

    const dd = document.createElement('dd')
    dd.className = 'vf-field-value-cell'
    dd.setAttribute('role', 'cell')
    dd.style.cssText = 'flex:1;margin:0;display:flex;align-items:center;gap:6px;color:var(--vf-panel-value-color,#111827);font-size:0.875rem'

    const valueSpan = document.createElement('span')
    valueSpan.className = 'vf-field-value'
    valueSpan.id = valueId
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

    // P6-10: Render Edit button for correctable fields
    // (FieldType does not include 'password' — excluded at schema detection time)
    if (allowEdit) {
      const editBtn = buildEditButton(fieldName, fieldLabel, valueId, labelId, strings)

      // Bind edit button click with full closure over row context
      ;(function bindEdit(
        _row: HTMLElement,
        _dd: HTMLElement,
        _fieldName: string,
        _fieldLabel: string,
        _fieldSchema: FieldSchema | undefined,
      ) {
        editBtn.addEventListener('click', () => {
          const state = instance.getState()
          const val = state.status === 'confirming'
            ? (state.confirmation.parsedFields[_fieldName]?.value ?? '')
            : ''

          openEditMode(
            _row,
            _fieldName,
            _fieldLabel,
            val,
            _fieldSchema,
            instance,
            strings,
            editStates,
            instanceId,
            () => {
              // After edit closes (save or discard), rebuild the static value display
              rebuildValueCell(
                _row,
                _dd,
                _fieldName,
                _fieldLabel,
                _fieldSchema,
                instance,
                strings,
                editStates,
                instanceId,
                initialFields,
              )
            },
          )
        })
      })(row, dd, fieldName, fieldLabel, fieldSchema)

      dd.appendChild(editBtn)
    }

    row.appendChild(dt)
    row.appendChild(dd)
    dl.appendChild(row)
  }

  // Missing (unrecognized) fields
  for (const fieldName of confirmation.missingFields) {
    const fieldSchema = schemaMap.get(fieldName)
    const fieldLabel = initialFields[fieldName]?.label ?? fieldName

    const row = document.createElement('div')
    row.className = 'vf-field-row'
    row.setAttribute('role', 'row')
    row.setAttribute('data-field-name', fieldName)
    row.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:4px 0'

    const labelId = `vf-label-${instanceId}-${fieldName}`

    const dt = document.createElement('dt')
    dt.className = 'vf-field-label'
    dt.id = labelId
    dt.setAttribute('role', 'rowheader')
    dt.style.cssText = 'flex:0 0 auto;min-width:100px;color:var(--vf-panel-label-color,#374151);font-size:0.875rem'
    // SAFE: textContent — label from developer schema or field name
    dt.textContent = fieldLabel

    const dd = document.createElement('dd')
    dd.className = 'vf-field-value-cell'
    dd.setAttribute('role', 'cell')
    dd.style.cssText = 'flex:1;margin:0;color:var(--vf-panel-value-color,#111827);font-size:0.875rem;display:flex;align-items:center;gap:6px'

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

    // P6-10: Missing fields can also be edited (fill-in a null field, FR-115)
    // (FieldType does not include 'password' — excluded at schema detection time)
    if (allowEdit) {
      const valueId = `vf-value-${instanceId}-${fieldName}`
      const editBtn = buildEditButton(fieldName, fieldLabel, valueId, labelId, strings)

      ;(function bindMissingEdit(
        _row: HTMLElement,
        _dd: HTMLElement,
        _fieldName: string,
        _fieldLabel: string,
        _fieldSchema: FieldSchema | undefined,
      ) {
        editBtn.addEventListener('click', () => {
          openEditMode(
            _row,
            _fieldName,
            _fieldLabel,
            '', // missing field starts with empty input
            _fieldSchema,
            instance,
            strings,
            editStates,
            instanceId,
            () => {
              rebuildValueCell(
                _row,
                _dd,
                _fieldName,
                _fieldLabel,
                _fieldSchema,
                instance,
                strings,
                editStates,
                instanceId,
                initialFields,
              )
            },
          )
        })
      })(row, dd, fieldName, fieldLabel, fieldSchema)

      dd.appendChild(editBtn)
    }

    row.appendChild(dt)
    row.appendChild(dd)
    dl.appendChild(row)
  }
}

// ─── Rebuild value cell after edit ────────────────────────────────────────────

/**
 * Rebuilds the static value cell for a field after edit mode closes.
 * Called by both save and discard paths.
 */
function rebuildValueCell(
  row: HTMLElement,
  valueCell: HTMLElement,
  fieldName: string,
  fieldLabel: string,
  fieldSchema: FieldSchema | undefined,
  instance: VoiceFormInstance,
  strings: VoiceFormStrings,
  editStates: Map<string, EditState>,
  instanceId: string,
  initialFields: ParsedFields,
): void {
  editStates.set(fieldName, { active: false, draftValue: '' })
  row.classList.remove('vf-field-row--editing')

  // Clear value cell
  while (valueCell.firstChild) valueCell.removeChild(valueCell.firstChild)

  const state = instance.getState()
  const currentValue = state.status === 'confirming'
    ? (state.confirmation.parsedFields[fieldName]?.value ?? '')
    : ''

  const valueId = `vf-value-${instanceId}-${fieldName}`
  const labelId = `vf-label-${instanceId}-${fieldName}`

  const valueSpan = document.createElement('span')
  valueSpan.className = 'vf-field-value'
  valueSpan.id = valueId
  // SAFE: textContent — value from state machine (already sanitized)
  valueSpan.textContent = currentValue
  valueCell.appendChild(valueSpan)

  const initialEntry = initialFields[fieldName]
  if (initialEntry?.wasModified === true) {
    const warningSpan = document.createElement('span')
    warningSpan.className = 'vf-sanitized-warning'
    warningSpan.setAttribute('role', 'img')
    warningSpan.setAttribute('aria-label', strings.confirm.sanitizedAriaLabel)
    warningSpan.setAttribute('title', 'HTML content was removed from this value')
    warningSpan.style.cssText = 'color:var(--vf-sanitized-warning-color,#b45309);font-size:0.875rem'
    warningSpan.textContent = '\u26A0'
    valueCell.appendChild(warningSpan)
  }

  // Rebuild edit button with fresh event handler
  const editBtn = buildEditButton(fieldName, fieldLabel, valueId, labelId, strings)

  ;(function bindEdit(
    _row: HTMLElement,
    _dd: HTMLElement,
    _fieldName: string,
    _fieldLabel: string,
    _fieldSchema: FieldSchema | undefined,
  ) {
    editBtn.addEventListener('click', () => {
      const s = instance.getState()
      const val = s.status === 'confirming'
        ? (s.confirmation.parsedFields[_fieldName]?.value ?? '')
        : ''
      openEditMode(
        _row,
        _fieldName,
        _fieldLabel,
        val,
        _fieldSchema,
        instance,
        strings,
        editStates,
        instanceId,
        () => {
          rebuildValueCell(
            _row,
            _dd,
            _fieldName,
            _fieldLabel,
            _fieldSchema,
            instance,
            strings,
            editStates,
            instanceId,
            initialFields,
          )
        },
      )
    })
  })(row, valueCell, fieldName, fieldLabel, fieldSchema)

  valueCell.appendChild(editBtn)
  editBtn.focus()
}

// ─── mountConfirmationPanel ───────────────────────────────────────────────────

/**
 * Mounts the confirmation panel bound to a VoiceFormInstance.
 *
 * @param anchor  - The element the panel positions itself relative to.
 * @param instance - The VoiceFormInstance to control.
 * @param fields  - Initial parsed field snapshot (includes wasModified flags).
 * @param strings - All user-facing strings.
 * @param config  - Optional config. Pass `allowFieldCorrection: true` to enable
 *                  inline field editing. (P6-10)
 * @returns An unmount function that removes all DOM and event listeners.
 */
export function mountConfirmationPanel(
  anchor: HTMLElement,
  instance: VoiceFormInstance,
  fields: ParsedFields,
  strings: VoiceFormStrings,
  config: ConfirmationPanelConfig = {},
): () => void {
  const instanceId = nextCpUid()

  let elements: PanelElements | null = null
  let panelMounted = false
  let isOpen = false

  // Per-field edit state (P6-10) — ephemeral, never in the state machine
  const editStates = new Map<string, EditState>()

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

    populateFields(
      elements.dl,
      elements.fillBtn,
      confirmation,
      fields,
      strings,
      config,
      instance,
      instanceId,
      editStates,
    )

    elements.panel.style.display = ''
    elements.panel.hidden = false
    isOpen = true

    // Remove before re-adding — idempotent no-op if not already registered.
    // Prevents double-registration if showPanel() is ever called twice without
    // an intervening hidePanel() call. (N-7)
    document.removeEventListener('keydown', onEscape)
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
