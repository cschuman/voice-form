/**
 * DOM Schema Auto-Detection
 *
 * Scans a form element's DOM structure and infers a FormSchema from it.
 * This is a best-effort inference. Always review the result via
 * `onSchemaDetected` before production use.
 *
 * Security: reads only developer-controlled element attributes and label
 * text — structural metadata authored by the developer. Does NOT read
 * any current input values (element.value). The returned schema contains
 * no user data.
 *
 * Label text is truncated to 100 characters to prevent prompt injection via
 * crafted label text. (security review #6)
 *
 * Must be called inside a useEffect in React — never synchronously during
 * render. (security review #10)
 *
 * @module @voiceform/core/detect-schema
 */

import type { FieldSchema, FieldType, FormSchema } from './types.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const LABEL_MAX_LENGTH = 100

/**
 * Input types that are excluded from schema detection entirely.
 * Password is excluded for security; the rest are non-data-entry controls.
 */
const EXCLUDED_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'reset',
  'button',
  'image',
  'password',
])

// ─── Type helpers ─────────────────────────────────────────────────────────────

type FormField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

// ─── Internal utilities ───────────────────────────────────────────────────────

/**
 * Map a form field element to its corresponding FieldType.
 * Follows the mapping defined in LLD section 6.5.
 */
function mapInputType(fieldEl: FormField): FieldType {
  if (fieldEl instanceof HTMLTextAreaElement) return 'textarea'
  if (fieldEl instanceof HTMLSelectElement) return 'select'

  // HTMLInputElement branch
  switch ((fieldEl as HTMLInputElement).type) {
    case 'email':
      return 'email'
    case 'tel':
      return 'tel'
    case 'number':
    case 'range':
      return 'number'
    case 'date':
    case 'month':
    case 'week':
    case 'time':
    case 'datetime-local':
      return 'date'
    case 'checkbox':
      return 'checkbox'
    case 'radio':
      return 'radio'
    // text, search, url and any unrecognised types all map to 'text'
    default:
      return 'text'
  }
}

/**
 * Resolve the human-readable label for a form field element.
 *
 * Priority order (first match wins):
 *   1. <label for="id"> where for === element.id
 *   2. aria-labelledby (space-separated id list, ids resolved against root)
 *   3. aria-label attribute
 *   4. Closest ancestor <label> element's textContent
 *   5. placeholder attribute
 *   6. element.name or element.id as a last-resort fallback
 *
 * The resolved string is truncated to LABEL_MAX_LENGTH (100) characters.
 * (security review #6)
 */
function resolveLabel(fieldEl: FormField, root: HTMLElement): string {
  let resolved = ''

  // 1. <label for="id">
  if (fieldEl.id) {
    const associated = root.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(fieldEl.id)}"]`,
    )
    if (associated?.textContent?.trim()) {
      resolved = associated.textContent.trim()
    }
  }

  // 2. aria-labelledby (space-separated id list)
  if (!resolved) {
    const labelledBy = fieldEl.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => root.querySelector(`#${CSS.escape(id)}`)?.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
      if (text) resolved = text
    }
  }

  // 3. aria-label
  if (!resolved) {
    resolved = fieldEl.getAttribute('aria-label')?.trim() ?? ''
  }

  // 4. Closest ancestor <label>
  if (!resolved) {
    resolved = fieldEl.closest('label')?.textContent?.trim() ?? ''
  }

  // 5. placeholder
  if (!resolved) {
    resolved = fieldEl.getAttribute('placeholder')?.trim() ?? ''
  }

  // 6. name / id fallback
  if (!resolved) {
    resolved = (fieldEl as HTMLInputElement).name || fieldEl.id || ''
  }

  // Security review #6: truncate to prevent prompt injection via crafted labels
  return resolved.slice(0, LABEL_MAX_LENGTH)
}

/**
 * Resolve the label for a radio group.
 *
 * Checks for a <fieldset>/<legend> ancestor first (the semantic container
 * for a radio group). Falls back to the standard resolveLabel algorithm
 * applied to the first radio input in the group.
 */
function resolveRadioGroupLabel(firstRadio: HTMLInputElement, root: HTMLElement): string {
  const fieldsetEl = firstRadio.closest('fieldset')
  const legend = fieldsetEl?.querySelector('legend')
  if (legend?.textContent?.trim()) {
    return legend.textContent.trim().slice(0, LABEL_MAX_LENGTH)
  }
  return resolveLabel(firstRadio, root)
}

/**
 * Extract the non-empty option values from a <select> element.
 * Empty-string values are placeholders ("Select…") and are excluded.
 */
function extractSelectOptions(selectEl: HTMLSelectElement): readonly string[] {
  const options: string[] = []
  for (const option of Array.from(selectEl.options)) {
    if (option.value !== '') {
      options.push(option.value)
    }
  }
  return options
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scans a form element and returns a FormSchema inferred from the DOM structure.
 *
 * This is a best-effort inference. Always review the result via
 * `onSchemaDetected` before production use. Use `validateSchemaAgainstDOM()`
 * from `@voiceform/dev` to cross-check the result against the live DOM.
 *
 * Security: reads only element attributes and label text — structural metadata
 * authored by the developer. Does NOT read element.value (current user input).
 * (security review #6: label text truncated to 100 chars)
 *
 * Must be called inside a useEffect in React — never synchronously during
 * render. (security review #10)
 *
 * @param formElement  The root element to scan. Typically a <form> element.
 * @returns A FormSchema. May have zero fields if nothing is detectable.
 */
export function detectSchema(formElement: HTMLElement): FormSchema {
  const rawElements = Array.from(
    formElement.querySelectorAll<FormField>('input, select, textarea'),
  )

  // ── Pass 1: collect all radio group data keyed by name ─────────────────────
  // We must scan all radio inputs first so that when we encounter the first
  // radio of a group in pass 2, we already have the full options list.

  const radioGroups = new Map<string, { first: HTMLInputElement; options: string[] }>()

  for (const fieldEl of rawElements) {
    if (!(fieldEl instanceof HTMLInputElement) || fieldEl.type !== 'radio') continue

    const name = fieldEl.name?.trim() || fieldEl.id?.trim() || ''
    if (!name) continue // will be warned about in pass 2

    const existing = radioGroups.get(name)
    if (existing) {
      if (fieldEl.value) {
        existing.options.push(fieldEl.value)
      }
    } else {
      const options: string[] = []
      if (fieldEl.value) {
        options.push(fieldEl.value)
      }
      radioGroups.set(name, { first: fieldEl, options })
    }
  }

  // ── Pass 2: build the ordered field list ────────────────────────────────────
  // Preserves document order. Radio groups are emitted at the position of
  // their first radio input. Duplicate names are deduplicated.

  const fields: FieldSchema[] = []
  const emittedNames = new Set<string>()

  for (const fieldEl of rawElements) {
    // Exclusion filter: skip non-data-entry input types
    if (fieldEl instanceof HTMLInputElement) {
      if (EXCLUDED_INPUT_TYPES.has(fieldEl.type)) {
        continue
      }
    }

    // Name resolution: element.name takes precedence over element.id.
    // All three FormField variants (input, textarea, select) have a .name property.
    const name = (fieldEl as HTMLInputElement).name?.trim() || fieldEl.id?.trim() || ''

    if (!name) {
      console.warn(
        '[voice-form] detectSchema: skipping form element with no name or id attribute.',
        fieldEl,
      )
      continue
    }

    // Deduplication: skip if we've already emitted a field with this name
    if (emittedNames.has(name)) {
      continue
    }

    // ── Radio group ────────────────────────────────────────────────────────

    if (fieldEl instanceof HTMLInputElement && fieldEl.type === 'radio') {
      const group = radioGroups.get(name)
      if (!group) continue

      const label = resolveRadioGroupLabel(group.first, formElement)
      const radioField: FieldSchema = {
        name,
        label,
        type: 'radio',
        options: group.options,
        ...(group.first.required && { required: true }),
      }
      fields.push(radioField)
      emittedNames.add(name)
      continue
    }

    // ── Regular (non-radio) field ──────────────────────────────────────────

    const type = mapInputType(fieldEl)
    const label = resolveLabel(fieldEl, formElement)

    const fieldSchema: FieldSchema = {
      name,
      label,
      type,
      ...((fieldEl as HTMLInputElement).required && { required: true }),
    }

    if (fieldEl instanceof HTMLSelectElement) {
      const options = extractSelectOptions(fieldEl)
      if (options.length > 0) {
        fieldSchema.options = options
      }
    }

    fields.push(fieldSchema)
    emittedNames.add(name)
  }

  return { fields }
}
