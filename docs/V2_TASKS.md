# voice-form V2 — Implementation Tasks

**Status**: Ready for engineering  
**Date**: 2026-04-01  
**Version**: 2.0  
**References**: V2_LOW_LEVEL_DESIGN.md, V2_HIGH_LEVEL_DESIGN.md, V2_FRONTEND_DESIGN.md  

All tasks follow TDD: write tests first, then implementation. Every task must pass `pnpm typecheck`, `pnpm lint`, and `pnpm test` in the affected package before being considered complete.

---

## Wave Dependency Map

```
Wave 1 (parallel):  P6-01, P6-02, P6-03, P6-04, P6-05
Wave 2 (parallel):  P6-06, P6-07, P6-08, P6-09    ← depends on Wave 1
Wave 3 (parallel):  P6-10, P6-11                   ← depends on Wave 2
Wave 4 (parallel):  P6-12, P6-13, P6-14            ← depends on Wave 2 + Wave 3
Wave 5 (serial):    P6-15, P6-16                   ← depends on all above
```

---

## Wave 1 — Foundations (all parallel)

---

### P6-01: Extend core type definitions for v2

**Description**: Add all v2 type additions to `packages/core/src/types.ts` as specified in LLD section 1. This includes the new fields on `ConfirmedField`, `ConfirmationData`, `VoiceFormConfig`, `VoiceFormInstance`, `InjectorConfig`, `VoiceFormEvent` (FIELD_CORRECTED), `VoiceFormStrings`, and `VoiceFormCSSVars`. All additions are backward-compatible — no existing fields are removed or renamed.

**Complexity**: M  
**Dependencies**: None  

**Acceptance criteria**:
- `ConfirmedField` has `existingValue?: string`, `userCorrected?: boolean`, `originalValue?: string`
- `ConfirmationData` has `appendMode: boolean`
- `VoiceFormConfig` has `appendMode?`, `multiStep?`, `autoDetectSchema?`, `onSchemaDetected?`, `allowFieldCorrection?`
- `VoiceFormInstance` declares `setSchema()`, `getSchema()`, `correctField()`
- `InjectorConfig` has `appendMode?`, `multiStep?`
- `VoiceFormEvent` union includes `{ type: 'FIELD_CORRECTED'; confirmation: ConfirmationData }`
- `VoiceFormStrings.confirm` has all new correction and append mode string keys
- `VoiceFormStrings.announcements` has `fieldEditOpened`, `fieldEditSaved`
- `VoiceFormCSSVars` has all new `--vf-*` custom property declarations
- `pnpm typecheck` passes in `packages/core`
- No existing types changed in a breaking way
- Unit test: compile-time type tests (using `satisfies` or `@ts-expect-error` comments) covering each new field to catch regressions

---

### P6-02: Add FIELD_CORRECTED to state machine

**Description**: Extend `transitionFromConfirming` in `packages/core/src/state-machine.ts` to handle the `FIELD_CORRECTED` event as specified in LLD section 2.2. The transition must produce a new state object containing the `confirmation` from the event payload — it must never mutate the existing state. Write tests first.

**Complexity**: S  
**Dependencies**: P6-01 (type definitions for `FIELD_CORRECTED`)  

**Acceptance criteria**:
- `transitionFromConfirming` with `FIELD_CORRECTED` event returns a new `{ status: 'confirming', transcript, confirmation: event.confirmation }` object
- The returned state object is a new reference — verified by `expect(nextState).not.toBe(prevState)` in tests
- `FIELD_CORRECTED` dispatched from any state other than `confirming` is ignored (existing `warnInvalid` path)
- Existing `CONFIRM` and `CANCEL` transitions in `confirming` are unaffected
- Test file: `packages/core/src/__tests__/state-machine.test.ts` — add `FIELD_CORRECTED` test table
- All existing state machine tests still pass

---

### P6-03: Implement Whisper STT adapter

**Description**: Implement `packages/core/src/adapters/whisper.ts` as specified in LLD section 5. The adapter satisfies the `STTAdapter` interface, handles MediaRecorder MIME type selection, collects audio chunks, POSTs to the transcription endpoint, validates the response, and performs complete Blob cleanup. All security constraints (abort flag ordering, cross-session cleanup, transcript validation) must be implemented exactly as specified.

**Complexity**: XL  
**Dependencies**: P6-01 (type definitions)  

**Acceptance criteria**:
- `WhisperAdapter` class implements `STTAdapter` interface — verified by type assignment test
- `isSupported()` returns false in Node.js test environment (no MediaRecorder)
- `abort()`: sets `this.aborted = true` **before** calling `recorder.stop()` — verified by test that mocks MediaRecorder and asserts call order
- `start()`: aborts any prior in-flight POST (prior `postAbortController.abort()` called before creating new one)
- `abort()`: no `onFinal` called — verified by test
- `stop()`: `onFinal` called with transcript from successful POST
- Transcript validation: if `transcript` field is not a string, `onError` is called with `code: 'UNKNOWN'` and descriptive message
- Transcript validation: strings exceeding 10,000 chars are truncated to 10,000 before `onFinal`
- Blob cleanup: `this.chunks = []` after Blob assembly; `this.audioBlob = null` in `finally` after POST
- Stream cleanup: `mediaStream.getTracks().forEach(t => t.stop())` called on stop, abort, and error paths
- Error mapping: see LLD table 5.9 — each failure maps to the correct `STTErrorCode`
- MIME type selection: `audio/webm;codecs=opus` preferred; falls back through priority list
- `X-VoiceForm-Request: 1` header included on all transcription POSTs
- Bundle size check: `@voiceform/core/adapters/whisper` subpath ≤ 3 KB gzip after build
- Test coverage: start/stop/abort lifecycle; error paths; transcript validation; Blob cleanup lifecycle (using mock fetch and MediaRecorder)

---

### P6-04: Implement detect-schema module

**Description**: Implement `packages/core/src/detect-schema.ts` as specified in LLD section 6. The function scans a form element's DOM structure, resolves labels using the 6-step priority algorithm, infers field types, handles radio groups, truncates labels to 100 characters, and excludes hidden/password/button fields. Export this as a separate subpath `@voiceform/core/detect-schema`.

**Complexity**: L  
**Dependencies**: P6-01 (type definitions for `FormSchema`)  

**Acceptance criteria**:
- `detectSchema(formElement)` returns a `FormSchema` with correct field names, labels, types, options, and required flags
- Label resolution follows the 6-step priority order (tested independently per step)
- Labels are truncated to exactly 100 characters — test with a label of 101 and 100 chars
- `aria-labelledby` with space-separated id list is joined with a single space
- Radio groups are deduplicated by name; fieldset/legend ancestor resolution tested
- `<select>` options extraction excludes the empty value placeholder option
- Excluded elements: `type="hidden"`, `type="submit"`, `type="reset"`, `type="button"`, `type="image"`, `type="password"`, nameless-and-idless elements
- `console.warn` emitted for nameless-and-idless elements (spy-tested)
- Password fields (`type="password"`) are excluded entirely — no entry in returned schema
- Module is NOT imported at the top of `create-voice-form.ts` (verified by grep in CI)
- Bundle size check: `@voiceform/core/detect-schema` subpath ≤ 2 KB gzip after build
- Test environment: jsdom (for DOM queries in Vitest/Jest)

---

### P6-05: Create @voiceform/react package scaffolding

**Description**: Set up the `packages/react/` package with `package.json`, `tsconfig.json`, `tsup.config.ts`, and the directory structure as specified in LLD section 8.1–8.2. Create stub implementations of `useVoiceForm.ts`, `VoiceForm.tsx`, `types.ts`, and `index.ts` that pass type checking. Add the package to the monorepo workspace configuration.

**Complexity**: S  
**Dependencies**: P6-01  

**Acceptance criteria**:
- `packages/react/package.json` has correct `peerDependencies` (`react >=18`, `react-dom >=18`, `@voiceform/core >=2.0.0`)
- `"sideEffects": false` in `package.json`
- `tsup.config.ts` lists `react`, `react-dom`, `react/jsx-runtime`, and `@voiceform/core` as `external`
- `pnpm typecheck` passes in `packages/react` (stubs can return placeholder values)
- `pnpm build` in `packages/react` produces `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts`
- Package appears in `pnpm -r ls` (workspace recognized)
- No `@voiceform/core` code in the bundled output (verified by inspecting the built artifact)

---

## Wave 2 — Core Feature Implementation (all parallel after Wave 1)

---

### P6-06: Implement partial fill and append mode (injector + factory)

**Description**: Implement appendMode support in `packages/core/src/injector.ts` and `packages/core/src/create-voice-form.ts` as specified in LLD sections 3 and 4. This covers: changing `inject()`'s parameter type to `Record<string, ConfirmedField>`, appendMode concatenation logic in `runDomMode`, multiStep `buildResult` behavior, `buildConfirmationData` existingValue DOM read, and forwarding `appendMode`/`multiStep` from config to the injector.

**Complexity**: L  
**Dependencies**: P6-01, P6-02  

**Acceptance criteria**:
- `inject()` parameter type updated to `Record<string, ConfirmedField>` — existing call sites updated
- `appendMode: true` + text field: injected value is `existingValue + ' ' + value` when `existingValue` is non-empty
- `appendMode: true` + empty `existingValue`: injected value is just `value` (no leading space)
- `appendMode: true` + number/date/select/checkbox/radio field: `existingValue` is ignored; value replaces
- `appendMode: false` (default): behavior unchanged from v1
- `buildConfirmationData` reads `element.value` for text/textarea fields when `appendMode: true` — tested with jsdom
- `buildConfirmationData` does NOT read `element.value` when `appendMode: false`
- `multiStep: true` + element not found: `console.warn` (not `console.error`), `InjectionResult.success = true` if all found fields injected
- `multiStep: false` (default): `console.error` for missing elements (unchanged v1 behavior)
- `ConfirmationData.appendMode` field is set correctly from config in all paths
- All v1 injector tests still pass

---

### P6-07: Implement setSchema, getSchema, and updateSchema alias

**Description**: Implement the `setSchema()` and `getSchema()` methods on `VoiceFormInstance` in `packages/core/src/create-voice-form.ts`, and convert `updateSchema()` to a deprecated alias as specified in LLD section 4.5. `setSchema()` must enforce the idle-only guard, call `validateSchema`, and call `injector.clearCache()`.

**Complexity**: S  
**Dependencies**: P6-01  

**Acceptance criteria**:
- `setSchema(schema)` validates and updates `currentSchema`, calls `injector.clearCache()`
- `setSchema()` throws `VoiceFormError(INVALID_TRANSITION)` when called from any state other than `idle`
- `getSchema()` returns `currentSchema` (same reference passed to `setSchema`)
- `updateSchema()` calls `setSchema()` internally and emits `console.warn` with deprecation message
- `updateSchema()` still passes all existing v1 tests (no regression)
- Test: call `setSchema()` with an invalid schema → `VoiceFormConfigError(SCHEMA_INVALID)` thrown
- Test: call `setSchema()` from `recording` state → `VoiceFormError(INVALID_TRANSITION)` thrown
- Test: `getSchema()` returns updated schema after `setSchema()` call

---

### P6-08: Implement correctField on VoiceFormInstance

**Description**: Implement `correctField(fieldName, value)` on `VoiceFormInstance` in `packages/core/src/create-voice-form.ts` as specified in LLD section 4.4. The method sanitizes the user's input, builds a new `ConfirmationData` object via spread (never mutation), and dispatches `FIELD_CORRECTED`. The state machine FIELD_CORRECTED transition (P6-02) must be complete before this task starts the integration test phase.

**Complexity**: M  
**Dependencies**: P6-01, P6-02, P6-06  

**Acceptance criteria**:
- `correctField()` returns `false` if called outside `confirming` state
- `correctField()` returns `false` if called after `destroy()`
- Sanitization: the `value` argument passes through `sanitizeFieldValue` before updating `ConfirmedField.value`
- Sanitization rejection: if sanitization produces empty string from non-empty input, returns `false` and dispatches nothing
- Immutability: after `correctField()`, the new `state.confirmation` is a different object reference from the old one — verified by `Object.is`
- The corrected field has `userCorrected: true` and `originalValue` set to the previous value
- Other fields in `parsedFields` are unchanged references (shallow spread, not deep clone)
- `FIELD_CORRECTED` event dispatched exactly once per call
- Test: `correctField` for a field in `missingFields` creates a new entry in `parsedFields` with the corrected value

---

### P6-09: Implement createVoiceFormAsync with autoDetectSchema

**Description**: Implement `createVoiceFormAsync` in `packages/core/src/create-voice-form.ts` as specified in LLD section 4.2. The function uses a dynamic `import()` for the detect-schema module (never a static import), resolves the form element, calls `detectSchema`, optionally calls `onSchemaDetected`, validates the result, and delegates to `createVoiceForm`. Add the export to `packages/core/src/index.ts`.

**Complexity**: M  
**Dependencies**: P6-01, P6-04  

**Acceptance criteria**:
- `createVoiceFormAsync` is exported from `@voiceform/core`
- Static `import` of detect-schema DOES NOT appear in `create-voice-form.ts` — verified by grep in CI and/or static analysis
- `autoDetectSchema: true` without `formElement` throws `VoiceFormConfigError(INIT_FAILED)` with descriptive message
- `autoDetectSchema: true` with explicit `schema`: explicit schema wins, `console.warn` emitted
- `onSchemaDetected` callback: if it returns a `FormSchema`, that schema is used; if it returns `void`/`undefined`, the detected schema is used
- Schema returned from `onSchemaDetected` passes through `validateSchema()` — invalid schema throws `VoiceFormConfigError`
- `createVoiceForm` (synchronous) throws `VoiceFormConfigError(INIT_FAILED)` with a clear message directing the developer to use `createVoiceFormAsync` when `autoDetectSchema: true`
- JSDoc warning about React useEffect requirement is present on `createVoiceFormAsync`
- Test: mock dynamic import, verify it is called on the dynamic import path and NOT on the static path

---

## Wave 3 — Compound Features (parallel, depend on Wave 2)

---

### P6-10: Implement useVoiceForm hook

**Description**: Implement the `useVoiceForm` hook in `packages/react/src/useVoiceForm.ts` as specified in LLD section 8.3. The hook must use `useCallback` with empty deps for both `subscribe` and `getSnapshot` (critical stability requirement), handle Strict Mode double-invoke correctly via the ref guard, and call `destroy()` on unmount.

**Complexity**: M  
**Dependencies**: P6-05, P6-07, P6-08  

**Acceptance criteria**:
- `subscribe` and `getSnapshot` are wrapped in `useCallback` with `[]` deps — verified by code review and React DevTools Profiler test showing no re-subscription on parent re-render
- `createVoiceForm` is called at most once per component mount — verified by a test that counts calls with a spy
- Strict Mode: `createVoiceForm` is called twice in development (expected); second instance persists — test using `<StrictMode>` wrapper
- On unmount: `instance.destroy()` is called exactly once — verified by spy
- `instance` reference is stable across re-renders that do not unmount the component — verified by `renderHook` and checking `result.current.instance === result.current.instance` across re-renders
- `state` updates when the underlying `VoiceFormInstance` transitions — simulate by calling `instance.start()` in a test and asserting `state.status` changes
- TypeScript: `useVoiceForm` return type matches `UseVoiceFormResult` interface
- Test runner: Vitest with `@testing-library/react`

---

### P6-11: Implement VoiceForm component with ref forwarding

**Description**: Implement the `VoiceForm` component in `packages/react/src/VoiceForm.tsx` as specified in LLD section 8.4. This includes render-prop support, ref forwarding to the mic button, the `onDone`/`onError` convenience props with callback chaining (not override), and the `onFieldsResolved` escape hatch.

**Complexity**: L  
**Dependencies**: P6-10  

**Acceptance criteria**:
- Render prop: when `children` is a function, it receives `{ state, instance }` and the component returns `children({ state, instance })`
- Default UI: when no `children` prop, renders `DefaultVoiceFormUI` with the forwarded ref
- Ref forwarding: `ref` resolves to `HTMLButtonElement` in default UI mode — tested with `React.createRef`
- Ref forwarding: ref is a no-op (not forwarded) in render-prop mode — document this; test verifies `ref.current` is null
- Callback chaining: if both `onDone` prop and `config.events.onDone` are provided, both are called — tested by asserting both spies are invoked
- Callback chaining: same for `onError`
- `onFieldsResolved`: when provided, DOM injection is bypassed; the callback receives the sanitized field map — tested by asserting the DOM is not written and the callback is invoked with correct values
- `VoiceForm.displayName === 'VoiceForm'`
- TypeScript: `VoiceFormProps` extends `VoiceFormConfig` with no conflicts
- Bundle size: `@voiceform/react` ≤ 4 KB gzip after build

---

## Wave 4 — Developer Tooling and Documentation (parallel, depend on Wave 2 + Wave 3)

---

### P6-12: Implement @voiceform/dev — schema inspector

**Description**: Implement `inspectSchema` and `validateSchemaAgainstDOM` in `packages/dev/src/schema-inspector.ts` as specified in LLD section 9.3–9.4. Both functions must be no-ops in production (`process.env.NODE_ENV === 'production'`). All diagnostic rules from LLD section 9.3 must be implemented.

**Complexity**: M  
**Dependencies**: P6-01  

**Acceptance criteria**:
- `inspectSchema`: all 7 diagnostic rules produce the correct severity and a non-empty message
- `inspectSchema`: duplicate field names produce `error` severity diagnostics for both entries
- `inspectSchema`: returns `{ valid: true, fieldCount: n, diagnostics: [] }` for a valid schema
- `inspectSchema`: returns `{}` shape and calls no `console.*` methods when `NODE_ENV === 'production'`
- `validateSchemaAgainstDOM`: uses the same 3-step lookup as the core injector (`[name=]`, `#id`, `[data-voiceform=]`) — verified by creating elements with each lookup strategy in jsdom
- `validateSchemaAgainstDOM`: returns `{}` shape silently in production
- `CSS.escape` used in all selector constructions — grep-verified
- Test all console output with spies (not snapshot — log format may evolve)
- `pnpm typecheck` passes in `packages/dev`

---

### P6-13: Implement @voiceform/dev — logging middleware

**Description**: Implement `createLoggingMiddleware` in `packages/dev/src/logging-middleware.ts` as specified in LLD section 9.5. The function must chain developer callbacks rather than override them, and must be a no-op in production.

**Complexity**: M  
**Dependencies**: P6-01  

**Acceptance criteria**:
- When `callbacks` option is provided with `onStateChange` and `onError`, the developer's callbacks are called before the logging callbacks — verified by call-order spy
- When `callbacks` is not provided, no error is thrown — baseline use case
- Returned `events.onStateChange` opens a `console.groupCollapsed` when state is `processing` and closes it when state transitions to `confirming` — verified by spy
- Elapsed time is logged on `confirming` state — test mocks `Date.now()`
- Returns `{}` in production — `process.env.NODE_ENV = 'production'` in test
- TypeScript: return type is `Pick<VoiceFormConfig, 'events'>`
- Usage pattern in JSDoc is accurate — code example compiles without type errors

---

### P6-14: Implement @voiceform/dev — state visualizer

**Description**: Implement `attachStateVisualizer` and `detachStateVisualizer` in `packages/dev/src/state-visualizer.ts` as specified in LLD section 9.6. All DOM manipulation must use `textContent` exclusively — never `innerHTML`. The overlay must auto-detach when `instance.destroy()` is called.

**Complexity**: M  
**Dependencies**: P6-01  

**Acceptance criteria**:
- Overlay is appended to `document.body` on attach — jsdom test
- All state field updates use `element.textContent = ...` — grep and test verify no `.innerHTML` assignment
- Transcript text is rendered with `textContent` — inject a string containing `<script>` and verify `document.getElementById('vf-dev-transcript').textContent` contains the raw string, not interpreted HTML
- Error text rendered with `textContent` — same pattern
- Verbose mode: `element.textContent = JSON.stringify(state, null, 2)` — test
- Overlay removed from DOM when detach function is called
- Overlay removed from DOM when `instance.destroy()` is called (auto-detach)
- `attachStateVisualizer` returns a no-op function and appends no DOM in production
- `detachStateVisualizer` removes overlay by `getElementById` — safe to call even if no visualizer attached
- Position option: all four positions produce correct inline style (spot-check `top-left` and `bottom-right`)

---

## Wave 5 — Integration, Review, and Validation (serial)

---

### P6-15: Integration tests and end-to-end flow validation

**Description**: Write integration tests that exercise full cross-package flows. Cover: full lifecycle with Whisper adapter + React hook; appendMode confirm-and-inject flow; multiStep schema rotation; correctField followed by confirm; autoDetectSchema initialization with mock DOM. All tests must run in CI without a real network or browser.

**Complexity**: XL  
**Dependencies**: All previous tasks  

**Acceptance criteria**:
- Test: Whisper adapter → STT_FINAL event → createVoiceForm processing → confirming → inject → done. Uses mock fetch for transcription endpoint and parse endpoint.
- Test: `useVoiceForm` (React) full lifecycle — render, start recording (mocked STT), confirm, verify DOM updated — using `@testing-library/react` and jsdom
- Test: appendMode — confirm with `existingValue` present → injected DOM value is concatenated string
- Test: multiStep — `setSchema()` after step 1 confirm, verify element cache cleared, verify second injection uses new schema
- Test: `correctField()` → FIELD_CORRECTED → new ConfirmationData → confirm → injected DOM value is the corrected value
- Test: `createVoiceFormAsync` with `autoDetectSchema: true` — jsdom form with labeled inputs → schema detected correctly → `onSchemaDetected` callback invoked → instance created
- Test: `createLoggingMiddleware` + `attachStateVisualizer` together on a single instance — verify both function without interfering
- All new tests and all existing tests pass: `pnpm -r test`
- No TypeScript errors: `pnpm -r typecheck`
- No lint errors: `pnpm -r lint`

---

### P6-16: Bundle size validation and security audit checklist

**Description**: Build all packages in production mode and verify bundle sizes against targets. Run the security audit checklist from LLD section 10.3 to confirm every security review item is addressed. Write a brief findings report (in a PR comment, not a committed file) noting any targets missed and the plan to address them.

**Complexity**: M  
**Dependencies**: P6-15  

**Acceptance criteria**:
- `@voiceform/core` (headless, main entry): ≤ 5.5 KB gzip — measured with `gzip-size-cli` or `bundlesize`
- `@voiceform/core/adapters/whisper`: ≤ 3 KB gzip
- `@voiceform/core/detect-schema`: ≤ 2 KB gzip
- `@voiceform/react`: ≤ 4 KB gzip (React externalized)
- Static import of `detect-schema` absent from `create-voice-form.ts` build output — verified with `grep` on built artifact
- `@voiceform/core` build artifact contains no React-specific code (`useRef`, `useState`, etc.)
- `@voiceform/react` build artifact contains no `@voiceform/core` implementation code (only imports)
- All 11 security review items from LLD section 10.3 verified by code review — documented as PR comment checklist
- Bundle size check is added as a CI step (fail build if any target is exceeded by more than 10%)

---

## Parallel Execution Guide

The following tasks can safely be assigned to different engineers simultaneously within each wave:

**Wave 1 (5 engineers in parallel):**
- P6-01 (types) — foundational; others depend on it but can start with type stubs
- P6-02 (state machine) — depends only on P6-01 types
- P6-03 (Whisper adapter) — self-contained; mock the STTAdapter interface
- P6-04 (detect-schema) — self-contained DOM scanner
- P6-05 (React package scaffolding) — pure build/config work

**Wave 2 (4 engineers in parallel, after Wave 1 merges):**
- P6-06 (partial fill + injector)
- P6-07 (setSchema / getSchema)
- P6-08 (correctField) — requires P6-02 to be merged for integration tests; unit-testable independently
- P6-09 (createVoiceFormAsync) — requires P6-04 to be merged; mock the dynamic import in unit tests

**Wave 3 (2 engineers in parallel, after Wave 2 merges):**
- P6-10 (useVoiceForm hook)
- P6-11 (VoiceForm component) — can start implementation in parallel with P6-10; integration tests gate on P6-10

**Wave 4 (3 engineers in parallel, can start after Wave 2 merges):**
- P6-12 (schema inspector)
- P6-13 (logging middleware)
- P6-14 (state visualizer)

**Wave 5 (serial):**
- P6-15 and P6-16 are sequential — P6-15 must pass before P6-16 begins

---

## Complexity Summary

| ID | Title | Complexity | Wave |
|---|---|---|---|
| P6-01 | Extend core type definitions | M | 1 |
| P6-02 | Add FIELD_CORRECTED to state machine | S | 1 |
| P6-03 | Implement Whisper STT adapter | XL | 1 |
| P6-04 | Implement detect-schema module | L | 1 |
| P6-05 | Create @voiceform/react scaffolding | S | 1 |
| P6-06 | Partial fill and append mode | L | 2 |
| P6-07 | setSchema, getSchema, updateSchema alias | S | 2 |
| P6-08 | correctField on VoiceFormInstance | M | 2 |
| P6-09 | createVoiceFormAsync with autoDetectSchema | M | 2 |
| P6-10 | useVoiceForm hook | M | 3 |
| P6-11 | VoiceForm component with ref forwarding | L | 3 |
| P6-12 | @voiceform/dev — schema inspector | M | 4 |
| P6-13 | @voiceform/dev — logging middleware | M | 4 |
| P6-14 | @voiceform/dev — state visualizer | M | 4 |
| P6-15 | Integration tests and flow validation | XL | 5 |
| P6-16 | Bundle size validation and security audit | M | 5 |

**Estimated complexity points** (S=1, M=2, L=3, XL=5): 35 points  
**Critical path**: P6-01 → P6-02 → P6-08 → P6-10 → P6-11 → P6-15 → P6-16
