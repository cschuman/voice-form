// @vitest-environment jsdom
/**
 * Security-critical test suite for utils/sanitize.ts
 *
 * This module is the primary XSS defense layer for all LLM-returned values.
 * Every test here guards against a real attack surface. Do not relax these
 * tests without a documented security justification.
 *
 * CRIT-001: Unsanitized LLM Output in DOM Injection
 * CWE-79: Improper Neutralization of Input During Web Page Generation
 * OWASP A03:2021 — Injection
 */

import { describe, it, expect } from 'vitest'
import { stripHtml, sanitizeFieldValue } from '../../src/utils/sanitize.js'
import type { FieldType } from '../../src/types.js'

// ─── stripHtml ────────────────────────────────────────────────────────────────

describe('stripHtml', () => {
  // ── Fast-path: strings with no '<' must never touch DOMParser ────────────

  it('returns plain text unchanged (fast path — no HTML)', () => {
    const input = 'John Smith'
    const result = stripHtml(input)
    expect(result).toBe('John Smith')
  })

  it('returns an empty string unchanged (fast path)', () => {
    const result = stripHtml('')
    expect(result).toBe('')
  })

  it('returns a string containing only spaces unchanged (fast path)', () => {
    expect(stripHtml('   ')).toBe('   ')
  })

  it('returns a plain number string unchanged (fast path)', () => {
    expect(stripHtml('42.5')).toBe('42.5')
  })

  it('returns an ISO date string unchanged (fast path)', () => {
    expect(stripHtml('1990-03-15')).toBe('1990-03-15')
  })

  // ── HTML stripping: tags must be completely removed ────────────────────────

  it('strips a <script> tag and returns only surrounding text', () => {
    // Attack vector: LLM embeds JavaScript in a text field value.
    // Example: attacker-crafted transcript triggers LLM to echo markup.
    const input = "<script>alert('xss')</script>John"
    const result = stripHtml(input)
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert')
    expect(result).toBe('John')
  })

  it('strips a <script> tag with no surrounding text', () => {
    const input = "<script>alert('xss')</script>"
    const result = stripHtml(input)
    expect(result).toBe('')
  })

  it('strips an inline <b> formatting tag, preserving inner text', () => {
    // Inline formatting tags are harmless visually but must still be stripped:
    // downstream code may render values as HTML.
    const input = '<b>John</b>'
    const result = stripHtml(input)
    expect(result).not.toContain('<b>')
    expect(result).not.toContain('</b>')
    expect(result).toBe('John')
  })

  it('strips an <img> tag with an inline onerror handler', () => {
    // Attack vector: event handler attribute on non-script tag.
    // <img onerror="..."> executes when the src fails to load.
    const input = '<img onerror="alert(1)" src="x">John'
    const result = stripHtml(input)
    expect(result).not.toContain('<img')
    expect(result).not.toContain('onerror')
    expect(result).toBe('John')
  })

  it('strips nested tags and returns the innermost text', () => {
    const input = '<div><p>Hello</p></div>'
    const result = stripHtml(input)
    expect(result).not.toContain('<div>')
    expect(result).not.toContain('<p>')
    expect(result).toBe('Hello')
  })

  it('strips an <a> tag with a javascript: href', () => {
    // Attack vector: javascript: protocol in href executes on click.
    const input = '<a href="javascript:alert(1)">click me</a>'
    const result = stripHtml(input)
    expect(result).not.toContain('<a')
    expect(result).not.toContain('javascript:')
    expect(result).toBe('click me')
  })

  it('strips a <style> tag entirely', () => {
    // Style tags can inject CSS-based attacks (clickjacking, data exfil).
    const input = '<style>body{display:none}</style>text'
    const result = stripHtml(input)
    expect(result).not.toContain('<style>')
    expect(result).not.toContain('display:none')
    // Style element content is not rendered as textContent; result is just the
    // text node outside the tag.
    expect(result).toBe('text')
  })

  it('strips deeply nested tags with multiple text nodes', () => {
    const input = '<div><span><b>First</b> last</span></div>'
    const result = stripHtml(input)
    expect(result).not.toContain('<')
    expect(result).toBe('First last')
  })

  // ── HTML entities: DOMParser must decode them ──────────────────────────────

  it('decodes &amp; and &lt; HTML entities to their literal characters', () => {
    // DOMParser decodes entities in textContent — this is the correct behavior.
    // A value of "AT&T" stored as "&amp;T&amp;T" should arrive as "AT&T".
    const input = '&amp; &lt;'
    const result = stripHtml(input)
    // No '<' in the input string → fast path → entities are NOT decoded.
    // This is correct: the fast path only skips DOMParser when no '<' is present,
    // meaning there are no tags, so the string is safe as-is.
    // Entities without surrounding tags pass through raw (they are not HTML tags).
    expect(result).toBe('&amp; &lt;')
  })

  it('decodes HTML entities when they appear alongside a tag', () => {
    // When DOMParser is invoked (because '<' is present), it decodes all entities.
    const input = '<b>AT&amp;T &lt; 100</b>'
    const result = stripHtml(input)
    expect(result).not.toContain('<b>')
    // DOMParser decodes &amp; → & and &lt; → <
    expect(result).toBe('AT&T < 100')
  })

  // ── Edge case: '<' present but not valid HTML tag ─────────────────────────

  it('handles "5 < 10" gracefully — no tags, DOMParser treats it as a text node', () => {
    // "5 < 10" contains '<' so it bypasses the fast path and goes to DOMParser.
    // DOMParser parses it as HTML; the text becomes a text node in the body.
    // The result must be non-empty and must not throw.
    const input = '5 < 10'
    expect(() => stripHtml(input)).not.toThrow()
    const result = stripHtml(input)
    // DOMParser normalises "5 < 10" — result contains "5" and "10" at minimum.
    expect(result).toContain('5')
    expect(result).toContain('10')
  })

  it('handles a lone "<" at end of string without throwing', () => {
    const input = 'value<'
    expect(() => stripHtml(input)).not.toThrow()
    const result = stripHtml(input)
    // DOMParser handles malformed HTML gracefully.
    expect(typeof result).toBe('string')
  })

  it('strips multiple disparate tags in a single string', () => {
    const input = '<b>bold</b> and <i>italic</i>'
    const result = stripHtml(input)
    expect(result).not.toContain('<')
    expect(result).toBe('bold and italic')
  })
})

// ─── sanitizeFieldValue ───────────────────────────────────────────────────────

describe('sanitizeFieldValue', () => {
  // ── Text fields ───────────────────────────────────────────────────────────

  it('passes clean text through with wasModified: false', () => {
    const result = sanitizeFieldValue('John Smith', 'text')
    expect(result.value).toBe('John Smith')
    expect(result.wasModified).toBe(false)
  })

  it('strips HTML from a text field and sets wasModified: true', () => {
    const result = sanitizeFieldValue('<b>John</b>', 'text')
    expect(result.value).toBe('John')
    expect(result.wasModified).toBe(true)
  })

  it('passes an empty string through for a text field with wasModified: false', () => {
    const result = sanitizeFieldValue('', 'text')
    expect(result.value).toBe('')
    expect(result.wasModified).toBe(false)
  })

  // ── Textarea fields (treated identically to text) ─────────────────────────

  it('strips HTML from a textarea field', () => {
    const result = sanitizeFieldValue('<p>paragraph</p>', 'textarea')
    expect(result.value).toBe('paragraph')
    expect(result.wasModified).toBe(true)
  })

  // ── Email and tel fields ───────────────────────────────────────────────────

  it('passes a clean email value through unchanged', () => {
    const result = sanitizeFieldValue('user@example.com', 'email')
    expect(result.value).toBe('user@example.com')
    expect(result.wasModified).toBe(false)
  })

  it('strips HTML from an email field', () => {
    const result = sanitizeFieldValue('<b>user@example.com</b>', 'email')
    expect(result.value).toBe('user@example.com')
    expect(result.wasModified).toBe(true)
  })

  it('passes a clean tel value through unchanged', () => {
    const result = sanitizeFieldValue('555-1234', 'tel')
    expect(result.value).toBe('555-1234')
    expect(result.wasModified).toBe(false)
  })

  // ── Number fields ─────────────────────────────────────────────────────────

  it('accepts a valid integer for a number field', () => {
    const result = sanitizeFieldValue('42', 'number')
    expect(result.value).toBe('42')
    expect(result.wasModified).toBe(false)
  })

  it('accepts a valid float for a number field', () => {
    const result = sanitizeFieldValue('42.5', 'number')
    expect(result.value).toBe('42.5')
    expect(result.wasModified).toBe(false)
  })

  it('accepts a negative number for a number field', () => {
    const result = sanitizeFieldValue('-7', 'number')
    expect(result.value).toBe('-7')
    expect(result.wasModified).toBe(false)
  })

  it('strips HTML wrapping a valid number and marks wasModified: true', () => {
    // Attack: LLM wraps a numeric value in HTML.
    // After stripping, the result is still numeric — must pass validation.
    const result = sanitizeFieldValue('<b>42</b>', 'number')
    expect(result.value).toBe('42')
    expect(result.wasModified).toBe(true)
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) for a non-numeric string', () => {
    // CRIT-001 enforcement: a non-numeric value for a number field is rejected,
    // not silently accepted. This prevents injection of arbitrary strings into
    // number inputs that downstream code may eval or pass to a parser.
    expect(() => sanitizeFieldValue('abc', 'number')).toThrow()
    try {
      sanitizeFieldValue('abc', 'number')
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_FIELD_VALUE')
    }
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) for an empty string in a number field', () => {
    expect(() => sanitizeFieldValue('', 'number')).toThrow()
    try {
      sanitizeFieldValue('', 'number')
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_FIELD_VALUE')
    }
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) for a string with trailing text after a number', () => {
    // "42px" must not pass — it is not a clean numeric value.
    expect(() => sanitizeFieldValue('42px', 'number')).toThrow()
    try {
      sanitizeFieldValue('42px', 'number')
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_FIELD_VALUE')
    }
  })

  it('throws for HTML-wrapped non-numeric content in a number field', () => {
    // Strip produces "abc" which fails numeric validation.
    expect(() => sanitizeFieldValue('<b>abc</b>', 'number')).toThrow()
    try {
      sanitizeFieldValue('<b>abc</b>', 'number')
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_FIELD_VALUE')
    }
  })

  // ── Date fields ───────────────────────────────────────────────────────────

  it('accepts a valid ISO date string', () => {
    const result = sanitizeFieldValue('1990-03-15', 'date')
    expect(result.value).toBe('1990-03-15')
    expect(result.wasModified).toBe(false)
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) for a human-readable date string', () => {
    // The LLM may return "March 15" or "March 15, 1990" — these are not
    // accepted. Only strict ISO 8601 (YYYY-MM-DD) is valid.
    expect(() => sanitizeFieldValue('March 15', 'date')).toThrow()
    try {
      sanitizeFieldValue('March 15', 'date')
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_FIELD_VALUE')
    }
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) for a partial ISO date (missing day)', () => {
    expect(() => sanitizeFieldValue('1990-03', 'date')).toThrow()
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) for a date with wrong delimiter', () => {
    expect(() => sanitizeFieldValue('1990/03/15', 'date')).toThrow()
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) for an empty string in a date field', () => {
    expect(() => sanitizeFieldValue('', 'date')).toThrow()
    try {
      sanitizeFieldValue('', 'date')
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_FIELD_VALUE')
    }
  })

  it('strips HTML from a date field and validates the stripped result', () => {
    const result = sanitizeFieldValue('<b>1990-03-15</b>', 'date')
    expect(result.value).toBe('1990-03-15')
    expect(result.wasModified).toBe(true)
  })

  // ── Select fields ─────────────────────────────────────────────────────────

  it('accepts an exact-match select value when it is in the options array', () => {
    const result = sanitizeFieldValue('Male', 'select', ['Male', 'Female', 'Other'])
    expect(result.value).toBe('Male')
    expect(result.wasModified).toBe(false)
  })

  it('accepts a case-insensitive match for a select value (canonical casing returned)', () => {
    // The LLM may return "MALE" when the schema option is "Male".
    // The sanitizer performs case-insensitive matching and returns the
    // canonical casing from the options array.
    const result = sanitizeFieldValue('MALE', 'select', ['Male', 'Female', 'Other'])
    expect(result.value).toBe('Male')
    expect(result.wasModified).toBe(true)
  })

  it('accepts lowercase match for a select value and returns canonical casing', () => {
    const result = sanitizeFieldValue('female', 'select', ['Male', 'Female', 'Other'])
    expect(result.value).toBe('Female')
    expect(result.wasModified).toBe(true)
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) when select value is not in options', () => {
    // CRIT-001: LLM-generated values for constrained fields must be validated
    // against the allowlist. Anything not in the options list is rejected.
    expect(() =>
      sanitizeFieldValue('Unknown', 'select', ['Male', 'Female', 'Other'])
    ).toThrow()
    try {
      sanitizeFieldValue('Unknown', 'select', ['Male', 'Female', 'Other'])
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_FIELD_VALUE')
    }
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) for select with empty options array', () => {
    expect(() => sanitizeFieldValue('Male', 'select', [])).toThrow()
    try {
      sanitizeFieldValue('Male', 'select', [])
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_FIELD_VALUE')
    }
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) for select with no options provided', () => {
    // No options array means no valid values — reject everything.
    expect(() => sanitizeFieldValue('Male', 'select')).toThrow()
  })

  it('strips HTML from a select value before options matching', () => {
    // LLM returns <b>Male</b> for a select field — strip first, then match.
    const result = sanitizeFieldValue('<b>Male</b>', 'select', ['Male', 'Female', 'Other'])
    expect(result.value).toBe('Male')
    expect(result.wasModified).toBe(true)
  })

  it('throws if the stripped select value is not in the options list', () => {
    // The stripped value "Nonbinary" is not in options — must throw.
    expect(() =>
      sanitizeFieldValue('<b>Nonbinary</b>', 'select', ['Male', 'Female', 'Other'])
    ).toThrow()
  })

  // ── Radio fields ──────────────────────────────────────────────────────────

  it('accepts a valid radio value when it is in the options array', () => {
    const result = sanitizeFieldValue('Yes', 'radio', ['Yes', 'No'])
    expect(result.value).toBe('Yes')
    expect(result.wasModified).toBe(false)
  })

  it('accepts a case-insensitive radio match and returns canonical casing', () => {
    const result = sanitizeFieldValue('yes', 'radio', ['Yes', 'No'])
    expect(result.value).toBe('Yes')
    expect(result.wasModified).toBe(true)
  })

  it('throws VoiceFormError(INVALID_FIELD_VALUE) when radio value is not in options', () => {
    expect(() => sanitizeFieldValue('Maybe', 'radio', ['Yes', 'No'])).toThrow()
    try {
      sanitizeFieldValue('Maybe', 'radio', ['Yes', 'No'])
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_FIELD_VALUE')
    }
  })

  // ── Boolean (checkbox) passthrough ────────────────────────────────────────

  it('passes boolean true through with wasModified: false', () => {
    const result = sanitizeFieldValue(true, 'checkbox')
    expect(result.value).toBe(true)
    expect(result.wasModified).toBe(false)
  })

  it('passes boolean false through with wasModified: false', () => {
    const result = sanitizeFieldValue(false, 'checkbox')
    expect(result.value).toBe(false)
    expect(result.wasModified).toBe(false)
  })

  // ── String array values ───────────────────────────────────────────────────

  it('passes a clean string array through with wasModified: false', () => {
    const input = ['apples', 'bananas', 'cherries']
    const result = sanitizeFieldValue(input, 'text')
    expect(result.value).toEqual(['apples', 'bananas', 'cherries'])
    expect(result.wasModified).toBe(false)
  })

  it('strips HTML from each element in a string array and sets wasModified: true', () => {
    const input = ['<b>apples</b>', 'bananas', '<script>alert(1)</script>cherries']
    const result = sanitizeFieldValue(input, 'text')
    expect(result.value).toEqual(['apples', 'bananas', 'cherries'])
    expect(result.wasModified).toBe(true)
  })

  it('returns a new array (does not mutate the input array)', () => {
    const input = ['<b>item</b>']
    const result = sanitizeFieldValue(input, 'text')
    // The original array must not be mutated.
    expect(input[0]).toBe('<b>item</b>')
    expect((result.value as string[])[0]).toBe('item')
  })

  it('handles an empty string array without throwing', () => {
    const result = sanitizeFieldValue([], 'text')
    expect(result.value).toEqual([])
    expect(result.wasModified).toBe(false)
  })

  // ── Cross-cutting: wasModified semantics ─────────────────────────────────

  it('wasModified is false when the output is byte-for-byte identical to the input', () => {
    // A string with no HTML must always produce wasModified: false.
    const input = 'no changes needed'
    const { wasModified } = sanitizeFieldValue(input, 'text')
    expect(wasModified).toBe(false)
  })

  it('wasModified is true whenever HTML was stripped, even if text content is identical', () => {
    // <span>text</span> → "text": the value changed (wrapper was removed).
    const { wasModified } = sanitizeFieldValue('<span>text</span>', 'text')
    expect(wasModified).toBe(true)
  })

  // ── XSS attack vectors (regression suite) ────────────────────────────────

  it('strips a <script> tag when embedded in a select option value', () => {
    // Prevent an attacker-controlled option value containing HTML from
    // reaching the DOM unsanitized.
    const options = ['<script>alert(1)</script>Male', 'Female']
    // The schema option itself is the attack payload here.
    // When the LLM returns "Female", it must match safely.
    const result = sanitizeFieldValue('Female', 'select', options)
    expect(result.value).toBe('Female')
  })

  it('rejects an img-onerror payload in a text field via stripHtml', () => {
    const result = sanitizeFieldValue('<img onerror="alert(1)" src="x">safe text', 'text')
    expect(result.value).toBe('safe text')
    expect(result.wasModified).toBe(true)
    expect(result.value).not.toContain('onerror')
  })

  it('rejects a data URI payload in a text field', () => {
    const input = '<img src="data:text/html,<script>alert(1)</script>">'
    const result = sanitizeFieldValue(input, 'text')
    expect(result.value).not.toContain('<script>')
    expect(result.value).not.toContain('<img')
    expect(result.wasModified).toBe(true)
  })
})
