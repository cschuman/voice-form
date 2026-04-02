import { describe, it, expect, test } from 'vitest'
import { buildPrompt, buildFieldPrompt } from '../src/prompt-builder.js'
import type { FormSchema } from '../src/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalSchema: FormSchema = {
  fields: [{ name: 'firstName', label: 'First Name', type: 'text', required: true }],
}

const multiFieldSchema: FormSchema = {
  formName: 'Sign-up Form',
  fields: [
    { name: 'firstName', label: 'First Name', type: 'text', required: true },
    { name: 'email', label: 'Email Address', type: 'email', required: true },
    {
      name: 'plan',
      label: 'Plan',
      type: 'select',
      options: ['Basic', 'Pro', 'Enterprise'],
    },
    { name: 'dob', label: 'Date of Birth', type: 'date', required: false },
  ],
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// buildPrompt — output shape
// ---------------------------------------------------------------------------

describe('buildPrompt — return shape', () => {
  it('returns an object with a transcript property', () => {
    const result = buildPrompt('hello world', minimalSchema)
    expect(result).toHaveProperty('transcript')
  })

  it('returns an object with a schema property', () => {
    const result = buildPrompt('hello world', minimalSchema)
    expect(result).toHaveProperty('schema')
  })

  it('returns an object with a meta property', () => {
    const result = buildPrompt('hello world', minimalSchema)
    expect(result).toHaveProperty('meta')
  })

  it('meta contains version, timestamp, and requestId', () => {
    const result = buildPrompt('hello world', minimalSchema)
    expect(result.meta).toHaveProperty('version')
    expect(result.meta).toHaveProperty('timestamp')
    expect(result.meta).toHaveProperty('requestId')
  })
})

// ---------------------------------------------------------------------------
// buildPrompt — transcript passthrough
// ---------------------------------------------------------------------------

describe('buildPrompt — transcript passthrough', () => {
  it('passes the transcript through unchanged', () => {
    const transcript = 'John Smith, john at example dot com'
    const result = buildPrompt(transcript, minimalSchema)
    expect(result.transcript).toBe(transcript)
  })

  it('passes an empty transcript through unchanged', () => {
    const result = buildPrompt('', minimalSchema)
    expect(result.transcript).toBe('')
  })

  it('preserves special characters in the transcript', () => {
    const transcript = 'Ünïcödé & <special> "chars" \'here\''
    const result = buildPrompt(transcript, minimalSchema)
    expect(result.transcript).toBe(transcript)
  })
})

// ---------------------------------------------------------------------------
// buildPrompt — schema passthrough
// ---------------------------------------------------------------------------

describe('buildPrompt — schema passthrough', () => {
  it('passes the schema through unchanged', () => {
    const result = buildPrompt('hello', minimalSchema)
    expect(result.schema).toBe(minimalSchema)
  })

  it('passes a multi-field schema through unchanged', () => {
    const result = buildPrompt('hello', multiFieldSchema)
    expect(result.schema).toBe(multiFieldSchema)
  })
})

// ---------------------------------------------------------------------------
// buildPrompt — meta.version
// ---------------------------------------------------------------------------

describe('buildPrompt — meta.version', () => {
  it('sets version to a non-empty string', () => {
    const result = buildPrompt('hello', minimalSchema)
    expect(typeof result.meta.version).toBe('string')
    expect(result.meta.version.length).toBeGreaterThan(0)
  })

  it('sets version to "0.0.0"', () => {
    const result = buildPrompt('hello', minimalSchema)
    expect(result.meta.version).toBe('0.0.0')
  })
})

// ---------------------------------------------------------------------------
// buildPrompt — meta.timestamp
// ---------------------------------------------------------------------------

describe('buildPrompt — meta.timestamp', () => {
  it('timestamp is a number', () => {
    const result = buildPrompt('hello', minimalSchema)
    expect(typeof result.meta.timestamp).toBe('number')
  })

  it('timestamp is a positive integer', () => {
    const result = buildPrompt('hello', minimalSchema)
    expect(result.meta.timestamp).toBeGreaterThan(0)
    expect(Number.isInteger(result.meta.timestamp)).toBe(true)
  })

  it('timestamp is within the last second', () => {
    const before = Date.now()
    const result = buildPrompt('hello', minimalSchema)
    const after = Date.now()
    expect(result.meta.timestamp).toBeGreaterThanOrEqual(before)
    expect(result.meta.timestamp).toBeLessThanOrEqual(after)
  })
})

// ---------------------------------------------------------------------------
// buildPrompt — meta.requestId
// ---------------------------------------------------------------------------

describe('buildPrompt — meta.requestId', () => {
  it('requestId is a string', () => {
    const result = buildPrompt('hello', minimalSchema)
    expect(typeof result.meta.requestId).toBe('string')
  })

  it('requestId matches UUID v4 format', () => {
    const result = buildPrompt('hello', minimalSchema)
    expect(result.meta.requestId).toMatch(UUID_PATTERN)
  })

  it('each call produces a unique requestId', () => {
    const a = buildPrompt('hello', minimalSchema)
    const b = buildPrompt('hello', minimalSchema)
    expect(a.meta.requestId).not.toBe(b.meta.requestId)
  })
})

// ---------------------------------------------------------------------------
// buildFieldPrompt — basic structure
// ---------------------------------------------------------------------------

describe('buildFieldPrompt — output structure', () => {
  it('returns a string', () => {
    const result = buildFieldPrompt(minimalSchema)
    expect(typeof result).toBe('string')
  })

  it('starts with "Fields to extract:"', () => {
    const result = buildFieldPrompt(minimalSchema)
    expect(result.startsWith('Fields to extract:')).toBe(true)
  })

  it('contains one line per field', () => {
    const result = buildFieldPrompt(multiFieldSchema)
    // The header line plus one bullet per field
    const lines = result.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(multiFieldSchema.fields.length)
  })
})

// ---------------------------------------------------------------------------
// buildFieldPrompt — field name and label
// ---------------------------------------------------------------------------

describe('buildFieldPrompt — field name and label', () => {
  it('includes the field name in the output', () => {
    const result = buildFieldPrompt(minimalSchema)
    expect(result).toContain('firstName')
  })

  it('includes the field label in the output', () => {
    const result = buildFieldPrompt(minimalSchema)
    expect(result).toContain('First Name')
  })

  it('formats each field as "- name (label): type"', () => {
    const result = buildFieldPrompt(minimalSchema)
    expect(result).toContain('- firstName (First Name): text')
  })

  it('uses name as label when label is omitted', () => {
    const schema: FormSchema = {
      fields: [{ name: 'zipCode', type: 'text' }],
    }
    const result = buildFieldPrompt(schema)
    expect(result).toContain('- zipCode (zipCode): text')
  })
})

// ---------------------------------------------------------------------------
// buildFieldPrompt — required marker
// ---------------------------------------------------------------------------

describe('buildFieldPrompt — required marker', () => {
  it('appends ", required" for required fields', () => {
    const result = buildFieldPrompt(minimalSchema)
    expect(result).toContain('required')
  })

  it('does not append ", required" for optional fields', () => {
    const schema: FormSchema = {
      fields: [{ name: 'nickname', label: 'Nickname', type: 'text', required: false }],
    }
    const result = buildFieldPrompt(schema)
    expect(result).not.toContain('required')
  })

  it('does not append ", required" when required is omitted', () => {
    const schema: FormSchema = {
      fields: [{ name: 'nickname', label: 'Nickname', type: 'text' }],
    }
    const result = buildFieldPrompt(schema)
    expect(result).not.toContain('required')
  })
})

// ---------------------------------------------------------------------------
// buildFieldPrompt — select options
// ---------------------------------------------------------------------------

describe('buildFieldPrompt — select field options', () => {
  it('includes options for select fields', () => {
    const result = buildFieldPrompt(multiFieldSchema)
    expect(result).toContain('options: [Basic, Pro, Enterprise]')
  })

  it('formats options as comma-separated list in brackets', () => {
    const schema: FormSchema = {
      fields: [
        {
          name: 'color',
          label: 'Color',
          type: 'select',
          options: ['Red', 'Green', 'Blue'],
        },
      ],
    }
    const result = buildFieldPrompt(schema)
    expect(result).toContain('options: [Red, Green, Blue]')
  })

  it('includes options for radio fields', () => {
    const schema: FormSchema = {
      fields: [
        {
          name: 'size',
          label: 'Size',
          type: 'radio',
          options: ['S', 'M', 'L'],
        },
      ],
    }
    const result = buildFieldPrompt(schema)
    expect(result).toContain('options: [S, M, L]')
  })

  it('does not add an options line for text fields without options', () => {
    const result = buildFieldPrompt(minimalSchema)
    expect(result).not.toContain('options:')
  })
})

// ---------------------------------------------------------------------------
// buildFieldPrompt — format hints
// ---------------------------------------------------------------------------

describe('buildFieldPrompt — format hints', () => {
  it('includes "format: YYYY-MM-DD" for date fields', () => {
    const result = buildFieldPrompt(multiFieldSchema)
    expect(result).toContain('format: YYYY-MM-DD')
  })

  it('includes "format: email" for email fields', () => {
    const result = buildFieldPrompt(multiFieldSchema)
    expect(result).toContain('format: email')
  })

  it('includes "format: E.164" for tel fields', () => {
    const schema: FormSchema = {
      fields: [{ name: 'phone', label: 'Phone', type: 'tel' }],
    }
    const result = buildFieldPrompt(schema)
    expect(result).toContain('format: E.164')
  })

  it('does not include a format hint for generic text fields', () => {
    const schema: FormSchema = {
      fields: [{ name: 'notes', label: 'Notes', type: 'text' }],
    }
    const result = buildFieldPrompt(schema)
    expect(result).not.toContain('format:')
  })
})

// ---------------------------------------------------------------------------
// buildFieldPrompt — multi-field canonical output
// ---------------------------------------------------------------------------

describe('buildFieldPrompt — canonical multi-field output', () => {
  it('produces the expected canonical output for the multi-field schema', () => {
    const result = buildFieldPrompt(multiFieldSchema)
    const expected = [
      'Fields to extract:',
      '- firstName (First Name): text, required',
      '- email (Email Address): email, format: email, required',
      '- plan (Plan): select, options: [Basic, Pro, Enterprise]',
      '- dob (Date of Birth): date, format: YYYY-MM-DD',
    ].join('\n')
    expect(result).toBe(expected)
  })
})
