/**
 * @voiceform/core — Complete public type system
 *
 * All types exported from this module are part of the public API surface.
 * Breaking changes to any type require a semver major bump.
 *
 * Canonical spec: docs/LOW_LEVEL_DESIGN.md § 2. Type Definitions
 */

// ─── Field Schema ─────────────────────────────────────────────────────────────

/**
 * The data type a field holds. Drives both prompt construction and the
 * validation applied to the LLM's response before injection.
 */
export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'textarea'

/**
 * Validation constraints for a field. Applied after LLM parsing,
 * before injection. A failed constraint adds the field to
 * ConfirmationData.invalidFields but does not block injection —
 * the user can still confirm with the warning visible.
 */
export interface FieldValidation {
  /** Minimum character length for text fields. */
  minLength?: number
  /** Maximum character length for text fields. */
  maxLength?: number
  /** Minimum value for number fields. */
  min?: number
  /** Maximum value for number fields. */
  max?: number
  /**
   * Regex pattern the value must match. Provided as a string so it can
   * be serialized safely. Applied as `new RegExp(pattern).test(value)`.
   */
  pattern?: string
}

/**
 * A single form field the developer wants voice-form to fill.
 * The `name` must match the DOM element's `name` attribute, `id`,
 * or `data-voiceform` attribute (checked in that order at injection time).
 */
export interface FieldSchema {
  /**
   * Unique identifier for the field within the form. Used as the key in
   * ParseResponse.fields and to locate the DOM element at injection time.
   * Must be a non-empty string with no whitespace.
   */
  name: string

  /**
   * Human-readable label sent to the LLM. Defaults to `name` if omitted.
   */
  label?: string

  /** The input type. Drives prompt hints and post-parse validation. */
  type: FieldType

  /**
   * For `select` and `radio` types: the exhaustive list of valid values.
   * The LLM will be instructed to return one of these exactly.
   * Required when type is `select` or `radio` — validated at init time.
   */
  options?: readonly string[]

  /**
   * Plain-language description of what this field is for.
   * Included verbatim in the LLM prompt. High-value for ambiguous fields.
   *
   * NOTE: This value is sent to the developer's BYOE endpoint in the
   * ParseRequest body and is visible to end users in the browser Network tab.
   * Do not include internal or operational metadata here.
   */
  description?: string

  /**
   * Whether the field is required. If true and the LLM cannot extract
   * a value, the confirmation step will surface a warning rather than
   * silently leaving the field empty.
   */
  required?: boolean

  /**
   * Validation constraints applied after LLM parsing, before injection.
   */
  validation?: FieldValidation
}

// ─── Form Schema ──────────────────────────────────────────────────────────────

/**
 * The complete schema for a form. Passed to `createVoiceForm` once at
 * initialization. The developer owns this; voice-form never infers it.
 */
export interface FormSchema {
  /**
   * Optional human-readable name for the form. Used in the LLM system
   * prompt to give the model context about the domain.
   * Example: "Medical Intake Form", "Shipping Address"
   */
  formName?: string

  /**
   * Optional description of the form's purpose. Included in the LLM
   * system prompt.
   */
  formDescription?: string

  /**
   * The fields that voice-form is allowed to fill. Order matters for
   * prompt construction. Must contain at least one entry.
   */
  fields: readonly FieldSchema[]
}

// ─── STT Adapter ─────────────────────────────────────────────────────────────

/**
 * The set of error codes an STT adapter may emit.
 */
export type STTErrorCode =
  | 'NOT_SUPPORTED' // Browser does not support Web Speech API
  | 'PERMISSION_DENIED' // User denied microphone access
  | 'NETWORK_ERROR' // Network error during streaming STT
  | 'NO_SPEECH' // Timeout — no speech detected
  | 'AUDIO_CAPTURE_FAILED' // Microphone hardware error
  | 'ABORTED' // Deliberately aborted (internal use)
  | 'UNKNOWN'

/**
 * An error emitted by an STT adapter. Extends `Error` for stack-trace support.
 * The `code` discriminant lets the state machine map STT failures to
 * appropriate VoiceFormErrorCodes.
 */
export interface STTError extends Error {
  /** Machine-readable error classification. */
  readonly code: STTErrorCode
  /** The original error that caused this failure, if any. */
  readonly originalError?: unknown
}

/**
 * Lifecycle events emitted by an STT adapter during a recording session.
 * The core state machine subscribes to these events to drive transitions.
 */
export interface STTAdapterEvents {
  /** Called with each interim (non-final) transcript as the user speaks. */
  onInterim: (transcript: string) => void
  /** Called once when the adapter produces a final transcript. */
  onFinal: (transcript: string) => void
  /** Called if the STT adapter encounters an error. */
  onError: (error: STTError) => void
  /** Called when the adapter stops listening for any reason. */
  onEnd: () => void
}

/**
 * The interface every STT adapter must implement.
 * The Web Speech adapter is the built-in default. Developers can provide
 * an alternative (e.g., Whisper via server) by implementing this interface.
 */
export interface STTAdapter {
  /**
   * Returns true if this adapter can operate in the current environment.
   * Called before `start` to enable graceful fallback messaging.
   */
  isSupported(): boolean

  /**
   * Begin listening. The adapter must call the provided event handlers
   * as audio is processed. Resolves immediately after the recognition
   * session has started — it does not wait for speech.
   *
   * @throws {STTError} if the adapter fails to start (e.g., mic permission denied).
   */
  start(events: STTAdapterEvents): Promise<void>

  /**
   * Stop listening gracefully. The adapter must call `events.onFinal` with
   * whatever transcript has been collected, then call `events.onEnd`.
   * If nothing was heard, `onFinal` is called with an empty string.
   */
  stop(): void

  /**
   * Cancel the recording session immediately without producing a transcript.
   * Must call `events.onEnd`. Must NOT call `events.onFinal`.
   */
  abort(): void
}

// ─── BYOE Contract ────────────────────────────────────────────────────────────

/**
 * A single parsed field value returned by the developer's LLM endpoint.
 * `confidence` is optional — if provided, voice-form surfaces it in the
 * confirmation overlay. Range: 0–1.
 */
export interface ParsedFieldValue {
  /** The value the LLM extracted for this field. */
  value: string
  /** Optional LLM confidence score. Range 0–1. */
  confidence?: number
}

/**
 * The request body sent to the developer's endpoint (POST).
 * The developer forwards this to their LLM and returns a ParseResponse.
 * This type is exported so developers can type their server handler.
 */
export interface ParseRequest {
  /**
   * The final transcript from the STT adapter.
   * Example: "John Smith, john at example dot com, 555-1234"
   */
  transcript: string

  /**
   * The form schema at the time of the request. Included so the server
   * handler does not need to maintain its own copy.
   */
  schema: FormSchema

  /**
   * Unique ID for this request. Useful for server-side logging and
   * idempotency checks. Generated by the endpoint client as a UUID v4.
   */
  requestId: string
}

/**
 * The response the developer's endpoint must return.
 * voice-form validates this shape at runtime before proceeding.
 */
export interface ParseResponse {
  /**
   * Parsed field values keyed by FieldSchema.name.
   * A field the LLM could not extract should be omitted (not set to null).
   */
  fields: Record<string, ParsedFieldValue>

  /**
   * Optional raw text generated by the LLM for debugging.
   * voice-form does not use this value; it is surfaced in dev-mode console output.
   */
  rawResponse?: string
}

// ─── State Machine ────────────────────────────────────────────────────────────

/**
 * The set of status values the voice-form engine can be in at any moment.
 * The discriminant on VoiceFormState — each status variant carries only
 * the data relevant to that state, preventing impossible state representations.
 */
export type VoiceFormStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'confirming'
  | 'injecting'
  | 'done'

/**
 * Discriminated union for the full state machine state.
 * Narrow on `status` to access state-specific data safely.
 *
 * @example
 * if (state.status === 'recording') {
 *   console.log(state.interimTranscript) // type-safe
 * }
 */
export type VoiceFormState =
  | { status: 'idle' }
  | { status: 'recording'; interimTranscript: string }
  | { status: 'processing'; transcript: string }
  | { status: 'confirming'; transcript: string; confirmation: ConfirmationData }
  | { status: 'injecting'; confirmation: ConfirmationData }
  | { status: 'done'; result: InjectionResult }
  | { status: 'error'; error: VoiceFormError; previousStatus: VoiceFormStatus }

// ─── Confirmation ─────────────────────────────────────────────────────────────

/**
 * A single confirmed field value, enriched with its label for display
 * in the confirmation panel.
 */
export interface ConfirmedField {
  /** The field label from FieldSchema (or name if label was omitted). */
  label: string
  /** The value the LLM extracted. */
  value: string
  /** Optional confidence score from the LLM (0–1). */
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

/**
 * Data presented to the user in the confirmation step.
 * The default UI renders this; in headless mode the developer renders it.
 *
 * CRITICAL (security review #1): Treat as immutable once it enters `confirming`
 * state. The `FIELD_CORRECTED` event produces a new object via spread — never
 * mutate `parsedFields` in place. `useSyncExternalStore.getSnapshot` must
 * return a stable reference per render pass.
 */
export interface ConfirmationData {
  /** The raw transcript from STT, shown so the user can verify what was heard. */
  transcript: string

  /**
   * Fields that were successfully parsed, ready to inject.
   * Keyed by FieldSchema.name.
   */
  parsedFields: Record<string, ConfirmedField>

  /**
   * Fields the LLM could not extract a value for.
   * If any are `required: true`, a warning is shown in the confirmation UI.
   */
  missingFields: readonly string[]

  /**
   * Fields where the parsed value failed a FieldValidation constraint.
   * The value is still present and can be injected; this is advisory.
   */
  invalidFields: ReadonlyArray<{ name: string; value: string; reason: string }>

  /**
   * True when appendMode was active for this session.
   * Used by the confirmation panel to render the append preview rows.
   * (FR-108)
   */
  appendMode: boolean
}

// ─── Injection Result ─────────────────────────────────────────────────────────

/**
 * The per-field outcome after an injection attempt.
 * Discriminated on `status`.
 */
export type FieldInjectionOutcome =
  | { status: 'injected'; value: string }
  | {
      status: 'skipped'
      reason: 'element-not-found' | 'read-only' | 'disabled' | 'value-not-in-options'
    }
  | { status: 'failed'; error: string }

/**
 * Returned by the injector after attempting to set DOM values.
 * The developer can inspect per-field success/failure in the onDone callback.
 */
export interface InjectionResult {
  /** True only if every field in parsedFields was injected without error. */
  success: boolean

  /** Per-field outcome. Key is FieldSchema.name. */
  fields: Record<string, FieldInjectionOutcome>
}

// ─── Events / Callbacks ───────────────────────────────────────────────────────

/**
 * All developer-facing callbacks. Every callback is optional.
 * Callbacks receive typed data and must not throw — exceptions inside
 * callbacks are caught and logged but do not break the state machine.
 */
export interface VoiceFormEvents {
  /** Called whenever the state machine transitions to a new state. */
  onStateChange?: (state: VoiceFormState) => void

  /**
   * Called with interim (partial) STT results during recording.
   * WARNING: This value is raw STT output and has NOT been sanitized.
   * If you render this in the DOM, use textContent — never innerHTML.
   */
  onInterimTranscript?: (transcript: string) => void

  /**
   * Called after STT completes and the endpoint has returned data,
   * just before the confirmation step is shown. Returning a modified
   * ConfirmationData object allows the developer to augment or filter
   * the parsed values before display.
   *
   * NOTE: Values returned from this callback are re-sanitized before
   * display and injection. The callback is a convenience, not a trust
   * elevation. (MED-004)
   */
  onBeforeConfirm?: (data: ConfirmationData) => ConfirmationData | void

  /**
   * Called after the user confirms and all fields have been injected.
   * Use this to trigger form submission, analytics, etc.
   */
  onDone?: (result: InjectionResult) => void

  /**
   * Called when the user cancels from any cancellable state
   * (recording, processing, confirming).
   */
  onCancel?: () => void

  /**
   * Called on any error. Recoverable errors allow the user to try again;
   * fatal errors require a page reload or re-initialization.
   */
  onError?: (error: VoiceFormError) => void
}

// ─── State Machine Events ─────────────────────────────────────────────────────

/**
 * All events the state machine accepts. Each event carries only the payload
 * relevant to that transition. The `type` field is the discriminant.
 *
 * Internal events (e.g., AUTO_RESET) are dispatched by the engine itself,
 * not by the developer. They are exported to enable testing and headless
 * implementations that need to inspect them.
 */
export type VoiceFormEvent =
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

// ─── State Machine Interface ──────────────────────────────────────────────────

/**
 * The state machine interface returned by `createStateMachine`.
 * Consumers dispatch events to drive transitions and subscribe to
 * state changes for side-effect handling.
 */
export interface StateMachine {
  /** Returns the current state. */
  getState(): VoiceFormState

  /**
   * Dispatch an event to the state machine. If the transition is invalid
   * for the current state, the event is ignored (state unchanged).
   */
  dispatch(event: VoiceFormEvent): void

  /**
   * Subscribe to state transitions. The listener receives both the new
   * state and the event that caused the transition.
   *
   * @returns An unsubscribe function. Call it to remove the listener.
   */
  subscribe(listener: (state: VoiceFormState, event: VoiceFormEvent) => void): () => void

  /**
   * Clear all listeners and release internal resources.
   * Must be called by VoiceFormInstance.destroy() to prevent memory leaks
   * on repeated mount/unmount. (PERF 2.6)
   */
  destroy(): void
}

// ─── Endpoint Error ───────────────────────────────────────────────────────────

/**
 * Error codes specific to the fetch-based endpoint client.
 */
export type EndpointErrorCode =
  | 'NETWORK_ERROR' // fetch threw — no response received
  | 'TIMEOUT' // AbortController fired via timeout
  | 'HTTP_ERROR' // response.ok === false (4xx or 5xx)
  | 'INVALID_JSON' // response body is not valid JSON
  | 'INVALID_RESPONSE_SHAPE' // response does not match ParseResponse contract
  | 'ABORTED' // abort() was called manually (cancel flow)

/**
 * An error thrown by the endpoint client. Extends Error for stack traces.
 * Carries the HTTP status when available for debugging 4xx/5xx responses.
 */
export interface EndpointError extends Error {
  /** Machine-readable classification of the endpoint failure. */
  readonly code: EndpointErrorCode
  /** HTTP status code when available (set for HTTP_ERROR code). */
  readonly httpStatus?: number
}

// ─── Endpoint Options ─────────────────────────────────────────────────────────

/**
 * Options for the fetch-based endpoint client.
 * All properties are optional; defaults are applied by the client.
 */
export interface EndpointOptions {
  /** Request timeout in milliseconds. Default: 10000 (10s). */
  timeoutMs?: number
  /** Number of retry attempts on network error or 5xx response. Default: 1. */
  retries?: number
  /**
   * Additional headers merged into every request.
   * Use for auth tokens or custom request identification.
   * These are merged after the library's own required headers.
   */
  headers?: Record<string, string>
}

// ─── UI Options ───────────────────────────────────────────────────────────────

/**
 * All CSS custom properties voice-form supports for theming.
 * Override any of these on the component's root element to match your
 * design system. Do not set on `:root` — that triggers a full document
 * style recalculation.
 */
export interface VoiceFormCSSVars {
  /** Primary action color (mic button background). Default: #2563eb. */
  '--vf-primary': string
  /** Primary hover color. Default: #1d4ed8. */
  '--vf-primary-hover': string
  /** Danger/error accent color. Default: #dc2626. */
  '--vf-danger': string
  /** Surface background color for panels. Default: #ffffff. */
  '--vf-surface': string
  /** Text color on surface. Default: #111827. */
  '--vf-on-surface': string
  /** Border radius applied to buttons and panels. Default: 50% (mic button). */
  '--vf-border-radius': string
  /** Font family. Default: inherit. */
  '--vf-font-family': string
  /** z-index for overlay elements. Default: 100. */
  '--vf-z-index': string

  // ── v2 additions ──────────────────────────────────────────────────────────

  /** Background color for the "Unchanged" badge. Default: #f3f4f6. */
  '--vf-unchanged-badge-bg': string
  /** Text color for the "Unchanged" badge. Default: #6b7280. */
  '--vf-unchanged-badge-text': string
  /** Color for the existing value in append-mode preview. Default: #9ca3af. */
  '--vf-append-existing-color': string
  /** Color for the new value in append-mode preview. Default: #2563eb. */
  '--vf-append-new-color': string
  /** Color for the field edit button. Default: #6b7280. */
  '--vf-field-edit-btn-color': string
  /** Hover color for the field edit button. Default: #111827. */
  '--vf-field-edit-btn-hover-color': string
  /** Border color of the field edit input. Default: #2563eb. */
  '--vf-field-edit-input-border': string
  /** Background color of the field edit input. Default: #eff6ff. */
  '--vf-field-edit-input-bg': string
  /** Color for invalid-value feedback in edit mode. Default: #dc2626. */
  '--vf-field-edit-invalid-color': string
  /** Indicator color shown on user-corrected fields. Default: #2563eb. */
  '--vf-field-corrected-indicator': string
}

/**
 * UI customization options. All properties are optional.
 * Only applies when `headless` is false.
 */
export interface UIOptions {
  /**
   * CSS custom properties injected on the mic button container.
   * This is the primary theming surface.
   */
  cssVars?: Partial<VoiceFormCSSVars>
  /** Custom aria-label for the mic button in idle state. Default: "Start voice input". */
  micButtonLabel?: string
  /** Custom label for the confirm button. Default: "Confirm". */
  confirmButtonLabel?: string
  /** Custom label for the cancel button. Default: "Cancel". */
  cancelButtonLabel?: string
}

// ─── Strings (i18n) ───────────────────────────────────────────────────────────

/**
 * A string value that can be a static string or a function receiving
 * a count for pluralization support (UX_SPEC § 11.3).
 */
export type StringOrCountFn = string | ((count: number) => string)

/**
 * All user-facing strings rendered by voice-form.
 * Every string is overridable via the `strings` config option.
 * voice-form deep-merges a partial override with the English defaults.
 *
 * See UX_SPEC.md § 11.1 for the complete key reference.
 */
export interface VoiceFormStrings {
  /**
   * Mic button aria-labels (also used as visible labels when configured).
   * Updated on every state transition.
   */
  buttonLabel: {
    /** Button aria-label in idle state. Default: "Use voice input". */
    idle: string
    /** Button aria-label during recording. Default: "Stop recording". */
    recording: string
    /** Button aria-label during processing. Default: "Processing speech". */
    processing: string
    /** Button aria-label in done state. Default: "Voice input complete". */
    done: string
    /** Button aria-label in error state. Default: "Voice input error". */
    error: string
    /** Button aria-label when browser is unsupported. Default: "Voice input not available". */
    unsupported: string
    /** Button aria-label during cooldown. Default: "Voice input cooling down". */
    cooldown: string
  }

  /** Visible status text rendered beneath the mic button. */
  status: {
    /** Visible during recording state. Default: "Listening…". */
    listening: string
    /** Visible during processing state. Default: "Processing…". */
    processing: string
    /** Visible briefly in done state. Default: "Form filled". */
    done: string
    /** Permanent message when browser is unsupported. */
    unsupported: string
  }

  /** Error messages shown beneath the button after a failure. */
  errors: {
    /** After mic permission denied. */
    permissionDenied: string
    /** After silence timeout with no transcript. */
    noSpeech: string
    /** After endpoint network/HTTP error. */
    endpointError: string
    /** After malformed LLM response. */
    parseError: string
    /** After transcript length exceeded. */
    transcriptTooLong: string
    /** Retry affordance link text. */
    retryLabel: string
    /** Re-record affordance for transcript-too-long error. */
    rerecordLabel: string
    /** Help link text for permission denied. */
    permissionHelp: string
  }

  /** Strings for the confirmation panel dialog. */
  confirm: {
    /** Panel header text. Default: "What I heard". */
    title: string
    /** Panel description (sr-only). */
    description: string
    /** Cancel button text. Default: "Cancel". */
    cancelLabel: string
    /** Cancel button aria-label. */
    cancelAriaLabel: string
    /** Fill button text. Default: "Fill form". */
    fillLabel: string
    /** Fill button text when fields were manually corrected. Default: "Fill form (edited)". */
    fillLabelEdited: string
    /** Fill button aria-label. */
    fillAriaLabel: string
    /** Dismiss [X] button aria-label. */
    dismissAriaLabel: string
    /** Badge text for unrecognized fields. Default: "Not understood". */
    unrecognizedLabel: string
    /** Badge aria-label for unrecognized fields. */
    unrecognizedAriaLabel: string
    /** Sanitization warning icon aria-label. */
    sanitizedAriaLabel: string

    // ── v2 field-correction strings (FR-114) ──────────────────────────────────

    /**
     * Edit button aria-label. Receives field label.
     * Default: "Edit {label}". Accepts a function for dynamic labels.
     */
    editAriaLabel: string | ((fieldLabel: string) => string)
    /** Save button label in edit mode. Default: "Save". */
    saveEditLabel: string
    /**
     * Save button aria-label. Receives field label.
     * Default: "Save {label} correction".
     */
    saveEditAriaLabel: string | ((fieldLabel: string) => string)
    /** Discard button label in edit mode. Default: "Cancel". */
    discardEditLabel: string
    /**
     * Discard button aria-label. Receives field label.
     * Default: "Discard {label} correction".
     */
    discardEditAriaLabel: string | ((fieldLabel: string) => string)
    /** Shown when sanitization rejects a draft correction. Default: "Invalid value". */
    invalidValueLabel: string
    /** Screen reader hint in edit mode. Default: "Press Enter to save, Escape to cancel." */
    editHintText: string

    // ── v2 append-mode preview strings (FR-108) ───────────────────────────────

    /** "Current:" label in append mode preview. Default: "Current:". */
    appendExistingLabel: string
    /** "Adding:" label in append mode preview. Default: "Adding:". */
    appendNewLabel: string
    /** "Result:" label in append mode preview. Default: "Result:". */
    appendResultLabel: string

    // ── v2 multi-step strings (FR-111) ────────────────────────────────────────

    /** Optional step indicator, e.g. "Step 2 of 3: Address". */
    stepLabel?: string

    // ── v2 badge for null/unchanged fields ────────────────────────────────────

    /** Badge text for null fields (replaces v1 "Not understood"). Default: "Unchanged". */
    unchangedLabel: string
  }

  /** Strings for the privacy notice panel. */
  privacy: {
    /** Acknowledge button text. Default: "I understand". */
    acknowledgeLabel: string
    /** Acknowledge button aria-label. */
    acknowledgeAriaLabel: string
    /** Notice region aria-label. */
    regionAriaLabel: string
  }

  /**
   * Screen reader live region announcements.
   * Strings that include `{count}` also accept a function for pluralization.
   */
  announcements: {
    /** On transition to recording. */
    listening: string
    /** On transition to processing. */
    processing: string
    /** On confirmation panel open. Supports {count} or function. */
    confirming: StringOrCountFn
    /** On successful injection. Supports {count} or function. */
    filled: StringOrCountFn
    /** On confirmation cancel. */
    cancelled: string
    /** Permission denied announcement. */
    errorPermission: string
    /** No speech detected announcement. */
    errorNoSpeech: string
    /** Endpoint error announcement. */
    errorEndpoint: string
    /** Transcript too long announcement. */
    errorTranscriptTooLong: string

    // ── v2 field-correction announcements (FR-114) ────────────────────────────

    /**
     * Announced when a field enters edit mode.
     * Receives field label. Accepts a function for dynamic labels.
     */
    fieldEditOpened: string | ((fieldLabel: string) => string)

    /**
     * Announced when a field correction is saved.
     * Receives field label. Accepts a function for dynamic labels.
     */
    fieldEditSaved: string | ((fieldLabel: string) => string)
  }
}

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * All error codes the voice-form engine can produce.
 * Use these to discriminate errors in `onError` callbacks.
 */
export type VoiceFormErrorCode =
  // STT errors
  | 'STT_NOT_SUPPORTED'
  | 'PERMISSION_DENIED'
  // Transcript validation
  | 'NO_TRANSCRIPT'
  | 'TRANSCRIPT_TOO_LONG'
  | 'INVALID_TRANSCRIPT'
  // Endpoint / parse
  | 'ENDPOINT_ERROR'
  | 'ENDPOINT_TIMEOUT'
  | 'PARSE_FAILED'
  | 'INVALID_RESPONSE'
  // Injection
  | 'INJECTION_FAILED'
  | 'INVALID_FIELD_VALUE'
  // Privacy / UX flow
  | 'PRIVACY_NOT_ACKNOWLEDGED'
  | 'COOLDOWN_ACTIVE'
  // Developer callback failures
  | 'BEFORE_CONFIRM_FAILED'
  // Initialization / lifecycle
  | 'SCHEMA_INVALID'
  | 'INIT_FAILED'
  | 'INVALID_TRANSITION'
  | 'DESTROYED'
  // Catch-all
  | 'UNKNOWN'

/**
 * The standard error payload produced by the voice-form engine.
 * Surfaced via `onError`, thrown by `createVoiceForm` for fatal config errors,
 * and carried in `VoiceFormState` error variant.
 */
export interface VoiceFormError {
  /** Machine-readable error classification. */
  code: VoiceFormErrorCode

  /** Human-readable description of what went wrong. */
  message: string

  /**
   * Whether the engine can recover from this error automatically.
   * If true, the state machine transitions to `error` and then auto-resets to
   * `idle` after `errorResetMs` (default 3000ms). If false, `destroy()` must
   * be called before the instance can be re-used.
   */
  recoverable: boolean

  /**
   * Additional debugging information. Only populated when `debug: true` is set
   * in VoiceFormConfig, or for HTTP errors where the status is always available.
   *
   * WARNING: `rawBody` may contain LLM output — never render it as HTML.
   */
  debugInfo?: {
    /** HTTP status code from the endpoint, when applicable. */
    httpStatus?: number
    /**
     * Raw response body from the endpoint, truncated to 500 characters.
     * (BRD FR-011)
     */
    rawBody?: string
    /** Unix timestamp (ms) when the error was created. */
    timestamp: number
  }
}

/**
 * Thrown synchronously by `createVoiceForm` when configuration is invalid.
 * This is a fatal, non-recoverable error — no VoiceFormInstance is returned.
 * Extends `Error` so it can be caught by standard try/catch.
 *
 * @example
 * try {
 *   const instance = createVoiceForm({ endpoint: '', schema: { fields: [] } })
 * } catch (err) {
 *   if (err instanceof VoiceFormConfigError) {
 *     console.error(err.code, err.message)
 *   }
 * }
 */
export interface VoiceFormConfigError extends Error {
  /** Machine-readable error classification, always `'SCHEMA_INVALID'` or `'INIT_FAILED'`. */
  readonly code: VoiceFormErrorCode
}

// ─── Schema Validation ────────────────────────────────────────────────────────

/**
 * The result of schema validation. Returned by `validateSchema`.
 * If `valid` is false, `errors` contains one message per failing rule.
 */
export interface ValidationResult {
  /** True if the schema passed all validation rules. */
  valid: boolean
  /**
   * Array of human-readable error messages, one per failing rule.
   * Empty when `valid` is true.
   */
  errors: string[]
}

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * The complete configuration object passed to `createVoiceForm`.
 *
 * `endpoint` and `schema` are required. All other options have sensible
 * defaults. The `llmAdapter` option is intentionally absent — the only
 * supported LLM integration path in v1 is the BYOE endpoint. (CRIT-002)
 */
export interface VoiceFormConfig {
  /**
   * URL of the developer's backend endpoint. voice-form will POST a
   * ParseRequest to this URL and expect a ParseResponse.
   * This is the only supported parse path in v1 (BYOE pattern).
   * May be absolute or relative.
   *
   * Throws VoiceFormConfigError(INIT_FAILED) if omitted.
   */
  endpoint: string

  /**
   * The form schema. Required. voice-form throws VoiceFormConfigError
   * at init time if the schema is invalid (missing fields, bad types, etc.).
   */
  schema: FormSchema

  /**
   * STT adapter override. Defaults to the Web Speech API adapter.
   * Provide a custom implementation for Whisper, AssemblyAI, etc.
   */
  sttAdapter?: STTAdapter

  /**
   * DOM element or CSS selector pointing to the form. Used to scope
   * element lookups during injection. If omitted, `document` is used.
   */
  formElement?: HTMLElement | string

  /**
   * CSS selector or element reference for the mic button container.
   * If provided, the default mic button is rendered into this element.
   * Ignored when `headless: true`.
   */
  mountTarget?: HTMLElement | string

  /**
   * When true, no default UI is rendered. The developer receives state
   * via `events.onStateChange` and controls the flow by calling
   * `instance.start()`, `instance.cancel()`, and `instance.confirm()`.
   * Default: false.
   */
  headless?: boolean

  /**
   * Minimum milliseconds between endpoint requests. Prevents rapid
   * repeated activations from flooding the endpoint. Enforced as a
   * guard on the idle → recording transition.
   * Default: 3000. Set to 0 to disable. (HIGH-004)
   */
  requestCooldownMs?: number

  /**
   * Text displayed to the user before the first microphone permission
   * request. Required for applications subject to GDPR, CCPA, or HIPAA.
   * If omitted, no privacy notice is shown. (HIGH-003)
   *
   * Example: "Voice input uses your browser's speech recognition,
   * processed by Google. Audio is not stored by this application."
   */
  privacyNotice?: string

  /**
   * If true, the user must explicitly acknowledge the privacy notice
   * before microphone access is requested. Default: false.
   * Recommended: true for any regulated application. (HIGH-003)
   */
  requirePrivacyAcknowledgement?: boolean

  /**
   * Maximum number of characters accepted in a transcript before it is
   * rejected. Enforced in the endpoint client before sending.
   * Default: 2000. (CRIT-003)
   */
  maxTranscriptLength?: number

  /**
   * Options forwarded to the fetch-based endpoint client (timeout, retries,
   * custom headers).
   */
  endpointOptions?: EndpointOptions

  /**
   * UI customization. Only applies when `headless` is false.
   */
  ui?: UIOptions

  /**
   * Developer-facing event callbacks. All optional.
   */
  events?: VoiceFormEvents

  /**
   * When true, voice-form logs verbose debug output to the console.
   * Gate this on your own `process.env.NODE_ENV !== 'production'` check.
   *
   * WARNING: debug mode logs transcripts and field values.
   * Disable before deploying to production.
   */
  debug?: boolean

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

// ─── Instance ─────────────────────────────────────────────────────────────────

/**
 * The object returned by `createVoiceForm`. This is the developer's
 * handle on the running engine. All methods throw VoiceFormError(DESTROYED)
 * after `destroy()` has been called.
 */
/** A function that removes a listener added via `subscribe`. */
export type Unsubscribe = () => void

/** A listener function called on every state machine transition. */
export type StateListener = (state: VoiceFormState) => void

export interface VoiceFormInstance {
  /** Returns the current state. Useful for polling in headless mode. */
  getState(): VoiceFormState

  /**
   * Returns the parsed field values if the instance is currently in
   * `confirming` or `injecting` state. Returns `null` in all other states.
   *
   * Provides access to the fields the LLM extracted so they can be
   * rendered by a headless consumer without subscribing to the full state.
   */
  getParsedFields(): Record<string, ConfirmedField> | null

  /**
   * Start a recording session. Valid only from `idle` state.
   * In non-headless mode this is called automatically by the mic button.
   *
   * @throws {VoiceFormError} with code INVALID_TRANSITION if called from wrong state.
   * @throws {VoiceFormError} with code PRIVACY_NOT_ACKNOWLEDGED if
   *   requirePrivacyAcknowledgement is true and the user has not yet acknowledged.
   */
  start(): Promise<void>

  /**
   * Stop the current recording session gracefully. The STT adapter is asked
   * to produce a final transcript with whatever audio was captured, then the
   * session transitions to idle. No-op if not in `recording` state.
   */
  stop(): void

  /**
   * Cancel the current session. Valid from `recording`, `processing`,
   * and `confirming` states. Returns to `idle`.
   */
  cancel(): void

  /**
   * Confirm the parsed values and begin injection.
   * Valid only from `confirming` state.
   * In non-headless mode this is called automatically by the confirm button.
   */
  confirm(): Promise<void>

  /**
   * Programmatically update the schema after initialization.
   * Valid only from `idle` state. Useful for dynamic forms.
   *
   * @throws {VoiceFormError} with code INVALID_TRANSITION if called from wrong state.
   * @throws {VoiceFormError} with code SCHEMA_INVALID if the new schema fails validation.
   */
  updateSchema(schema: FormSchema): void

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

  /**
   * Remove all DOM elements created by voice-form and release all
   * event listeners, abort controllers, timers, and STT resources.
   * The instance must not be used after this call. (PERF 2.6)
   */
  destroy(): void

  /**
   * Subscribe to state transitions. The listener is called with the new
   * state on every transition.
   *
   * @returns An `Unsubscribe` function. Call it to remove the listener.
   */
  subscribe(listener: StateListener): Unsubscribe
}
