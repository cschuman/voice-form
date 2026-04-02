# voice-form — Performance Engineering Audit

**Reviewer:** Performance Engineering  
**Date:** 2026-04-01  
**Documents reviewed:** VISION.md, ROADMAP.md, BRD.md, HIGH_LEVEL_DESIGN.md, LOW_LEVEL_DESIGN.md, UX_SPEC.md, TASKS.md  
**Status:** Pre-implementation audit — findings apply to the design as specified

---

## Executive Summary

voice-form is a drop-in library that lives inside other people's apps. Every kilobyte added to a host app's bundle and every millisecond added to a user's interaction costs the integrating developer — in page weight, in Core Web Vitals scores, in user abandonment. The design is architecturally sound and the zero-dependency commitment is the right call. However, several specific design decisions, as currently specified, carry material performance risk that will not be visible until the library ships and developers start instrumenting their apps. This review documents those risks with concrete remediation paths.

The findings are ordered within each section by impact. Not every finding is a blocker, but CRITICAL and HIGH items should be resolved in the design documents before implementation begins, because retrofitting performance decisions into an existing API surface is substantially harder than getting them right upfront.

---

## 1. Bundle Size Analysis

### 1.1 Are the 8 KB Core / 3 KB Wrapper Targets Realistic?

**Finding: The 8 KB core target is achievable but will require active discipline. It is not automatically satisfied by the current design.**

Source: BRD.md NFR-001, HIGH_LEVEL_DESIGN.md Section 7.

The modules specified in core are:

| Module | Estimated minified+gzip contribution |
|---|---|
| `state/state-machine.ts` — pure reducer, transition table | ~0.8 KB |
| `stt/adapter-types.ts` + `stt/web-speech-adapter.ts` | ~0.9 KB |
| `schema/schema-validator.ts` | ~0.5 KB |
| `schema/prompt-builder.ts` — including prompt template strings | ~1.2–1.8 KB |
| `endpoint/endpoint-client.ts` — fetch wrapper, retry logic, validation | ~1.4 KB |
| `injector/dom-injector.ts` — per-type injection matrix, native setter trick | ~1.1 KB |
| `ui/default-ui.ts` — DOM construction, CSS injection, SVG icons, focus trap | ~2.5–3.5 KB |
| `errors.ts`, `types.ts`, `create-voice-form.ts` wiring | ~0.8 KB |
| **Estimated total** | **~9.3–11.1 KB** |

The design, as currently specified, is likely to produce a core bundle in the 9–11 KB range before the 8 KB target is enforced in CI. The primary offender is the default UI module, which carries inline SVG icons (4 icons at ~200–400 bytes each inline), CSS as a string literal, and a bespoke focus trap implementation. These add up.

The 3 KB wrapper target for `@voiceform/svelte` is achievable because the wrapper is genuinely thin — it delegates all logic to core.

**Impact: HIGH**

**Remediation:**

1. The default UI (`ui/default-ui.ts`) must be code-split from the core logic. It is the only module in core that is not required for headless operation. Define a separate entry point:

   ```
   packages/core/package.json exports:
   ".":          dist/core.mjs          (state machine, STT, endpoint, injector — no UI)
   "./ui":       dist/ui.mjs            (default UI only — imported by framework wrappers)
   ```

   Consumers using headless mode never pay for the default UI. Framework wrappers import `@voiceform/core/ui` explicitly. This alone is worth ~2.5–3.5 KB off the headless core.

2. The prompt template strings in `schema/prompt-builder.ts` are sent server-side, not executed client-side. The full system prompt template (Section 8 of LOW_LEVEL_DESIGN.md) is approximately 700–900 bytes as a literal string. It should not live in the core bundle at all. The BYOE pattern means the server constructs the prompt. The `buildSystemPrompt` / `buildUserPrompt` exports should be moved to a separate package (`@voiceform/server-utils` or `@voiceform/prompt-builder`) that lives in the developer's server code, not their browser bundle.

3. Establish bundle size tracking from day one. The CI check described in BRD.md NFR-001 must use `size-limit` or an equivalent tool that measures the actual tree-shaken output for a representative import (`import { createVoiceForm } from '@voiceform/core'`), not the raw file size.

---

### 1.2 Default UI CSS: Injection Strategy and Size

**Finding: Injecting a `<style>` tag once on first mount is correct, but the CSS string itself is undersized in the design's accounting.**

Source: LOW_LEVEL_DESIGN.md Section 4f, UX_SPEC.md Section 9.

The UX spec defines 35+ CSS custom properties across button states, panel styles, and field highlight colors. The default CSS must cover: button idle/recording/processing/confirming/done/error states, pulse ring keyframe animation, spinner keyframe animation, panel float positioning, bottom sheet mobile layout, reduced motion media query overrides, and the `vf-sr-only` utility class.

A realistic estimate for this CSS, before gzip: 1.8–2.4 KB as a string constant embedded in the JS bundle. After gzip this compresses well (~600–800 bytes), but it is still code that cannot be tree-shaken because it is a string — not a module.

**Impact: MEDIUM**

**Remediation:**

1. Ship the default CSS as a separate `voice-form.css` file that developers can import explicitly, and make the `<style>` injection behavior opt-in. This allows developers using CSS bundlers to deduplicate and minify the stylesheet through their own pipeline. Developers who want zero-config still get the injected stylesheet.

2. Do not embed keyframe animation names as unique per-instance strings. Use a fixed class namespace (`vf-`) with static animation names (`vf-pulse`, `vf-spin`). The `id="voiceform-styles"` duplicate check (described in LOW_LEVEL_DESIGN.md 4f) is correct and must be present.

3. The duplicate check `if (document.getElementById('voiceform-styles'))` should run once at module load time, not per-instance mount. Multiple `createVoiceForm` instances on the same page must not race to inject the same stylesheet.

---

### 1.3 Tree-Shaking: Export Structure

**Finding: The single-entry-point export model prevents tree-shaking of the default UI from headless consumers. The current design leaves dead code in headless bundles.**

Source: HIGH_LEVEL_DESIGN.md Section 7.3, LOW_LEVEL_DESIGN.md Section 4g.

The `createVoiceForm` factory conditionally instantiates `DefaultUI` based on `config.headless`. A bundler doing static analysis cannot determine at build time whether `headless` will be `true`, so `DefaultUI` and all its transitive code (SVGs, CSS string, focus trap) stays in the bundle.

The same problem applies to `WebSpeechAdapter`: developers providing a custom `sttAdapter` still pay for the `WebSpeechAdapter` code because the factory always `import`s it as the default fallback.

**Impact: HIGH**

**Remediation:**

1. Make the default UI and default STT adapter lazy-loadable via dynamic import or provide them as separate named exports that consumers pass in explicitly:

   ```typescript
   // Option A: explicit default imports (preferred for tree-shaking)
   import { createVoiceForm } from '@voiceform/core'
   import { DefaultUI } from '@voiceform/core/ui'          // only if not headless
   import { WebSpeechAdapter } from '@voiceform/core/stt'  // only if not using custom adapter

   const vf = createVoiceForm({
     ...config,
     ui: DefaultUI,
     sttAdapter: new WebSpeechAdapter(),
   })
   ```

   This is a more explicit API, but it allows bundlers to eliminate entire modules at build time. Framework wrappers can re-export the pre-wired version for convenience.

2. If the current implicit-default pattern is preserved for DX reasons, add a `sideEffects: false` field to `packages/core/package.json`. This enables bundlers to eliminate unused re-exports. It is not a substitute for proper code splitting but it helps.

---

### 1.4 The `requestId` / `crypto.randomUUID()` Hidden Cost

**Finding: The `generateRequestId` function calls `crypto.randomUUID()` on every parse request with a `Math.random()` fallback. This is correct but has a subtle tree-shaking implication.**

Source: LOW_LEVEL_DESIGN.md Section 4g.

`crypto.randomUUID()` is a browser built-in — no bundle cost. However, the fallback implementation (a hex string from `Math.random()`) is dead code in modern browsers but stays in the bundle. This is ~100 bytes, low severity by itself. Document it, and strip it if the compilation target already excludes environments without `crypto.randomUUID` (all browsers in the support matrix have it — BRD.md NFR-003).

**Impact: LOW**

**Remediation:** Since the support matrix (Chrome 90+, Safari 15.4+, Firefox 90+) universally supports `crypto.randomUUID()`, remove the `Math.random()` fallback and call `crypto.randomUUID()` directly. If the fallback must be kept for test environments, guard it with `if (process.env.NODE_ENV === 'test')` so it is eliminated in production builds.

---

## 2. Runtime Performance

### 2.1 Critical Path Latency Budget

The full critical path from button press to form filled, with timing breakdown:

```
Stage                           Owned by        Typical range      Notes
─────────────────────────────── ─────────────── ────────────────── ──────────────────────────────────
1. Button click handler          Library         < 1 ms             State machine dispatch, synchronous
2. Permission prompt (1st use)   Browser         1–8 seconds        One-time cost; cannot be reduced
3. STT adapter start()           Library         < 5 ms             SpeechRecognition.start() is async callback
4. User speaking                 User            varies             Not in our control
5. Web Speech API transcription  Browser/Google  0 ms*              * Streaming; fires on silence
6. State machine: processing     Library         < 1 ms             Synchronous dispatch
7. Network: POST to endpoint     Network         20–300 ms          RTT dependent; LAN vs. cross-region
8. LLM inference                 Developer's LLM 300–3000 ms        gpt-4o-mini: ~500ms; claude-haiku: ~400ms
9. Response validation           Library         < 2 ms             validateParseResponse is O(n) fields
10. Confirmation UI render       Library/Browser  < 16 ms target    DOM construction, layout, paint
11. User reviewing confirmation  User            2–30 seconds       Not in our control
12. Inject N fields              Library         < 16 ms target     Should complete in one frame
13. Dispatch synthetic events    Library         < 5 ms             2 events × N fields
14. onDone callback              Developer       varies             Not in our control
```

The library directly controls approximately 30ms of the critical path. The dominant costs (LLM inference, network RTT, user reading time) are not in the library's control. However, the library can worsen the perceived experience if steps 10 and 12 are poorly executed.

**The performance statement the library can honestly make:** "Everything voice-form does takes under 30ms. Your LLM takes the rest."

---

### 2.2 The `onresult` Handler: Array.from on Every Event

**Finding: The Web Speech API adapter iterates all results on every `onresult` event, creating garbage and doing redundant work.**

Source: HIGH_LEVEL_DESIGN.md Section 3.2, LOW_LEVEL_DESIGN.md Section 4a.

The HIGH_LEVEL_DESIGN shows:

```typescript
recognition.onresult = (event) => {
  const final = Array.from(event.results)
    .filter(r => r.isFinal)
    .map(r => r[0].transcript)
    .join(' ')
    .trim()
}
```

With `continuous = false` (as specified in LOW_LEVEL_DESIGN.md 4a), there will typically be zero or one result. But this pattern creates three intermediate arrays on every event fire. During active speech recognition, `onresult` fires frequently — every interim result triggers this. Each call allocates a new array via `Array.from`, a filtered array, and a mapped array.

**Impact: MEDIUM**

**Remediation:** Iterate `SpeechRecognitionResultList` directly without materializing intermediate arrays:

```typescript
recognition.onresult = (event) => {
  // With continuous=false, collect final results only
  let finalTranscript = ''
  for (let i = event.resultIndex; i < event.results.length; i++) {
    if (event.results[i].isFinal) {
      finalTranscript += event.results[i][0].transcript
    } else if (options.onInterimTranscript) {
      options.onInterimTranscript(event.results[i][0].transcript)
    }
  }
  if (finalTranscript) options.onFinal(finalTranscript.trim())
}
```

Use `event.resultIndex` to start iteration from the new results only — do not iterate results already processed in previous events. This eliminates all intermediate allocations.

---

### 2.3 The Retry Backoff: `setTimeout(500ms)` on Main Thread

**Finding: The retry logic in `EndpointClient` uses a fixed 500ms backoff with a plain `setTimeout`. On 5xx errors, this is correct. But the implementation as specified creates a dangling timer if `abort()` is called during the backoff window.**

Source: LOW_LEVEL_DESIGN.md Section 4c.

The spec states: "Retry up to `options.retries` times with 500ms backoff." If `cancel()` is called during processing, the state machine transitions to `idle`, but a pending `setTimeout` for the retry may still fire, causing `endpointClient.parse()` to be called from `idle` state. The state machine will ignore the subsequent `PARSE_SUCCESS` event, so this will not cause incorrect form filling — but it will cause a spurious network request.

**Impact: HIGH (correctness + wasted network request)**

**Remediation:** The `EndpointClient.abort()` method must cancel any pending retry timers, not just the in-flight `AbortController`. Track the retry timer ID:

```typescript
private retryTimerId: ReturnType<typeof setTimeout> | null = null

abort(): void {
  this.activeController?.abort()
  this.activeController = null
  if (this.retryTimerId !== null) {
    clearTimeout(this.retryTimerId)
    this.retryTimerId = null
  }
}
```

---

### 2.4 DOM Injection: Sequential Event Dispatch Causes Layout Thrashing

**Finding: Injecting N fields synchronously, each dispatching `input` and `change` events immediately after value setting, can trigger N layout recalculations if any event listener reads layout properties.**

Source: LOW_LEVEL_DESIGN.md Section 4d.

The injection loop as described calls `setNativeValue` then immediately dispatches `input` then `change` before moving to the next field. If any form library's event handler (react-hook-form's `onChange`, Formik's `handleChange`) reads layout-triggering properties (e.g., `offsetWidth`, `scrollHeight`) in response to these events, the browser must flush layout after each field. For a 20-field form, this could be 40 forced synchronous layouts.

Additionally, the spec calls `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')` for every field injection. This is a property descriptor lookup on a prototype — not a DOM query, but still unnecessary repeated work.

**Impact: HIGH**

**Remediation:**

1. Cache the native value setter lookups at module initialization time, not per-injection-call:

   ```typescript
   // At module scope — resolved once, reused forever
   const nativeInputSetter = Object.getOwnPropertyDescriptor(
     HTMLInputElement.prototype, 'value'
   )?.set

   const nativeTextAreaSetter = Object.getOwnPropertyDescriptor(
     HTMLTextAreaElement.prototype, 'value'
   )?.set
   ```

2. Batch the injection into a single animation frame using `requestAnimationFrame`. Write all values first, then dispatch all events:

   ```typescript
   requestAnimationFrame(() => {
     // Phase 1: write all values (no events)
     for (const [fieldName, parsed] of Object.entries(parsedFields)) {
       const el = findElement(fieldName)
       if (el) setNativeValue(el, parsed.value)
     }
     // Phase 2: dispatch all events
     for (const [fieldName] of Object.entries(parsedFields)) {
       const el = findElement(fieldName)
       if (el) dispatchSyntheticEvents(el)
     }
   })
   ```

   This keeps all DOM writes in a single frame, minimizing layout thrash.

3. Add a measurable target to the design documents: **Injection of up to 20 fields must complete within a single 16ms animation frame.** The current design has no measurable injection performance target. Add it to BRD.md NFR-001.

---

### 2.5 The `handleStateTransition` Function Is Async with No Backpressure

**Finding: The `handleStateTransition` function is declared `async` and is called from a synchronous state machine subscriber. If the state machine dispatches multiple events rapidly (possible in error + auto-reset sequences), multiple concurrent `handleStateTransition` invocations can be in flight simultaneously.**

Source: LOW_LEVEL_DESIGN.md Section 4g.

The subscriber pattern is:

```typescript
machine.subscribe(handleStateTransition) // handleStateTransition is async
```

The `dispatch()` function calls all subscribers synchronously. If a transition fires another transition inside a callback (e.g., the AUTO_RESET setTimeout fires while a previous async operation is still pending), the async handler from the first transition and the async handler from the second transition both exist concurrently. This is unlikely to cause data corruption due to the state machine guards, but it creates unnecessary concurrent work and makes the system harder to reason about.

**Impact: MEDIUM**

**Remediation:** Ensure the transition subscriber is never called reentrantly. Add a flag:

```typescript
let handlingTransition = false

function subscribe(state, event) {
  if (handlingTransition) {
    // queue or skip — the state machine already guards against invalid transitions
    return
  }
  handlingTransition = true
  handleStateTransition(state, event).finally(() => {
    handlingTransition = false
  })
}
```

Alternatively, dispatch events into a microtask queue so async operations from one transition complete before the next subscriber call begins.

---

### 2.6 Memory Leak: State Machine Listener Set Never Shrinks Until `destroy()`

**Finding: The `createStateMachine` implementation uses a `Set<listener>` that grows as subscribers are added. The design shows one subscriber (the main `handleStateTransition`), so the Set has one entry. However, if framework wrappers or developers add multiple subscribers without calling the returned unsubscribe function, the Set leaks.**

Source: LOW_LEVEL_DESIGN.md Section 4e.

The `subscribe()` function returns an unsubscribe callback — this is correct. The risk is that the framework wrapper implementations in HIGH_LEVEL_DESIGN.md Section 6 do not all correctly call unsubscribe. The React hook calls `controller.destroy()` on unmount, which calls `machine.unsubscribeAll()` — but `unsubscribeAll()` is not defined in the `StateMachine` interface. The design shows `machine.unsubscribeAll()` in the destroy sequence but only `subscribe()` returning an unsubscribe function in the interface.

**Impact: HIGH (memory leak on repeated mount/unmount in React/Svelte SPAs)**

**Remediation:**

1. Add `destroy()` to the `StateMachine` interface that clears the listeners Set:

   ```typescript
   export interface StateMachine {
     getState(): VoiceFormState
     dispatch(event: VoiceFormEvent): void
     subscribe(listener: Listener): () => void
     destroy(): void  // clears all listeners
   }
   ```

2. Verify that every framework wrapper's cleanup path (React `useEffect` cleanup, Svelte `onDestroy`) calls `instance.destroy()`, which in turn calls `machine.destroy()`. Document this as a correctness requirement in TASKS.md for P2 and P3 wrapper implementations.

3. Add a test: mount a React/Svelte component 100 times and unmount it each time. Check that memory usage does not grow monotonically.

---

### 2.7 Memory Leak: Audio Blobs in the Whisper Adapter (v2)

**Finding: The v2 Whisper adapter design accumulates audio chunks via `MediaRecorder` but does not specify when the resulting `Blob` is released.**

Source: HIGH_LEVEL_DESIGN.md Section 3.3.

The Whisper adapter will POST an audio Blob to the developer's endpoint. After the POST completes, the `Blob` and the `ArrayBuffer` backing it must be explicitly dereferenced. The current design sketch does not address this. A Blob from a 30-second audio recording at 128kbps WebM is approximately 480 KB. If the developer repeatedly invokes voice-form (10 invocations), that is ~4.8 MB of Blob data in memory if not released.

**Impact: HIGH (for v2 Whisper adapter)**

**Remediation:** Explicitly document in the v2 Whisper adapter spec that the audio Blob must be set to `null` and dereferenced after the POST response is received (success or error). The `MediaRecorder` chunks array must also be cleared. Add this to the adapter's `abort()` path as well.

---

### 2.8 Repeated Invocations: `findElement` Performs 3 DOM Queries Per Field Per Invocation

**Finding: Every call to `inject()` runs up to 3 `querySelector` calls per field to locate elements. For a 20-field form invoked 10 times on the same page, this is 600 DOM queries.**

Source: LOW_LEVEL_DESIGN.md Section 4d.

The lookup strategy is:
1. `this.root.querySelector([name="${fieldName}"])`
2. `this.root.querySelector(#${fieldName})`
3. `this.root.querySelector([data-voiceform="${fieldName}"])`

The form DOM does not change between invocations. Repeating these queries on every injection is wasteful.

**Impact: MEDIUM**

**Remediation:** Cache element references after the first successful lookup. The cache should be invalidated when `updateSchema()` is called or when `formElement` changes. For a typical 5–10 field form, this converts O(3n) per invocation to O(3n) once plus O(n) cache lookups for all subsequent invocations.

```typescript
private elementCache = new Map<string, HTMLElement | null>()

private findElement(fieldName: string): HTMLElement | null {
  if (this.elementCache.has(fieldName)) {
    return this.elementCache.get(fieldName)!
  }
  const el = (
    this.root.querySelector(`[name="${fieldName}"]`) ??
    this.root.querySelector(`#${fieldName}`) ??
    this.root.querySelector(`[data-voiceform="${fieldName}"]`)
  ) as HTMLElement | null
  this.elementCache.set(fieldName, el)
  return el
}

clearCache(): void {
  this.elementCache.clear()
}
```

---

### 2.9 The AUTO_RESET `setTimeout` Accumulates on Rapid Error Cycles

**Finding: The error recovery path schedules an AUTO_RESET via `setTimeout` with no deduplication. If the user triggers errors rapidly (e.g., repeated mic activations in an unsupported browser), multiple AUTO_RESET timers can be queued simultaneously.**

Source: LOW_LEVEL_DESIGN.md Section 4g, Section 3.5.

The spec states: "schedule AUTO_RESET if recoverable." Each error transition schedules a new `setTimeout`. If five error transitions fire in three seconds, five AUTO_RESET dispatches will fire, each calling `machine.dispatch({ type: "AUTO_RESET" })`. The state machine will ignore invalid transitions (`AUTO_RESET` from `idle` is a no-op), so correctness is not violated — but five idle setTimeout callbacks remain registered in the JS engine.

**Impact: LOW**

**Remediation:** Track the AUTO_RESET timer ID and cancel the previous one before scheduling a new one:

```typescript
private autoResetTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutoReset(delayMs: number) {
  if (this.autoResetTimer !== null) clearTimeout(this.autoResetTimer)
  this.autoResetTimer = setTimeout(() => {
    this.autoResetTimer = null
    machine.dispatch({ type: 'AUTO_RESET' })
  }, delayMs)
}
```

---

### 2.10 The `onresult` Handler Is Overwritten Conditionally

**Finding: The Web Speech adapter in HIGH_LEVEL_DESIGN.md Section 3.2 assigns `recognition.onresult` twice — once unconditionally, then again inside an `if (options.onInterimTranscript)` block — overwriting the first assignment.**

Source: HIGH_LEVEL_DESIGN.md Section 3.2.

```typescript
recognition.onresult = (event) => { /* final handling */ }

if (options.onInterimTranscript) {
  recognition.onresult = (event) => {  // overwrites the above!
    for (const result of event.results) {
      if (!result.isFinal) options.onInterimTranscript?.(result[0].transcript)
    }
    // final handling inline (same logic as above)
  }
}
```

The comment "same logic as above" means the final-handling code is duplicated inline. If the two implementations diverge, results differ based on whether `onInterimTranscript` is provided. This is a correctness risk masquerading as a performance concern — the duplicated logic has twice the maintenance surface.

**Impact: HIGH (correctness)**

**Remediation:** Use a single handler that handles both paths:

```typescript
recognition.onresult = (event) => {
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i]
    if (result.isFinal) {
      events.onFinal(result[0].transcript.trim())
    } else {
      events.onInterim?.(result[0].transcript)
    }
  }
}
```

---

## 3. Initialization Performance

### 3.1 First Interaction Latency

**Finding: The Web Speech API adapter performs no eager initialization. The first call to `start()` triggers the mic permission prompt and `SpeechRecognition.start()` simultaneously, which is the correct behavior. However, the design does not document the latency cost of the first permission grant.**

Source: LOW_LEVEL_DESIGN.md Section 4a, BRD.md FR-001.

Time from button press to "actively recording" on first use:

1. `createVoiceForm()` call: synchronous, < 5ms (schema validation, adapter instantiation, DOM setup)
2. `instance.start()` → state machine dispatch → `stt.start()` call: < 1ms
3. `SpeechRecognition.start()`: browser shows permission prompt (blocking)
4. User grants permission: 1–8 seconds (human factor)
5. Permission granted → microphone active → recording begins: < 100ms (browser overhead)
6. On subsequent uses (permission already granted): steps 3–5 collapse to < 50ms

The library contributes negligibly to first-interaction latency. The dominant cost is the permission prompt. This should be documented clearly in the README so developers understand that the "first use is slow" experience is owned by the browser, not the library.

**Impact: LOW (documentation gap, not a code problem)**

**Remediation:** Add a performance expectations section to the README:

> "First use: The browser will show a microphone permission prompt. This is a one-time cost per origin and is not controlled by voice-form. Subsequent uses are immediate."

---

### 3.2 Eager `createVoiceForm()` Call vs. Lazy Initialization

**Finding: The design requires `createVoiceForm()` to be called eagerly at component mount time. This runs schema validation, instantiates the STT adapter (an object allocation), and — in non-headless mode — mounts the default UI into the DOM. All of this happens before the user has expressed any intent to use voice input.**

Source: LOW_LEVEL_DESIGN.md Section 4g, HIGH_LEVEL_DESIGN.md Section 6.

For a page with 5 forms each using voice-form, `createVoiceForm()` runs 5 times at mount. Each call allocates the state machine, the `EndpointClient` (with its `AbortController` reference), the `DomInjector` (with a `querySelector` for the form element), and the `DefaultUI` (injecting DOM elements into the page). This is synchronous work on the main thread during page load.

**Impact: MEDIUM**

**Remediation:**

1. Defer `DefaultUI` instantiation until the first `start()` call. The mic button can be rendered eagerly (it is just a button), but the DOM construction for the confirmation panel — which is the heavier work — can be deferred until it is actually needed.

2. Defer `DomInjector` element resolution until the first `inject()` call. The constructor currently runs `document.querySelector(formElement)` at init time. This is a DOM query that runs before the user does anything. Move it to first injection.

3. Document a lazy initialization pattern for high-form-count pages:

   ```typescript
   // Instead of calling createVoiceForm() per form at mount,
   // create the instance only when the user first activates the button.
   button.addEventListener('click', () => {
     if (!vfInstance) {
       vfInstance = createVoiceForm({ schema, endpoint })
     }
     vfInstance.start()
   }, { once: false })
   ```

---

### 3.3 Schema Validation Is Synchronous and Throws

**Finding: Schema validation runs synchronously at `createVoiceForm()` call time and throws on failure. This is the correct design — fail fast at configuration time, not at user interaction time. No performance issue here.**

Source: LOW_LEVEL_DESIGN.md Section 3.2, BRD.md FR-007.

The validation logic is O(n) on field count with simple string checks. For a 50-field schema, this is under 1ms. No concern.

**Impact: NONE**

---

## 4. DOM Performance

### 4.1 Field Injection Event Count for Large Forms

**Finding: The injection loop dispatches 2 events per field. For a 20-field form, that is 40 synthetic events. For a form using event delegation (react-hook-form, Formik), each event bubbles up the DOM tree. This is correct behavior but the scaling must be understood.**

Source: LOW_LEVEL_DESIGN.md Section 4d, HIGH_LEVEL_DESIGN.md Section 5.4.

Two events per field is the minimum required for framework compatibility. The design is correct. The concern is whether 40 bubbling events on a form with deep nesting triggers excessive work in the host app's event handlers.

**Measurable target not specified:** The design documents contain no injection performance target. This is a gap.

**Impact: MEDIUM**

**Remediation:**

1. Add to BRD.md NFR-001: "Injection of up to 20 fields, including synthetic event dispatch, must complete within one animation frame (< 16ms) in Chrome on mid-range hardware."

2. Use `requestAnimationFrame` batching as described in Finding 2.4. Write all values first, then dispatch all events in a second pass. This ensures the browser sees all value writes before any event handlers run, minimizing the number of separate layout flushes.

3. Consider dispatching a single custom event on the form element after all fields are filled, as an alternative notification mechanism for developers who want to hook into voice-form completion:

   ```typescript
   formElement.dispatchEvent(new CustomEvent('voiceform:filled', {
     bubbles: true,
     detail: { fields: injectionResult }
   }))
   ```

   This is an additive API improvement, not a replacement for the per-field events.

---

### 4.2 Confirmation Panel: Positioning Strategy Causes Reflow

**Finding: The confirmation panel uses `position: absolute` with smart placement based on viewport bounds. Reading viewport bounds (via `getBoundingClientRect()` or similar) and then writing `top`/`left` CSS values triggers layout → read → layout, which is forced synchronous layout.**

Source: UX_SPEC.md Section 5.1, Section 10.2.

The spec describes: "Panel floats above (or below) the button with an 8px gap... If the panel would extend beyond the viewport edge horizontally, it is repositioned to stay within viewport bounds."

This implies: read `button.getBoundingClientRect()`, read `panel.getBoundingClientRect()`, compare against `window.innerWidth / innerHeight`, write `panel.style.top` and `panel.style.left`. If this is done in a `resize` event handler or after a state change, it forces a synchronous reflow.

**Impact: MEDIUM**

**Remediation:**

1. Use CSS-only positioning as the default where possible. The initial panel placement (above or below the button) can be determined at open time once, not continuously. Use `position: absolute` relative to the button's containing block, and use CSS `calc()` with the known button size as an offset.

2. For the edge-detection repositioning, batch the read and write phases:

   ```typescript
   // Correct pattern: read first, then write
   const buttonRect = button.getBoundingClientRect()  // read
   const panelWidth = panelMinWidth  // use design constant, not measured
   const left = clampToViewport(buttonRect.left, panelWidth, window.innerWidth)
   panel.style.left = `${left}px`   // write
   ```

   Do not interleave reads and writes. Do not call `getBoundingClientRect()` after writing `style.left`.

3. The bottom sheet variant (mobile) is simpler: `position: fixed; bottom: 0; left: 0; right: 0`. No bounding rect calculation needed. This path is already efficient.

4. CSS `transform: translateY()` for the panel open/close animation is correct — transforms do not trigger layout. The spec's use of "translate + opacity" is the right approach.

---

### 4.3 CSS Custom Properties: Count and Cascade Performance

**Finding: The UX spec defines 35+ CSS custom properties. Reading custom property values is marginally slower than reading computed values for static properties. For an interactive widget that updates frequently, this is a concern at scale but not in isolation.**

Source: UX_SPEC.md Section 9.2.

35 custom properties is within normal bounds for a design system component. Modern browser CSS engines handle custom property resolution efficiently. The performance concern arises only if:

- The properties are set on `:root` or a high-level ancestor, causing all descendant element style recalculations to re-evaluate them on each change.
- The component is instantiated many times on the same page, each with different property values.

**Impact: LOW**

**Remediation:** Document that custom properties should be set on the component's root element (`.vf-root` or the `mountTarget`), not on `:root`. Setting properties on `:root` triggers style recalculation for the entire document. The current spec correctly scopes properties to the component element, but this behavior should be explicit in the developer documentation.

---

### 4.4 Field Highlight Class: `classList` Toggle Leaves a `setTimeout` Alive

**Finding: The `vf-field-filled` class is added to filled fields and removed after 1.5 seconds via `setTimeout`. If the component is destroyed within 1.5 seconds of a successful fill (e.g., the user immediately navigates away), the timeout fires against a potentially detached DOM element.**

Source: UX_SPEC.md Section 6.2.

**Impact: LOW (harmless but sloppy)**

**Remediation:** Track field highlight timer IDs in an array and clear them in `ui.destroy()`. Alternatively, use a CSS animation with `animation-fill-mode: forwards` and remove the class via an `animationend` event listener — this eliminates the timer entirely.

---

## 5. Network Performance

### 5.1 Schema Is Sent on Every Request — No Deduplication

**Finding: The full `FormSchema` object is serialized and sent to the developer's endpoint on every `parse()` call. For a 10-field schema with descriptions and options, the serialized JSON payload is approximately 800–1500 bytes. Over HTTPS with compression, this is 200–400 bytes on the wire. Multiplied by repeated invocations on the same form, this is wasteful.**

Source: BRD.md FR-009, HIGH_LEVEL_DESIGN.md Section 4.1, LOW_LEVEL_DESIGN.md Section 4c.

Example request payload from LOW_LEVEL_DESIGN.md Section 8.5 (Shipping Address schema with all 50 US state abbreviations in `options`): the `options` array alone is 150 bytes. The full schema payload for that form is ~600 bytes. Sending this on every voice invocation is unnecessary network overhead.

**Impact: MEDIUM**

**Remediation:**

1. Add a `schemaHash` field to the `ParseRequest` type. Compute a lightweight hash (FNV-32 or djb2, ~50 bytes of code) of the serialized schema once at `createVoiceForm()` time and include it in every request. The developer's server can cache the schema by hash and skip schema parsing on cache hit.

2. Make schema transmission opt-out with a `sendSchema: boolean` option (default `true`). Developers whose endpoints already have the schema hardcoded can set `sendSchema: false` to eliminate the schema from every request.

3. If the schema is large (large `options` arrays, long `description` fields), document this overhead explicitly so developers know to keep schema descriptions concise.

---

### 5.2 Request Deduplication: Concurrent Requests Not Addressed

**Finding: The design does not address what happens if `start()` is called while a request is already in flight. The state machine guards prevent entering `processing` from any state other than `recording`, so concurrent requests cannot happen through normal usage. However, calling `instance.start()` from `done` state transitions back to `recording` (per the transition table), which means a second request could be initiated immediately after the first completes.**

Source: HIGH_LEVEL_DESIGN.md Appendix A, LOW_LEVEL_DESIGN.md Section 3.2.

The transition table shows: `done → start() → recording`. If `AUTO_RESET` has not fired yet and the user immediately activates again from `done`, the previous request result is in memory and the state machine correctly moves to a new session. There is no true concurrent request problem. However, the `EndpointClient` keeps `this.activeController` as a single slot — if `abort()` is called before `activeController` is set for a new request, there is a one-tick window where no controller is active.

**Impact: LOW**

**Remediation:** Document the single-request guarantee explicitly: voice-form guarantees that at most one endpoint request is in flight at any given time. Add an assertion in `parse()` that throws if called while `activeController !== null`.

---

### 5.3 AbortController Timeout Uses `setTimeout` Directly

**Finding: The endpoint client creates a `setTimeout` for the request timeout, but if `abort()` is called externally (cancel flow), the timeout `setTimeout` is not cleared and will fire after `timeoutMs` even though the request is already done.**

Source: LOW_LEVEL_DESIGN.md Section 4c.

The spec shows:
```typescript
// Step 2: Create timeout
const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs)
// Step 4: Clear timeout on response
// (not explicitly specified — "clear the timeout on response")
```

Step 4 says "clear the timeout on response" but the implementation detail of clearing it on manual `abort()` (cancel flow) is not specified.

**Impact: MEDIUM**

**Remediation:** Explicitly specify in the `EndpointClient.abort()` method that the timeout timer is also cleared. Expose the `timeoutId` to the abort path:

```typescript
async parse(request: ParseRequest): Promise<ParseResponse> {
  this.activeController = new AbortController()
  this.timeoutId = setTimeout(() => this.activeController?.abort(), this.options.timeoutMs)
  try {
    const response = await fetch(/* ... */)
    clearTimeout(this.timeoutId)
    this.timeoutId = null
    // ...
  } catch (err) {
    clearTimeout(this.timeoutId)
    this.timeoutId = null
    throw /* ... */
  }
}

abort(): void {
  clearTimeout(this.timeoutId)
  this.timeoutId = null
  this.activeController?.abort()
  this.activeController = null
}
```

---

### 5.4 Response Size: The `confidence` Field in `ParsedFieldValue`

**Finding: The `ParseResponse` spec requires each field value to be an object `{ value: string, confidence?: number }` rather than a raw string. This doubles the JSON key overhead for every field.**

Source: LOW_LEVEL_DESIGN.md Section 2 (ParsedFieldValue type), Section 4c (validateParseResponse).

For a 10-field response:

- Raw string format: `{"fields":{"name":"John","email":"j@x.com",...}}` = ~120 bytes
- Object format: `{"fields":{"name":{"value":"John","confidence":0.99},...}}` = ~250 bytes

The object format is 2× larger for the same semantic content. On a fast connection this is negligible. On mobile with high latency or throttled connections, every byte matters.

Additionally, the `confidence` score adds developer complexity on the server side — they must extract it from LLM output and format it correctly. Most LLMs do not natively emit confidence scores; the developer would have to synthesize them.

**Impact: MEDIUM**

**Remediation:**

1. Change the default `ParseResponse` format to use raw string values:

   ```typescript
   interface ParseResponse {
     fields: Record<string, string | boolean | string[]>
     confidence?: Record<string, number>  // optional, keyed by field name
   }
   ```

   This is backwards compatible: developers who want to surface confidence scores include the `confidence` map; those who don't can ignore it.

2. If the object-per-field format is kept for API design reasons, add `Accept-Encoding: gzip` to the request and ensure the developer's endpoint compresses the response. Document this as a recommendation.

---

## 6. Comparative Benchmarks

### 6.1 Performance Targets the README Should Advertise

Based on this analysis, these are defensible, measurable claims:

| Metric | Target | Notes |
|---|---|---|
| Core bundle (headless mode) | < 5 KB min+gzip | After UI code split |
| Core bundle (with default UI) | < 8 KB min+gzip | As currently specified |
| Svelte wrapper | < 3 KB min+gzip | As currently specified |
| `createVoiceForm()` init time | < 5 ms | Schema validation + object allocation |
| Field injection (20 fields) | < 16 ms | One animation frame |
| Time-to-recording (post-permission) | < 50 ms | `start()` → STT active |
| State machine dispatch | < 0.1 ms | Pure reducer, no I/O |
| Memory per instance | < 50 KB | Excluding audio buffers |
| Memory leak on 100 mount/unmount cycles | 0 KB net growth | Requires fix from Finding 2.6 |

**Do not advertise:**

- LLM inference time (not controlled by the library)
- Total flow time (button press to filled form) — this includes network and LLM, which vary by 10–100× based on provider

### 6.2 Overhead vs. Hand-Coded Implementation

A developer building the same flow from scratch would incur:

| Component | Bespoke cost | voice-form cost | Delta |
|---|---|---|---|
| Mic permission + Web Speech API setup | ~60–100 lines of code | Provided | 0 |
| State management | ~40–80 lines | Provided | 0 |
| Endpoint fetch + error handling | ~40–60 lines | Provided | 0 |
| DOM injection cross-framework | ~50–80 lines | Provided | 0 |
| Confirmation UI | ~100–200 lines | Provided | 0 |
| Bundle size overhead | 0 KB | 5–8 KB | +5–8 KB |
| Init time overhead | 0 ms | < 5 ms | +5 ms |
| Injection overhead vs. direct DOM | 0 ms | < 16 ms | +16 ms max |
| Event dispatch overhead | 0 ms | < 5 ms per field | +5 ms × N |

The library adds approximately 5–8 KB and 20ms of overhead in exchange for eliminating ~250–450 lines of code and the associated testing burden. For any developer spending more than two hours on the bespoke implementation, this is a clear net win.

### 6.3 Where the Library Adds Latency That Would Not Exist in Bespoke Code

| Step | Library-introduced latency | Why |
|---|---|---|
| Schema validation at init | +1–3 ms | Bespoke code wouldn't validate its own data |
| `ParseRequest` serialization | +0.1–0.5 ms | JSON.stringify on schema every request |
| Response validation (`validateParseResponse`) | +0.1–1 ms | Shape check on every response |
| Synthetic event creation (`new Event(...)`) | +0.01–0.1 ms per event | Unavoidable for framework compat |
| State machine dispatch + listener notification | +0.1–0.5 ms | Overhead of abstraction |

Total library-introduced latency on the hot path (excluding init): **< 5 ms**. This is well within acceptable bounds.

---

## 7. Recommendations

Each finding is consolidated here with impact rating, source document, specific fix, and measurable target.

---

### REC-001 — Code-Split Default UI from Core

**Impact: HIGH**  
**Document:** HIGH_LEVEL_DESIGN.md Section 7.2, LOW_LEVEL_DESIGN.md Section 4f  

Split `ui/default-ui.ts` into a separate build entry. Update `package.json` exports:

```json
{
  "exports": {
    ".":    { "import": "./dist/core.mjs" },
    "./ui": { "import": "./dist/ui.mjs" }
  }
}
```

Framework wrappers import `@voiceform/core/ui`. Headless consumers never load it.

**Target:** Headless core bundle < 5 KB min+gzip. Full core with UI < 8 KB.

---

### REC-002 — Move Prompt Builder to Server Package

**Impact: HIGH**  
**Document:** LOW_LEVEL_DESIGN.md Section 8, HIGH_LEVEL_DESIGN.md Section 2.1  

The `buildSystemPrompt` / `buildUserPrompt` functions and their template strings exist to help developers construct LLM prompts. This code runs on the server, not in the browser. Move it to `@voiceform/server-utils` (or `@voiceform/prompt`) and do not include it in the browser bundle.

**Target:** Eliminates ~1.2–1.8 KB from the core browser bundle.

---

### REC-003 — Fix Retry Timer Leak on Cancel

**Impact: HIGH (correctness)**  
**Document:** LOW_LEVEL_DESIGN.md Section 4c  

Track retry `setTimeout` IDs in `EndpointClient`. Cancel them in `abort()`. This prevents spurious network requests when the user cancels during a retry backoff window.

**Target:** Zero spurious network requests after `cancel()`.

---

### REC-004 — Cache Native Value Setters at Module Scope

**Impact: HIGH**  
**Document:** LOW_LEVEL_DESIGN.md Section 4d  

Move `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')` lookups to module initialization. Cache results as module-level constants. They are looked up on every field injection in the current spec.

**Target:** Single property descriptor lookup per module load, not per injection call.

---

### REC-005 — Fix Memory Leak in State Machine Subscribe/Destroy

**Impact: HIGH**  
**Document:** LOW_LEVEL_DESIGN.md Section 4e, Section 4g  

Add `destroy()` to the `StateMachine` interface. Ensure all framework wrappers call `instance.destroy()` on unmount. Add a memory leak regression test.

**Target:** Memory usage is flat after 100 mount/unmount cycles in a React SPA.

---

### REC-006 — Batch DOM Injection into a Single Animation Frame

**Impact: HIGH**  
**Document:** LOW_LEVEL_DESIGN.md Section 4d  

Use `requestAnimationFrame` in `DomInjector.inject()`. Write all field values in one pass, then dispatch all events in a second pass within the same frame.

**Target:** Injection of 20 fields completes within one 16ms animation frame.

---

### REC-007 — Fix the `onresult` Handler Double-Assignment Bug

**Impact: HIGH (correctness)**  
**Document:** HIGH_LEVEL_DESIGN.md Section 3.2  

Consolidate the Web Speech API `onresult` handler into a single function using `event.resultIndex` for efficient traversal. The current spec overwrites the handler conditionally, creating divergent behavior.

**Target:** Single `onresult` handler, zero duplicated logic, correct behavior regardless of whether `onInterimTranscript` is configured.

---

### REC-008 — Fix AbortController Timeout Not Cleared on `abort()`

**Impact: MEDIUM**  
**Document:** LOW_LEVEL_DESIGN.md Section 4c  

Track the timeout `setTimeout` ID in `EndpointClient`. Clear it in both the normal response path and the `abort()` path. Prevents a timeout callback from firing against a request that has already been cancelled.

**Target:** Zero spurious timeout callbacks after `abort()`.

---

### REC-009 — Cache DOM Element Lookups in `DomInjector`

**Impact: MEDIUM**  
**Document:** LOW_LEVEL_DESIGN.md Section 4d  

Add an element cache to `DomInjector`. Cache on first successful lookup. Invalidate on `updateSchema()`. Reduces O(3n) DOM queries per invocation to O(n) on second and subsequent invocations.

**Target:** Zero querySelector calls on the second and subsequent invocations on the same form.

---

### REC-010 — Add `schemaHash` to `ParseRequest` for Server-Side Caching

**Impact: MEDIUM**  
**Document:** LOW_LEVEL_DESIGN.md Section 2 (ParseRequest), BRD.md FR-009  

Compute a lightweight hash of the serialized schema at `createVoiceForm()` init time. Include it in every `ParseRequest`. Document that developer endpoints can use this to cache schema processing.

**Target:** Developer endpoints can skip schema re-parsing on cache hit, reducing LLM call latency by 50–200ms.

---

### REC-011 — Simplify `ParseResponse` Value Format

**Impact: MEDIUM**  
**Document:** LOW_LEVEL_DESIGN.md Section 2 (ParsedFieldValue), BRD.md FR-010  

Change `ParsedFieldValue` from `{ value: string, confidence?: number }` to a plain `string | boolean | string[]`. Move optional confidence scores to a separate top-level `confidence` map in the response. Reduces JSON payload size by ~50% for typical responses.

**Target:** Typical 10-field response: < 200 bytes JSON.

---

### REC-012 — Deduplicate CSS Style Injection at Module Load Time

**Impact: MEDIUM**  
**Document:** LOW_LEVEL_DESIGN.md Section 4f  

Move the `document.getElementById('voiceform-styles')` existence check from per-instance `mount()` to module initialization. Ensure multiple concurrent `createVoiceForm()` calls do not race to inject the same stylesheet.

**Target:** Exactly one `<style>` tag is injected regardless of how many voice-form instances exist on the page.

---

### REC-013 — Simplify `Array.from` Patterns in STT Adapter

**Impact: MEDIUM**  
**Document:** HIGH_LEVEL_DESIGN.md Section 3.2  

Replace `Array.from(event.results).filter(...).map(...)` with a `for` loop using `event.resultIndex`. Eliminates 3 array allocations per `onresult` event fire.

**Target:** Zero heap allocations in the `onresult` hot path.

---

### REC-014 — Clear Field Highlight Timers in `ui.destroy()`

**Impact: LOW**  
**Document:** UX_SPEC.md Section 6.2  

Track field highlight `setTimeout` IDs. Clear them in `destroy()`. Prevents callbacks against detached DOM elements.

**Target:** Zero DOM operations after `destroy()` is called.

---

### REC-015 — Remove `Math.random()` Fallback in `generateRequestId`

**Impact: LOW**  
**Document:** LOW_LEVEL_DESIGN.md Section 4g  

The browser support matrix universally supports `crypto.randomUUID()`. Remove the fallback. This is dead code in production.

**Target:** Remove ~80 bytes from bundle.

---

### REC-016 — Deduplicate AUTO_RESET Timers

**Impact: LOW**  
**Document:** LOW_LEVEL_DESIGN.md Section 4g  

Track the AUTO_RESET `setTimeout` ID. Cancel it before scheduling a new one in the error recovery path.

**Target:** At most one AUTO_RESET timer active at any time.

---

### REC-017 — Document Confirmation Panel Positioning as Transform-Only

**Impact: LOW**  
**Document:** UX_SPEC.md Section 5.1, Section 10.2  

Add an implementation requirement: the confirmation panel open/close animation MUST use CSS `transform` and `opacity` only — never `top`, `left`, `height`, or `width`. Initial placement calculations (read `getBoundingClientRect` once, write `left`/`top` once) are acceptable at open time only.

**Target:** Zero forced synchronous layouts after the panel's initial placement computation.

---

## 8. Performance Monitoring Recommendations

The library should ship with built-in performance markers so developers can measure voice-form's contribution to their app's performance in production.

### 8.1 Recommended `performance.mark()` / `performance.measure()` Calls

```typescript
// In create-voice-form.ts handleStateTransition:
// idle → recording
performance.mark('voiceform:recording:start')

// recording → processing
performance.mark('voiceform:processing:start')
performance.measure('voiceform:stt-duration', 'voiceform:recording:start', 'voiceform:processing:start')

// processing → confirming
performance.mark('voiceform:confirming:start')
performance.measure('voiceform:endpoint-duration', 'voiceform:processing:start', 'voiceform:confirming:start')

// confirming → done
performance.mark('voiceform:done')
performance.measure('voiceform:injection-duration', 'voiceform:confirming:start', 'voiceform:done')
performance.measure('voiceform:total-duration', 'voiceform:recording:start', 'voiceform:done')
```

Gate these on `config.debug === true` so they do not pollute production performance timelines.

### 8.2 CI Performance Regression Gates

Add to the CI pipeline (beyond the existing bundle size check in BRD.md NFR-001):

- Injection time for a 20-field form in headless Chromium: must complete in < 16ms
- `createVoiceForm()` init time with a 10-field schema: must complete in < 10ms
- State machine dispatch (100,000 transitions): must complete in < 100ms total

Use Playwright's `page.evaluate()` with `performance.measure()` to capture these in the existing browser test suite (TASKS.md P3 / browser tests).

---

## Appendix: Finding Priority Matrix

| ID | Finding | Impact | Effort | Priority |
|---|---|---|---|---|
| REC-001 | Code-split default UI | HIGH | M | 1 |
| REC-003 | Fix retry timer leak | HIGH | S | 1 |
| REC-005 | Fix state machine memory leak | HIGH | S | 1 |
| REC-007 | Fix `onresult` double-assignment | HIGH | S | 1 |
| REC-002 | Move prompt builder server-side | HIGH | M | 2 |
| REC-004 | Cache native value setters | HIGH | S | 2 |
| REC-006 | Batch injection into rAF | HIGH | M | 2 |
| REC-008 | Fix AbortController timeout | MEDIUM | S | 2 |
| REC-009 | Cache DOM element lookups | MEDIUM | S | 2 |
| REC-010 | Add schema hash | MEDIUM | S | 3 |
| REC-011 | Simplify ParseResponse format | MEDIUM | M | 3 |
| REC-012 | Deduplicate style injection | MEDIUM | S | 3 |
| REC-013 | Fix Array.from in STT handler | MEDIUM | S | 3 |
| REC-014 | Clear field highlight timers | LOW | S | 4 |
| REC-015 | Remove Math.random fallback | LOW | S | 4 |
| REC-016 | Deduplicate AUTO_RESET timers | LOW | S | 4 |
| REC-017 | Document transform-only animation | LOW | S | 4 |
