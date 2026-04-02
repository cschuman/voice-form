// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { detectSchema } from '../src/detect-schema.js'
import type { FormSchema } from '../src/types.js'

// ---------------------------------------------------------------------------
// CSS.escape polyfill guard
// ---------------------------------------------------------------------------
// jsdom ships CSS.escape; guard in case the test environment does not.
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  ;(globalThis as Record<string, unknown>).CSS = {
    escape: (value: string) =>
      value.replace(
        /([\0-\x1f\x7f]|^[0-9]|[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g,
        '\\$1',
      ),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a test form element by constructing the DOM node-by-node.
 * Returns the form element or a container for the given HTML description.
 * We use a factory approach per-test rather than innerHTML to avoid the
 * security hook; individual helpers build exact DOM structures needed.
 */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (HTMLElement | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v)
  }
  for (const child of children) {
    if (typeof child === 'string') {
      node.appendChild(document.createTextNode(child))
    } else {
      node.appendChild(child)
    }
  }
  return node
}

function form(...children: HTMLElement[]): HTMLFormElement {
  return el('form', {}, ...children)
}

function labelFor(forId: string, text: string): HTMLLabelElement {
  return el('label', { for: forId }, text)
}

function input(attrs: Record<string, string>): HTMLInputElement {
  return el('input', attrs)
}

function select(
  attrs: Record<string, string>,
  ...options: Array<[value: string, text: string]>
): HTMLSelectElement {
  const s = el('select', attrs)
  for (const [value, text] of options) {
    s.appendChild(el('option', { value }, text))
  }
  return s
}

function textarea(attrs: Record<string, string>): HTMLTextAreaElement {
  return el('textarea', attrs)
}

function fieldset(legendText: string, ...inputs: HTMLInputElement[]): HTMLFieldSetElement {
  const fs = el('fieldset')
  const legend = el('legend', {}, legendText)
  fs.appendChild(legend)
  for (const inp of inputs) {
    fs.appendChild(inp)
  }
  return fs
}

// ---------------------------------------------------------------------------
// Empty form
// ---------------------------------------------------------------------------

describe('detectSchema — empty form', () => {
  it('returns a FormSchema with an empty fields array for a form with no inputs', () => {
    const schema = detectSchema(form())
    expect(schema).toMatchObject<Partial<FormSchema>>({ fields: [] })
  })

  it('returns empty fields when all elements are excluded types', () => {
    const f = form(
      input({ type: 'hidden', name: 'csrf' }),
      input({ type: 'submit', name: 'submitBtn', id: 'submitBtn', value: 'Submit' }),
      input({ type: 'reset', name: 'resetBtn', id: 'resetBtn', value: 'Reset' }),
      input({ type: 'button', name: 'btn', id: 'btn', value: 'Click' }),
      input({ type: 'image', name: 'imgBtn', id: 'imgBtn', src: 'btn.png' }),
      input({ type: 'password', name: 'pass', id: 'pass' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Basic field types
// ---------------------------------------------------------------------------

describe('detectSchema — simple text input with label[for]', () => {
  it('extracts name, type=text, and label from label[for]', () => {
    const inp = input({ id: 'first-name', name: 'firstName', type: 'text' })
    const f = form(labelFor('first-name', 'First Name'), inp)
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    const field = schema.fields[0]
    expect(field.name).toBe('firstName')
    expect(field.type).toBe('text')
    expect(field.label).toBe('First Name')
  })
})

describe('detectSchema — email input', () => {
  it('maps input[type=email] to FieldType "email"', () => {
    const f = form(
      labelFor('email', 'Email'),
      input({ id: 'email', name: 'email', type: 'email' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields[0].type).toBe('email')
  })
})

describe('detectSchema — tel input', () => {
  it('maps input[type=tel] to FieldType "tel"', () => {
    const f = form(
      labelFor('phone', 'Phone'),
      input({ id: 'phone', name: 'phone', type: 'tel' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields[0].type).toBe('tel')
  })
})

describe('detectSchema — number input', () => {
  it('maps input[type=number] to FieldType "number"', () => {
    const f = form(input({ id: 'qty', name: 'qty', type: 'number' }))
    const schema = detectSchema(f)
    expect(schema.fields[0].type).toBe('number')
  })

  it('maps input[type=range] to FieldType "number"', () => {
    const f = form(input({ id: 'rating', name: 'rating', type: 'range' }))
    const schema = detectSchema(f)
    expect(schema.fields[0].type).toBe('number')
  })
})

describe('detectSchema — date inputs', () => {
  it.each([
    ['date', 'dob'],
    ['month', 'month'],
    ['week', 'week'],
    ['time', 'apptTime'],
    ['datetime-local', 'start'],
  ] as const)('maps input[type=%s] to FieldType "date"', (inputType, name) => {
    const f = form(input({ id: name, name, type: inputType }))
    const schema = detectSchema(f)
    expect(schema.fields[0].type).toBe('date')
  })
})

describe('detectSchema — textarea', () => {
  it('maps textarea to FieldType "textarea" and resolves label correctly', () => {
    const f = form(
      labelFor('notes', 'Notes'),
      textarea({ id: 'notes', name: 'notes' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    const field = schema.fields[0]
    expect(field.name).toBe('notes')
    expect(field.type).toBe('textarea')
    expect(field.label).toBe('Notes')
  })
})

describe('detectSchema — checkbox', () => {
  it('maps input[type=checkbox] to FieldType "checkbox"', () => {
    const f = form(
      labelFor('agree', 'Agree to terms'),
      input({ id: 'agree', name: 'agree', type: 'checkbox' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    const field = schema.fields[0]
    expect(field.type).toBe('checkbox')
    expect(field.label).toBe('Agree to terms')
  })
})

// ---------------------------------------------------------------------------
// Select with options
// ---------------------------------------------------------------------------

describe('detectSchema — select with options', () => {
  it('maps select to FieldType "select" and extracts non-empty option values', () => {
    const f = form(
      labelFor('country', 'Country'),
      select(
        { id: 'country', name: 'country' },
        ['', 'Select a country…'],
        ['US', 'United States'],
        ['CA', 'Canada'],
        ['GB', 'United Kingdom'],
      ),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    const field = schema.fields[0]
    expect(field.type).toBe('select')
    expect(field.label).toBe('Country')
    // Empty-value placeholder option must be excluded
    expect(field.options).toEqual(['US', 'CA', 'GB'])
  })

  it('excludes options with empty string value (placeholder pattern)', () => {
    const f = form(
      select(
        { id: 'priority', name: 'priority' },
        ['', '--Choose--'],
        ['low', 'Low'],
        ['high', 'High'],
      ),
    )
    const schema = detectSchema(f)
    expect(schema.fields[0].options).toEqual(['low', 'high'])
  })
})

// ---------------------------------------------------------------------------
// Radio group
// ---------------------------------------------------------------------------

describe('detectSchema — radio group with fieldset/legend', () => {
  it('deduplicates radio inputs into a single field entry with options array', () => {
    const f = form(
      fieldset(
        'Preferred Contact',
        input({ type: 'radio', id: 'contact-email', name: 'contact', value: 'email' }),
        input({ type: 'radio', id: 'contact-phone', name: 'contact', value: 'phone' }),
        input({ type: 'radio', id: 'contact-mail', name: 'contact', value: 'mail' }),
      ),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    const field = schema.fields[0]
    expect(field.name).toBe('contact')
    expect(field.type).toBe('radio')
    expect(field.options).toEqual(['email', 'phone', 'mail'])
  })

  it('uses fieldset legend text as label for radio group', () => {
    const f = form(
      fieldset(
        'Shirt Size',
        input({ type: 'radio', name: 'size', value: 'S' }),
        input({ type: 'radio', name: 'size', value: 'M' }),
        input({ type: 'radio', name: 'size', value: 'L' }),
      ),
    )
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toBe('Shirt Size')
  })

  it('falls back to standard label resolution when no fieldset/legend present', () => {
    const f = form(
      input({ type: 'radio', id: 'size-s', name: 'size', value: 'S', 'aria-label': 'Shirt Size' }),
      input({ type: 'radio', id: 'size-m', name: 'size', value: 'M' }),
      input({ type: 'radio', id: 'size-l', name: 'size', value: 'L' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toBe('Shirt Size')
  })
})

// ---------------------------------------------------------------------------
// Label resolution priority — each step tested independently
// ---------------------------------------------------------------------------

describe('detectSchema — label resolution step 1: label[for]', () => {
  it('uses label[for] when element has an id matching a label for attribute', () => {
    const inp = input({
      id: 'myInput',
      name: 'myInput',
      type: 'text',
      'aria-label': 'Should be ignored',
      placeholder: 'Also ignored',
    })
    const f = form(labelFor('myInput', 'Label Text'), inp)
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toBe('Label Text')
  })
})

describe('detectSchema — label resolution step 2: aria-labelledby', () => {
  it('uses aria-labelledby when no label[for] is present', () => {
    const f = document.createElement('form')
    const span = el('span', { id: 'lbl-name' }, 'Full Name')
    const inp = input({
      name: 'fullName',
      type: 'text',
      'aria-labelledby': 'lbl-name',
      'aria-label': 'Ignored',
    })
    f.appendChild(span)
    f.appendChild(inp)
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toBe('Full Name')
  })

  it('concatenates multiple aria-labelledby ids with a single space', () => {
    const f = document.createElement('form')
    const span1 = el('span', { id: 'lbl-first' }, 'First')
    const span2 = el('span', { id: 'lbl-second' }, 'Second')
    const inp = input({ name: 'combined', type: 'text', 'aria-labelledby': 'lbl-first lbl-second' })
    f.appendChild(span1)
    f.appendChild(span2)
    f.appendChild(inp)
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toBe('First Second')
  })
})

describe('detectSchema — label resolution step 3: aria-label', () => {
  it('uses aria-label when no label[for] or aria-labelledby is present', () => {
    const f = form(
      input({ name: 'search', type: 'text', 'aria-label': 'Search the site', placeholder: 'Ignored' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toBe('Search the site')
  })
})

describe('detectSchema — label resolution step 4: closest ancestor label', () => {
  it('uses wrapping ancestor <label> textContent when no explicit association exists', () => {
    const f = document.createElement('form')
    const wrapper = document.createElement('label')
    wrapper.appendChild(document.createTextNode('Wrapped Label'))
    const inp = input({ name: 'wrappedField', type: 'text' })
    wrapper.appendChild(inp)
    f.appendChild(wrapper)
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toContain('Wrapped Label')
  })
})

describe('detectSchema — label resolution step 5: placeholder', () => {
  it('uses placeholder when no label, aria-label, or aria-labelledby is present', () => {
    const f = form(input({ name: 'city', type: 'text', placeholder: 'Enter your city' }))
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toBe('Enter your city')
  })
})

describe('detectSchema — label resolution step 6: name as fallback', () => {
  it('falls back to element name when no other label source is available', () => {
    const f = form(input({ name: 'postalCode', type: 'text' }))
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toBe('postalCode')
  })

  it('falls back to element id when name is absent', () => {
    const f = form(input({ id: 'postalCode', type: 'text' }))
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toBe('postalCode')
  })
})

// ---------------------------------------------------------------------------
// Required attribute
// ---------------------------------------------------------------------------

describe('detectSchema — required attribute', () => {
  it('sets required: true when the element has the required attribute', () => {
    const f = form(
      labelFor('email', 'Email'),
      input({ id: 'email', name: 'email', type: 'email', required: '' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields[0].required).toBe(true)
  })

  it('does not set required when required attribute is absent', () => {
    const f = form(
      labelFor('email', 'Email'),
      input({ id: 'email', name: 'email', type: 'email' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields[0].required).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// Security: label truncation at 100 characters
// ---------------------------------------------------------------------------

describe('detectSchema — security: label text truncation', () => {
  it('truncates a label of 101 characters to exactly 100 characters', () => {
    const longLabel = 'A'.repeat(101)
    const lbl = el('label', { for: 'field1' }, longLabel)
    const inp = input({ id: 'field1', name: 'field1', type: 'text' })
    const f = form(lbl, inp)
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toHaveLength(100)
    expect(schema.fields[0].label).toBe('A'.repeat(100))
  })

  it('does not truncate a label of exactly 100 characters', () => {
    const exactLabel = 'B'.repeat(100)
    const lbl = el('label', { for: 'field2' }, exactLabel)
    const inp = input({ id: 'field2', name: 'field2', type: 'text' })
    const f = form(lbl, inp)
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toHaveLength(100)
    expect(schema.fields[0].label).toBe(exactLabel)
  })

  it('truncates a 200-character label to exactly 100 characters', () => {
    const longLabel = 'X'.repeat(200)
    const lbl = el('label', { for: 'field3' }, longLabel)
    const inp = input({ id: 'field3', name: 'field3', type: 'text' })
    const f = form(lbl, inp)
    const schema = detectSchema(f)
    expect(schema.fields[0].label).toHaveLength(100)
  })
})

// ---------------------------------------------------------------------------
// Excluded element types
// ---------------------------------------------------------------------------

describe('detectSchema — excluded element types', () => {
  it('skips input[type=hidden]', () => {
    const f = form(
      input({ type: 'hidden', name: 'csrf', value: 'token' }),
      input({ name: 'visible', type: 'text' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0].name).toBe('visible')
  })

  it('skips input[type=submit]', () => {
    const f = form(
      input({ name: 'visible', type: 'text' }),
      input({ type: 'submit', name: 'submitBtn', id: 'submitBtn', value: 'Submit' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0].name).toBe('visible')
  })

  it('skips input[type=reset]', () => {
    const f = form(
      input({ name: 'visible', type: 'text' }),
      input({ type: 'reset', name: 'resetBtn', id: 'resetBtn', value: 'Reset' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0].name).toBe('visible')
  })

  it('skips input[type=button]', () => {
    const f = form(
      input({ name: 'visible', type: 'text' }),
      input({ type: 'button', name: 'myBtn', id: 'myBtn', value: 'Click me' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0].name).toBe('visible')
  })

  it('skips input[type=image]', () => {
    const f = form(
      input({ name: 'visible', type: 'text' }),
      input({ type: 'image', name: 'imgBtn', id: 'imgBtn', src: 'btn.png' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0].name).toBe('visible')
  })

  it('skips input[type=password] entirely — no entry in returned schema', () => {
    const f = form(
      input({ name: 'username', type: 'text' }),
      input({ name: 'password', id: 'password', type: 'password' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0].name).toBe('username')
    expect(schema.fields.find((field) => field.name === 'password')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Elements with no name and no id
// ---------------------------------------------------------------------------

describe('detectSchema — elements with no name and no id', () => {
  it('skips elements that have neither name nor id', () => {
    const f = form(
      input({ name: 'visible', type: 'text' }),
      input({ type: 'text' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0].name).toBe('visible')
  })

  it('emits console.warn for nameless-and-idless elements', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = form(input({ type: 'text' }))
    detectSchema(f)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Duplicate radio deduplication
// ---------------------------------------------------------------------------

describe('detectSchema — radio deduplication', () => {
  it('deduplicates multiple radio inputs with the same name into one FieldSchema', () => {
    const f = form(
      input({ type: 'radio', name: 'color', value: 'red' }),
      input({ type: 'radio', name: 'color', value: 'green' }),
      input({ type: 'radio', name: 'color', value: 'blue' }),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0].name).toBe('color')
    expect(schema.fields[0].type).toBe('radio')
    expect(schema.fields[0].options).toEqual(['red', 'green', 'blue'])
  })

  it('produces exactly one entry per radio group name regardless of input count', () => {
    const f = form(
      input({ type: 'radio', name: 'size', value: 'S' }),
      input({ type: 'radio', name: 'size', value: 'M' }),
      input({ type: 'radio', name: 'size', value: 'L' }),
      input({ type: 'radio', name: 'size', value: 'XL' }),
      input({ type: 'radio', name: 'size', value: 'XXL' }),
    )
    const schema = detectSchema(f)
    const sizeFields = schema.fields.filter((field) => field.name === 'size')
    expect(sizeFields).toHaveLength(1)
    expect(sizeFields[0].options).toHaveLength(5)
  })

  it('handles multiple independent radio groups correctly', () => {
    const f = form(
      fieldset(
        'Size',
        input({ type: 'radio', name: 'size', value: 'S' }),
        input({ type: 'radio', name: 'size', value: 'M' }),
      ),
      fieldset(
        'Color',
        input({ type: 'radio', name: 'color', value: 'red' }),
        input({ type: 'radio', name: 'color', value: 'blue' }),
      ),
    )
    const schema = detectSchema(f)
    expect(schema.fields).toHaveLength(2)
    const names = schema.fields.map((field) => field.name)
    expect(names).toContain('size')
    expect(names).toContain('color')
  })
})

// ---------------------------------------------------------------------------
// Multi-field form integration
// ---------------------------------------------------------------------------

describe('detectSchema — multi-field form integration', () => {
  it('correctly processes a realistic checkout form', () => {
    const f = form(
      labelFor('first-name', 'First Name'),
      input({ id: 'first-name', name: 'firstName', type: 'text', required: '' }),

      labelFor('email', 'Email Address'),
      input({ id: 'email', name: 'email', type: 'email' }),

      labelFor('country', 'Country'),
      select(
        { id: 'country', name: 'country' },
        ['', 'Select…'],
        ['US', 'United States'],
        ['CA', 'Canada'],
      ),

      labelFor('notes', 'Notes'),
      textarea({ id: 'notes', name: 'notes' }),

      labelFor('subscribe', 'Subscribe'),
      input({ id: 'subscribe', name: 'subscribe', type: 'checkbox' }),

      fieldset(
        'Delivery Method',
        input({ type: 'radio', name: 'delivery', value: 'standard' }),
        input({ type: 'radio', name: 'delivery', value: 'express' }),
      ),

      input({ type: 'hidden', name: 'csrf', value: 'token' }),
      input({ type: 'submit', id: 'submitBtn', name: 'submitBtn', value: 'Submit' }),
    )

    const schema = detectSchema(f)

    // 6 distinct user-facing fields; hidden + submit excluded
    expect(schema.fields).toHaveLength(6)

    const byName = Object.fromEntries(schema.fields.map((field) => [field.name, field]))

    expect(byName['firstName'].type).toBe('text')
    expect(byName['firstName'].label).toBe('First Name')
    expect(byName['firstName'].required).toBe(true)

    expect(byName['email'].type).toBe('email')
    expect(byName['email'].label).toBe('Email Address')

    expect(byName['country'].type).toBe('select')
    expect(byName['country'].options).toEqual(['US', 'CA'])

    expect(byName['notes'].type).toBe('textarea')

    expect(byName['subscribe'].type).toBe('checkbox')

    expect(byName['delivery'].type).toBe('radio')
    expect(byName['delivery'].label).toBe('Delivery Method')
    expect(byName['delivery'].options).toEqual(['standard', 'express'])
  })
})

// ---------------------------------------------------------------------------
// Name resolution: name takes precedence over id
// ---------------------------------------------------------------------------

describe('detectSchema — name resolution', () => {
  it('uses element.name as the field name when both name and id are present', () => {
    const f = form(input({ id: 'my-id', name: 'myName', type: 'text' }))
    const schema = detectSchema(f)
    expect(schema.fields[0].name).toBe('myName')
  })

  it('falls back to element.id when name is absent', () => {
    const f = form(input({ id: 'my-id', type: 'text' }))
    const schema = detectSchema(f)
    expect(schema.fields[0].name).toBe('my-id')
  })
})
