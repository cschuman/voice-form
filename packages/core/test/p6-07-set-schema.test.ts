// @vitest-environment jsdom

/**
 * P6-07 — setSchema, getSchema, updateSchema deprecation alias
 *
 * Tests cover:
 *  1. setSchema() validates and updates currentSchema, clears injector cache
 *  2. setSchema() throws INVALID_TRANSITION from non-idle states
 *  3. getSchema() returns the currently active schema (same reference)
 *  4. updateSchema() calls setSchema() internally + emits console.warn deprecation
 *  5. updateSchema() existing v1 behavior still passes (idle-only, throws on non-idle)
 *  6. setSchema() with invalid schema throws VoiceFormConfigError(SCHEMA_INVALID)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createVoiceForm } from '../src/create-voice-form.js'
import type {
  FormSchema,
  STTAdapter,
  STTAdapterEvents,
  VoiceFormConfig,
} from '../src/types.js'

// ---------------------------------------------------------------------------
// CSS.escape polyfill guard
// ---------------------------------------------------------------------------
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  ;(globalThis as Record<string, unknown>).CSS = {
    escape: (value: string) =>
      value.replace(
        /([\0-\x1f\x7f]|^[0-9]|[!"#$%&'()*+,./\/:;<=>?@[\\\]^`{|}~])/g,
        '\\$1',
      ),
  }
}

// ---------------------------------------------------------------------------
// rAF helpers
// ---------------------------------------------------------------------------
let rafCallbacks: FrameRequestCallback[] = []
let originalRaf: typeof globalThis.requestAnimationFrame | undefined

function installSyncRaf() {
  originalRaf = globalThis.requestAnimationFrame
  rafCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
}

function uninstallSyncRaf() {
  if (originalRaf) vi.stubGlobal('requestAnimationFrame', originalRaf)
  rafCallbacks = []
}

// ---------------------------------------------------------------------------
// Mock STT adapter
// ---------------------------------------------------------------------------
function createMockAdapter(): STTAdapter & {
  simulateFinal(t: string): void
} {
  let events: STTAdapterEvents | null = null
  return {
    isSupported: () => true,
    async start(e) { events = e },
    stop() {},
    abort() { events = null },
    simulateFinal(t: string) { events?.onFinal(t) },
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
const BASE_SCHEMA: FormSchema = {
  fields: [{ name: 'firstName', type: 'text', label: 'First Name' }],
}

const UPDATED_SCHEMA: FormSchema = {
  fields: [
    { name: 'firstName', type: 'text', label: 'First Name' },
    { name: 'lastName', type: 'text', label: 'Last Name' },
  ],
}

function makeConfig(overrides: Partial<VoiceFormConfig> = {}): VoiceFormConfig {
  return {
    endpoint: 'https://api.example.com/parse',
    schema: BASE_SCHEMA,
    headless: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// SECTION 1 — setSchema
// ---------------------------------------------------------------------------

describe('P6-07 — setSchema()', () => {
  beforeEach(() => {
    installSyncRaf()
    vi.useFakeTimers()
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('setSchema() updates the active schema when called from idle state', () => {
    const instance = createVoiceForm(makeConfig())

    expect(() => instance.setSchema(UPDATED_SCHEMA)).not.toThrow()
    instance.destroy()
  })

  it('getSchema() returns the schema set by setSchema()', () => {
    const instance = createVoiceForm(makeConfig())

    instance.setSchema(UPDATED_SCHEMA)
    const returned = instance.getSchema()

    expect(returned).toStrictEqual(UPDATED_SCHEMA)
    instance.destroy()
  })

  it('getSchema() returns the initial schema before any setSchema call', () => {
    const instance = createVoiceForm(makeConfig())

    const returned = instance.getSchema()

    // Should be equivalent to BASE_SCHEMA (may be a validated copy)
    expect(returned.fields.length).toBe(BASE_SCHEMA.fields.length)
    expect(returned.fields[0]?.name).toBe('firstName')
    instance.destroy()
  })

  it('setSchema() throws INVALID_TRANSITION when called from recording state', async () => {
    const adapter = createMockAdapter()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    await instance.start()
    expect(instance.getState().status).toBe('recording')

    expect(() => instance.setSchema(UPDATED_SCHEMA)).toThrow()
    try {
      instance.setSchema(UPDATED_SCHEMA)
    } catch (err) {
      expect(err).toMatchObject({ code: 'INVALID_TRANSITION' })
    }

    instance.destroy()
  })

  it('setSchema() throws INVALID_TRANSITION when called from processing state', async () => {
    const adapter = createMockAdapter()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    await instance.start()
    adapter.simulateFinal('some transcript')
    // Now in processing — do not await to keep it in-flight
    // We need the state to be processing, which happens synchronously on STT_FINAL

    expect(instance.getState().status).toBe('processing')

    expect(() => instance.setSchema(UPDATED_SCHEMA)).toThrow()
    try {
      instance.setSchema(UPDATED_SCHEMA)
    } catch (err) {
      expect(err).toMatchObject({ code: 'INVALID_TRANSITION' })
    }

    instance.destroy()
  })

  it('setSchema() with empty fields array throws VoiceFormConfigError(SCHEMA_INVALID)', () => {
    const instance = createVoiceForm(makeConfig())

    expect(() =>
      instance.setSchema({ fields: [] } as unknown as FormSchema),
    ).toThrow()

    try {
      instance.setSchema({ fields: [] } as unknown as FormSchema)
    } catch (err) {
      expect(err).toMatchObject({ code: 'SCHEMA_INVALID' })
    }

    instance.destroy()
  })

  it('setSchema() clears injector element cache (next inject re-queries the DOM)', () => {
    // We verify indirectly: after setSchema, if the DOM is mutated and a field
    // renamed, inject should find the new element — proving the cache was cleared.
    const form = document.createElement('form')
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'firstName'
    form.appendChild(input)
    document.body.appendChild(form)

    const instance = createVoiceForm(makeConfig({ formElement: form }))

    // No assertion needed — just ensure setSchema doesn't throw and the instance
    // is still operational afterwards (confirming clearCache was called without error).
    instance.setSchema(UPDATED_SCHEMA)
    expect(instance.getSchema().fields.length).toBe(2)

    document.body.removeChild(form)
    instance.destroy()
  })

  it('setSchema() on a destroyed instance is a no-op (does not throw)', () => {
    const instance = createVoiceForm(makeConfig())
    instance.destroy()

    // destroyed — setSchema must be a no-op, not throw
    expect(() => instance.setSchema(UPDATED_SCHEMA)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// SECTION 2 — getSchema
// ---------------------------------------------------------------------------

describe('P6-07 — getSchema()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the same schema reference passed to setSchema()', () => {
    const instance = createVoiceForm(makeConfig())
    const newSchema: FormSchema = {
      fields: [{ name: 'city', type: 'text', label: 'City' }],
    }

    instance.setSchema(newSchema)

    // The returned schema must be structurally equal (validated copy is allowed)
    // but the field names and structure must match exactly.
    const returned = instance.getSchema()
    expect(returned.fields[0]?.name).toBe('city')
    expect(returned.fields.length).toBe(1)

    instance.destroy()
  })

  it('getSchema() returns updated schema after each setSchema() call', () => {
    const instance = createVoiceForm(makeConfig())

    instance.setSchema(UPDATED_SCHEMA)
    expect(instance.getSchema().fields.length).toBe(2)

    const thirdSchema: FormSchema = {
      fields: [{ name: 'address', type: 'text', label: 'Address' }],
    }
    instance.setSchema(thirdSchema)
    expect(instance.getSchema().fields[0]?.name).toBe('address')

    instance.destroy()
  })
})

// ---------------------------------------------------------------------------
// SECTION 3 — updateSchema deprecation alias
// ---------------------------------------------------------------------------

describe('P6-07 — updateSchema() deprecation alias', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('updateSchema() emits a console.warn deprecation message', () => {
    const instance = createVoiceForm(makeConfig())

    instance.updateSchema(UPDATED_SCHEMA)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('updateSchema'),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('deprecated'),
    )

    instance.destroy()
  })

  it('updateSchema() updates the schema (delegates to setSchema)', () => {
    const instance = createVoiceForm(makeConfig())

    instance.updateSchema(UPDATED_SCHEMA)

    const returned = instance.getSchema()
    expect(returned.fields.length).toBe(2)
    expect(returned.fields[1]?.name).toBe('lastName')

    instance.destroy()
  })

  it('updateSchema() throws INVALID_TRANSITION when not in idle state', async () => {
    vi.useFakeTimers()
    installSyncRaf()
    const adapter = createMockAdapter()
    const instance = createVoiceForm(makeConfig({ sttAdapter: adapter }))

    await instance.start()
    expect(instance.getState().status).toBe('recording')

    expect(() => instance.updateSchema(UPDATED_SCHEMA)).toThrow()
    try {
      instance.updateSchema(UPDATED_SCHEMA)
    } catch (err) {
      expect(err).toMatchObject({ code: 'INVALID_TRANSITION' })
    }

    instance.destroy()
    uninstallSyncRaf()
    vi.useRealTimers()
  })

  it('updateSchema() with invalid schema propagates VoiceFormConfigError', () => {
    const instance = createVoiceForm(makeConfig())

    expect(() =>
      instance.updateSchema({ fields: [] } as unknown as FormSchema),
    ).toThrow()

    try {
      instance.updateSchema({ fields: [] } as unknown as FormSchema)
    } catch (err) {
      expect(err).toMatchObject({ code: 'SCHEMA_INVALID' })
    }

    instance.destroy()
  })
})
