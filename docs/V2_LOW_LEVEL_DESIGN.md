# voice-form V2 — Low-Level Design

**Status**: Approved for implementation  
**Date**: 2026-04-01  
**Version**: 2.0  
**Authors**: Merged from V2_HIGH_LEVEL_DESIGN.md + V2_FRONTEND_DESIGN.md + security/performance review  
**Audience**: Implementing engineers  

---

## Table of Contents

1. [Type System Changes (types.ts)](#1-type-system-changes-typests)
2. [State Machine Changes (state-machine.ts)](#2-state-machine-changes-state-machinets)
3. [Injector Changes (injector.ts)](#3-injector-changes-injectors)
4. [Factory Changes (create-voice-form.ts)](#4-factory-changes-create-voice-formts)
5. [Whisper STT Adapter (adapters/whisper.ts)](#5-whisper-stt-adapter-adapterswhisperts)
6. [DOM Schema Auto-Detection (detect-schema.ts)](#6-dom-schema-auto-detection-detect-schemats)
7. [Field-Level Correction](#7-field-level-correction)
8. [React Package (@voiceform/react)](#8-react-package-voiceformreact)
9. [@voiceform/dev Package](#9-voiceformdev-package)
10. [Package Exports and Build Configuration](#10-package-exports-and-build-configuration)

---

## 1. Type System Changes (types.ts)

**File**: `packages/core/src/types.ts`

All changes are additive. No existing field is removed or renamed. `updateSchema()` on `VoiceFormInstance` is kept as a deprecated alias through v2.

### 1.1 ConfirmedField — additions

```typescript
export interface ConfirmedField {
  label: string
  value: string
  confidence?: number

  /**
   * When appendMode is true and a pre-existing DOM value was found,
   * holds that pre-existing value. The injected value will be
   * `existingValue + ' ' + value`.
   * Undefined when appendMode is false or the existing DOM value was empty.
   * (FR-108)
   */
  existingValue?: string

  /**
   * True when the user manually edited this field's value in the
   * confirmation panel. The original LLM value is in `originalValue`.
   * (FR-114)
   */
  userCorrected?: boolean

  /**
   * The LLM-parsed value before user correction.
   * Only present when userCorrected is true.
   * (FR-114)
   */
  originalValue?: string
}
```

### 1.2 ConfirmationData — additions

```typescript
export interface ConfirmationData {
  transcript: string
  parsedFields: Record<string, ConfirmedField>
  missingFields: readonly string[]
  invalidFields: ReadonlyArray<{ name: string; value: string; reason: string }>

  /**
   * True when appendMode was active for this session.
   * Used by the confirmation panel to render the append preview rows.
   * (FR-108)
   */
  appendMode: boolean
}
```

**CRITICAL (security review #1):** `ConfirmationData` MUST be treated as immutable once it enters `confirming` state. The `FIELD_CORRECTED` event (section 2.2) produces a new `ConfirmationData` object via `Object.assign` / spread. In-place mutation of `parsedFields` during the confirming state violates React concurrent mode safety because `useSyncExternalStore.getSnapshot` may be called multiple times during a render pass and must return a stable reference.

### 1.3 VoiceFormConfig — additions

```typescript
export interface VoiceFormConfig {
  // ... existing fields unchanged ...

  /**
   * When true, new string values for text/textarea fields are appended
   * to existing DOM values separated by a single space.
   * No effect on number, date, boolean, select, checkbox, or radio fields.
   * Default: false. (FR-108)
   */
  appendMode?: boolean

  /**
   * When true, fields not resolved in the current DOM during injection
   * are treated as warnings (console.warn) rather than errors (console.error).
   * InjectionResult.success is still true when all found fields injected.
   * Required for multi-step/wizard forms. Default: false. (FR-111)
   */
  multiStep?: boolean

  /**
   * When true and no explicit `schema` is provided, voice-form scans
   * the formElement to infer a schema from the DOM.
   * Requires formElement to be set. (FR-113)
   * The detected schema is passed to onSchemaDetected before use.
   * If both schema and autoDetectSchema are provided, schema wins and
   * a console.warn is emitted.
   *
   * Implementation note: autoDetectSchema triggers a dynamic import()
   * of the detect-schema subpath module inside createVoiceForm. It MUST
   * NOT be a static import at the top of create-voice-form.ts.
   * (security review #11)
   */
  autoDetectSchema?: boolean

  /**
   * Called once after schema auto-detection completes.
   * Return a modified FormSchema to override the detected schema.
   * Return undefined or void to accept as-is.
   * The returned schema is validated by validateSchema(). (FR-112)
   */
  onSchemaDetected?: (schema: FormSchema) => FormSchema | void

  /**
   * When false, the confirmation panel shows values as static text
   * with no edit controls rendered. Default: true. (FR-114)
   */
  allowFieldCorrection?: boolean
}
```

### 1.4 VoiceFormInstance — additions

```typescript
export interface VoiceFormInstance {
  // ... existing methods unchanged ...

  /**
   * Replace the active schema. Valid only from idle state.
   * Validates the new schema synchronously; throws VoiceFormConfigError on failure.
   * Clears the injector's element cache.
   * This is the v2 rename of updateSchema(). updateSchema() remains as a
   * deprecated alias (console.warn on call) until v3. (FR-110)
   *
   * @throws {VoiceFormError} INVALID_TRANSITION if not in idle state.
   * @throws {VoiceFormConfigError} SCHEMA_INVALID if schema is invalid.
   */
  setSchema(schema: FormSchema): void

  /**
   * Returns the schema currently in use.
   * Useful for multi-step forms where the developer inspects what schema
   * was most recently set.
   */
  getSchema(): FormSchema

  /**
   * Correct the value of a single field while in confirming state.
   * Produces a FIELD_CORRECTED event that replaces ConfirmationData
   * immutably. Valid only from confirming state. (FR-114)
   *
   * The value is passed through sanitizeFieldValue before being applied.
   * If sanitization produces an empty string from a non-empty input,
   * the call is a no-op and returns false.
   *
   * @param fieldName  The FieldSchema.name of the field to correct.
   * @param value      The corrected string value from the user.
   * @returns true if the correction was applied, false if rejected.
   */
  correctField(fieldName: string, value: string): boolean
}
```

### 1.5 InjectorConfig — additions

```typescript
export interface InjectorConfig {
  formElement?: HTMLElement
  onFill?: (fieldName: string, value: string | boolean | string[]) => void | Promise<void>

  /**
   * When true, string values for text/textarea fields are appended to
   * existing DOM values. (FR-108)
   */
  appendMode?: boolean

  /**
   * When true, fields not found in the DOM are treated as expected
   * (console.warn instead of console.error; InjectionResult.success
   * is not failed solely because of missing elements). (FR-111)
   */
  multiStep?: boolean
}
```

### 1.6 VoiceFormEvent — additions

```typescript
export type VoiceFormEvent =
  // ... all existing events unchanged ...
  | { type: 'START' }
  | { type: 'STT_INTERIM'; transcript: string }
  | { type: 'STT_FINAL'; transcript: string }
  | { type: 'STT_ERROR'; error: STTError }
  | { type: 'PARSE_SUCCESS'; response: ParseResponse; confirmation: ConfirmationData }
  | { type: 'PARSE_ERROR'; error: VoiceFormError }
  | { type: 'CONFIRM' }
  | { type: 'CANCEL' }
  | { type: 'INJECTION_COMPLETE'; result: InjectionResult }
  | { type: 'ACKNOWLEDGE_ERROR' }
  | { type: 'AUTO_RESET' }
  /**
   * Dispatched when the user saves a correction in the confirmation panel.
   * Carries the complete new ConfirmationData produced by immutable update.
   * Valid only in confirming state. (FR-114, security review #1)
   */
  | { type: 'FIELD_CORRECTED'; confirmation: ConfirmationData }
```

### 1.7 VoiceFormStrings — additions

```typescript
// Additions to VoiceFormStrings.confirm
confirm: {
  // ... existing fields unchanged ...

  /** Edit button aria-label. Receives field label. Default: "Edit {label}". */
  editAriaLabel: string | ((fieldLabel: string) => string)
  /** Save button label in edit mode. Default: "Save". */
  saveEditLabel: string
  /** Save button aria-label. Receives field label. Default: "Save {label} correction". */
  saveEditAriaLabel: string | ((fieldLabel: string) => string)
  /** Discard button label in edit mode. Default: "Cancel". */
  discardEditLabel: string
  /** Discard button aria-label. Receives field label. Default: "Discard {label} correction". */
  discardEditAriaLabel: string | ((fieldLabel: string) => string)
  /** Shown when sanitization rejects a draft correction. Default: "Invalid value". */
  invalidValueLabel: string
  /** Screen reader hint in edit mode. Default: "Press Enter to save, Escape to cancel." */
  editHintText: string
  /** Fill button text when fields were manually corrected. Default: "Fill form (edited)". */
  fillLabelEdited: string
  /** Optional step indicator, e.g. "Step 2 of 3: Address". */
  stepLabel?: string
  /** "Current:" label in append mode preview. Default: "Current:". */
  appendExistingLabel: string
  /** "Adding:" label in append mode preview. Default: "Adding:". */
  appendNewLabel: string
  /** "Result:" label in append mode preview. Default: "Result:". */
  appendResultLabel: string
  /** Badge text for null fields (replaces v1 "Not understood"). Default: "Unchanged". */
  unchangedLabel: string
}

// Additions to VoiceFormStrings.announcements
announcements: {
  // ... existing fields unchanged ...
  /** Announced when a field enters edit mode. Receives field label. */
  fieldEditOpened: string | ((fieldLabel: string) => string)
  /** Announced when a field correction is saved. Receives field label. */
  fieldEditSaved: string | ((fieldLabel: string) => string)
}
```

### 1.8 VoiceFormCSSVars — additions

```typescript
export interface VoiceFormCSSVars {
  // ... existing vars unchanged ...
  '--vf-unchanged-badge-bg': string          // Default: #f3f4f6
  '--vf-unchanged-badge-text': string        // Default: #6b7280
  '--vf-append-existing-color': string       // Default: #9ca3af
  '--vf-append-new-color': string            // Default: #2563eb
  '--vf-field-edit-btn-color': string        // Default: #6b7280
  '--vf-field-edit-btn-hover-color': string  // Default: #111827
  '--vf-field-edit-input-border': string     // Default: #2563eb
  '--vf-field-edit-input-bg': string         // Default: #eff6ff
  '--vf-field-edit-invalid-color': string    // Default: #dc2626
  '--vf-field-corrected-indicator': string   // Default: #2563eb
}
```

---

## 2. State Machine Changes (state-machine.ts)

**File**: `packages/core/src/state-machine.ts`

The pure `transition` function is the only change target. No new states are introduced.

### 2.1 VoiceFormState shape — no changes

The existing state union is unchanged. The `confirming` state already carries `ConfirmationData`. The `FIELD_CORRECTED` event replaces the `confirmation` property on that state with a new object — this is the immutable update pattern.

### 2.2 transitionFromConfirming — FIELD_CORRECTED

Add `FIELD_CORRECTED` handling to `transitionFromConfirming`:

```typescript
function transitionFromConfirming(
  state: Extract<VoiceFormState, { status: 'confirming' }>,
  event: VoiceFormEvent,
): VoiceFormState {
  switch (event.type) {
    case 'CONFIRM':
      return { status: 'injecting', confirmation: state.confirmation }

    case 'CANCEL':
      return { status: 'idle' }

    case 'FIELD_CORRECTED':
      // Immutable update: produce a new state object with the new ConfirmationData.
      // CRITICAL (security review #1): NEVER mutate state.confirmation in place.
      // The event carries the fully-formed new ConfirmationData produced by
      // correctField() in the VoiceFormInstance layer.
      return {
        status: 'confirming',
        transcript: state.transcript,
        confirmation: event.confirmation,   // new object, not mutated
      }

    default:
      return warnInvalid(state, event)
  }
}
```

**Why the event carries the complete new ConfirmationData:** The `transition` function is a pure reducer with no imports. It cannot call `sanitizeFieldValue` or `Object.assign` itself. The entity that builds the new `ConfirmationData` is `correctField()` in `create-voice-form.ts`, which has access to the schema and sanitizer. The state machine merely transitions; the orchestration layer does the work.

---

## 3. Injector Changes (injector.ts)

**File**: `packages/core/src/injector.ts`

### 3.1 InjectorConfig — updated (section 1.5)

The `appendMode` and `multiStep` flags are added as described in section 1.5. No breaking changes.

### 3.2 createInjector — updated factory signature

```typescript
export function createInjector(config: InjectorConfig): Injector
```

When `config.onFill` is present, `appendMode` and `multiStep` are ignored (callback mode always delegates entirely to the developer's handler). Document this in the JSDoc.

### 3.3 runDomMode — append mode

In the pre-resolution loop where field work plans are built, add append mode handling for `text` and `textarea` work items:

```typescript
// ONLY for text/textarea fields when appendMode is true:
// The injector does NOT re-read the DOM for existingValue.
// existingValue was already captured by buildConfirmationData at processing
// time and is carried on ConfirmedField. The injector reads it from there
// to compute the final injection value.
//
// The `fields` parameter passed to inject() must carry ConfirmedField data.
// This means inject()'s parameter type changes from:
//   Record<string, ParsedFieldValue>
// to:
//   Record<string, ConfirmedField>
// so that the injector can access existingValue.
```

**Type change to `inject()`:**

```typescript
// Before (v1):
inject(fields: Record<string, ParsedFieldValue>): Promise<InjectionResult>

// After (v2):
inject(fields: Record<string, ConfirmedField>): Promise<InjectionResult>
```

This is a non-breaking change from the `VoiceFormInstance`'s perspective — it is an internal interface. The `ConfirmedField` type is a superset of the data previously passed.

In the work plan for a `text` or `textarea` field when `appendMode` is true:

```typescript
if (
  config.appendMode &&
  (fieldType === 'text' || fieldType === 'textarea') &&
  typeof parsed.existingValue === 'string' &&
  parsed.existingValue.trim() !== ''
) {
  // Append: use the snapshot taken at buildConfirmationData time.
  // Do NOT re-read the DOM here — the user reviewed the preview in the panel.
  finalValue = parsed.existingValue + ' ' + sanitizedValue
} else {
  finalValue = sanitizedValue
}
```

### 3.4 runDomMode — multiStep mode

The `buildResult` helper gains a `multiStep` flag:

```typescript
function buildResult(
  outcomes: Record<string, FieldInjectionOutcome>,
  multiStep: boolean,
): InjectionResult {
  if (multiStep) {
    // In multiStep mode, fields not found are expected — skip them
    // without counting them as failures. success is true if every
    // *found* field was injected (or there were no found fields at all).
    const nonSkippedOutcomes = Object.values(outcomes).filter(
      (o) => !(o.status === 'skipped' && o.reason === 'element-not-found'),
    )
    const success =
      nonSkippedOutcomes.length === 0 ||
      nonSkippedOutcomes.every((o) => o.status === 'injected')
    return { success, fields: outcomes }
  }
  // Default: every field must be injected for success.
  const success = Object.values(outcomes).every((o) => o.status === 'injected')
  return { success, fields: outcomes }
}
```

When `multiStep` is true and an element is not found, emit `console.warn` instead of `console.error`:

```typescript
if (el === null) {
  if (config.multiStep) {
    console.warn(
      `[voice-form] Field "${fieldName}" not found in DOM — expected in multiStep mode.`,
    )
  } else {
    console.error(
      `[voice-form] Field "${fieldName}" not found in DOM.`,
    )
  }
  work.push({ name: fieldName, plan: { kind: 'skip', reason: { status: 'skipped', reason: 'element-not-found' } } })
  continue
}
```

### 3.5 React onChange documentation (security review #9)

Add this JSDoc warning to `InjectorConfig.onFill`:

```typescript
/**
 * WARNING: This callback fires during the injecting state, which may trigger
 * React onChange handlers that update controlled component state. If your
 * component re-renders during injection, ensure it does not interfere with
 * the injection sequence. Use onFieldsResolved in @voiceform/react for a
 * cleaner integration with React controlled forms.
 */
onFill?: (fieldName: string, value: string | boolean | string[]) => void | Promise<void>
```

---

## 4. Factory Changes (create-voice-form.ts)

**File**: `packages/core/src/create-voice-form.ts`

### 4.1 autoDetectSchema — dynamic import

When `config.autoDetectSchema` is true and `config.schema` is absent, `createVoiceForm` must dynamically import `detect-schema` before initializing the state machine:

```typescript
// ── 1. Validate / detect schema ──────────────────────────────────────────
let currentSchema: FormSchema

if (config.autoDetectSchema && !config.schema) {
  // CRITICAL (security review #11): MUST be a dynamic import, not a static
  // top-level import. This keeps detect-schema tree-shakeable for consumers
  // who never use autoDetectSchema.
  //
  // createVoiceForm is synchronous in v1. The autoDetectSchema path makes it
  // async ONLY when the developer opts in. The function signature does NOT
  // change to async — instead, autoDetectSchema initialization is moved to a
  // new async factory: createVoiceFormAsync().
  // See section 4.2 for the async factory design.
  throw new VoiceFormConfigError(
    'INIT_FAILED',
    'autoDetectSchema requires calling createVoiceFormAsync() instead of createVoiceForm(). ' +
    'createVoiceForm() is synchronous and cannot await the dynamic import.',
  )
}
```

**Design decision:** `createVoiceForm` remains synchronous. `autoDetectSchema` is surfaced via a new `createVoiceFormAsync` export:

### 4.2 createVoiceFormAsync

```typescript
/**
 * Async factory for createVoiceForm. Required when autoDetectSchema is true,
 * because schema detection uses a dynamic import() of the detect-schema module.
 *
 * For all other configurations, createVoiceForm() (synchronous) is preferred.
 *
 * @param config  Same VoiceFormConfig as createVoiceForm.
 * @returns       A Promise that resolves to a fully-initialized VoiceFormInstance.
 * @throws {VoiceFormConfigError} if configuration is invalid.
 */
export async function createVoiceFormAsync(config: VoiceFormConfig): Promise<VoiceFormInstance> {
  let resolvedConfig = config

  if (config.autoDetectSchema) {
    if (config.schema) {
      console.warn(
        '[voice-form] autoDetectSchema is true but schema was also provided. ' +
        'Explicit schema takes precedence. autoDetectSchema has no effect.',
      )
    } else {
      // Dynamic import — tree-shaken when not used (security review #11)
      const { detectSchema } = await import('./detect-schema.js')

      // formElement must be resolved before calling detectSchema
      const root = resolveFormElement(config.formElement)
      if (root === null) {
        throw new VoiceFormConfigError(
          'INIT_FAILED',
          'autoDetectSchema requires formElement to be set and resolvable.',
        )
      }

      const rawSchema = detectSchema(root)
      const finalSchema = config.onSchemaDetected?.(rawSchema) ?? rawSchema
      resolvedConfig = { ...config, schema: finalSchema }
    }
  }

  return createVoiceForm(resolvedConfig)
}
```

### 4.3 buildConfirmationData — appendMode and existingValue

`buildConfirmationData` signature extends to accept optional DOM context for appendMode:

```typescript
function buildConfirmationData(
  response: ParseResponse,
  transcript: string,
  schema: FormSchema,
  options: {
    appendMode: boolean
    // formElement is passed when appendMode is true so existingValue
    // can be read from the live DOM before the confirming state is entered.
    // DOM reads happen here, during processing state, not at injection time.
    formElement?: HTMLElement | Document
    elementCache?: Map<string, HTMLElement | null>
  } = { appendMode: false },
): ConfirmationData
```

When `appendMode` is true and a field is `text` or `textarea`, read `element.value` from the DOM:

```typescript
if (
  options.appendMode &&
  (fieldDef.type === 'text' || fieldDef.type === 'textarea') &&
  options.formElement !== undefined
) {
  const el = resolveElementForRead(fieldDef.name, options.formElement, options.elementCache)
  const domValue = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el.value
    : undefined
  if (typeof domValue === 'string' && domValue.trim() !== '') {
    parsedFields[fieldDef.name] = {
      ...parsedFields[fieldDef.name]!,
      existingValue: domValue,
    }
  }
}
```

The `ConfirmationData` returned by `buildConfirmationData` always includes `appendMode` as a boolean field, set from `options.appendMode`.

### 4.4 correctField — VoiceFormInstance method

```typescript
correctField(fieldName: string, value: string): boolean {
  if (destroyed) return false
  const state = machine.getState()
  if (state.status !== 'confirming') return false

  const fieldDef = currentSchema.fields.find((f) => f.name === fieldName)
  const fieldType = fieldDef?.type ?? 'text'
  const options = fieldDef?.options as string[] | undefined

  // Sanitize the user's input through the same pipeline as LLM output.
  let sanitizedValue: string
  try {
    const result = sanitizeFieldValue(value, fieldType, options)
    sanitizedValue = typeof result.value === 'string' ? result.value : String(result.value)
  } catch {
    return false
  }

  // Reject if sanitization consumed the entire non-empty input.
  if (sanitizedValue.trim() === '' && value.trim() !== '') {
    return false
  }

  const existingField = state.confirmation.parsedFields[fieldName]

  // Build new ConfirmationData immutably (security review #1).
  // Use Object.assign / spread — NEVER mutate state.confirmation in place.
  const newParsedFields = {
    ...state.confirmation.parsedFields,
    [fieldName]: {
      label: existingField?.label ?? fieldDef?.label ?? fieldName,
      value: sanitizedValue,
      ...(existingField?.existingValue !== undefined
        ? { existingValue: existingField.existingValue }
        : {}),
      userCorrected: true,
      originalValue: existingField?.value,
    } satisfies ConfirmedField,
  }

  const newConfirmation: ConfirmationData = {
    ...state.confirmation,
    parsedFields: newParsedFields,
  }

  machine.dispatch({ type: 'FIELD_CORRECTED', confirmation: newConfirmation })
  return true
},
```

### 4.5 setSchema — VoiceFormInstance method

`setSchema` is a direct implementation of the renamed `updateSchema`. The existing `updateSchema` body is moved to `setSchema`, and `updateSchema` becomes a deprecated alias:

```typescript
setSchema(schema: FormSchema): void {
  if (destroyed) return
  const state = machine.getState()
  if (state.status !== 'idle') {
    throw new VoiceFormErrorImpl(
      'INVALID_TRANSITION',
      'setSchema() can only be called from the idle state.',
      false,
    )
  }
  currentSchema = validateSchema(schema)
  injector.clearCache()
},

getSchema(): FormSchema {
  return currentSchema
},

/** @deprecated Use setSchema() instead. Will be removed in v3. */
updateSchema(schema: FormSchema): void {
  console.warn(
    '[voice-form] updateSchema() is deprecated and will be removed in v3. ' +
    'Use setSchema() instead.',
  )
  this.setSchema(schema)
},
```

### 4.6 inject() call site — updated to pass ConfirmedField

In `handleStateTransition` for the `injecting` case, pass the `ConfirmedField` map directly (section 3.3 changed the inject signature):

```typescript
case 'injecting': {
  let injectionResult: InjectionResult
  try {
    // Pass ConfirmedField objects directly so the injector can access
    // existingValue for appendMode concatenation without re-reading the DOM.
    injectionResult = await injector.inject(state.confirmation.parsedFields)
  } catch {
    injectionResult = { success: false, fields: {} }
  }
  handlingTransition = false
  machine.dispatch({ type: 'INJECTION_COMPLETE', result: injectionResult })
  break
}
```

### 4.7 createInjector call site — forward appendMode and multiStep

```typescript
let injector: Injector = createInjector({
  ...(formElementResolved !== undefined ? { formElement: formElementResolved } : {}),
  appendMode: config.appendMode ?? false,
  multiStep: config.multiStep ?? false,
})
```

### 4.8 DOM auto-detection — useEffect requirement (security review #10)

When used with React, `createVoiceFormAsync` MUST be called inside a `useEffect` (or the `useVoiceForm` hook handles it internally). Document this constraint with a warning in the JSDoc:

```typescript
/**
 * WARNING (React users): If using autoDetectSchema with React, call this
 * inside a useEffect or use the useVoiceForm hook from @voiceform/react,
 * which handles initialization safely. Calling createVoiceFormAsync()
 * synchronously during React render will attempt DOM access before the
 * component tree has mounted, producing unreliable schema detection.
 */
export async function createVoiceFormAsync(config: VoiceFormConfig): Promise<VoiceFormInstance>
```

---

## 5. Whisper STT Adapter (adapters/whisper.ts)

**File**: `packages/core/src/adapters/whisper.ts`

### 5.1 Complete Type Definitions

```typescript
import type { STTAdapter, STTAdapterEvents, STTError, STTErrorCode } from '../types.js'

/**
 * Configuration for the Whisper STT adapter.
 * The adapter records audio via MediaRecorder, assembles a Blob,
 * POSTs to the developer's transcription endpoint, and returns the transcript.
 *
 * The transcription endpoint is always developer-controlled (BYOE pattern).
 * Audio never leaves the developer's infrastructure directly from this library.
 */
export interface WhisperAdapterConfig {
  /**
   * URL of the developer's transcription endpoint.
   * The adapter POSTs raw audio to this URL and expects { transcript: string }.
   * Must be a developer-controlled proxy to OpenAI Whisper or compatible API.
   */
  transcriptionEndpoint: string

  /**
   * Maximum recording duration in milliseconds before stop() is called
   * automatically. Default: 60000 (60 seconds).
   */
  maxDurationMs?: number

  /**
   * Additional HTTP headers sent with the transcription POST request.
   * Use for authentication tokens on the developer's transcription endpoint.
   * NEVER put LLM API keys in headers — they belong server-side.
   */
  headers?: Record<string, string>

  /**
   * Request timeout for the transcription POST in milliseconds.
   * Default: 30000 (30 seconds — Whisper inference is slower than streaming STT).
   */
  timeoutMs?: number
}
```

### 5.2 MIME Type Selection

```typescript
/**
 * Priority order for MediaRecorder MIME types.
 * Matches Whisper API compatibility and browser support matrix.
 * The selected type is sent as Content-Type on the transcription POST.
 */
const MIME_TYPE_PRIORITY = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',    // fallback without codec hint
] as const

function selectMimeType(): string {
  for (const mimeType of MIME_TYPE_PRIORITY) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }
  return ''  // Let MediaRecorder use its default
}
```

### 5.3 Class Implementation Spec

```typescript
export class WhisperAdapter implements STTAdapter {
  private readonly config: Required<Omit<WhisperAdapterConfig, 'headers'>> &
    Pick<WhisperAdapterConfig, 'headers'>

  // Internal state — all nullable so GC can reclaim after each session.
  private chunks: Blob[] = []
  private audioBlob: Blob | null = null
  private mediaStream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null

  // Abort flag — set BEFORE recorder.stop() to prevent ondataavailable
  // from writing stale chunks and onStop from firing the POST.
  // (security review #3: aborted = true MUST precede recorder.stop())
  private aborted = false

  // AbortController for the in-flight transcription POST.
  // Replaced on each start() call to cancel any prior session's POST.
  // (security review #4: cross-session Blob leak prevention)
  private postAbortController: AbortController | null = null

  // The events object for the current session.
  // Nulled after the session ends so stale callbacks cannot fire.
  private currentEvents: STTAdapterEvents | null = null

  constructor(config: WhisperAdapterConfig) {
    this.config = {
      maxDurationMs: config.maxDurationMs ?? 60_000,
      timeoutMs: config.timeoutMs ?? 30_000,
      transcriptionEndpoint: config.transcriptionEndpoint,
      headers: config.headers,
    }
  }

  isSupported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function'
    )
  }

  async start(events: STTAdapterEvents): Promise<void>
  stop(): void
  abort(): void
}
```

### 5.4 start() Implementation

```typescript
async start(events: STTAdapterEvents): Promise<void> {
  // (security review #4): Cancel any in-flight POST from a prior session
  // before starting a new one. This prevents cross-session Blob leaks where
  // a slow prior POST could call events.onFinal after the new session starts.
  if (this.postAbortController !== null) {
    this.postAbortController.abort()
    this.postAbortController = null
  }

  // Reset all session state.
  this.aborted = false
  this.chunks = []
  this.audioBlob = null
  this.currentEvents = events

  // Request microphone access.
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    const code = resolveGetUserMediaError(err)
    const sttError = createSTTError(code, err instanceof Error ? err.message : 'Microphone access failed', err)
    events.onError(sttError)
    events.onEnd()
    return
  }

  this.mediaStream = stream

  const mimeType = selectMimeType()
  const recorderOptions = mimeType ? { mimeType } : {}

  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, recorderOptions)
  } catch (err) {
    this.releaseStream()
    const sttError = createSTTError('UNKNOWN', 'MediaRecorder initialization failed', err)
    events.onError(sttError)
    events.onEnd()
    return
  }

  this.recorder = recorder

  recorder.ondataavailable = (e: BlobEvent) => {
    // Guard against stale events after abort() is called.
    if (this.aborted) return
    if (e.data.size > 0) {
      this.chunks.push(e.data)
    }
  }

  recorder.onstop = () => {
    // Guard: if aborted, discard all chunks without POSTing.
    if (this.aborted) {
      this.chunks = []
      this.audioBlob = null
      this.recorder = null
      this.releaseStream()
      return
    }
    this.handleRecorderStop(mimeType || 'audio/webm')
  }

  recorder.onerror = (e: MediaRecorderErrorEvent) => {
    if (this.aborted) return
    const sttError = createSTTError('UNKNOWN', 'MediaRecorder error', e.error)
    this.currentEvents?.onError(sttError)
    this.cleanup()
    this.currentEvents?.onEnd()
    this.currentEvents = null
  }

  // Start recording with timeslice so ondataavailable fires regularly.
  recorder.start(250)  // 250ms chunks

  // Auto-stop after maxDurationMs.
  this.maxDurationTimer = setTimeout(() => {
    if (this.recorder?.state === 'recording') {
      this.stop()
    }
  }, this.config.maxDurationMs)
}
```

### 5.5 stop() Implementation

```typescript
stop(): void {
  if (this.maxDurationTimer !== null) {
    clearTimeout(this.maxDurationTimer)
    this.maxDurationTimer = null
  }
  // aborted is false — the onstop handler will fire the POST.
  if (this.recorder?.state === 'recording') {
    this.recorder.stop()
  }
}
```

### 5.6 abort() Implementation — flag ordering is CRITICAL

```typescript
abort(): void {
  // (security review #3): CRITICAL — set aborted = true BEFORE calling
  // recorder.stop(). The MediaRecorder.stop() call will trigger onstop
  // and ondataavailable callbacks synchronously or in a microtask. If
  // aborted is not already true when those fire, they will assemble a Blob
  // and attempt a POST even though the user cancelled.
  this.aborted = true

  if (this.maxDurationTimer !== null) {
    clearTimeout(this.maxDurationTimer)
    this.maxDurationTimer = null
  }

  // Stop the recorder AFTER setting the flag.
  if (this.recorder?.state === 'recording') {
    this.recorder.stop()
  }

  // Discard all collected audio data immediately.
  this.chunks = []
  this.audioBlob = null
  this.recorder = null

  // Cancel any in-flight POST from a slow prior stop() call.
  // (security review #4)
  this.postAbortController?.abort()
  this.postAbortController = null

  this.releaseStream()
  this.currentEvents?.onEnd()
  this.currentEvents = null
}
```

### 5.7 handleRecorderStop() — POST and cleanup

```typescript
private async handleRecorderStop(mimeType: string): Promise<void> {
  // Assemble Blob from collected chunks.
  this.audioBlob = new Blob(this.chunks, { type: mimeType })

  // Clear chunk array immediately after assembly — GC can reclaim individual
  // chunk Blobs while the assembled Blob is in-flight.
  this.chunks = []

  this.postAbortController = new AbortController()
  const timeoutId = setTimeout(() => {
    this.postAbortController?.abort()
  }, this.config.timeoutMs)

  const events = this.currentEvents
  if (!events) {
    this.cleanup()
    return
  }

  try {
    const response = await fetch(this.config.transcriptionEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'X-VoiceForm-Request': '1',
        ...this.config.headers,
      },
      body: this.audioBlob,
      signal: this.postAbortController.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw Object.assign(new Error(`Transcription endpoint returned HTTP ${response.status}`), {
        code: 'NETWORK_ERROR' as STTErrorCode,
        httpStatus: response.status,
      })
    }

    let json: unknown
    try {
      json = await response.json()
    } catch {
      throw Object.assign(new Error('Transcription endpoint returned invalid JSON'), {
        code: 'UNKNOWN' as STTErrorCode,
      })
    }

    // (security review #5): Validate the transcript field type and length.
    // The transcript arrives from the developer's server, which is untrusted
    // from this library's perspective. Enforce type and max length before
    // passing to the state machine.
    const raw = (json as Record<string, unknown>)['transcript']
    if (typeof raw !== 'string') {
      throw Object.assign(
        new Error(
          'Transcription endpoint response missing "transcript" string field. ' +
          `Received: ${JSON.stringify(raw)?.slice(0, 100)}`,
        ),
        { code: 'UNKNOWN' as STTErrorCode },
      )
    }

    // Enforce max length. The parse endpoint enforces maxTranscriptLength,
    // but we truncate here as a defence-in-depth measure. 10,000 chars is
    // an upper bound that no legitimate Whisper transcript should exceed.
    const MAX_TRANSCRIPT_LENGTH = 10_000
    const transcript = raw.length > MAX_TRANSCRIPT_LENGTH
      ? raw.slice(0, MAX_TRANSCRIPT_LENGTH)
      : raw

    events.onFinal(transcript)
  } catch (err) {
    clearTimeout(timeoutId)

    if (err !== null && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError') {
      // Timed out or aborted — onEnd is still called below.
    } else {
      const sttErr = toSTTError(err)
      events.onError(sttErr)
    }
  } finally {
    // (security review PERF 2.7): Dereference Blob after POST completes.
    // This is the ONLY place audioBlob is nulled on the normal path.
    this.audioBlob = null
    this.postAbortController = null
    this.recorder = null
    this.releaseStream()
    events.onEnd()
    this.currentEvents = null
  }
}
```

### 5.8 releaseStream() and helper functions

```typescript
private releaseStream(): void {
  // Stop all tracks to release the OS-level microphone lock.
  this.mediaStream?.getTracks().forEach((t) => t.stop())
  this.mediaStream = null
}

private cleanup(): void {
  this.chunks = []
  this.audioBlob = null
  this.recorder = null
  this.releaseStream()
}
```

```typescript
// Module-level helpers (not exported)

function resolveGetUserMediaError(err: unknown): STTErrorCode {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'PERMISSION_DENIED'
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'AUDIO_CAPTURE_FAILED'
    }
  }
  return 'UNKNOWN'
}

function createSTTError(code: STTErrorCode, message: string, originalError?: unknown): STTError {
  const err = new Error(message) as STTError
  Object.defineProperty(err, 'code', { value: code, enumerable: true })
  if (originalError !== undefined) {
    Object.defineProperty(err, 'originalError', { value: originalError, enumerable: true })
  }
  return err
}

function toSTTError(err: unknown): STTError {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>
    const code = typeof e['code'] === 'string' ? (e['code'] as STTErrorCode) : 'UNKNOWN'
    const message = typeof e['message'] === 'string' ? e['message'] : String(err)
    return createSTTError(code, message, err)
  }
  return createSTTError('UNKNOWN', String(err), err)
}
```

### 5.9 Error mapping table

| Failure condition | `STTErrorCode` |
|---|---|
| `getUserMedia` permission denied | `PERMISSION_DENIED` |
| `getUserMedia` no hardware | `AUDIO_CAPTURE_FAILED` |
| `MediaRecorder` `onerror` event | `UNKNOWN` (with `originalError`) |
| Non-2xx from transcription endpoint | `NETWORK_ERROR` |
| Missing `transcript` field in response | `UNKNOWN` (descriptive message) |
| Invalid JSON response body | `UNKNOWN` (descriptive message) |
| POST network failure | `NETWORK_ERROR` |
| POST timeout (AbortController) | `NETWORK_ERROR` (message: "timed out") |

---

## 6. DOM Schema Auto-Detection (detect-schema.ts)

**File**: `packages/core/src/detect-schema.ts`  
**Subpath export**: `@voiceform/core/detect-schema`

This module is a separate subpath export and MUST NOT be statically imported anywhere in `create-voice-form.ts` or `index.ts`. It is tree-shakeable by default.

### 6.1 Function Signature

```typescript
import type { FormSchema } from './types.js'

/**
 * Scans a form element and returns a FormSchema inferred from the DOM structure.
 *
 * This is a best-effort inference. Always review the result via onSchemaDetected
 * before production use. Use validateSchemaAgainstDOM() from @voiceform/dev
 * to cross-check the result against the live DOM.
 *
 * Security: reads only element attributes and label text — structural metadata
 * authored by the developer. Does NOT read element.value (current user input).
 * (security review #6: label text truncated to 100 chars)
 *
 * Must be called inside a useEffect in React — never synchronously during render.
 * (security review #10)
 *
 * @param formElement  The root element to scan. Typically a <form> element.
 * @returns A FormSchema. May have zero fields if nothing is detectable.
 */
export function detectSchema(formElement: HTMLElement): FormSchema
```

### 6.2 Detection Algorithm

```
1. Query all <input>, <textarea>, <select> within formElement.
2. Exclude:
   - type="hidden", type="submit", type="reset", type="button",
     type="image"
   - Elements with no name AND no id (unresolvable)
   - Password fields: type="password" — excluded entirely for security
3. For each element, extract:
   - name:     element.name ?? element.id
   - label:    resolveLabel(el, formElement)  [truncated to 100 chars]
   - type:     mapped from element.type / tagName
   - options:  for <select>: non-empty option values
   - required: element.required
4. For radio groups: deduplicate by name, collect all values as options,
   produce one FieldSchema with type: 'radio'.
5. Elements with no resolvable name: console.warn and exclude.
```

### 6.3 Label Resolution — resolveLabel()

```typescript
function resolveLabel(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  root: HTMLElement,
): string {
  let resolved = ''

  // 1. <label for="id">
  if (el.id) {
    const associated = root.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`)
    if (associated?.textContent?.trim()) {
      resolved = associated.textContent.trim()
    }
  }

  // 2. aria-labelledby (space-separated id list)
  if (!resolved) {
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => root.querySelector(`#${CSS.escape(id)}`)?.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
      if (text) resolved = text
    }
  }

  // 3. aria-label
  if (!resolved) {
    resolved = el.getAttribute('aria-label')?.trim() ?? ''
  }

  // 4. Closest ancestor <label>
  if (!resolved) {
    resolved = el.closest('label')?.textContent?.trim() ?? ''
  }

  // 5. placeholder
  if (!resolved) {
    resolved = el.getAttribute('placeholder')?.trim() ?? ''
  }

  // 6. name/id fallback
  if (!resolved) {
    resolved = el.name || el.id || ''
  }

  // (security review #6): Truncate to 100 chars to prevent prompt injection
  // via crafted label text exceeding reasonable label length.
  // Schema labels are sent to the LLM endpoint — abnormally long labels
  // are a signal of either misconfiguration or adversarial content.
  return resolved.slice(0, 100)
}
```

### 6.4 Radio Group Label Resolution

```typescript
function resolveRadioGroupLabel(firstRadio: HTMLInputElement, root: HTMLElement): string {
  // Extra step for radio groups: check for <fieldset>/<legend> ancestor.
  const fieldset = firstRadio.closest('fieldset')
  const legend = fieldset?.querySelector('legend')
  if (legend?.textContent?.trim()) {
    return legend.textContent.trim().slice(0, 100)  // also truncate
  }
  return resolveLabel(firstRadio, root)
}
```

### 6.5 Type Mapping

```typescript
function mapInputType(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): FieldType {
  if (el instanceof HTMLTextAreaElement) return 'textarea'
  if (el instanceof HTMLSelectElement) return 'select'
  if (el instanceof HTMLInputElement) {
    switch (el.type) {
      case 'email':    return 'email'
      case 'tel':      return 'tel'
      case 'number':
      case 'range':    return 'number'
      case 'date':
      case 'month':
      case 'week':
      case 'time':
      case 'datetime-local': return 'date'
      case 'checkbox': return 'checkbox'
      case 'radio':    return 'radio'
      // text, search, url, password all map to 'text'
      default:         return 'text'
    }
  }
  return 'text'
}
```

---

## 7. Field-Level Correction

### 7.1 EditState Type (UI layer only, not exported from core)

```typescript
// Internal to the confirmation panel UI — packages/core/src/ui/default-ui.ts
// Not part of the public type system.

interface EditState {
  /** Is this field currently in edit mode? */
  active: boolean
  /** Current value in the correction input while editing. */
  draftValue: string
}
```

The panel maintains a `Map<fieldName, EditState>` in local component state. This map is never dispatched to the state machine — it is purely ephemeral UI state.

### 7.2 Correction Save Flow

When the user saves a correction in the confirmation panel:

```
1. Read draftValue from EditState.
2. Call sanitizeUserCorrection(draftValue, field.type, field.options).
3. If rejected (sanitization consumed entire non-empty value):
   - Show strings.confirm.invalidValueLabel on the correction input.
   - Do NOT update ConfirmedField. Do NOT call correctField().
   - Keep edit mode active.
4. If accepted:
   - Call instance.correctField(fieldName, sanitizedValue).
   - correctField() dispatches FIELD_CORRECTED → state machine updates.
   - Clear EditState for this field (active = false).
   - Focus returns to the edit button for this field.
   - aria-live region announces strings.announcements.fieldEditSaved(field.label).
   - If any field has userCorrected: true, fill button label = fillLabelEdited.
```

### 7.3 sanitizeUserCorrection (UI helper)

```typescript
// packages/core/src/ui/sanitize-user-correction.ts
// Exported for testing; not re-exported from the public API barrel.

export function sanitizeUserCorrection(
  draftValue: string,
  fieldType: FieldType,
  options: readonly string[] | undefined,
): { value: string; wasModified: boolean; rejected: boolean } {
  if (draftValue.trim() === '') {
    return { value: '', wasModified: false, rejected: false }
  }

  const result = sanitizeFieldValue(draftValue, fieldType, options as string[] | undefined)
  const finalValue = typeof result.value === 'string' ? result.value : String(result.value)

  if (finalValue.trim() === '' && draftValue.trim() !== '') {
    // Sanitization consumed the entire value — reject the save.
    return { value: draftValue, wasModified: true, rejected: true }
  }

  return { value: finalValue, wasModified: result.wasModified, rejected: false }
}
```

### 7.4 Correction Input DOM Structure

Full structure specified in V2_FRONTEND_DESIGN.md section 4.5. Key security attributes:

```html
<input
  class="vf-field-correction-input"
  type="email"                         <!-- match FieldType for mobile keyboard -->
  aria-labelledby="vf-label-{name}"
  aria-describedby="vf-correction-hint-{name}"
  autocomplete="off"
  data-1p-ignore                       <!-- suppress 1Password -->
  data-lpignore="true"                 <!-- suppress LastPass -->
/>
```

Values in the correction input are read via `inputEl.value` (not innerHTML) and passed through `sanitizeUserCorrection` before any state mutation.

### 7.5 Keyboard Navigation Spec

| Key | Context | Action |
|---|---|---|
| Enter | Correction input (non-textarea) | Save correction |
| Escape | Correction input | Discard, return focus to edit button |
| Tab | Correction input | Move to Save button |
| Tab | Save button | Move to Cancel (Discard) button |
| Tab | Discard button | Move to next field's edit button |
| Shift+Escape | Textarea correction input | Discard |

---

## 8. React Package (@voiceform/react)

**Package**: `packages/react/`

### 8.1 Package Structure

```
packages/react/
├── src/
│   ├── index.ts              Public API barrel
│   ├── useVoiceForm.ts       Core hook
│   ├── VoiceForm.tsx         Compound component
│   └── types.ts              React-specific type extensions
├── package.json
├── tsup.config.ts
└── tsconfig.json
```

### 8.2 package.json

```json
{
  "name": "@voiceform/react",
  "version": "2.0.0",
  "sideEffects": false,
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0",
    "@voiceform/core": ">=2.0.0"
  },
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  }
}
```

`@voiceform/core` and all React packages MUST be listed as `external` in `tsup.config.ts` to prevent double-bundling.

### 8.3 useVoiceForm Hook — complete implementation spec

```typescript
// packages/react/src/useVoiceForm.ts

import { useCallback, useEffect, useRef } from 'react'
import { useSyncExternalStore } from 'react'
import { createVoiceForm } from '@voiceform/core'
import type { VoiceFormConfig, VoiceFormState, VoiceFormInstance } from '@voiceform/core'

export interface UseVoiceFormResult {
  /** Current state of the voice form engine. Safe to render directly. */
  state: VoiceFormState
  /** The VoiceFormInstance. Stable reference across renders. */
  instance: VoiceFormInstance
}

export function useVoiceForm(options: VoiceFormConfig): UseVoiceFormResult {
  // Instance ref: createVoiceForm is called once on mount only.
  // The null check guard means it runs at most once even in Strict Mode's
  // double-render (which re-uses the same ref object).
  const instanceRef = useRef<VoiceFormInstance | null>(null)

  // Options ref: keeps subscribe/getSnapshot closures up to date without
  // triggering re-subscription on every render.
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Synchronous initialization: the instance must exist before the first
  // useSyncExternalStore call so getSnapshot has something to call.
  // This is safe because createVoiceForm() has no side effects observable
  // outside this component's tree.
  if (instanceRef.current === null) {
    instanceRef.current = createVoiceForm(options)
  }

  // CRITICAL (security review #2): subscribe and getSnapshot MUST be stable
  // references via useCallback with empty deps. Unstable references cause
  // useSyncExternalStore to re-subscribe on every render, which triggers
  // listener accumulation and unnecessary re-renders.
  const subscribe = useCallback((onStoreChange: () => void): (() => void) => {
    // instanceRef.current is guaranteed non-null here: it was initialized above
    // (synchronously, before hooks run), and the useEffect cleanup that sets it
    // to null only fires on unmount, after all renders have stopped.
    const instance = instanceRef.current!
    return instance.subscribe(() => onStoreChange())
  }, [])  // empty deps — instance identity is stable for the component lifetime

  const getSnapshot = useCallback((): VoiceFormState => {
    return instanceRef.current!.getState()
  }, [])  // empty deps — same reasoning as subscribe

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Destroy the instance on unmount.
  // In React StrictMode (development), this useEffect's cleanup fires after
  // the first simulated unmount, calling destroy() and setting the ref to null.
  // The subsequent re-mount runs the synchronous initialization above again,
  // creating a second instance. This is expected and correct — the second
  // instance persists for the component's actual lifetime.
  useEffect(() => {
    return () => {
      instanceRef.current?.destroy()
      instanceRef.current = null
    }
  }, [])  // empty deps — only on unmount

  return {
    state,
    instance: instanceRef.current,
  }
}
```

### 8.4 VoiceForm Component — complete spec

```typescript
// packages/react/src/VoiceForm.tsx

import React, { useCallback } from 'react'
import { useVoiceForm } from './useVoiceForm.js'
import type { VoiceFormConfig, VoiceFormState, VoiceFormInstance } from '@voiceform/core'

export interface VoiceFormRenderProps {
  state: VoiceFormState
  instance: VoiceFormInstance
}

export interface VoiceFormProps extends VoiceFormConfig {
  /**
   * Render prop / children-as-function API.
   * When provided, the default mic button UI is NOT rendered.
   * The developer is responsible for calling instance.start(), etc.
   * Ref forwarding is a no-op when this prop is used — document this.
   */
  children?: (props: VoiceFormRenderProps) => React.ReactNode

  /**
   * Convenience prop: called after confirmation and injection complete.
   * Equivalent to VoiceFormConfig.events.onDone.
   * When both are provided, this prop is preferred and the developer's
   * events.onDone from config is chained (security review #8 callback chain).
   */
  onDone?: NonNullable<NonNullable<VoiceFormConfig['events']>['onDone']>

  /**
   * Convenience prop: called when an error occurs.
   * Equivalent to VoiceFormConfig.events.onError.
   * Chained with events.onError when both are provided.
   */
  onError?: NonNullable<NonNullable<VoiceFormConfig['events']>['onError']>

  /**
   * When provided, DOM injection is skipped. The developer receives parsed,
   * sanitized field values and updates their form state directly.
   *
   * Use for: React Hook Form, Formik, React 19 form actions, rich text editors.
   *
   * The confirmation step still occurs unless skipConfirmation is also set.
   * Values have been sanitized through sanitizeFieldValue before being passed here.
   *
   * WARNING: onChange handlers on controlled inputs may fire during DOM injection
   * when onFieldsResolved is NOT used. See InjectorConfig.onFill documentation.
   * (security review #9)
   */
  onFieldsResolved?: (fields: Record<string, string>) => void
}

export const VoiceForm = React.forwardRef<HTMLButtonElement, VoiceFormProps>(
  (props, ref) => {
    const { children, onDone, onError, onFieldsResolved, ...voiceFormConfig } = props

    // Chain developer convenience callbacks with any events already in config.
    // (security review #8): Do NOT override events by spreading — chain them.
    const mergedConfig: VoiceFormConfig = {
      ...voiceFormConfig,
      events: {
        ...voiceFormConfig.events,
        ...(onDone || voiceFormConfig.events?.onDone ? {
          onDone: (result) => {
            voiceFormConfig.events?.onDone?.(result)
            onDone?.(result)
          },
        } : {}),
        ...(onError || voiceFormConfig.events?.onError ? {
          onError: (err) => {
            voiceFormConfig.events?.onError?.(err)
            onError?.(err)
          },
        } : {}),
        // onFieldsResolved is wired by configuring headless injection mode
        // in the core instance. See implementation note below.
      },
    }

    const { state, instance } = useVoiceForm(mergedConfig)

    if (typeof children === 'function') {
      // Render prop: developer controls UI. Ref forwarding is a no-op here.
      return <>{children({ state, instance })}</>
    }

    // Default UI: forward ref to the internal mic button.
    return (
      <DefaultVoiceFormUI
        state={state}
        instance={instance}
        buttonRef={ref}
        onFieldsResolved={onFieldsResolved}
      />
    )
  },
)

VoiceForm.displayName = 'VoiceForm'
```

**`onFieldsResolved` implementation note:** When `onFieldsResolved` is provided, `DefaultVoiceFormUI` wraps `instance.confirm()` to intercept the injection step. Instead of the DOM injector running, it calls `onFieldsResolved` with the sanitized field map and then allows the state machine to proceed to `done` via a no-op injection result.

### 8.5 Strict Mode Handling

In React `<StrictMode>` (development only), effects run twice:

1. First mount → `useEffect` cleanup → `destroy()` called, `instanceRef.current = null`
2. Second mount → synchronous guard `if (instanceRef.current === null)` → new instance created

The second instance is the one used in production. `createVoiceForm` is called twice in development. This is expected behavior and has no production impact. It must be documented in the hook's JSDoc.

### 8.6 tsup.config.ts

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@voiceform/core',
  ],
  treeshake: true,
})
```

---

## 9. @voiceform/dev Package

**Package**: `packages/dev/`

### 9.1 Package Structure

```
packages/dev/
├── src/
│   ├── index.ts              Named exports barrel (no default export)
│   ├── schema-inspector.ts   inspectSchema, validateSchemaAgainstDOM
│   ├── logging-middleware.ts createLoggingMiddleware
│   └── state-visualizer.ts   attachStateVisualizer, detachStateVisualizer
├── package.json
├── tsup.config.ts
└── tsconfig.json
```

### 9.2 package.json

```json
{
  "name": "@voiceform/dev",
  "version": "2.0.0",
  "sideEffects": false,
  "peerDependencies": {
    "@voiceform/core": ">=2.0.0"
  },
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  }
}
```

`@voiceform/core` is a peer dependency — never a direct production dependency. This prevents bundlers from double-including core.

### 9.3 inspectSchema

```typescript
// packages/dev/src/schema-inspector.ts

import type { FormSchema } from '@voiceform/core'

export interface SchemaDiagnostic {
  field: string
  severity: 'error' | 'warning' | 'suggestion'
  message: string
}

export interface SchemaInspectionResult {
  valid: boolean
  fieldCount: number
  diagnostics: SchemaDiagnostic[]
}

export interface DOMValidationResult {
  missingInDOM: string[]
  unmatchedInDOM: string[]
  matched: string[]
}

/**
 * Runs rich diagnostics on a FormSchema and logs to the browser console.
 * No-op in production (process.env.NODE_ENV === 'production').
 *
 * Diagnostic rules:
 * - ERROR: field name contains whitespace or CSS special chars
 * - ERROR: duplicate field name
 * - WARNING: field has no label (LLM gets name only)
 * - WARNING: select/radio field has fewer than 2 options
 * - SUGGESTION: description longer than 200 chars (inflates token count)
 * - SUGGESTION: formName or formDescription absent
 * - SUGGESTION: required: true on a boolean field (always present, no effect)
 */
export function inspectSchema(schema: FormSchema): SchemaInspectionResult {
  if (process.env.NODE_ENV === 'production') {
    return { valid: true, fieldCount: schema.fields.length, diagnostics: [] }
  }
  // ... implementation ...
}
```

### 9.4 validateSchemaAgainstDOM

```typescript
/**
 * Queries the DOM to find which schema fields have matching elements.
 * Uses the same 3-step lookup as the core injector:
 *   1. [name="<escaped>"]
 *   2. #<escaped>
 *   3. [data-voiceform="<escaped>"]
 *
 * Logs results with console.group / console.table.
 * No-op in production.
 */
export function validateSchemaAgainstDOM(
  schema: FormSchema,
  formElement: HTMLElement,
): DOMValidationResult {
  if (process.env.NODE_ENV === 'production') {
    return { missingInDOM: [], unmatchedInDOM: [], matched: [] }
  }
  // ... implementation ...
}
```

### 9.5 createLoggingMiddleware

```typescript
// packages/dev/src/logging-middleware.ts

import type { VoiceFormConfig, VoiceFormEvents } from '@voiceform/core'

export interface LoggingMiddlewareOptions {
  /** Log full schema in each request. Default: false (logs field count only). */
  logFullSchema?: boolean
  /** Log the rawResponse field from ParseResponse. Default: true. */
  logRawResponse?: boolean
  /**
   * Optional developer callbacks to chain.
   * (security review #8): Pass your own onStateChange/onError here so they
   * are called IN ADDITION to the logging callbacks. Do NOT spread
   * createLoggingMiddleware() result over a config that already has these
   * callbacks — the spread would silently drop the developer's callbacks.
   */
  callbacks?: Pick<VoiceFormEvents, 'onStateChange' | 'onError'>
}

/**
 * Returns a partial VoiceFormConfig that, when spread into the developer's
 * config, wraps the endpoint lifecycle to log request/response data.
 *
 * Usage:
 *   const instance = createVoiceForm({
 *     ...appConfig,
 *     ...createLoggingMiddleware({ callbacks: appConfig.events }),
 *   })
 *
 * IMPORTANT (security review #8): Always pass your existing callbacks via
 * the `callbacks` option to ensure both the logger and your code run.
 * Spreading the result replaces event handlers — the `callbacks` option
 * chains them so neither is lost.
 *
 * Returns {} in production.
 */
export function createLoggingMiddleware(
  options?: LoggingMiddlewareOptions,
): Pick<VoiceFormConfig, 'events'> {
  if (process.env.NODE_ENV === 'production') {
    return {}
  }

  let requestStartTime: number | null = null
  let requestNumber = 0

  return {
    events: {
      onStateChange(state) {
        // Chain developer callback first, then log.
        options?.callbacks?.onStateChange?.(state)

        if (state.status === 'processing') {
          requestNumber++
          requestStartTime = Date.now()
          const ts = new Date().toLocaleTimeString('en', { hour12: false, fractionalSecondDigits: 3 })
          console.groupCollapsed(`voiceform dev — Request #${requestNumber}  [${ts}]`)
          console.log('Transcript', state.transcript)
        } else if (state.status === 'confirming' && requestStartTime !== null) {
          const elapsed = Date.now() - requestStartTime
          requestStartTime = null
          console.log(`─── Response [+${elapsed}ms] HTTP 200 ───`)
          console.table(
            Object.entries(state.confirmation.parsedFields).reduce<Record<string, unknown>>(
              (acc, [name, field]) => {
                acc[name] = {
                  value: field.value,
                  confidence: field.confidence ?? '—',
                }
                return acc
              },
              {},
            ),
          )
          console.groupEnd()
        } else if (state.status === 'error' && requestStartTime !== null) {
          requestStartTime = null
          console.groupEnd()
        }
      },

      onError(err) {
        // Chain developer callback first, then log.
        options?.callbacks?.onError?.(err)
        console.error('voiceform dev — Error', err.code, err.message)
      },
    },
  }
}
```

### 9.6 attachStateVisualizer

```typescript
// packages/dev/src/state-visualizer.ts

import type { VoiceFormInstance } from '@voiceform/core'

export interface StateVisualizerOptions {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** Show the full state object JSON in the overlay. Default: false. */
  verbose?: boolean
}

/**
 * Attaches a fixed-position dev overlay showing live state transitions.
 *
 * Security: all output uses textContent exclusively — never innerHTML.
 * (security review #7)
 *
 * Returns a detach function. Call it to remove the overlay and clean up
 * all event listeners and subscriptions.
 */
export function attachStateVisualizer(
  instance: VoiceFormInstance,
  options?: StateVisualizerOptions,
): () => void {
  if (process.env.NODE_ENV === 'production') {
    return () => {}
  }

  const overlay = buildOverlay(options?.position ?? 'bottom-right')
  document.body.appendChild(overlay)

  // Element references for updating content.
  const statusEl = overlay.querySelector<HTMLElement>('#vf-dev-status')!
  const transcriptEl = overlay.querySelector<HTMLElement>('#vf-dev-transcript')!
  const errorEl = overlay.querySelector<HTMLElement>('#vf-dev-error')!
  const historyEl = overlay.querySelector<HTMLElement>('#vf-dev-history')!
  const verboseEl = overlay.querySelector<HTMLElement>('#vf-dev-verbose')!

  const history: string[] = []

  const unsubscribe = instance.subscribe((state) => {
    // (security review #7): textContent ONLY. Never assign to innerHTML.
    statusEl.textContent = `● ${state.status}`
    transcriptEl.textContent = ''
    errorEl.textContent = ''
    verboseEl.textContent = ''

    if (state.status === 'recording' && state.interimTranscript) {
      transcriptEl.textContent = state.interimTranscript
    }
    if (state.status === 'processing') {
      transcriptEl.textContent = state.transcript
    }
    if (state.status === 'error') {
      errorEl.textContent = `${state.error.code}: ${state.error.message}`
    }
    if (options?.verbose) {
      // textContent serializes the state as JSON-like text.
      // (security review #7): textContent, not innerHTML.
      verboseEl.textContent = JSON.stringify(state, null, 2)
    }

    history.unshift(`${Date.now() % 100000} ${state.status}`)
    if (history.length > 5) history.pop()
    historyEl.textContent = history.join('\n')
  })

  // Wrap destroy() to auto-detach the overlay if the developer calls destroy()
  // without explicitly detaching first. Monkey-patch the specific instance object,
  // not the prototype.
  const originalDestroy = instance.destroy.bind(instance)
  ;(instance as Record<string, unknown>)['destroy'] = () => {
    detach()
    originalDestroy()
  }

  function detach() {
    unsubscribe()
    overlay.remove()
    // Restore original destroy if still patched.
    ;(instance as Record<string, unknown>)['destroy'] = originalDestroy
  }

  return detach
}

function buildOverlay(position: NonNullable<StateVisualizerOptions['position']>): HTMLElement {
  const el = document.createElement('div')
  el.id = 'vf-dev-visualizer'
  el.setAttribute('data-vf-dev', 'true')

  const posStyles: Record<string, string> = {
    'top-left':     'top:12px; left:12px',
    'top-right':    'top:12px; right:12px',
    'bottom-left':  'bottom:12px; left:12px',
    'bottom-right': 'bottom:12px; right:12px',
  }

  el.style.cssText = [
    'position:fixed',
    posStyles[position],
    'z-index:2147483647',
    'background:#1e1e2e',
    'color:#cdd6f4',
    'font-family:monospace',
    'font-size:12px',
    'padding:12px 16px',
    'border-radius:8px',
    'border:1px solid #45475a',
    'min-width:220px',
    'max-width:400px',
    'white-space:pre-wrap',
  ].join('; ')

  // Build overlay children using DOM methods, never innerHTML.
  const label = document.createElement('div')
  label.style.cssText = 'font-size:10px; color:#6c7086; margin-bottom:4px; user-select:none'
  label.textContent = 'voiceform dev'

  const status = document.createElement('div')
  status.id = 'vf-dev-status'

  const transcript = document.createElement('div')
  transcript.id = 'vf-dev-transcript'
  transcript.style.cssText = 'color:#89b4fa; margin-top:4px; word-break:break-word'

  const error = document.createElement('div')
  error.id = 'vf-dev-error'
  error.style.cssText = 'color:#f38ba8; margin-top:4px'

  const history = document.createElement('div')
  history.id = 'vf-dev-history'
  history.style.cssText = 'color:#585b70; margin-top:8px; font-size:10px'

  const verbose = document.createElement('pre')
  verbose.id = 'vf-dev-verbose'
  verbose.style.cssText = 'color:#a6e3a1; margin-top:8px; font-size:10px; max-height:200px; overflow:auto'

  el.append(label, status, transcript, error, history, verbose)
  return el
}

/**
 * Removes a previously attached state visualizer overlay.
 * Safe to call if no visualizer is attached (no-op).
 * Equivalent to calling the function returned by attachStateVisualizer.
 */
export function detachStateVisualizer(instance: VoiceFormInstance): void {
  const el = document.getElementById('vf-dev-visualizer')
  if (el) el.remove()
  // The unsubscribe is handled by the detach closure; calling this without
  // the closure reference is a best-effort cleanup.
}
```

---

## 10. Package Exports and Build Configuration

### 10.1 packages/core/package.json — exports field

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./stt": {
      "import": "./dist/stt.mjs",
      "require": "./dist/stt.cjs",
      "types": "./dist/stt.d.ts"
    },
    "./ui": {
      "import": "./dist/ui.mjs",
      "require": "./dist/ui.cjs",
      "types": "./dist/ui.d.ts"
    },
    "./adapters/whisper": {
      "import": "./dist/adapters/whisper.mjs",
      "require": "./dist/adapters/whisper.cjs",
      "types": "./dist/adapters/whisper.d.ts"
    },
    "./detect-schema": {
      "import": "./dist/detect-schema.mjs",
      "require": "./dist/detect-schema.cjs",
      "types": "./dist/detect-schema.d.ts"
    }
  }
}
```

### 10.2 Bundle size targets

| Package / subpath | Target (min+gz) |
|---|---|
| `@voiceform/core` (headless) | ≤ 5.5 KB (v1 baseline + ~0.5 KB) |
| `@voiceform/core/ui` | ≤ 11 KB combined with core |
| `@voiceform/core/adapters/whisper` | ≤ 3 KB |
| `@voiceform/core/detect-schema` | ≤ 2 KB |
| `@voiceform/react` | ≤ 4 KB (React external) |
| `@voiceform/dev` | No production budget — devDependency only |

### 10.3 Security review cross-reference

| Review item | Section implementing it |
|---|---|
| #1 ConfirmationData immutable mutation | 1.2, 2.2, 4.4 |
| #2 subscribe/getSnapshot stable refs | 8.3 |
| #3 aborted flag before recorder.stop() | 5.6 |
| #4 Cross-session Blob cleanup | 5.4 |
| #5 Transcript response validation | 5.7 |
| #6 Label text truncation 100 chars | 6.3 |
| #7 textContent only in state visualizer | 9.6 |
| #8 Logging middleware callback chaining | 9.5, 8.4 |
| #9 React onChange documentation | 3.5 |
| #10 detectSchema in useEffect | 4.8 |
| #11 Dynamic import for detect-schema | 4.1, 4.2 |
