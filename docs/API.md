# API Reference

Complete documentation of the voice-form public API. All types and functions exported from `@voiceform/core` are documented here.

## Table of Contents

1. [Core Factory](#core-factory)
2. [Configuration](#configuration)
3. [Instance Methods](#instance-methods)
4. [Form Schema](#form-schema)
5. [State and Events](#state-and-events)
6. [Confirmation Data](#confirmation-data)
7. [STT Adapters](#stt-adapters)
8. [BYOE Contract](#byoe-contract)
9. [Error Codes](#error-codes)
10. [CSS Custom Properties](#css-custom-properties)
11. [UI Customization](#ui-customization)
12. [Strings (i18n)](#strings-i18n)
13. [Server Utilities](#server-utilities)

---

## Core Factory

### `createVoiceForm(config): VoiceFormInstance`

Creates and returns a voice-form instance synchronously.

**Parameters:**

- `config` — `VoiceFormConfig` object (see [Configuration](#configuration) below)

**Returns:**

A `Promise` that resolves to a `VoiceFormInstance`. The promise rejects with `VoiceFormConfigError` if configuration is invalid.

**Throws:**

- `VoiceFormConfigError` (code: `SCHEMA_INVALID`) — Schema validation failed
- `VoiceFormConfigError` (code: `INIT_FAILED`) — Configuration is missing required fields or conflicting

**Example:**

```ts
import { createVoiceForm } from '@voiceform/core'

const instance = await createVoiceForm({
  endpoint: '/api/voice-parse',
  schema: { fields: [...] },
})
```

---

## Configuration

### `VoiceFormConfig`

Complete configuration object passed to `createVoiceForm()`.

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `endpoint` | `string` | URL of your backend endpoint. voice-form POSTs a `ParseRequest` and expects a `ParseResponse`. May be absolute or relative. |
| `schema` | `FormSchema` | The form definition. See [Form Schema](#form-schema). |

**Optional fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sttAdapter` | `STTAdapter` | Web Speech API | Custom speech-to-text adapter. See [STT Adapters](#stt-adapters). |
| `formElement` | `HTMLElement \| string` | `document` | Form element or CSS selector for injection scoping. |
| `mountTarget` | `HTMLElement \| string` | Auto-placed | Container to render the mic button into. Ignored if `headless: true`. |
| `headless` | `boolean` | `false` | When true, no default UI is rendered. You control the flow via callbacks and methods. |
| `requestCooldownMs` | `number` | `3000` | Minimum milliseconds between endpoint requests. Set to `0` to disable. |
| `privacyNotice` | `string` | None | Text to display before requesting mic permission. Recommended for regulated applications. |
| `requirePrivacyAcknowledgement` | `boolean` | `false` | If true, user must explicitly acknowledge the privacy notice before mic access is requested. |
| `maxTranscriptLength` | `number` | `2000` | Maximum transcript characters. Longer transcripts are rejected before sending to the endpoint. |
| `endpointOptions` | `EndpointOptions` | See below | Advanced endpoint configuration (timeout, retries, headers). |
| `ui` | `UIOptions` | See below | UI customization (colors, labels, aria-labels). |
| `events` | `VoiceFormEvents` | None | Developer callbacks for state changes, errors, and completion. |
| `debug` | `boolean` | `false` | When true, logs verbose output to console. Include debug transcripts and field values. **Disable in production.** |

### `EndpointOptions`

Advanced options for the fetch-based endpoint client.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeoutMs` | `number` | `10000` | Request timeout in milliseconds. Set to `0` for no timeout. |
| `retries` | `number` | `1` | Number of retry attempts on network error or 5xx response. |
| `headers` | `Record<string, string>` | `{}` | Additional headers merged into every request. Use for auth tokens or custom identification. |

**Example:**

```ts
createVoiceForm({
  endpoint: '/api/voice-parse',
  schema: { ... },
  endpointOptions: {
    timeoutMs: 15000,
    retries: 3,
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Custom-Header': 'value',
    },
  },
})
```

### `UIOptions`

UI customization for the default mic button and confirmation panel.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cssVars` | `Partial<VoiceFormCSSVars>` | `{}` | CSS custom properties. See [CSS Custom Properties](#css-custom-properties). |
| `micButtonLabel` | `string` | `"Start voice input"` | aria-label for the mic button. |
| `confirmButtonLabel` | `string` | `"Confirm"` | Label for the confirm button. |
| `cancelButtonLabel` | `string` | `"Cancel"` | Label for the cancel button. |

**Example:**

```ts
createVoiceForm({
  ui: {
    micButtonLabel: 'Speak to fill form',
    cssVars: {
      '--vf-primary': '#6366f1',
      '--vf-font-family': 'system-ui, sans-serif',
    },
  },
})
```

---

## Instance Methods

### `VoiceFormInstance`

The object returned by `createVoiceForm()`. Use it to control the voice input flow and receive updates.

#### `getState(): VoiceFormState`

Returns the current state of the voice-form instance.

**Returns:** A `VoiceFormState` discriminated union. See [State and Events](#state-and-events).

**Example:**

```ts
const state = instance.getState()
if (state.status === 'recording') {
  console.log('Interim transcript:', state.interimTranscript)
}
```

#### `getParsedFields(): Record<string, ConfirmedField> | null`

Returns the parsed field values if currently in `confirming` or `injecting` state; otherwise `null`.

**Returns:** Object of field values keyed by field name, or `null` if not in confirmation phase.

**Example:**

```ts
const fields = instance.getParsedFields()
if (fields) {
  console.log('Parsed email:', fields.email.value)
}
```

#### `start(): Promise<void>`

Begin a recording session. Valid only from `idle` state.

**Throws:**

- `VoiceFormError` (code: `INVALID_TRANSITION`) — Not in idle state
- `VoiceFormError` (code: `PRIVACY_NOT_ACKNOWLEDGED`) — Privacy acknowledgement required but not given
- `VoiceFormError` (code: `COOLDOWN_ACTIVE`) — Request cooldown still active
- `VoiceFormError` (code: `STT_NOT_SUPPORTED`) — Browser does not support Web Speech API
- `VoiceFormError` (code: `PERMISSION_DENIED`) — User denied microphone access

**Example:**

```ts
button.addEventListener('click', async () => {
  try {
    await instance.start()
  } catch (error) {
    console.error('Failed to start:', error.message)
  }
})
```

#### `stop(): void`

Stop the current recording session gracefully. The STT adapter produces a final transcript with whatever audio was captured. Returns to `idle` state.

No-op if not in `recording` state.

**Example:**

```ts
instance.stop()
```

#### `cancel(): void`

Cancel the current session. Valid from `recording`, `processing`, and `confirming` states. Returns to `idle`.

The `onCancel` callback is invoked.

**Example:**

```ts
cancelButton.addEventListener('click', () => {
  instance.cancel()
})
```

#### `confirm(): Promise<void>`

Confirm the parsed values and begin injection. Valid only from `confirming` state.

**Throws:**

- `VoiceFormError` (code: `INVALID_TRANSITION`) — Not in confirming state
- `VoiceFormError` (code: `INJECTION_FAILED`) — DOM injection encountered an error

**Example:**

```ts
confirmButton.addEventListener('click', async () => {
  await instance.confirm()
})
```

#### `updateSchema(schema): void`

Programmatically update the form schema. Valid only from `idle` state. Useful for dynamic forms that change fields at runtime.

**Parameters:**

- `schema` — `FormSchema` object with new field definitions

**Throws:**

- `VoiceFormError` (code: `INVALID_TRANSITION`) — Not in idle state
- `VoiceFormError` (code: `SCHEMA_INVALID`) — New schema fails validation

**Example:**

```ts
// User selects "Business" mode; add business-specific fields
instance.updateSchema({
  fields: [
    { name: 'companyName', label: 'Company Name', type: 'text', required: true },
    ...originalFields,
  ],
})
```

#### `destroy(): void`

Remove all DOM elements created by voice-form, release all resources (listeners, timers, STT connections), and invalidate the instance.

All subsequent method calls throw `VoiceFormError(DESTROYED)`.

**Must be called when:**

- Unmounting the component
- Page navigation
- Manually cleaning up to prevent memory leaks

**Example:**

```ts
onDestroy(() => {
  instance.destroy()
})
```

#### `subscribe(listener): Unsubscribe`

Subscribe to all state transitions. The listener is called with the new state on every change.

**Parameters:**

- `listener` — Function `(state: VoiceFormState) => void`

**Returns:** Unsubscribe function. Call it to remove the listener.

**Example:**

```ts
const unsubscribe = instance.subscribe((state) => {
  console.log('New state:', state.status)
})

// Later, clean up
unsubscribe()
```

---

## Form Schema

### `FormSchema`

The complete form definition. Describes every field voice-form is allowed to fill.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `formName` | `string` | No | Human-readable form name for LLM context. Example: `"Shipping Address"`. |
| `formDescription` | `string` | No | Description of the form's purpose. Included in the LLM system prompt for domain context. |
| `fields` | `FieldSchema[]` | **Yes** | Array of field definitions. Must contain at least one field. |

**Example:**

```ts
const schema: FormSchema = {
  formName: 'Medical Intake',
  formDescription: 'Patient information and medical history',
  fields: [
    { name: 'patientName', label: 'Full Name', type: 'text', required: true },
    { name: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
    { name: 'primaryConcern', label: 'Chief Complaint', type: 'textarea' },
  ],
}
```

### `FieldSchema`

A single form field that voice-form can fill.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **Yes** | Unique field identifier. Must match the DOM element's `name` attribute, `id`, or `data-voiceform` attribute. No whitespace. |
| `label` | `string` | No | Human-readable label sent to the LLM. Defaults to `name` if omitted. |
| `type` | `FieldType` | **Yes** | Input type: `text`, `email`, `tel`, `number`, `date`, `select`, `checkbox`, `radio`, or `textarea`. |
| `description` | `string` | No | Plain-language description of the field's purpose. Included in the LLM prompt. Use for ambiguous fields. **Note:** Visible to users in the Network tab. Do not include internal metadata. |
| `options` | `string[]` | Conditional | **Required** if `type` is `select` or `radio`. List of valid values the LLM must choose from. |
| `required` | `boolean` | No | If true, the confirmation UI warns when the LLM cannot extract a value. Default: `false`. |
| `validation` | `FieldValidation` | No | Constraints applied after LLM parsing. See below. |

### `FieldType`

Valid input types:

- `text` — Single-line text input
- `email` — Email address input
- `tel` — Telephone number input
- `number` — Numeric input
- `date` — Date input (ISO 8601 format: `YYYY-MM-DD`)
- `select` — Dropdown or combobox (`options` required)
- `radio` — Radio button group (`options` required)
- `checkbox` — Boolean checkbox
- `textarea` — Multi-line text input

### `FieldValidation`

Constraints applied after LLM parsing, before display and injection. Violations are flagged in the confirmation UI but do not block injection.

| Field | Type | Description |
|-------|------|-------------|
| `minLength` | `number` | Minimum character length for text fields. |
| `maxLength` | `number` | Maximum character length for text fields. |
| `min` | `number` | Minimum value for number fields. |
| `max` | `number` | Maximum value for number fields. |
| `pattern` | `string` | Regex pattern (as string) that the value must match. Applied as `new RegExp(pattern).test(value)`. |

**Example:**

```ts
const schema: FormSchema = {
  fields: [
    {
      name: 'age',
      label: 'Age',
      type: 'number',
      validation: {
        min: 18,
        max: 120,
      },
    },
    {
      name: 'zipCode',
      label: 'ZIP Code',
      type: 'text',
      validation: {
        pattern: '^\\d{5}(-\\d{4})?$', // USA ZIP
        minLength: 5,
        maxLength: 10,
      },
    },
  ],
}
```

---

## State and Events

### `VoiceFormState`

Discriminated union describing the current state. Narrow on `status` to access state-specific fields.

| Status | Fields | Description |
|--------|--------|-------------|
| `idle` | — | No recording in progress. Ready to start. |
| `recording` | `interimTranscript: string` | Microphone is active. Interim transcript as user speaks. |
| `processing` | `transcript: string` | STT complete. Endpoint is being called. |
| `confirming` | `transcript: string`, `confirmation: ConfirmationData` | Awaiting user confirmation of parsed values. |
| `injecting` | `confirmation: ConfirmationData` | Fields are being injected into the DOM. |
| `done` | `result: InjectionResult` | All fields injected. Session complete. |
| `error` | `error: VoiceFormError`, `previousStatus: VoiceFormStatus` | An error occurred. May be recoverable. |

**Example:**

```ts
instance.subscribe((state) => {
  switch (state.status) {
    case 'idle':
      updateUI('ready')
      break
    case 'recording':
      updateUI('listening', state.interimTranscript)
      break
    case 'confirming':
      showConfirmationPanel(state.confirmation)
      break
    case 'done':
      handleSuccess(state.result)
      break
    case 'error':
      handleError(state.error)
      break
  }
})
```

### `VoiceFormEvent`

Internal events dispatched by the state machine. Exported for testing and headless implementations.

| Type | Payload | Description |
|------|---------|-------------|
| `START` | — | User requested recording start. |
| `STT_INTERIM` | `transcript: string` | Interim STT result. |
| `STT_FINAL` | `transcript: string` | Final STT result. |
| `STT_ERROR` | `error: STTError` | STT adapter error. |
| `PARSE_SUCCESS` | `response: ParseResponse`, `confirmation: ConfirmationData` | Endpoint returned field values. |
| `PARSE_ERROR` | `error: VoiceFormError` | Endpoint call failed. |
| `CONFIRM` | — | User confirmed values. |
| `CANCEL` | — | User cancelled. |
| `INJECTION_COMPLETE` | `result: InjectionResult` | DOM injection complete. |
| `ACKNOWLEDGE_ERROR` | — | User acknowledged error (in error UI). |
| `AUTO_RESET` | — | Recoverable error auto-resets to idle. |

### `VoiceFormEvents`

Developer-facing callbacks. All optional.

| Callback | Parameters | Description |
|----------|-----------|-------------|
| `onStateChange` | `(state: VoiceFormState) => void` | Called on every state transition. |
| `onInterimTranscript` | `(transcript: string) => void` | Raw STT interim result. **Not sanitized.** If rendered, use `textContent` only. |
| `onBeforeConfirm` | `(data: ConfirmationData) => ConfirmationData \| void` | Called before confirmation UI appears. Return modified `ConfirmationData` to augment or filter. Values are re-sanitized. |
| `onDone` | `(result: InjectionResult) => void` | All fields injected. Use for form submission, analytics, or notifications. |
| `onCancel` | `() => void` | User cancelled from any cancellable state. |
| `onError` | `(error: VoiceFormError) => void` | An error occurred. |

**Example:**

```ts
createVoiceForm({
  events: {
    onStateChange: (state) => {
      if (state.status === 'recording') {
        startAnimation()
      }
    },
    onBeforeConfirm: (data) => {
      // Augment with computed fields or filter sensitive data
      return data
    },
    onDone: (result) => {
      if (result.success) {
        showSuccessMessage()
        form.submit()
      }
    },
    onError: (error) => {
      if (error.recoverable) {
        // Automatic retry happened
      } else {
        showFatalError(error.message)
      }
    },
  },
})
```

---

## Confirmation Data

### `ConfirmationData`

Data presented to the user in the confirmation step. The default UI renders this; headless mode receives it via `onBeforeConfirm` callback.

| Field | Type | Description |
|-------|------|-------------|
| `transcript` | `string` | Raw transcript from STT. Shown so user can verify what was heard. |
| `parsedFields` | `Record<string, ConfirmedField>` | Fields the LLM successfully parsed, keyed by field name. |
| `missingFields` | `string[]` | Field names the LLM could not extract values for. If any are `required: true`, a warning is shown. |
| `invalidFields` | `{ name: string; value: string; reason: string }[]` | Fields where the value failed a validation constraint. Still injectable; advisory only. |

### `ConfirmedField`

A single confirmed field value ready for injection.

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` | Field label from schema (or name if label was omitted). |
| `value` | `string` | The value the LLM extracted. Sanitized. |
| `confidence` | `number` | Optional confidence score from the LLM (0–1). |

**Example:**

```ts
const data: ConfirmationData = {
  transcript: 'John Smith, john at example dot com',
  parsedFields: {
    fullName: { label: 'Full Name', value: 'John Smith' },
    email: { label: 'Email', value: 'john@example.com', confidence: 0.98 },
  },
  missingFields: [],
  invalidFields: [],
}
```

---

## STT Adapters

### `STTAdapter`

Interface for custom speech-to-text implementations. voice-form ships with a Web Speech API adapter; you can provide your own (e.g., Whisper, AssemblyAI, Deepgram).

```ts
interface STTAdapter {
  isSupported(): boolean
  start(events: STTAdapterEvents): Promise<void>
  stop(): void
  abort(): void
}
```

#### `isSupported(): boolean`

Returns true if this adapter can operate in the current environment.

**Example:**

```ts
const whisperAdapter: STTAdapter = {
  isSupported() {
    return !navigator.mediaDevices // Requires MediaRecorder fallback
  },
  async start(events) { ... },
  stop() { ... },
  abort() { ... },
}
```

#### `start(events): Promise<void>`

Begin listening. Must call the provided event handlers as audio is processed. Resolves immediately after the session has started (does not wait for speech).

**Parameters:**

- `events: STTAdapterEvents` — Object with `onInterim`, `onFinal`, `onError`, and `onEnd` callbacks

**Throws:** `STTError` if the adapter fails to start.

#### `stop(): void`

Stop listening gracefully. Must call `events.onFinal` with the accumulated transcript, then `events.onEnd`. If nothing was heard, call `onFinal` with an empty string.

#### `abort(): void`

Cancel the recording session immediately without producing a transcript. Must call `events.onEnd`. Must NOT call `events.onFinal`.

### `STTAdapterEvents`

Callbacks the adapter must invoke to drive the state machine.

```ts
interface STTAdapterEvents {
  onInterim(transcript: string): void
  onFinal(transcript: string): void
  onError(error: STTError): void
  onEnd(): void
}
```

### `STTError`

Error thrown by an STT adapter.

| Field | Type | Description |
|-------|------|-------------|
| `code` | `STTErrorCode` | Machine-readable error type. |
| `message` | `string` | Human-readable description. |
| `originalError` | `unknown` | Optional underlying error object. |

### `STTErrorCode`

All possible STT error codes:

- `NOT_SUPPORTED` — Browser does not support this adapter
- `PERMISSION_DENIED` — User denied microphone access
- `NETWORK_ERROR` — Network error during streaming STT
- `NO_SPEECH` — Timeout with no audio detected
- `AUDIO_CAPTURE_FAILED` — Microphone hardware error
- `ABORTED` — Deliberately aborted (internal use)
- `UNKNOWN` — Unknown error

**Example:**

```ts
createVoiceForm({
  sttAdapter: customAdapter,
  events: {
    onError: (error) => {
      if (error.code === 'PERMISSION_DENIED') {
        showMicPermissionGuide()
      } else if (error.code === 'NO_SPEECH') {
        showRetryPrompt('No audio detected. Please try again.')
      }
    },
  },
})
```

### `createWebSpeechAdapter(): STTAdapter`

Factory function for the built-in Web Speech API adapter.

**Returns:** A configured `STTAdapter` instance.

**Example:**

```ts
import { createWebSpeechAdapter } from '@voiceform/core'

const webSpeechAdapter = createWebSpeechAdapter()
createVoiceForm({
  sttAdapter: webSpeechAdapter,
  // ...
})
```

---

## BYOE Contract

### `ParseRequest`

The request body sent to your backend endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `transcript` | `string` | Final transcript from the STT adapter. Example: `"John Smith, john at example dot com"` |
| `schema` | `FormSchema` | The form schema at the time of the request. Included so your handler doesn't maintain a separate copy. |
| `requestId` | `string` | Unique UUID v4 for this request. Useful for logging and idempotency checks. |

**Example request body:**

```json
{
  "transcript": "John Smith, john at example dot com, 555-1234",
  "schema": {
    "formName": "Contact Form",
    "fields": [
      { "name": "fullName", "label": "Full Name", "type": "text", "required": true },
      { "name": "email", "label": "Email", "type": "email", "required": true },
      { "name": "phone", "label": "Phone", "type": "tel" }
    ]
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### `ParseResponse`

The response your endpoint must return (as JSON).

| Field | Type | Description |
|-------|------|-------------|
| `fields` | `Record<string, ParsedFieldValue>` | Parsed values keyed by field name. Omit a field if the LLM could not extract a value (do not set to `null` or empty string). |
| `rawResponse` | `string` | Optional. Raw text generated by the LLM for debugging. voice-form does not use this; it appears in dev-console output. |

### `ParsedFieldValue`

A single parsed field value from the LLM.

| Field | Type | Description |
|-------|------|-------------|
| `value` | `string` | The extracted value. |
| `confidence` | `number` | Optional. LLM confidence score (0–1). Displayed in the confirmation UI if provided. |

**Example response:**

```json
{
  "fields": {
    "fullName": { "value": "John Smith", "confidence": 0.99 },
    "email": { "value": "john@example.com", "confidence": 0.98 },
    "phone": { "value": "555-1234", "confidence": 0.85 }
  },
  "rawResponse": "The LLM extracted: John Smith (john@example.com) as the contact, with phone 555-1234."
}
```

---

## Error Codes

### `VoiceFormErrorCode`

All error codes the voice-form engine can produce:

**STT Errors:**

- `STT_NOT_SUPPORTED` — Browser does not support Web Speech API
- `PERMISSION_DENIED` — User denied microphone access

**Transcript Errors:**

- `NO_TRANSCRIPT` — STT produced empty transcript
- `TRANSCRIPT_TOO_LONG` — Transcript exceeds `maxTranscriptLength`
- `INVALID_TRANSCRIPT` — Transcript failed validation

**Endpoint/Parse Errors:**

- `ENDPOINT_ERROR` — HTTP error from your endpoint (4xx or 5xx)
- `ENDPOINT_TIMEOUT` — Request to your endpoint timed out
- `PARSE_FAILED` — Your endpoint returned invalid JSON or response shape
- `INVALID_RESPONSE` — Response shape does not match `ParseResponse` contract

**Injection Errors:**

- `INJECTION_FAILED` — DOM injection encountered a critical error
- `INVALID_FIELD_VALUE` — Parsed value failed a critical validation constraint

**Privacy/UX Errors:**

- `PRIVACY_NOT_ACKNOWLEDGED` — User must acknowledge privacy notice before recording
- `COOLDOWN_ACTIVE` — Request cooldown still active; user must wait

**Callback Errors:**

- `BEFORE_CONFIRM_FAILED` — `onBeforeConfirm` callback threw

**Lifecycle Errors:**

- `SCHEMA_INVALID` — Schema validation failed at init or `updateSchema()`
- `INIT_FAILED` — Initialization failed (missing required config)
- `INVALID_TRANSITION` — State machine received invalid event for current state
- `DESTROYED` — Instance was destroyed; cannot use

**Catch-all:**

- `UNKNOWN` — Unknown error

### `VoiceFormError`

Error object passed to `onError` callback or thrown by instance methods.

| Field | Type | Description |
|-------|------|-------------|
| `code` | `VoiceFormErrorCode` | Machine-readable error type. |
| `message` | `string` | Human-readable description. |
| `recoverable` | `boolean` | If true, engine auto-resets to idle after `errorResetMs`. If false, `destroy()` and reinitialize required. |
| `debugInfo` | `{ httpStatus?: number; rawBody?: string; timestamp: number }` | Additional debug info when `debug: true`. HTTP status and response body truncated to 500 chars. |

**Example:**

```ts
events: {
  onError: (error) => {
    console.log(`[${error.code}] ${error.message}`)

    if (!error.recoverable) {
      console.error('Fatal error. Reinitialize required.')
      instance.destroy()
      // Re-create instance
    }

    if (error.debugInfo?.httpStatus === 401) {
      console.error('Endpoint returned 401. Check authentication.')
    }
  },
}
```

---

## CSS Custom Properties

All supported CSS custom properties (CSS variables) for theming the default UI.

| Property | Default | Description |
|----------|---------|-------------|
| `--vf-primary` | `#2563eb` (blue) | Mic button background color. |
| `--vf-primary-hover` | `#1d4ed8` (darker blue) | Mic button hover color. |
| `--vf-danger` | `#dc2626` (red) | Error and danger accent color. |
| `--vf-surface` | `#ffffff` (white) | Background color for panels and overlays. |
| `--vf-on-surface` | `#111827` (nearly black) | Text color on surface backgrounds. |
| `--vf-border-radius` | `50%` | Border radius for buttons and panels. Override to `4px` for square buttons. |
| `--vf-font-family` | `inherit` | Font family for all text. Default inherits from page. |
| `--vf-z-index` | `100` | z-index for overlay elements. Adjust if the confirmation panel sits behind other modals. |

**Example:**

```html
<div id="voice-form-container" style="
  --vf-primary: #6366f1;
  --vf-primary-hover: #4f46e5;
  --vf-danger: #ef4444;
  --vf-surface: #f8f8f8;
  --vf-font-family: 'Inter', system-ui, sans-serif;
">
  <!-- Form and mic button render here -->
</div>
```

Or in CSS:

```css
#voice-form-container {
  --vf-primary: #6366f1;
  --vf-primary-hover: #4f46e5;
  --vf-font-family: 'Inter', system-ui, sans-serif;
}
```

---

## UI Customization

### Headless Mode

Pass `headless: true` to skip the default UI entirely. You control rendering via callbacks and state.

```ts
const instance = await createVoiceForm({
  headless: true,
  schema: { ... },
  events: {
    onStateChange: (state) => {
      // Render your own UI based on state
      if (state.status === 'recording') {
        renderRecordingUI(state.interimTranscript)
      } else if (state.status === 'confirming') {
        renderConfirmationUI(state.confirmation)
      }
    },
  },
})

// You call methods
myMicButton.addEventListener('click', () => instance.start())
myConfirmButton.addEventListener('click', () => instance.confirm())
```

### Custom UI with Default Styles

To render custom HTML while keeping the default styling, import the CSS separately:

```ts
import '@voiceform/core/ui' // Default styles
```

Then render your own elements and call the instance methods.

---

## Strings (i18n)

### `VoiceFormStrings`

All user-facing strings rendered by voice-form. Override via the `strings` option in `VoiceFormConfig`.

deep-merges with English defaults, so you only need to override specific strings.

#### Button Labels

```ts
strings: {
  buttonLabel: {
    idle: 'Use voice input',
    recording: 'Stop recording',
    processing: 'Processing speech',
    done: 'Voice input complete',
    error: 'Voice input error',
    unsupported: 'Voice input not available',
    cooldown: 'Voice input cooling down',
  },
}
```

#### Status Messages

```ts
strings: {
  status: {
    listening: 'Listening…',
    processing: 'Processing…',
    done: 'Form filled',
    unsupported: 'Your browser does not support voice input',
  },
}
```

#### Error Messages

```ts
strings: {
  errors: {
    permissionDenied: 'Microphone permission denied',
    noSpeech: 'No speech detected. Please try again.',
    endpointError: 'Could not process your input',
    parseError: 'Form parsing failed',
    transcriptTooLong: 'Your message was too long',
    retryLabel: 'Try again',
    rerecordLabel: 'Re-record',
    permissionHelp: 'How to enable microphone access',
  },
}
```

#### Confirmation Panel

```ts
strings: {
  confirm: {
    title: 'What I heard',
    description: 'Confirmation of parsed form values',
    cancelLabel: 'Cancel',
    fillLabel: 'Fill form',
    fillLabelEdited: 'Fill form (edited)',
    unrecognizedLabel: 'Not understood',
    sanitizedAriaLabel: 'This value was sanitized',
  },
}
```

#### Privacy Notice

```ts
strings: {
  privacy: {
    acknowledgeLabel: 'I understand',
    regionAriaLabel: 'Privacy notice',
  },
}
```

#### Announcements (Screen Reader)

```ts
strings: {
  announcements: {
    listening: 'Microphone is listening',
    processing: 'Processing your input',
    confirming: (count) => `Confirmation panel with ${count} field${count === 1 ? '' : 's'}`,
    filled: (count) => `Form filled with ${count} value${count === 1 ? '' : 's'}`,
    cancelled: 'Voice input cancelled',
    errorPermission: 'Microphone permission denied',
    errorNoSpeech: 'No speech detected',
    errorEndpoint: 'Could not reach the server',
    errorTranscriptTooLong: 'Your message was too long',
  },
}
```

**Full example:**

```ts
createVoiceForm({
  strings: {
    buttonLabel: {
      idle: 'Parla per riempire il modulo', // Italian
    },
    status: {
      listening: 'In ascolto…',
    },
    confirm: {
      title: 'Quello che ho sentito',
    },
  },
})
```

---

## Server Utilities

### `@voiceform/server-utils`

Node.js-only package for building LLM prompts. Never import this in browser code.

#### `buildSystemPrompt(schema): string`

Builds the system prompt for the LLM based on the form schema.

**Parameters:**

- `schema` — `FormSchema` object

**Returns:** System prompt string ready to pass to your LLM's `system` role message.

**Includes:**

- Task definition (form-filling assistant)
- Prompt injection mitigation instruction
- Form metadata (name, description)
- Field definitions (name, label, type, options, constraints)
- Output format rules (JSON structure)

**Example:**

```ts
import { buildSystemPrompt } from '@voiceform/server-utils'

const systemPrompt = buildSystemPrompt(schema)
console.log(systemPrompt)
// You are a form-filling assistant...
// Fields:
// - name: "fullName" | label: "Full Name" | type: text | required: true
// ...
```

#### `buildUserPrompt(transcript): string`

Builds the user prompt containing the transcript.

**Parameters:**

- `transcript` — The raw transcript from the STT adapter (string)

**Returns:** User prompt string ready to pass to your LLM's `user` role message.

**Security:** The transcript is JSON-escaped to prevent prompt injection.

**Example:**

```ts
import { buildUserPrompt } from '@voiceform/server-utils'

const userPrompt = buildUserPrompt('John Smith, john at example dot com')
console.log(userPrompt)
// Speech to extract values from: "John Smith, john at example dot com"
// Extract the field values now.
```

**Full LLM call example:**

```ts
import { buildSystemPrompt, buildUserPrompt } from '@voiceform/server-utils'
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function parseVoice(req) {
  const { transcript, schema } = req.body

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildSystemPrompt(schema) },
      { role: 'user', content: buildUserPrompt(transcript) },
    ],
    temperature: 0,
  })

  const jsonStr = response.choices[0].message.content
  const parsed = JSON.parse(jsonStr)

  return {
    fields: parsed.fields,
    rawResponse: jsonStr,
  }
}
```

---

## Framework Wrappers

### `@voiceform/svelte`

Svelte wrapper (not yet published; coming in v0.2).

### `@voiceform/react`

React wrapper (not yet published; coming in v0.2).

---

## Validation

### `validateSchema(schema): ValidationResult`

Validates a form schema at runtime. Useful for debugging dynamic schemas.

**Parameters:**

- `schema` — `FormSchema` object to validate

**Returns:** `ValidationResult` object with `valid` boolean and `errors` string array.

**Example:**

```ts
import { validateSchema } from '@voiceform/core'

const result = validateSchema({
  fields: [
    { name: 'email', type: 'email' },
    { name: 'role', type: 'select' }, // ERROR: select requires options
  ],
})

if (!result.valid) {
  console.error(result.errors)
  // ["Field 'role' type select requires options property"]
}
```

---

## Version

### `VERSION`

Exported constant containing the current version string.

```ts
import { VERSION } from '@voiceform/core'
console.log(VERSION) // e.g., "0.1.0"
```
