# Business Requirements Document: voice-form

**Project**: voice-form
**Document Version**: 1.1
**Date**: 2026-04-01
**Status**: Draft

---

## 1. Executive Summary

voice-form is an open-source, drop-in voice-to-form component for web applications. A developer adds a microphone button to any form; the user speaks naturally; an LLM (hosted by the developer) parses the speech against a known schema; and the form fields are filled — with confirmation before commit.

The library ships as a monorepo of focused packages:

- `@voiceform/core` — vanilla TypeScript, zero runtime dependencies, framework-agnostic
- `@voiceform/svelte` — thin Svelte wrapper (v1)
- `@voiceform/react` — thin React wrapper (v2)
- `@voiceform/dev` — developer tooling and debugging utilities (v2)

The architecture is "Bring Your Own Endpoint" (BYOE). The library never calls an LLM directly from the browser. The developer adds one API route to their existing application. API keys remain server-side by default and the library has no hosted infrastructure.

---

## 2. Scope and Release Boundaries

### v1 Scope

- `@voiceform/core` package with full lifecycle
- `@voiceform/svelte` wrapper
- Web Speech API adapter (browser-native STT)
- Explicit schema configuration (developer-defined)
- BYOE endpoint contract
- Confirmation UX step before field injection
- Error states and recovery flows
- Demo site with SvelteKit reference implementation
- CDN distribution via single-file build

### v2 Scope

- `@voiceform/react` wrapper
- Whisper STT adapter (replaces or augments Web Speech API)
- Partial fill and append mode
- Multi-step form support
- DOM schema auto-detection algorithm
- Field-level correction UX
- `@voiceform/dev` package for debugging and schema inspection

---

## 3. Definitions

| Term | Definition |
|---|---|
| Schema | A developer-supplied data structure describing the form's fields, their types, and constraints |
| Transcript | The raw text output from the STT provider |
| Endpoint | A developer-owned HTTP route that receives `{ transcript, schema }` and returns `{ fields }` |
| Injection | The act of programmatically setting a form field value and dispatching synthetic events |
| Confirmation step | A UI state where the user reviews parsed field values before they are injected into the form |
| BYOE | Bring Your Own Endpoint — the pattern where the developer hosts the LLM proxy route |
| STT | Speech-to-Text |
| Adapter | A pluggable interface implementation for a specific STT provider |

---

## 4. Stakeholders

| Role | Responsibility |
|---|---|
| Developer (integrator) | Adds the component to their app, defines the schema, implements the endpoint |
| End user | Speaks into the microphone, reviews the confirmation step, submits the form |
| Maintainers | Accept contributions, publish packages, manage the roadmap |

---

## 5. Functional Requirements — v1

### 5.1 STT Capture and Transcription

**FR-001 — Microphone activation**
The component MUST expose a single activation control (button or programmatic trigger) that requests microphone permission via the browser's `getUserMedia` or Web Speech API on first use.

Acceptance criteria:
- Activating the control transitions the recording state from `idle` to `recording`.
- If microphone permission has not been granted, the browser's native permission prompt is shown.
- If permission is denied, the state transitions to `error` with error code `MIC_PERMISSION_DENIED`.
- The control does not capture audio in any state other than `recording`.

---

**FR-002 — Web Speech API adapter**
The default STT provider MUST be the browser's Web Speech API (`window.SpeechRecognition` or `window.webkitSpeechRecognition`).

Acceptance criteria:
- The adapter uses continuous recognition with `interimResults` enabled.
- Interim results MAY be surfaced to the developer via a callback but MUST NOT be sent to the endpoint.
- Only the final transcript from the session is sent to the endpoint.
- The adapter MUST call its `onError` handler if the Web Speech API fires an error event, passing through the browser's error code.

---

**FR-003 — Manual stop**
The user MUST be able to stop recording by activating the same control used to start, or by a configurable timeout.

Acceptance criteria:
- Activating the control while in `recording` state transitions to `processing`.
- A developer-configurable `maxDuration` option (default: 60 seconds) automatically stops recording and transitions to `processing` when elapsed.
- If no speech is detected and the session ends, the state transitions to `error` with error code `NO_TRANSCRIPT`.

---

**FR-004 — STT adapter interface**
The core library MUST define a TypeScript interface (`STTAdapter`) that any custom STT implementation can satisfy.

Acceptance criteria:
- The interface declares `start(): void`, `stop(): void`, and the event callbacks `onTranscript(transcript: string): void`, `onError(error: VoiceFormError): void`.
- The Web Speech API implementation is the concrete default.
- Passing a custom adapter object to the component replaces the default entirely.
- The interface is exported from `@voiceform/core`.

---

### 5.2 Schema Definition and Validation

**FR-005 — Explicit schema configuration**
The developer MUST provide a schema object to the component describing the fields to populate.

Acceptance criteria:
- The schema is passed as a required prop or configuration option.
- The schema type is exported from `@voiceform/core`.
- If no schema is provided, the component throws a descriptive error at initialization time, not at recording time.
- The schema is serialized and sent to the developer's endpoint on every request.

---

**FR-006 — Schema field descriptor**
Each field in the schema MUST support the following properties:

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Machine-readable field identifier, must match the form field's name or id |
| `label` | `string` | Yes | Human-readable label sent to the LLM for context |
| `type` | `"text" \| "number" \| "date" \| "boolean" \| "select"` | Yes | Expected value type |
| `options` | `string[]` | When type is `select` | Enumerated valid values |
| `required` | `boolean` | No | Whether the field must be filled |
| `description` | `string` | No | Additional context for the LLM |

Acceptance criteria:
- A schema with `type: "select"` and no `options` array throws a validation error at initialization.
- The TypeScript type for the schema is strict enough that the above constraints are enforced at compile time where possible.
- Unknown properties on a field descriptor are passed through to the endpoint unchanged (open extension point).

---

**FR-007 — Schema validation at initialization**
The component MUST validate the provided schema when it is first mounted or instantiated.

Acceptance criteria:
- Validation runs synchronously before any UI is rendered.
- A missing `name` or `label` on any field throws a `VoiceFormConfigError` with the field index included in the message.
- An invalid `type` value throws a `VoiceFormConfigError` naming the offending field and the invalid value.
- Validation errors are surfaced to the developer as thrown exceptions, not swallowed.

---

### 5.3 LLM Endpoint Contract

**FR-008 — Endpoint configuration**
The developer MUST provide the URL of their LLM proxy endpoint as a required configuration option (`endpointUrl`).

Acceptance criteria:
- If `endpointUrl` is omitted, the component throws a descriptive error at initialization.
- The URL MAY be absolute or relative.
- The component issues a `POST` request to this URL in `processing` state.

---

**FR-009 — Request format**
The component MUST send a JSON `POST` request to the developer's endpoint with the following body:

```json
{
  "transcript": "<string>",
  "schema": [
    {
      "name": "<string>",
      "label": "<string>",
      "type": "<string>",
      "options": ["<string>"],
      "required": true,
      "description": "<string>"
    }
  ]
}
```

Acceptance criteria:
- `Content-Type: application/json` header is set on every request.
- `transcript` is the raw final string from the STT adapter, untrimmed except for leading/trailing whitespace.
- `schema` is the full schema array as provided by the developer.
- No additional top-level keys are added by the library in v1.
- The developer MAY configure additional request headers via a `headers` option (e.g., for their own auth token).

---

**FR-010 — Response format**
The developer's endpoint MUST return a JSON response conforming to:

```json
{
  "fields": {
    "<fieldName>": "<value>"
  }
}
```

Acceptance criteria:
- The library treats any key in `fields` that matches a schema `name` as a parseable result.
- Keys in `fields` that do not match any schema field are ignored with a console warning (not an error).
- Field values are typed as `string | number | boolean | null`. A `null` value means the LLM could not determine a value for that field.
- If the response body is not valid JSON, the state transitions to `error` with code `ENDPOINT_INVALID_RESPONSE`.
- If the `fields` key is absent from a valid JSON response, the state transitions to `error` with code `ENDPOINT_INVALID_RESPONSE`.

---

**FR-011 — HTTP error handling**
The component MUST handle non-2xx HTTP responses from the endpoint gracefully.

Acceptance criteria:
- A `4xx` response transitions the state to `error` with code `ENDPOINT_CLIENT_ERROR` and includes the HTTP status code.
- A `5xx` response transitions the state to `error` with code `ENDPOINT_SERVER_ERROR` and includes the HTTP status code.
- A network failure (no response) transitions to `error` with code `ENDPOINT_UNREACHABLE`.
- All error transitions include the raw response body (as a string) in the error payload for developer debugging. Raw response bodies MUST be truncated to 500 characters before inclusion (see FR-029).

---

**FR-012 — Endpoint request timeout**
The component MUST abort the endpoint request if no response is received within a configurable timeout.

Acceptance criteria:
- Default timeout is 15 seconds.
- Developer configures via `endpointTimeout` option (number, milliseconds).
- On timeout, the state transitions to `error` with code `ENDPOINT_TIMEOUT`.
- The library uses `AbortController` to cancel the fetch.

---

**FR-013-SEC — No direct browser-to-LLM path**
The `llmAdapter` configuration option that would allow direct browser-to-LLM calls MUST NOT be present in v1. The only supported LLM integration path is the BYOE endpoint.

Rationale: any client-side LLM adapter requires an API key in the browser, which contradicts NFR-012 and the project's core security guarantee. The local/WASM model use case is deferred to a future release with a dedicated security model. Addresses CRIT-002.

Acceptance criteria:
- The `VoiceFormConfig` TypeScript interface does not include an `llmAdapter` property.
- The README and API documentation make no reference to a browser-side LLM adapter option.
- If a developer passes an `llmAdapter` key in the options object, it is silently ignored (no runtime error) but a console warning is emitted directing them to the BYOE pattern.

---

**FR-014 — CSRF mitigation header**
The endpoint client MUST send a custom request header on every POST to the developer's endpoint.

Rationale: same-site form submissions and cross-origin fetch requests from a browser cannot forge this header, providing a lightweight CSRF signal. Addresses HIGH-001.

Acceptance criteria:
- Every request to `endpointUrl` includes the header `X-VoiceForm-Request: 1`.
- This header is sent in addition to any developer-configured `headers`.
- Reference endpoint implementations MUST validate this header is present and return `400` if it is absent, with a comment explaining its purpose.
- Documentation explains that this header alone is not a substitute for CORS configuration and authentication on the endpoint.

---

**FR-015 — Transcript validation before send**
The component MUST validate the transcript before sending it to the endpoint. Addresses CRIT-003.

Acceptance criteria:
- Empty transcripts (empty string or whitespace only) are rejected: the state transitions to `error` with code `NO_TRANSCRIPT` rather than sending the request.
- Transcripts exceeding `transcriptMaxLength` characters (default: 2000) are rejected: the state transitions to `error` with code `TRANSCRIPT_TOO_LONG`.
- Transcripts containing null bytes (`\u0000`) or non-printable control characters (Unicode categories Cc excluding `\t`, `\n`, `\r`) are rejected: the state transitions to `error` with code `TRANSCRIPT_INVALID`.
- `transcriptMaxLength` is a developer-configurable option (number, default 2000).
- These validations run synchronously after the STT adapter fires its `onTranscript` callback and before any network activity.

---

**FR-016 — Privacy notice**
The library MUST support displaying a privacy disclosure before first microphone access. Addresses HIGH-003.

Acceptance criteria:
- A `privacyNotice` config option accepts an HTML string or a plain text string to display in a notice UI before mic permission is requested.
- A `requirePrivacyAcknowledgement` boolean option (default: `false`) gates microphone activation on the user explicitly accepting the notice. When `true`, the control does not activate until the user acknowledges the notice.
- When `requirePrivacyAcknowledgement` is `false`, the notice is displayed but mic access is not blocked by it.
- The notice is shown at most once per page session; acknowledgement is tracked in component memory only (never in `localStorage` or cookies — see NFR-013).
- The `privacyNotice` and `requirePrivacyAcknowledgement` options are documented in the API reference with a recommended template that discloses: (a) that audio is processed by a third-party STT service, and (b) how the transcript is used.

---

**FR-017 — Request cooldown**
A configurable cooldown period MUST prevent rapid re-activation of the recording flow. Addresses HIGH-004.

Acceptance criteria:
- A `requestCooldownMs` option (number, default: 3000) defines the minimum time between the end of one session (reaching `done` or `error`) and the next permitted `idle → recording` transition.
- This is enforced as a state machine guard: attempting to activate during the cooldown period leaves the state at `idle` and MAY surface a brief UI affordance (e.g., the button is visually disabled).
- Setting `requestCooldownMs` to `0` disables the cooldown entirely.
- The cooldown is independent of the `done`-state auto-reset delay (FR-019).

---

### 5.4 Form Value Injection

**FR-018 — Target form identification**
The component MUST know which form (or set of fields) to inject values into.

Acceptance criteria:
- The developer passes a reference to the form element or field elements via a `target` prop.
- Alternatively, the developer can pass a CSS selector string; the component resolves it at injection time, not at mount time.
- If the target resolves to zero elements at injection time, the state transitions to `error` with code `TARGET_NOT_FOUND`.

---

**FR-019 — Value injection mechanism**
The component MUST set field values in a way that is compatible with React controlled components, Svelte bindings, and Vue v-model.

Acceptance criteria:
- For `<input>` and `<textarea>` elements, the library uses the native input value setter: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)`.
- After setting the value, the library dispatches both an `input` event and a `change` event on the element, each created via `new Event('input', { bubbles: true })` and `new Event('change', { bubbles: true })`.
- For `<select>` elements, the same setter-and-dispatch pattern applies using `HTMLSelectElement.prototype`.
- For `<input type="checkbox">` or `<input type="radio">`, the library sets the `checked` property (not `value`) and dispatches `change`.
- For `<input type="date">`, the value is formatted as `YYYY-MM-DD` before injection regardless of the LLM's output format.
- Fields in the `fields` response with no matching DOM element are skipped with a console warning.
- All `querySelector` calls that use field `name` values to locate elements MUST pass the name through `CSS.escape()` before constructing the selector string (see FR-027).

---

**FR-020 — Output sanitization before injection**
All LLM-returned field values MUST be sanitized before any DOM operation or UI rendering. Addresses CRIT-001.

Acceptance criteria:
- A `stripHtml(value: string): string` utility is applied to every non-null value in the `fields` response immediately after response validation and before the `confirming` state is entered.
- `stripHtml` uses `DOMParser` to parse the value as `text/html` and returns `doc.body.textContent`. A fast-path short-circuit skips parsing when the value contains no `<` character.
- The confirmation panel MUST assign field values using `element.textContent`, never `element.innerHTML`.
- For `select` and `radio` type fields, the sanitized value MUST additionally be validated against the field's `options` array. If the value is not in the options list, the field is treated as unparsed (`null`) with a console warning.
- For `number` type fields, the sanitized value must match `/^-?\d+(\.\d+)?$/`; non-conforming values are treated as unparsed.
- For `date` type fields, the sanitized value must match `/^\d{4}-\d{2}-\d{2}$/`; non-conforming values are treated as unparsed.
- The sanitization step is a discrete, testable function in `packages/core/src/utils/sanitize.ts`, exported for use by reference implementations.

---

**FR-021 — Injection is deferred until confirmation**
The component MUST NOT inject any values into the form until the user explicitly confirms in the confirmation step.

Acceptance criteria:
- Receiving a valid response from the endpoint transitions the state to `confirming`, not directly to injection.
- Values are held in component memory during the `confirming` state.
- Only after the user confirms does the state transition to `injecting` and then `done`.
- If the user cancels at the confirmation step, the state transitions back to `idle` with no side effects on the form.

---

### 5.5 Confirmation UX Flow

**FR-022 — Confirmation display**
The component MUST display parsed field values to the user for review before committing them to the form.

Acceptance criteria:
- Each field with a non-null parsed value is shown with its `label` and the proposed value.
- Fields with a `null` value from the LLM are shown with a visual indicator that they were not parsed (e.g., "Not recognized").
- The confirmation UI includes a clear "Apply" or "Confirm" action and a "Cancel" or "Discard" action.
- The confirmation UI is accessible: all interactive elements have descriptive ARIA labels and are reachable by keyboard.

---

**FR-023 — Confirmation UI is customizable**
The developer MUST be able to replace the default confirmation UI with their own rendering.

Acceptance criteria:
- The component exposes a slot (Svelte) or render prop (React, v2) for the confirmation step.
- The slot/render prop receives the `fields` object from the endpoint response and the `confirm` and `cancel` callback functions.
- If no custom slot/render prop is provided, the built-in confirmation UI is used.

---

**FR-024 — Partial confirmation**
In v1, confirmation is all-or-nothing.

Acceptance criteria:
- The user cannot selectively confirm individual fields in v1.
- Confirming applies all non-null parsed values. Canceling applies none.
- This constraint is documented in the API reference as a v2 enhancement point.

---

### 5.6 Recording State Machine

**FR-025 — State machine definition**
The component MUST implement the following finite state machine:

```
idle → recording → processing → confirming → done
                              ↘ error
         ↓ (on error)
       error → idle (on retry or reset)
                              ↓ (on cancel)
                            idle
```

States:
- `idle` — initial state; no active session
- `recording` — microphone is active; STT is running
- `processing` — STT complete; HTTP request in flight to endpoint
- `confirming` — endpoint returned valid fields; awaiting user confirmation
- `injecting` — values are being written to DOM (transient, may be skipped in implementation if synchronous)
- `done` — values injected; session complete
- `error` — an unrecoverable error occurred in the current session

Acceptance criteria:
- The current state is exposed as a reactive value to the developer (via callback or store).
- No state transition occurs outside of the defined machine (i.e., cannot go from `idle` directly to `confirming`).
- The `done` state automatically transitions back to `idle` after a configurable delay (default: 2 seconds, 0 to disable).
- Calling a `reset()` method from any state transitions back to `idle` and clears all session data.
- The `idle → recording` transition is guarded by the request cooldown (FR-017).

---

**FR-026 — State change callback**
The component MUST notify the developer of state transitions.

Acceptance criteria:
- An `onStateChange(state: VoiceFormState, context: VoiceFormContext)` callback is called on every transition.
- `VoiceFormContext` includes the current transcript (if available), the current fields object (if available), and the current error (if in error state).
- The callback is optional; omitting it does not cause errors.

---

### 5.7 Error States and Recovery

**FR-027 — Error object shape**
Every error surfaced by the component MUST conform to a standard shape.

Acceptance criteria:
- The `VoiceFormError` type is exported from `@voiceform/core`.
- It includes: `code: string` (one of the defined error codes), `message: string` (human-readable, safe to display to end users), `cause?: unknown` (original thrown value, for developer debugging only — never displayed in the default UI).
- Error codes are exported as a constant enum or object from `@voiceform/core`.
- Raw HTTP response bodies included in `cause` MUST be truncated to 500 characters (see also FR-011).

Defined error codes for v1:

| Code | Trigger |
|---|---|
| `MIC_PERMISSION_DENIED` | User denied microphone access |
| `MIC_NOT_AVAILABLE` | No microphone detected |
| `STT_NOT_SUPPORTED` | Web Speech API not available in this browser |
| `STT_ERROR` | Web Speech API fired an error event |
| `NO_TRANSCRIPT` | Session ended with no final transcript |
| `TRANSCRIPT_TOO_LONG` | Transcript exceeded `transcriptMaxLength` (FR-015) |
| `TRANSCRIPT_INVALID` | Transcript contained null bytes or non-printable control characters (FR-015) |
| `ENDPOINT_UNREACHABLE` | Network failure on POST |
| `ENDPOINT_TIMEOUT` | Request exceeded `endpointTimeout` |
| `ENDPOINT_CLIENT_ERROR` | Endpoint returned 4xx |
| `ENDPOINT_SERVER_ERROR` | Endpoint returned 5xx |
| `ENDPOINT_INVALID_RESPONSE` | Response was not valid JSON or missing `fields` |
| `TARGET_NOT_FOUND` | No DOM elements matched the `target` at injection time |
| `CONFIG_ERROR` | Schema or configuration validation failed at init |

---

**FR-028 — Error recovery**
The component MUST support retry and reset from the error state.

Acceptance criteria:
- An `onError(error: VoiceFormError)` callback is called when the state transitions to `error`.
- The developer can call `reset()` to return to `idle`.
- A built-in retry mechanism re-starts from `idle` when the user activates the control while in `error` state (configurable: `retryOnActivate`, default `true`).
- On retry, all session data (transcript, fields) is cleared.

---

**FR-029 — Error payload sanitization**
Error payloads MUST separate user-safe messages from debug information. Addresses MED-003.

Acceptance criteria:
- The `message` field of `VoiceFormError` contains only a user-safe, human-readable description (no raw HTTP bodies, no stack traces, no internal state).
- Debug information (raw response body, HTTP status, original exception) is placed in the `cause` field, which is never rendered by the default UI.
- Any raw HTTP response body included in `cause` is truncated to 500 characters before being stored.
- The `onError` callback receives the full `VoiceFormError` (including `cause`), but the default UI MUST only display `message`.

---

**FR-030 — CSS selector injection prevention**
All `querySelector` calls that incorporate developer- or LLM-supplied strings MUST use `CSS.escape()`. Addresses MED-002.

Acceptance criteria:
- Every call to `document.querySelector` or `element.querySelector` that incorporates a field `name` value constructs the selector as `[name="${CSS.escape(fieldName)}"]` or `#${CSS.escape(fieldName)}` rather than using string interpolation directly.
- This applies in both the DOM injector and any auto-detection logic.
- A test verifies that a field name containing `"` or `]` characters does not cause a selector syntax error.

---

### 5.8 Reference Implementation Requirements

**FR-031 — Reference endpoint prompt structure**
All reference endpoint implementations MUST use role-separated LLM message construction. Addresses CRIT-003.

Acceptance criteria:
- The system prompt is a static string containing only the schema definition and instructions. It does NOT contain the transcript.
- The transcript is placed in a separate `user` role message: `{ role: "user", content: JSON.stringify(transcript) }`. The transcript MUST be `JSON.stringify`'d when embedded to prevent prompt injection via crafted speech.
- This pattern is explained in the inline comments of the reference implementation and in the endpoint integration guide.
- The reference implementation rejects requests where the `X-VoiceForm-Request: 1` header is absent (FR-014).
- The reference implementation validates `transcript` presence and `schema` structure before passing them to the LLM.

---

## 6. Non-Functional Requirements — v1

### 6.1 Bundle Size

**NFR-001 — Core bundle size**
The `@voiceform/core` package headless entry point MUST meet the following size targets, measured as gzip-compressed ESM output. Addresses PERF REC-001, REC-002.

Acceptance criteria:
- `@voiceform/core` (headless, without default UI) minified + gzipped: <= 5 KB.
- `@voiceform/core/ui` (default UI subpath export) is a separate entry point; its addition brings the combined total to no more than 9 KB minified + gzipped.
- `@voiceform/svelte` wrapper (excluding Svelte runtime): <= 3 KB minified + gzipped.
- Bundle size is measured in CI on every pull request using a size-check script (e.g., `size-limit`) that targets the tree-shaken output of a representative import, not the raw file size.
- A pull request that causes any entry point to exceed its target MUST fail CI.

---

**NFR-002 — Zero runtime dependencies**
`@voiceform/core` MUST have zero production dependencies listed in `package.json`.

Acceptance criteria:
- `npm ls --prod` (or equivalent) in the `@voiceform/core` package shows no dependency tree entries.
- The only entries in `package.json` are `devDependencies` and `peerDependencies`.
- Framework wrappers MAY list their framework as a `peerDependency` only.

---

**NFR-003 — Prompt builder excluded from browser bundle**
The `buildSystemPrompt` and `buildUserPrompt` functions MUST NOT be included in the `@voiceform/core` browser bundle. Addresses PERF REC-002.

Acceptance criteria:
- Prompt construction utilities are published under `@voiceform/server-utils` (or an equivalent subpath, see OQ-006).
- The `@voiceform/core` package has no import of prompt builder code.
- The reference SvelteKit endpoint imports from `@voiceform/server-utils`, not from `@voiceform/core`.

---

**NFR-004 — Tree-shaking: DefaultUI and WebSpeechAdapter**
`DefaultUI` and `WebSpeechAdapter` MUST be tree-shakeable from consumers that do not use them. Addresses PERF 1.3.

Acceptance criteria:
- The `@voiceform/core` package defines separate subpath exports: `@voiceform/core/ui` for `DefaultUI` and `@voiceform/core/stt` for `WebSpeechAdapter`.
- `createVoiceForm` does not statically import either module; they must be explicitly passed by the caller or imported via the subpath.
- A bundle analysis test (e.g., `rollup-plugin-analyzer` output assertion) verifies that a headless `createVoiceForm` call without UI or STT imports produces a bundle containing no `DefaultUI` or `WebSpeechAdapter` code.
- Framework wrappers that include the default UI import from `@voiceform/core/ui` explicitly.

---

### 6.2 Browser Support

**NFR-005 — Baseline browser matrix**
The library MUST function without polyfills in the following browsers:

| Browser | Minimum Version |
|---|---|
| Chrome | 90+ |
| Edge | 90+ |
| Safari | 15.4+ |
| Firefox | 90+ |
| Chrome for Android | 90+ |
| Safari on iOS | 15.4+ |

Acceptance criteria:
- The TypeScript compilation target is `ES2020`.
- No APIs are used that are not available in all listed browsers, with the exception of Web Speech API (see NFR-006).
- The component is tested against the above matrix in CI using Playwright.

---

**NFR-006 — Web Speech API graceful degradation**
The Web Speech API is not available in Firefox or some mobile browsers. The component MUST degrade gracefully.

Acceptance criteria:
- On initialization, the component checks for `window.SpeechRecognition || window.webkitSpeechRecognition`.
- If neither is present and the default adapter is in use, the component transitions to `error` with code `STT_NOT_SUPPORTED` on the first activation attempt.
- If a custom STT adapter is provided, the Web Speech API check is skipped entirely.
- The component MUST NOT throw an uncaught exception during module initialization in browsers that lack Web Speech API support.

---

### 6.3 Accessibility

**NFR-007 — Keyboard accessibility**
All interactive elements in the component's default UI MUST be operable by keyboard alone.

Acceptance criteria:
- The microphone button is focusable and activatable via `Space` and `Enter`.
- All confirmation UI controls (Confirm, Cancel) are focusable and activatable via `Space` and `Enter`.
- Tab order follows the visual reading order.
- No keyboard traps are introduced.

---

**NFR-008 — Screen reader support**
The component's default UI MUST be usable with a screen reader.

Acceptance criteria:
- The microphone button has a descriptive `aria-label` that reflects its current state (e.g., "Start voice input", "Stop recording").
- Recording state changes are announced via an `aria-live="polite"` region.
- Error messages are announced via an `aria-live="assertive"` region.
- The confirmation table/list announces field labels and values.
- All ARIA attributes are validated against the ARIA 1.2 specification.

---

**NFR-009 — Color contrast**
Default UI elements MUST meet WCAG 2.1 Level AA contrast ratios.

Acceptance criteria:
- Text and interactive element contrast ratio is >= 4.5:1 against the background.
- Large text (>= 18pt or 14pt bold) contrast ratio is >= 3:1.
- Focus indicators have a contrast ratio of >= 3:1 against adjacent colors.

---

**NFR-010 — Motion sensitivity**
The component MUST respect `prefers-reduced-motion`.

Acceptance criteria:
- All CSS animations and transitions are disabled or reduced when `prefers-reduced-motion: reduce` is active.
- Recording state indicators (e.g., pulsing animation) are replaced with a static indicator.

---

### 6.4 Performance

**NFR-011 — Time to first audio**
The time from user activation to the microphone becoming active MUST be within an acceptable bound.

Acceptance criteria:
- Excluding the browser permission prompt (which is outside library control), the microphone is active within 200ms of activation on a modern device.
- Measured in a Playwright test on a standard CI runner.

---

**NFR-012 — Endpoint latency budget**
The component provides a default UI affordance for processing time.

Acceptance criteria:
- A loading indicator is visible from the moment the `processing` state is entered.
- The component does not degrade user experience for endpoint response times up to 30 seconds (i.e., it does not time out before the default 15-second `endpointTimeout`).
- The component remains interactive (user can cancel) during processing.

---

**NFR-013 — Injection performance**
DOM value injection MUST complete within one animation frame on mid-range hardware. Addresses PERF REC-006.

Acceptance criteria:
- All value injection (for up to 20 fields) is performed using `requestAnimationFrame` with two-pass batching: all values are written in the first pass, then all synthetic events are dispatched in the second pass.
- Native value setter references (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`) MUST be cached at module scope, not retrieved per-call.
- Element references resolved from the DOM MUST be cached after first lookup within a single injection cycle.
- Injecting values into 20 fields, including synthetic event dispatch, completes within 16ms on mid-range hardware (measured via `performance.now()` in tests).
- The previous 50ms acceptance criterion is superseded by this requirement.

---

**NFR-014 — Memory safety: StateMachine lifecycle**
The StateMachine MUST expose a `destroy()` method, and framework wrappers MUST call it on unmount. Addresses PERF REC-005.

Acceptance criteria:
- `StateMachine` (or the equivalent core lifecycle object) exposes a `destroy()` method that removes all internal event listeners, clears all registered callbacks, and nullifies internal state references.
- The `@voiceform/svelte` wrapper calls `destroy()` in the component's `onDestroy` lifecycle hook.
- The `@voiceform/react` wrapper (v2) calls `destroy()` in the `useEffect` cleanup function.
- An automated test mounts and unmounts the component 100 times in sequence and asserts that there is no monotonic growth in listener count or heap size (measured via a test harness that exposes listener count).

---

**NFR-015 — Timer cleanup**
All `setTimeout` timers created by the library MUST be tracked and cleared on abort or destroy. Addresses PERF REC-003, 2.9.

Acceptance criteria:
- Every `setTimeout` call returns an id that is stored in a tracked set on the component instance.
- When `destroy()` or `reset()` is called, all tracked timer ids are passed to `clearTimeout`.
- This applies to: the `done`-state auto-reset timer, the retry backoff timer, and any future timers introduced by this component.
- A test verifies that no timers fire after `destroy()` is called.

---

### 6.5 Security

**NFR-016 — No API keys in the browser**
The library MUST NOT require any API keys, secrets, or tokens to be present in the client-side bundle.

Acceptance criteria:
- The library has no configuration option that accepts an LLM provider API key (see also FR-013-SEC).
- The BYOE pattern is the only supported integration mode in v1.
- The README and API docs explicitly warn against constructing a client-side LLM call from within the `endpointUrl` handler.

---

**NFR-017 — No data persistence**
The library MUST NOT persist transcript data, field values, or schema data in any browser storage.

Acceptance criteria:
- `localStorage`, `sessionStorage`, `IndexedDB`, and cookies are not written to by the library under any circumstances.
- All session data (transcript, fields) is held in memory and cleared on `reset()` or component unmount.

---

## 7. Integration Requirements — v1

### 7.1 Package Structure

**IR-001 — npm package exports**
Each package MUST export a well-defined public API surface.

Acceptance criteria:

`@voiceform/core` exports (primary entry `.`):
- `VoiceForm` class (or factory function)
- `STTAdapter` interface type
- `VoiceFormSchema` type
- `VoiceFormSchemaField` type
- `VoiceFormError` type
- `VoiceFormState` type
- `VoiceFormContext` type
- `VoiceFormOptions` type
- `ErrorCode` constant object

`@voiceform/core/ui` subpath export:
- `DefaultUI` component

`@voiceform/core/stt` subpath export:
- `WebSpeechAdapter` class

`@voiceform/svelte` exports:
- `VoiceFormButton` Svelte component (default + named export)

Package `exports` fields in `package.json` MUST include `"types"`, `"import"` (ESM), and `"require"` (CJS) conditions for each entry point.

---

**IR-002 — TypeScript strict mode**
All packages MUST compile without errors under TypeScript strict mode.

Acceptance criteria:
- `tsconfig.json` in each package includes `"strict": true`.
- `npm run build` in each package completes with exit code 0 and zero TypeScript diagnostic errors.
- All exported types are complete: no `any` in exported type signatures.

---

**IR-003 — Dual ESM/CJS output**
Each package MUST ship both ESM and CommonJS bundles.

Acceptance criteria:
- `tsup` is configured to emit both `esm` and `cjs` formats.
- The `main` field in `package.json` points to the CJS build.
- The `module` field (and `exports["."]["import"]`) points to the ESM build.
- Source maps are included in the published output.

---

### 7.2 CDN Distribution

**IR-004 — UMD/IIFE bundle for CDN**
`@voiceform/core` MUST ship a single-file IIFE build suitable for `<script>` tag inclusion.

Acceptance criteria:
- `tsup` emits an `iife` format output named `voiceform.min.js`.
- The global name is `VoiceForm`.
- The IIFE bundle is <= 12 KB gzip.
- The IIFE bundle is included in the npm package and therefore available on jsDelivr and unpkg automatically.
- The README includes a CDN usage example.

---

### 7.3 Reference Implementation

**IR-005 — SvelteKit endpoint reference**
The demo site MUST include a reference implementation of the BYOE endpoint in SvelteKit.

Acceptance criteria:
- The file is located at `apps/demo/src/routes/api/voiceform/+server.ts`.
- The endpoint validates the incoming request body against the `{ transcript, schema }` shape.
- The endpoint validates the `X-VoiceForm-Request: 1` header is present and returns `400` if absent (FR-014).
- The endpoint places the transcript in a separate `user` role message (never in the system prompt), with the transcript `JSON.stringify`'d (FR-031).
- The endpoint calls an LLM (e.g., OpenAI) using a server-side API key from environment variables.
- The endpoint returns `{ fields }` in the documented format.
- The endpoint returns a `400` with a descriptive message if the request body is malformed.
- The reference implementation is documented with inline comments explaining each step.
- The demo site's `.env.example` includes the required environment variable names without values.

---

**IR-006 — SvelteKit integration example**
The demo site MUST demonstrate a complete integration using `@voiceform/svelte`.

Acceptance criteria:
- The demo includes a form with at least 5 fields of mixed types (text, number, date, select).
- The schema is explicitly defined and passed to the component.
- The demo shows all recording states with visual feedback.
- The demo is deployable to a static host (e.g., Vercel, Cloudflare Pages) without a build step beyond `pnpm build`.

---

### 7.4 Developer Experience

**IR-007 — Monorepo tooling**
The repository MUST use pnpm workspaces and standard tooling.

Acceptance criteria:
- `pnpm install` at the repo root installs all workspace dependencies.
- `pnpm build` at the repo root builds all packages in dependency order.
- `pnpm test` at the repo root runs all package test suites.
- `pnpm lint` runs ESLint across all packages.

---

**IR-008 — Test coverage**
All packages MUST maintain minimum test coverage.

Acceptance criteria:
- `@voiceform/core`: >= 90% line and branch coverage measured by Vitest.
- `@voiceform/svelte`: >= 80% line coverage.
- CI fails if coverage drops below these thresholds on any pull request.
- Integration tests cover the full happy path: activation → transcript → endpoint → confirmation → injection.

---

---

## 8. Functional Requirements — v2

All v1 requirements remain in force unless explicitly superseded by a v2 requirement below.

### 8.1 React Wrapper

**FR-101 — React component**
`@voiceform/react` MUST provide a `VoiceFormButton` React component wrapping `@voiceform/core`.

Acceptance criteria:
- The component is a functional React component using hooks.
- All `@voiceform/core` options are exposed as typed React props.
- The component is compatible with React 18+ (concurrent mode safe).
- The component does not use any deprecated React APIs.
- `peerDependencies` lists `react >= 18.0.0` and `react-dom >= 18.0.0`.

---

**FR-102 — React ref forwarding**
The `VoiceFormButton` component MUST forward its ref to the underlying DOM button element.

Acceptance criteria:
- `React.forwardRef` is used.
- The forwarded ref resolves to an `HTMLButtonElement`.
- Attaching a ref to `VoiceFormButton` gives the developer direct DOM access for focus management.

---

**FR-103 — React controlled injection**
The React wrapper MUST support injecting values into React controlled components without bypassing React's state.

Acceptance criteria:
- The native input value setter pattern (FR-019) is the default injection mechanism.
- The developer MAY additionally provide an `onFieldsResolved(fields: Record<string, unknown>): void` callback to receive field values and manage injection themselves (opt-out of DOM injection entirely).
- When `onFieldsResolved` is provided, DOM injection is skipped. The confirmation step still occurs unless also opted out.
- The documentation explicitly explains the controlled component injection pattern and its limitations.

---

### 8.2 Whisper STT Adapter

**FR-104 — Whisper adapter package**
A Whisper STT adapter MUST be available as an export from `@voiceform/core` (or an optional sub-path export).

Acceptance criteria:
- The adapter is available at `@voiceform/core/adapters/whisper`.
- The adapter records audio using `MediaRecorder` and collects audio chunks into a `Blob`.
- On stop, the adapter POSTs the audio `Blob` to a developer-supplied transcription endpoint URL (`whisperEndpointUrl` config option).
- The transcription endpoint is expected to return `{ transcript: string }`.
- The adapter satisfies the `STTAdapter` interface (FR-004).
- The Whisper adapter adds no more than 3 KB gzip to the bundle size when imported.

---

**FR-105 — Whisper audio format**
The Whisper adapter MUST produce audio in a format compatible with the OpenAI Whisper API.

Acceptance criteria:
- The adapter prefers `audio/webm;codecs=opus` if `MediaRecorder.isTypeSupported` returns true.
- Falls back to `audio/ogg;codecs=opus`, then `audio/mp4`, in that priority order.
- The selected MIME type is included in the POST to the transcription endpoint as the `Content-Type` header.
- Audio is recorded at the browser's default sample rate (no resampling in the library).

---

**FR-106 — Whisper adapter error handling**
The Whisper adapter MUST handle recording and transcription errors.

Acceptance criteria:
- `MediaRecorder` `onerror` transitions to `error` with code `STT_ERROR`.
- A non-2xx response from the transcription endpoint transitions to `error` with code `STT_ERROR` and includes the HTTP status.
- A missing or non-string `transcript` field in the response transitions to `error` with code `STT_ERROR`.

---

**FR-107 — Whisper adapter Blob cleanup**
The Whisper adapter MUST dereference audio data after use to prevent memory retention. Addresses PERF 2.7.

Acceptance criteria:
- The audio `Blob` and `MediaRecorder` chunk array are explicitly dereferenced (set to `null` / cleared) after the POST request completes, whether the request succeeds or fails.
- On abort (e.g., `reset()` called during recording), chunks are dereferenced immediately without sending the POST.
- A test verifies that the adapter holds no reference to the `Blob` after the session concludes.

---

### 8.3 Partial Fill and Append Mode

**FR-108 — Append mode**
The component MUST support an `appendMode` option that concatenates new values to existing field values rather than replacing them.

Acceptance criteria:
- `appendMode` is a boolean option (default: `false`).
- When `appendMode` is `true` and a field already has a non-empty value, the new value is appended with a single space separator.
- When `appendMode` is `true` and a field is empty, behavior is identical to replace mode.
- The confirmation step shows both the existing value and the appended result for fields that will be changed.
- `appendMode` applies only to `text` and `textarea` field types. For `number`, `date`, `boolean`, and `select` types, the behavior is always replace regardless of `appendMode`.

---

**FR-109 — Partial fill behavior**
When the LLM returns `null` for some fields, the component MUST behave correctly.

Acceptance criteria:
- `null` values in the `fields` response do not overwrite existing form field values, regardless of `appendMode`.
- In the confirmation step, `null` fields are displayed as "Not recognized" and excluded from the list of changes to be applied.
- After injection, the developer can inspect which fields were filled via the `onComplete(filledFields: string[])` callback.

---

### 8.4 Multi-Step Form Support

**FR-110 — Multi-step context**
The component MUST support forms spread across multiple pages or steps where not all fields are visible simultaneously.

Acceptance criteria:
- The developer can call `setSchema(newSchema)` to replace the active schema between steps without remounting the component.
- The component retains no memory of previous steps' field values after a schema change.
- The `reset()` method clears current session state but does not affect the configured schema.

---

**FR-111 — Step-aware injection**
The component MUST only inject values into fields that exist in the current DOM at injection time.

Acceptance criteria:
- Fields in the `fields` response that do not resolve to DOM elements are silently skipped (no error) in multi-step mode.
- Multi-step mode is activated by setting `multiStep: true` in options; in this mode, missing DOM targets are warnings, not errors.
- When `multiStep` is `false` (default), missing DOM targets remain `TARGET_NOT_FOUND` errors as per FR-028.

---

### 8.5 DOM Schema Auto-Detection

**FR-112 — Auto-detection algorithm**
When `schema` is not explicitly provided and `autoDetectSchema: true` is set, the component MUST infer the schema from the DOM.

Acceptance criteria:
- The algorithm queries the `target` form element for all `<input>`, `<textarea>`, and `<select>` elements that are not `type="hidden"`, `type="submit"`, `type="reset"`, or `type="button"`.
- For each detected field, `name` is taken from the element's `name` attribute, falling back to `id`.
- `label` is resolved by: (1) an associated `<label>` element via `for` attribute, (2) an `aria-label` attribute, (3) a `placeholder` attribute, (4) the `name` attribute as a last resort.
- `type` is mapped from the input `type` attribute: `text/email/tel/url/search → "text"`, `number/range → "number"`, `date/datetime-local → "date"`, `checkbox → "boolean"`, `select → "select"`.
- For `<select>` elements, `options` is populated from the `<option>` elements' text content (excluding disabled options and placeholder options with empty value).
- Fields with no resolvable `name` are excluded from the auto-detected schema with a console warning.
- The auto-detected schema is exposed to the developer via an `onSchemaDetected(schema: VoiceFormSchema)` callback for inspection or mutation before use.

---

**FR-113 — Auto-detection is not the default**
Schema auto-detection MUST be opt-in.

Acceptance criteria:
- The default value of `autoDetectSchema` is `false`.
- If both `schema` and `autoDetectSchema: true` are provided, the explicitly provided `schema` takes precedence and `autoDetectSchema` is ignored with a console warning.
- If `autoDetectSchema: true` is set and no fields are detected, initialization throws a `VoiceFormConfigError`.

---

### 8.6 Field-Level Correction UX

**FR-114 — Inline field editing in confirmation step**
The confirmation step MUST allow the user to edit individual field values before confirming.

Acceptance criteria:
- Each field displayed in the confirmation step includes an inline edit control (input, select, etc.) matching the field's type.
- Changes made in the confirmation step are reflected when values are injected into the form.
- Editing a field value in the confirmation step does not affect the raw `fields` object returned from the endpoint; a separate `correctedFields` object is created.
- The `onComplete` callback receives both the original `fields` and the final `correctedFields`.
- Inline editing is enabled by default; it can be disabled via `allowFieldCorrection: false`.

---

**FR-115 — Field-level null override**
The user MUST be able to manually fill in fields that the LLM returned as `null`.

Acceptance criteria:
- `null` fields in the confirmation step are shown with an empty editable input.
- If the user enters a value for a `null` field and confirms, that value is injected alongside the non-null fields.
- If the user leaves a `null` field empty and confirms, the field is skipped (no injection).

---

**FR-116 — `onBeforeConfirm` output re-sanitization**
Values returned from the `onBeforeConfirm` callback MUST be re-sanitized before injection. Addresses MED-004.

Acceptance criteria:
- The same `stripHtml` and type-validation pipeline applied to LLM response values (FR-020) is re-applied to any values returned from `onBeforeConfirm`.
- This prevents a developer's `onBeforeConfirm` implementation (which may fetch external data) from introducing unsanitized values into the injection path.
- The re-sanitization step is documented in the `onBeforeConfirm` API reference with an explanatory note.

---

### 8.7 Dev Mode Package

**FR-117 — `@voiceform/dev` package**
A separate `@voiceform/dev` package MUST be available for development and debugging purposes.

Acceptance criteria:
- The package is listed in `devDependencies` in the reference demo app.
- It is explicitly documented as not suitable for production use.
- The package adds no code to production builds (the developer must ensure it is not imported in production paths).

---

**FR-118 — Schema inspector**
`@voiceform/dev` MUST include a schema inspector utility.

Acceptance criteria:
- `inspectSchema(schema)` prints a formatted table of field names, types, labels, and options to the browser console.
- `validateSchemaAgainstDOM(schema, formElement)` compares schema field names against the form's DOM elements and logs mismatches (fields in schema with no matching DOM element, and DOM elements with no matching schema entry).
- Both functions are no-ops when `process.env.NODE_ENV === 'production'` or when tree-shaken out by a bundler that respects `sideEffects: false`.

---

**FR-119 — Request/response logger**
`@voiceform/dev` MUST include a logging wrapper for the BYOE endpoint request/response cycle.

Acceptance criteria:
- `createLoggingMiddleware()` returns an options object that, when spread into the `VoiceForm` options, intercepts the endpoint request and response and logs them to the console in a structured, readable format.
- The log includes: timestamp, transcript, schema (summarized), raw request body, HTTP status, raw response body, and parsed `fields`.
- Log entries are grouped using `console.group` / `console.groupEnd`.
- The middleware does not modify the request or response in any way.

---

**FR-120 — State machine visualizer**
`@voiceform/dev` MUST include a real-time state visualizer.

Acceptance criteria:
- `attachStateVisualizer(voiceFormInstance)` injects a fixed-position overlay into the document that displays the current state, the current transcript (if any), and the last error (if any) in real time.
- The overlay is styled to be clearly distinguishable as a dev tool (e.g., dark background, monospace font, labeled "voiceform dev").
- `detachStateVisualizer()` removes the overlay and all event listeners.
- The visualizer is removed automatically on component unmount if not manually detached.

---

## 9. Non-Functional Requirements — v2

**NFR-101 — React bundle size**
`@voiceform/react` (excluding React runtime) MUST be <= 4 KB minified + gzipped.

Acceptance criteria:
- Measured with React listed as external in the tsup config.
- CI size check is extended to include the React wrapper.

---

**NFR-102 — Whisper adapter bundle size**
The Whisper adapter sub-path export MUST add no more than 3 KB gzip over the base `@voiceform/core` bundle.

Acceptance criteria:
- Size is measured as the delta between `@voiceform/core` alone and `@voiceform/core` with the Whisper adapter imported.
- This is distinct from the total bundle size (which includes core).

---

**NFR-103 — `@voiceform/dev` is never included in production**
The dev package MUST be structured such that standard bundler tree-shaking eliminates it from production builds.

Acceptance criteria:
- `package.json` includes `"sideEffects": false`.
- All exports are pure functions (no module-level side effects).
- The package README includes an explicit warning and a code example showing how to import it only in development.

---

## 10. Constraints and Assumptions

1. The library assumes the developer's endpoint is on the same origin or has appropriate CORS headers set. The library does not manage CORS.
2. The library assumes the developer is responsible for rate limiting, abuse prevention, and cost control on their LLM endpoint.
3. Audio data (for the Whisper adapter) is sent to the developer's transcription endpoint, not directly to any third party. The library does not call any external service directly.
4. The library does not support file upload fields (`<input type="file">`) for value injection. This is a documented limitation.
5. The library does not support rich text editors (e.g., ProseMirror, Quill, TipTap) natively. Developers must handle injection for these editors via the `onFieldsResolved` callback.
6. Internet Explorer is explicitly not supported.
7. The v1 confirmation UI is intentionally minimal; design customization is a developer responsibility via slots/render props.

---

## 11. Out of Scope (All Versions)

- Hosted LLM proxy service
- Analytics or usage telemetry
- Voice wake-word detection
- Streaming transcription into fields in real time (pre-confirmation)
- Native mobile SDKs (iOS, Android)
- Audio playback or text-to-speech
- Integration with browser password managers or autofill
- CAPTCHA or bot detection
- Direct browser-to-LLM adapter (deferred; requires dedicated security model for local/WASM models)

---

## 12. Open Questions

| ID | Question | Owner | Target | Status |
|---|---|---|---|---|
| OQ-001 | Should the confirmation step be a modal overlay or inline expansion? Both should be supportable via slots, but what is the default? | Design | v1 kickoff | Open |
| OQ-002 | Should `@voiceform/core` ship with a default unstyled CSS file, or should all styling be done by the framework wrappers? | Architecture | v1 kickoff | Open |
| OQ-003 | For the Whisper adapter, should the transcription endpoint contract be the same as the main `endpointUrl` contract (i.e., developer proxies Whisper), or should it be a separate endpoint that returns only a transcript? | Architecture | v2 planning | Open |
| OQ-004 | Is there demand for a Vue 3 wrapper in v2, or should it be community-contributed? | Product | v2 planning | Open |
| OQ-005 | Should `setSchema()` (FR-110) trigger a fresh DOM re-evaluation when `autoDetectSchema` is also enabled? | Architecture | v2 planning | Open |
| OQ-006 | Should prompt builder utilities (`buildSystemPrompt`, `buildUserPrompt`) be published as a separate npm package (`@voiceform/server-utils`) or as a subpath export of an existing package (e.g., `@voiceform/core/server`)? A separate package provides cleaner separation and prevents accidental client-side imports, but adds publishing overhead. A subpath export is simpler to maintain but requires careful `package.json` `exports` configuration to ensure it is never bundled by client-side build tools. | Architecture | v1 kickoff | Open |

---

## 13. Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 2026-04-01 | Backend Architect | Initial draft from architecture debate decisions |
| 1.1 | 2026-04-01 | Backend Architect | Integrated security review (CRIT-001, CRIT-002, CRIT-003, HIGH-001, HIGH-003, HIGH-004, MED-002, MED-003, MED-004) and performance review (REC-001, REC-002, REC-003, REC-005, REC-006, PERF 1.3, 2.7, 2.8, 2.9) findings. Added FR-013-SEC, FR-014 through FR-017, FR-020, FR-027, FR-029 through FR-031, FR-107, FR-116. Updated FR-011, FR-019, FR-025, FR-027 (renumbered). Added NFR-003, NFR-004, NFR-013 through NFR-015. Updated NFR-001. Removed `llmAdapter` from v1 scope. Renumbered FR-013 through FR-026 (formerly FR-013 through FR-022) to accommodate new security requirements. Added OQ-006. |
