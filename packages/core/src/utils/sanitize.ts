/**
 * @voiceform/core — Output Sanitization Utilities
 *
 * This module is the PRIMARY XSS defense layer for voice-form.
 *
 * Every value returned by the LLM endpoint passes through `sanitizeFieldValue`
 * before it is accepted into the state machine, displayed in the confirmation
 * panel, or injected into any DOM element. No LLM-returned string reaches
 * the application without being processed here first.
 *
 * Security context:
 *   CRIT-001: Unsanitized LLM Output in DOM Injection
 *   CWE-79:   Improper Neutralization of Input During Web Page Generation
 *   OWASP:    A03:2021 — Injection
 *
 * Design decisions:
 *
 * 1. `stripHtml` uses `DOMParser` rather than a regex. Regex-based HTML
 *    stripping has a well-documented history of bypasses. DOMParser uses the
 *    browser's own HTML5 parser, which handles all edge cases (malformed markup,
 *    entity encoding, nested structures) correctly by definition.
 *
 * 2. Fast path: strings with no '<' cannot contain HTML tags and bypass
 *    DOMParser entirely. This keeps the common case (clean LLM output) at
 *    near-zero cost.
 *
 * 3. `sanitizeFieldValue` accepts `string | boolean | string[]` so it covers
 *    all possible `ParsedFieldValue.value` shapes in one call. Booleans
 *    (checkboxes) pass through unchanged. String arrays have each element
 *    stripped individually.
 *
 * 4. Type-specific validation (number format, date format, select allowlist)
 *    is applied AFTER HTML stripping. This means a value of "<b>42</b>" for a
 *    number field will strip to "42" and then pass numeric validation. An
 *    attacker cannot bypass validation by wrapping invalid content in HTML.
 *
 * 5. For `select` and `radio` fields, validation is performed against the
 *    caller-supplied `options` array using case-insensitive matching. The
 *    CANONICAL casing from the options array is always returned — not the
 *    LLM-supplied casing. This prevents subtle mismatches between what the
 *    LLM returned and what the DOM option element expects.
 *
 * 6. `wasModified` is `true` whenever the output differs from the input
 *    (HTML was removed, casing was normalised, etc.). Callers can use this
 *    flag to surface a sanitization warning in the confirmation UI.
 */

import type { FieldType, FieldSchema, VoiceFormErrorCode } from '../types.js'

// ─── Concrete Error Class ─────────────────────────────────────────────────────

/**
 * Concrete, throwable implementation of the VoiceFormError interface.
 *
 * `VoiceFormError` in types.ts is a plain interface — not a class — so it
 * cannot be constructed with `new`. This class provides the throwable form
 * required by `sanitizeFieldValue`. It satisfies the interface shape exactly.
 *
 * Callers that catch errors from this module should check `err.code` (not
 * `instanceof SanitizeError`) for portability across module boundaries.
 */
class SanitizeError extends Error {
  readonly code: VoiceFormErrorCode
  readonly recoverable: boolean

  constructor(code: VoiceFormErrorCode, message: string) {
    super(message)
    this.name = 'VoiceFormError'
    this.code = code
    this.recoverable = true
  }
}

// ─── stripHtml ────────────────────────────────────────────────────────────────

/**
 * Strips all HTML markup from a string, returning only the plain text content.
 *
 * Uses the browser's built-in `DOMParser` to parse the input as `text/html`
 * and extracts `document.body.textContent`. This handles all well-formed and
 * malformed HTML correctly, including:
 *   - Inline elements:     `<b>`, `<i>`, `<span>`, `<a>`
 *   - Block elements:      `<div>`, `<p>`, `<table>`
 *   - Script injection:    `<script>alert(1)</script>`
 *   - Event handlers:      `<img onerror="...">`
 *   - Nested structures:   `<div><p><b>text</b></p></div>`
 *   - HTML entities:       decoded automatically by DOMParser
 *
 * Fast path: strings with no `<` character cannot contain HTML tags and are
 * returned as-is, avoiding the cost of constructing a parsed document.
 *
 * @param value - The string to sanitize. May be empty.
 * @returns The plain-text content with all HTML stripped. Never throws.
 *
 * @example
 * stripHtml('<b>John</b>')                        // → 'John'
 * stripHtml("<script>alert('xss')</script>name")  // → 'name'
 * stripHtml('no tags here')                       // → 'no tags here' (fast path)
 */
export function stripHtml(value: string): string {
  // Fast path: if the string has no '<', it cannot contain any HTML tag.
  // Return immediately without allocating a DOMParser or Document.
  if (!value.includes('<')) return value

  // Parse the string as a full HTML document. DOMParser always succeeds —
  // it never throws for malformed input; it produces a best-effort parse tree.
  const doc = new DOMParser().parseFromString(value, 'text/html')

  // `body.textContent` concatenates all text nodes in the body, recursively,
  // with no separators between sibling elements. This correctly handles nested
  // and adjacent tags. The nullish coalesce covers the (impossible in practice)
  // case where the body element is null.
  return doc.body.textContent ?? ''
}

// ─── Sanitize result type ─────────────────────────────────────────────────────

/**
 * The return type of `sanitizeFieldValue`. Carries the sanitized value and
 * a flag indicating whether the value was altered from the original input.
 */
export type SanitizeResult = {
  /** The sanitized value, ready for use in the state machine and DOM. */
  value: string | boolean | string[]
  /**
   * `true` if the output differs from the input in any way:
   *   - HTML was stripped from a string value
   *   - Casing was normalized to match a canonical option in the options array
   *   - One or more elements of a string array were modified
   * `false` if the output is byte-for-byte identical to the input.
   */
  wasModified: boolean
}

// ─── sanitizeFieldValue ───────────────────────────────────────────────────────

/**
 * Validates and sanitizes a field value for a specific `FieldType`.
 *
 * Dispatch logic by input type:
 *
 * **`boolean` input** (checkbox fields)
 *   Passed through as-is. Checkboxes cannot contain HTML; there is nothing to
 *   strip or validate.
 *
 * **`string[]` input** (multi-select, future multi-value types)
 *   `stripHtml` is applied to each element individually. The array is never
 *   mutated — a new array is always returned.
 *
 * **`string` input** (all other field types)
 *   1. `stripHtml` is called to remove any HTML from the value.
 *   2. Type-specific validation is applied to the stripped result:
 *      - `'number'`:          Must match `/^-?\d+(\.\d+)?$/`
 *      - `'date'`:            Must match `/^\d{4}-\d{2}-\d{2}$/`
 *      - `'select'`/`'radio'`: Must appear in `options` (case-insensitive);
 *                              canonical casing from `options` is returned.
 *      - All other types:    HTML stripping only; no further constraints.
 *
 * @param value     - The raw value from the LLM response.
 * @param fieldType - The FieldType from the FormSchema for this field.
 * @param options   - Required for `select` and `radio` types. The exhaustive
 *                    list of valid option values from the FieldSchema.
 *
 * @returns `{ value, wasModified }` where `value` is safe to use.
 *
 * @throws {SanitizeError} with `code: 'INVALID_FIELD_VALUE'` when:
 *   - A `number` field value is not a valid numeric string after stripping
 *   - A `date` field value does not match ISO 8601 (YYYY-MM-DD) after stripping
 *   - A `select` or `radio` field value is not in the `options` array
 *
 * @example
 * sanitizeFieldValue('<b>John</b>', 'text')
 * // → { value: 'John', wasModified: true }
 *
 * sanitizeFieldValue('42.5', 'number')
 * // → { value: '42.5', wasModified: false }
 *
 * sanitizeFieldValue('MALE', 'select', ['Male', 'Female', 'Other'])
 * // → { value: 'Male', wasModified: true }
 *
 * sanitizeFieldValue(true, 'checkbox')
 * // → { value: true, wasModified: false }
 */
export function sanitizeFieldValue(
  value: string | boolean | string[],
  fieldType: FieldType,
  options?: readonly string[],
): SanitizeResult {
  // ── Boolean passthrough ──────────────────────────────────────────────────
  // Checkbox values are booleans — HTML stripping and format validation are
  // not applicable. Return immediately without any modification.
  if (typeof value === 'boolean') {
    return { value, wasModified: false }
  }

  // ── String array: strip each element individually ────────────────────────
  // A new array is always constructed — the original is never mutated.
  if (Array.isArray(value)) {
    const stripped = value.map((element) => stripHtml(element))
    const wasModified = stripped.some((s, i) => s !== value[i])
    return { value: stripped, wasModified }
  }

  // ── String: strip HTML, then apply type-specific validation ───────────────
  const stripped = stripHtml(value)

  switch (fieldType) {
    // ── Number ─────────────────────────────────────────────────────────────
    // Accepts integers and decimals, optionally negative.
    // Rejects: empty string, alphanumeric mix, whitespace, currency symbols.
    case 'number': {
      if (!/^-?\d+(\.\d+)?$/.test(stripped)) {
        throw new SanitizeError(
          'INVALID_FIELD_VALUE',
          `LLM returned non-numeric value for number field: "${stripped}"`,
        )
      }
      return { value: stripped, wasModified: stripped !== value }
    }

    // ── Date ────────────────────────────────────────────────────────────────
    // Only ISO 8601 short form (YYYY-MM-DD) is accepted.
    // Rejects: human-readable dates, partial dates, different delimiters.
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stripped)) {
        throw new SanitizeError(
          'INVALID_FIELD_VALUE',
          `LLM returned invalid date format for date field: "${stripped}" (expected YYYY-MM-DD)`,
        )
      }
      return { value: stripped, wasModified: stripped !== value }
    }

    // ── Select / Radio ──────────────────────────────────────────────────────
    // The value must appear in the caller-supplied `options` array.
    // Matching is case-insensitive. The CANONICAL casing from the options
    // array is returned, not the LLM-supplied casing.
    //
    // If `options` is undefined or empty, there are no valid values — throw.
    // This prevents a schema misconfiguration from silently accepting anything.
    case 'select':
    case 'radio': {
      if (!options || options.length === 0) {
        throw new SanitizeError(
          'INVALID_FIELD_VALUE',
          `sanitizeFieldValue: no options provided for ${fieldType} field`,
        )
      }

      const strippedLower = stripped.toLowerCase()
      const match = options.find((opt) => opt.toLowerCase() === strippedLower)

      if (match === undefined) {
        throw new SanitizeError(
          'INVALID_FIELD_VALUE',
          `LLM returned value "${stripped}" which is not in the options list for ${fieldType} field`,
        )
      }

      // Return canonical casing. wasModified is true if EITHER:
      //   (a) HTML was stripped (stripped !== value), OR
      //   (b) the canonical match differs from the stripped value (casing was normalized)
      const wasModified = stripped !== value || match !== stripped
      return { value: match, wasModified }
    }

    // ── All other types (text, email, tel, textarea) ─────────────────────────
    // HTML stripping is the only transformation applied.
    default: {
      return { value: stripped, wasModified: stripped !== value }
    }
  }
}

// ─── validateFieldConstraints ─────────────────────────────────────────────────

/**
 * The result of constraint validation for a single field.
 */
export interface ConstraintValidationResult {
  /** True if the value satisfies all configured constraints. */
  valid: boolean
  /**
   * Human-readable reason for failure.
   * Only present when `valid` is false.
   */
  reason?: string
}

/**
 * Evaluates the `FieldValidation` constraints (minLength, maxLength, min, max,
 * pattern) of a FieldSchema against a sanitized string value.
 *
 * This function is called by `buildConfirmationData` after `sanitizeFieldValue`
 * to enforce developer-specified constraints on LLM-returned values.
 * Constraint violations are reported via `ConfirmationData.invalidFields` but
 * do NOT block injection — consistent with the contract in types.ts lines 30–32.
 *
 * Security notes:
 *   NEW-002: Enforces constraints that were previously advertised to the LLM
 *   in the prompt but never verified on returned values. Without enforcement, a
 *   constrained field accepts any LLM-returned value (out-of-range numbers,
 *   over-length strings, etc.) silently.
 *
 *   ADV-002 / MED-001: `pattern` evaluation is intentionally SKIPPED.
 *   Developer-supplied regex patterns applied as `new RegExp(pattern).test()`
 *   are a ReDoS attack surface — a maliciously crafted or poorly written pattern
 *   could block the browser's main thread. This will be addressed in a future
 *   release with a time-bounded evaluation guard.
 *   TODO: implement time-bounded pattern evaluation (see ADV-002 in CODE_SECURITY_REVIEW.md)
 *
 * @param value - The sanitized string value to check (post-stripHtml).
 * @param field - The FieldSchema containing the validation constraints.
 * @returns `{ valid: true }` if all constraints pass or none are configured.
 *          `{ valid: false, reason: string }` on the first failing constraint.
 */
export function validateFieldConstraints(
  value: string,
  field: FieldSchema,
): ConstraintValidationResult {
  const v = field.validation
  if (!v) return { valid: true }

  // ── minLength ────────────────────────────────────────────────────────────
  if (v.minLength !== undefined && value.length < v.minLength) {
    return {
      valid: false,
      reason: `Value length ${value.length} is below minLength ${v.minLength}`,
    }
  }

  // ── maxLength ────────────────────────────────────────────────────────────
  if (v.maxLength !== undefined && value.length > v.maxLength) {
    return {
      valid: false,
      reason: `Value length ${value.length} exceeds maxLength ${v.maxLength}`,
    }
  }

  // ── min / max (numeric constraints) ─────────────────────────────────────
  // Only evaluated when the value is a valid finite number. If parsing fails,
  // we report invalid so constraint-misconfigured values are not silently accepted.
  if (v.min !== undefined || v.max !== undefined) {
    const numeric = Number(value)
    if (!isFinite(numeric)) {
      return {
        valid: false,
        reason: `Value "${value}" is not a valid number — cannot evaluate min/max constraints`,
      }
    }
    if (v.min !== undefined && numeric < v.min) {
      return {
        valid: false,
        reason: `Value ${numeric} is below min ${v.min}`,
      }
    }
    if (v.max !== undefined && numeric > v.max) {
      return {
        valid: false,
        reason: `Value ${numeric} exceeds max ${v.max}`,
      }
    }
  }

  // ── pattern — SKIPPED (ReDoS protection, ADV-002) ────────────────────────
  // TODO: implement time-bounded pattern evaluation before enabling this.
  if (v.pattern !== undefined && process.env.NODE_ENV !== 'production') {
    console.warn(
      `[voice-form] Pattern validation is not yet implemented due to ReDoS risk. ` +
      `Pattern "${v.pattern}" on field "${field.name}" will be ignored. See docs/SECURITY.md.`
    )
  }

  return { valid: true }
}
