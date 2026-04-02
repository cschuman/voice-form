# voice-form — Build Task List

**Version coverage:** v0.1 through v2.0
**Last updated:** 2026-04-01
**How to use this document:**
- Tasks are ordered by dependency within each phase. Pick the first unblocked task in the current phase.
- Complexity ratings: S = under 2 hours, M = 2–8 hours, L = 1–2 days, XL = 2–5 days
- Each task's `Depends on` field lists task IDs that must be complete before starting
- IDs are formatted as `P[phase]-[number]` (e.g., `P0-01`)

---

## Phase 0: Project Setup

---

### P0-01 — Initialize pnpm monorepo

Initialize the monorepo with pnpm workspaces. The repo root should contain `pnpm-workspace.yaml` listing `packages/*`, a root `package.json` with workspace-level dev dependencies and scripts, and a `.nvmrc` or `engines` field pinning Node 20 LTS. Running `pnpm install` from the root should install all workspace dependencies in a single command.

**Complexity:** S
**Depends on:** None
**Acceptance criteria:**
- `pnpm-workspace.yaml` exists at repo root and lists `packages/*`
- Root `package.json` has `"engines": { "node": ">=20" }` and `"packageManager": "pnpm@..."`
- `pnpm install` from root completes without errors
- `packages/` directory exists with at least a placeholder readme

---

### P0-02 — Scaffold package directories

Create the initial directory structure for the packages that will be built in v1: `packages/core`, `packages/svelte`, `packages/demo`. Each package needs a `package.json` with `name`, `version: "0.0.0"`, `private` (for demo), and a stub `README.md`. Do not write any source code yet.

**Complexity:** S
**Depends on:** P0-01
**Acceptance criteria:**
- `packages/core/package.json` has `name: "@voiceform/core"`
- `packages/svelte/package.json` has `name: "@voiceform/svelte"`
- `packages/demo/package.json` has `name: "@voiceform/demo"` and `"private": true`
- Each package has a stub `src/` directory and `README.md`
- `pnpm install` still completes from root

---

### P0-03 — Configure TypeScript for all packages

Set up TypeScript across the monorepo. The root should have a `tsconfig.base.json` with shared strict settings. Each package should have its own `tsconfig.json` that extends the base. Compiler output should go to `dist/` per package. All packages should use `"module": "ESNext"` and `"moduleResolution": "Bundler"`.

**Complexity:** S
**Depends on:** P0-02
**Acceptance criteria:**
- Root `tsconfig.base.json` has `"strict": true`, `"noImplicitAny": true`, `"noUncheckedIndexedAccess": true`
- Each package `tsconfig.json` extends `../../tsconfig.base.json`
- `tsc --noEmit` passes on an empty `src/index.ts` stub in each package
- No `any` types are permitted in `@voiceform/core`'s tsconfig (enforced via compiler options, not just convention)

---

### P0-04 — Configure tsup build for core and svelte packages

Set up `tsup` as the build tool for `@voiceform/core` and `@voiceform/svelte`. Each package should output both ESM and CJS formats with TypeScript declaration files (`.d.ts`). The build command from root (`pnpm build`) should build all packages in dependency order.

**Complexity:** M
**Depends on:** P0-03
**Acceptance criteria:**
- `packages/core/tsup.config.ts` produces `dist/index.js` (ESM), `dist/index.cjs` (CJS), and `dist/index.d.ts`
- `packages/svelte/tsup.config.ts` does the same
- `pnpm build` from root builds both packages via `pnpm -r build`
- Build artifacts are in `.gitignore`
- Source maps are generated for both formats

---

### P0-05 — Configure Vite for the demo site

Set up Vite with the Svelte plugin for the `packages/demo` package. The demo should be a Svelte 5 SPA. `pnpm dev` from the demo package should start a local dev server. `pnpm build` in demo should produce a static site in `dist/`.

**Complexity:** S
**Depends on:** P0-02
**Acceptance criteria:**
- `packages/demo/vite.config.ts` is present and uses `@sveltejs/vite-plugin-svelte`
- `pnpm dev` from `packages/demo` starts a dev server at `localhost:5173` (or similar)
- `pnpm build` produces a `dist/` with an `index.html`
- Demo dev server supports hot module replacement

---

### P0-06 — Set up ESLint and Prettier

Configure ESLint with TypeScript support and Prettier for code formatting. Apply configs at the monorepo root so all packages inherit the same rules. Include a `lint` and `format` script at the root level. The setup should enforce no `any`, no unused variables, and consistent import ordering.

**Complexity:** M
**Depends on:** P0-03
**Acceptance criteria:**
- `eslint.config.js` (or `.eslintrc`) at root covers all `packages/**/*.ts` files
- `prettier.config.js` at root with agreed formatting rules (2-space indent, single quotes, trailing commas)
- `pnpm lint` from root runs ESLint across all packages and exits non-zero on error
- `pnpm format` runs Prettier across all packages
- `@typescript-eslint/no-explicit-any` rule is set to `error`

---

### P0-07 — Set up Vitest for unit testing

Configure Vitest as the unit test runner. Each package should have its own `vitest.config.ts` and a `test/` directory. The root should have a `pnpm test` script that runs tests across all packages. Configure coverage reporting using `@vitest/coverage-v8`.

**Complexity:** M
**Depends on:** P0-03
**Acceptance criteria:**
- `packages/core/vitest.config.ts` is present and references the package's tsconfig
- A stub test file (`test/placeholder.test.ts`) passes with `pnpm test` from root
- `pnpm test:coverage` from root generates a coverage report in `coverage/`
- Coverage threshold enforcement is configured (85% lines/branches for core)
- Tests run in jsdom environment (for DOM-adjacent code in core)

---

### P0-08 — Set up GitHub Actions CI pipeline

Create a CI workflow that runs on every push and pull request. The pipeline should: install dependencies, build all packages, run linting, run all tests, and check TypeScript types. Use the official `pnpm` GitHub Action for caching. Fail the build on any error.

**Complexity:** M
**Depends on:** P0-04, P0-06, P0-07
**Acceptance criteria:**
- `.github/workflows/ci.yml` exists
- CI runs on `push` and `pull_request` to `main`
- Pipeline steps: `pnpm install` → `pnpm build` → `pnpm lint` → `tsc --noEmit` → `pnpm test`
- Pipeline uses Node 20 and the correct pnpm version
- pnpm store is cached between runs using `pnpm/action-setup`
- A passing run badge can be added to the README

---

### P0-09 — Add Changesets for release management

Install `@changesets/cli` and initialize the Changesets configuration. Add a `changeset` script to root `package.json`. Document the changeset workflow in `CONTRIBUTING.md`. This will be used for versioning and CHANGELOG generation at release time.

**Complexity:** S
**Depends on:** P0-01
**Acceptance criteria:**
- `.changeset/config.json` is present and configured for the monorepo
- `pnpm changeset` launches the interactive CLI
- `pnpm changeset version` and `pnpm changeset publish` are documented in `CONTRIBUTING.md`
- `CONTRIBUTING.md` exists with at minimum: setup instructions, changeset workflow, and PR conventions

---

## Phase 1: Core Library — v1

---

### P1-01 — Define all TypeScript types and public API surface

Before writing any implementation, define the complete TypeScript interface for `@voiceform/core`. This includes `VoiceFormConfig`, `VoiceFormSchema`, `VoiceFormField`, `VoiceFormState`, `VoiceFormResult`, `ParsedFields`, `STTAdapter`, `VoiceFormStrings`, and the `createVoiceForm` factory signature. No implementation — types only, exported from `src/types.ts`.

**Complexity:** M
**Depends on:** P0-03
**Acceptance criteria:**
- `src/types.ts` exports all named types listed above
- `VoiceFormConfig` documents every required and optional field with JSDoc comments, including `privacyNotice?: string`, `requirePrivacyAcknowledgement?: boolean`, `cooldownMs?: number`, and `maxTranscriptLength?: number`
- `VoiceFormState` is a union of literal strings matching the state machine: `'idle' | 'recording' | 'processing' | 'confirming' | 'injecting' | 'done' | 'error'`
- `STTAdapter` is an interface with at minimum: `start(): void`, `stop(): void`, `onResult: (transcript: string) => void`, `onError: (error: STTError) => void`
- Zero `any` types; all unknown data uses `unknown` with narrowing
- `tsc --noEmit` passes on the types file

---

### P1-02 — Implement the state machine

Implement the core state machine as a pure function with no side effects. The machine takes the current state and an event, and returns the next state. It should not import browser APIs or trigger side effects. All valid and invalid state transitions should be defined.

**Complexity:** M
**Depends on:** P1-01
**Acceptance criteria:**
- `src/state-machine.ts` exports a `transition(state: VoiceFormState, event: VoiceFormEvent): VoiceFormState` function
- All valid transitions from the state diagram in UX_SPEC.md are implemented
- Invalid transitions return the current state unchanged and emit a console warning in development mode
- Unit tests cover every valid transition and at least 3 invalid transition attempts
- The function is pure: same state + same event always produces the same output, no side effects
- `StateMachine` interface includes `destroy(): void` which clears all listeners (required for memory leak prevention on repeated mount/unmount)
- See also: P1-NEW-04 (cooldown guard), P1-NEW-12 (reentrancy guard) — these build on this task

---

### P1-NEW-01 — Implement output sanitization module

Implement the sanitization utilities that protect against LLM output containing HTML or script injection. This is a security-critical module; all LLM-returned field values pass through it before being used anywhere in the application.

**Complexity:** M
**Depends on:** P1-01
**Acceptance criteria:**
- `src/utils/sanitize.ts` exports `stripHtml(value: string): string` and `sanitizeFieldValue(value: string, fieldType: VoiceFormFieldType): { value: string; wasModified: boolean }`
- `stripHtml` uses `DOMParser` to parse the string as HTML and returns `textContent` — HTML tags are stripped, not escaped
- `sanitizeFieldValue` calls `stripHtml` and then applies type-specific validation: numbers are validated as numeric, dates as ISO date format, select values are checked against the field's `options` array
- `wasModified` is `true` if the returned value differs from the input (HTML was removed or value was coerced)
- `sanitizeFieldValue` is called on every LLM-returned value inside `validateParseResponse` before any value is passed to the confirmation panel or `onFill` callback
- Unit tests cover: plain text passthrough, value with `<script>` tag, value with `<b>` tag, value with `<img>` and event handler attributes, HTML entities, number field with non-numeric LLM output, select field with value not in options
- Zero network requests; DOMParser runs synchronously in the browser environment

---

### P1-NEW-02 — Implement transcript validation module

Implement the module that validates a raw STT transcript before it is sent to the developer's endpoint. This guards against empty transcripts, abnormally long transcripts, and transcripts containing control characters that could manipulate server-side prompt construction.

**Complexity:** S
**Depends on:** P1-01
**Acceptance criteria:**
- `src/utils/validate-transcript.ts` exports `validateTranscript(transcript: string, config: TranscriptValidationConfig): TranscriptValidationResult`
- `TranscriptValidationResult` is `{ valid: true; transcript: string } | { valid: false; errorCode: TranscriptErrorCode }`
- `TranscriptErrorCode` includes: `'empty'`, `'too-long'`, `'control-chars'`
- Empty check: rejects transcripts that are empty or whitespace-only
- Length check: rejects transcripts exceeding `config.maxTranscriptLength` (default `2000` characters); triggers the `transcript-too-long` error state in the UI
- Control char check: rejects transcripts containing ASCII control characters (0x00–0x1F excluding tab and newline) that could be used to manipulate prompt injection
- The validated (and trimmed) transcript string is returned in the success case
- Unit tests cover: valid transcript, empty string, whitespace-only string, transcript at exactly max length, transcript one character over max length, transcript containing a null byte, transcript containing ESC character

---

### P1-NEW-03 — Add CSRF header to endpoint client

Ensure every POST request from the endpoint client includes a custom header that server-side middleware can use as a CSRF signal to distinguish voice-form requests from arbitrary cross-origin requests.

**Complexity:** S
**Depends on:** P1-06 (endpoint client task)
**Acceptance criteria:**
- Every `fetch` call made by `src/endpoint-client.ts` includes the header `X-VoiceForm-Request: 1`
- The header is present on both the initial request and any retry attempts
- The reference endpoint examples (P3-04, P3-05, P3-06) are updated to show server-side validation of this header
- Unit tests for the endpoint client verify the header is present on every POST, including retries

---

### P1-NEW-04 — Implement request cooldown guard

Add a cooldown guard to the state machine / factory layer that prevents rapid re-activation of the mic after a successful fill or error dismissal. This is a rate-limiting UX safeguard, not a security rate limit.

**Complexity:** S
**Depends on:** P1-02 (state machine task)
**Acceptance criteria:**
- `createVoiceForm` (or the state machine orchestration layer) enforces a minimum interval between `idle → recording` transitions
- The cooldown duration is configured via `VoiceFormConfig.cooldownMs` (default: `3000`)
- If the user attempts to activate the mic during cooldown, the attempt is silently blocked (button remains in dimmed/disabled state; no error is shown)
- A cooldown timer starts when the component transitions from `done` back to `idle`, and also after an error state is dismissed
- The cooldown timer ID is tracked and cleared on `instance.destroy()` to prevent orphaned timers
- Unit tests cover: activation blocked during cooldown, activation succeeds after cooldown expires, destroy() during cooldown does not fire after destruction

---

### P1-03 — Implement the Web Speech API STT adapter

Implement the default speech-to-text adapter using the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`). The adapter must conform to the `STTAdapter` interface defined in P1-01. It handles: starting a session, receiving interim and final results, stopping on silence or manual stop, and surfacing errors (permission denied, no speech, hardware error) as typed `STTError` values.

**Complexity:** L
**Depends on:** P1-01
**Acceptance criteria:**
- `src/adapters/web-speech.ts` exports a class or factory that implements `STTAdapter`
- Calling `start()` invokes `SpeechRecognition.start()` and registers event handlers
- Final transcript is surfaced via `onResult` callback; only the final result is emitted (not interim)
- **Single `onresult` handler using `event.resultIndex`:** the handler iterates from `event.resultIndex` to `event.results.length` — it does not use `Array.from()`, does not create intermediate arrays, and does not conditionally overwrite the handler assignment. All final/interim branching happens inside one handler function.
- Adapter correctly maps `SpeechRecognitionErrorEvent` codes to typed `STTError` variants: `'permission-denied'`, `'no-speech'`, `'not-supported'`, `'audio-capture'`, `'network'`, `'aborted'`
- `isSupported(): boolean` static method returns false when `SpeechRecognition` is absent from window
- Unit tests mock the `SpeechRecognition` browser API and cover: successful transcript, permission denied, no-speech timeout, manual stop
- The adapter does not import or depend on any other voice-form module
- See also: P1-NEW-11 (onresult handler correctness) — the fix described there must be incorporated here from the start

---

### P1-NEW-11 — Fix Web Speech onresult handler (incorporated into P1-03)

*Note: this requirement is folded into P1-03. It is listed here for traceability to the performance review finding (PERF 2.2 / 2.10).*

The `onresult` handler must be a single function that handles both final and interim results. It must use `event.resultIndex` as the start of its iteration loop. It must not use `Array.from()` on `event.results`. It must not be assigned twice (once unconditionally, then overwritten in a conditional block). These requirements are acceptance criteria of P1-03.

**Complexity:** S
**Depends on:** P1-03

---

### P1-04 — Implement the schema validator

Implement a validator that takes the developer-provided schema config and verifies it is well-formed before use. The validator should run at initialization time (not at runtime during a voice session) and throw a descriptive `VoiceFormConfigError` if the schema is invalid.

**Complexity:** S
**Depends on:** P1-01
**Acceptance criteria:**
- `src/schema-validator.ts` exports `validateSchema(schema: VoiceFormSchema): void` (throws on invalid)
- Validates: schema is a non-empty array, each field has a non-empty `name` and `type`, `type` is one of the permitted enum values, no duplicate field names
- Thrown errors include the field index and a human-readable description of the problem
- Unit tests cover: valid schema, empty schema, missing required field, duplicate names, invalid type value

---

### P1-05 — Implement the prompt builder

Implement the module that formats the transcript and schema into a prompt payload. The prompt builder takes the raw transcript string and the schema array, and returns a structured object ready to POST to the developer's endpoint. The format of this object is the public API contract between the library and the developer's backend.

**Note on scope split:** The `buildPrompt` function in core is responsible only for serializing the schema and transcript into the `EndpointPayload` data structure. It does NOT embed LLM system prompt template strings. System prompt construction (the actual text sent to the LLM) belongs in the developer's server code. LLM prompt templates will be provided via a separate `@voiceform/server-utils` package (see P1-NEW-10) so they never appear in the browser bundle.

**Complexity:** M
**Depends on:** P1-01, P1-04
**Acceptance criteria:**
- `src/prompt-builder.ts` exports `buildPrompt(transcript: string, schema: VoiceFormSchema): EndpointPayload`
- `EndpointPayload` is a typed, exported interface: `{ transcript: string, schema: VoiceFormSchema, meta: { version: string, timestamp: number } }`
- The transcript included in the payload is the result of `validateTranscript()` — raw unvalidated transcripts are never passed to `buildPrompt`
- No LLM system prompt template strings are embedded in this module (those live in `@voiceform/server-utils`)
- Unit tests verify the shape of the output for multiple schema/transcript combinations
- The module has no side effects and no browser API dependencies

---

### P1-NEW-10 — Create @voiceform/server-utils package

Move LLM prompt template strings out of the core browser bundle and into a server-side-only package. This package is imported by the developer's BYOE endpoint, not by the browser application.

**Complexity:** M
**Depends on:** P1-05 (prompt builder task must have finalized the schema serialization approach)
**Acceptance criteria:**
- `packages/server-utils/package.json` exists with `name: "@voiceform/server-utils"`
- Exports `buildSystemPrompt(schema: VoiceFormSchema): string` and `buildUserPrompt(transcript: string): string`
- These functions produce the full text prompts sent to the LLM (system role and user role messages respectively)
- The transcript is passed to `buildUserPrompt` using `JSON.stringify(transcript)` so that any special characters in the transcript are escaped before being embedded in the prompt string — this is a prompt injection mitigation
- Reference endpoint examples (P3-04, P3-05, P3-06) are updated to import from `@voiceform/server-utils`
- Zero browser APIs; the package is Node-only and documents this clearly
- `@voiceform/core` bundle contains no LLM prompt template strings after this split — verified by bundle analysis

---

### P1-06 — Implement the endpoint client

Implement the HTTP client that sends the prompt payload to the developer's configured endpoint URL and parses the response. The client handles: sending a JSON POST request, receiving a JSON response, HTTP error status codes, network failures, and response schema validation (ensuring the response matches `ParsedFieldsResponse`).

**Complexity:** M
**Depends on:** P1-01, P1-05
**Acceptance criteria:**
- `src/endpoint-client.ts` exports `sendToEndpoint(payload: EndpointPayload, config: EndpointConfig): Promise<ParsedFieldsResponse>`
- Uses `fetch` (native browser API, no polyfill required — documented as requirement)
- Every request includes the `X-VoiceForm-Request: 1` header (see P1-NEW-03)
- Throws typed `EndpointError` for: non-2xx responses (includes status code), network failure, response body that fails JSON parse, response body that does not match `ParsedFieldsResponse` shape
- Supports a configurable `timeoutMs` option (default: 10000ms) using `AbortController`
- **Timer tracking:** the retry backoff `setTimeout` ID is stored and cleared by `abort()` — cancelling a request also cancels any pending retry timer so no spurious network requests fire after abort
- The `abort()` method cancels both the active `AbortController` and any pending retry timer ID
- Unit tests mock `fetch` and cover: successful response, 500 error, network failure, timeout, malformed JSON response, abort during retry backoff (no retry fires after abort)

---

### P1-07 — Implement the DOM injector / field callback orchestrator

Implement the module that takes the confirmed `ParsedFields` values and invokes the developer's `onFill` callback for each field. This module is not responsible for DOM manipulation directly — it orchestrates the callback invocation and handles the case where the callback throws or rejects.

**Complexity:** S
**Depends on:** P1-01
**Acceptance criteria:**
- `src/injector.ts` exports `injectFields(fields: ParsedFields, config: VoiceFormConfig): Promise<InjectionResult>`
- Iterates over confirmed fields and calls `config.onFill(fieldName, value)` for each
- If `onFill` is async, awaits each call in series (not parallel, to preserve predictable order)
- If `onFill` throws for a field, that field is recorded as failed in `InjectionResult`; other fields continue
- Returns `InjectionResult: { filled: string[], failed: Array<{ field: string, error: unknown }> }`
- **Batched injection:** when the library's own DOM injection path is used (as opposed to a developer `onFill` callback), value writes are separated from event dispatch. All native setter calls complete first, then all synthetic events are dispatched — this is wrapped in a `requestAnimationFrame` call to keep both phases within a single animation frame
- **Cached native setters:** `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set` and equivalent textarea/select setters are resolved once at module scope and reused across all injection calls — they are never re-resolved per field or per injection
- **Element cache:** a `Map<string, HTMLElement | null>` stores resolved element references after the first lookup; `clearCache()` is exported for use when `updateSchema()` is called or the form element changes
- **CSS.escape for queries:** all `querySelector` calls that use field names must wrap the field name with `CSS.escape()` so that field names containing dots, brackets, or hash characters resolve correctly
- Unit tests cover: all fields filled successfully, `onFill` async callback, one callback throws (others still called), all callbacks reject
- Injection performance test: 20-field injection (batched, with rAF) completes within 16ms — verified by the benchmark added in P4-NEW-19
- `InjectionResult` shape is verified in each test

---

### P1-NEW-07 — Cache native value setters and element references (incorporated into P1-07)

*Note: this requirement is folded into P1-07. It is listed here for traceability to the performance review finding (PERF 2.4 / 2.8).*

The native setter cache and element reference cache are acceptance criteria of P1-07.

**Complexity:** S
**Depends on:** P1-07

---

### P1-NEW-08 — Implement two-pass batched DOM injection (incorporated into P1-07)

*Note: the batched injection pattern is folded into P1-07. It is listed here for traceability to the performance review finding (PERF 2.4 / 4.1).*

**Complexity:** M
**Depends on:** P1-07

---

### P1-08 — Implement the createVoiceForm factory

Implement the main public API entry point. `createVoiceForm(config)` initializes the STT adapter, validates the schema, wires together the state machine with all modules (prompt builder, endpoint client, injector), and returns a `VoiceFormInstance` object with methods the developer and UI wrappers call to control the component.

**Complexity:** L
**Depends on:** P1-01, P1-02, P1-03, P1-04, P1-05, P1-06, P1-07, P1-NEW-01, P1-NEW-02, P1-NEW-04
**Acceptance criteria:**
- `src/create-voice-form.ts` exports `createVoiceForm(config: VoiceFormConfig): VoiceFormInstance`
- `VoiceFormInstance` exposes: `start()`, `stop()`, `confirm()`, `cancel()`, `destroy()`, `getState(): VoiceFormState`, `getParsedFields(): ParsedFields | null`, `subscribe(listener: StateListener): Unsubscribe`
- `destroy()` is required on `VoiceFormInstance`; it clears all state machine listeners, cancels all pending timers (retry backoff, auto-reset, cooldown, field highlight), and removes all DOM nodes and event listeners added by the instance. Framework wrappers must call `destroy()` in their cleanup path (React `useEffect` cleanup, Svelte `onDestroy`).
- `subscribe` implements a simple observable: listener is called with the new state on every transition; returns an unsubscribe function
- Schema validation runs at construction time; invalid config throws `VoiceFormConfigError` immediately
- The factory selects the STT adapter based on config (defaults to Web Speech API adapter)
- Transcript validation (`validateTranscript`) is called on every STT result before `buildPrompt`; a too-long or invalid transcript triggers the appropriate error state without hitting the endpoint
- Output sanitization (`sanitizeFieldValue`) is applied to every LLM-returned value inside `validateParseResponse` before the fields are presented to the confirmation panel
- **Reentrancy guard on state subscriber:** `handleStateTransition` is async, but only one invocation runs at a time. If a second state change fires while a handler is in flight, it is queued or skipped (the state machine's own guards prevent invalid cascades). This prevents concurrent async handlers from overlapping.
- Integration tests simulate a full flow: start → transcript received → endpoint mock response → confirm → fields injected → done
- Integration tests cover each error path: permission denied, no speech, endpoint failure, cancel at confirmation, transcript too long

---

### P1-NEW-12 — Add reentrancy guard to state machine subscriber (incorporated into P1-08)

*Note: the reentrancy guard is folded into P1-08. It is listed here for traceability to the performance review finding (PERF 2.5).*

**Complexity:** S
**Depends on:** P1-08

---

### P1-NEW-06 — Add timer tracking and cleanup (incorporated into P1-08)

*Note: all timer tracking and cleanup requirements — retry backoff timer, auto-reset timer, cooldown timer, field highlight timers — are acceptance criteria of P1-08 and P1-06. Listed here for traceability to performance review finding (PERF 2.3 / 2.9 / 4.4).*

**Complexity:** S
**Depends on:** P1-06, P1-08

---

### P1-09 — Wire up the default UI rendering (vanilla)

Implement the default UI as a lightweight vanilla TypeScript module that renders the mic button and status text into a provided container element. This is NOT the Svelte component — it is the framework-agnostic default renderer used by the core package directly, and as the basis for the Svelte wrapper. It uses the `VoiceFormInstance` subscribe method to react to state changes.

**Complexity:** L
**Depends on:** P1-08
**Acceptance criteria:**
- `src/ui/default-ui.ts` exports `mountDefaultUI(container: HTMLElement, instance: VoiceFormInstance, strings: VoiceFormStrings): Unmount`
- Renders a mic button, optional status text area, and ARIA live region into `container`
- All ARIA attributes from UX_SPEC.md section 8.1 are applied and updated on state transitions
- All CSS is injected via a `<style>` tag or CSS-in-JS; no external stylesheet required
- CSS uses the custom property names from UX_SPEC.md section 9.2 exclusively; no hardcoded color values
- Button pulse animation and spinner animation are implemented in CSS
- `@media (prefers-reduced-motion: reduce)` rules are present for all animations including cooldown arc animation
- All user-facing strings come from the `strings` argument; no hardcoded English text in the module
- `Unmount` return value removes all DOM nodes and event listeners cleanly
- Renders the privacy notice panel (see P1-NEW-05) when `config.privacyNotice` is set

---

### P1-NEW-05 — Implement privacy notice UI

Implement the inline privacy disclosure panel described in UX_SPEC.md section 12. The notice displays before the microphone is activated when `privacyNotice` is configured.

**Complexity:** M
**Depends on:** P1-09 (default UI task)
**Acceptance criteria:**
- The privacy notice panel renders inline near the mic button, below it by default, when the user activates the button for the first time in a session and `privacyNotice` is configured
- When `requirePrivacyAcknowledgement` is `true`: the mic is NOT activated on button press; instead the notice is shown; the mic activates only after the user clicks "I understand"
- When `requirePrivacyAcknowledgement` is `false`: the notice is shown informatively but does not block mic activation; it auto-dismisses when recording begins
- Acknowledgement is tracked in a session-scoped variable (not `localStorage`); the notice does not appear again within the same page session after acknowledgement
- Panel uses `role="region"` and `aria-label="Voice input privacy notice"`; the "I understand" button is a standard `<button>` with correct `aria-label`
- An `aria-live="polite"` announcement fires when the notice appears: "Voice input privacy notice. [notice text]."
- All strings (button label, aria-labels) use the `strings.privacy.*` keys from UX_SPEC.md section 11.1
- CSS custom properties `--vf-privacy-bg`, `--vf-privacy-border`, `--vf-privacy-text-color`, `--vf-privacy-radius` are used exclusively; no hardcoded colors
- `Unmount` returned by `mountDefaultUI` also cleans up the privacy notice panel and its event listeners

---

### P1-10 — Implement confirmation panel UI (vanilla)

Implement the confirmation panel as a vanilla TypeScript UI module. The panel receives the `ParsedFields` data, renders the field list, handles Accept/Cancel user actions, and calls the appropriate `VoiceFormInstance` methods. It is not modal; it is positioned relative to its anchor element.

**Complexity:** L
**Depends on:** P1-09
**Acceptance criteria:**
- `src/ui/confirmation-panel.ts` exports `mountConfirmationPanel(anchor: HTMLElement, instance: VoiceFormInstance, fields: ParsedFields, strings: VoiceFormStrings): Unmount`
- Panel renders with all ARIA attributes from UX_SPEC.md section 5 (role="dialog", aria-label, field dl/dt/dd structure)
- **All field values are rendered using `element.textContent = value`, not via HTML injection of any kind.** This applies to every `<dd>` element, every editable input value, and every string sourced from LLM output. This is a security requirement, not a preference.
- When a field's `wasModified` flag is `true` (set by `sanitizeFieldValue` in the sanitization module), a `<span class="vf-sanitized-warning">` element is appended beside the field value with `aria-label="Value was modified — HTML was removed"` and `role="img"`. This icon uses `--vf-sanitized-warning-color`.
- **Deferred construction:** the panel DOM is not built at `createVoiceForm()` init time. The panel is constructed the first time the component enters the `confirming` state. On subsequent confirming states, the existing DOM is reused and populated with new field data.
- Focus is moved into the panel on open; initial focus lands on the Fill form button
- Tab cycles within the panel; focus does not escape to the page behind the panel
- Escape key cancels and returns focus to the anchor (mic button)
- Unrecognized fields render the "Not understood" badge with correct aria-label
- **Positioning uses a single batched read-then-write:** `button.getBoundingClientRect()` is called once; the result is used to compute the clamped left offset; `panel.style.left` (and `panel.style.top` if needed) is written once. No reads occur after writes. The panel does not reposition while it is open.
- Panel renders as bottom sheet below 480px viewport width (no `getBoundingClientRect()` needed for this path)
- CSS includes all panel custom properties from UX_SPEC.md section 9.2
- Reduced motion rules are included for panel open/close transitions
- `Unmount` removes all DOM nodes, event listeners, and focus trap cleanly

---

### P1-NEW-09 — Split default UI into subpath export

Define a separate package entry point so that consumers using headless mode pay zero bundle cost for the default UI module.

**Complexity:** M
**Depends on:** P0-04 (project setup), P1-09 (default UI task)
**Acceptance criteria:**
- `packages/core/package.json` `exports` field has two entries:
  - `"."` maps to `dist/core.mjs` — the headless core (state machine, STT adapter, endpoint client, injector, sanitization, validation) with no UI code
  - `"./ui"` maps to `dist/ui.mjs` — the default UI and confirmation panel only
- `@voiceform/svelte` and `@voiceform/react` (v2) import from `@voiceform/core/ui` explicitly
- A consumer using only `import { createVoiceForm } from '@voiceform/core'` (headless) does not include the default UI or confirmation panel in their bundle
- Headless bundle size verified by the CI check in P4-08: 5KB gzip maximum
- `tsup.config.ts` is updated with the split entry point configuration

---

### P1-11 — Export the public API from core index

Set up `src/index.ts` in `@voiceform/core` to export the correct public API surface. Only the types and functions that are part of the documented public API should be exported. Internal modules should not be directly importable by consumers.

**Complexity:** S
**Depends on:** P1-08, P1-09, P1-10
**Acceptance criteria:**
- `src/index.ts` exports: `createVoiceForm`, `VoiceFormConfig`, `VoiceFormSchema`, `VoiceFormField`, `VoiceFormState`, `VoiceFormInstance`, `VoiceFormStrings`, `VoiceFormResult`, `STTAdapter`, `VoiceFormConfigError`
- Internal modules (`state-machine.ts`, `prompt-builder.ts`, etc.) are NOT re-exported from the index
- `tsup` builds the index and produces correct type declarations
- A consumer can import `import { createVoiceForm } from '@voiceform/core'` and get full type inference
- No `any` in the generated `.d.ts` output

---

## Phase 2: Svelte Wrapper — v1

---

### P2-01 — Set up Svelte 5 in the svelte package

Install and configure Svelte 5 in `packages/svelte`. Add the Svelte plugin to tsup (or use a Svelte-specific build step). The package should produce compiled Svelte component output that consumers can use without a bundler plugin if possible, with a `.svelte` source export for consumers who prefer it.

**Complexity:** M
**Depends on:** P0-04, P1-01
**Acceptance criteria:**
- Svelte 5 and `@sveltejs/package` (or equivalent) installed in `packages/svelte`
- `tsup` or `svelte-package` builds the component to `dist/`
- Both a pre-compiled JS export and a raw `.svelte` file export are available (via `exports` field in `package.json`)
- `packages/svelte/package.json` has a peer dependency on `svelte: "^5.0.0"`
- `pnpm build` at root builds this package without errors

---

### P2-02 — Implement the VoiceForm Svelte component

Implement the main `<VoiceForm>` Svelte 5 component. This component wraps `createVoiceForm` from core, manages the instance lifecycle (create on mount, destroy on unmount), and renders the default UI (button + confirmation panel) using the core vanilla UI modules or equivalent Svelte template markup.

**Complexity:** L
**Depends on:** P1-11, P2-01
**Acceptance criteria:**
- `src/VoiceForm.svelte` accepts all `VoiceFormConfig` fields as props, plus `strings` and `headless` props
- Component creates a `VoiceFormInstance` on mount and calls `instance.destroy()` on unmount (Svelte `onMount`/`onDestroy`) — `destroy()` is required, not optional
- In default mode (not headless): renders the mic button and confirmation panel; all states are visually reflected
- In headless mode: renders nothing; exposes the instance via a Svelte `bind:this` reference or a context
- All ARIA attributes from UX_SPEC.md are present in the template markup
- Component does not use any deprecated Svelte 4 APIs (must use Svelte 5 runes or the new composition API)
- Passes through `class` prop for developer styling of the root element

---

### P2-03 — Implement Svelte store integration

Expose the voice-form state as a Svelte readable store so developers can reactively bind to state changes in their own Svelte templates.

**Complexity:** M
**Depends on:** P2-02
**Acceptance criteria:**
- `src/stores.ts` exports `createVoiceFormStore(instance: VoiceFormInstance): Readable<VoiceFormState>`
- The store uses `instance.subscribe` to stay in sync with the core state machine
- The store correctly unsubscribes when the component unmounts (no memory leaks)
- A developer can write `$voiceFormState === 'recording'` in their template and it works reactively
- Unit test verifies the store emits each state value in the correct order during a simulated flow

---

### P2-04 — Implement slots/snippets API for custom UI in Svelte

Allow developers to replace the default button and/or confirmation panel with their own UI using Svelte 5 snippets (or slots in Svelte 4 compatibility mode). The developer's custom UI receives the current state and relevant callbacks via snippet parameters.

**Complexity:** M
**Depends on:** P2-02
**Acceptance criteria:**
- `<VoiceForm>` accepts a `button` snippet that receives `{ state, onActivate, onStop }` as parameters
- `<VoiceForm>` accepts a `confirmation` snippet that receives `{ fields, onConfirm, onCancel }` as parameters
- When a snippet is provided, the default UI for that area is not rendered
- When no snippet is provided, the default UI renders as normal
- Documentation example shows a complete custom button implementation using the snippet API
- The default rendering path is not affected when no snippets are passed

---

### P2-05 — Write Svelte wrapper unit and component tests

Write tests for the Svelte wrapper using Vitest and `@testing-library/svelte`. Tests should verify component mounting, prop passing, state-driven rendering, and store reactivity. Mock `@voiceform/core`'s `createVoiceForm` to isolate Svelte-layer concerns.

**Complexity:** L
**Depends on:** P2-02, P2-03, P2-04
**Acceptance criteria:**
- Test file `test/VoiceForm.test.ts` covers: component mounts without errors, renders button in idle state, reflects recording state (correct class/aria-label), confirmation panel appears when state is `confirming`, Cancel closes the panel, Fill form triggers `onFill`
- Store test verifies reactive updates on state transitions
- Snippet API test verifies that a custom button snippet renders and receives correct props
- All tests pass in CI
- Test coverage for the Svelte package is above 75% lines

---

## Phase 3: Documentation and Demo — v1

---

### P3-01 — Write the README quickstart

Write the root `README.md` (and `packages/core/README.md`) with a complete quickstart that gets a developer from zero to a working voice form in under 20 minutes. Focus on copy-paste usability: every code block should be runnable without modification.

**Complexity:** M
**Depends on:** P2-02 (to validate examples work)
**Acceptance criteria:**
- README covers: installation, basic Svelte usage, minimal server endpoint example (SvelteKit route), schema config reference
- All code examples are syntactically correct TypeScript/Svelte
- The BYOE endpoint contract is explained: what the library POSTs, what format the response must be
- A "zero-to-working" path exists that requires no account creation, no API key setup in the library, and no framework-specific knowledge beyond Svelte basics
- A "first use is slow" note documents that the browser permission prompt is a one-time cost not controlled by the library
- A human (not the author) should be able to follow the README and have a working form in under 20 minutes — tested before release

---

### P3-02 — Write API reference documentation

Write comprehensive API reference documentation covering `VoiceFormConfig`, `VoiceFormField`, `VoiceFormInstance`, `STTAdapter`, and `VoiceFormStrings`. Each type/interface should have all fields documented with type, default value, whether it is required, and a 1-2 sentence explanation.

**Complexity:** M
**Depends on:** P1-11
**Acceptance criteria:**
- `docs/api-reference.md` exists and covers all exported types and functions
- Every required field is marked as required; every optional field documents its default
- `VoiceFormConfig.onFill` callback signature is fully documented (parameter types, expected behavior, whether async is supported)
- `VoiceFormConfig.privacyNotice`, `requirePrivacyAcknowledgement`, `cooldownMs`, and `maxTranscriptLength` are documented
- `VoiceFormInstance.destroy()` is documented as required for correct cleanup
- The endpoint response contract is documented as a typed interface with example JSON
- JSDoc comments in `types.ts` match the prose in the API reference (they are in sync)

---

### P3-03 — Build the demo site

Build the demo site as a realistic Svelte 5 SPA. The demo should show voice-form working on a form with at least 5 fields of mixed types (text, email, select, number, date). The demo should include a mock endpoint (handled in the Vite dev server or a Netlify function) so visitors can run the full flow without setting up their own server.

**Complexity:** XL
**Depends on:** P2-02, P3-01
**Acceptance criteria:**
- Demo has a realistic form: at minimum first name, last name, email, a select field, and a numeric field
- Demo has a mock BYOE endpoint that uses a real LLM call (with a rate-limited key baked into the demo deployment, or a user-provided key via a settings UI)
- Alternatively, demo has a "simulate" mode that uses a canned response for visitors who do not want to set up a key
- Confirmation panel renders correctly in the demo
- Demo site is deployable to Netlify or Vercel with a single command
- Demo includes a "View the code" link that shows the relevant Svelte snippet for the form shown
- Demo is mobile-responsive

---

### P3-04 — Write a SvelteKit reference endpoint implementation

Write a complete, copy-paste-ready SvelteKit API route (`+server.ts`) that implements the BYOE endpoint contract. The reference implementation should use the OpenAI SDK but be clearly structured so developers can swap in another LLM provider.

**Complexity:** M
**Depends on:** P1-05 (to confirm payload shape is final), P3-02
**Acceptance criteria:**
- `docs/examples/sveltekit-endpoint.ts` is a complete, working SvelteKit server route
- Receives the `EndpointPayload`, constructs an LLM prompt using `@voiceform/server-utils` (`buildSystemPrompt`, `buildUserPrompt`), calls the LLM API, parses the response, and returns `ParsedFieldsResponse`
- Uses role-separated prompts: `buildSystemPrompt(schema)` produces the system message; `buildUserPrompt(transcript)` wraps the transcript in `JSON.stringify()` before embedding it in the user message — this prevents prompt injection via crafted speech
- Validates the `X-VoiceForm-Request: 1` header as a CSRF signal; rejects requests without it
- Includes error handling for: API key missing, LLM API error, parse failure
- Includes inline comments explaining each section and the security rationale for header validation
- Uses the OpenAI SDK (documented) but explicitly comments where to replace with another provider
- The example does not expose the API key to the browser in any code path

---

### P3-05 — Write a Next.js reference endpoint implementation

Write an equivalent reference endpoint for Next.js App Router (`route.ts`). Same requirements as P3-04 but for the Next.js pattern.

**Complexity:** S
**Depends on:** P3-04
**Acceptance criteria:**
- `docs/examples/nextjs-endpoint.ts` is a complete Next.js App Router route handler
- Uses the same `@voiceform/server-utils` prompt construction and `JSON.stringify`'d transcript as P3-04
- Validates the `X-VoiceForm-Request: 1` header
- Handles POST requests; returns the same `ParsedFieldsResponse` shape
- Documented in the API reference as the React ecosystem entry point

---

### P3-06 — Write an Express reference endpoint implementation

Write an equivalent reference endpoint for plain Express.js. This serves developers not using a meta-framework.

**Complexity:** S
**Depends on:** P3-04
**Acceptance criteria:**
- `docs/examples/express-endpoint.ts` is a working Express route
- Uses the same `@voiceform/server-utils` prompt construction and `JSON.stringify`'d transcript as P3-04
- Validates the `X-VoiceForm-Request: 1` header
- Includes `CORS` header setup since the form and server may be on different origins
- Documented in the API reference

---

### P3-07 — Write the security threat model document

Document the security posture of the BYOE pattern. Explain what voice-form does and does not protect against. This is required for v1.0 per the roadmap.

**Complexity:** M
**Depends on:** P3-02
**Acceptance criteria:**
- `docs/security.md` exists
- Documents: what data leaves the browser (transcript, schema), what data never leaves the browser (nothing — all data goes to developer's endpoint), that voice-form never receives LLM API keys
- Documents threat vectors the developer is responsible for: endpoint authentication, rate limiting, prompt injection via user speech
- Documents threat vectors the library addresses: output sanitization (stripHtml on all LLM values), transcript validation (length and control char rejection), CSRF signal header, no third-party data transmission, no telemetry
- Documents the output sanitization contract: all LLM values are stripped of HTML before confirmation panel display and before `onFill` callback invocation
- Documents the prompt injection mitigation: transcripts are `JSON.stringify`'d before embedding in LLM prompts (developer responsibility, demonstrated in reference endpoints)
- Reviewed by at least one other team member before merge

---

### P3-NEW-14 — Write PRIVACY.md

Document the data flows for all supported STT providers, audio retention policies, and GDPR/privacy considerations developers must address when deploying voice-form.

**Complexity:** M
**Depends on:** P3-02
**Acceptance criteria:**
- `docs/PRIVACY.md` exists
- Documents Web Speech API data flow: audio is sent to Google's speech recognition infrastructure; retention and processing are governed by Google's privacy policy; the library has no control over this
- Documents Whisper adapter data flow (v2): audio is sent to the developer's server endpoint, which transmits it to OpenAI; retention is governed by OpenAI's API policy and the developer's own data handling
- Provides guidance on GDPR Article 13 disclosure requirements: developers deploying voice-form in EU contexts must inform users of audio processing via a privacy notice (the `privacyNotice` config option supports this)
- Recommends specific microcopy strings for the `privacyNotice` option for each STT provider (see UX_SPEC.md section 12.3 for suggested strings)
- References from README and from the `privacyNotice` API documentation

---

### P3-NEW-15 — Add BYOE Security section to docs

Add a dedicated security guidance section to the developer documentation covering the security controls developers must implement on their BYOE endpoint.

**Complexity:** M
**Depends on:** P3-07
**Acceptance criteria:**
- `docs/security.md` (extending P3-07) or a separate `docs/byoe-security.md` includes a section titled "Securing Your BYOE Endpoint"
- Covers with code examples: CSRF header validation (`X-VoiceForm-Request: 1`), authentication requirements (the endpoint should be authenticated; voice-form does not handle auth), rate limiting (recommended: per-user, per-minute limits), prompt injection mitigation (use `JSON.stringify` on transcripts, use role-separated prompts, do not interpolate raw user speech into system prompts), output validation (what to do if the LLM returns unexpected field types or values)
- Each security control has a code example for at least one framework (SvelteKit preferred; can reference the reference endpoints)
- Document is linked from the README and API reference

---

## Phase 4: Testing and QA — v1

---

### P4-01 — Write unit tests for state machine

Write comprehensive unit tests for `src/state-machine.ts`. Every valid transition and every invalid transition (from every state) should be tested.

**Complexity:** M
**Depends on:** P1-02
**Acceptance criteria:**
- Test file covers all 7 states and all events
- Every valid transition has at least one test
- Every state has tests for at least 2 invalid events (events that should not change state)
- Tests are deterministic and do not depend on timing or browser APIs
- Coverage for `state-machine.ts` is 100% lines and branches

---

### P4-02 — Write unit tests for prompt builder and schema validator

Write unit tests for `src/prompt-builder.ts` and `src/schema-validator.ts`.

**Complexity:** S
**Depends on:** P1-04, P1-05
**Acceptance criteria:**
- Prompt builder tests cover: typical 5-field schema, single-field schema, empty transcript, special characters in transcript
- Schema validator tests cover: valid schema, empty array, missing `name`, missing `type`, invalid `type`, duplicate field names
- All tests are pure (no browser API dependencies, no network)
- Combined coverage for both modules is 100%

---

### P4-03 — Write unit tests for endpoint client

Write unit tests for `src/endpoint-client.ts` using `fetch` mocking via `vi.stubGlobal` or `msw`.

**Complexity:** M
**Depends on:** P1-06
**Acceptance criteria:**
- Tests cover: 200 OK with valid response, 200 OK with malformed JSON, 500 error, 404 error, network failure (fetch throws), timeout (AbortController fires)
- The `timeoutMs` option is tested: a slow response that exceeds the timeout produces a `TimeoutError`
- The `X-VoiceForm-Request: 1` header is verified present on every request, including retries
- Abort during retry backoff: verify that calling `abort()` during the backoff window cancels the pending retry timer and no further request is sent
- Tests do not make real network requests
- Coverage for `endpoint-client.ts` is above 90%

---

### P4-04 — Write unit tests for DOM injector

Write unit tests for `src/injector.ts`.

**Complexity:** S
**Depends on:** P1-07
**Acceptance criteria:**
- Tests cover: all fields filled successfully, `onFill` async callback, one callback throws (others still called), all callbacks reject
- `InjectionResult` shape is verified in each test
- Tests use simple mock callback functions; no real DOM is required
- Coverage is 100%

---

### P4-NEW-17 — Add sanitization tests

Write unit tests for `src/utils/sanitize.ts` covering the full range of malicious and edge-case inputs.

**Complexity:** S
**Depends on:** P1-NEW-01
**Acceptance criteria:**
- Test file covers `stripHtml` and `sanitizeFieldValue`
- `stripHtml` tests include: plain text unchanged, script tag content removed, bold tag removed with text preserved, img tag with event handler attributes stripped, HTML entities preserved as-is by textContent extraction
- `sanitizeFieldValue` tests include: number field with `"42"` (valid), number field with injected HTML digits that strip to a valid number (wasModified true), select field with valid option value (unchanged), select field with value not in options (flagged), date field with valid ISO date (unchanged)
- Zero false positives: plain text strings with angle brackets that are not HTML tags (e.g., `"temperature < 100"`) must round-trip correctly
- Coverage is 100%

---

### P4-05 — Write integration tests for createVoiceForm

Write end-to-end integration tests that exercise `createVoiceForm` through a complete flow, using mocked browser APIs (SpeechRecognition, fetch). These tests should simulate the full state machine traversal from idle to done.

**Complexity:** L
**Depends on:** P1-08, P4-01, P4-02, P4-03, P4-04
**Acceptance criteria:**
- At least one full happy-path test: idle → recording → processing → confirming → injecting → done
- Error path tests: permission denied (idle → error), endpoint failure (processing → error), user cancel (confirming → idle), transcript too long (recording → error)
- State subscription tests: a subscriber receives the full sequence of state changes
- Sanitization integration test: a mock LLM response containing a script tag in a field value is sanitized before confirmation panel receives it; `wasModified` is true; the confirmation panel renders the sanitized value as plain text
- Privacy notice integration test: with `requirePrivacyAcknowledgement: true`, calling `start()` without prior acknowledgement does not transition to recording; after acknowledgement, `start()` proceeds normally
- Tests run in jsdom environment; browser APIs are mocked via vitest or msw
- Core package reaches 85% overall coverage after these tests are included

---

### P4-NEW-18 — Add memory leak regression test

Verify that repeated mount/unmount cycles do not cause listener accumulation or memory growth.

**Complexity:** M
**Depends on:** P1-08
**Acceptance criteria:**
- Test mounts a `VoiceFormInstance` (or the Svelte component in jsdom) 100 times and calls `destroy()` (or unmounts) each time
- After all cycles, verify that the state machine's listener Set has zero entries
- Verify that no `setTimeout` IDs remain active from the destroyed instances (use fake timers via Vitest's timer mocking)
- Test passes consistently (no flakiness); it is included in the standard `pnpm test` run
- This test is the regression guard for the memory leak finding (PERF 2.6)

---

### P4-06 — Write Playwright browser integration tests

Write Playwright tests that run the demo site in a real browser and simulate a complete voice-form flow. Since Web Speech API cannot be triggered programmatically in Playwright, use a test-only mode in the demo that accepts a canned transcript via a URL parameter, bypassing the STT layer.

**Complexity:** L
**Depends on:** P3-03
**Acceptance criteria:**
- `e2e/` directory at root with Playwright config
- Tests run against the locally built demo site (`pnpm preview`)
- Happy path test: page loads, button is visible and in idle state, canned-transcript mode triggers processing, confirmation panel appears with correct fields, Fill form fills the form fields
- Cancel test: confirmation panel opens, user cancels, form is unchanged
- Error test: endpoint returns 500, error state is shown on button
- Privacy notice test: demo configured with `privacyNotice`; button press shows notice before recording starts; "I understand" click proceeds to recording
- Tests run in CI on Chromium; optionally on Firefox and Safari
- `pnpm test:e2e` runs the Playwright suite

---

### P4-07 — Conduct accessibility audit

Perform a structured accessibility audit of the component using both automated tooling (axe-core via Playwright) and manual keyboard-only testing. Document findings and resolve all WCAG 2.1 AA violations before v1.0 release.

**Complexity:** M
**Depends on:** P4-06
**Acceptance criteria:**
- `axe-core` integrated into Playwright tests via `@axe-core/playwright`; zero violations on the demo page
- Manual keyboard-only test documented: tab to button, Space to start recording, navigate confirmation panel, Enter to fill form — all operable without a pointer device
- Manual screen reader test documented (VoiceOver on macOS or NVDA on Windows): state change announcements verified, confirmation panel announced correctly, privacy notice region announced when shown
- All color contrast ratios from UX_SPEC.md section 8.5 verified, including sanitization warning icon and privacy notice panel
- Findings log written; any issues resolved before the audit is marked complete

---

### P4-08 — Bundle size audit

Measure and document the bundle size of `@voiceform/core` and `@voiceform/svelte`. Establish a size budget and add a CI check that fails if the budget is exceeded.

**Complexity:** S
**Depends on:** P0-04, P1-11, P2-02, P1-NEW-09
**Acceptance criteria:**
- Bundle sizes are measured using `size-limit` configured to measure the actual tree-shaken output for a representative import — not raw file size
- Headless core (`import { createVoiceForm } from '@voiceform/core'`, no UI): 5KB gzip maximum
- Full core with UI (`import { createVoiceForm } from '@voiceform/core'; import { DefaultUI } from '@voiceform/core/ui'`): 8KB gzip maximum
- `@voiceform/svelte`: 4KB gzip maximum (excluding core)
- CI step (added to `.github/workflows/ci.yml`) fails if any budget is exceeded
- Bundle contents are analyzed (e.g., via `rollup-plugin-visualizer` or equivalent); any unexpected large dependencies are documented
- Confirmation that no LLM prompt template strings appear in the browser bundle (verified by bundle analysis)

---

### P4-NEW-19 — Add injection performance benchmark

Verify that the batched DOM injection path meets the 16ms target for large forms.

**Complexity:** S
**Depends on:** P1-07
**Acceptance criteria:**
- A benchmark (Vitest bench or a standalone script) exercises the injection path with 20 fields using the batched `requestAnimationFrame` write-then-dispatch pattern
- Benchmark runs in jsdom environment with real DOM element creation
- Median injection time for 20 fields is under 16ms on the CI runner hardware
- The benchmark is part of the `pnpm test` suite or a separate `pnpm bench` script; it fails CI if the 16ms target is not met
- This benchmark is the regression guard for the injection performance finding (PERF 2.4 / 4.1)

---

## Phase 5: Release — v1

---

### P5-01 — Set up npm publish pipeline

Configure the npm publish workflow for `@voiceform/core` and `@voiceform/svelte`. Publishing should be triggered manually via GitHub Actions (workflow_dispatch or on tag push), not on every commit.

**Complexity:** M
**Depends on:** P0-08, P0-09
**Acceptance criteria:**
- `.github/workflows/publish.yml` exists and is triggered on tag push matching `v*.*.*`
- Workflow runs the full CI pipeline before publishing (no publish without passing tests)
- Uses `pnpm changeset publish` to handle versioning and npm registry upload
- npm provenance is enabled (`--provenance` flag)
- Requires a repository secret `NPM_TOKEN` — documented in `CONTRIBUTING.md`
- Dry-run mode available for testing the workflow without publishing

---

### P5-02 — Configure package.json exports fields for both packages

Ensure the `exports` field in each package's `package.json` correctly maps all entry points (ESM, CJS, types). Verify that tree-shaking works correctly by importing only specific submodules in a test consumer.

**Complexity:** S
**Depends on:** P0-04, P1-11, P2-02, P1-NEW-09
**Acceptance criteria:**
- `packages/core/package.json` has correct `main`, `module`, `types`, and `exports` fields, including both `"."` (headless core) and `"./ui"` (default UI) subpath exports
- `packages/svelte/package.json` exports both a compiled JS entry and a `.svelte` source entry
- A `publint` check passes on both packages (add `pnpm publint` to CI)
- Tree-shaking test: a consumer bundle that imports only `createVoiceForm` does not include the default UI renderer
- The `files` field in each `package.json` is set correctly (only `dist/` and `src/`, not test files or tsup config)

---

### P5-03 — Build CDN distribution

Produce a single-file IIFE/UMD bundle suitable for use via CDN (`<script>` tag). This allows developers who are not using a bundler to try voice-form without an npm install.

**Complexity:** M
**Depends on:** P1-11
**Acceptance criteria:**
- `packages/core/tsup.config.ts` has an additional build target producing `dist/voice-form.iife.js` (minified)
- The IIFE bundle exposes a `VoiceForm` global on `window`
- CDN build is under 12 KB minified + gzipped (including the default UI)
- A usage example in the docs shows the `<script>` tag CDN pattern with the vanilla JS API
- CDN build is included in the npm package output and listed in `exports`
- CDN usage documentation includes Subresource Integrity (SRI) hash guidance: the docs must explain how to generate and use the `integrity` attribute on the `<script>` tag, and the CI publish pipeline must output the SRI hash for each release

---

### P5-04 — Write the CHANGELOG and tag v1.0

Write the initial CHANGELOG using the Changesets entries accumulated during development. Tag the release on GitHub. Draft the GitHub Release with release notes targeting the v1.0 acceptance criteria from the roadmap.

**Complexity:** S
**Depends on:** P5-01, P5-02, P5-03, all Phase 4 tasks complete
**Acceptance criteria:**
- `CHANGELOG.md` at repo root is generated by `pnpm changeset version`
- GitHub Release is drafted with: What's new, installation instructions, known limitations, link to demo site
- Git tag `v1.0.0` is created and pushed
- Both packages are published to npm at version `1.0.0`
- npm package pages for both packages include a description, homepage link, and README preview

---

## Phase 6: v2 Features

---

### P6-01 — Implement the React wrapper (@voiceform/react)

Create the `packages/react` package and implement a `<VoiceForm>` React component (functional, hooks-based) that wraps `createVoiceForm` from core. The React component should have the same prop interface as the Svelte component for equivalent configuration.

**Complexity:** XL
**Depends on:** P1-11 (v1 core must be stable), P5-04 (v1.0 released)
**Acceptance criteria:**
- `packages/react/package.json` with `name: "@voiceform/react"` and peer dep on `react: ">=18"`
- `<VoiceForm>` React component accepts the same props as the Svelte component
- Component uses `useEffect` for instance lifecycle (create on mount, `instance.destroy()` on unmount)
- State changes are reflected via `useState` or `useReducer` in the component
- A `useVoiceForm` hook is exported for headless usage (returns instance, state, start/stop/confirm/cancel functions)
- Test suite using `@testing-library/react` covers the same scenarios as the Svelte test suite
- Package builds and publishes alongside core

---

### P6-02 — Implement the Whisper STT adapter (@voiceform/adapter-whisper)

Create the `packages/adapter-whisper` package implementing the `STTAdapter` interface using the OpenAI Whisper API. The adapter records audio using the browser's `MediaRecorder` API, sends the audio blob to the developer's configured endpoint (maintaining BYOE), and returns the transcript.

**Complexity:** XL
**Depends on:** P1-01 (STTAdapter interface must be stable)
**Acceptance criteria:**
- `packages/adapter-whisper/src/index.ts` exports a `WhisperAdapter` class implementing `STTAdapter`
- Uses `MediaRecorder` to capture audio; handles: permission request, format selection (webm/ogg/mp4 based on browser support), stop-on-silence (via audio level analysis or fixed duration)
- Does NOT call OpenAI directly — sends audio to developer's configured endpoint; the adapter's endpoint contract accepts a `FormData` with an audio file and returns a `{ transcript: string }` response
- The audio Blob and the `MediaRecorder` chunks array are explicitly dereferenced after the POST response is received (success or error) and in `abort()` — prevents Blob memory leaks
- `isSupported(): boolean` returns false when `MediaRecorder` is absent
- Reference endpoint example (Express, SvelteKit, Next.js) is added to docs
- Unit tests mock `MediaRecorder` and cover: successful transcription, permission denied, empty audio, endpoint failure

---

### P6-03 — Implement partial fill support (append mode)

Modify the core processing and confirmation logic to support partial fills — where the user's speech only addresses some of the form fields. This is distinct from a parse error; partial fill is expected and valid behavior. Fields not mentioned are left unchanged.

**Complexity:** L
**Depends on:** P1-08 (factory must be stable), P6-01 or P6-02 started (v2 development phase)
**Acceptance criteria:**
- `VoiceFormConfig` gains an optional `fillMode: 'replace' | 'append'` field (default: `'replace'`)
- In `'replace'` mode (v1 behavior): all schema fields are requested; unrecognized fields show the "Not understood" badge
- In `'append'` mode: only fields mentioned by the user are included in the confirmation panel; form fields not addressed are not shown and will not be touched by injection
- The LLM response contract is updated to support `null` values for fields the LLM did not extract (distinct from fields it got wrong)
- Integration tests verify that in append mode, a partial transcript fills only the addressed fields
- Confirmation panel correctly shows only the addressed fields in append mode

---

### P6-04 — Implement multi-step form support

Extend the component to support multi-step (wizard) forms where the developer provides a different schema per step, and voice sessions can span steps.

**Complexity:** L
**Depends on:** P1-08, P6-03
**Acceptance criteria:**
- `VoiceFormConfig` gains an optional `step` identifier (string or number)
- `VoiceFormInstance` gains a `setStep(step: string | number, schema: VoiceFormSchema): void` method
- When `setStep` is called, the active schema updates; the next voice session uses the new schema
- The developer can call `setStep` when their form navigates to a new step (driven by their own step logic)
- Demo site updated to show a 3-step form (contact info → order details → preferences) with voice input on each step
- Integration tests verify schema changes are reflected in the next voice session after `setStep`

---

### P6-05 — Implement DOM schema auto-detection (@voiceform/dom-detect)

Create the `packages/dom-detect` package as an optional utility that analyzes a form's DOM and generates a `VoiceFormSchema` automatically. This is experimental and opt-in; explicit schema config remains the recommended approach.

**Complexity:** XL
**Depends on:** P1-04 (schema validation), P5-04 (v1 stable)
**Acceptance criteria:**
- `packages/dom-detect` exports `detectSchema(formElement: HTMLFormElement): VoiceFormSchema`
- Detects `<input>`, `<textarea>`, and `<select>` elements; uses `name`, `id`, `placeholder`, `aria-label`, and associated `<label>` text to infer field names and descriptions
- Maps HTML `input[type]` to `VoiceFormField['type']` (text, email, number, date, etc.)
- Fields without any identifiable name are assigned a generated name and flagged with a `autoDetected: true` annotation
- Explicitly documented as experimental: the developer should review the generated schema before using in production
- Unit tests cover: standard form, form with no labels, select fields, nested fieldsets

---

### P6-06 — Implement field-level correction UX in confirmation panel

Extend the confirmation panel to allow inline editing of individual field values before accepting. This is the v2 enhancement described in UX_SPEC.md section 5.4.

**Complexity:** M
**Depends on:** P1-10 (confirmation panel must exist), P6-01 started
**Acceptance criteria:**
- Confirmation panel field rows become editable inputs when clicked (or focused and Enter pressed)
- Tab navigates between editable fields in schema order
- The "Fill form" button label changes to "Fill form (edited)" if any field was manually changed
- Clearing a field value treats that field as unrecognized (it will not be filled)
- The `onFill` callback receives the corrected values, not the original LLM values
- Changes are reflected in the Svelte AND React wrapper confirmations panels (both updated)
- Accessibility: each input has an aria-label of "[Field name] — edit value"; focus management is unchanged

---

### P6-07 — Build and publish the @voiceform/dev stub package

Create a local development stub package that implements the BYOE endpoint contract without requiring a real server or LLM API key. This allows developers to prototype with voice-form in a frontend-only environment.

**Complexity:** M
**Depends on:** P1-05 (endpoint contract must be stable)
**Acceptance criteria:**
- `packages/dev` exports a `createStubEndpoint(responses: StubResponseMap): RequestHandler` where `StubResponseMap` maps schema field names to static values
- The stub can be used as a Vite dev server middleware or a standalone Express handler
- Documented usage: add to `vite.config.ts` as a server middleware; configure per-field canned values
- A "random mode" provides randomized plausible values based on field type (for demos)
- The stub correctly implements the BYOE response contract — apps that work with the stub work unmodified with a real endpoint
- Published to npm as `@voiceform/dev` with a clear "development only" warning in the README

---

*End of task list*
