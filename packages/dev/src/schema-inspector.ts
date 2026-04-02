/**
 * @voiceform/dev — Schema Inspector
 *
 * Provides `inspectSchema` and `validateSchemaAgainstDOM` for development-time
 * diagnostics. Both functions are no-ops in production.
 *
 * Security: none of these functions are included in production bundles when
 * tree-shaken, because the production guard returns early with empty results.
 */

import type { FormSchema } from '@voiceform/core'

// ─── Public Types ─────────────────────────────────────────────────────────────

/**
 * A single diagnostic finding from schema inspection.
 * Severity levels: `error` (will cause failures), `warning` (likely bug),
 * `suggestion` (quality improvement).
 */
export interface SchemaDiagnostic {
  /** The field name this diagnostic is about, or '__schema__' for top-level issues. */
  field: string
  /** Diagnostic severity level. */
  severity: 'error' | 'warning' | 'suggestion'
  /** Human-readable description of the issue. */
  message: string
}

/**
 * The result of `inspectSchema`.
 */
export interface SchemaInspectionResult {
  /**
   * True if no `error`-severity diagnostics were found.
   * `warning` and `suggestion` diagnostics do not affect validity.
   */
  valid: boolean
  /** Total number of fields in the schema. */
  fieldCount: number
  /** All diagnostic findings, sorted by severity (error > warning > suggestion). */
  diagnostics: SchemaDiagnostic[]
}

/**
 * The result of `validateSchemaAgainstDOM`.
 */
export interface DOMValidationResult {
  /** Field names from the schema that could not be found in the DOM. */
  missingInDOM: string[]
  /** Field names found in the DOM that have no corresponding schema entry. */
  unmatchedInDOM: string[]
  /** Field names that matched successfully. */
  matched: string[]
}

// ─── CSS Special-Character Pattern ────────────────────────────────────────────

/**
 * Characters in a CSS identifier that would break a bare attribute selector
 * such as `[name=<value>]` without CSS.escape().
 * Matches whitespace or any CSS special character.
 */
const CSS_SPECIAL_CHARS_RE = /[\s!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/

// ─── inspectSchema ────────────────────────────────────────────────────────────

/**
 * Runs rich diagnostics on a `FormSchema` and returns findings.
 *
 * Diagnostic rules applied:
 * - **ERROR**: field name contains whitespace or CSS special characters
 * - **ERROR**: duplicate field name (both entries are flagged)
 * - **WARNING**: field has no `label` (LLM receives `name` only)
 * - **WARNING**: `select` or `radio` field has fewer than 2 options
 * - **SUGGESTION**: `description` longer than 200 characters
 * - **SUGGESTION**: `formName` or `formDescription` absent from schema
 * - **SUGGESTION**: `required: true` on a `checkbox` field (always boolean, no effect)
 *
 * No-op in production — returns `{ valid: true, fieldCount, diagnostics: [] }`
 * without running any rules or calling any `console.*` method.
 *
 * @param schema  The `FormSchema` to inspect.
 * @returns A `SchemaInspectionResult` with all diagnostics.
 */
export function inspectSchema(schema: FormSchema): SchemaInspectionResult {
  if (process.env['NODE_ENV'] === 'production') {
    return { valid: true, fieldCount: schema.fields.length, diagnostics: [] }
  }

  const diagnostics: SchemaDiagnostic[] = []

  // ── Top-level schema suggestions ────────────────────────────────────────────
  if (!schema.formName || !schema.formDescription) {
    diagnostics.push({
      field: '__schema__',
      severity: 'suggestion',
      message:
        'formName and formDescription are absent. ' +
        'Providing them gives the LLM useful context and improves field extraction accuracy.',
    })
  }

  // ── Detect duplicate field names ─────────────────────────────────────────────
  const nameCounts = new Map<string, number>()
  for (const field of schema.fields) {
    nameCounts.set(field.name, (nameCounts.get(field.name) ?? 0) + 1)
  }
  const duplicateNames = new Set(
    [...nameCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  )

  // ── Per-field rules ───────────────────────────────────────────────────────────
  for (const field of schema.fields) {
    const { name } = field

    // ERROR: duplicate field name
    if (duplicateNames.has(name)) {
      diagnostics.push({
        field: name,
        severity: 'error',
        message:
          `Field name "${name}" appears more than once in the schema. ` +
          'Field names must be unique — duplicate names cause unpredictable injection behaviour.',
      })
    }

    // ERROR: field name contains CSS special characters or whitespace
    if (CSS_SPECIAL_CHARS_RE.test(name)) {
      diagnostics.push({
        field: name,
        severity: 'error',
        message:
          `Field name "${name}" contains characters that break CSS attribute selectors ` +
          '(whitespace, dots, brackets, etc.). ' +
          'Use a plain alphanumeric name with hyphens or underscores only.',
      })
    }

    // WARNING: missing label
    if (!field.label) {
      diagnostics.push({
        field: name,
        severity: 'warning',
        message:
          `Field "${name}" has no label. ` +
          'The LLM will receive the field name as the label, which may reduce extraction accuracy.',
      })
    }

    // WARNING: select/radio with fewer than 2 options
    if (field.type === 'select' || field.type === 'radio') {
      const optionCount = field.options?.length ?? 0
      if (optionCount < 2) {
        diagnostics.push({
          field: name,
          severity: 'warning',
          message:
            `Field "${name}" is type "${field.type}" but has ${optionCount} option(s). ` +
            'Select and radio fields require at least 2 options for the LLM to choose from.',
        })
      }
    }

    // SUGGESTION: description longer than 200 characters
    if (field.description !== undefined && field.description.length > 200) {
      diagnostics.push({
        field: name,
        severity: 'suggestion',
        message:
          `Field "${name}" has a description of ${field.description.length} characters (limit: 200). ` +
          'Long descriptions inflate the LLM prompt token count. Consider condensing it.',
      })
    }

    // SUGGESTION: required: true on a checkbox field
    if (field.type === 'checkbox' && field.required === true) {
      diagnostics.push({
        field: name,
        severity: 'suggestion',
        message:
          `Field "${name}" is a checkbox with required: true. ` +
          'Checkbox fields always produce a boolean value — required has no meaningful effect here.',
      })
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === 'error')

  return {
    valid: !hasErrors,
    fieldCount: schema.fields.length,
    diagnostics,
  }
}

// ─── validateSchemaAgainstDOM ─────────────────────────────────────────────────

/**
 * Queries the DOM to find which schema fields have matching elements.
 *
 * Uses the same 3-step element lookup strategy as the core injector:
 *   1. `[name="<escaped>"]`
 *   2. `#<escaped>` (id selector)
 *   3. `[data-voiceform="<escaped>"]`
 *
 * Logs a `console.group` / `console.table` summary in development.
 * No-op in production — returns `{ missingInDOM: [], unmatchedInDOM: [], matched: [] }`.
 *
 * @param schema       The `FormSchema` to validate.
 * @param formElement  The root element to search within.
 * @returns A `DOMValidationResult` with matching and missing fields.
 */
export function validateSchemaAgainstDOM(
  schema: FormSchema,
  formElement: HTMLElement,
): DOMValidationResult {
  if (process.env['NODE_ENV'] === 'production') {
    return { missingInDOM: [], unmatchedInDOM: [], matched: [] }
  }

  const schemaNames = new Set(schema.fields.map((f) => f.name))
  const matched: string[] = []
  const missingInDOM: string[] = []

  for (const field of schema.fields) {
    const escaped = CSS.escape(field.name)
    const el =
      formElement.querySelector(`[name="${escaped}"]`) ??
      formElement.querySelector(`#${escaped}`) ??
      formElement.querySelector(`[data-voiceform="${escaped}"]`)

    if (el !== null) {
      matched.push(field.name)
    } else {
      missingInDOM.push(field.name)
    }
  }

  // Collect DOM inputs that have no schema entry
  const domElements = formElement.querySelectorAll('input, select, textarea')
  const unmatchedInDOM: string[] = []
  for (const el of domElements) {
    const inputEl = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    const identifier =
      inputEl.getAttribute('data-voiceform') ?? inputEl.name ?? inputEl.id ?? null
    if (identifier && !schemaNames.has(identifier)) {
      unmatchedInDOM.push(identifier)
    }
  }

  console.group('[voiceform dev] validateSchemaAgainstDOM')
  console.table({
    matched: matched.join(', ') || '(none)',
    missingInDOM: missingInDOM.join(', ') || '(none)',
    unmatchedInDOM: unmatchedInDOM.join(', ') || '(none)',
  })
  console.groupEnd()

  return { missingInDOM, unmatchedInDOM, matched }
}
