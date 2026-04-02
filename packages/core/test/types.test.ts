// @vitest-environment jsdom
/**
 * P1-01 — Type system verification tests for @voiceform/core
 *
 * Strategy: These tests use runtime value construction to verify that the
 * exported types are shaped correctly. TypeScript compile-time checks
 * (assignability, exhaustiveness) are expressed as type-level assertions
 * that fail at `tsc --noEmit` time if the types are wrong.
 *
 * Each describe block covers one exported type from types.ts.
 */
import { describe, it, expect } from 'vitest'
import type {
  FieldType,
  FieldValidation,
  FieldSchema,
  FormSchema,
  STTAdapterEvents,
  STTAdapter,
  STTErrorCode,
  STTError,
  ParsedFieldValue,
  ParseRequest,
  ParseResponse,
  VoiceFormStatus,
  VoiceFormState,
  ConfirmedField,
  ConfirmationData,
  FieldInjectionOutcome,
  InjectionResult,
  VoiceFormEvent,
  VoiceFormEvents,
  EndpointOptions,
  EndpointErrorCode,
  EndpointError,
  UIOptions,
  VoiceFormCSSVars,
  VoiceFormConfig,
  VoiceFormInstance,
  VoiceFormErrorCode,
  VoiceFormError,
  VoiceFormConfigError,
  StateMachine,
  ValidationResult,
  VoiceFormStrings,
  StateListener,
  Unsubscribe,
} from '../src/types.js'
import type { InjectorConfig } from '../src/injector.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A compile-time exhaustiveness helper. If `T` is `never`, this is a no-op.
 * If `T` is not `never`, TypeScript emits an error — meaning a branch is
 * unhandled in the union.
 */
function assertNever(_: never): never {
  throw new Error('assertNever reached — non-exhaustive switch')
}

/**
 * Compile-time type equality check.
 * `AssertExtends<A, B>` compiles only if A extends B.
 */
type AssertExtends<_A extends _B, _B> = true

// ─── FieldType ────────────────────────────────────────────────────────────────

describe('FieldType', () => {
  it('accepts all valid field types', () => {
    const types: FieldType[] = [
      'text',
      'email',
      'tel',
      'number',
      'date',
      'select',
      'checkbox',
      'radio',
      'textarea',
    ]
    expect(types).toHaveLength(9)
  })

  it('is a string union (not an enum)', () => {
    const t: FieldType = 'email'
    // If FieldType were an enum, this comparison would not hold at runtime.
    expect(t === 'email').toBe(true)
  })
})

// ─── FieldValidation ──────────────────────────────────────────────────────────

describe('FieldValidation', () => {
  it('accepts a full validation object', () => {
    const v: FieldValidation = {
      minLength: 1,
      maxLength: 100,
      min: 0,
      max: 999,
      pattern: '^[A-Z]',
    }
    expect(v.minLength).toBe(1)
    expect(v.pattern).toBe('^[A-Z]')
  })

  it('is fully optional — empty object is valid', () => {
    const v: FieldValidation = {}
    expect(v).toBeDefined()
  })
})

// ─── FieldSchema ──────────────────────────────────────────────────────────────

describe('FieldSchema', () => {
  it('requires name and type', () => {
    const minimal: FieldSchema = { name: 'email', type: 'email' }
    expect(minimal.name).toBe('email')
    expect(minimal.type).toBe('email')
  })

  it('accepts all optional properties', () => {
    const full: FieldSchema = {
      name: 'country',
      label: 'Country',
      type: 'select',
      options: ['US', 'CA', 'UK'] as const,
      description: 'Select your country',
      required: true,
      validation: { pattern: '^[A-Z]{2}$' },
    }
    expect(full.options).toHaveLength(3)
    expect(full.required).toBe(true)
    expect(full.validation?.pattern).toBe('^[A-Z]{2}$')
  })

  it('label is optional per LLD spec', () => {
    // LLD section 2: "Defaults to `name` if omitted."
    const s: FieldSchema = { name: 'phone', type: 'tel' }
    expect(s.label).toBeUndefined()
  })
})

// ─── FormSchema ───────────────────────────────────────────────────────────────

describe('FormSchema', () => {
  it('requires only the fields array', () => {
    const s: FormSchema = {
      fields: [{ name: 'name', type: 'text' }],
    }
    expect(s.fields).toHaveLength(1)
  })

  it('accepts optional formName and formDescription', () => {
    const s: FormSchema = {
      formName: 'Medical Intake',
      formDescription: 'Patient intake form',
      fields: [{ name: 'dob', type: 'date', label: 'Date of Birth' }],
    }
    expect(s.formName).toBe('Medical Intake')
    expect(s.formDescription).toBe('Patient intake form')
  })
})

// ─── STTErrorCode ─────────────────────────────────────────────────────────────

describe('STTErrorCode', () => {
  it('covers all specified error codes', () => {
    const codes: STTErrorCode[] = [
      'NOT_SUPPORTED',
      'PERMISSION_DENIED',
      'NETWORK_ERROR',
      'NO_SPEECH',
      'AUDIO_CAPTURE_FAILED',
      'ABORTED',
      'UNKNOWN',
    ]
    expect(codes).toHaveLength(7)
  })
})

// ─── STTError ─────────────────────────────────────────────────────────────────

describe('STTError', () => {
  it('carries code, message, and optional originalError', () => {
    // We cannot instantiate a class from a type import, but we can
    // describe the shape the class must expose.
    type STTErrorShape = {
      code: STTErrorCode
      message: string
      originalError?: unknown
      name: string
    }
    // Verify STTError extends this shape (compile-time check via assignment)
    type _Check = AssertExtends<STTError, STTErrorShape>
    expect(true).toBe(true)
  })
})

// ─── STTAdapterEvents ─────────────────────────────────────────────────────────

describe('STTAdapterEvents', () => {
  it('has all four event handlers', () => {
    const events: STTAdapterEvents = {
      onInterim: (_t: string) => { /* noop */ },
      onFinal: (_t: string) => { /* noop */ },
      onError: (_e: STTError) => { /* noop */ },
      onEnd: () => { /* noop */ },
    }
    expect(typeof events.onFinal).toBe('function')
    expect(typeof events.onEnd).toBe('function')
  })
})

// ─── STTAdapter ───────────────────────────────────────────────────────────────

describe('STTAdapter', () => {
  it('defines the required interface contract', () => {
    // Satisfy the interface with a mock implementation
    const adapter: STTAdapter = {
      isSupported: () => true,
      start: async (_events: STTAdapterEvents) => { /* noop */ },
      stop: () => { /* noop */ },
      abort: () => { /* noop */ },
    }
    expect(adapter.isSupported()).toBe(true)
  })

  it('start returns Promise<void>', async () => {
    const adapter: STTAdapter = {
      isSupported: () => false,
      start: async (_events: STTAdapterEvents): Promise<void> => { /* noop */ },
      stop: () => { /* noop */ },
      abort: () => { /* noop */ },
    }
    // Should resolve without throwing
    await expect(adapter.start({
      onInterim: () => { /* noop */ },
      onFinal: () => { /* noop */ },
      onError: () => { /* noop */ },
      onEnd: () => { /* noop */ },
    })).resolves.toBeUndefined()
  })
})

// ─── ParsedFieldValue ─────────────────────────────────────────────────────────

describe('ParsedFieldValue', () => {
  it('requires a string value', () => {
    const v: ParsedFieldValue = { value: 'john@example.com' }
    expect(v.value).toBe('john@example.com')
  })

  it('accepts an optional confidence score', () => {
    const v: ParsedFieldValue = { value: '555-1234', confidence: 0.95 }
    expect(v.confidence).toBe(0.95)
  })
})

// ─── ParseRequest ─────────────────────────────────────────────────────────────

describe('ParseRequest', () => {
  it('contains transcript, schema, and requestId', () => {
    const req: ParseRequest = {
      transcript: 'John Smith, john@example.com',
      schema: { fields: [{ name: 'email', type: 'email' }] },
      requestId: '550e8400-e29b-41d4-a716-446655440000',
    }
    expect(req.transcript).toContain('John')
    expect(req.requestId).toHaveLength(36)
    expect(req.schema.fields).toHaveLength(1)
  })
})

// ─── ParseResponse ────────────────────────────────────────────────────────────

describe('ParseResponse', () => {
  it('requires a fields map of ParsedFieldValue', () => {
    const resp: ParseResponse = {
      fields: {
        email: { value: 'john@example.com', confidence: 0.98 },
        name: { value: 'John Smith' },
      },
    }
    expect(resp.fields['email']?.value).toBe('john@example.com')
    expect(resp.fields['name']?.confidence).toBeUndefined()
  })

  it('accepts an optional rawResponse for debugging', () => {
    const resp: ParseResponse = {
      fields: {},
      rawResponse: 'raw LLM output here',
    }
    expect(resp.rawResponse).toBe('raw LLM output here')
  })
})

// ─── VoiceFormStatus ─────────────────────────────────────────────────────────

describe('VoiceFormStatus', () => {
  it('covers all six status values', () => {
    const statuses: VoiceFormStatus[] = [
      'idle',
      'recording',
      'processing',
      'confirming',
      'injecting',
      'done',
    ]
    expect(statuses).toHaveLength(6)
  })
})

// ─── VoiceFormState ───────────────────────────────────────────────────────────

describe('VoiceFormState', () => {
  it('idle state has only status property', () => {
    const s: VoiceFormState = { status: 'idle' }
    expect(s.status).toBe('idle')
  })

  it('recording state carries interimTranscript', () => {
    const s: VoiceFormState = { status: 'recording', interimTranscript: 'hel...' }
    expect(s.status).toBe('recording')
    if (s.status === 'recording') {
      expect(s.interimTranscript).toBe('hel...')
    }
  })

  it('processing state carries transcript', () => {
    const s: VoiceFormState = { status: 'processing', transcript: 'John Smith' }
    if (s.status === 'processing') {
      expect(s.transcript).toBe('John Smith')
    }
  })

  it('confirming state carries transcript and confirmation', () => {
    const conf: ConfirmationData = {
      transcript: 'John Smith',
      parsedFields: { name: { label: 'Name', value: 'John Smith' } },
      missingFields: [],
      invalidFields: [],
    }
    const s: VoiceFormState = {
      status: 'confirming',
      transcript: 'John Smith',
      confirmation: conf,
    }
    if (s.status === 'confirming') {
      expect(s.confirmation.parsedFields['name']?.value).toBe('John Smith')
    }
  })

  it('injecting state carries confirmation', () => {
    const conf: ConfirmationData = {
      transcript: 'test',
      parsedFields: {},
      missingFields: [],
      invalidFields: [],
    }
    const s: VoiceFormState = { status: 'injecting', confirmation: conf }
    if (s.status === 'injecting') {
      expect(s.confirmation).toBeDefined()
    }
  })

  it('done state carries an InjectionResult', () => {
    const result: InjectionResult = {
      success: true,
      fields: { name: { status: 'injected', value: 'John' } },
    }
    const s: VoiceFormState = { status: 'done', result }
    if (s.status === 'done') {
      expect(s.result.success).toBe(true)
    }
  })

  it('error state carries a VoiceFormError and previousStatus', () => {
    const err: VoiceFormError = {
      code: 'ENDPOINT_ERROR',
      message: 'Failed',
      recoverable: true,
    }
    const s: VoiceFormState = {
      status: 'error',
      error: err,
      previousStatus: 'processing',
    }
    if (s.status === 'error') {
      expect(s.error.code).toBe('ENDPOINT_ERROR')
      expect(s.previousStatus).toBe('processing')
    }
  })

  it('is a proper discriminated union — exhaustive switch compiles', () => {
    function describeState(s: VoiceFormState): string {
      switch (s.status) {
        case 'idle': return 'idle'
        case 'recording': return `recording: ${s.interimTranscript}`
        case 'processing': return `processing: ${s.transcript}`
        case 'confirming': return `confirming`
        case 'injecting': return `injecting`
        case 'done': return `done`
        case 'error': return `error: ${s.error.code}`
        default: return assertNever(s)
      }
    }
    expect(describeState({ status: 'idle' })).toBe('idle')
  })
})

// ─── ConfirmedField ───────────────────────────────────────────────────────────

describe('ConfirmedField', () => {
  it('requires label and value', () => {
    const f: ConfirmedField = { label: 'Email', value: 'a@b.com' }
    expect(f.label).toBe('Email')
  })

  it('accepts optional confidence', () => {
    const f: ConfirmedField = { label: 'Name', value: 'Alice', confidence: 0.9 }
    expect(f.confidence).toBe(0.9)
  })

  // ── P6-01 additions ──────────────────────────────────────────────────────────

  it('P6-01: accepts optional existingValue for appendMode (FR-108)', () => {
    const f: ConfirmedField = {
      label: 'Bio',
      value: 'new text',
      existingValue: 'previous text',
    }
    expect(f.existingValue).toBe('previous text')
  })

  it('P6-01: accepts optional userCorrected and originalValue for field correction (FR-114)', () => {
    const f: ConfirmedField = {
      label: 'Name',
      value: 'Alice Smith',
      userCorrected: true,
      originalValue: 'Alice Smyth',
    }
    expect(f.userCorrected).toBe(true)
    expect(f.originalValue).toBe('Alice Smyth')
  })

  it('P6-01: existingValue, userCorrected, originalValue are all optional — minimal object still valid', () => {
    const f: ConfirmedField = { label: 'Email', value: 'a@b.com' }
    expect(f.existingValue).toBeUndefined()
    expect(f.userCorrected).toBeUndefined()
    expect(f.originalValue).toBeUndefined()
  })
})

// ─── ConfirmationData ─────────────────────────────────────────────────────────

describe('ConfirmationData', () => {
  it('has all four required properties', () => {
    const d: ConfirmationData = {
      transcript: 'Alice, 30',
      parsedFields: {
        name: { label: 'Name', value: 'Alice' },
      },
      missingFields: ['age'],
      invalidFields: [{ name: 'dob', value: 'yesterday', reason: 'invalid date' }],
      appendMode: false,
    }
    expect(d.missingFields).toContain('age')
    expect(d.invalidFields[0]?.reason).toBe('invalid date')
  })

  // ── P6-01 additions ──────────────────────────────────────────────────────────

  it('P6-01: requires appendMode boolean field (FR-108)', () => {
    const withAppend: ConfirmationData = {
      transcript: 'test',
      parsedFields: {},
      missingFields: [],
      invalidFields: [],
      appendMode: true,
    }
    const withoutAppend: ConfirmationData = {
      transcript: 'test',
      parsedFields: {},
      missingFields: [],
      invalidFields: [],
      appendMode: false,
    }
    expect(withAppend.appendMode).toBe(true)
    expect(withoutAppend.appendMode).toBe(false)
  })
})

// ─── FieldInjectionOutcome ────────────────────────────────────────────────────

describe('FieldInjectionOutcome', () => {
  it('covers injected variant', () => {
    const o: FieldInjectionOutcome = { status: 'injected', value: 'Alice' }
    expect(o.status).toBe('injected')
  })

  it('covers skipped variants', () => {
    const reasons = [
      'element-not-found',
      'read-only',
      'disabled',
      'value-not-in-options',
    ] as const
    for (const reason of reasons) {
      const o: FieldInjectionOutcome = { status: 'skipped', reason }
      expect(o.status).toBe('skipped')
    }
  })

  it('covers failed variant', () => {
    const o: FieldInjectionOutcome = { status: 'failed', error: 'INVALID_FIELD_VALUE' }
    expect(o.status).toBe('failed')
  })

  it('is a proper discriminated union', () => {
    function describeOutcome(o: FieldInjectionOutcome): string {
      switch (o.status) {
        case 'injected': return `injected: ${o.value}`
        case 'skipped': return `skipped: ${o.reason}`
        case 'failed': return `failed: ${o.error}`
        default: return assertNever(o)
      }
    }
    expect(describeOutcome({ status: 'injected', value: 'x' })).toBe('injected: x')
  })
})

// ─── InjectionResult ──────────────────────────────────────────────────────────

describe('InjectionResult', () => {
  it('has success flag and per-field outcomes', () => {
    const r: InjectionResult = {
      success: false,
      fields: {
        name: { status: 'injected', value: 'Alice' },
        dob: { status: 'skipped', reason: 'element-not-found' },
      },
    }
    expect(r.success).toBe(false)
    expect(r.fields['name']?.status).toBe('injected')
    expect(r.fields['dob']?.status).toBe('skipped')
  })
})

// ─── VoiceFormEvent ───────────────────────────────────────────────────────────

describe('VoiceFormEvent', () => {
  it('covers all event types', () => {
    const events: VoiceFormEvent[] = [
      { type: 'START' },
      { type: 'STT_INTERIM', transcript: 'hel...' },
      { type: 'STT_FINAL', transcript: 'hello world' },
      {
        type: 'STT_ERROR', error: {
          code: 'NO_SPEECH',
          message: 'No speech',
          name: 'STTError',
        },
      },
      {
        type: 'PARSE_SUCCESS',
        response: { fields: {} },
        confirmation: {
          transcript: 'test',
          parsedFields: {},
          missingFields: [],
          invalidFields: [],
          appendMode: false,
        },
      },
      {
        type: 'PARSE_ERROR', error: {
          code: 'ENDPOINT_ERROR',
          message: 'failed',
          recoverable: true,
        },
      },
      { type: 'CONFIRM' },
      { type: 'CANCEL' },
      { type: 'INJECTION_COMPLETE', result: { success: true, fields: {} } },
      { type: 'ACKNOWLEDGE_ERROR' },
      { type: 'AUTO_RESET' },
      // P6-01: FIELD_CORRECTED event (FR-114)
      {
        type: 'FIELD_CORRECTED',
        confirmation: {
          transcript: 'test',
          parsedFields: { name: { label: 'Name', value: 'Alice Smith', userCorrected: true, originalValue: 'Alice Smyth' } },
          missingFields: [],
          invalidFields: [],
          appendMode: false,
        },
      },
    ]
    expect(events).toHaveLength(12)
  })

  it('is a proper discriminated union — exhaustive switch compiles', () => {
    function describeEvent(e: VoiceFormEvent): string {
      switch (e.type) {
        case 'START': return 'start'
        case 'STT_INTERIM': return `interim: ${e.transcript}`
        case 'STT_FINAL': return `final: ${e.transcript}`
        case 'STT_ERROR': return `stt-error: ${e.error.code}`
        case 'PARSE_SUCCESS': return 'parse-ok'
        case 'PARSE_ERROR': return `parse-fail: ${e.error.code}`
        case 'CONFIRM': return 'confirm'
        case 'CANCEL': return 'cancel'
        case 'INJECTION_COMPLETE': return `injected: ${e.result.success}`
        case 'ACKNOWLEDGE_ERROR': return 'ack-error'
        case 'AUTO_RESET': return 'auto-reset'
        // P6-01: FIELD_CORRECTED arm required for exhaustiveness
        case 'FIELD_CORRECTED': return `field-corrected: ${Object.keys(e.confirmation.parsedFields).length} fields`
        default: return assertNever(e)
      }
    }
    expect(describeEvent({ type: 'START' })).toBe('start')
    expect(describeEvent({ type: 'CONFIRM' })).toBe('confirm')
    expect(describeEvent({
      type: 'FIELD_CORRECTED',
      confirmation: { transcript: 't', parsedFields: {}, missingFields: [], invalidFields: [], appendMode: false },
    })).toBe('field-corrected: 0 fields')
  })

  // ── P6-01 additions ──────────────────────────────────────────────────────────

  it('P6-01: FIELD_CORRECTED carries a complete ConfirmationData payload', () => {
    const confirmation: ConfirmationData = {
      transcript: 'my name is Bob',
      parsedFields: {
        name: { label: 'Name', value: 'Bob', userCorrected: true, originalValue: 'Rob' },
      },
      missingFields: [],
      invalidFields: [],
      appendMode: false,
    }
    const event: VoiceFormEvent = { type: 'FIELD_CORRECTED', confirmation }
    if (event.type === 'FIELD_CORRECTED') {
      expect(event.confirmation.parsedFields['name']?.userCorrected).toBe(true)
      expect(event.confirmation.parsedFields['name']?.originalValue).toBe('Rob')
      expect(event.confirmation.appendMode).toBe(false)
    }
  })
})

// ─── VoiceFormEvents ──────────────────────────────────────────────────────────

describe('VoiceFormEvents', () => {
  it('accepts all optional callbacks', () => {
    const events: VoiceFormEvents = {
      onStateChange: (_s: VoiceFormState) => { /* noop */ },
      onInterimTranscript: (_t: string) => { /* noop */ },
      onBeforeConfirm: (d: ConfirmationData) => d,
      onDone: (_r: InjectionResult) => { /* noop */ },
      onCancel: () => { /* noop */ },
      onError: (_e: VoiceFormError) => { /* noop */ },
    }
    expect(typeof events.onStateChange).toBe('function')
  })

  it('is fully optional — empty object is valid', () => {
    const events: VoiceFormEvents = {}
    expect(events).toBeDefined()
  })

  it('onBeforeConfirm may return void', () => {
    const events: VoiceFormEvents = {
      onBeforeConfirm: (_d: ConfirmationData): void => { /* noop */ },
    }
    expect(events.onBeforeConfirm).toBeDefined()
  })
})

// ─── EndpointOptions ──────────────────────────────────────────────────────────

describe('EndpointOptions', () => {
  it('has all optional properties', () => {
    const opts: EndpointOptions = {
      timeoutMs: 10000,
      retries: 2,
      headers: { Authorization: 'Bearer token123' },
    }
    expect(opts.timeoutMs).toBe(10000)
    expect(opts.headers?.['Authorization']).toBe('Bearer token123')
  })

  it('empty object is valid', () => {
    const opts: EndpointOptions = {}
    expect(opts).toBeDefined()
  })
})

// ─── EndpointErrorCode ────────────────────────────────────────────────────────

describe('EndpointErrorCode', () => {
  it('covers all six endpoint error codes', () => {
    const codes: EndpointErrorCode[] = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'HTTP_ERROR',
      'INVALID_JSON',
      'INVALID_RESPONSE_SHAPE',
      'ABORTED',
    ]
    expect(codes).toHaveLength(6)
  })
})

// ─── EndpointError ────────────────────────────────────────────────────────────

describe('EndpointError', () => {
  it('carries code, message, and optional httpStatus', () => {
    type EndpointErrorShape = {
      code: EndpointErrorCode
      message: string
      httpStatus?: number
      name: string
    }
    type _Check = AssertExtends<EndpointError, EndpointErrorShape>
    expect(true).toBe(true)
  })
})

// ─── UIOptions ────────────────────────────────────────────────────────────────

describe('UIOptions', () => {
  it('accepts all optional ui properties', () => {
    const ui: UIOptions = {
      cssVars: { '--vf-primary': '#2563eb' },
      micButtonLabel: 'Speak now',
      confirmButtonLabel: 'Apply',
      cancelButtonLabel: 'Discard',
    }
    expect(ui.micButtonLabel).toBe('Speak now')
    expect(ui.cssVars?.['--vf-primary']).toBe('#2563eb')
  })

  it('empty object is valid', () => {
    const ui: UIOptions = {}
    expect(ui).toBeDefined()
  })
})

// ─── VoiceFormCSSVars ─────────────────────────────────────────────────────────

describe('VoiceFormCSSVars', () => {
  it('accepts all defined CSS custom properties', () => {
    const vars: VoiceFormCSSVars = {
      '--vf-primary': '#2563eb',
      '--vf-primary-hover': '#1d4ed8',
      '--vf-danger': '#dc2626',
      '--vf-surface': '#ffffff',
      '--vf-on-surface': '#111827',
      '--vf-border-radius': '8px',
      '--vf-font-family': 'inherit',
      '--vf-z-index': '100',
    }
    expect(vars['--vf-primary']).toBe('#2563eb')
    expect(Object.keys(vars)).toHaveLength(8)
  })
})

// ─── VoiceFormErrorCode ───────────────────────────────────────────────────────

describe('VoiceFormErrorCode', () => {
  it('covers all specified error codes', () => {
    const codes: VoiceFormErrorCode[] = [
      // STT-related
      'STT_NOT_SUPPORTED',
      'PERMISSION_DENIED',
      // Transcript
      'NO_TRANSCRIPT',
      'TRANSCRIPT_TOO_LONG',
      'INVALID_TRANSCRIPT',
      // Endpoint
      'ENDPOINT_ERROR',
      'ENDPOINT_TIMEOUT',
      'PARSE_FAILED',
      'INVALID_RESPONSE',
      // Injection
      'INJECTION_FAILED',
      'INVALID_FIELD_VALUE',
      // Privacy / config
      'PRIVACY_NOT_ACKNOWLEDGED',
      'COOLDOWN_ACTIVE',
      // Init / lifecycle
      'SCHEMA_INVALID',
      'INIT_FAILED',
      'INVALID_TRANSITION',
      'DESTROYED',
      // Catch-all
      'UNKNOWN',
    ]
    expect(codes.length).toBeGreaterThan(0)
    // Verify no duplicates
    expect(new Set(codes).size).toBe(codes.length)
  })
})

// ─── VoiceFormError ───────────────────────────────────────────────────────────

describe('VoiceFormError', () => {
  it('requires code, message, and recoverable flag', () => {
    const err: VoiceFormError = {
      code: 'ENDPOINT_ERROR',
      message: 'Request failed with 503',
      recoverable: true,
    }
    expect(err.code).toBe('ENDPOINT_ERROR')
    expect(err.recoverable).toBe(true)
  })

  it('accepts optional debugInfo', () => {
    const err: VoiceFormError = {
      code: 'ENDPOINT_ERROR',
      message: 'Bad gateway',
      recoverable: true,
      debugInfo: {
        httpStatus: 502,
        rawBody: '{"error":"upstream"}',
        timestamp: Date.now(),
      },
    }
    expect(err.debugInfo?.httpStatus).toBe(502)
  })

  it('accepts optional debugInfo without httpStatus', () => {
    const err: VoiceFormError = {
      code: 'UNKNOWN',
      message: 'Something went wrong',
      recoverable: false,
      debugInfo: {
        timestamp: 1711929600000,
      },
    }
    expect(err.debugInfo?.timestamp).toBe(1711929600000)
    expect(err.debugInfo?.httpStatus).toBeUndefined()
  })
})

// ─── VoiceFormConfig ─────────────────────────────────────────────────────────

describe('VoiceFormConfig', () => {
  it('requires endpoint and schema', () => {
    const config: VoiceFormConfig = {
      endpoint: 'https://api.example.com/voice-parse',
      schema: { fields: [{ name: 'name', type: 'text', label: 'Full Name' }] },
    }
    expect(config.endpoint).toBe('https://api.example.com/voice-parse')
    expect(config.schema.fields).toHaveLength(1)
  })

  it('accepts all optional properties', () => {
    const mockAdapter: STTAdapter = {
      isSupported: () => true,
      start: async () => { /* noop */ },
      stop: () => { /* noop */ },
      abort: () => { /* noop */ },
    }

    const config: VoiceFormConfig = {
      endpoint: '/api/parse',
      schema: { fields: [{ name: 'email', type: 'email' }] },
      sttAdapter: mockAdapter,
      formElement: '#my-form',
      mountTarget: document.createElement('div'),
      headless: false,
      requestCooldownMs: 3000,
      privacyNotice: 'Audio processed by Google.',
      requirePrivacyAcknowledgement: true,
      maxTranscriptLength: 2000,
      endpointOptions: { timeoutMs: 10000, retries: 1 },
      ui: { micButtonLabel: 'Speak' },
      events: { onCancel: () => { /* noop */ } },
      debug: false,
    }
    expect(config.headless).toBe(false)
    expect(config.requestCooldownMs).toBe(3000)
    expect(config.requirePrivacyAcknowledgement).toBe(true)
  })

  it('does NOT include llmAdapter (security review CRIT-002)', () => {
    // This is a type-level test: if llmAdapter existed on VoiceFormConfig,
    // the following type assignment would succeed. Since it should NOT exist,
    // we verify by structural check — the property is not expected on the type.
    type HasNoLlmAdapter = 'llmAdapter' extends keyof VoiceFormConfig ? false : true
    const check: HasNoLlmAdapter = true
    expect(check).toBe(true)
  })

  it('does NOT include skipConfirmation (removed in security review)', () => {
    type HasNoSkipConfirmation = 'skipConfirmation' extends keyof VoiceFormConfig ? false : true
    const check: HasNoSkipConfirmation = true
    expect(check).toBe(true)
  })
})

// ─── VoiceFormInstance ────────────────────────────────────────────────────────

describe('VoiceFormInstance', () => {
  it('has all required methods', () => {
    // Implement the interface with stubs to verify shape
    const instance: VoiceFormInstance = {
      getState: (): VoiceFormState => ({ status: 'idle' }),
      getParsedFields: (): Record<string, ConfirmedField> | null => null,
      start: async (): Promise<void> => { /* noop */ },
      stop: (): void => { /* noop */ },
      cancel: (): void => { /* noop */ },
      confirm: async (): Promise<void> => { /* noop */ },
      updateSchema: (_s: FormSchema): void => { /* noop */ },
      destroy: (): void => { /* noop */ },
      subscribe: (_l: StateListener): Unsubscribe => () => { /* noop */ },
      // P6-01 additions
      setSchema: (_s: FormSchema): void => { /* noop */ },
      getSchema: (): FormSchema => ({ fields: [] }),
      correctField: (_fieldName: string, _value: string): boolean => false,
    }
    expect(typeof instance.getState).toBe('function')
    expect(typeof instance.start).toBe('function')
    expect(typeof instance.cancel).toBe('function')
    expect(typeof instance.confirm).toBe('function')
    expect(typeof instance.updateSchema).toBe('function')
    expect(typeof instance.destroy).toBe('function')
    // P6-01 additions
    expect(typeof instance.setSchema).toBe('function')
    expect(typeof instance.getSchema).toBe('function')
    expect(typeof instance.correctField).toBe('function')
  })

  it('start and confirm return Promise<void>', async () => {
    const instance: VoiceFormInstance = {
      getState: () => ({ status: 'idle' }),
      getParsedFields: () => null,
      start: async () => { /* noop */ },
      stop: () => { /* noop */ },
      cancel: () => { /* noop */ },
      confirm: async () => { /* noop */ },
      updateSchema: () => { /* noop */ },
      destroy: () => { /* noop */ },
      subscribe: (_l) => () => { /* noop */ },
      setSchema: () => { /* noop */ },
      getSchema: () => ({ fields: [] }),
      correctField: () => false,
    }
    await expect(instance.start()).resolves.toBeUndefined()
    await expect(instance.confirm()).resolves.toBeUndefined()
  })

  // ── P6-01 additions ──────────────────────────────────────────────────────────

  it('P6-01: setSchema accepts a FormSchema and returns void', () => {
    const schema: FormSchema = { fields: [{ name: 'email', type: 'email' }] }
    const instance: VoiceFormInstance = {
      getState: () => ({ status: 'idle' }),
      getParsedFields: () => null,
      start: async () => { /* noop */ },
      stop: () => { /* noop */ },
      cancel: () => { /* noop */ },
      confirm: async () => { /* noop */ },
      updateSchema: () => { /* noop */ },
      destroy: () => { /* noop */ },
      subscribe: (_l) => () => { /* noop */ },
      setSchema: (_s: FormSchema): void => { /* noop */ },
      getSchema: () => schema,
      correctField: () => false,
    }
    // Type-level: setSchema returns void (not Promise)
    const result: void = instance.setSchema(schema)
    expect(result).toBeUndefined()
  })

  it('P6-01: getSchema returns FormSchema', () => {
    const schema: FormSchema = {
      formName: 'Test Form',
      fields: [{ name: 'name', type: 'text' }],
    }
    const instance: VoiceFormInstance = {
      getState: () => ({ status: 'idle' }),
      getParsedFields: () => null,
      start: async () => { /* noop */ },
      stop: () => { /* noop */ },
      cancel: () => { /* noop */ },
      confirm: async () => { /* noop */ },
      updateSchema: () => { /* noop */ },
      destroy: () => { /* noop */ },
      subscribe: (_l) => () => { /* noop */ },
      setSchema: () => { /* noop */ },
      getSchema: (): FormSchema => schema,
      correctField: () => false,
    }
    const got = instance.getSchema()
    expect(got.fields).toHaveLength(1)
    expect(got.formName).toBe('Test Form')
  })

  it('P6-01: correctField accepts fieldName and value, returns boolean', () => {
    const instance: VoiceFormInstance = {
      getState: () => ({ status: 'idle' }),
      getParsedFields: () => null,
      start: async () => { /* noop */ },
      stop: () => { /* noop */ },
      cancel: () => { /* noop */ },
      confirm: async () => { /* noop */ },
      updateSchema: () => { /* noop */ },
      destroy: () => { /* noop */ },
      subscribe: (_l) => () => { /* noop */ },
      setSchema: () => { /* noop */ },
      getSchema: () => ({ fields: [] }),
      correctField: (_fieldName: string, _value: string): boolean => true,
    }
    // Type-level: correctField returns boolean
    const accepted: boolean = instance.correctField('name', 'Alice')
    expect(accepted).toBe(true)
  })
})

// ─── VoiceFormConfigError ─────────────────────────────────────────────────────

describe('VoiceFormConfigError', () => {
  it('extends Error with code and message', () => {
    type VoiceFormConfigErrorShape = {
      message: string
      name: string
      code: VoiceFormErrorCode
    }
    type _Check = AssertExtends<VoiceFormConfigError, VoiceFormConfigErrorShape>
    expect(true).toBe(true)
  })
})

// ─── StateMachine ─────────────────────────────────────────────────────────────

describe('StateMachine', () => {
  it('defines the required interface', () => {
    // Verify all methods exist via a stub implementation
    const sm: StateMachine = {
      getState: (): VoiceFormState => ({ status: 'idle' }),
      dispatch: (_e: VoiceFormEvent): void => { /* noop */ },
      subscribe: (_l: (state: VoiceFormState, event: VoiceFormEvent) => void): (() => void) => () => { /* noop */ },
      destroy: (): void => { /* noop */ },
    }
    expect(typeof sm.getState).toBe('function')
    expect(typeof sm.dispatch).toBe('function')
    expect(typeof sm.subscribe).toBe('function')
    expect(typeof sm.destroy).toBe('function')
  })

  it('subscribe returns an unsubscribe function', () => {
    let unsubscribeCalled = false
    const sm: StateMachine = {
      getState: () => ({ status: 'idle' }),
      dispatch: () => { /* noop */ },
      subscribe: (_l) => () => { unsubscribeCalled = true },
      destroy: () => { /* noop */ },
    }
    const unsub = sm.subscribe(() => { /* noop */ })
    unsub()
    expect(unsubscribeCalled).toBe(true)
  })
})

// ─── ValidationResult ─────────────────────────────────────────────────────────

describe('ValidationResult', () => {
  it('has valid flag and errors array', () => {
    const passing: ValidationResult = { valid: true, errors: [] }
    const failing: ValidationResult = {
      valid: false,
      errors: ['field[0].name is required', 'field[1].type is invalid'],
    }
    expect(passing.valid).toBe(true)
    expect(failing.errors).toHaveLength(2)
  })
})

// ─── VoiceFormStrings ─────────────────────────────────────────────────────────

describe('VoiceFormStrings', () => {
  it('has nested structure matching UX_SPEC section 11.1', () => {
    const strings: VoiceFormStrings = {
      buttonLabel: {
        idle: 'Use voice input',
        recording: 'Stop recording',
        processing: 'Processing speech',
        done: 'Voice input complete',
        error: 'Voice input error',
        unsupported: 'Voice input not available',
        cooldown: 'Voice input cooling down',
      },
      status: {
        listening: 'Listening\u2026',
        processing: 'Processing\u2026',
        done: 'Form filled',
        unsupported: 'Voice input not supported in this browser.',
      },
      errors: {
        permissionDenied: 'Microphone access denied. Check your browser settings.',
        noSpeech: 'Nothing heard. Try again.',
        endpointError: 'Could not process speech. Try again.',
        parseError: 'Could not understand your response. Try again.',
        transcriptTooLong: 'That was too much — try a shorter response.',
        retryLabel: 'Try again',
        rerecordLabel: 'Re-record',
        permissionHelp: 'Learn how',
      },
      confirm: {
        title: 'What I heard',
        description: 'Review the values below before filling your form.',
        cancelLabel: 'Cancel',
        cancelAriaLabel: 'Cancel and discard voice input',
        fillLabel: 'Fill form',
        fillLabelEdited: 'Fill form (edited)',
        fillAriaLabel: 'Accept and fill form with these values',
        dismissAriaLabel: 'Cancel voice input',
        unrecognizedLabel: 'Not understood',
        unrecognizedAriaLabel: 'Not understood \u2014 this field will not be filled',
        sanitizedAriaLabel: 'Value was modified \u2014 HTML was removed',
      },
      privacy: {
        acknowledgeLabel: 'I understand',
        acknowledgeAriaLabel: 'I understand and agree to voice processing',
        regionAriaLabel: 'Voice input privacy notice',
      },
      announcements: {
        listening: 'Listening. Speak now.',
        processing: 'Processing your speech.',
        confirming: 'Review your values. {count} fields ready.',
        filled: 'Form filled. {count} fields updated.',
        cancelled: 'Voice input cancelled.',
        errorPermission: 'Error: Microphone access denied. Check your browser settings.',
        errorNoSpeech: 'Nothing heard. Voice input ready.',
        errorEndpoint: 'Error: Could not process speech. Tap to try again.',
        errorTranscriptTooLong: 'That was too much. Try a shorter response.',
      },
    }
    expect(strings.buttonLabel.idle).toBe('Use voice input')
    expect(strings.confirm.title).toBe('What I heard')
    expect(strings.privacy.acknowledgeLabel).toBe('I understand')
    expect(strings.announcements.cancelled).toBe('Voice input cancelled.')
  })

  it('announcement strings accept string or count function (11.3 pluralization)', () => {
    const strings: VoiceFormStrings = {
      buttonLabel: {
        idle: 'Use voice input',
        recording: 'Stop recording',
        processing: 'Processing speech',
        done: 'Voice input complete',
        error: 'Voice input error',
        unsupported: 'Voice input not available',
        cooldown: 'Voice input cooling down',
      },
      status: {
        listening: 'Listening\u2026',
        processing: 'Processing\u2026',
        done: 'Form filled',
        unsupported: 'Not supported.',
      },
      errors: {
        permissionDenied: 'Denied.',
        noSpeech: 'No speech.',
        endpointError: 'Error.',
        parseError: 'Parse error.',
        transcriptTooLong: 'Too long.',
        retryLabel: 'Retry',
        rerecordLabel: 'Re-record',
        permissionHelp: 'Help',
      },
      confirm: {
        title: 'Heard',
        description: 'Review.',
        cancelLabel: 'Cancel',
        cancelAriaLabel: 'Cancel',
        fillLabel: 'Fill',
        fillLabelEdited: 'Fill (edited)',
        fillAriaLabel: 'Fill form',
        dismissAriaLabel: 'Dismiss',
        unrecognizedLabel: 'Unknown',
        unrecognizedAriaLabel: 'Unknown field',
        sanitizedAriaLabel: 'Sanitized',
      },
      privacy: {
        acknowledgeLabel: 'OK',
        acknowledgeAriaLabel: 'Agree',
        regionAriaLabel: 'Privacy',
      },
      announcements: {
        listening: 'Listening.',
        processing: 'Processing.',
        // Function form for pluralization (UX_SPEC 11.3)
        confirming: (count: number) =>
          count === 1 ? '1 field ready.' : `${count} fields ready.`,
        filled: (count: number) =>
          count === 1 ? 'Form filled. 1 field updated.' : `Form filled. ${count} fields updated.`,
        cancelled: 'Cancelled.',
        errorPermission: 'Permission error.',
        errorNoSpeech: 'No speech.',
        errorEndpoint: 'Endpoint error.',
        errorTranscriptTooLong: 'Too long.',
      },
    }

    const confirming = strings.announcements.confirming
    const result = typeof confirming === 'function' ? confirming(1) : confirming
    expect(result).toBe('1 field ready.')
  })

  // ── P6-01 additions ──────────────────────────────────────────────────────────

  it('P6-01: VoiceFormStrings.confirm has v2 correction and append-mode string keys', () => {
    // Verify the new keys exist on VoiceFormStrings['confirm'] by type assignment
    const confirm: VoiceFormStrings['confirm'] = {
      title: 'What I heard',
      description: 'Review.',
      cancelLabel: 'Cancel',
      cancelAriaLabel: 'Cancel',
      fillLabel: 'Fill',
      fillLabelEdited: 'Fill (edited)',
      fillAriaLabel: 'Fill form',
      dismissAriaLabel: 'Dismiss',
      unrecognizedLabel: 'Unknown',
      unrecognizedAriaLabel: 'Unknown field',
      sanitizedAriaLabel: 'Sanitized',
      // New v2 edit/correction keys
      editAriaLabel: 'Edit {label}',
      saveEditLabel: 'Save',
      saveEditAriaLabel: 'Save {label} correction',
      discardEditLabel: 'Cancel',
      discardEditAriaLabel: 'Discard {label} correction',
      invalidValueLabel: 'Invalid value',
      editHintText: 'Press Enter to save, Escape to cancel.',
      // Append-mode preview keys
      appendExistingLabel: 'Current:',
      appendNewLabel: 'Adding:',
      appendResultLabel: 'Result:',
      // Unchanged badge (replaces "Not understood" for null fields)
      unchangedLabel: 'Unchanged',
    }
    expect(confirm.editAriaLabel).toBe('Edit {label}')
    expect(confirm.saveEditLabel).toBe('Save')
    expect(confirm.appendExistingLabel).toBe('Current:')
    expect(confirm.appendNewLabel).toBe('Adding:')
    expect(confirm.appendResultLabel).toBe('Result:')
    expect(confirm.unchangedLabel).toBe('Unchanged')
  })

  it('P6-01: VoiceFormStrings.confirm edit aria labels accept function form', () => {
    const editAriaLabel: VoiceFormStrings['confirm']['editAriaLabel'] =
      (fieldLabel: string) => `Edit ${fieldLabel}`
    const saveEditAriaLabel: VoiceFormStrings['confirm']['saveEditAriaLabel'] =
      (fieldLabel: string) => `Save ${fieldLabel} correction`
    const discardEditAriaLabel: VoiceFormStrings['confirm']['discardEditAriaLabel'] =
      (fieldLabel: string) => `Discard ${fieldLabel} correction`
    expect(typeof editAriaLabel === 'function' ? editAriaLabel('Name') : editAriaLabel).toBe('Edit Name')
    expect(typeof saveEditAriaLabel === 'function' ? saveEditAriaLabel('Name') : saveEditAriaLabel).toBe('Save Name correction')
    expect(typeof discardEditAriaLabel === 'function' ? discardEditAriaLabel('Name') : discardEditAriaLabel).toBe('Discard Name correction')
  })

  it('P6-01: VoiceFormStrings.confirm stepLabel is optional', () => {
    const confirm: VoiceFormStrings['confirm'] = {
      title: 'What I heard',
      description: 'Review.',
      cancelLabel: 'Cancel',
      cancelAriaLabel: 'Cancel',
      fillLabel: 'Fill',
      fillLabelEdited: 'Fill (edited)',
      fillAriaLabel: 'Fill form',
      dismissAriaLabel: 'Dismiss',
      unrecognizedLabel: 'Unknown',
      unrecognizedAriaLabel: 'Unknown field',
      sanitizedAriaLabel: 'Sanitized',
      editAriaLabel: 'Edit {label}',
      saveEditLabel: 'Save',
      saveEditAriaLabel: 'Save {label} correction',
      discardEditLabel: 'Cancel',
      discardEditAriaLabel: 'Discard {label} correction',
      invalidValueLabel: 'Invalid value',
      editHintText: 'Press Enter to save, Escape to cancel.',
      appendExistingLabel: 'Current:',
      appendNewLabel: 'Adding:',
      appendResultLabel: 'Result:',
      unchangedLabel: 'Unchanged',
      // stepLabel omitted — should be optional
    }
    expect(confirm.stepLabel).toBeUndefined()
  })

  it('P6-01: VoiceFormStrings.announcements has fieldEditOpened and fieldEditSaved', () => {
    const announcements: VoiceFormStrings['announcements'] = {
      listening: 'Listening.',
      processing: 'Processing.',
      confirming: 'Review.',
      filled: 'Filled.',
      cancelled: 'Cancelled.',
      errorPermission: 'Permission error.',
      errorNoSpeech: 'No speech.',
      errorEndpoint: 'Endpoint error.',
      errorTranscriptTooLong: 'Too long.',
      // New v2 announcement keys (FR-114)
      fieldEditOpened: 'Editing {label}.',
      fieldEditSaved: '{label} correction saved.',
    }
    expect(announcements.fieldEditOpened).toBe('Editing {label}.')
    expect(announcements.fieldEditSaved).toBe('{label} correction saved.')
  })

  it('P6-01: VoiceFormStrings.announcements fieldEditOpened/fieldEditSaved accept function form', () => {
    const fieldEditOpened: VoiceFormStrings['announcements']['fieldEditOpened'] =
      (fieldLabel: string) => `Editing ${fieldLabel}.`
    const fieldEditSaved: VoiceFormStrings['announcements']['fieldEditSaved'] =
      (fieldLabel: string) => `${fieldLabel} correction saved.`
    expect(typeof fieldEditOpened === 'function' ? fieldEditOpened('Name') : fieldEditOpened).toBe('Editing Name.')
    expect(typeof fieldEditSaved === 'function' ? fieldEditSaved('Email') : fieldEditSaved).toBe('Email correction saved.')
  })
})

// ─── P6-01: VoiceFormConfig v2 additions ─────────────────────────────────────

describe('VoiceFormConfig — P6-01 v2 additions', () => {
  it('accepts appendMode boolean flag (FR-108)', () => {
    const config: VoiceFormConfig = {
      endpoint: '/api/parse',
      schema: { fields: [{ name: 'bio', type: 'textarea' }] },
      appendMode: true,
    }
    expect(config.appendMode).toBe(true)
  })

  it('accepts multiStep boolean flag (FR-111)', () => {
    const config: VoiceFormConfig = {
      endpoint: '/api/parse',
      schema: { fields: [{ name: 'name', type: 'text' }] },
      multiStep: true,
    }
    expect(config.multiStep).toBe(true)
  })

  it('accepts autoDetectSchema boolean flag (FR-113)', () => {
    const config: VoiceFormConfig = {
      endpoint: '/api/parse',
      schema: { fields: [{ name: 'name', type: 'text' }] },
      autoDetectSchema: true,
    }
    expect(config.autoDetectSchema).toBe(true)
  })

  it('accepts onSchemaDetected callback (FR-112)', () => {
    const schema: FormSchema = { fields: [{ name: 'email', type: 'email' }] }
    const config: VoiceFormConfig = {
      endpoint: '/api/parse',
      schema,
      onSchemaDetected: (detected: FormSchema): FormSchema => detected,
    }
    expect(typeof config.onSchemaDetected).toBe('function')
    // Callback may also return void
    const voidConfig: VoiceFormConfig = {
      endpoint: '/api/parse',
      schema,
      onSchemaDetected: (_detected: FormSchema): void => { /* noop */ },
    }
    expect(typeof voidConfig.onSchemaDetected).toBe('function')
  })

  it('accepts allowFieldCorrection boolean flag (FR-114)', () => {
    const config: VoiceFormConfig = {
      endpoint: '/api/parse',
      schema: { fields: [{ name: 'name', type: 'text' }] },
      allowFieldCorrection: false,
    }
    expect(config.allowFieldCorrection).toBe(false)
  })

  it('all new v2 config fields are optional — existing minimal config is still valid', () => {
    const config: VoiceFormConfig = {
      endpoint: '/api/parse',
      schema: { fields: [{ name: 'name', type: 'text' }] },
    }
    expect(config.appendMode).toBeUndefined()
    expect(config.multiStep).toBeUndefined()
    expect(config.autoDetectSchema).toBeUndefined()
    expect(config.onSchemaDetected).toBeUndefined()
    expect(config.allowFieldCorrection).toBeUndefined()
  })
})

// ─── P6-01: InjectorConfig v2 additions ──────────────────────────────────────

describe('InjectorConfig — P6-01 v2 additions', () => {
  it('accepts appendMode optional boolean (FR-108)', () => {
    const config: InjectorConfig = {
      appendMode: true,
    }
    expect(config.appendMode).toBe(true)
  })

  it('accepts multiStep optional boolean (FR-111)', () => {
    const config: InjectorConfig = {
      multiStep: true,
    }
    expect(config.multiStep).toBe(true)
  })

  it('all new fields are optional — empty InjectorConfig is still valid', () => {
    const config: InjectorConfig = {}
    expect(config.appendMode).toBeUndefined()
    expect(config.multiStep).toBeUndefined()
  })
})

// ─── P6-01: VoiceFormCSSVars v2 additions ────────────────────────────────────

describe('VoiceFormCSSVars — P6-01 v2 additions', () => {
  it('accepts all new v2 CSS custom property keys', () => {
    const vars: Partial<VoiceFormCSSVars> = {
      '--vf-unchanged-badge-bg': '#f3f4f6',
      '--vf-unchanged-badge-text': '#6b7280',
      '--vf-append-existing-color': '#9ca3af',
      '--vf-append-new-color': '#2563eb',
      '--vf-field-edit-btn-color': '#6b7280',
      '--vf-field-edit-btn-hover-color': '#111827',
      '--vf-field-edit-input-border': '#2563eb',
      '--vf-field-edit-input-bg': '#eff6ff',
      '--vf-field-edit-invalid-color': '#dc2626',
      '--vf-field-corrected-indicator': '#2563eb',
    }
    expect(vars['--vf-unchanged-badge-bg']).toBe('#f3f4f6')
    expect(vars['--vf-field-edit-input-bg']).toBe('#eff6ff')
    expect(vars['--vf-field-corrected-indicator']).toBe('#2563eb')
  })

  it('new CSS vars are all string values', () => {
    // Verify each new key is typed as string (compile-time check via assignment)
    const bg: VoiceFormCSSVars['--vf-unchanged-badge-bg'] = '#ffffff'
    const text: VoiceFormCSSVars['--vf-unchanged-badge-text'] = '#000000'
    const existingColor: VoiceFormCSSVars['--vf-append-existing-color'] = '#aaaaaa'
    const newColor: VoiceFormCSSVars['--vf-append-new-color'] = '#bbbbbb'
    const btnColor: VoiceFormCSSVars['--vf-field-edit-btn-color'] = '#cccccc'
    const btnHover: VoiceFormCSSVars['--vf-field-edit-btn-hover-color'] = '#dddddd'
    const inputBorder: VoiceFormCSSVars['--vf-field-edit-input-border'] = '#eeeeee'
    const inputBg: VoiceFormCSSVars['--vf-field-edit-input-bg'] = '#111111'
    const invalidColor: VoiceFormCSSVars['--vf-field-edit-invalid-color'] = '#222222'
    const correctedIndicator: VoiceFormCSSVars['--vf-field-corrected-indicator'] = '#333333'
    expect(bg).toBe('#ffffff')
    expect(text).toBe('#000000')
    expect(existingColor).toBeDefined()
    expect(newColor).toBeDefined()
    expect(btnColor).toBeDefined()
    expect(btnHover).toBeDefined()
    expect(inputBorder).toBeDefined()
    expect(inputBg).toBeDefined()
    expect(invalidColor).toBeDefined()
    expect(correctedIndicator).toBeDefined()
  })
})
