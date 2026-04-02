/**
 * @voiceform/core — Endpoint Client
 *
 * HTTP client responsible for sending ParseRequest payloads to the
 * developer's BYOE (Bring Your Own Endpoint) URL and validating the
 * ParseResponse that comes back.
 *
 * Security notes:
 *   - Every request includes `X-VoiceForm-Request: 1` as a CSRF mitigation
 *     marker. Cross-origin requests with custom headers trigger a CORS
 *     preflight, giving the server an opportunity to reject them. (HIGH-001)
 *   - LLM-returned field values are preserved as-is through this layer;
 *     sanitization is applied by the caller (state machine) before use. (CRIT-001)
 *
 * Spec: docs/LOW_LEVEL_DESIGN.md § 4c
 */

import type {
  ParseRequest,
  ParseResponse,
  ParsedFieldValue,
  EndpointErrorCode,
  EndpointOptions,
} from './types.js'

// ─── Concrete Error Class ─────────────────────────────────────────────────────

/**
 * Debug information attached to an EndpointError.
 *
 * WARNING: `rawBody` may contain LLM output — never render it as HTML.
 */
export interface EndpointErrorDebugInfo {
  /** HTTP status code from the endpoint response, when applicable. */
  httpStatus?: number
  /**
   * Raw response body from the endpoint, truncated to 500 characters.
   * (BRD FR-011)
   */
  rawBody?: string
  /** Unix timestamp (ms) when the error was created. */
  timestamp: number
}

/**
 * Concrete throwable error produced by the endpoint client.
 *
 * `EndpointErrorCode` values map to the `VoiceFormErrorCode` surface used
 * by the state machine:
 *   - `HTTP_ERROR`             → ENDPOINT_ERROR
 *   - `NETWORK_ERROR`          → ENDPOINT_ERROR
 *   - `TIMEOUT`                → ENDPOINT_TIMEOUT
 *   - `INVALID_JSON`           → INVALID_RESPONSE
 *   - `INVALID_RESPONSE_SHAPE` → INVALID_RESPONSE
 *   - `ABORTED`                → treated as cancel (→ idle), not error state
 */
export class EndpointError extends Error {
  /** Machine-readable classification of the failure. */
  readonly code: EndpointErrorCode
  /** HTTP status code when available (set for HTTP_ERROR). */
  readonly httpStatus: number | undefined
  /** Structured debug context attached to this error. */
  readonly debugInfo: EndpointErrorDebugInfo | undefined

  constructor(
    code: EndpointErrorCode,
    message: string,
    httpStatus?: number,
    debugInfo?: EndpointErrorDebugInfo,
  ) {
    super(message)
    this.name = 'EndpointError'
    this.code = code
    this.httpStatus = httpStatus
    this.debugInfo = debugInfo
  }
}

// ─── Response Validation ──────────────────────────────────────────────────────

/**
 * Runtime shape validator for the ParseResponse contract.
 *
 * Returns `true` only if `data` conforms to the full ParseResponse shape:
 * - Top-level `fields` is a non-null object
 * - Each entry has a `value: string` property
 * - Each entry's optional `confidence` property, if present, is a number
 *
 * @param data - The parsed JSON value to validate.
 */
function validateParseResponse(data: unknown): data is ParseResponse {
  if (typeof data !== 'object' || data === null) return false

  const d = data as Record<string, unknown>
  if (typeof d['fields'] !== 'object' || d['fields'] === null) return false

  for (const [key, val] of Object.entries(d['fields'] as object)) {
    if (typeof key !== 'string') return false
    if (typeof val !== 'object' || val === null) return false

    const v = val as Record<string, unknown>
    if (typeof v['value'] !== 'string') return false
    if ('confidence' in v && typeof v['confidence'] !== 'number') return false
  }

  return true
}

// ─── Required Options ─────────────────────────────────────────────────────────

/**
 * The fully-resolved endpoint options used internally.
 * All fields are required after defaults are applied.
 */
export interface ResolvedEndpointOptions {
  /** Request timeout in milliseconds. */
  timeoutMs: number
  /** Maximum number of retry attempts on 5xx or network error. */
  retries: number
  /** Extra headers merged into every request after the library's own headers. */
  headers: Record<string, string>
}

/** Default values for EndpointOptions when not specified by the caller. */
const OPTION_DEFAULTS: ResolvedEndpointOptions = {
  timeoutMs: 10_000,
  retries: 1,
  headers: {},
}

/**
 * Merge caller-supplied EndpointOptions with defaults.
 *
 * @param options - Partial options from the caller.
 */
export function resolveEndpointOptions(options?: EndpointOptions): ResolvedEndpointOptions {
  return {
    timeoutMs: options?.timeoutMs ?? OPTION_DEFAULTS.timeoutMs,
    retries: options?.retries ?? OPTION_DEFAULTS.retries,
    headers: options?.headers ?? OPTION_DEFAULTS.headers,
  }
}

// ─── Default Headers ──────────────────────────────────────────────────────────

/**
 * Headers included in every outgoing request, before any caller-supplied
 * headers are merged in.
 *
 * `X-VoiceForm-Request: 1` is a CSRF mitigation marker. (HIGH-001)
 */
const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-VoiceForm-Request': '1',
}

// ─── Raw-Body Truncation ──────────────────────────────────────────────────────

/** Maximum length of `debugInfo.rawBody`. (BRD FR-011) */
const RAW_BODY_MAX_LENGTH = 500

/** Backoff delay (ms) between retry attempts. */
const RETRY_BACKOFF_MS = 500

/**
 * Safely read the response body as text and truncate it to
 * `RAW_BODY_MAX_LENGTH` characters for use in `debugInfo.rawBody`.
 *
 * Returns an empty string if the body cannot be read (e.g., already consumed).
 */
async function readTruncatedBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, RAW_BODY_MAX_LENGTH)
  } catch {
    return ''
  }
}

// ─── Endpoint Client ──────────────────────────────────────────────────────────

/**
 * HTTP client for the voice-form BYOE endpoint integration.
 *
 * Handles:
 * - Sending a typed ParseRequest as a JSON POST
 * - Timeout via AbortController
 * - Retry on 5xx responses or network errors (not 4xx, not shape errors)
 * - Runtime validation of the ParseResponse shape
 * - Aborting in-flight requests and pending retry timers on cancel
 *
 * @example
 * const client = new EndpointClient(
 *   'https://api.example.com/parse',
 *   resolveEndpointOptions(config.endpointOptions),
 * )
 * const response = await client.parse(request)
 * // Later, during a cancel flow:
 * client.abort()
 */
export class EndpointClient {
  /** The AbortController for the currently in-flight fetch, or null. */
  private activeController: AbortController | null = null
  /** Timer ID for the retry backoff setTimeout, or null. */
  private retryTimerId: ReturnType<typeof setTimeout> | null = null
  /** Timer ID for the request timeout setTimeout, or null. */
  private timeoutId: ReturnType<typeof setTimeout> | null = null
  /**
   * Set to true when `abort()` is called so the catch block can distinguish
   * a manual abort from a timeout-triggered abort.
   */
  private manuallyAborted = false
  /**
   * The reject function for the outermost `parse()` promise.
   * Stored so `abort()` can settle the promise during the retry backoff window,
   * when no fetch is in flight but a retry timer is pending. (PERF 2.3)
   */
  private pendingReject: ((reason: EndpointError) => void) | null = null

  /**
   * @param url     - The BYOE endpoint URL to POST to.
   * @param options - Fully-resolved endpoint options.
   */
  constructor(
    private readonly url: string,
    private readonly options: ResolvedEndpointOptions,
  ) {}

  /**
   * Send a ParseRequest to the configured endpoint and return a validated
   * ParseResponse.
   *
   * Retry behaviour:
   * - Retries up to `options.retries` times on 5xx responses or network errors.
   * - Does NOT retry on 4xx responses or shape-validation failures.
   * - Each retry is scheduled via a 500ms backoff timer.
   *
   * @param request - The fully-constructed ParseRequest to send.
   * @throws {EndpointError} with code `ABORTED`                — manual abort
   * @throws {EndpointError} with code `TIMEOUT`                — timeout expired
   * @throws {EndpointError} with code `NETWORK_ERROR`          — fetch threw
   * @throws {EndpointError} with code `HTTP_ERROR`             — non-2xx response
   * @throws {EndpointError} with code `INVALID_JSON`           — body not JSON
   * @throws {EndpointError} with code `INVALID_RESPONSE_SHAPE` — shape mismatch
   */
  async parse(request: ParseRequest): Promise<ParseResponse> {
    return new Promise<ParseResponse>((resolve, reject) => {
      // Store the reject so abort() can settle the promise at any time —
      // even during the backoff window when no fetch is in flight.
      this.pendingReject = reject
      this._attempt(request, this.options.retries, resolve, reject)
    })
  }

  /**
   * Attempt the fetch once. On retriable failure, schedule a retry via
   * `retryTimerId` and decrement the remaining retry counter.
   *
   * @param request          - The ParseRequest to send.
   * @param retriesRemaining - Number of retries still allowed after this attempt.
   * @param resolve          - The outermost Promise resolve function.
   * @param reject           - The outermost Promise reject function.
   */
  private _attempt(
    request: ParseRequest,
    retriesRemaining: number,
    resolve: (value: ParseResponse) => void,
    reject: (reason: EndpointError) => void,
  ): void {
    const controller = new AbortController()
    this.activeController = controller
    this.manuallyAborted = false

    // --- Timeout timer ---
    this.timeoutId = setTimeout(() => {
      this.timeoutId = null
      controller.abort()
    }, this.options.timeoutMs)

    const headers: Record<string, string> = {
      ...DEFAULT_HEADERS,
      ...this.options.headers,
    }

    fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    })
      .then(async (response) => {
        // Clear the timeout — we got a response
        if (this.timeoutId !== null) {
          clearTimeout(this.timeoutId)
          this.timeoutId = null
        }
        this.activeController = null

        if (!response.ok) {
          const rawBody = await readTruncatedBody(response)
          const is5xx = response.status >= 500

          const error = new EndpointError(
            'HTTP_ERROR',
            `Endpoint returned HTTP ${response.status}`,
            response.status,
            {
              httpStatus: response.status,
              rawBody,
              timestamp: Date.now(),
            },
          )

          if (is5xx && retriesRemaining > 0) {
            this._scheduleRetry(request, retriesRemaining - 1, resolve, reject)
          } else {
            this.pendingReject = null
            reject(error)
          }
          return
        }

        // Parse JSON
        let parsed: unknown
        try {
          parsed = await response.json()
        } catch {
          this.pendingReject = null
          reject(
            new EndpointError('INVALID_JSON', 'Response body is not valid JSON', undefined, {
              timestamp: Date.now(),
            }),
          )
          return
        }

        // Validate shape
        if (!validateParseResponse(parsed)) {
          this.pendingReject = null
          reject(
            new EndpointError(
              'INVALID_RESPONSE_SHAPE',
              'Response body does not match ParseResponse contract',
              undefined,
              { timestamp: Date.now() },
            ),
          )
          return
        }

        // Build a clean copy of fields from the validated response.
        // The caller (state machine layer) applies sanitization before display.
        const sanitizedFields: Record<string, ParsedFieldValue> = {}
        for (const [key, fieldValue] of Object.entries(parsed.fields)) {
          sanitizedFields[key] = {
            value: fieldValue.value,
            ...(fieldValue.confidence !== undefined
              ? { confidence: fieldValue.confidence }
              : {}),
          }
        }

        this.pendingReject = null
        resolve({
          ...parsed,
          fields: sanitizedFields,
        })
      })
      .catch((fetchError: unknown) => {
        // Clear the timeout timer if it's still pending
        if (this.timeoutId !== null) {
          clearTimeout(this.timeoutId)
          this.timeoutId = null
        }
        this.activeController = null

        // Distinguish manual abort from timeout-triggered abort.
        // DOMException may not extend Error in all environments, so check
        // `.name` on any object-like value rather than relying on instanceof.
        const isAbortError =
          (fetchError !== null &&
            typeof fetchError === 'object' &&
            'name' in fetchError &&
            (fetchError as { name: unknown }).name === 'AbortError') ||
          (fetchError instanceof Error && fetchError.name === 'AbortError')

        if (isAbortError) {
          if (this.manuallyAborted) {
            this.pendingReject = null
            reject(
              new EndpointError('ABORTED', 'Request was manually aborted', undefined, {
                timestamp: Date.now(),
              }),
            )
          } else {
            this.pendingReject = null
            reject(
              new EndpointError(
                'TIMEOUT',
                `Request timed out after ${this.options.timeoutMs}ms`,
                undefined,
                { timestamp: Date.now() },
              ),
            )
          }
          return
        }

        // Network failure
        const networkError = new EndpointError(
          'NETWORK_ERROR',
          fetchError instanceof Error ? fetchError.message : 'Network request failed',
          undefined,
          { timestamp: Date.now() },
        )

        if (retriesRemaining > 0) {
          this._scheduleRetry(request, retriesRemaining - 1, resolve, reject)
        } else {
          this.pendingReject = null
          reject(networkError)
        }
      })
  }

  /**
   * Schedule a retry attempt after a 500ms backoff.
   *
   * The timer ID is stored in `this.retryTimerId` so that `abort()` can
   * cancel it — preventing spurious network requests after a cancel. (PERF 2.3)
   *
   * @param request          - The ParseRequest to retry.
   * @param retriesRemaining - Remaining retries after this scheduled attempt.
   * @param resolve          - The outer Promise resolve.
   * @param reject           - The outer Promise reject.
   */
  private _scheduleRetry(
    request: ParseRequest,
    retriesRemaining: number,
    resolve: (value: ParseResponse) => void,
    reject: (reason: EndpointError) => void,
  ): void {
    this.retryTimerId = setTimeout(() => {
      this.retryTimerId = null
      this._attempt(request, retriesRemaining, resolve, reject)
    }, RETRY_BACKOFF_MS)
  }

  /**
   * Abort the currently in-flight request, any pending retry timer, and any
   * pending timeout timer.
   *
   * After this call:
   * - The in-flight fetch (if any) rejects with an `AbortError`, which is
   *   caught and re-thrown as `EndpointError(ABORTED)`.
   * - If called during the retry backoff window (no fetch in flight), the
   *   pending `parse()` promise is rejected immediately with `ABORTED`.
   * - No retry will fire.
   *
   * Calling this when no request is in flight is a safe no-op. (PERF 2.3, 5.3)
   */
  abort(): void {
    // Cancel any pending retry backoff timer
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId)
      this.retryTimerId = null
    }
    // Cancel any pending timeout timer
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
    // If a fetch is in flight, signal it to abort
    if (this.activeController !== null) {
      this.manuallyAborted = true
      this.activeController.abort()
      this.activeController = null
      // The catch block in _attempt will call pendingReject with ABORTED
      return
    }
    // If we're between requests (backoff window), settle the pending promise now
    if (this.pendingReject !== null) {
      const reject = this.pendingReject
      this.pendingReject = null
      reject(
        new EndpointError('ABORTED', 'Request was manually aborted during retry backoff', undefined, {
          timestamp: Date.now(),
        }),
      )
    }
  }
}
