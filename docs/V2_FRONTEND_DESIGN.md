# voice-form v2 — Frontend UX Design

**Status:** Draft  
**Date:** 2026-04-01  
**Author:** Frontend Architect  
**Scope:** FR-108 through FR-116 — Partial Fill, Multi-Step Forms, DOM Auto-Detection, Field-Level Correction  
**Companion docs:** HIGH_LEVEL_DESIGN.md, UX_SPEC.md, types.ts  
**Merge target:** This document will be merged with the v2 React and Whisper design sections into a unified HIGH_LEVEL_DESIGN v2.

---

## Table of Contents

1. [Partial Fill and Append Mode (FR-108, FR-109)](#1-partial-fill-and-append-mode-fr-108-fr-109)
2. [Multi-Step Form Support (FR-110, FR-111)](#2-multi-step-form-support-fr-110-fr-111)
3. [DOM Schema Auto-Detection (FR-112, FR-113)](#3-dom-schema-auto-detection-fr-112-fr-113)
4. [Field-Level Correction in Confirmation (FR-114, FR-115, FR-116)](#4-field-level-correction-in-confirmation-fr-114-fr-115-fr-116)
5. [CSS Custom Property Additions](#5-css-custom-property-additions)
6. [Strings (i18n) Additions](#6-strings-i18n-additions)
7. [Shared Security Implications](#7-shared-security-implications)
8. [Bundle Size Impact](#8-bundle-size-impact)

---

## 1. Partial Fill and Append Mode (FR-108, FR-109)

### 1.1 User Flow

**Standard partial fill (FR-109) — LLM returns null for some fields:**

```
User speaks: "Set priority to high"

LLM response: {
  fields: {
    priority: { value: "high" },
    firstName: null,          // LLM could not extract
    lastName: null,           // LLM could not extract
  }
}

Confirmation panel:
  Priority       high             <-- will be filled
  First name     [Not recognized] <-- unchanged, grayed out
  Last name      [Not recognized] <-- unchanged, grayed out

User confirms → only `priority` is injected. Existing firstName/lastName DOM values are untouched.
```

**Append mode (FR-108) — user adds to an existing textarea:**

```
Existing DOM value of "notes" field: "Patient reports dizziness."
User speaks: "Also note that the patient has a history of hypertension."

LLM response: {
  fields: {
    notes: { value: "the patient has a history of hypertension." }
  }
}

Confirmation panel (appendMode: true):
  Notes   [existing] Patient reports dizziness.
          [adding]   the patient has a history of hypertension.
          [result]   Patient reports dizziness. the patient has a history of hypertension.

User confirms → DOM value becomes the combined string.
```

### 1.2 Configuration Interface Changes

```typescript
// Addition to VoiceFormConfig in types.ts

export interface VoiceFormConfig {
  // ... existing fields ...

  /**
   * When true, new values for text and textarea fields are appended to
   * any existing DOM value rather than replacing it.
   * A single space is used as the separator.
   * Has no effect on number, date, boolean, select, checkbox, or radio fields —
   * those always replace.
   * Default: false.
   * (FR-108)
   */
  appendMode?: boolean

  /**
   * When true, fields not resolved in the current DOM are treated as
   * warnings rather than errors. Required for multi-step forms.
   * Default: false.
   * (FR-111)
   */
  multiStep?: boolean
}
```

### 1.3 ConfirmationData Changes

The `ConfirmationData` type needs two additions to support the append mode display and to carry the pre-existing DOM value for display:

```typescript
// Addition to ConfirmedField in types.ts

export interface ConfirmedField {
  label: string
  value: string                // the new value from LLM (or user correction)
  confidence?: number
  /**
   * When appendMode is true and a pre-existing DOM value was found,
   * this holds that pre-existing value. The final injected value will be
   * `existingValue + ' ' + value`.
   * Undefined when appendMode is false or the existing DOM value was empty.
   * (FR-108)
   */
  existingValue?: string
}

// Addition to ConfirmationData in types.ts

export interface ConfirmationData {
  transcript: string
  parsedFields: Record<string, ConfirmedField>
  missingFields: readonly string[]
  invalidFields: ReadonlyArray<{ name: string; value: string; reason: string }>
  /**
   * When appendMode is true, this flag is set so the confirmation panel
   * knows to render the append preview rows instead of plain value cells.
   * (FR-108)
   */
  appendMode: boolean
}
```

### 1.4 State Machine Changes

No new states are required. The existing `confirming` state carries the `ConfirmationData`, which is extended above. The injector and `buildConfirmationData` are where the behavior changes.

The `buildConfirmationData` function in `create-voice-form.ts` must be extended to:

1. Accept a `formElement` reference and an `appendMode` flag.
2. When `appendMode` is true and the field type is `text` or `textarea`, read the current DOM value of the element and store it in `ConfirmedField.existingValue`.
3. Fields where the LLM returned `null` (i.e., the field name is absent from `ParseResponse.fields`) remain in `missingFields` — this is already the v1 behavior. No change needed here.

Reading the existing DOM value is the only point where `buildConfirmationData` must reach into the DOM. This read must happen before the `confirming` state is entered (in the `processing` handler), not during injection.

### 1.5 Injector Changes

`createInjector` must accept an `appendMode` flag. During injection, for `text` and `textarea` fields where `appendMode` is true and `ConfirmedField.existingValue` is a non-empty string, the injected value must be `existingValue + ' ' + value`.

```typescript
// Addition to InjectorConfig in injector.ts

export interface InjectorConfig {
  formElement?: HTMLElement
  onFill?: (fieldName: string, value: string | boolean | string[]) => void | Promise<void>
  /**
   * When true, new string values for text/textarea fields are appended to
   * existing DOM values rather than replacing them.
   * Default: false. (FR-108)
   */
  appendMode?: boolean
}
```

The injector does not need to read the DOM at injection time for append mode — the `existingValue` snapshot was already captured by `buildConfirmationData` during the `processing` phase. The injector uses the snapshot. This is intentional: the value the user reviewed in the confirmation panel must be exactly what gets injected.

Null fields (fields in `missingFields`) are simply absent from the `parsedFields` object passed to `injector.inject()`. The injector already skips fields it has no data for. No additional change needed.

### 1.6 Confirmation Panel Changes

**Null fields (FR-109):**
The v1 panel already shows "Not understood" badges for `missingFields`. The v2 change is visual:
- The badge background becomes more muted: `var(--vf-unchanged-badge-bg)` (new CSS var, see section 5).
- A tooltip-style `title` attribute reads "This field was not mentioned — your existing value is unchanged."
- In v2 headless mode, `missingFields` in `ConfirmationData` carries this information for custom renderers.

**Append mode preview (FR-108):**
When `ConfirmationData.appendMode` is true and a field has `existingValue` set, the value column in the confirmation panel renders a two-row preview:

```
┌─────────────────────────────────────────────────────┐
│  Notes                                              │
│    Current:  Patient reports dizziness.             │
│    Adding:   the patient has a history of...        │
│    Result:   Patient reports dizziness. the pati... │
└─────────────────────────────────────────────────────┘
```

- "Current:" is rendered in muted text using `var(--vf-append-existing-color)`.
- "Adding:" is rendered in accent text using `var(--vf-append-new-color)`.
- "Result:" is rendered in normal body text.
- Long values are truncated at 120 characters in the "Current" and "Result" rows, with a `title` attribute showing the full value. The "Adding" row is never truncated.
- All three values are rendered with `textContent`, never `innerHTML`.
- ARIA: the field row container gets `aria-label="Notes field: appending to existing value"`.

**Implementation constraint:** The three-row preview is only rendered for fields where `existingValue` is defined and non-empty. Fields where the form input was empty before recording show only the single "Adding" row with no "Current" label.

### 1.7 Security Implications

- The `existingValue` snapshot is read from the DOM at `buildConfirmationData` time. This is developer-controlled DOM data — the form field the developer placed. It is not LLM output and does not need HTML stripping before display. However, it must still be rendered with `textContent` to guard against adversarial page content.
- `appendMode` concatenation produces the final injected string as `existingValue + ' ' + value`. Both components are already sanitized independently before this join. No additional sanitization pass is needed for the concatenated result.
- `appendMode: true` with a `number`, `date`, or `select` field type is silently ignored. No concatenation occurs. This is documented in the config JSDoc.

### 1.8 Performance Implications

- Reading existing DOM values in `buildConfirmationData` is one `element.value` read per text/textarea field. This is O(n) in the number of fields and runs synchronously before the `confirming` state renders. No layout is triggered by `.value` reads.
- The element cache in the injector is populated at `buildConfirmationData` time (via the same `resolveElement` logic) and reused at injection time. No duplicate DOM queries.

---

## 2. Multi-Step Form Support (FR-110, FR-111)

### 2.1 User Flow

```
Step 1 of 3: Personal Information
  Schema: [firstName, lastName, email]

  User activates voice, speaks:
  "Jordan Lee, jordan@example.com"

  Confirmation panel:
    First name   Jordan
    Last name    Lee
    Email        jordan@example.com

  User confirms → fields injected into Step 1 DOM
  User clicks "Next" → Step 2 mounts, Step 1 DOM removed

Step 2 of 3: Address
  Developer calls: instance.setSchema(step2Schema)
  Schema: [street, city, state, zip]

  User activates voice, speaks:
  "123 Main Street, Springfield, IL 62701"

  Confirmation panel:
    Street  123 Main Street
    City    Springfield
    State   IL
    Zip     62701

  User confirms → injected into Step 2 DOM
  User clicks "Next" → Step 3 mounts

Step 3 of 3: Payment
  Developer calls: instance.setSchema(step3Schema)
  ...
```

### 2.2 New Instance Method: setSchema

```typescript
// Addition to VoiceFormInstance in types.ts

export interface VoiceFormInstance {
  // ... existing methods ...

  /**
   * Replace the active schema for the next recording session.
   *
   * Behavior:
   * - Valid only when the state machine is in `idle` state.
   * - Validates the new schema synchronously; throws VoiceFormConfigError on failure.
   * - Clears the injector's element cache so the next inject() call re-queries
   *   freshly mounted DOM elements.
   * - Does NOT clear any pending carryover fields (see carryoverFields below).
   *   Call clearCarryover() first if you want a clean slate.
   *
   * The existing `updateSchema()` method is renamed to `setSchema()` in v2.
   * `updateSchema()` is retained as a deprecated alias through v2 with a console
   * warning, removed at v3.
   *
   * @throws {VoiceFormError} INVALID_TRANSITION if not in idle state.
   * @throws {VoiceFormConfigError} SCHEMA_INVALID if the new schema is invalid.
   * (FR-110)
   */
  setSchema(schema: FormSchema): void

  /**
   * Returns the current schema in use.
   * Useful for multi-step forms where the developer needs to inspect
   * what schema was most recently set.
   */
  getSchema(): FormSchema
}
```

**Relationship to `updateSchema()`:** The existing `updateSchema()` method on `VoiceFormInstance` (introduced in v1 for dynamic form support) is the direct predecessor. `setSchema()` is the v2 rename with identical semantics. The implementation in `create-voice-form.ts` needs only to add the alias.

### 2.3 Step-Aware Injection (FR-111)

The `multiStep: true` config option changes the injector's behavior for missing elements:

| Condition | `multiStep: false` (default) | `multiStep: true` |
|---|---|---|
| Field in schema, no DOM element found | `InjectionOutcome: skipped / element-not-found` | Same outcome; `console.warn` instead of `console.error` |
| All fields skipped (no DOM elements) | `InjectionResult.success = false` | `InjectionResult.success = true` (partial success is acceptable) |
| `TARGET_NOT_FOUND` error | Fired when zero fields could be injected | Not fired; treated as expected |

No new state machine states are needed. The injector's `buildResult` helper must accept a `multiStep` flag to compute `success` differently.

```typescript
// Addition to InjectorConfig in injector.ts

export interface InjectorConfig {
  formElement?: HTMLElement
  onFill?: (fieldName: string, value: string | boolean | string[]) => void | Promise<void>
  appendMode?: boolean
  /**
   * When true, fields not found in the current DOM are treated as expected
   * (not as errors). Used for multi-step/wizard forms where only a subset of
   * schema fields exist in the DOM at any given time.
   * Default: false. (FR-111)
   */
  multiStep?: boolean
}
```

### 2.4 Element Cache Invalidation

`setSchema()` calls `injector.clearCache()`. This is already done by `updateSchema()` in v1. No additional change needed.

The developer is responsible for calling `setSchema()` after their framework has finished mounting the new step's DOM. In React: call `setSchema()` inside a `useEffect` that runs after the new step renders. In Svelte: call it in `onMount` of the new step component or in a `tick()` callback.

Documentation must make this explicit with a code example.

### 2.5 Confirmation Panel Changes

**"Will fill now" vs "saved for later step":** The BRD mentions this concept in FR-110, but the implementation decision here is to keep it simple and correct rather than speculative.

In multi-step mode, the confirmation panel does not show fields from other steps — it shows only the fields returned by the LLM for the current schema. Fields that don't exist in the current DOM are not pre-fetched or buffered by the library. The developer manages step transitions; the library manages the current step.

If the developer wants to pre-fill future steps, they handle that in their own `onDone` callback by storing returned field values and calling `setSchema()` + `instance.confirm()` logic themselves. This is explicitly out of scope for the library.

The confirmation panel in multi-step mode shows a subtle step indicator if the developer provides `formStepLabel` in the strings config:

```
┌─────────────────────────────────────────────────────────┐
│  What I heard          Step 2 of 3: Address        [X]  │
│  ─────────────────────────────────────────────────────  │
│  Street   123 Main Street                               │
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

This label is purely display — the library does not track step numbers. The developer sets it via `strings.confirm.stepLabel`.

### 2.6 State Machine Changes

No new states. The state machine runs identically for each step. `setSchema()` is called between sessions (when the state machine is in `idle`), not mid-session.

One guard addition: `setSchema()` must throw `INVALID_TRANSITION` if called from any state other than `idle`. This mirrors the existing guard on `updateSchema()`.

### 2.7 Security Implications

- Schemas provided via `setSchema()` go through the same `validateSchema()` path as the initial schema at `createVoiceForm()` time. No trust elevation.
- Clearing the element cache on schema change is important: stale cached elements from Step 1's DOM could theoretically receive injected values if their elements happened to survive a virtual DOM reconciliation in a framework's keyed list. `clearCache()` prevents this.

### 2.8 Performance Implications

- `setSchema()` is synchronous and O(n) in schema field count (validation scan). No performance concern.
- Cache clearing is `Map.clear()` — O(1).
- No DOM access occurs at `setSchema()` time; DOM queries are deferred to the next `inject()` call.

---

## 3. DOM Schema Auto-Detection (FR-112, FR-113)

### 3.1 User Flow

```
Developer has a form with no explicit schema:

  <form id="checkout">
    <label for="first-name">First Name</label>
    <input id="first-name" name="firstName" type="text" required />

    <label for="email">Email Address</label>
    <input id="email" name="email" type="email" />

    <label for="country">Country</label>
    <select name="country">
      <option value="">Select...</option>
      <option value="US">United States</option>
      <option value="CA">Canada</option>
    </select>
  </form>

Developer config:
  createVoiceForm({
    endpoint: '/api/voice-parse',
    formElement: '#checkout',
    autoDetectSchema: true,
    onSchemaDetected: (schema) => {
      console.log(schema) // inspect before use
      return schema       // return optionally modified schema
    }
  })

Detected schema (before onSchemaDetected):
  {
    formName: undefined,
    fields: [
      { name: 'firstName', label: 'First Name', type: 'text', required: true },
      { name: 'email',     label: 'Email Address', type: 'email' },
      { name: 'country',   label: 'Country', type: 'select',
        options: ['US', 'CA'] }
    ]
  }
```

### 3.2 New Utility Function: detectSchema

This is shipped as a standalone export from `@voiceform/core`, not wired into `createVoiceForm` automatically. The auto-detection is opt-in at two levels: the config option, and the separately importable utility.

```typescript
// New export from packages/core/src/schema/detect-schema.ts
// Re-exported from packages/core/src/index.ts

/**
 * Scans a form element and returns a FormSchema inferred from its DOM structure.
 *
 * The returned schema is a best-effort inference. Always review the result
 * via the `onSchemaDetected` callback before it is used for LLM parsing.
 *
 * Detection algorithm:
 *   1. Query all <input>, <textarea>, <select> within formElement.
 *   2. Exclude: type="hidden", type="submit", type="reset", type="button",
 *      type="image", elements with no name and no id.
 *   3. For each element, extract:
 *      - name: element.name ?? element.id
 *      - label: resolved label text (see label resolution below)
 *      - type: mapped from element.type / tagName (see type mapping below)
 *      - options: for <select> elements, the non-empty option values
 *      - required: element.required
 *   4. For radio groups: deduplicate by name, collect all values as options,
 *      produce a single FieldSchema with type: 'radio'.
 *   5. Elements with no resolvable name are excluded with a console.warn.
 *
 * Label resolution order (first match wins):
 *   1. <label for="id"> where for === element.id
 *   2. aria-labelledby pointing to an element with textContent
 *   3. aria-label attribute
 *   4. Closest ancestor <label> element's textContent
 *   5. placeholder attribute
 *   6. element.name (fallback — not a real label but better than nothing)
 *
 * Type mapping:
 *   input[type=text|search|url|password] → 'text'
 *   input[type=email]                   → 'email'
 *   input[type=tel]                     → 'tel'
 *   input[type=number|range]            → 'number'
 *   input[type=date|month|week|time|datetime-local] → 'date'
 *   input[type=checkbox]                → 'checkbox'
 *   input[type=radio]                   → 'radio'
 *   textarea                            → 'textarea'
 *   select                              → 'select'
 *
 * @param formElement  The root element to scan. Typically a <form>.
 * @returns A FormSchema. May have zero fields if nothing is detectable.
 *
 * Security: This function reads only developer-controlled DOM attributes
 * (name, id, type, label text, placeholder, aria-label). It does not read
 * any current input values. The returned schema contains no user data.
 * (FR-112)
 */
export function detectSchema(formElement: HTMLElement): FormSchema
```

### 3.3 Config Interface Changes

```typescript
// Addition to VoiceFormConfig in types.ts

export interface VoiceFormConfig {
  // ... existing fields ...

  /**
   * When true and no explicit `schema` is provided, voice-form scans the
   * `formElement` (or `document` if not set) to infer a schema from the DOM.
   *
   * The auto-detected schema is passed to `onSchemaDetected` before use.
   * If `onSchemaDetected` returns a schema, that schema is used instead.
   *
   * If both `schema` and `autoDetectSchema: true` are provided, the explicit
   * schema takes precedence and a console.warn is emitted.
   *
   * Default: false. (FR-113)
   */
  autoDetectSchema?: boolean

  /**
   * Called once after schema auto-detection completes (when autoDetectSchema
   * is true). Receives the detected FormSchema.
   *
   * Return a modified FormSchema to override the detected schema.
   * Return undefined or void to accept the detected schema as-is.
   *
   * The returned schema is validated by the same validateSchema() pipeline
   * as any developer-provided schema. (FR-112)
   */
  onSchemaDetected?: (schema: FormSchema) => FormSchema | void
}
```

### 3.4 Initialization Sequence Changes

When `autoDetectSchema: true` is set and `schema` is absent, the `createVoiceForm` initialization sequence becomes:

```
1. Validate that formElement is resolvable (existing behavior)
2. Call detectSchema(formElement) → rawSchema
3. Call onSchemaDetected(rawSchema) if provided → maybeOverride
4. Use maybeOverride ?? rawSchema as currentSchema
5. Call validateSchema(currentSchema) — throws VoiceFormConfigError on failure
6. Continue with normal initialization
```

Step 2 occurs synchronously. The `detectSchema` function is a pure DOM read with no side effects. It must complete before the state machine is initialized.

### 3.5 Label Resolution Algorithm (detailed)

```typescript
// Internal to detect-schema.ts

function resolveLabel(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  root: HTMLElement,
): string {
  // 1. <label for="id">
  if (el.id) {
    const associated = root.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`)
    if (associated?.textContent?.trim()) {
      return associated.textContent.trim()
    }
  }

  // 2. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    // aria-labelledby can be a space-separated list of ids
    const ids = labelledBy.split(/\s+/)
    const labelText = ids
      .map(id => root.querySelector(`#${CSS.escape(id)}`)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
    if (labelText) return labelText
  }

  // 3. aria-label
  const ariaLabel = el.getAttribute('aria-label')?.trim()
  if (ariaLabel) return ariaLabel

  // 4. Closest ancestor <label>
  const ancestorLabel = el.closest('label')
  if (ancestorLabel?.textContent?.trim()) {
    return ancestorLabel.textContent.trim()
  }

  // 5. placeholder
  const placeholder = el.getAttribute('placeholder')?.trim()
  if (placeholder) return placeholder

  // 6. name fallback
  return el.name ?? el.id ?? ''
}
```

`CSS.escape()` is used in all selector constructions, consistent with MED-002. Label text is used as the `label` property on `FieldSchema`, which is sent to the LLM endpoint and visible in the developer's browser Network tab. No user-entered values are included.

### 3.6 Radio Group Detection

Radio inputs are not treated individually. The algorithm:

1. Collect all `input[type=radio]` elements.
2. Group by `name` attribute.
3. For each group, produce one `FieldSchema` with `type: 'radio'` and `options` = the array of all distinct `value` attributes in the group.
4. The `label` for the group is resolved from the first radio in the group using the standard label resolution order, with one additional step: look for a `<fieldset>/<legend>` ancestor. If found, the legend text is used as the label.

```typescript
// Fieldset/legend resolution (step added before the standard label resolution)

function resolveRadioGroupLabel(
  firstRadio: HTMLInputElement,
  root: HTMLElement,
): string {
  const fieldset = firstRadio.closest('fieldset')
  const legend = fieldset?.querySelector('legend')
  if (legend?.textContent?.trim()) {
    return legend.textContent.trim()
  }
  return resolveLabel(firstRadio, root)
}
```

### 3.7 Security Implications

- `detectSchema` reads only element attributes and label text — structural data authored by the developer. It never reads `element.value` (current user input). This boundary is important: a misuse of the function that reads user input and includes it in the schema (which gets sent to the BYOE endpoint) would be a data leakage vector. The function must not be extended to read values.
- Label text may contain content from the developer's CMS or i18n system. If this content contains `<script>` or other markup, it still routes through the LLM prompt as a label string on the server side, not into the browser DOM. The `detectSchema` return value is a data structure, not HTML — no XSS risk on the client. Server-side prompt injection from crafted label text is a theoretical concern; the `@voiceform/server-utils` prompt builder already wraps the schema in a JSON-serialized block, which provides structural separation.
- `autoDetectSchema: true` with `schema` explicitly provided is a no-op for auto-detection. The warning is emitted to catch developer misconfiguration, not a security concern.

### 3.8 Performance Implications

- `detectSchema` is a single synchronous DOM scan. For a form with 20 fields it issues at most 20 × 3 = 60 DOM queries (name-based label lookup, aria-labelledby lookup, ancestor label scan). On modern hardware this completes in under 1ms.
- The scan happens once at `createVoiceForm()` initialization time, not on every recording session.
- The result is passed to `validateSchema()` which is already O(n) in field count.
- `detectSchema` is exported as a standalone function and is separately importable and tree-shakeable. It is not included in the headless core bundle unless the developer explicitly imports it or passes `autoDetectSchema: true`.

### 3.9 Bundle Size Note

`detect-schema.ts` is an additional module within `@voiceform/core`. It must be a separate subpath export so it can be tree-shaken:

```
@voiceform/core/detect-schema
```

Estimated size: approximately 1.2–1.8 KB minified+gzip. It must not be imported by `create-voice-form.ts` unconditionally. The `autoDetectSchema` config path must import it via a dynamic `import()` or the developer must import and wire it themselves using the standalone `detectSchema` export. The dynamic import path is preferred for the non-headless default UI wrapper; the standalone export is preferred for headless/framework-wrapper consumers.

---

## 4. Field-Level Correction in Confirmation (FR-114, FR-115, FR-116)

### 4.1 User Flow

**Editing a parsed value (FR-114):**

```
Confirmation panel after LLM parse:

  First name    Jordan               [edit icon]
  Last name     Lee                  [edit icon]
  Email         jordan@exmple.com    [edit icon, ⚠ typo]
  Priority      [Not recognized]     [edit icon]

User clicks on "Email" row:

  First name    Jordan               [edit icon]
  Last name     Lee                  [edit icon]
  Email         [jordan@exmple.com_] [save] [discard]    ← inline input
  Priority      [Not recognized]     [edit icon]

User corrects: "jordan@example.com", clicks save or presses Enter:

  First name    Jordan               [edit icon]
  Last name     Lee                  [edit icon]
  Email         jordan@example.com   [edit icon]          ← no ⚠ now
  Priority      [Not recognized]     [edit icon]

Fill form button becomes "Fill form (edited)" to signal corrections were made.
User confirms → all values injected, including corrected email.
```

**Filling in a null field (FR-115):**

```
User clicks on "Priority" row (currently "Not recognized"):

  Priority      [                 _] [save] [discard]    ← empty input

User types: "high", clicks save:

  Priority      high                 [edit icon]

Fill form button reads "Fill form (edited)".
User confirms → all four fields injected.
```

**Discarding a correction:**

```
User clicks [discard] or presses Escape while editing:
  - The input closes.
  - The value reverts to the pre-edit state (either the LLM value or "Not recognized").
  - If no other edits were made, Fill form button reverts to "Fill form".
```

### 4.2 ConfirmationData Changes

To support field-level correction, `ConfirmedField` needs a flag indicating whether a field was manually edited:

```typescript
// Addition to ConfirmedField in types.ts

export interface ConfirmedField {
  label: string
  value: string
  confidence?: number
  existingValue?: string       // append mode (from section 1)
  /**
   * Set to true when the user has manually edited this field's value
   * in the confirmation panel. The original LLM-parsed value is preserved
   * in `originalValue` for the onDone callback.
   * (FR-114)
   */
  userCorrected?: boolean
  /**
   * The original LLM-parsed value before user correction.
   * Only present when userCorrected is true.
   * (FR-114)
   */
  originalValue?: string
}
```

The `InjectionResult` passed to `onDone` will carry these flags on the fields that were corrected. This allows the developer to log or track LLM accuracy separately from user-corrected outcomes.

### 4.3 Inline Edit State (UI Layer Only)

The edit state is local to the confirmation panel UI. It is not represented in the core state machine. The panel maintains its own per-field edit state using standard component-level state (a `Map<fieldName, EditState>`):

```typescript
// Internal to the confirmation panel UI — not part of the public type system

interface EditState {
  active: boolean     // is this field currently in edit mode?
  draftValue: string  // the value in the input while editing
}
```

When the user saves a correction:
1. `ConfirmationData.parsedFields[fieldName].value` is updated to the sanitized draft value.
2. `ConfirmationData.parsedFields[fieldName].userCorrected = true`.
3. `ConfirmationData.parsedFields[fieldName].originalValue` = the previous value (or `undefined` if it was a null fill).
4. The edit state for that field is cleared (active = false).
5. If any field has been corrected, the "Fill form" button label switches to `strings.confirm.fillLabelEdited`.

When the user discards:
1. The draft value is cleared.
2. The edit state for that field is cleared (active = false).
3. `ConfirmedField.userCorrected` remains as-is (a discard does not undo a prior save within the same session — the user would need to edit again and restore the original value manually).

### 4.4 Re-Sanitization Pipeline (FR-116)

When the user saves a correction:

1. The draft value string is passed through `sanitizeFieldValue(draftValue, field.type, field.options)` — the same pipeline applied to LLM output.
2. If sanitization modifies the value (HTML stripped, invalid select option rejected), the sanitized value is used and the sanitization warning icon is shown for that field.
3. If sanitization produces an empty string from a non-empty draft (e.g., the user typed only HTML tags), the save is rejected and the input field shows a validation error message: `strings.confirm.invalidValueLabel`.
4. For `select` and `radio` fields, the dropdown/radio group is the edit control — free-text entry is not permitted. The options come from `FieldSchema.options`. The user picks from the list. No sanitization concern for select option membership.
5. For `checkbox` fields, the edit control is a toggle — the value is `'true'` or `'false'`. No sanitization concern.

```typescript
// Called by the confirmation panel save handler before updating ConfirmedField.value

function sanitizeUserCorrection(
  draftValue: string,
  fieldType: FieldType,
  options: readonly string[] | undefined,
): { value: string; wasModified: boolean; rejected: boolean } {
  if (draftValue.trim() === '') {
    // Empty save = user wants to clear the field
    // For null fill-in (FR-115), empty string means "skip this field"
    return { value: '', wasModified: false, rejected: false }
  }

  const result = sanitizeFieldValue(draftValue, fieldType, options as string[] | undefined)

  if (typeof result.value === 'string' && result.value.trim() === '' && draftValue.trim() !== '') {
    // Sanitization consumed the entire value — reject the save
    return { value: draftValue, wasModified: true, rejected: true }
  }

  const finalValue = typeof result.value === 'string' ? result.value : String(result.value)
  return { value: finalValue, wasModified: result.wasModified, rejected: false }
}
```

### 4.5 Panel DOM and ARIA (Detailed)

**Field row structure (view mode):**

```html
<div
  class="vf-field-row"
  role="row"
  data-field-name="email"
>
  <span class="vf-field-label" role="rowheader" id="vf-label-email">
    Email
  </span>
  <div class="vf-field-value-cell" role="cell">
    <span class="vf-field-value" id="vf-value-email">
      jordan@example.com
    </span>
    <button
      class="vf-field-edit-btn"
      aria-label="Edit Email"
      aria-describedby="vf-value-email"
      type="button"
    >
      <!-- edit icon SVG -->
    </button>
  </div>
</div>
```

**Field row structure (edit mode):**

```html
<div
  class="vf-field-row vf-field-row--editing"
  role="row"
  data-field-name="email"
>
  <span class="vf-field-label" role="rowheader" id="vf-label-email">
    Email
  </span>
  <div class="vf-field-value-cell" role="cell">
    <input
      class="vf-field-correction-input"
      type="email"
      value="jordan@exmple.com"
      aria-labelledby="vf-label-email"
      aria-describedby="vf-correction-hint-email"
      aria-required="false"
      autocomplete="off"
      data-1p-ignore          <!-- 1Password -->
      data-lpignore="true"    <!-- LastPass -->
    />
    <span id="vf-correction-hint-email" class="vf-sr-only">
      Edit the value for Email. Press Enter to save, Escape to cancel.
    </span>
    <button
      class="vf-field-save-btn"
      aria-label="Save Email correction"
      type="button"
    >Save</button>
    <button
      class="vf-field-discard-btn"
      aria-label="Discard Email correction"
      type="button"
    >Cancel</button>
  </div>
</div>
```

**Edit control type by FieldType:**

| FieldType | Edit control | Notes |
|---|---|---|
| `text` | `<input type="text">` | |
| `email` | `<input type="email">` | |
| `tel` | `<input type="tel">` | |
| `number` | `<input type="number">` | |
| `date` | `<input type="date">` | |
| `textarea` | `<textarea>` | Resizes to content |
| `select` | `<select>` with `<option>` elements | Options from `FieldSchema.options` |
| `radio` | `<select>` with `<option>` elements | Radio rendered as dropdown in panel; DOM injection still uses radio group |
| `checkbox` | `<input type="checkbox">` | Checked = true, unchecked = false |

The input type attribute for `email`, `tel`, `number`, and `date` fields in the correction input provides browser-native validation affordances (keyboard type on mobile, date picker on desktop). This complements, but does not replace, the `sanitizeUserCorrection` pipeline.

**Password fields:** `input[type=password]` elements detected by `detectSchema` or explicitly typed in the schema are excluded from the confirmation panel entirely — their values are never shown. This is a security constraint, not a UX limitation. Password fields should not be filled by voice in any case.

### 4.6 Focus Management

**Opening edit mode:**
1. Focus moves from the edit button to the correction input immediately.
2. The correction input value is selected (all text pre-selected) for quick replacement.
3. `aria-live="polite"` region announces: `strings.announcements.fieldEditOpened` (e.g., "Editing Email field").

**Saving:**
1. Focus returns to the edit button for that field (not to the next field — the user may want to review).
2. `aria-live="polite"` announces: `strings.announcements.fieldEditSaved` (e.g., "Email saved").

**Discarding:**
1. Focus returns to the edit button for that field.
2. No announcement (silent discard).

**Keyboard navigation in the confirmation panel with editable fields:**
- Tab order: `[X dismiss]` → `[field edit buttons and/or inputs in DOM order]` → `[Cancel]` → `[Fill form]` → wraps.
- When a field is in edit mode, Tab inside the correction input moves to Save, then to Discard, then to the next field's edit button (skipping the closed value display).
- Escape from within a correction input discards and returns focus to the field's edit button.
- Enter from within a correction input (when `type` is not `textarea`) saves. For textarea, Enter inserts a newline; Shift+Escape is the discard shortcut there, and a visible "Save" button is the primary confirmation.

### 4.7 Config Interface Changes

```typescript
// Addition to VoiceFormConfig in types.ts

export interface VoiceFormConfig {
  // ... existing fields ...

  /**
   * When false, the confirmation panel shows field values as static text
   * and the edit controls are not rendered.
   * Default: true (inline editing is on by default in v2). (FR-114)
   */
  allowFieldCorrection?: boolean
}
```

### 4.8 VoiceFormEvents Changes

```typescript
// Addition to VoiceFormEvents in types.ts

export interface VoiceFormEvents {
  // ... existing callbacks ...

  /**
   * Called after all fields have been injected.
   * v2 extension: receives correctedFields alongside the existing result.
   *
   * `correctedFields` is a subset of the injected fields where
   * `userCorrected === true`. It is empty if no corrections were made.
   *
   * The existing `onDone` signature is unchanged — `result` now contains
   * ConfirmedFields with the new `userCorrected` and `originalValue` properties.
   * (FR-114)
   */
  onDone?: (result: InjectionResult) => void
  // onDone is not a new callback — ConfirmedField carries the correction metadata.
  // InjectionResult.fields maps fieldName → FieldInjectionOutcome, which already
  // carries the final injected value. The developer accesses correction metadata
  // via VoiceFormInstance.getParsedFields() before confirm() is called, or via
  // the onBeforeConfirm hook.
}
```

The confirmed fields with correction metadata are accessible via `instance.getParsedFields()` from the `confirming` state before the user presses "Fill form". The developer's `onBeforeConfirm` hook also receives the `ConfirmationData` which includes `userCorrected` on each field. No new callback is needed.

### 4.9 Strings Additions

```typescript
// Additions to VoiceFormStrings.confirm in types.ts

confirm: {
  // ... existing strings ...

  /** Edit button aria-label for a field. Receives field label. Default: "Edit {label}". */
  editAriaLabel: string | ((fieldLabel: string) => string)

  /** Save button label in edit mode. Default: "Save". */
  saveEditLabel: string

  /** Save button aria-label. Receives field label. Default: "Save {label} correction". */
  saveEditAriaLabel: string | ((fieldLabel: string) => string)

  /** Discard button label in edit mode. Default: "Cancel". */
  discardEditLabel: string

  /** Discard button aria-label. Receives field label. Default: "Discard {label} correction". */
  discardEditAriaLabel: string | ((fieldLabel: string) => string)

  /** Validation error shown when sanitization rejects the draft. Default: "Invalid value". */
  invalidValueLabel: string

  /** Hint text read by screen readers in edit mode. Default: "Press Enter to save, Escape to cancel." */
  editHintText: string
}
```

```typescript
// Additions to VoiceFormStrings.announcements in types.ts

announcements: {
  // ... existing strings ...

  /** Announced when a field enters edit mode. Receives field label. */
  fieldEditOpened: string | ((fieldLabel: string) => string)

  /** Announced when a field correction is saved. Receives field label. */
  fieldEditSaved: string | ((fieldLabel: string) => string)
}
```

### 4.10 Security Implications

- **User input re-sanitization is mandatory (FR-116).** The user's typed correction goes through `sanitizeFieldValue` before it updates `ConfirmedField.value`. This is the same pipeline as LLM output. A user who types `<script>alert(1)</script>` into a correction input sees the HTML-stripped result in the confirmation panel and that stripped value is what gets injected.
- **Password manager suppression.** The `data-1p-ignore` and `data-lpignore="true"` attributes on correction inputs prevent password managers from offering to fill or save these ephemeral inputs. Without these, a password manager might overwrite the LLM-parsed value with a saved credential, silently corrupting the user's correction.
- **Input type selection in edit controls.** Using `type="email"` for an email field provides browser auto-complete suggestions. This is acceptable — the developer's form has the same field, and auto-complete for email is expected behavior. For `type="date"`, the browser date picker surfaces. This is acceptable and useful. No sensitive information is introduced by these native browser affordances.
- **`allowFieldCorrection: false` is a hard gate.** When this option is false, no edit controls are rendered in the DOM. There is no way for the user to modify values through the library's UI. Custom headless renderers that receive `ConfirmationData` are outside the library's control.

### 4.11 Performance Implications

- The edit state `Map<fieldName, EditState>` is O(1) for all operations.
- Re-sanitization on save is synchronous (DOMParser-based HTML stripping). For a single field, this completes in under 1ms.
- Each field row's edit mode is toggled by adding/removing a CSS class (`vf-field-row--editing`). No DOM reconstruction per edit toggle.
- The correction input is constructed in the panel's deferred DOM build (first `confirming` state entry), not per-edit. The input is hidden via CSS when not in edit mode (`display: none` on `.vf-field-row:not(.vf-field-row--editing) .vf-field-correction-input`) and shown when editing.
- The static value display and the correction input coexist in the DOM. The static display is hidden (`display: none`) when the row is in edit mode. This avoids creating/destroying DOM nodes on every edit toggle, which is important for forms with many fields.

---

## 5. CSS Custom Property Additions

All new CSS custom properties follow the existing `--vf-` prefix convention. They are set on the component's root element, not on `:root`.

| Property | Default | Purpose |
|---|---|---|
| `--vf-unchanged-badge-bg` | `#f3f4f6` | Background for "Not recognized / unchanged" badge in null fields (replaces the v1 amber badge — neutral is more appropriate when the field is simply unchanged) |
| `--vf-unchanged-badge-text` | `#6b7280` | Text color for unchanged badge |
| `--vf-append-existing-color` | `#9ca3af` | "Current:" label text color in append mode preview |
| `--vf-append-new-color` | `#2563eb` | "Adding:" label text color in append mode preview |
| `--vf-field-edit-btn-color` | `#6b7280` | Edit icon button color (idle) |
| `--vf-field-edit-btn-hover-color` | `#111827` | Edit icon button color (hover) |
| `--vf-field-edit-input-border` | `#2563eb` | Correction input border color (active) |
| `--vf-field-edit-input-bg` | `#eff6ff` | Correction input background |
| `--vf-field-edit-invalid-color` | `#dc2626` | Validation error text color for rejected corrections |
| `--vf-field-corrected-indicator` | `#2563eb` | Left-border accent on a corrected field row |

**New CSS classes added by the default UI:**

| Class | Applied to | When |
|---|---|---|
| `vf-field-row` | Each field row `<div>` | Always |
| `vf-field-row--editing` | Field row `<div>` | While the field is in edit mode |
| `vf-field-row--corrected` | Field row `<div>` | After a correction has been saved |
| `vf-field-row--appending` | Field row `<div>` | When `appendMode` is true and the field has an `existingValue` |
| `vf-field-row--null` | Field row `<div>` | When the field is in `missingFields` |
| `vf-field-corrected-indicator` | Left-border element | When `vf-field-row--corrected` is active |

---

## 6. Strings (i18n) Additions

Summary of all new string keys introduced in this design (see individual sections for full definitions):

**`confirm` namespace additions:**
- `editAriaLabel`
- `saveEditLabel`
- `saveEditAriaLabel`
- `discardEditLabel`
- `discardEditAriaLabel`
- `invalidValueLabel`
- `editHintText`
- `stepLabel` (multi-step, optional)
- `appendExistingLabel` (append mode "Current:" label)
- `appendNewLabel` (append mode "Adding:" label)
- `appendResultLabel` (append mode "Result:" label)
- `unchangedLabel` (replaces "Not understood" for null fields to better convey that the existing value is preserved)

**`announcements` namespace additions:**
- `fieldEditOpened`
- `fieldEditSaved`

All new string keys have English defaults in the library. Developers override via the existing `strings` config option using deep merge.

---

## 7. Shared Security Implications

This section consolidates cross-feature security decisions that apply to multiple sections above.

**User-provided values enter the sanitization pipeline the same way as LLM output.**
The `sanitizeFieldValue` function is the single gate for all values that reach the DOM. Whether the value came from the LLM (FR-020), from a developer's `onBeforeConfirm` hook (FR-116), or from a user typing in a correction input (FR-114, FR-116), it passes through `sanitizeFieldValue` before `ConfirmedField.value` is updated and before `injector.inject()` is called. This is the correct invariant. Any future code path that produces a value destined for the DOM must route through this function.

**Schema auto-detection does not touch user input.**
`detectSchema` reads structural metadata (element attributes, label text) only. Current form values (`element.value`, `element.checked`) are never read or included in the detected schema. This boundary must be maintained in any future extension of `detectSchema`.

**Multi-step schema changes are validated.**
`setSchema()` calls `validateSchema()` on the new schema. A schema returned from `onSchemaDetected` is also validated. There is no code path that allows an unvalidated schema to reach the LLM endpoint.

**The append mode value is a client-side read, not a server-round-trip.**
The `existingValue` snapshot is read from `element.value` in the browser. This value is shown to the user in the confirmation panel as "Current:". If an adversary could inject content into the form field value (via XSS in the parent application), that content would appear in the panel. However, this is not a voice-form vulnerability — it would be an existing XSS issue in the host application. voice-form renders `existingValue` via `textContent`, so any HTML in the value is inert in the panel display. The concatenated string written back to the DOM on injection is also set via the native value setter, not `innerHTML`.

---

## 8. Bundle Size Impact

Estimated incremental size impact of all v2 frontend features over the v1 baseline:

| Feature | New module(s) | Estimated size (min+gz) |
|---|---|---|
| Partial fill / append mode | Changes within `injector.ts`, `create-voice-form.ts` | ~0.2 KB (no new module) |
| Multi-step support | `setSchema()` alias, injector flag | ~0.1 KB (no new module) |
| DOM auto-detection | `schema/detect-schema.ts` (separate subpath) | ~1.4 KB (separately importable) |
| Field-level correction UI | Changes within `ui/default-ui.ts` | ~1.8 KB (UI module already separate subpath) |
| New strings | Additional string keys in string tables | ~0.2 KB |

**Total incremental impact on the headless core bundle (`@voiceform/core`):** approximately 0.5 KB min+gz (the partial fill, multi-step, and string additions are within existing modules).

**Total incremental impact on the UI bundle (`@voiceform/core/ui`):** approximately 2.0 KB min+gz (correction UI is the dominant addition).

**`@voiceform/core/detect-schema` subpath:** approximately 1.4 KB min+gz, only included when the developer imports it or uses `autoDetectSchema: true`.

These estimates are within the v2 bundle targets established in the BRD. The headless core remains under 5.5 KB and the combined headless+UI bundle remains under 11 KB min+gz.

---

## Appendix A: Type Summary — All v2 Additions to types.ts

The following is a consolidated diff summary of type changes, for the engineer merging this with the React/Whisper design sections before producing a unified types.ts update.

**Modified interfaces:**

- `ConfirmedField`: add `existingValue?: string`, `userCorrected?: boolean`, `originalValue?: string`
- `ConfirmationData`: add `appendMode: boolean`
- `VoiceFormConfig`: add `appendMode?: boolean`, `multiStep?: boolean`, `autoDetectSchema?: boolean`, `onSchemaDetected?: (schema: FormSchema) => FormSchema | void`, `allowFieldCorrection?: boolean`
- `VoiceFormInstance`: add `setSchema(schema: FormSchema): void`, `getSchema(): FormSchema`; deprecate `updateSchema()` as alias
- `InjectorConfig`: add `appendMode?: boolean`, `multiStep?: boolean`
- `VoiceFormStrings.confirm`: add `editAriaLabel`, `saveEditLabel`, `saveEditAriaLabel`, `discardEditLabel`, `discardEditAriaLabel`, `invalidValueLabel`, `editHintText`, `stepLabel`, `appendExistingLabel`, `appendNewLabel`, `appendResultLabel`, `unchangedLabel`
- `VoiceFormStrings.announcements`: add `fieldEditOpened`, `fieldEditSaved`
- `VoiceFormCSSVars`: add all new `--vf-*` properties listed in section 5

**New exports from `@voiceform/core`:**
- `detectSchema(formElement: HTMLElement): FormSchema` (from `@voiceform/core/detect-schema` subpath)

**New exports from `@voiceform/core` (main entry):**
- None. All changes are additions to existing interfaces.

---

## Appendix B: Open Questions for Architecture Merge

These questions must be resolved when merging this document with the React and Whisper sections:

1. **OQ-005 (BRD):** Should `setSchema()` trigger a fresh `detectSchema()` scan when `autoDetectSchema` is also enabled? Recommendation: Yes, but only if `formElement` is set. If `autoDetectSchema` is true and `setSchema()` is called, re-scan the `formElement` and use the new detection as the base, then call `onSchemaDetected` again. This allows the developer to call `setSchema()` as a "re-detect" trigger between steps without passing a schema manually.

2. **React wrapper confirmation panel:** The field-level correction state (`Map<fieldName, EditState>`) is local UI state. In the React wrapper, this will be `useState` inside the confirmation component. The Svelte wrapper will use reactive stores. The core library does not own this state — it lives in the UI layer. The core's `ConfirmationData` is updated only when the user saves a correction (via the `instance.updateCorrectedField()` method — see below).

3. **Missing method:** The panel needs a way to update `ConfirmedField.value` in the core's held state after a user correction. Currently `ConfirmationData` is held inside the state machine's `confirming` state data, which is immutable from outside. The cleanest path is a new instance method:

   ```typescript
   /**
    * Update a single field's value in the current ConfirmationData.
    * Valid only from `confirming` state.
    * The new value is re-sanitized before being stored.
    * Used by the confirmation panel UI to persist user corrections into
    * the core's state before confirm() is called.
    * (FR-114, FR-116)
    */
   correctField(fieldName: string, newValue: string): void
   ```

   This method is called by the UI layer's "save correction" handler. It re-sanitizes the value and updates the in-memory `ConfirmationData`. When the user then calls `confirm()`, the corrected values are already in the state machine's `confirming` data and flow through to injection without any special handling. This is the correct separation: the UI layer owns the per-field edit control state; the core owns the canonical `ConfirmationData`.

   This method must be included in the `VoiceFormInstance` interface. It should be added to the `types.ts` v2 diff.
