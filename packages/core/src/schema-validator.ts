/**
 * @voiceform/core — Schema Validator
 *
 * Validates a developer-provided schema at initialization time.
 * Throws a `VoiceFormConfigError` synchronously if the schema is invalid,
 * preventing a misconfigured instance from ever being created.
 *
 * @module schema-validator
 */

import type { FieldSchema, FieldType, FormSchema, VoiceFormConfigError } from './types.js'

// ---------------------------------------------------------------------------
// Valid field types — kept as a Set for O(1) lookup
// ---------------------------------------------------------------------------

const VALID_FIELD_TYPES = new Set<FieldType>([
  'text',
  'email',
  'tel',
  'number',
  'date',
  'select',
  'checkbox',
  'radio',
  'textarea',
])

/** Field types that require a non-empty `options` array. */
const TYPES_REQUIRING_OPTIONS = new Set<FieldType>(['select', 'radio'])

// ---------------------------------------------------------------------------
// VoiceFormConfigError implementation
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of the `VoiceFormConfigError` interface.
 * Thrown synchronously by `validateSchema` when the schema is malformed.
 * Extends `Error` so it propagates through standard try/catch blocks.
 */
class ConfigError extends Error implements VoiceFormConfigError {
  /** Always `'SCHEMA_INVALID'` for schema validation failures. */
  readonly code = 'SCHEMA_INVALID' as const

  constructor(message: string) {
    super(message)
    this.name = 'VoiceFormConfigError'
    // Restore the prototype chain after extending Error (TypeScript requirement).
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates a developer-provided schema and returns a fully normalized
 * `FormSchema` with all defaulted fields populated.
 *
 * Currently applied defaults:
 * - `label` defaults to `name` when omitted.
 *
 * @param schema - An unknown value from developer config. The function
 *   performs full runtime shape validation before casting.
 * @returns A normalized, type-safe `FormSchema`.
 * @throws {VoiceFormConfigError} with code `'SCHEMA_INVALID'` if the schema
 *   is structurally invalid. The error message includes the field index and
 *   a human-readable description of the violation.
 *
 * @example
 * const schema = validateSchema({
 *   fields: [
 *     { name: 'email', type: 'email' },
 *     { name: 'plan', type: 'select', options: ['free', 'pro'] },
 *   ],
 * })
 */
export function validateSchema(schema: unknown): FormSchema {
  // ── 1. Top-level shape check ─────────────────────────────────────────────

  if (schema === null || schema === undefined) {
    throw new ConfigError(
      'Schema must be a FormSchema object with a non-empty "fields" array; received null/undefined.',
    )
  }

  if (typeof schema !== 'object' || Array.isArray(schema)) {
    throw new ConfigError(
      `Schema must be a FormSchema object with a "fields" array; received ${Array.isArray(schema) ? 'array' : typeof schema}.`,
    )
  }

  const raw = schema as Record<string, unknown>

  if (!('fields' in raw) || !Array.isArray(raw['fields'])) {
    throw new ConfigError(
      'Schema must have a "fields" property that is an array of field definitions.',
    )
  }

  const fields = raw['fields'] as unknown[]

  if (fields.length === 0) {
    throw new ConfigError(
      'Schema "fields" array must not be empty. Provide at least one field definition.',
    )
  }

  // ── 2. Per-field validation ───────────────────────────────────────────────

  const seenNames = new Set<string>()
  const normalizedFields: FieldSchema[] = []

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]

    if (field === null || typeof field !== 'object' || Array.isArray(field)) {
      throw new ConfigError(
        `Field ${i}: expected an object, received ${field === null ? 'null' : typeof field}.`,
      )
    }

    const f = field as Record<string, unknown>

    // ── name ─────────────────────────────────────────────────────────────

    if (!('name' in f) || typeof f['name'] !== 'string') {
      throw new ConfigError(
        `Field ${i}: missing required "name" property (must be a non-empty string).`,
      )
    }

    const name = f['name'] as string

    if (name.trim() === '') {
      throw new ConfigError(
        `Field ${i}: "name" must not be an empty string.`,
      )
    }

    // ── duplicate names ───────────────────────────────────────────────────

    if (seenNames.has(name)) {
      throw new ConfigError(
        `Field ${i}: duplicate field name "${name}". Each field name must be unique within the schema.`,
      )
    }

    seenNames.add(name)

    // ── type ──────────────────────────────────────────────────────────────

    if (!('type' in f) || typeof f['type'] !== 'string') {
      throw new ConfigError(
        `Field ${i} ("${name}"): missing required "type" property.`,
      )
    }

    const type = f['type'] as string

    if (!VALID_FIELD_TYPES.has(type as FieldType)) {
      throw new ConfigError(
        `Field ${i} ("${name}"): invalid type "${type}". ` +
          `Valid types are: ${[...VALID_FIELD_TYPES].join(', ')}.`,
      )
    }

    const fieldType = type as FieldType

    // ── options (required for select / radio) ─────────────────────────────

    if (TYPES_REQUIRING_OPTIONS.has(fieldType)) {
      const options = f['options']

      if (!Array.isArray(options) || options.length === 0) {
        throw new ConfigError(
          `Field ${i} ("${name}"): type "${fieldType}" requires a non-empty "options" array.`,
        )
      }
    }

    // ── normalize: default label to name ─────────────────────────────────

    const label =
      typeof f['label'] === 'string' && f['label'].length > 0 ? f['label'] : name

    // Spread the original field properties, then apply the normalized label.
    // This preserves optional properties (description, required, validation, options)
    // without requiring explicit enumeration.
    normalizedFields.push({ ...(f as unknown as FieldSchema), label })
  }

  // ── 3. Assemble normalized FormSchema ─────────────────────────────────────

  const normalizedSchema: FormSchema = {
    ...(raw as unknown as FormSchema),
    fields: normalizedFields,
  }

  return normalizedSchema
}
