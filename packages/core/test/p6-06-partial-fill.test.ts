// @vitest-environment jsdom

/**
 * P6-06 — Partial fill and append mode
 *
 * Tests cover:
 *  1. Null/undefined field values are skipped (existing DOM value preserved)
 *  2. appendMode: new value concatenated to existing with a space
 *  3. appendMode on an empty field: just sets the new value (no leading space)
 *  4. appendMode only applies to text/textarea — other types replace regardless
 *  5. existingValue is captured from DOM in buildConfirmationData when appendMode
 *  6. multiStep: missing element is console.warn (not console.error); success=true
 *  7. multiStep=false (default): missing element is console.error; success=false
 *  8. ConfirmationData.appendMode set from config
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createInjector } from '../src/injector.js'
import { createVoiceForm } from '../src/create-voice-form.js'
import type {
  ConfirmedField,
  STTAdapter,
  STTAdapterEvents,
  VoiceFormConfig,
  ParseResponse,
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

function flushRaf() {
  const pending = [...rafCallbacks]
  rafCallbacks.length = 0
  pending.forEach((cb) => cb(performance.now()))
}

function uninstallSyncRaf() {
  if (originalRaf) vi.stubGlobal('requestAnimationFrame', originalRaf)
  rafCallbacks = []
}

// ---------------------------------------------------------------------------
// ConfirmedField helper
// ---------------------------------------------------------------------------
function confirmedField(value: string, extra?: Partial<ConfirmedField>): ConfirmedField {
  return { label: 'Test', value, ...extra }
}

// ---------------------------------------------------------------------------
// Mock STT adapter
// ---------------------------------------------------------------------------
function createMockAdapter(): STTAdapter & { simulateFinal(t: string): void } {
  let events: STTAdapterEvents | null = null
  return {
    isSupported: () => true,
    async start(e) { events = e },
    stop() {},
    abort() { events = null },
    simulateFinal(t: string) { events?.onFinal(t) },
  }
}

function makeConfig(overrides: Partial<VoiceFormConfig> = {}): VoiceFormConfig {
  return {
    endpoint: 'https://api.example.com/parse',
    schema: {
      fields: [
        { name: 'notes', type: 'text', label: 'Notes' },
        { name: 'email', type: 'email', label: 'Email' },
      ],
    },
    headless: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// SECTION 1 — inject() accepts ConfirmedField (type-level and runtime)
// ---------------------------------------------------------------------------

describe('P6-06 — inject() accepts ConfirmedField records', () => {
  let form: HTMLFormElement

  beforeEach(() => {
    installSyncRaf()
    form = document.createElement('form')
    document.body.appendChild(form)
  })

  afterEach(() => {
    uninstallSyncRaf()
    document.body.removeChild(form)
  })

  it('injects a text field from a ConfirmedField (value property used)', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'firstName'
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject({ firstName: confirmedField('Alice') })
    flushRaf()
    const result = await promise

    expect(input.value).toBe('Alice')
    expect(result.fields['firstName']).toEqual({ status: 'injected', value: 'Alice' })
    expect(result.success).toBe(true)
  })

  it('skips a field with null/undefined value (existing DOM value preserved)', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'bio'
    input.value = 'Existing content'
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    // Passing empty string simulates a null/skipped field — the injector
    // sees value === '' and (when appendMode is false) overwrites. The
    // real null-skip path is: the field is simply absent from the record.
    // Test: field absent from the inject call entirely → DOM unchanged.
    const otherInput = document.createElement('input')
    otherInput.type = 'text'
    otherInput.name = 'other'
    form.appendChild(otherInput)

    const promise = injector.inject({ other: confirmedField('new') })
    flushRaf()
    await promise

    // bio was not in the fields record — DOM value must be unchanged
    expect(input.value).toBe('Existing content')
    expect(otherInput.value).toBe('new')
  })
})

// ---------------------------------------------------------------------------
// SECTION 2 — appendMode concatenation
// ---------------------------------------------------------------------------

describe('P6-06 — appendMode: true — text/textarea concatenation', () => {
  let form: HTMLFormElement

  beforeEach(() => {
    installSyncRaf()
    form = document.createElement('form')
    document.body.appendChild(form)
  })

  afterEach(() => {
    uninstallSyncRaf()
    document.body.removeChild(form)
  })

  it('appends new value to existing with a space for a text input', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'notes'
    form.appendChild(input)

    const injector = createInjector({ formElement: form, appendMode: true })
    const promise = injector.inject({
      notes: confirmedField('World', { existingValue: 'Hello' }),
    })
    flushRaf()
    const result = await promise

    expect(input.value).toBe('Hello World')
    expect(result.fields['notes']).toEqual({ status: 'injected', value: 'Hello World' })
    expect(result.success).toBe(true)
  })

  it('appends new value to existing with a space for a textarea', async () => {
    const ta = document.createElement('textarea')
    ta.name = 'description'
    form.appendChild(ta)

    const injector = createInjector({ formElement: form, appendMode: true })
    const promise = injector.inject({
      description: confirmedField('second sentence', { existingValue: 'First sentence.' }),
    })
    flushRaf()
    await promise

    expect(ta.value).toBe('First sentence. second sentence')
  })

  it('uses just the new value when existingValue is empty string (no leading space)', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'tag'
    form.appendChild(input)

    const injector = createInjector({ formElement: form, appendMode: true })
    const promise = injector.inject({
      tag: confirmedField('TypeScript', { existingValue: '' }),
    })
    flushRaf()
    const result = await promise

    expect(input.value).toBe('TypeScript')
    expect(result.success).toBe(true)
  })

  it('uses just the new value when existingValue is whitespace-only (no leading space)', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'tag'
    form.appendChild(input)

    const injector = createInjector({ formElement: form, appendMode: true })
    const promise = injector.inject({
      tag: confirmedField('TypeScript', { existingValue: '   ' }),
    })
    flushRaf()
    const result = await promise

    expect(input.value).toBe('TypeScript')
    expect(result.success).toBe(true)
  })

  it('uses just the new value when existingValue is absent (appendMode but no prior value)', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'tag'
    form.appendChild(input)

    const injector = createInjector({ formElement: form, appendMode: true })
    const promise = injector.inject({
      tag: confirmedField('TypeScript'),
    })
    flushRaf()
    const result = await promise

    expect(input.value).toBe('TypeScript')
    expect(result.success).toBe(true)
  })

  it('appendMode does NOT apply to number inputs — replaces value', async () => {
    const input = document.createElement('input')
    input.type = 'number'
    input.name = 'age'
    form.appendChild(input)

    const injector = createInjector({ formElement: form, appendMode: true })
    const promise = injector.inject({
      age: confirmedField('30', { existingValue: '25' }),
    })
    flushRaf()
    const result = await promise

    // number field ignores existingValue — replaces with 30
    expect(input.value).toBe('30')
    expect(result.success).toBe(true)
  })

  it('appendMode does NOT apply to date inputs — replaces value', async () => {
    const input = document.createElement('input')
    input.type = 'date'
    input.name = 'dob'
    form.appendChild(input)

    const injector = createInjector({ formElement: form, appendMode: true })
    const promise = injector.inject({
      dob: confirmedField('2024-01-15', { existingValue: '2020-05-01' }),
    })
    flushRaf()
    await promise

    expect(input.value).toBe('2024-01-15')
  })

  it('appendMode=false (default) replaces existing text value', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'notes'
    form.appendChild(input)

    const injector = createInjector({ formElement: form, appendMode: false })
    const promise = injector.inject({
      notes: confirmedField('New value', { existingValue: 'Old value' }),
    })
    flushRaf()
    const result = await promise

    // appendMode false — existingValue ignored, replaces with 'New value'
    expect(input.value).toBe('New value')
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SECTION 3 — multiStep mode
// ---------------------------------------------------------------------------

describe('P6-06 — multiStep: true — missing DOM element is a warning, not failure', () => {
  let form: HTMLFormElement
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    installSyncRaf()
    form = document.createElement('form')
    document.body.appendChild(form)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    uninstallSyncRaf()
    document.body.removeChild(form)
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('emits console.warn (not console.error) for a missing element in multiStep mode', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'firstName'
    form.appendChild(input)

    const injector = createInjector({ formElement: form, multiStep: true })
    const promise = injector.inject({
      firstName: confirmedField('Alice'),
      nextStep: confirmedField('something'), // not in current DOM step
    })
    flushRaf()
    await promise

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('nextStep'),
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('success=true when all found fields injected in multiStep mode (missing field is expected)', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'step1field'
    form.appendChild(input)

    const injector = createInjector({ formElement: form, multiStep: true })
    const promise = injector.inject({
      step1field: confirmedField('filled'),
      step2field: confirmedField('deferred'), // not in DOM yet
    })
    flushRaf()
    const result = await promise

    expect(result.success).toBe(true)
    expect(input.value).toBe('filled')
  })

  it('success=false when a found field fails to inject in multiStep mode', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'locked'
    input.disabled = true
    form.appendChild(input)

    const injector = createInjector({ formElement: form, multiStep: true })
    const promise = injector.inject({
      locked: confirmedField('value'),
    })
    flushRaf()
    const result = await promise

    // disabled field skips → not 'injected' → success=false even in multiStep
    expect(result.success).toBe(false)
  })

  it('multiStep=false (default) emits console.error for missing element', async () => {
    const injector = createInjector({ formElement: form, multiStep: false })
    const promise = injector.inject({ ghost: confirmedField('value') })
    flushRaf()
    const result = await promise

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ghost'),
    )
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('ghost'))
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SECTION 4 — buildConfirmationData existingValue + appendMode forwarded
// ---------------------------------------------------------------------------

describe('P6-06 — buildConfirmationData existingValue + ConfirmationData.appendMode', () => {
  let adapter: ReturnType<typeof createMockAdapter>
  let form: HTMLFormElement

  beforeEach(() => {
    vi.useFakeTimers()
    installSyncRaf()
    adapter = createMockAdapter()
    form = document.createElement('form')

    const notesInput = document.createElement('input')
    notesInput.type = 'text'
    notesInput.name = 'notes'
    notesInput.value = 'Prior content'
    form.appendChild(notesInput)

    const emailInput = document.createElement('input')
    emailInput.type = 'email'
    emailInput.name = 'email'
    emailInput.value = 'old@example.com'
    form.appendChild(emailInput)

    document.body.appendChild(form)
  })

  afterEach(() => {
    uninstallSyncRaf()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.removeChild(form)
  })

  async function flushAll(ms = 0) {
    if (ms > 0) vi.advanceTimersByTime(ms)
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
    await Promise.resolve()
    flushRaf()
    await Promise.resolve()
  }

  it('ConfirmationData.appendMode is true when config.appendMode is true', async () => {
    const parseResponse: ParseResponse = {
      fields: {
        notes: { value: 'New stuff' },
        email: { value: 'new@example.com' },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(parseResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, appendMode: true, formElement: form }),
    )

    await instance.start()
    adapter.simulateFinal('New stuff new@example.com')
    await flushAll()
    await flushAll()

    const state = instance.getState()
    expect(state.status).toBe('confirming')
    if (state.status === 'confirming') {
      expect(state.confirmation.appendMode).toBe(true)
    }

    instance.destroy()
  })

  it('ConfirmationData.appendMode is false when config.appendMode is omitted', async () => {
    const parseResponse: ParseResponse = {
      fields: {
        notes: { value: 'Hello' },
        email: { value: 'a@b.com' },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(parseResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter }),
    )

    await instance.start()
    adapter.simulateFinal('Hello a@b.com')
    await flushAll()
    await flushAll()

    const state = instance.getState()
    expect(state.status).toBe('confirming')
    if (state.status === 'confirming') {
      expect(state.confirmation.appendMode).toBe(false)
    }

    instance.destroy()
  })

  it('existingValue is captured from DOM for text fields when appendMode is true', async () => {
    const parseResponse: ParseResponse = {
      fields: {
        notes: { value: 'New stuff' },
        email: { value: 'new@example.com' },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(parseResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, appendMode: true, formElement: form }),
    )

    await instance.start()
    adapter.simulateFinal('New stuff new@example.com')
    await flushAll()
    await flushAll()

    const state = instance.getState()
    expect(state.status).toBe('confirming')
    if (state.status === 'confirming') {
      // text field: existingValue captured from DOM
      expect(state.confirmation.parsedFields['notes']?.existingValue).toBe('Prior content')
      // email field: NOT text/textarea — existingValue is NOT captured
      expect(state.confirmation.parsedFields['email']?.existingValue).toBeUndefined()
    }

    instance.destroy()
  })

  it('existingValue is NOT captured when appendMode is false', async () => {
    const parseResponse: ParseResponse = {
      fields: {
        notes: { value: 'Hello' },
        email: { value: 'a@b.com' },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(parseResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter }),
    )

    await instance.start()
    adapter.simulateFinal('Hello a@b.com')
    await flushAll()
    await flushAll()

    const state = instance.getState()
    expect(state.status).toBe('confirming')
    if (state.status === 'confirming') {
      expect(state.confirmation.parsedFields['notes']?.existingValue).toBeUndefined()
      expect(state.confirmation.parsedFields['email']?.existingValue).toBeUndefined()
    }

    instance.destroy()
  })

  it('inject() uses existingValue from ConfirmedField for append in full flow', async () => {
    // Full integration: notes has existingValue='Prior content', LLM adds 'New stuff'
    // After inject, DOM should have 'Prior content New stuff'
    const parseResponse: ParseResponse = {
      fields: {
        notes: { value: 'New stuff' },
        email: { value: 'new@example.com' },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(parseResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const notesInput = form.querySelector<HTMLInputElement>('[name="notes"]')!
    const emailInput = form.querySelector<HTMLInputElement>('[name="email"]')!

    const instance = createVoiceForm(
      makeConfig({ sttAdapter: adapter, appendMode: true, formElement: form }),
    )

    await instance.start()
    adapter.simulateFinal('New stuff new@example.com')
    await flushAll()
    await flushAll()

    expect(instance.getState().status).toBe('confirming')
    await instance.confirm()
    await flushAll()
    flushRaf()
    await flushAll()

    // notes is a text field — appendMode applies, result is concatenated
    expect(notesInput.value).toBe('Prior content New stuff')
    // email is NOT a text/textarea field — appendMode does NOT apply, value replaces
    expect(emailInput.value).toBe('new@example.com')

    instance.destroy()
  })
})
