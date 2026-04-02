// @vitest-environment jsdom
/**
 * P1-11 / P1-NEW-09 — Public API surface tests
 *
 * Verifies:
 *   - All documented public exports exist on the main entry point.
 *   - Exported functions have the correct runtime type.
 *   - Internal implementation details are NOT re-exported.
 *   - The VERSION constant is present and semver-shaped.
 */

import { describe, it, expect } from 'vitest'
import * as coreExports from '../src/index.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** All export names present on the main entry. */
const exportedKeys = new Set(Object.keys(coreExports))

function isExported(name: string): boolean {
  return exportedKeys.has(name)
}

// ─── VERSION ──────────────────────────────────────────────────────────────────

describe('VERSION', () => {
  it('is exported as a string', () => {
    expect(typeof coreExports.VERSION).toBe('string')
  })

  it('matches semver format', () => {
    expect(coreExports.VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})

// ─── Public functions ─────────────────────────────────────────────────────────

describe('createVoiceForm', () => {
  it('is exported as a function', () => {
    expect(isExported('createVoiceForm')).toBe(true)
    expect(typeof coreExports.createVoiceForm).toBe('function')
  })
})

describe('buildPrompt', () => {
  it('is NOT exported from the browser entry point (server-side utility)', () => {
    expect(isExported('buildPrompt')).toBe(false)
  })
})

describe('buildFieldPrompt', () => {
  it('is NOT exported from the browser entry point (server-side utility)', () => {
    expect(isExported('buildFieldPrompt')).toBe(false)
  })
})

describe('createWebSpeechAdapter', () => {
  it('is exported as a function', () => {
    expect(isExported('createWebSpeechAdapter')).toBe(true)
    expect(typeof coreExports.createWebSpeechAdapter).toBe('function')
  })
})

describe('validateSchema', () => {
  it('is exported as a function', () => {
    expect(isExported('validateSchema')).toBe(true)
    expect(typeof coreExports.validateSchema).toBe('function')
  })
})

// ─── VoiceFormConfigError class ───────────────────────────────────────────────

describe('VoiceFormConfigError', () => {
  it('is exported', () => {
    expect(isExported('VoiceFormConfigError')).toBe(true)
  })

  it('is a constructor (class)', () => {
    expect(typeof coreExports.VoiceFormConfigError).toBe('function')
  })

  it('produces instances that are Error subclasses', () => {
    const err = new coreExports.VoiceFormConfigError('SCHEMA_INVALID', 'test message')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(coreExports.VoiceFormConfigError)
    expect(err.message).toBe('test message')
    expect(err.code).toBe('SCHEMA_INVALID')
    expect(err.name).toBe('VoiceFormConfigError')
  })
})

// ─── Type exports (runtime-checked via typeof) ───────────────────────────────
//
// TypeScript erases type-only exports at runtime, so we verify the documented
// types are at least mentioned in the public contract. For pure types there is
// nothing to assert at runtime — the check is that the import compiles.
// What we CAN assert is that no runtime value was accidentally left out.

describe('type exports — compile-time coverage', () => {
  it('types compile without error (static check via import)', () => {
    // If any of these type imports are missing the test file itself will fail
    // to compile, turning a type-system gap into a test failure.
    type _CheckVoiceFormConfig = typeof import('../src/index.js') extends {
      createVoiceForm: unknown
      createWebSpeechAdapter: unknown
      validateSchema: unknown
      VoiceFormConfigError: unknown
      VERSION: unknown
    }
      ? true
      : never

    const _pass: _CheckVoiceFormConfig = true
    expect(_pass).toBe(true)
  })
})

// ─── Internal symbols must NOT be exported ───────────────────────────────────

describe('internal modules are NOT exported', () => {
  it('does not export buildPrompt (server-side utility — belongs in ./server subpath)', () => {
    expect(isExported('buildPrompt')).toBe(false)
  })

  it('does not export buildFieldPrompt (server-side utility — belongs in ./server subpath)', () => {
    expect(isExported('buildFieldPrompt')).toBe(false)
  })

  it('does not export createStateMachine', () => {
    expect(isExported('createStateMachine')).toBe(false)
  })

  it('does not export transition', () => {
    expect(isExported('transition')).toBe(false)
  })

  it('does not export createEndpointClient', () => {
    expect(isExported('createEndpointClient')).toBe(false)
  })

  it('does not export EndpointClient', () => {
    expect(isExported('EndpointClient')).toBe(false)
  })

  it('does not export createInjector', () => {
    expect(isExported('createInjector')).toBe(false)
  })

  it('does not export stripHtml', () => {
    expect(isExported('stripHtml')).toBe(false)
  })

  it('does not export sanitizeFieldValue', () => {
    expect(isExported('sanitizeFieldValue')).toBe(false)
  })

  it('does not export validateTranscript', () => {
    expect(isExported('validateTranscript')).toBe(false)
  })
})
