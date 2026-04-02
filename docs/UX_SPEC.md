# voice-form — UX Specification

**Version:** aligned with v1.0 / v2.0 roadmap
**Last updated:** 2026-04-01
**Status:** Authoritative design spec — changes require team review

---

## Table of Contents

1. [Mental Model and Design Principles](#1-mental-model-and-design-principles)
2. [Complete User Flow](#2-complete-user-flow)
3. [State Machine and Visual States](#3-state-machine-and-visual-states)
4. [Microphone Button Design](#4-microphone-button-design)
5. [Confirmation Panel Design](#5-confirmation-panel-design)
6. [Success State](#6-success-state)
7. [Error States](#7-error-states)
8. [Accessibility](#8-accessibility)
9. [Theming and CSS Custom Properties](#9-theming-and-css-custom-properties)
10. [Responsive Behavior](#10-responsive-behavior)
11. [Microcopy and i18n](#11-microcopy-and-i18n)
12. [Privacy Notice Flow](#12-privacy-notice-flow)

---

## 1. Mental Model and Design Principles

### The User's Mental Model

The user should understand voice-form as: "I speak, it listens, I confirm, the form fills." Every design decision reinforces this four-beat rhythm. Nothing should happen invisibly. Nothing should be irreversible without review.

### Design Principles

**Confirmation is not optional.** The user always sees what was heard before values are written to the form. This is a product principle that cannot be configured away. It builds trust and protects against LLM misparse.

**The form is still the primary interface.** voice-form is an input accelerator, not a replacement for the form. The button lives inline with the form. It does not float, overlay, or compete for visual attention. When not in use, it is quiet.

**Failure is expected; recovery must be easy.** Mic permissions get denied. Speech goes undetected. LLMs misparse. Every error state has a clear message and an obvious path back to normal form use. The user should never feel stuck.

**Developer placement, not library placement.** The button renders wherever the developer drops the component. The library does not decide where it sits in the layout.

**Accessibility is not an audit checklist.** Keyboard-only users and screen reader users are first-class users, not afterthoughts. The component is fully operable without a pointer device.

**Privacy is visible, not buried.** If the developer has configured a privacy notice, the user sees it before the microphone is ever activated. Disclosure is inline and unambiguous.

---

## 2. Complete User Flow

### 2.1 Happy Path — Every Step

```
1. Page loads
   - Mic button renders in idle state
   - Button reads "Use voice input" to screen readers
   - No mic permission request yet (permission is deferred until first tap)

2. User activates button (click, tap, or Space/Enter)
   - If privacyNotice is configured AND user has not yet acknowledged:
     - Privacy notice panel displays (see Section 12)
     - If requirePrivacyAcknowledgement is true: user must click "I understand"
       before proceeding; mic access is not requested until acknowledged
     - If requirePrivacyAcknowledgement is false: notice is shown but does not
       block; user may proceed immediately
   - Once privacy gate is cleared (or not configured):
     - Browser fires mic permission prompt (first use only)
     - If permission granted: state transitions to RECORDING
     - If permission denied: state transitions to ERROR (permission denied)

3. RECORDING state
   - Button pulses with recording animation
   - Waveform or pulse ring animates to indicate active listening
   - Status text reads "Listening…" beneath or beside the button
   - User speaks naturally: "My name is Jordan Lee, email is jordan@example.com,
     and I need priority support for order 88421"
   - Recording stops automatically on silence (configurable timeout) OR user
     presses the button again to stop manually

4. PROCESSING state
   - Button animation changes from pulse to spinner
   - Status text reads "Processing…"
   - Transcript is sent to developer's endpoint
   - LLM response is parsed against the provided schema

5. CONFIRMING state
   - Confirmation panel appears
   - Panel shows each field the LLM parsed, with the value it intends to fill
   - All field values are rendered with textContent, never innerHTML
   - If a value was modified by output sanitization (stripHtml removed HTML tags),
     a subtle warning icon appears beside that field value
   - Fields the LLM could not parse are shown as empty or flagged
   - User reviews values
   - User accepts (clicks "Fill form" or presses Enter)
     OR
     User rejects (clicks "Cancel" or presses Escape)
     OR (v2 only) User edits individual values inline before accepting

6. INJECTING state
   - On accept: brief transition state while developer's onFill callback is invoked
   - Values are written to form fields
   - This state is nearly instantaneous in practice but exists for async callbacks

7. DONE state
   - Success indicator appears on the button (checkmark, brief color change)
   - Filled fields receive a brief highlight animation
   - Status text reads "Form filled" for 2 seconds
   - State resets to IDLE after the success display period
   - After resetting to IDLE, the button enters a cooldown period (default 3s)
     during which it is visually dimmed and cannot be re-activated

8. User can activate voice input again after the cooldown period expires
```

### 2.2 User Cancels at Confirmation

```
5b. User presses Cancel or Escape in confirmation panel
    - Panel closes with a brief fade transition
    - State returns to IDLE
    - No values are written to the form
    - No error state — this is a normal exit
    - Status text does not appear; button returns to resting state silently
```

### 2.3 User Stops Recording Early

```
3b. User presses button again during RECORDING
    - Recording stops immediately
    - State transitions to PROCESSING
    - Remainder of flow is the same as happy path
    - If transcript is empty (nothing was captured), transitions to ERROR (no speech)
```

### 2.4 Automatic Stop on Silence

```
3c. Web Speech API detects end of speech (or silence timeout fires)
    - Recording stops automatically
    - Visual indicator on button changes from active pulse to spinner
    - State transitions to PROCESSING without user action
    - No notification to user — the transition is visible through the animation change
```

### 2.5 Privacy Acknowledgement Required

```
2b. User activates button; requirePrivacyAcknowledgement is true and user has
    not yet acknowledged
    - Privacy notice panel displays inline (see Section 12)
    - Mic is NOT activated; state does not leave idle
    - User must click "I understand" before the flow can proceed
    - After acknowledgement, the normal activation flow resumes from step 2
    - Acknowledgement is stored in the session so the notice does not re-appear
      on subsequent activations in the same page session
```

---

## 3. State Machine and Visual States

The component has six states. Each state has a defined visual appearance and set of permitted transitions.

| State | Visual on Button | Status Text | Panel | Permitted Transitions |
|---|---|---|---|---|
| `idle` | Mic icon, neutral color | None | Hidden | → `recording` |
| `recording` | Pulse ring animation, accent color | "Listening..." | Hidden | → `processing`, → `error` |
| `processing` | Spinner animation, muted color | "Processing..." | Hidden | → `confirming`, → `error` |
| `confirming` | Disabled appearance | None | Visible | → `injecting`, → `idle` |
| `injecting` | Disabled appearance | None | Fading out | → `done`, → `error` |
| `done` | Checkmark icon, success color | "Form filled" | Hidden | → `idle` (auto, 2s) |
| `error` | Warning icon, error color | Error message | Hidden | → `idle` (on retry or dismiss) |
| `cooldown` | Mic icon, dimmed/disabled appearance | None (or subtle timer indicator) | Hidden | → `idle` (auto, after cooldownMs) |

**Cooldown state detail:** After transitioning from `done` back to `idle`, the button enters a brief cooldown period (default `cooldownMs: 3000`). During cooldown the button is visually dimmed — identical to the disabled appearance — and does not respond to activation. A subtle animation (e.g., a draining arc around the button edge, or a simple opacity hold) communicates that the button is temporarily unavailable without producing an error. The cooldown state is not separately represented in the state machine; it is a guard on the `idle → recording` transition.

The same cooldown applies after an error dismissal to prevent rapid re-fire loops.

### State Transition Diagram

```
idle
 |
 | (user activates)
 v
recording ---------(silence / manual stop)---------> processing
    |                                                      |
    | (error: permission denied, hardware fail)            | (error: endpoint fail, parse fail)
    v                                                      |
  error <---------------------------------------------------
    |
    | (user dismisses / retries)
    v
  idle

processing -----> confirming
                      |
                      | (user accepts)
                      v
                   injecting -----> done -----(2s)-----> idle -----(cooldownMs)----> [ready]
                      |
                      | (error: inject callback throws)
                      v
                    error

confirming -----(user cancels)-----> idle
```

---

## 4. Microphone Button Design

### 4.1 Anatomy

The button is a single, self-contained interactive element. It contains:

- An icon area (mic icon, spinner, checkmark, or warning — one at a time)
- An optional visible label (configurable; off by default on small variants)
- A focus ring (always visible on keyboard focus)
- An animation layer (pulse ring in recording state; always behind the button shape)

The button does not contain a progress bar, transcript preview, or any secondary information. It is a trigger, not a display.

### 4.2 Sizes

| Size | Button diameter | Icon size | Touch target | When to use |
|---|---|---|---|---|
| `sm` | 32px | 16px | 48px (via padding) | Dense forms, inline with a field label |
| `md` (default) | 40px | 20px | 48px | Standard form placement |
| `lg` | 56px | 28px | 56px | Prominent standalone placement |

Touch targets always meet 48px minimum regardless of visual button size, achieved by invisible padding on the hit area.

### 4.3 State Appearances

**Idle**
- Background: `var(--vf-button-bg)` (default: neutral gray, e.g. `#f3f4f6`)
- Icon: microphone SVG, `var(--vf-button-icon-color)` (default: `#374151`)
- Border: `1px solid var(--vf-button-border)` (default: `#d1d5db`)
- No animation

**Recording**
- Background: `var(--vf-recording-bg)` (default: `#ef4444`, red-500)
- Icon: microphone SVG, white
- Pulse ring: concentric ring expands outward at 1.5s loop, opacity fades 1→0
  - Ring color: `var(--vf-recording-ring-color)` (default: `#ef4444` at 40% opacity)
  - `@media (prefers-reduced-motion: reduce)`: pulse ring is replaced by a static, slightly larger colored border. No animation.
- Border: none (color provides sufficient affordance)

**Processing**
- Background: `var(--vf-button-bg)` (returns to neutral)
- Icon: spinning circle (CSS animation, not an image)
  - Spin: 0.75s linear infinite rotation
  - `@media (prefers-reduced-motion: reduce)`: spinner becomes a static arc, no rotation; status text is the primary progress signal
- Border: `1px solid var(--vf-button-border)`

**Confirming / Injecting (disabled)**
- Background: `var(--vf-button-bg-disabled)` (default: `#f9fafb`)
- Icon: microphone, `var(--vf-button-icon-color-disabled)` (default: `#9ca3af`)
- Opacity: 0.6 on the icon only; border and background remain at full opacity
- `aria-disabled="true"` set; button does not respond to interaction

**Done**
- Background: `var(--vf-success-bg)` (default: `#22c55e`, green-500)
- Icon: checkmark SVG, white
- Transition in: 150ms ease-in from processing/injecting state
- Transition out: 200ms ease-out fade back to idle after 2 second hold
- `@media (prefers-reduced-motion: reduce)`: no transitions; state changes are instant

**Cooldown**
- Background: `var(--vf-button-bg-disabled)` (same as disabled)
- Icon: microphone, `var(--vf-button-icon-color-disabled)`
- Optional: a draining arc animation around the button perimeter indicating time remaining
- `aria-disabled="true"` set; button does not respond to interaction
- `@media (prefers-reduced-motion: reduce)`: no arc animation; button is simply dimmed for the duration

**Error**
- Background: `var(--vf-error-bg)` (default: `#fef2f2`)
- Icon: exclamation-circle SVG, `var(--vf-error-icon-color)` (default: `#dc2626`)
- Border: `1px solid var(--vf-error-border)` (default: `#fca5a5`)
- Error message appears in the status text area below the button (not a tooltip)

### 4.4 Icon Specifications

All icons are inline SVG, not an icon font or external resource. This ensures zero network requests and no dependency on icon libraries.

Icons used:
- Microphone: standard mic body with stand base, no fill, 2px stroke
- Spinner: arc (270-degree circle), 2px stroke, rotating
- Checkmark: single-path check, 2.5px stroke
- Warning: exclamation-circle, 2px stroke

The icon set is minimal and intentionally generic so it does not visually clash with the host application's design system.

---

## 5. Confirmation Panel Design

### 5.1 Purpose and Placement

The confirmation panel is a non-modal overlay that appears near the voice button. It is not a full-screen modal and does not block interaction with the rest of the page.

**Positioning is CSS-first.** The initial panel placement (above or below the button) is determined once at open time using a single batched read-then-write sequence. The panel does not reposition continuously; it is placed once when it opens and remains in that position. This avoids repeated forced layout calculations.

Placement logic:
- Default: opens upward (toward the top of the viewport) from the button
- If insufficient space above: opens downward
- Edge detection uses a single `getBoundingClientRect()` read, followed by a single CSS write — reads and writes are never interleaved
- On mobile (viewport width < 480px): expands as a bottom sheet anchored to the viewport bottom; no bounding rect calculation is needed for this path

**Deferred DOM construction.** The confirmation panel DOM is not built at `createVoiceForm()` initialization time. It is constructed the first time the component enters the `confirming` state (first use). This avoids adding DOM nodes to the page for components that may never reach confirmation.

The panel opens with a 150ms ease-out reveal (translate + opacity). Reduced motion: instant appear, no translation.

### 5.2 Panel Anatomy

```
+-----------------------------------------------+
|  What I heard                            [X]  |
|  ─────────────────────────────────────────── |
|  First name      Jordan                       |
|  Last name       Lee                          |
|  Email           jordan@example.com           |
|  Order number    88421                        |
|  Priority        [Not understood]             |
|  ─────────────────────────────────────────── |
|  [Cancel]                    [Fill form]      |
+-----------------------------------------------+
```

**Header row**
- Title: "What I heard" (overridable via `strings.confirmTitle`)
- Dismiss button [X] in top-right corner
  - Icon: close/X SVG, 16px
  - `aria-label="Cancel voice input"`
  - Keyboard: focusable, activated by Enter or Space

**Field rows**
- Left column: field label (from the developer's schema `label` or `name`)
- Right column: parsed value
- **Implementation constraint: all field values MUST be rendered using `textContent`, never `innerHTML`.** LLM output may contain angle brackets, HTML entities, or markup fragments. Rendering via `innerHTML` would execute injected markup. Every value in the confirmation panel — regardless of field type — is treated as plain text.
- If output sanitization (`stripHtml`) removed HTML tags from a value before it reached the confirmation panel, a subtle warning icon (⚠) appears to the right of the value in that field row. The icon carries `aria-label="Value was modified — HTML was removed"` and `title="HTML content was removed from this value"` so the indication is accessible. The icon uses `var(--vf-sanitized-warning-color)` (default: `#b45309`, amber-700).
- Field rows are not interactive in v1
- In v2: right column becomes an editable input on click or Enter

**Unrecognized fields**
- Value column shows a pill badge: "Not understood"
- Badge color: `var(--vf-unrecognized-badge-bg)` (default: `#fef3c7`, amber-50)
- Badge text color: `var(--vf-unrecognized-badge-text)` (default: `#92400e`, amber-800)
- These fields are not filled when the user accepts

**Footer row**
- Cancel button (left-aligned or left of Fill button)
  - Default label: "Cancel"
  - `aria-label="Cancel and discard voice input"`
  - Keyboard: Escape key also triggers cancel from anywhere within the panel
- Fill form button (right-aligned, primary visual weight)
  - Default label: "Fill form"
  - `aria-label="Accept and fill form with these values"`
  - Keyboard: Enter key when focused on this button, or when no other element has focus within the panel

### 5.3 Focus Management

When the confirmation panel opens:
1. Focus moves to the panel container (which has `role="dialog"`)
2. Initial focus lands on the "Fill form" button (the likely primary action)
3. Tab order within panel: [X dismiss] → [field rows — read only in v1] → [Cancel] → [Fill form] → wraps to [X dismiss]
4. Escape closes the panel from anywhere within it and returns focus to the mic button
5. When the panel closes (accept or cancel), focus returns to the mic button

### 5.4 v2 Field-Level Correction

In v2, each field row in the confirmation panel becomes editable:

- Clicking a field row (or pressing Enter on it) activates an inline text input
- The input replaces the static value text in the right column
- The field label moves to above the input on small screens
- Editing does not dismiss the panel; the user still presses "Fill form" to accept
- Tab moves between editable fields in document order
- If a field is edited and then cleared, the field is treated as "not understood" and will not be filled
- The "Fill form" button label changes to "Fill form (edited)" when any field has been manually changed, as a visual indicator that the user made corrections

---

## 6. Success State

### 6.1 Button Success Indicator

After injection, the button transitions to the done state:
- Checkmark icon replaces the mic icon
- Background changes to success green
- This state holds for 2 seconds, then fades back to idle
- The 2-second hold is not configurable in v1 (it is a UX decision, not a preference)

### 6.2 Field Highlight

Each form field that received a value from voice-form briefly highlights:
- A 300ms pulse of the field's border or background using `var(--vf-field-highlight-color)` (default: `#bbf7d0`, green-200)
- Implemented via a CSS class toggled by the core library: `vf-field-filled`
- The class is removed after 1.5 seconds
- `@media (prefers-reduced-motion: reduce)`: no pulse; the class still applies so developers can use it for non-animated visual feedback if desired
- Fields that were not filled (unrecognized values) do not receive this class

### 6.3 Screen Reader Announcement

An ARIA live region announces: "Form filled. [N] fields updated." where N is the count of fields that received values. This fires once, on the transition to done state.

---

## 7. Error States

### 7.1 Error Display Pattern

All errors follow the same display pattern:
- Button transitions to error visual state (warning icon, error tint)
- Status text area below the button shows a concise, human-readable message
- A retry affordance is available (either the button itself becomes re-activatable, or a small "Try again" text link appears beside the status text)
- Error state does not interrupt or modify any form fields

The user should never see a raw error object, stack trace, or API error message. All errors are caught and translated to the strings defined in section 11.

### 7.2 Error Types and Behaviors

**Mic permission denied**
- Trigger: browser permission prompt dismissed or blocked
- Message: "Microphone access denied. Check your browser settings."
- Behavior: button enters error state permanently until page reload; retry is not possible without user action in browser settings
- Additional affordance: a small "Learn how" text link (configurable URL via `strings.permissionHelpUrl`) that opens browser help in a new tab
- Screen reader announcement: "Error: Microphone access denied. Check your browser settings."

**Browser not supported**
- Trigger: Web Speech API not available (`!window.SpeechRecognition && !window.webkitSpeechRecognition`)
- Detected at initialization, not on activation
- Behavior: button renders in a permanently disabled state with a tooltip/status text: "Voice input not supported in this browser."
- This check happens on mount so the user sees the disabled state before interacting
- The form remains fully functional; only voice input is unavailable

**No speech detected**
- Trigger: recording session ended with no transcript (silence timeout fired, or user stopped recording immediately)
- Message: "Nothing heard. Try again."
- Behavior: error state clears after 3 seconds and returns to idle automatically; no user action required
- Screen reader announcement: "Nothing heard. Voice input ready."

**Endpoint error (network or HTTP error)**
- Trigger: fetch to developer's BYOE endpoint failed (network error, non-2xx response)
- Message: "Could not process speech. Try again."
- Behavior: button enters error state; "Try again" affordance is visible; clicking it returns to idle without re-sending
- Screen reader announcement: "Error: Could not process speech. Tap to try again."

**LLM parse failed (malformed or empty response)**
- Trigger: endpoint returned 2xx but the response body did not match the expected schema contract
- Message: "Could not understand your response. Try again."
- Behavior: same as endpoint error

**Privacy not acknowledged**
- Trigger: `requirePrivacyAcknowledgement` is `true` and the user clicks the mic button without having acknowledged the privacy notice
- Behavior: the privacy notice panel displays (see Section 12); the button does not enter an error state and no error message is shown. This is not an error — it is an expected gate. The button remains in idle state while the notice is visible.

**Transcript too long**
- Trigger: the captured transcript exceeds the configured `maxTranscriptLength` limit
- Message: "That was too much — try a shorter response."
- Behavior: recording stops; state transitions to error; a "Re-record" affordance is shown alongside "Try again" so the user understands they should speak again rather than retry the same input
- Screen reader announcement: "That was too much. Try a shorter response."

**Partial parse (v2)**
- Trigger: some fields were parsed, some were not. This is NOT an error in v2 — it is a valid state.
- Behavior: confirmation panel opens normally; unrecognized fields are shown with the "Not understood" badge
- No error indicator on the button; the user resolves this in the confirmation step

### 7.3 Error State Reset

From any error state, the user can return to idle by:
- Pressing the mic button again (re-activates from idle)
- For permanent errors (permission denied, browser unsupported): the button remains disabled; the only path forward is outside the component

---

## 8. Accessibility

### 8.1 ARIA Roles and Labels

**Mic button**
```html
<button
  type="button"
  aria-label="Use voice input"         <!-- idle -->
  aria-label="Stop recording"          <!-- recording -->
  aria-label="Processing speech"       <!-- processing; aria-disabled="true" -->
  aria-label="Voice input ready"       <!-- done, before auto-reset -->
  aria-label="Voice input error"       <!-- error -->
  aria-pressed="true"                  <!-- when in recording state -->
  aria-disabled="true"                 <!-- when in processing/confirming/injecting/cooldown -->
  aria-describedby="vf-status-[id]"    <!-- points to status text element -->
/>
```

`aria-label` is dynamically updated on every state transition. The label values use the same string keys as the microcopy system and are therefore i18n-overridable.

**Status text element**
```html
<span
  id="vf-status-[id]"
  aria-live="polite"
  aria-atomic="true"
  role="status"
>
  <!-- Content updated programmatically on state changes -->
</span>
```

This element is always present in the DOM but is visually hidden when empty. It is never `display: none` because that removes it from the accessibility tree. Use the `.vf-sr-only` utility class (position absolute, 1px clip).

**Confirmation panel**
```html
<div
  role="dialog"
  aria-modal="false"               <!-- Not a modal; page remains interactive -->
  aria-label="Confirm voice input"
  aria-describedby="vf-confirm-desc-[id]"
>
  <p id="vf-confirm-desc-[id]">
    Review the values below before filling your form.
  </p>
  <!-- field rows -->
  <!-- footer with Cancel and Fill form buttons -->
</div>
```

**Field rows in confirmation panel (v1 — read only)**
```html
<dl>
  <div class="vf-field-row">
    <dt>First name</dt>
    <dd>Jordan</dd>
    <!-- dd content is set via textContent, never innerHTML -->
  </div>
  <!-- ... -->
</dl>
```

**Field rows in confirmation panel (v2 — editable)**
```html
<div class="vf-field-row">
  <label for="vf-edit-firstname-[id]">First name</label>
  <input
    id="vf-edit-firstname-[id]"
    type="text"
    value="Jordan"
    aria-label="First name — edit value"
  />
</div>
```

**Unrecognized field badge**
```html
<dd>
  <span
    class="vf-unrecognized-badge"
    aria-label="Not understood — this field will not be filled"
  >
    Not understood
  </span>
</dd>
```

**Sanitization warning icon**
```html
<dd>
  <span class="vf-field-value">Jordan &lt;b&gt;Lee&lt;/b&gt;</span>
  <span
    class="vf-sanitized-warning"
    aria-label="Value was modified — HTML was removed"
    title="HTML content was removed from this value"
    role="img"
  >⚠</span>
</dd>
```

**Privacy notice panel**
```html
<div
  role="region"
  aria-label="Voice input privacy notice"
  aria-live="polite"
  class="vf-privacy-notice"
>
  <p id="vf-privacy-desc-[id]"><!-- privacyNotice text --></p>
  <button type="button" class="vf-privacy-acknowledge">
    I understand
  </button>
</div>
```

### 8.2 Keyboard Navigation Flow

**Global keyboard interactions**

| Key | Context | Action |
|---|---|---|
| Space or Enter | Mic button focused, idle | Start recording (or show privacy notice if required) |
| Space or Enter | Mic button focused, recording | Stop recording |
| Escape | Anywhere on page while confirmation panel is open | Close panel, return to idle |
| Escape | Privacy notice visible | Dismiss notice (only if requirePrivacyAcknowledgement is false) |
| Tab | Confirmation panel open | Cycle focus within panel |
| Shift+Tab | Confirmation panel open | Reverse cycle focus within panel |
| Enter | "Fill form" button focused | Accept and inject |
| Enter | "Cancel" button focused | Cancel and close |
| Space or Enter | [X] dismiss button focused | Close panel, return to idle |
| Tab | Privacy notice visible | Move to "I understand" button |
| Space or Enter | "I understand" button focused | Acknowledge and proceed |

**Tab order within the confirmation panel**
1. [X] dismiss button
2. [Editable fields in schema order, v2 only]
3. [Cancel] button
4. [Fill form] button
5. Wraps to [X] dismiss

Focus does not leave the panel while it is open (focus trap via JavaScript). Focus returns to the mic button on close.

### 8.3 Screen Reader Announcements

All state-change announcements go through the `aria-live="polite"` status element. Announcements are:

| State change | Announcement |
|---|---|
| idle → recording | "Listening. Speak now." |
| recording → processing | "Processing your speech." |
| processing → confirming | "Review your values. [N] fields ready." |
| confirming → done | "Form filled. [N] fields updated." |
| confirming → idle (cancel) | "Voice input cancelled." |
| any → error (permission) | "Error: Microphone access denied. Check your browser settings." |
| any → error (no speech) | "Nothing heard. Voice input ready." |
| any → error (endpoint) | "Error: Could not process speech. Tap to try again." |
| any → error (transcript too long) | "That was too much. Try a shorter response." |
| done → idle (auto-reset) | (no announcement — transition is silent) |
| privacy notice shown | "Voice input privacy notice. [notice text]." |

Announcements use `aria-live="polite"` rather than `assertive` to avoid interrupting ongoing screen reader output. The exception is a permission denied error, which uses `aria-live="assertive"` because it requires immediate user action.

### 8.4 Reduced Motion

All animations in voice-form are driven by CSS. The `@media (prefers-reduced-motion: reduce)` query is applied at the component level and affects:

| Animation | Default behavior | Reduced motion behavior |
|---|---|---|
| Recording pulse ring | Expanding ring, opacity loop | Static border ring, no movement |
| Processing spinner | Continuous rotation | Static partial arc (no rotation) |
| Panel open/close | Translate + opacity transition | Instant show/hide, no transition |
| Done state transition | 150ms fade in, 200ms fade out | Instant color change, no fade |
| Field highlight on fill | 300ms pulse | No animation; `.vf-field-filled` class still applied |
| Cooldown arc animation | Draining arc around button | No arc; button is simply dimmed |

The state machine behavior is identical under reduced motion. Only visual animation is suppressed.

### 8.5 Color Contrast

All color values in the default theme meet WCAG 2.1 AA contrast requirements:

| Element | Foreground | Background | Ratio | Requirement |
|---|---|---|---|---|
| Button icon (idle) | `#374151` | `#f3f4f6` | 7.2:1 | AA (4.5:1 min) |
| Button icon (recording) | `#ffffff` | `#ef4444` | 3.5:1 | AA Large (3:1) — icon is 20px+ |
| Status text | `#374151` | host page background | developer responsibility | — |
| Panel header text | `#111827` | `#ffffff` | 16:1 | AA |
| Panel field label | `#374151` | `#ffffff` | 7.2:1 | AA |
| Panel field value | `#111827` | `#ffffff` | 16:1 | AA |
| Unrecognized badge text | `#92400e` | `#fef3c7` | 4.7:1 | AA |
| Cancel button text | `#374151` | `#f3f4f6` | 7.2:1 | AA |
| Fill form button text | `#ffffff` | `#2563eb` | 5.1:1 | AA |
| Error message text | `#991b1b` | host page background | developer responsibility | — |
| Sanitization warning icon | `#b45309` | `#ffffff` (panel) | 4.8:1 | AA |
| Privacy notice text | `#111827` | `#f9fafb` | 14.7:1 | AA |

Developers who override CSS custom properties are responsible for maintaining contrast ratios. The documentation will note this requirement alongside each overridable property.

---

## 9. Theming and CSS Custom Properties

### 9.1 Philosophy

voice-form ships a minimal, neutral default theme that does not try to look like any particular design system. It uses muted grays, a single blue accent, and standard red/green for error/success. It should look "fine" in any app without configuration, and easy to restyle with a handful of custom properties.

The library does not ship multiple named themes. It ships one default theme and a complete set of override points.

### 9.2 Complete Custom Property Reference

Custom properties are set on the component's root element. All properties include the `--vf-` namespace prefix to avoid collisions.

**Button — structural**

| Property | Default | Description |
|---|---|---|
| `--vf-button-size` | `40px` | Width and height of the button |
| `--vf-button-radius` | `50%` | Border radius (50% = circle, 8px = rounded square) |
| `--vf-button-font-size` | `14px` | Label font size (if label is visible) |
| `--vf-button-font-family` | `inherit` | Label font family |

**Button — idle state**

| Property | Default | Description |
|---|---|---|
| `--vf-button-bg` | `#f3f4f6` | Button background |
| `--vf-button-border` | `#d1d5db` | Button border color |
| `--vf-button-icon-color` | `#374151` | Icon fill/stroke color |
| `--vf-button-hover-bg` | `#e5e7eb` | Background on hover |
| `--vf-button-hover-border` | `#9ca3af` | Border on hover |
| `--vf-button-focus-ring` | `#3b82f6` | Focus ring color (3px outline) |

**Button — recording state**

| Property | Default | Description |
|---|---|---|
| `--vf-recording-bg` | `#ef4444` | Background during recording |
| `--vf-recording-icon-color` | `#ffffff` | Icon color during recording |
| `--vf-recording-ring-color` | `rgba(239,68,68,0.4)` | Pulse ring color |
| `--vf-recording-ring-size` | `1.6` | Ring expansion scale at peak |

**Button — processing state**

| Property | Default | Description |
|---|---|---|
| `--vf-processing-spinner-color` | `#6b7280` | Spinner stroke color |

**Button — success state**

| Property | Default | Description |
|---|---|---|
| `--vf-success-bg` | `#22c55e` | Background in done state |
| `--vf-success-icon-color` | `#ffffff` | Checkmark color |
| `--vf-field-highlight-color` | `#bbf7d0` | Field flash color on fill |

**Button — error state**

| Property | Default | Description |
|---|---|---|
| `--vf-error-bg` | `#fef2f2` | Button background in error state |
| `--vf-error-icon-color` | `#dc2626` | Warning icon color |
| `--vf-error-border` | `#fca5a5` | Button border in error state |
| `--vf-error-text-color` | `#991b1b` | Status text color for error messages |

**Button — disabled / cooldown state**

| Property | Default | Description |
|---|---|---|
| `--vf-button-bg-disabled` | `#f9fafb` | Background when disabled or in cooldown |
| `--vf-button-icon-color-disabled` | `#9ca3af` | Icon color when disabled or in cooldown |

**Confirmation panel**

| Property | Default | Description |
|---|---|---|
| `--vf-panel-bg` | `#ffffff` | Panel background |
| `--vf-panel-border` | `#e5e7eb` | Panel border color |
| `--vf-panel-radius` | `8px` | Panel corner radius |
| `--vf-panel-shadow` | `0 4px 16px rgba(0,0,0,0.10)` | Panel drop shadow |
| `--vf-panel-padding` | `16px` | Panel inner padding |
| `--vf-panel-min-width` | `280px` | Panel minimum width |
| `--vf-panel-max-width` | `420px` | Panel maximum width |
| `--vf-panel-header-color` | `#111827` | Header text color |
| `--vf-panel-label-color` | `#374151` | Field label text color |
| `--vf-panel-value-color` | `#111827` | Field value text color |
| `--vf-panel-divider-color` | `#f3f4f6` | Divider line color |
| `--vf-unrecognized-badge-bg` | `#fef3c7` | "Not understood" badge background |
| `--vf-unrecognized-badge-text` | `#92400e` | "Not understood" badge text |
| `--vf-sanitized-warning-color` | `#b45309` | Sanitization warning icon color |
| `--vf-cancel-btn-bg` | `#f3f4f6` | Cancel button background |
| `--vf-cancel-btn-text` | `#374151` | Cancel button text |
| `--vf-fill-btn-bg` | `#2563eb` | Fill form button background |
| `--vf-fill-btn-text` | `#ffffff` | Fill form button text |
| `--vf-fill-btn-hover-bg` | `#1d4ed8` | Fill form button hover background |

**Privacy notice**

| Property | Default | Description |
|---|---|---|
| `--vf-privacy-bg` | `#f9fafb` | Privacy notice background |
| `--vf-privacy-border` | `#e5e7eb` | Privacy notice border color |
| `--vf-privacy-text-color` | `#111827` | Privacy notice body text color |
| `--vf-privacy-radius` | `6px` | Privacy notice corner radius |

### 9.3 Dark Mode

voice-form does not auto-detect dark mode or automatically switch themes. Dark mode support is provided through documented custom property overrides that developers apply using their own `prefers-color-scheme` media query or their app's theme mechanism.

Rationale: the component lives inside the developer's app. The developer controls the theme toggle. voice-form should respond to the developer's theme system, not implement its own.

The documentation provides a ready-to-copy dark mode override block:

```css
@media (prefers-color-scheme: dark) {
  voice-form-component,
  .vf-root {
    --vf-button-bg: #1f2937;
    --vf-button-border: #374151;
    --vf-button-icon-color: #d1d5db;
    --vf-button-hover-bg: #374151;
    --vf-panel-bg: #1f2937;
    --vf-panel-border: #374151;
    --vf-panel-header-color: #f9fafb;
    --vf-panel-label-color: #d1d5db;
    --vf-panel-value-color: #f9fafb;
    --vf-panel-divider-color: #374151;
    --vf-cancel-btn-bg: #374151;
    --vf-cancel-btn-text: #f9fafb;
    --vf-privacy-bg: #1f2937;
    --vf-privacy-border: #374151;
    --vf-privacy-text-color: #f9fafb;
    /* recording, success, error colors remain the same in dark mode */
  }
}
```

### 9.4 Headless Mode

Headless mode removes all default UI rendering. The developer receives the state machine and callbacks and builds their own UI entirely.

Headless mode is activated by the `headless` prop/option on the component. When headless is `true`:
- No HTML is rendered by voice-form
- The developer provides their own trigger element via a ref or slot
- The library exposes a `bind` function (or `useVoiceForm` hook in React) that the developer attaches to their element
- The state machine, all callbacks, and all events still function normally
- None of the CSS custom properties apply (there is no default DOM to style)

The developer is responsible for:
- Rendering a button and attaching voice-form's start/stop handlers
- Rendering a confirmation UI and rendering the parsed field values
- Implementing their own ARIA attributes (a headless usage guide will document requirements)
- Rendering any privacy notice if `privacyNotice` is configured

Headless mode is the escape hatch for teams with an established design system who cannot or will not use the default UI.

---

## 10. Responsive Behavior

### 10.1 Button Responsiveness

The button is a fixed-size element. It does not resize with the viewport. The developer controls its placement and any responsive layout concerns via their own CSS. The button will not overflow its container.

On pointer devices: hover states are active.
On touch devices: hover states are suppressed; active/pressed state provides tactile feedback via CSS `active` pseudo-class (slight scale-down: `transform: scale(0.94)`).

### 10.2 Confirmation Panel on Desktop (viewport >= 480px)

- Panel floats above (or below) the button with an 8px gap
- Panel width is clamped between `--vf-panel-min-width` (280px) and `--vf-panel-max-width` (420px)
- Panel is positioned using `position: absolute` on a wrapper element; the wrapper must be `position: relative`
- Edge detection (for horizontal overflow) uses a single batched read-then-write: read `button.getBoundingClientRect()` and `window.innerWidth`, compute the clamped left offset, then write `panel.style.left` — no reads after writes
- Panel position is calculated once when it opens; it does not reposition on scroll or resize while open
- Panel does not scroll; if field count exceeds the visible area, the panel body becomes scrollable with `overflow-y: auto` and a max height of 60vh

### 10.3 Confirmation Panel on Mobile (viewport < 480px)

On mobile, the confirmation panel becomes a bottom sheet:
- Expands from the bottom of the viewport with a 16px radius on the top corners
- Full viewport width, with 16px horizontal padding
- Maximum height: 80vh; scrollable if content exceeds
- Backdrop: semi-transparent dark overlay (`rgba(0,0,0,0.4)`) behind the sheet
- Dismiss by: Cancel button, [X] button, swipe down (if CSS scroll-snap behavior is implemented — v2), or tap on backdrop
- The floating-panel positioning logic is bypassed entirely below 480px; no `getBoundingClientRect()` call is needed

Bottom sheet animations:
- Open: slides up from bottom over 200ms ease-out
- Close: slides down over 150ms ease-in
- `@media (prefers-reduced-motion: reduce)`: instant appear/dismiss, no slide

### 10.4 Touch Targets

All interactive elements meet the 48px minimum touch target size:

| Element | Visual size | Touch target |
|---|---|---|
| Mic button (sm) | 32px | 48px via padding |
| Mic button (md) | 40px | 48px via padding |
| Mic button (lg) | 56px | 56px (natural) |
| [X] dismiss button | 24px icon | 44px via padding (iOS allows 44px) |
| Cancel button | text button | min 44px height, 12px horizontal padding |
| Fill form button | text button | min 44px height, 16px horizontal padding |
| "I understand" button | text button | min 44px height, 16px horizontal padding |

### 10.5 Mobile Mic Permission Flow

On mobile browsers, the mic permission prompt is a system-level UI (not styleable). The UX differences to account for:

- iOS Safari: permission prompt is shown once per origin; after denial, the user must go to Settings > Safari > website settings to re-enable. The "Learn how" link in the permission-denied error state should point to `strings.permissionHelpUrl` which defaults to `null` (not shown) and should be set by the developer to a relevant help article.
- Android Chrome: permission can be re-requested; the component can show a re-request affordance after denial (implementation TBD based on browser detection reliability)
- iOS PWA (standalone): mic access must be explicitly allowed in iOS settings; the error state should acknowledge this with a specific message variant (v2 consideration)

The library does not attempt browser or OS detection for mic permission flows. The developer sets the appropriate `strings.permissionHelpUrl` for their deployment context.

---

## 11. Microcopy and i18n

### 11.1 All User-Facing Strings

Every string rendered by voice-form is listed below with its key, default English value, and usage context. No string is hardcoded; all are sourced from the strings object.

**Button labels (aria-label, used by screen readers and as visible label when configured)**

| Key | Default | Context |
|---|---|---|
| `strings.buttonLabel.idle` | `"Use voice input"` | Button aria-label in idle state |
| `strings.buttonLabel.recording` | `"Stop recording"` | Button aria-label during recording |
| `strings.buttonLabel.processing` | `"Processing speech"` | Button aria-label during processing |
| `strings.buttonLabel.done` | `"Voice input complete"` | Button aria-label in done state |
| `strings.buttonLabel.error` | `"Voice input error"` | Button aria-label in error state |
| `strings.buttonLabel.unsupported` | `"Voice input not available"` | Button aria-label when browser unsupported |
| `strings.buttonLabel.cooldown` | `"Voice input cooling down"` | Button aria-label during cooldown |

**Status text (visible beneath button)**

| Key | Default | Context |
|---|---|---|
| `strings.status.listening` | `"Listening…"` | Visible during recording state |
| `strings.status.processing` | `"Processing…"` | Visible during processing state |
| `strings.status.done` | `"Form filled"` | Visible briefly in done state |
| `strings.status.unsupported` | `"Voice input not supported in this browser."` | Permanent message when browser unsupported |

**Error messages (visible beneath button)**

| Key | Default | Context |
|---|---|---|
| `strings.errors.permissionDenied` | `"Microphone access denied. Check your browser settings."` | After mic permission denied |
| `strings.errors.noSpeech` | `"Nothing heard. Try again."` | After silence timeout with no transcript |
| `strings.errors.endpointError` | `"Could not process speech. Try again."` | After endpoint network/HTTP error |
| `strings.errors.parseError` | `"Could not understand your response. Try again."` | After malformed LLM response |
| `strings.errors.transcriptTooLong` | `"That was too much — try a shorter response."` | After transcript length exceeded |
| `strings.errors.retryLabel` | `"Try again"` | Retry affordance link text |
| `strings.errors.rerecordLabel` | `"Re-record"` | Re-record affordance for transcript-too-long error |
| `strings.errors.permissionHelp` | `"Learn how"` | Help link text for permission denied |

**Confirmation panel**

| Key | Default | Context |
|---|---|---|
| `strings.confirm.title` | `"What I heard"` | Panel header text |
| `strings.confirm.description` | `"Review the values below before filling your form."` | Panel description (sr-only) |
| `strings.confirm.cancelLabel` | `"Cancel"` | Cancel button text |
| `strings.confirm.cancelAriaLabel` | `"Cancel and discard voice input"` | Cancel button aria-label |
| `strings.confirm.fillLabel` | `"Fill form"` | Fill button text |
| `strings.confirm.fillLabelEdited` | `"Fill form (edited)"` | Fill button text when v2 fields were manually corrected |
| `strings.confirm.fillAriaLabel` | `"Accept and fill form with these values"` | Fill button aria-label |
| `strings.confirm.dismissAriaLabel` | `"Cancel voice input"` | [X] dismiss button aria-label |
| `strings.confirm.unrecognizedLabel` | `"Not understood"` | Badge text for unrecognized fields |
| `strings.confirm.unrecognizedAriaLabel` | `"Not understood — this field will not be filled"` | Badge aria-label |
| `strings.confirm.sanitizedAriaLabel` | `"Value was modified — HTML was removed"` | Sanitization warning icon aria-label |

**Privacy notice**

| Key | Default | Context |
|---|---|---|
| `strings.privacy.acknowledgeLabel` | `"I understand"` | Acknowledge button text |
| `strings.privacy.acknowledgeAriaLabel` | `"I understand and agree to voice processing"` | Acknowledge button aria-label |
| `strings.privacy.regionAriaLabel` | `"Voice input privacy notice"` | Notice region aria-label |

**Screen reader live announcements**

| Key | Default | Context |
|---|---|---|
| `strings.announcements.listening` | `"Listening. Speak now."` | On transition to recording |
| `strings.announcements.processing` | `"Processing your speech."` | On transition to processing |
| `strings.announcements.confirming` | `"Review your values. {count} fields ready."` | On confirmation panel open |
| `strings.announcements.filled` | `"Form filled. {count} fields updated."` | On successful injection |
| `strings.announcements.cancelled` | `"Voice input cancelled."` | On confirmation cancel |
| `strings.announcements.errorPermission` | `"Error: Microphone access denied. Check your browser settings."` | Permission denied |
| `strings.announcements.errorNoSpeech` | `"Nothing heard. Voice input ready."` | No speech detected |
| `strings.announcements.errorEndpoint` | `"Error: Could not process speech. Tap to try again."` | Endpoint error |
| `strings.announcements.errorTranscriptTooLong` | `"That was too much. Try a shorter response."` | Transcript too long |

`{count}` in announcement strings is a simple template placeholder replaced at runtime with a numeric value.

### 11.2 i18n Override Pattern

Strings are overridable at the component level. The developer passes a partial `strings` object; voice-form deep-merges it with the defaults. Any key not provided falls back to the default English value.

```typescript
// Svelte usage
<VoiceForm
  strings={{
    status: { listening: "Ascoltando…", processing: "Elaborazione…" },
    confirm: { fillLabel: "Compila il modulo", cancelLabel: "Annulla" }
  }}
/>
```

The library does not ship translations for any language. It ships the override mechanism. Translations are the developer's responsibility.

The `strings` object structure is fully typed via TypeScript so developers get autocompletion and type errors for incorrect key paths.

### 11.3 Pluralization

The `{count}` placeholder in announcement strings does not handle pluralization in v1. The default strings use "fields" unconditionally. Developers who need correct pluralization can override the announcement strings with a function:

```typescript
strings={{
  announcements: {
    filled: (count) => count === 1
      ? "Form filled. 1 field updated."
      : `Form filled. ${count} fields updated.`
  }
}}
```

String values accept either a plain string or a function that receives the count and returns a string. This is typed in the `VoiceFormStrings` interface.

---

## 12. Privacy Notice Flow

### 12.1 Purpose

Voice input captures audio from the user's microphone and may route it through third-party infrastructure. When the Web Speech API is used, audio is processed by Google's speech-to-text service. When the Whisper adapter is used, audio is transmitted to OpenAI's API via the developer's server endpoint. Users deserve to know this before speaking.

The privacy notice flow allows developers to surface a disclosure at the point of interaction — immediately before the microphone is activated — rather than burying it in a general privacy policy.

### 12.2 Configuration

Developers configure the privacy notice via `VoiceFormConfig`:

```typescript
{
  privacyNotice: "Voice is processed by Google Speech-to-Text. No audio is stored.",
  requirePrivacyAcknowledgement: true   // default: false
}
```

If `privacyNotice` is not set, no notice is shown and the mic activates normally.

### 12.3 Notice Panel Design

The privacy notice renders as an inline panel near the mic button — not as a modal or a separate page. It sits between the button and the form content.

**Placement:**
- Appears directly below the mic button with an 8px gap
- Width matches the confirmation panel's min/max width constraints
- Does not overlap form fields if possible; if the button is near the bottom of the viewport, the panel opens upward

**Styling:**
- Background: `var(--vf-privacy-bg)` (default: `#f9fafb`, a very light gray — distinct from the white confirmation panel)
- Border: `1px solid var(--vf-privacy-border)` (default: `#e5e7eb`)
- Corner radius: `var(--vf-privacy-radius)` (default: `6px`)
- Text: small, readable body text; `var(--vf-privacy-text-color)` (default: `#111827`)
- The panel is intentionally understated — it should read as informational, not alarming

**Content:**
- The `privacyNotice` string (developer-supplied) is displayed as the body copy
- Below the body copy, the "I understand" button (when `requirePrivacyAcknowledgement` is true) or a small dismiss [X] (when `requirePrivacyAcknowledgement` is false)
- When `requirePrivacyAcknowledgement` is false, a "Continue" or "Dismiss" affordance is still shown so the user knows the notice has been seen; the mic activates immediately on button press regardless

**Recommended microcopy for STT data flow disclosure:**

Developers should communicate where audio goes. Suggested strings by STT provider:

- Web Speech API: `"Voice is processed by Google Speech-to-Text. Audio is not stored by this app."`
- Whisper (via developer endpoint): `"Voice is processed by OpenAI Whisper via our server. Audio is not stored after transcription."`
- Custom STT: `"Voice is processed by [Provider]. [Retention policy]."`

The library does not generate this text automatically; it is always developer-supplied so that it accurately reflects the developer's actual data flow and retention policy.

### 12.4 Acknowledge Behavior

When `requirePrivacyAcknowledgement` is `true`:
- Clicking the mic button shows the privacy notice instead of starting recording
- The mic is not activated; the state remains `idle`
- Focus moves to the "I understand" button within the notice
- Pressing "I understand" (or Space/Enter on it) dismisses the notice and immediately triggers the normal activation flow (mic permission prompt if needed, then recording)
- Acknowledgement is stored in a session-scoped variable (not `localStorage` or cookies — not persisted across page loads). On subsequent activations within the same page session, the notice is not shown again.
- If the developer wants persistent acknowledgement across sessions, they must implement that logic in their own code and pass `privacyNotice: undefined` once acknowledged

When `requirePrivacyAcknowledgement` is `false`:
- The notice is shown on first activation but does not block mic access
- The mic activates normally regardless of whether the user dismisses the notice
- The notice auto-dismisses when the component transitions out of `idle` (i.e., when recording starts)

### 12.5 ARIA and Keyboard

The privacy notice panel uses `role="region"` with `aria-label="Voice input privacy notice"`. It is not a dialog and does not trap focus. The "I understand" button is a standard `<button>` and participates in the normal tab order.

When the notice appears:
- An `aria-live="polite"` announcement fires: "Voice input privacy notice. [notice text]."
- Focus does NOT automatically move to the notice (to avoid disrupting users who are navigating the form)
- Users who tab to the mic button and activate it will encounter the notice inline

---

*End of UX Specification*
