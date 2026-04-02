// @vitest-environment jsdom

/**
 * Tests for packages/core/src/injector.ts
 *
 * Two modes:
 *  1. Callback mode  — config.onFill is provided
 *  2. DOM injection mode — config.formElement is provided
 *
 * TDD: these tests are written before the implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createInjector } from '../src/injector.js'
import type { ParsedFieldValue } from '../src/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ParsedFieldValue record for testing */
function fields(
  record: Record<string, string>,
): Record<string, ParsedFieldValue> {
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, { value: v }]),
  )
}

// ---------------------------------------------------------------------------
// CSS.escape polyfill guard
// ---------------------------------------------------------------------------
// jsdom ships CSS.escape; assert it is available so tests fail clearly if not.
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  // Minimal polyfill so tests can run in environments without it.
  // The production code should rely on the browser-native implementation.
  ;(globalThis as Record<string, unknown>).CSS = {
    escape: (value: string) =>
      value.replace(
        /([\0-\x1f\x7f]|^[0-9]|[!"#$%&'()*+,./\/:;<=>?@[\\\]^`{|}~])/g,
        '\\$1',
      ),
  }
}

// ---------------------------------------------------------------------------
// SECTION 1 — Callback mode
// ---------------------------------------------------------------------------

describe('createInjector — callback mode', () => {
  it('calls onFill for every field with the correct name and value', async () => {
    const onFill = vi.fn()
    const injector = createInjector({ onFill })

    const result = await injector.inject(
      fields({ firstName: 'Alice', lastName: 'Smith' }),
    )

    expect(onFill).toHaveBeenCalledTimes(2)
    expect(onFill).toHaveBeenCalledWith('firstName', 'Alice')
    expect(onFill).toHaveBeenCalledWith('lastName', 'Smith')

    expect(result.success).toBe(true)
    expect(result.fields['firstName']).toEqual({ status: 'injected', value: 'Alice' })
    expect(result.fields['lastName']).toEqual({ status: 'injected', value: 'Smith' })
  })

  it('awaits async onFill callbacks in series (not parallel)', async () => {
    const order: string[] = []

    const onFill = async (name: string) => {
      // Simulate varying async latency — if run in parallel the order
      // would be non-deterministic.
      await new Promise<void>((resolve) => setTimeout(resolve, name === 'a' ? 10 : 1))
      order.push(name)
    }

    const injector = createInjector({ onFill })
    await injector.inject(fields({ a: '1', b: '2' }))

    // Series execution guarantees 'a' finishes before 'b' starts, regardless
    // of individual latency.
    expect(order).toEqual(['a', 'b'])
  })

  it('records a failed field and continues to the next when onFill throws synchronously', async () => {
    const onFill = vi.fn((name: string) => {
      if (name === 'bad') throw new Error('sync error')
    })

    const injector = createInjector({ onFill })
    const result = await injector.inject(fields({ good: 'ok', bad: 'boom', also: 'fine' }))

    // All three fields are attempted.
    expect(onFill).toHaveBeenCalledTimes(3)

    // 'bad' is recorded as failed.
    expect(result.fields['bad']).toMatchObject({ status: 'failed' })

    // The other two succeed.
    expect(result.fields['good']).toEqual({ status: 'injected', value: 'ok' })
    expect(result.fields['also']).toEqual({ status: 'injected', value: 'fine' })

    // Overall success is false because one field failed.
    expect(result.success).toBe(false)
  })

  it('records a failed field and continues when onFill returns a rejected Promise', async () => {
    const onFill = vi.fn(async (name: string) => {
      if (name === 'bad') throw new Error('async error')
    })

    const injector = createInjector({ onFill })
    const result = await injector.inject(fields({ good: '1', bad: '2', also: '3' }))

    expect(onFill).toHaveBeenCalledTimes(3)
    expect(result.fields['bad']).toMatchObject({ status: 'failed' })
    expect(result.fields['good']).toEqual({ status: 'injected', value: '1' })
    expect(result.fields['also']).toEqual({ status: 'injected', value: '3' })
    expect(result.success).toBe(false)
  })

  it('records all fields as failed when every callback rejects', async () => {
    const onFill = vi.fn(async () => {
      throw new Error('all bad')
    })

    const injector = createInjector({ onFill })
    const result = await injector.inject(fields({ a: '1', b: '2', c: '3' }))

    expect(result.success).toBe(false)
    expect(result.fields['a']).toMatchObject({ status: 'failed' })
    expect(result.fields['b']).toMatchObject({ status: 'failed' })
    expect(result.fields['c']).toMatchObject({ status: 'failed' })
  })

  it('returns success:true and an empty fields record for an empty fields object', async () => {
    const onFill = vi.fn()
    const injector = createInjector({ onFill })
    const result = await injector.inject({})

    expect(result.success).toBe(true)
    expect(result.fields).toEqual({})
    expect(onFill).not.toHaveBeenCalled()
  })

  it('InjectionResult.fields carries a non-empty error string when onFill throws', async () => {
    const onFill = vi.fn(() => {
      throw new Error('something went wrong')
    })

    const injector = createInjector({ onFill })
    const result = await injector.inject(fields({ x: 'v' }))

    const outcome = result.fields['x']
    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') {
      expect(typeof outcome.error).toBe('string')
      expect(outcome.error.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// SECTION 2 — DOM injection mode
// ---------------------------------------------------------------------------

describe('createInjector — DOM injection mode', () => {
  let form: HTMLFormElement
  let rafCallbacks: FrameRequestCallback[]
  let originalRaf: typeof requestAnimationFrame

  beforeEach(() => {
    // Attach a fresh form to document.body before each test.
    form = document.createElement('form')
    document.body.appendChild(form)

    // Capture rAF callbacks so we can flush them synchronously in tests.
    rafCallbacks = []
    originalRaf = globalThis.requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
  })

  afterEach(() => {
    document.body.removeChild(form)
    vi.stubGlobal('requestAnimationFrame', originalRaf)
    rafCallbacks = []
    vi.restoreAllMocks()
  })

  /** Flush all captured rAF callbacks synchronously. */
  function flushRaf() {
    const pending = [...rafCallbacks]
    rafCallbacks.length = 0
    pending.forEach((cb) => cb(performance.now()))
  }

  // ── Text input ────────────────────────────────────────────────────────────

  it('sets text input value via native setter', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'username'
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ username: 'alice' }))
    flushRaf()
    await promise

    expect(input.value).toBe('alice')
  })

  it('dispatches input and change events after setting value', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'city'
    form.appendChild(input)

    const inputEvents: Event[] = []
    const changeEvents: Event[] = []
    input.addEventListener('input', (e) => inputEvents.push(e))
    input.addEventListener('change', (e) => changeEvents.push(e))

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ city: 'Seattle' }))
    flushRaf()
    await promise

    expect(inputEvents).toHaveLength(1)
    expect(changeEvents).toHaveLength(1)
  })

  it('two-pass batching: all values written before any events dispatched', async () => {
    const inputA = document.createElement('input')
    inputA.type = 'text'
    inputA.name = 'fieldA'
    form.appendChild(inputA)

    const inputB = document.createElement('input')
    inputB.type = 'text'
    inputB.name = 'fieldB'
    form.appendChild(inputB)

    const log: string[] = []

    // Record when events fire relative to when values are set.
    inputA.addEventListener('input', () => log.push(`event:fieldA(value=${inputA.value})`))
    inputB.addEventListener('input', () => log.push(`event:fieldB(value=${inputB.value})`))

    // Spy on the native setter to record write order.
    const nativeInputDescriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!
    const originalSetter = nativeInputDescriptor.set!
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      ...nativeInputDescriptor,
      set(val: string) {
        log.push(`write:${(this as HTMLInputElement).name}=${val}`)
        originalSetter.call(this, val)
      },
    })

    try {
      const injector = createInjector({ formElement: form })
      const promise = injector.inject(fields({ fieldA: 'A', fieldB: 'B' }))
      flushRaf()
      await promise

      // Both writes must appear before any event in the log.
      const firstEventIndex = log.findIndex((e) => e.startsWith('event:'))
      const lastWriteIndex = log.reduce(
        (idx, e, i) => (e.startsWith('write:') ? i : idx),
        -1,
      )
      expect(firstEventIndex).toBeGreaterThan(lastWriteIndex)
    } finally {
      // Restore original descriptor.
      Object.defineProperty(HTMLInputElement.prototype, 'value', nativeInputDescriptor)
    }
  })

  // ── Textarea ──────────────────────────────────────────────────────────────

  it('sets textarea value via the textarea native setter', async () => {
    const ta = document.createElement('textarea')
    ta.name = 'bio'
    form.appendChild(ta)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ bio: 'Hello world' }))
    flushRaf()
    await promise

    expect(ta.value).toBe('Hello world')
  })

  it('dispatches input and change events on textarea', async () => {
    const ta = document.createElement('textarea')
    ta.name = 'notes'
    form.appendChild(ta)

    let inputFired = false
    let changeFired = false
    ta.addEventListener('input', () => { inputFired = true })
    ta.addEventListener('change', () => { changeFired = true })

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ notes: 'some notes' }))
    flushRaf()
    await promise

    expect(inputFired).toBe(true)
    expect(changeFired).toBe(true)
  })

  // ── Select ────────────────────────────────────────────────────────────────

  it('selects the correct option in a select element', async () => {
    const select = document.createElement('select')
    select.name = 'country'
    for (const val of ['US', 'CA', 'MX']) {
      const opt = document.createElement('option')
      opt.value = val
      select.appendChild(opt)
    }
    form.appendChild(select)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ country: 'CA' }))
    flushRaf()
    await promise

    expect(select.value).toBe('CA')
  })

  it('dispatches change event on select', async () => {
    const select = document.createElement('select')
    select.name = 'size'
    for (const val of ['S', 'M', 'L']) {
      const opt = document.createElement('option')
      opt.value = val
      select.appendChild(opt)
    }
    form.appendChild(select)

    let changeFired = false
    select.addEventListener('change', () => { changeFired = true })

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ size: 'M' }))
    flushRaf()
    await promise

    expect(changeFired).toBe(true)
  })

  it('returns skipped/value-not-in-options when select value is not an existing option', async () => {
    const select = document.createElement('select')
    select.name = 'plan'
    for (const val of ['basic', 'pro']) {
      const opt = document.createElement('option')
      opt.value = val
      select.appendChild(opt)
    }
    form.appendChild(select)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ plan: 'enterprise' }))
    flushRaf()
    const result = await promise

    expect(result.fields['plan']).toEqual({
      status: 'skipped',
      reason: 'value-not-in-options',
    })
    expect(result.success).toBe(false)
  })

  // ── Checkbox ──────────────────────────────────────────────────────────────

  it('checks a checkbox for truthy string values', async () => {
    for (const truthyVal of ['true', 'yes', '1', 'on', 'checked']) {
      // Remove all children and re-add a fresh checkbox for each iteration.
      while (form.firstChild) form.removeChild(form.firstChild)

      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.name = 'agree'
      cb.checked = false
      form.appendChild(cb)

      const injector = createInjector({ formElement: form })
      const promise = injector.inject(fields({ agree: truthyVal }))
      flushRaf()
      await promise

      expect(cb.checked).toBe(true)
    }
  })

  it('unchecks a checkbox for falsy string values', async () => {
    for (const falsyVal of ['false', 'no', '0', 'off']) {
      while (form.firstChild) form.removeChild(form.firstChild)

      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.name = 'agree'
      cb.checked = true
      form.appendChild(cb)

      const injector = createInjector({ formElement: form })
      const promise = injector.inject(fields({ agree: falsyVal }))
      flushRaf()
      await promise

      expect(cb.checked).toBe(false)
    }
  })

  it('dispatches change event on checkbox', async () => {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.name = 'terms'
    form.appendChild(cb)

    let changeFired = false
    cb.addEventListener('change', () => { changeFired = true })

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ terms: 'true' }))
    flushRaf()
    await promise

    expect(changeFired).toBe(true)
  })

  // ── Radio ─────────────────────────────────────────────────────────────────

  it('checks the matching radio input and unchecks others in the group', async () => {
    const radios: HTMLInputElement[] = []
    for (const val of ['yes', 'no', 'maybe']) {
      const r = document.createElement('input')
      r.type = 'radio'
      r.name = 'answer'
      r.value = val
      form.appendChild(r)
      radios.push(r)
    }

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ answer: 'no' }))
    flushRaf()
    await promise

    expect(radios[0].checked).toBe(false) // 'yes'
    expect(radios[1].checked).toBe(true)  // 'no'
    expect(radios[2].checked).toBe(false) // 'maybe'
  })

  it('dispatches change event on the newly checked radio input', async () => {
    const r1 = document.createElement('input')
    r1.type = 'radio'
    r1.name = 'choice'
    r1.value = 'A'
    form.appendChild(r1)

    const r2 = document.createElement('input')
    r2.type = 'radio'
    r2.name = 'choice'
    r2.value = 'B'
    form.appendChild(r2)

    let changeCount = 0
    r2.addEventListener('change', () => { changeCount++ })

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ choice: 'B' }))
    flushRaf()
    await promise

    expect(changeCount).toBe(1)
  })

  // ── Element lookup strategy ───────────────────────────────────────────────

  it('finds an element by name attribute', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'byName'
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ byName: 'found' }))
    flushRaf()
    await promise

    expect(input.value).toBe('found')
  })

  it('finds an element by id when no name attribute is present', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.id = 'byId'
    // No name attribute set.
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ byId: 'found' }))
    flushRaf()
    await promise

    expect(input.value).toBe('found')
  })

  it('finds an element by data-voiceform attribute when neither name nor id match', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.setAttribute('data-voiceform', 'byDataAttr')
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ byDataAttr: 'found' }))
    flushRaf()
    await promise

    expect(input.value).toBe('found')
  })

  // ── CSS.escape ────────────────────────────────────────────────────────────

  it('resolves field names with CSS special characters (dots) via CSS.escape', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.setAttribute('name', 'address.line1')
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ 'address.line1': '123 Main St' }))
    flushRaf()
    await promise

    expect(input.value).toBe('123 Main St')
  })

  // ── Disabled / Readonly ───────────────────────────────────────────────────

  it('returns skipped/disabled for a disabled input, does not set its value', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'locked'
    input.disabled = true
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ locked: 'value' }))
    flushRaf()
    const result = await promise

    expect(result.fields['locked']).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(result.success).toBe(false)
    expect(input.value).toBe('')
  })

  it('returns skipped/read-only for a readonly input, does not set its value', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'fixed'
    input.readOnly = true
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ fixed: 'value' }))
    flushRaf()
    const result = await promise

    expect(result.fields['fixed']).toEqual({ status: 'skipped', reason: 'read-only' })
    expect(result.success).toBe(false)
    expect(input.value).toBe('')
  })

  // ── Missing element ───────────────────────────────────────────────────────

  it('records element-not-found for a missing element, and still injects the others', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'existing'
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    // 'ghost' has no matching DOM element.
    const promise = injector.inject(fields({ existing: 'ok', ghost: 'nope' }))
    flushRaf()
    const result = await promise

    expect(result.fields['existing']).toEqual({ status: 'injected', value: 'ok' })
    expect(result.fields['ghost']).toEqual({ status: 'skipped', reason: 'element-not-found' })
    expect(result.success).toBe(false)
  })

  // ── Element cache ─────────────────────────────────────────────────────────

  it('element cache: second inject call does not re-query the DOM', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'cached'
    form.appendChild(input)

    const querySpy = vi.spyOn(form, 'querySelector')

    const injector = createInjector({ formElement: form })

    // First injection — populates cache.
    let promise = injector.inject(fields({ cached: 'first' }))
    flushRaf()
    await promise

    const firstCallCount = querySpy.mock.calls.length

    // Second injection — should use cache, no new querySelector calls.
    promise = injector.inject(fields({ cached: 'second' }))
    flushRaf()
    await promise

    const secondCallCount = querySpy.mock.calls.length

    expect(secondCallCount).toBe(firstCallCount)
  })

  it('clearCache causes the next inject to re-query the DOM', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'toRecache'
    form.appendChild(input)

    const querySpy = vi.spyOn(form, 'querySelector')

    const injector = createInjector({ formElement: form })

    // First injection — populates cache.
    let promise = injector.inject(fields({ toRecache: 'v1' }))
    flushRaf()
    await promise

    const afterFirstCount = querySpy.mock.calls.length

    injector.clearCache()

    // After clearCache, the next inject must re-query.
    promise = injector.inject(fields({ toRecache: 'v2' }))
    flushRaf()
    await promise

    const afterSecondCount = querySpy.mock.calls.length

    expect(afterSecondCount).toBeGreaterThan(afterFirstCount)
  })

  // ── HTML stripping ────────────────────────────────────────────────────────

  it('strips HTML tags from a text field value before injecting into the DOM', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'dirty'
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ dirty: '<b>clean</b>' }))
    flushRaf()
    await promise

    // The injected value should have HTML stripped to plain text.
    expect(input.value).toBe('clean')
  })

  // ── InjectionResult.success ───────────────────────────────────────────────

  it('success is true when all fields are injected without error', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'ok'
    form.appendChild(input)

    const injector = createInjector({ formElement: form })
    const promise = injector.inject(fields({ ok: 'value' }))
    flushRaf()
    const result = await promise

    expect(result.success).toBe(true)
  })

  it('success is false if any field is skipped or failed', async () => {
    const injector = createInjector({ formElement: form })
    // No elements in the form — every field will be element-not-found.
    const promise = injector.inject(fields({ missing: 'v' }))
    flushRaf()
    const result = await promise

    expect(result.success).toBe(false)
  })

  // ── Performance: 20 fields under 16 ms ───────────────────────────────────

  it('injects 20 fields within 16 ms (batched rAF write-then-dispatch)', async () => {
    const fieldRecord: Record<string, ParsedFieldValue> = {}

    for (let i = 0; i < 20; i++) {
      const name = `perfField${i}`
      const input = document.createElement('input')
      input.type = 'text'
      input.name = name
      form.appendChild(input)
      fieldRecord[name] = { value: `value${i}` }
    }

    const injector = createInjector({ formElement: form })

    const start = performance.now()
    const promise = injector.inject(fieldRecord)
    flushRaf()
    await promise
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(16)

    // Sanity-check that values were actually set.
    for (let i = 0; i < 20; i++) {
      const el = form.querySelector<HTMLInputElement>(`[name="perfField${i}"]`)
      expect(el?.value).toBe(`value${i}`)
    }
  })
})
