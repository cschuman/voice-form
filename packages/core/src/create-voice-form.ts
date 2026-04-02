/**
 * @voiceform/core — createVoiceForm factory
 *
 * The main public API entry point. Wires together:
 *   - Schema validator (construction-time validation)
 *   - State machine (event-driven state)
 *   - STT adapter (Web Speech or custom)
 *   - Endpoint client (BYOE fetch)
 *   - Injector (DOM or callback)
 *   - Sanitization + transcript validation
 *
 * Design notes:
 *   - Reentrancy guard on the state subscriber prevents concurrent async
 *     handlers from overlapping. (PERF 2.5)
 *   - All timers (auto-reset, cooldown) are tracked and cleared on destroy().
 *     (PERF 2.9)
 *   - Cooldown guard on idle→recording prevents endpoint flooding. (HIGH-004)
 *   - safeInvokeCallback wraps all developer callbacks — exceptions are logged
 *     but never propagate into the state machine.
 *
 * Canonical spec: docs/LOW_LEVEL_DESIGN.md § 4g
 */

import { validateSchema } from './schema-validator.js'
import { createStateMachine } from './state-machine.js'
import { createWebSpeechAdapter } from './adapters/web-speech.js'
import { EndpointClient, resolveEndpointOptions } from './endpoint-client.js'
import { createInjector } from './injector.js'
import { sanitizeFieldValue, validateFieldConstraints } from './utils/sanitize.js'
import { validateTranscript } from './utils/validate-transcript.js'
import type {
  VoiceFormConfig,
  VoiceFormInstance,
  VoiceFormState,
  VoiceFormEvent,
  VoiceFormError,
  ParsedFieldValue,
  ParseResponse,
  ConfirmationData,
  ConfirmedField,
  InjectionResult,
  FormSchema,
  STTAdapterEvents,
  StateMachine,
} from './types.js'
import type { Injector } from './injector.js'

// ─── VoiceFormConfigError concrete class ─────────────────────────────────────

/**
 * Concrete throwable error for construction-time config failures.
 * Thrown synchronously by `createVoiceForm` when configuration is invalid
 * (missing endpoint, invalid schema, etc.).
 *
 * Implements the `VoiceFormConfigError` interface from `types.ts`.
 * Exported as part of the public API so consumers can use `instanceof` checks.
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
export class VoiceFormConfigError extends Error {
  readonly code: 'SCHEMA_INVALID' | 'INIT_FAILED'

  constructor(code: 'SCHEMA_INVALID' | 'INIT_FAILED', message: string) {
    super(message)
    this.name = 'VoiceFormConfigError'
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─── VoiceFormError concrete class ───────────────────────────────────────────

/**
 * Concrete throwable error for runtime failures dispatched through the
 * state machine's error state.
 */
class VoiceFormErrorImpl extends Error implements VoiceFormError {
  readonly code: VoiceFormError['code']
  readonly recoverable: boolean
  // `declare` tells TypeScript the property matches the interface's optional
  // shape exactly — key absent when not set — without widening to `| undefined`.
  declare readonly debugInfo?: NonNullable<VoiceFormError['debugInfo']>

  constructor(
    code: VoiceFormError['code'],
    message: string,
    recoverable = true,
    debugInfo?: NonNullable<VoiceFormError['debugInfo']>,
  ) {
    super(message)
    this.name = 'VoiceFormError'
    this.code = code
    this.recoverable = recoverable
    if (debugInfo !== undefined) {
      // Only assign the property when there is a value — keeps the key absent
      // otherwise, satisfying exactOptionalPropertyTypes.
      Object.defineProperty(this, 'debugInfo', {
        value: debugInfo,
        writable: false,
        enumerable: true,
        configurable: false,
      })
    }
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─── safeInvokeCallback ───────────────────────────────────────────────────────

/**
 * Wraps a developer-provided callback in a try/catch.
 * Exceptions are logged to console.error but never propagate.
 * Returns the callback's return value, or `undefined` if it threw.
 */
function safeInvokeCallback<T, R>(
  callback: ((arg: T) => R) | (() => R) | undefined,
  arg: T,
): R | undefined {
  if (!callback) return undefined
  try {
    return (callback as (arg: T) => R)(arg)
  } catch (err) {
    console.error('[voice-form] Error in developer callback:', err)
    return undefined
  }
}

/**
 * Invokes the onBeforeConfirm callback with exception detection.
 *
 * Unlike `safeInvokeCallback`, this function distinguishes between a callback
 * that threw and one that succeeded. When the callback throws, the error is
 * reported to the `onError` callback (NEW-004 / CWE-754) so that developer
 * error-handling infrastructure (Sentry, Datadog, etc.) is engaged. The
 * original sanitized data is used as a fallback so the state machine flow
 * continues — data integrity is maintained even when the hook fails.
 *
 * The `onBeforeConfirm` callback is a data-augmentation hook. Its failure is
 * behaviorally silent from the user's perspective (original data is used),
 * which makes it particularly important to surface the exception explicitly to
 * the developer.
 *
 * @param callback   - The onBeforeConfirm callback, or undefined.
 * @param arg        - The ConfirmationData to pass to the callback.
 * @param onError    - The developer's onError callback, if configured.
 * @returns The callback's return value, the original arg as fallback on throw,
 *          or the original arg when no callback is configured.
 */
function invokeBeforeConfirm(
  callback: ((data: ConfirmationData) => ConfirmationData | void) | undefined,
  arg: ConfirmationData,
  onError: ((err: VoiceFormError) => void) | undefined,
): ConfirmationData {
  if (!callback) return arg

  try {
    const result = callback(arg)
    // If the callback returned undefined, fall back to the original data
    return result !== undefined ? result : arg
  } catch (err) {
    console.error('[voice-form] Error in onBeforeConfirm callback:', err)
    // NEW-004: Report the failure to the developer's onError callback so that
    // error tracking infrastructure is engaged. The original sanitized data is
    // used as a fallback so the flow continues. (CWE-754)
    if (onError) {
      safeInvokeCallback(onError, new VoiceFormErrorImpl(
        'BEFORE_CONFIRM_FAILED',
        'onBeforeConfirm callback threw an exception — using original confirmation data as fallback. ' +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      ))
    }
    return arg
  }
}

// ─── isAbortError ─────────────────────────────────────────────────────────────

/**
 * Returns true if the error is an AbortError from a fetch abort or an
 * EndpointError with code 'ABORTED'.
 */
function isAbortError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const e = err as Record<string, unknown>

  // DOMException AbortError from fetch
  if (e['name'] === 'AbortError') return true

  // EndpointError with ABORTED code
  if (e['code'] === 'ABORTED') return true

  return false
}

// ─── normalizeError ───────────────────────────────────────────────────────────

/**
 * Converts an unknown thrown value to a VoiceFormError suitable for
 * dispatching as a PARSE_ERROR event.
 */
function normalizeError(err: unknown): VoiceFormError {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>

    // EndpointError from the endpoint client
    if (typeof e['code'] === 'string') {
      const code = e['code'] as string
      if (code === 'TIMEOUT') {
        return new VoiceFormErrorImpl('ENDPOINT_TIMEOUT', String(e['message'] ?? 'Request timed out'), true)
      }
      if (code === 'NETWORK_ERROR' || code === 'HTTP_ERROR') {
        return new VoiceFormErrorImpl('ENDPOINT_ERROR', String(e['message'] ?? 'Endpoint request failed'), true)
      }
      if (code === 'INVALID_JSON' || code === 'INVALID_RESPONSE_SHAPE') {
        return new VoiceFormErrorImpl('INVALID_RESPONSE', String(e['message'] ?? 'Invalid response from endpoint'), true)
      }
    }
  }

  return new VoiceFormErrorImpl(
    'ENDPOINT_ERROR',
    err instanceof Error ? err.message : 'An unknown error occurred',
    true,
  )
}

// ─── resolveElementForRead ────────────────────────────────────────────────────

/**
 * Resolves a field name to a DOM element for reading its current value.
 * Uses the same three-step lookup as the injector (name → id → data-voiceform),
 * but does not cache results — this is called only during the processing state,
 * once per field per session. (FR-108 / LLD § 4.3)
 */
function resolveElementForRead(
  fieldName: string,
  root: HTMLElement | Document,
): HTMLInputElement | HTMLTextAreaElement | null {
  const escaped = CSS.escape(fieldName)
  const el =
    (root.querySelector(`[name="${escaped}"]`) as HTMLElement | null) ??
    (root.querySelector(`#${escaped}`) as HTMLElement | null) ??
    (root.querySelector(`[data-voiceform="${escaped}"]`) as HTMLElement | null)

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el
  }
  return null
}

// ─── buildConfirmationData ────────────────────────────────────────────────────

/**
 * Converts a ParseResponse into a ConfirmationData object by cross-referencing
 * the schema. Sanitizes each field value via sanitizeFieldValue.
 *
 * Fields in the schema that are absent from the response are placed in
 * missingFields. Fields whose sanitized values fail type constraints are placed
 * in invalidFields (but still included in parsedFields for display).
 *
 * When `options.appendMode` is true and a formElement is provided, reads the
 * current DOM value of text/textarea fields and attaches it as `existingValue`
 * on the ConfirmedField. The injector later uses this snapshot to build the
 * final concatenated value without re-reading the DOM at injection time.
 * (FR-108 / LLD § 4.3)
 */
function buildConfirmationData(
  response: ParseResponse,
  transcript: string,
  schema: FormSchema,
  options: {
    appendMode: boolean
    formElement?: HTMLElement | Document
  } = { appendMode: false },
): ConfirmationData {
  const parsedFields: Record<string, ConfirmedField> = {}
  const missingFields: string[] = []
  const invalidFields: Array<{ name: string; value: string; reason: string }> = []

  for (const fieldDef of schema.fields) {
    const raw: ParsedFieldValue | undefined = response.fields[fieldDef.name]

    if (raw === undefined) {
      missingFields.push(fieldDef.name)
      continue
    }

    const label = fieldDef.label ?? fieldDef.name
    let sanitizedValue = raw.value

    let constraintViolation = false
    try {
      const result = sanitizeFieldValue(
        raw.value,
        fieldDef.type,
        fieldDef.options as string[] | undefined,
      )
      sanitizedValue = typeof result.value === 'string' ? result.value : String(result.value)

      // NEW-002: Evaluate FieldValidation constraints on the sanitized value.
      // Constraints are advertised to the LLM in the prompt but were previously
      // never verified client-side. Violations are flagged in invalidFields but
      // do not block injection — consistent with the contract in types.ts. (CWE-20)
      const constraintResult = validateFieldConstraints(sanitizedValue, fieldDef)
      if (!constraintResult.valid) {
        constraintViolation = true
        invalidFields.push({
          name: fieldDef.name,
          value: sanitizedValue,
          reason: constraintResult.reason ?? 'Constraint validation failed',
        })
      }
    } catch (err) {
      // Sanitization failure — record as invalid but include the stripped value
      sanitizedValue = raw.value
      constraintViolation = true
      invalidFields.push({
        name: fieldDef.name,
        value: raw.value,
        reason: err instanceof Error ? err.message : 'Sanitization failed',
      })
    }

    // Include in parsedFields regardless of constraint violation — the user
    // can still confirm with the warning visible in the confirmation panel.
    void constraintViolation // used above; referenced here to satisfy linter

    parsedFields[fieldDef.name] = {
      label,
      value: sanitizedValue,
      ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
    }

    // FR-108: When appendMode is active, capture the current DOM value of
    // text/textarea fields as existingValue. This snapshot is taken during the
    // processing state — before the confirming state is entered — so the user
    // sees the pre-fill value in the append preview. The injector reads it
    // from ConfirmedField to compute the concatenated string.
    // Only text and textarea fields support appending — email, tel, number,
    // date, select, checkbox, and radio always replace. (LLD § 3.3 / FR-108)
    if (
      options.appendMode &&
      options.formElement !== undefined &&
      (fieldDef.type === 'text' || fieldDef.type === 'textarea')
    ) {
      const el = resolveElementForRead(fieldDef.name, options.formElement)
      if (el !== null && typeof el.value === 'string' && el.value.trim() !== '') {
        parsedFields[fieldDef.name] = {
          ...parsedFields[fieldDef.name]!,
          existingValue: el.value,
        }
      }
    }
  }

  return {
    transcript,
    parsedFields,
    missingFields,
    invalidFields,
    appendMode: options.appendMode,
  }
}

// ─── sanitizeConfirmationData ─────────────────────────────────────────────────

/**
 * Re-sanitizes a ConfirmationData after it has potentially been modified by
 * the developer's onBeforeConfirm callback. This prevents the callback from
 * being used as a trust elevation vector. (MED-004)
 */
function sanitizeConfirmationData(
  data: ConfirmationData,
  schema: FormSchema,
): ConfirmationData {
  const sanitizedParsedFields: Record<string, ConfirmedField> = {}

  // Build a name→schema Map once so each per-field lookup is O(1) instead of
  // performing a linear scan (schema.fields.find) on every iteration. (N-5)
  const fieldsByName = new Map(schema.fields.map((f) => [f.name, f]))

  for (const [fieldName, confirmedField] of Object.entries(data.parsedFields)) {
    const fieldDef = fieldsByName.get(fieldName)
    const fieldType = fieldDef?.type ?? 'text'
    const options = fieldDef?.options as string[] | undefined

    let sanitizedValue = confirmedField.value
    try {
      const result = sanitizeFieldValue(confirmedField.value, fieldType, options)
      sanitizedValue = typeof result.value === 'string' ? result.value : String(result.value)
    } catch {
      // Keep the original value if re-sanitization fails
    }

    sanitizedParsedFields[fieldName] = {
      ...confirmedField,
      value: sanitizedValue,
    }
  }

  return {
    ...data,
    parsedFields: sanitizedParsedFields,
  }
}

// ─── createVoiceForm ──────────────────────────────────────────────────────────

/**
 * Creates a fully-wired VoiceFormInstance.
 *
 * Initialization sequence:
 *  1. Validate schema — throws VoiceFormConfigError on failure
 *  2. Resolve STT adapter (config.sttAdapter ?? createWebSpeechAdapter())
 *  3. Validate endpoint — throws VoiceFormConfigError if empty
 *  4. Create EndpointClient
 *  5. Create Injector
 *  6. Create state machine
 *  7. Subscribe with reentrancy guard
 *  8. Return VoiceFormInstance
 *
 * @param config - The developer-supplied VoiceFormConfig.
 * @returns      A fully-initialized VoiceFormInstance.
 * @throws {VoiceFormConfigError} if the schema is invalid or endpoint is missing.
 */
export function createVoiceForm(config: VoiceFormConfig): VoiceFormInstance {
  // ── 1. Validate schema ───────────────────────────────────────────────────
  let currentSchema: FormSchema
  try {
    currentSchema = validateSchema(config.schema)
  } catch (err) {
    // Re-throw as-is — validateSchema already throws VoiceFormConfigError
    throw err
  }

  // ── 2. Validate endpoint ─────────────────────────────────────────────────
  if (!config.endpoint || config.endpoint.trim() === '') {
    throw new VoiceFormConfigError(
      'INIT_FAILED',
      'VoiceFormConfig.endpoint is required. Provide a URL for your BYOE parse endpoint.',
    )
  }

  // ── 3. Resolve STT adapter ───────────────────────────────────────────────
  const sttAdapter = config.sttAdapter ?? createWebSpeechAdapter()

  // ── 4. Create endpoint client ────────────────────────────────────────────
  // Pass config.debug so the endpoint client gates rawBody on the debug flag.
  // When debug is false (default), rawBody is omitted from debugInfo on HTTP
  // errors, preventing PII in LLM provider error responses from reaching
  // onError callbacks. (NEW-001 / CWE-209)
  const resolvedOptions = resolveEndpointOptions(config.endpointOptions, config.debug ?? false)
  const endpointClient = new EndpointClient(config.endpoint, resolvedOptions)

  // ── 5. Create injector ───────────────────────────────────────────────────
  // Resolve the formElement if provided as a CSS selector string.
  let formElementResolved: HTMLElement | undefined
  if (typeof config.formElement === 'string') {
    let found: HTMLElement | null
    try {
      found = document.querySelector<HTMLElement>(config.formElement)
    } catch {
      throw new VoiceFormConfigError(
        'INIT_FAILED',
        `VoiceFormConfig.formElement: invalid CSS selector "${config.formElement}". Provide a valid selector or an HTMLElement reference.`,
      )
    }
    if (found === null) {
      throw new VoiceFormConfigError(
        'INIT_FAILED',
        `VoiceFormConfig.formElement: selector "${config.formElement}" matched no element. Ensure the element exists before calling createVoiceForm().`,
      )
    }
    formElementResolved = found
  } else {
    formElementResolved = config.formElement
  }

  let injector: Injector = createInjector({
    ...(formElementResolved !== undefined ? { formElement: formElementResolved } : {}),
    appendMode: config.appendMode ?? false,
    multiStep: config.multiStep ?? false,
  })

  // ── 6. Create state machine ──────────────────────────────────────────────
  const machine: StateMachine = createStateMachine()

  // ── 7. Internal state tracking ───────────────────────────────────────────
  let destroyed = false
  let autoResetTimer: ReturnType<typeof setTimeout> | null = null
  let _lastRequestTimestamp = 0
  const cooldownMs = config.requestCooldownMs ?? 3000

  // Cooldown enforcement — timer-based flag that is armed when the done state
  // is entered (after a completed endpoint request). start() checks this flag
  // and rejects while active, firing onError(COOLDOWN_ACTIVE) directly without
  // touching the state machine (avoids reentrancy guard interactions). (HIGH-004)
  let cooldownActive = false
  let cooldownTimerId: ReturnType<typeof setTimeout> | null = null

  function startCooldownTimer(): void {
    if (cooldownMs <= 0) return
    if (cooldownTimerId !== null) clearTimeout(cooldownTimerId)
    cooldownActive = true
    cooldownTimerId = setTimeout(() => {
      cooldownTimerId = null
      cooldownActive = false
    }, cooldownMs)
  }

  // Active STT events binding — stored so abort can suppress stale callbacks
  let sttEventsActive = false

  // ── Reentrancy guard ─────────────────────────────────────────────────────
  //
  // Prevents two async handlers from running concurrently. Only the async
  // states (processing, injecting) hold the lock across an await. Synchronous
  // states (error, done, confirming, idle) run and complete within the same
  // microtask, so the lock is released before any follow-up dispatch.
  //
  // IMPORTANT: the lock is released (handlingTransition = false) BEFORE any
  // follow-up machine.dispatch() call so that the subsequent state's subscriber
  // handler is not blocked by the guard.
  let handlingTransition = false

  // ── Synchronous side-effect handlers ─────────────────────────────────────
  // These run without async operations and complete within a single microtask.

  function handleDone(state: Extract<VoiceFormState, { status: 'done' }>): void {
    safeInvokeCallback(config.events?.onDone, state.result)
    if (autoResetTimer !== null) clearTimeout(autoResetTimer)
    autoResetTimer = setTimeout(() => {
      autoResetTimer = null
      if (!destroyed) machine.dispatch({ type: 'AUTO_RESET' })
    }, 500)
    // Arm the cooldown timer. start() will reject new sessions until it fires.
    startCooldownTimer()
  }

  function handleError(state: Extract<VoiceFormState, { status: 'error' }>): void {
    safeInvokeCallback(config.events?.onError, state.error)
    if (state.error.recoverable) {
      if (autoResetTimer !== null) clearTimeout(autoResetTimer)
      autoResetTimer = setTimeout(() => {
        autoResetTimer = null
        if (!destroyed) machine.dispatch({ type: 'AUTO_RESET' })
      }, 3000)
    }
  }

  function handleIdle(event: VoiceFormEvent): void {
    if (event.type === 'CANCEL' && config.events?.onCancel) {
      try {
        config.events.onCancel()
      } catch (err) {
        console.error('[voice-form] Error in onCancel callback:', err)
      }
    }
  }

  // ── 8. State transition handler ──────────────────────────────────────────

  async function handleStateTransition(
    state: VoiceFormState,
    event: VoiceFormEvent,
  ): Promise<void> {
    // Fire developer onStateChange callback
    safeInvokeCallback(config.events?.onStateChange, state)

    switch (state.status) {
      case 'recording':
        // STT was started by start() — nothing more to do here.
        // Interim updates come via STTAdapterEvents.onInterim.
        break

      case 'processing': {
        // Validate transcript before sending to endpoint.
        // For cooldown-blocked transcripts we use a sentinel value.
        const maxLength = config.maxTranscriptLength ?? 2000
        const validation = validateTranscript(state.transcript, maxLength)

        if (!validation.valid) {
          // Release the reentrancy lock before dispatching so the error handler runs.
          handlingTransition = false
          machine.dispatch({
            type: 'PARSE_ERROR',
            error: new VoiceFormErrorImpl(validation.code, validation.message, true),
          })
          return
        }

        let dispatchedFollowUp = false
        try {
          const requestId = crypto.randomUUID()
          const request = {
            transcript: validation.transcript,
            schema: currentSchema,
            requestId,
          }
          const response = await endpointClient.parse(request)

          // Track the timestamp of the last completed request for cooldown.
          _lastRequestTimestamp = Date.now()

          const confirmation = buildConfirmationData(response, validation.transcript, currentSchema, {
            appendMode: config.appendMode ?? false,
            ...(formElementResolved !== undefined ? { formElement: formElementResolved } : {}),
          })

          // Fire onBeforeConfirm with exception detection (NEW-004).
          // Unlike safeInvokeCallback, invokeBeforeConfirm routes exceptions to
          // onError so the developer's error-handling infrastructure is engaged.
          const maybeModified = invokeBeforeConfirm(
            config.events?.onBeforeConfirm,
            confirmation,
            config.events?.onError,
          )

          // Re-sanitize after developer modification (MED-004).
          const sanitized = sanitizeConfirmationData(maybeModified, currentSchema)

          // Release lock before dispatching so the confirming handler runs.
          handlingTransition = false
          dispatchedFollowUp = true
          machine.dispatch({ type: 'PARSE_SUCCESS', response, confirmation: sanitized })
        } catch (err) {
          if (isAbortError(err)) {
            // Already transitioned to idle via CANCEL — nothing to do.
            return
          }
          if (!dispatchedFollowUp) {
            // Release lock before dispatching so the error handler runs.
            handlingTransition = false
            machine.dispatch({ type: 'PARSE_ERROR', error: normalizeError(err) })
          }
        }
        break
      }

      case 'confirming':
        // Wait for user action (confirm/cancel) — no automatic side effects.
        break

      case 'injecting': {
        // Pass ConfirmedField objects directly so the injector can access
        // existingValue for appendMode concatenation without re-reading the DOM.
        // (LLD § 4.6)
        let injectionResult: InjectionResult
        try {
          injectionResult = await injector.inject(state.confirmation.parsedFields)
        } catch {
          injectionResult = { success: false, fields: {} }
        }

        // Release lock before dispatching so the done handler runs.
        handlingTransition = false
        machine.dispatch({ type: 'INJECTION_COMPLETE', result: injectionResult })
        break
      }

      // Synchronous states — handle inline, no async work needed.
      case 'done':
        handleDone(state)
        break

      case 'error':
        handleError(state)
        break

      case 'idle':
        handleIdle(event)
        break
    }
  }

  // ── Subscribe with reentrancy guard ──────────────────────────────────────
  machine.subscribe((state: VoiceFormState, event: VoiceFormEvent) => {
    if (handlingTransition) return
    handlingTransition = true
    handleStateTransition(state, event).finally(() => {
      // Only clear if we didn't already clear it inside the handler
      // (processing and injecting clear it before their follow-up dispatch).
      handlingTransition = false
    })
  })

  // ── STT events object — built once, shared across all start() calls ──────
  //
  // The closures capture `sttEventsActive` and `machine` by reference from the
  // enclosing scope. Both are mutable bindings, so every invocation reads the
  // current value — no need to rebuild the object on each start().
  const sttEvents: STTAdapterEvents = {
    onInterim(transcript: string) {
      if (!sttEventsActive) return
      machine.dispatch({ type: 'STT_INTERIM', transcript })
      safeInvokeCallback(config.events?.onInterimTranscript, transcript)
    },

    onFinal(transcript: string) {
      if (!sttEventsActive) return
      machine.dispatch({ type: 'STT_FINAL', transcript })
    },

    onError(error: Parameters<STTAdapterEvents['onError']>[0]) {
      if (!sttEventsActive) return
      machine.dispatch({ type: 'STT_ERROR', error })
    },

    onEnd() {
      sttEventsActive = false
    },
  }

  // ── Return VoiceFormInstance ──────────────────────────────────────────────

  return {
    getState(): VoiceFormState {
      return machine.getState()
    },

    getParsedFields(): ConfirmationData['parsedFields'] | null {
      const state = machine.getState()
      switch (state.status) {
        case 'confirming':
          return state.confirmation.parsedFields
        case 'injecting':
          return state.confirmation.parsedFields
        case 'done': {
          // Done state has the InjectionResult, not parsedFields.
          // Return null here as the fields have already been injected.
          return null
        }
        default:
          return null
      }
    },

    async start(): Promise<void> {
      if (destroyed) return

      const currentState = machine.getState()

      // Only valid from idle state
      if (currentState.status !== 'idle') return

      // Cooldown guard (HIGH-004)
      // When cooldownActive is true (set in handleDone), reject start() without
      // touching the state machine. We stay in idle and call onError directly so
      // the developer's callback fires reliably without reentrancy guard conflicts.
      if (cooldownActive) {
        safeInvokeCallback(
          config.events?.onError,
          new VoiceFormErrorImpl(
            'COOLDOWN_ACTIVE',
            'Request cooldown is active. Please wait before trying again.',
            true,
          ),
        )
        return
      }

      // Dispatch START to the state machine
      machine.dispatch({ type: 'START' })

      // Check we actually transitioned to recording
      if (machine.getState().status !== 'recording') return

      // Start STT adapter
      sttEventsActive = true

      try {
        await sttAdapter.start(sttEvents)
      } catch (err) {
        sttEventsActive = false
        // If sttAdapter.start() throws, dispatch an STT error
        const sttErr = err as Parameters<STTAdapterEvents['onError']>[0]
        machine.dispatch({ type: 'STT_ERROR', error: sttErr })
      }
    },

    stop(): void {
      if (destroyed) return
      const state = machine.getState()
      if (state.status !== 'recording') return

      sttEventsActive = false
      sttAdapter.stop()
      machine.dispatch({ type: 'CANCEL' })
    },

    cancel(): void {
      if (destroyed) return
      const state = machine.getState()

      if (state.status === 'recording') {
        sttEventsActive = false
        sttAdapter.abort()
        machine.dispatch({ type: 'CANCEL' })
      } else if (state.status === 'processing') {
        endpointClient.abort()
        machine.dispatch({ type: 'CANCEL' })
      } else if (state.status === 'confirming') {
        machine.dispatch({ type: 'CANCEL' })
      } else if (state.status === 'error') {
        machine.dispatch({ type: 'ACKNOWLEDGE_ERROR' })
      }
      // idle, injecting, done — no-op
    },

    async confirm(): Promise<void> {
      if (destroyed) return
      const state = machine.getState()
      if (state.status !== 'confirming') return

      machine.dispatch({ type: 'CONFIRM' })
    },

    /**
     * Replace the active schema. Valid only from idle state.
     * Validates the new schema synchronously; throws VoiceFormConfigError on failure.
     * Clears the injector's element cache.
     * This is the v2 canonical method. updateSchema() is a deprecated alias. (FR-110)
     *
     * @throws {VoiceFormError} INVALID_TRANSITION if not in idle state.
     * @throws {VoiceFormConfigError} SCHEMA_INVALID if schema is invalid.
     */
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

    /**
     * Returns the schema currently in use.
     * Useful for multi-step forms where the developer inspects which schema
     * is active at any point.
     */
    getSchema(): FormSchema {
      return currentSchema
    },

    /**
     * @deprecated Use setSchema() instead. Will be removed in v3.
     *
     * Replace the active schema. This method now delegates to setSchema()
     * and emits a deprecation warning on each call. (FR-110 / LLD § 4.5)
     */
    updateSchema(schema: FormSchema): void {
      console.warn(
        '[voice-form] updateSchema() is deprecated and will be removed in v3. ' +
        'Use setSchema() instead.',
      )
      this.setSchema(schema)
    },

    /**
     * Correct the value of a single field while in confirming state.
     *
     * The value is passed through sanitizeFieldValue before being applied.
     * If sanitization produces an empty string from a non-empty input, the
     * call is a no-op and returns false. (FR-114 / LLD § 4.4)
     *
     * Produces a FIELD_CORRECTED event that replaces ConfirmationData immutably.
     * NEVER mutates state.confirmation in place (security review #1).
     *
     * @param fieldName  The FieldSchema.name of the field to correct.
     * @param value      The corrected string value from the user.
     * @returns true if the correction was applied, false if rejected.
     */
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

      // Reject if sanitization consumed the entire non-empty input (e.g. pure
      // HTML tags stripping to empty). This prevents the user from clearing a
      // field by typing only markup. (LLD § 4.4)
      if (sanitizedValue.trim() === '' && value.trim() !== '') {
        return false
      }

      const existingField = state.confirmation.parsedFields[fieldName]

      // Build new ConfirmationData immutably (security review #1).
      // Use conditional spreads — NEVER mutate state.confirmation in place.
      // exactOptionalPropertyTypes requires omitting optional fields rather
      // than setting them to undefined.
      const correctedField: ConfirmedField = {
        label: existingField?.label ?? fieldDef?.label ?? fieldName,
        value: sanitizedValue,
        ...(existingField?.confidence !== undefined
          ? { confidence: existingField.confidence }
          : {}),
        ...(existingField?.existingValue !== undefined
          ? { existingValue: existingField.existingValue }
          : {}),
        userCorrected: true,
        ...(existingField?.value !== undefined
          ? { originalValue: existingField.value }
          : {}),
      }

      const newParsedFields: Record<string, ConfirmedField> = {
        ...state.confirmation.parsedFields,
        [fieldName]: correctedField,
      }

      const newConfirmation: ConfirmationData = {
        ...state.confirmation,
        parsedFields: newParsedFields,
      }

      machine.dispatch({ type: 'FIELD_CORRECTED', confirmation: newConfirmation })
      return true
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true

      // Release the reentrancy lock. If destroy() is called while an async
      // handler (processing, injecting) is awaiting, handlingTransition stays
      // true on the closed-over variable. Resetting it here ensures any caller
      // that inspects the instance after destroy() sees a consistent state. (N-8)
      handlingTransition = false

      // 1. Stop any active STT session
      sttEventsActive = false
      sttAdapter.abort()

      // 2. Cancel any in-flight endpoint request
      endpointClient.abort()

      // 3. Clear pending auto-reset timer
      if (autoResetTimer !== null) {
        clearTimeout(autoResetTimer)
        autoResetTimer = null
      }

      // 3b. Clear pending cooldown timer so it cannot fire after destroy
      if (cooldownTimerId !== null) {
        clearTimeout(cooldownTimerId)
        cooldownTimerId = null
      }
      cooldownActive = false

      // 4. Destroy the state machine (clears all listeners)
      machine.destroy()

      // 5. Clear injector element cache
      injector.clearCache()
    },

    subscribe(listener: (state: VoiceFormState) => void): () => void {
      return machine.subscribe((state: VoiceFormState) => {
        listener(state)
      })
    },
  }
}
