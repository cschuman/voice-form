import { describe, it, expect, test } from 'vitest'
import { validateSchema } from '../src/schema-validator.js'
import type { FieldSchema, FormSchema } from '../src/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<FieldSchema> = {}): FieldSchema {
  return { name: 'fieldName', type: 'text', ...overrides }
}

// ---------------------------------------------------------------------------
// Happy-path
// ---------------------------------------------------------------------------

describe('validateSchema — valid input', () => {
  it('accepts a FormSchema object with a fields array', () => {
    const schema: FormSchema = {
      formName: 'Contact Form',
      fields: [makeField({ name: 'email', type: 'email' })],
    }
    expect(() => validateSchema(schema)).not.toThrow()
  })

  it('returns a FormSchema typed value', () => {
    const schema: FormSchema = { fields: [makeField()] }
    const result = validateSchema(schema)
    expect(result).toHaveProperty('fields')
    expect(Array.isArray(result.fields)).toBe(true)
  })

  it('defaults label to name when label is omitted', () => {
    const schema: FormSchema = {
      fields: [makeField({ name: 'firstName', type: 'text' })],
    }
    const result = validateSchema(schema)
    expect(result.fields[0].label).toBe('firstName')
  })

  it('preserves an explicitly provided label', () => {
    const schema: FormSchema = {
      fields: [makeField({ name: 'firstName', type: 'text', label: 'First Name' })],
    }
    const result = validateSchema(schema)
    expect(result.fields[0].label).toBe('First Name')
  })

  it('accepts all valid FieldType values', () => {
    const validTypes = [
      'text', 'email', 'tel', 'number', 'date',
      'select', 'checkbox', 'radio', 'textarea',
    ] as const

    for (const type of validTypes) {
      const needsOptions = type === 'select' || type === 'radio'
      const field: FieldSchema = needsOptions
        ? makeField({ name: 'f', type, options: ['a', 'b'] })
        : makeField({ name: 'f', type })
      const schema: FormSchema = { fields: [field] }
      expect(() => validateSchema(schema), `type "${type}" should be valid`).not.toThrow()
    }
  })

  it('accepts a select field with non-empty options', () => {
    const schema: FormSchema = {
      fields: [makeField({ name: 'color', type: 'select', options: ['red', 'blue'] })],
    }
    expect(() => validateSchema(schema)).not.toThrow()
  })

  it('accepts a radio field with non-empty options', () => {
    const schema: FormSchema = {
      fields: [makeField({ name: 'size', type: 'radio', options: ['S', 'M', 'L'] })],
    }
    expect(() => validateSchema(schema)).not.toThrow()
  })

  it('accepts multiple fields with distinct names', () => {
    const schema: FormSchema = {
      fields: [
        makeField({ name: 'first', type: 'text' }),
        makeField({ name: 'last', type: 'text' }),
        makeField({ name: 'email', type: 'email' }),
      ],
    }
    expect(() => validateSchema(schema)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Error-path — schema shape
// ---------------------------------------------------------------------------

describe('validateSchema — invalid schema shape', () => {
  it('throws when input is null', () => {
    expect(() => validateSchema(null)).toThrow()
  })

  it('throws when input is undefined', () => {
    expect(() => validateSchema(undefined)).toThrow()
  })

  it('throws when input is a plain string', () => {
    expect(() => validateSchema('not a schema')).toThrow()
  })

  it('throws when input is a number', () => {
    expect(() => validateSchema(42)).toThrow()
  })

  it('throws when input is an array (not a FormSchema object)', () => {
    // The function requires a FormSchema object — a bare array is not valid
    expect(() => validateSchema([])).toThrow()
  })

  it('throws when schema has no fields property', () => {
    expect(() => validateSchema({})).toThrow()
  })

  it('throws when fields is not an array', () => {
    expect(() => validateSchema({ fields: 'not an array' })).toThrow()
  })

  it('throws when fields array is empty', () => {
    expect(() => validateSchema({ fields: [] })).toThrow()
  })

  it('error message mentions "fields" for empty array', () => {
    expect(() => validateSchema({ fields: [] })).toThrowError(/fields/i)
  })
})

// ---------------------------------------------------------------------------
// Error-path — field-level validation
// ---------------------------------------------------------------------------

describe('validateSchema — field name validation', () => {
  it('throws when a field is missing the name property', () => {
    const schema = { fields: [{ type: 'text' }] }
    expect(() => validateSchema(schema)).toThrow()
  })

  it('includes the field index in the error when name is missing', () => {
    const schema = { fields: [{ type: 'text' }] }
    expect(() => validateSchema(schema)).toThrowError(/field 0/i)
  })

  it('throws when a field name is an empty string', () => {
    const schema = { fields: [{ name: '', type: 'text' }] }
    expect(() => validateSchema(schema)).toThrow()
  })

  it('includes the field index in the error for empty name', () => {
    const schema = { fields: [{ name: '', type: 'text' }] }
    expect(() => validateSchema(schema)).toThrowError(/field 0/i)
  })

  it('includes the field index for the second field when it has no name', () => {
    const schema = {
      fields: [
        { name: 'first', type: 'text' },
        { type: 'email' },
      ],
    }
    expect(() => validateSchema(schema)).toThrowError(/field 1/i)
  })
})

describe('validateSchema — field type validation', () => {
  it('throws when a field has no type property', () => {
    const schema = { fields: [{ name: 'f' }] }
    expect(() => validateSchema(schema)).toThrow()
  })

  it('throws when a field has an invalid type string', () => {
    const schema = { fields: [{ name: 'f', type: 'freetext' }] }
    expect(() => validateSchema(schema)).toThrow()
  })

  it('includes field index and type value in the error message', () => {
    const schema = { fields: [{ name: 'f', type: 'freetext' }] }
    expect(() => validateSchema(schema)).toThrowError(/field 0/i)
  })
})

describe('validateSchema — duplicate field names', () => {
  it('throws when two fields share the same name', () => {
    const schema = {
      fields: [
        { name: 'email', type: 'text' },
        { name: 'email', type: 'email' },
      ],
    }
    expect(() => validateSchema(schema)).toThrow()
  })

  it('includes the duplicate name in the error message', () => {
    const schema = {
      fields: [
        { name: 'email', type: 'text' },
        { name: 'email', type: 'email' },
      ],
    }
    expect(() => validateSchema(schema)).toThrowError(/email/)
  })

  it('throws when three fields share the same name', () => {
    const schema = {
      fields: [
        { name: 'x', type: 'text' },
        { name: 'x', type: 'text' },
        { name: 'x', type: 'text' },
      ],
    }
    expect(() => validateSchema(schema)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Error-path — options validation for select and radio
// ---------------------------------------------------------------------------

describe('validateSchema — options required for select/radio', () => {
  test.each([
    ['select', 'select'],
    ['radio', 'radio'],
  ] as const)('%s without options throws', (_, type) => {
    const schema = { fields: [{ name: 'f', type }] }
    expect(() => validateSchema(schema)).toThrow()
  })

  test.each([
    ['select', 'select'],
    ['radio', 'radio'],
  ] as const)('%s with empty options array throws', (_, type) => {
    const schema = { fields: [{ name: 'f', type, options: [] }] }
    expect(() => validateSchema(schema)).toThrow()
  })

  test.each([
    ['select', 'select'],
    ['radio', 'radio'],
  ] as const)('%s error includes field index', (_, type) => {
    const schema = { fields: [{ name: 'f', type }] }
    expect(() => validateSchema(schema)).toThrowError(/field 0/i)
  })

  it('does not require options for checkbox type', () => {
    const schema: FormSchema = {
      fields: [makeField({ name: 'agree', type: 'checkbox' })],
    }
    expect(() => validateSchema(schema)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// VoiceFormConfigError shape
// ---------------------------------------------------------------------------

describe('validateSchema — thrown error type', () => {
  it('thrown error is an instance of Error', () => {
    expect(() => validateSchema({ fields: [] })).toThrow(Error)
  })

  it('thrown error has code SCHEMA_INVALID', () => {
    try {
      validateSchema({ fields: [] })
      expect.fail('should have thrown')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error)
      expect((err as { code?: string }).code).toBe('SCHEMA_INVALID')
    }
  })

  it('thrown error message is descriptive', () => {
    try {
      validateSchema({ fields: [] })
      expect.fail('should have thrown')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message.length).toBeGreaterThan(0)
    }
  })
})
