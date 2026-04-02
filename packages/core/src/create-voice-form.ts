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
import { sanitizeFieldValue } from './utils/sanitize.js'
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

// ─── buildConfirmationData ────────────────────────────────────────────────────

/**
 * Converts a ParseResponse into a ConfirmationData object by cross-referencing
 * the schema. Sanitizes each field value via sanitizeFieldValue.
 *
 * Fields in the schema that are absent from the response are placed in
 * missingFields. Fields whose sanitized values fail type constraints are placed
 * in invalidFields (but still included in parsedFields for display).
 */
function buildConfirmationData(
  response: ParseResponse,
  transcript: string,
  schema: FormSchema,
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

    try {
      const result = sanitizeFieldValue(
        raw.value,
        fieldDef.type,
        fieldDef.options as string[] | undefined,
      )
      sanitizedValue = typeof result.value === 'string' ? result.value : String(result.value)
    } catch (err) {
      // Sanitization failure — record as invalid but include the stripped value
      sanitizedValue = raw.value
      invalidFields.push({
        name: fieldDef.name,
        value: raw.value,
        reason: err instanceof Error ? err.message : 'Sanitization failed',
      })
    }

    parsedFields[fieldDef.name] = {
      label,
      value: sanitizedValue,
      ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
    }
  }

  return {
    transcript,
    parsedFields,
    missingFields,
    invalidFields,
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

  for (const [fieldName, confirmedField] of Object.entries(data.parsedFields)) {
    const fieldDef = schema.fields.find((f) => f.name === fieldName)
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
  const resolvedOptions = resolveEndpointOptions(config.endpointOptions)
  const endpointClient = new EndpointClient(config.endpoint, resolvedOptions)

  // ── 5. Create injector ───────────────────────────────────────────────────
  // Resolve the formElement if provided as a CSS selector string.
  let formElementResolved: HTMLElement | undefined
  if (typeof config.formElement === 'string') {
    const found = document.querySelector<HTMLElement>(config.formElement)
    formElementResolved = found ?? undefined
  } else {
    formElementResolved = config.formElement
  }

  let injector: Injector = createInjector({
    ...(formElementResolved !== undefined ? { formElement: formElementResolved } : {}),
  })

  // ── 6. Create state machine ──────────────────────────────────────────────
  const machine: StateMachine = createStateMachine()

  // ── 7. Internal state tracking ───────────────────────────────────────────
  let destroyed = false
  let autoResetTimer: ReturnType<typeof setTimeout> | null = null
  let lastRequestTimestamp = 0
  const cooldownMs = config.requestCooldownMs ?? 3000

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
          lastRequestTimestamp = Date.now()

          const confirmation = buildConfirmationData(response, validation.transcript, currentSchema)

          // Fire onBeforeConfirm with safe exception handling.
          const maybeModified =
            safeInvokeCallback(config.events?.onBeforeConfirm, confirmation) ?? confirmation

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
        const parsedFieldsForInjection: Record<string, ParsedFieldValue> = {}
        for (const [name, field] of Object.entries(state.confirmation.parsedFields)) {
          parsedFieldsForInjection[name] = {
            value: field.value,
            ...(field.confidence !== undefined ? { confidence: field.confidence } : {}),
          }
        }

        let injectionResult: InjectionResult
        try {
          injectionResult = await injector.inject(parsedFieldsForInjection)
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

  // ── Build STT events object ───────────────────────────────────────────────

  function buildSTTEvents(): STTAdapterEvents {
    return {
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
      // Per spec: if within the cooldown window, drop the START event and
      // surface a COOLDOWN_ACTIVE error instead. We do this by going through
      // recording→processing→error so the error state and onError callback fire.
      if (cooldownMs > 0 && lastRequestTimestamp > 0) {
        const elapsed = Date.now() - lastRequestTimestamp
        if (elapsed < cooldownMs) {
          // Drive the machine into error(COOLDOWN_ACTIVE) via the processing path:
          //   idle → START → recording → STT_FINAL → processing → PARSE_ERROR → error
          machine.dispatch({ type: 'START' })
          machine.dispatch({ type: 'STT_FINAL', transcript: '__cooldown__' })
          machine.dispatch({
            type: 'PARSE_ERROR',
            error: new VoiceFormErrorImpl(
              'COOLDOWN_ACTIVE',
              'Request cooldown is active. Please wait before trying again.',
              true,
            ),
          })
          return
        }
      }

      // Dispatch START to the state machine
      machine.dispatch({ type: 'START' })

      // Check we actually transitioned to recording
      if (machine.getState().status !== 'recording') return

      // Start STT adapter
      sttEventsActive = true
      const events = buildSTTEvents()

      try {
        await sttAdapter.start(events)
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

    updateSchema(schema: FormSchema): void {
      if (destroyed) return
      const state = machine.getState()
      if (state.status !== 'idle') {
        throw new VoiceFormErrorImpl(
          'INVALID_TRANSITION',
          'updateSchema() can only be called from the idle state.',
          false,
        )
      }

      currentSchema = validateSchema(schema)
      injector.clearCache()
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true

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
