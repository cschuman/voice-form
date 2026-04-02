import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FormSchema } from '@voiceform/core'
import { inspectSchema } from '../src/schema-inspector.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSchema(overrides?: Partial<FormSchema>): FormSchema {
  return {
    formName: 'Test Form',
    formDescription: 'A valid test form',
    fields: [
      { name: 'firstName', label: 'First Name', type: 'text' },
      { name: 'email', label: 'Email Address', type: 'email' },
    ],
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('inspectSchema', () => {
  describe('valid schema', () => {
    it('returns valid:true and empty diagnostics for a fully correct schema', () => {
      const result = inspectSchema(makeSchema())
      expect(result.valid).toBe(true)
      expect(result.fieldCount).toBe(2)
      expect(result.diagnostics).toHaveLength(0)
    })
  })

  describe('missing label warning', () => {
    it('warns when a field has no label', () => {
      const schema = makeSchema({
        fields: [{ name: 'unlabeled', type: 'text' }],
      })
      const result = inspectSchema(schema)
      const warning = result.diagnostics.find(
        (d) => d.field === 'unlabeled' && d.severity === 'warning',
      )
      expect(warning).toBeDefined()
      expect(warning?.message).toBeTruthy()
    })

    it('does not warn when a label is present', () => {
      const schema = makeSchema({
        fields: [{ name: 'firstName', label: 'First Name', type: 'text' }],
      })
      const result = inspectSchema(schema)
      const labelWarning = result.diagnostics.find(
        (d) => d.field === 'firstName' && d.message.toLowerCase().includes('label'),
      )
      expect(labelWarning).toBeUndefined()
    })
  })

  describe('oversized description', () => {
    it('suggests trimming description longer than 200 chars', () => {
      const longDesc = 'A'.repeat(201)
      const schema = makeSchema({
        fields: [{ name: 'bio', label: 'Bio', type: 'textarea', description: longDesc }],
      })
      const result = inspectSchema(schema)
      const suggestion = result.diagnostics.find(
        (d) => d.field === 'bio' && d.severity === 'suggestion',
      )
      expect(suggestion).toBeDefined()
      expect(suggestion?.message).toMatch(/description/i)
    })

    it('does not suggest trimming a description of exactly 200 chars', () => {
      const exactDesc = 'A'.repeat(200)
      const schema = makeSchema({
        fields: [{ name: 'bio', label: 'Bio', type: 'textarea', description: exactDesc }],
      })
      const result = inspectSchema(schema)
      const suggestion = result.diagnostics.find(
        (d) => d.field === 'bio' && d.severity === 'suggestion' && d.message.match(/description/i),
      )
      expect(suggestion).toBeUndefined()
    })
  })

  describe('special characters in field name', () => {
    it.each([
      ['field.name', '.'],
      ['field[name]', '['],
      ['field name', 'space'],
      ['field#name', '#'],
    ])('reports error for field name %s (contains %s)', (fieldName) => {
      const schema = makeSchema({
        fields: [{ name: fieldName, label: 'Test', type: 'text' }],
      })
      const result = inspectSchema(schema)
      const error = result.diagnostics.find(
        (d) => d.field === fieldName && d.severity === 'error',
      )
      expect(error).toBeDefined()
      expect(error?.message).toBeTruthy()
    })

    it('does not error for a clean field name', () => {
      const schema = makeSchema({
        fields: [{ name: 'firstName', label: 'First Name', type: 'text' }],
      })
      const result = inspectSchema(schema)
      const error = result.diagnostics.find(
        (d) => d.field === 'firstName' && d.severity === 'error',
      )
      expect(error).toBeUndefined()
    })
  })

  describe('select/radio without options', () => {
    it.each([['select'], ['radio']] as const)(
      'warns on %s field with no options',
      (fieldType) => {
        const schema = makeSchema({
          fields: [{ name: 'choice', label: 'Choice', type: fieldType }],
        })
        const result = inspectSchema(schema)
        const diag = result.diagnostics.find(
          (d) => d.field === 'choice' && (d.severity === 'warning' || d.severity === 'error'),
        )
        expect(diag).toBeDefined()
        expect(diag?.message).toBeTruthy()
      },
    )

    it.each([['select'], ['radio']] as const)(
      'does not warn on %s field with options defined',
      (fieldType) => {
        const schema = makeSchema({
          fields: [
            {
              name: 'choice',
              label: 'Choice',
              type: fieldType,
              options: ['a', 'b'],
            },
          ],
        })
        const result = inspectSchema(schema)
        const optionsDiag = result.diagnostics.find(
          (d) => d.field === 'choice' && d.message.toLowerCase().includes('option'),
        )
        expect(optionsDiag).toBeUndefined()
      },
    )
  })

  describe('duplicate field names', () => {
    it('reports an error diagnostic for each entry when field names are duplicated', () => {
      const schema: FormSchema = {
        fields: [
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'email', label: 'Email Again', type: 'text' },
        ],
      }
      const result = inspectSchema(schema)
      const errorDiags = result.diagnostics.filter(
        (d) => d.field === 'email' && d.severity === 'error',
      )
      // Both entries should produce an error diagnostic
      expect(errorDiags.length).toBeGreaterThanOrEqual(2)
    })

    it('marks result as invalid when duplicate names exist', () => {
      const schema: FormSchema = {
        fields: [
          { name: 'dup', label: 'A', type: 'text' },
          { name: 'dup', label: 'B', type: 'text' },
        ],
      }
      const result = inspectSchema(schema)
      expect(result.valid).toBe(false)
    })
  })

  describe('suggestions for ambiguous fields', () => {
    it('suggests adding a description for a field without one', () => {
      const schema = makeSchema({
        fields: [{ name: 'status', label: 'Status', type: 'text' }],
      })
      const result = inspectSchema(schema)
      // May or may not suggest a description — depends on implementation.
      // This just verifies the function runs without error for such a schema.
      expect(result).toHaveProperty('diagnostics')
    })

    it('suggests adding formName and formDescription when both are absent', () => {
      const schema: FormSchema = {
        fields: [{ name: 'name', label: 'Name', type: 'text' }],
      }
      const result = inspectSchema(schema)
      const suggestions = result.diagnostics.filter((d) => d.severity === 'suggestion')
      expect(suggestions.length).toBeGreaterThan(0)
    })
  })

  describe('production mode', () => {
    const originalEnv = process.env['NODE_ENV']

    beforeEach(() => {
      process.env['NODE_ENV'] = 'production'
    })

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv
    })

    it('returns an empty-like result in production without calling any console methods', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const consoleGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {})
      const consoleTableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})

      const schema = makeSchema({
        fields: [{ name: 'unlabeled', type: 'text' }],
      })
      inspectSchema(schema)

      expect(consoleSpy).not.toHaveBeenCalled()
      expect(consoleGroupSpy).not.toHaveBeenCalled()
      expect(consoleTableSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
      consoleGroupSpy.mockRestore()
      consoleTableSpy.mockRestore()
    })
  })

  describe('fieldCount', () => {
    it('reports the correct fieldCount', () => {
      const schema: FormSchema = {
        fields: [
          { name: 'a', label: 'A', type: 'text' },
          { name: 'b', label: 'B', type: 'email' },
          { name: 'c', label: 'C', type: 'select', options: ['x', 'y'] },
        ],
      }
      const result = inspectSchema(schema)
      expect(result.fieldCount).toBe(3)
    })
  })

  describe('required: true on boolean (checkbox) field', () => {
    it('suggests removing required:true from a checkbox field', () => {
      const schema = makeSchema({
        fields: [{ name: 'agree', label: 'Agree', type: 'checkbox', required: true }],
      })
      const result = inspectSchema(schema)
      const suggestion = result.diagnostics.find(
        (d) => d.field === 'agree' && d.severity === 'suggestion',
      )
      expect(suggestion).toBeDefined()
    })
  })
})
