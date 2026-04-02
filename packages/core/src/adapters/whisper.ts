/**
 * Whisper STT Adapter
 *
 * Implements the `STTAdapter` interface using `MediaRecorder` to capture audio
 * and POST it to a developer-controlled transcription endpoint (BYOE pattern).
 * The endpoint must return `{ transcript: string }`.
 *
 * Security invariants (reviewed and enforced):
 * - `this.aborted = true` is set BEFORE `recorder.stop()` in `abort()`.
 *   (review #3): Prevents stale `onstop`/`ondataavailable` from POSTing after cancel.
 * - `postAbortController.abort()` is called at the TOP of `start()` before creating
 *   a new controller. (review #4): Prevents cross-session Blob leaks where a slow
 *   prior POST could call `onFinal` after the new session has started.
 * - Transcript is type-checked and length-capped before being passed to the state
 *   machine. (review #5): The developer's server is untrusted from this library's POV.
 *
 * Zero npm dependencies. Only imports from the sibling `types.ts` module.
 *
 * Spec: docs/V2_LOW_LEVEL_DESIGN.md § 5. Whisper STT Adapter
 */

import type { STTAdapter, STTAdapterEvents, STTError, STTErrorCode } from '../types.js'

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Configuration for the Whisper STT adapter.
 * The adapter records audio via `MediaRecorder`, assembles a Blob,
 * POSTs to the developer's transcription endpoint, and returns the transcript.
 *
 * The transcription endpoint is always developer-controlled (BYOE pattern).
 * Audio never leaves the developer's infrastructure directly from this library.
 */
export interface WhisperAdapterConfig {
  /**
   * URL of the developer's transcription endpoint.
   * The adapter POSTs raw audio to this URL and expects `{ transcript: string }`.
   * Must be a developer-controlled proxy to OpenAI Whisper or a compatible API.
   */
  transcriptionEndpoint: string

  /**
   * Maximum recording duration in milliseconds before `stop()` is called
   * automatically. Default: 60000 (60 seconds).
   */
  maxDurationMs?: number

  /**
   * Additional HTTP headers sent with the transcription POST request.
   * Use for authentication tokens on the developer's transcription endpoint.
   * NEVER put LLM API keys in browser headers — they belong server-side.
   */
  headers?: Record<string, string>

  /**
   * Request timeout for the transcription POST in milliseconds.
   * Default: 30000 (30 seconds — Whisper inference is slower than streaming STT).
   */
  timeoutMs?: number
}

// ─── MIME type selection ──────────────────────────────────────────────────────

/**
 * Priority order for `MediaRecorder` MIME types.
 * Matches Whisper API compatibility and browser support matrix.
 * The selected type is sent as `Content-Type` on the transcription POST.
 *
 * Spec: LLD § 5.2
 */
const MIME_TYPE_PRIORITY = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm', // fallback without codec hint
] as const

/**
 * Selects the first MIME type in the priority list that `MediaRecorder` supports.
 * Returns an empty string when none are supported — the recorder's default is used.
 */
function selectMimeType(): string {
  for (const mimeType of MIME_TYPE_PRIORITY) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }
  return ''
}

// ─── Error helpers ────────────────────────────────────────────────────────────

/**
 * Creates an `STTError`-conformant `Error` instance with a `code` and optional
 * `originalError`. Uses `Object.defineProperty` to avoid enumerability issues
 * with transpilation targets.
 */
function createSTTError(
  code: STTErrorCode,
  message: string,
  originalError?: unknown,
): STTError {
  const err = new Error(message) as STTError
  Object.defineProperty(err, 'code', { value: code, enumerable: true })
  if (originalError !== undefined) {
    Object.defineProperty(err, 'originalError', { value: originalError, enumerable: true })
  }
  return err
}

/**
 * Converts an unknown thrown value to an `STTError`.
 *
 * Precedence:
 * 1. If the object has a `code` property that is a valid string, it is used directly
 *    (e.g., errors constructed by this module with an explicit code).
 * 2. If the thrown value is a `TypeError` with no `code`, it is treated as a network
 *    failure and mapped to `'NETWORK_ERROR'`. `fetch` throws `TypeError` on network
 *    errors (DNS failure, connection refused, etc.) per the Fetch specification.
 * 3. Everything else falls through to `'UNKNOWN'`.
 */
function toSTTError(err: unknown): STTError {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e['code'] === 'string') {
      const code = e['code'] as STTErrorCode
      const message = typeof e['message'] === 'string' ? e['message'] : String(err)
      return createSTTError(code, message, err)
    }
    // fetch() throws TypeError on network failure (no DNS, connection refused, etc.)
    if (err instanceof TypeError) {
      const message = typeof e['message'] === 'string' ? e['message'] : String(err)
      return createSTTError('NETWORK_ERROR', message, err)
    }
    const message = typeof e['message'] === 'string' ? e['message'] : String(err)
    return createSTTError('UNKNOWN', message, err)
  }
  return createSTTError('UNKNOWN', String(err), err)
}

/**
 * Maps a `getUserMedia` rejection to the appropriate `STTErrorCode`.
 *
 * | DOMException.name            | Code               |
 * |------------------------------|--------------------|
 * | NotAllowedError              | PERMISSION_DENIED  |
 * | PermissionDeniedError        | PERMISSION_DENIED  |
 * | NotFoundError                | AUDIO_CAPTURE_FAILED |
 * | DevicesNotFoundError         | AUDIO_CAPTURE_FAILED |
 * | everything else              | UNKNOWN            |
 */
function resolveGetUserMediaError(err: unknown): STTErrorCode {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'PERMISSION_DENIED'
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'AUDIO_CAPTURE_FAILED'
    }
  }
  return 'UNKNOWN'
}

// ─── WhisperAdapter class ─────────────────────────────────────────────────────

/**
 * Maximum transcript length accepted from the transcription endpoint.
 * Defence-in-depth: the parse endpoint enforces `maxTranscriptLength` separately,
 * but we truncate here before passing to the state machine.
 */
const MAX_TRANSCRIPT_LENGTH = 10_000

/**
 * Whisper STT adapter that records audio with `MediaRecorder`,
 * POSTs the assembled `Blob` to a developer-supplied endpoint,
 * and emits the returned transcript via `STTAdapterEvents.onFinal`.
 *
 * Create one instance per `VoiceFormConfig.sttAdapter` slot.
 * The same instance is reused across sessions — all state is reset
 * at the top of each `start()` call.
 */
export class WhisperAdapter implements STTAdapter {
  /** Resolved config with all defaults applied. */
  private readonly config: Required<Omit<WhisperAdapterConfig, 'headers'>> & {
    headers: Record<string, string> | undefined
  }

  // ─── Per-session state (all nullable so GC can reclaim after each session) ──

  /** Accumulated audio chunks from `ondataavailable`. */
  private chunks: Blob[] = []

  /** Assembled audio `Blob`. Set in `handleRecorderStop`; nulled in `finally`. */
  private audioBlob: Blob | null = null

  /** The active `MediaStream` (OS-level mic lock). Released on every exit path. */
  private mediaStream: MediaStream | null = null

  /** The active `MediaRecorder`. */
  private recorder: MediaRecorder | null = null

  /**
   * Auto-stop timer reference for `maxDurationMs` enforcement.
   * Cleared on every `stop()`/`abort()` call and on `onstop`.
   */
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Abort flag for the current recording session.
   *
   * CRITICAL (security review #3): this flag MUST be set to `true` BEFORE
   * `recorder.stop()` is called inside `abort()`. The `onstop` and
   * `ondataavailable` callbacks check this flag synchronously. If it is not
   * already `true` when those fire, the adapter will assemble a Blob and
   * attempt a POST even though the user cancelled.
   */
  private aborted = false

  /**
   * `AbortController` for the in-flight transcription POST.
   *
   * (security review #4): Replaced at the TOP of each `start()` call, AFTER
   * aborting the prior controller. This cancels any slow in-flight POST from
   * a previous session so stale `onFinal` callbacks cannot fire into the new session.
   */
  private postAbortController: AbortController | null = null

  /** Callbacks for the current session. Nulled after the session ends. */
  private currentEvents: STTAdapterEvents | null = null

  constructor(config: WhisperAdapterConfig) {
    this.config = {
      maxDurationMs: config.maxDurationMs ?? 60_000,
      timeoutMs: config.timeoutMs ?? 30_000,
      transcriptionEndpoint: config.transcriptionEndpoint,
      headers: config.headers,
    }
  }

  // ─── isSupported ─────────────────────────────────────────────────────────

  /**
   * Returns `true` if `MediaRecorder` is available and the browser exposes
   * `navigator.mediaDevices.getUserMedia`. Always `false` in Node.js.
   */
  isSupported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function'
    )
  }

  // ─── start ───────────────────────────────────────────────────────────────

  /**
   * Begin a recording session.
   *
   * Steps (LLD § 5.4):
   * 1. Abort any in-flight POST from a prior session (cross-session safety).
   * 2. Reset all per-session state.
   * 3. Request microphone access via `getUserMedia`.
   * 4. Select the best supported MIME type.
   * 5. Create and configure `MediaRecorder`.
   * 6. Wire `ondataavailable`, `onstop`, and `onerror` handlers.
   * 7. Call `recorder.start(250)` and arm the `maxDurationMs` timer.
   *
   * Resolves immediately after the recorder has started — does not wait for speech.
   *
   * @throws Never — errors are forwarded to `events.onError`.
   */
  async start(events: STTAdapterEvents): Promise<void> {
    // Step 1 — (security review #4): cancel any prior in-flight POST.
    if (this.postAbortController !== null) {
      this.postAbortController.abort()
      this.postAbortController = null
    }

    // Step 2 — reset all session state.
    this.aborted = false
    this.chunks = []
    this.audioBlob = null
    this.currentEvents = events

    // Step 3 — request microphone access.
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const code = resolveGetUserMediaError(err)
      const sttError = createSTTError(
        code,
        err instanceof Error ? err.message : 'Microphone access failed',
        err,
      )
      events.onError(sttError)
      events.onEnd()
      return
    }

    this.mediaStream = stream

    // Step 4 — MIME type selection.
    const mimeType = selectMimeType()
    const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {}

    // Step 5 — create MediaRecorder.
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, recorderOptions)
    } catch (err) {
      this.releaseStream()
      const sttError = createSTTError('UNKNOWN', 'MediaRecorder initialization failed', err)
      events.onError(sttError)
      events.onEnd()
      return
    }

    this.recorder = recorder

    // Step 6 — wire event handlers.
    recorder.ondataavailable = (e: BlobEvent) => {
      // Guard: abort() sets this.aborted = true before stop(); stale events are dropped.
      if (this.aborted) return
      if (e.data.size > 0) {
        this.chunks.push(e.data)
      }
    }

    recorder.onstop = () => {
      // Guard: if aborted, discard all chunks and exit without POSTing.
      if (this.aborted) {
        this.chunks = []
        this.audioBlob = null
        this.recorder = null
        this.releaseStream()
        return
      }
      void this.handleRecorderStop(mimeType || 'audio/webm')
    }

    recorder.onerror = (e: Event) => {
      if (this.aborted) return
      // Extract the underlying error value. The spec uses `MediaRecorderErrorEvent`
      // (with an `.error` DOMException property) but TypeScript's DOM lib types
      // `MediaRecorder.onerror` as `ErrorEvent`. We read `.error` from either shape,
      // falling back to the event object itself if no `.error` property exists.
      const eventAsRecord = e as unknown as Record<string, unknown>
      const originalError =
        'error' in eventAsRecord ? eventAsRecord['error'] : e
      const sttError = createSTTError('UNKNOWN', 'MediaRecorder error', originalError)
      this.currentEvents?.onError(sttError)
      this.cleanup()
      this.currentEvents?.onEnd()
      this.currentEvents = null
    }

    // Step 7 — start recording with 250ms timeslice; arm auto-stop timer.
    recorder.start(250)

    this.maxDurationTimer = setTimeout(() => {
      if (this.recorder?.state === 'recording') {
        this.stop()
      }
    }, this.config.maxDurationMs)
  }

  // ─── stop ────────────────────────────────────────────────────────────────

  /**
   * Stops the recording gracefully. The `onstop` handler fires after the
   * last `ondataavailable` event, assembles the `Blob`, and POSTs it.
   * `onFinal` is called with the transcript; `onEnd` follows.
   *
   * No-op if not currently recording.
   */
  stop(): void {
    if (this.maxDurationTimer !== null) {
      clearTimeout(this.maxDurationTimer)
      this.maxDurationTimer = null
    }
    // aborted is false here — the onstop handler will fire the POST.
    if (this.recorder?.state === 'recording') {
      this.recorder.stop()
    }
  }

  // ─── abort ───────────────────────────────────────────────────────────────

  /**
   * Cancels the current recording session without producing a transcript.
   *
   * CRITICAL (security review #3): `this.aborted = true` MUST be set BEFORE
   * `recorder.stop()`. The browser fires `ondataavailable` and `onstop`
   * synchronously or in a microtask after `stop()`. If `aborted` is not already
   * `true` when those fire, the adapter will assemble a Blob and attempt a POST.
   *
   * Calls `events.onEnd`. Does NOT call `events.onFinal`.
   */
  abort(): void {
    // CRITICAL: set flag FIRST, before any recorder interaction.
    this.aborted = true

    if (this.maxDurationTimer !== null) {
      clearTimeout(this.maxDurationTimer)
      this.maxDurationTimer = null
    }

    // Stop the recorder AFTER setting the abort flag.
    if (this.recorder?.state === 'recording') {
      this.recorder.stop()
    }

    // Discard all collected audio data immediately.
    this.chunks = []
    this.audioBlob = null
    this.recorder = null

    // Cancel any in-flight POST from a slow prior stop() (security review #4).
    this.postAbortController?.abort()
    this.postAbortController = null

    this.releaseStream()
    this.currentEvents?.onEnd()
    this.currentEvents = null
  }

  // ─── handleRecorderStop (private) ────────────────────────────────────────

  /**
   * Invoked by `recorder.onstop` when the recording completes normally
   * (i.e., `this.aborted` is false). Assembles the audio `Blob` from collected
   * chunks, POSTs it to the transcription endpoint, validates the response,
   * and calls `onFinal` or `onError` accordingly.
   *
   * The `audioBlob` reference is nulled in the `finally` block regardless of
   * success or failure (security review PERF 2.7).
   */
  private async handleRecorderStop(mimeType: string): Promise<void> {
    // Assemble Blob from collected chunks.
    this.audioBlob = new Blob(this.chunks, { type: mimeType })

    // Clear chunk array immediately — individual chunk Blobs can be GC'd while
    // the assembled Blob is in-flight.
    this.chunks = []

    this.postAbortController = new AbortController()
    const timeoutId = setTimeout(() => {
      this.postAbortController?.abort()
    }, this.config.timeoutMs)

    const events = this.currentEvents
    if (!events) {
      this.cleanup()
      return
    }

    try {
      const response = await fetch(this.config.transcriptionEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          'X-VoiceForm-Request': '1',
          ...(this.config.headers ?? {}),
        },
        body: this.audioBlob,
        signal: this.postAbortController.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw Object.assign(
          new Error(`Transcription endpoint returned HTTP ${response.status}`),
          { code: 'NETWORK_ERROR' as STTErrorCode, httpStatus: response.status },
        )
      }

      let json: unknown
      try {
        json = await response.json()
      } catch {
        throw Object.assign(new Error('Transcription endpoint returned invalid JSON'), {
          code: 'UNKNOWN' as STTErrorCode,
        })
      }

      // (security review #5): Validate the transcript field type and enforce max length.
      // The transcript arrives from the developer's server, which is untrusted from
      // this library's perspective.
      const raw = (json as Record<string, unknown>)['transcript']
      if (typeof raw !== 'string') {
        throw Object.assign(
          new Error(
            'Transcription endpoint response missing "transcript" string field. ' +
              `Received: ${JSON.stringify(raw)?.slice(0, 100)}`,
          ),
          { code: 'UNKNOWN' as STTErrorCode },
        )
      }

      // Truncate to MAX_TRANSCRIPT_LENGTH as a defence-in-depth measure.
      const transcript =
        raw.length > MAX_TRANSCRIPT_LENGTH ? raw.slice(0, MAX_TRANSCRIPT_LENGTH) : raw

      events.onFinal(transcript)
    } catch (err) {
      clearTimeout(timeoutId)

      // AbortError means the request was timed out or deliberately aborted.
      // We still call onEnd below, but we do not surface an error to the caller
      // when the abort was intentional (postAbortController.abort() from abort()).
      const isAbortError =
        err !== null &&
        typeof err === 'object' &&
        (err as { name?: unknown }).name === 'AbortError'

      if (!isAbortError) {
        const sttErr = toSTTError(err)
        events.onError(sttErr)
      }
    } finally {
      // (PERF 2.7): Dereference Blob after POST completes so the GC can reclaim it.
      this.audioBlob = null
      this.postAbortController = null
      this.recorder = null
      this.releaseStream()
      events.onEnd()
      this.currentEvents = null
    }
  }

  // ─── releaseStream / cleanup (private) ───────────────────────────────────

  /**
   * Releases the OS-level microphone lock by stopping all tracks on the
   * active `MediaStream`.
   */
  private releaseStream(): void {
    this.mediaStream?.getTracks().forEach((t) => t.stop())
    this.mediaStream = null
  }

  /**
   * Discards all in-flight audio data and releases the stream.
   * Used on error paths where the recorder has already been stopped.
   */
  private cleanup(): void {
    this.chunks = []
    this.audioBlob = null
    this.recorder = null
    this.releaseStream()
  }
}

// ─── Factory function ─────────────────────────────────────────────────────────

/**
 * Creates a new Whisper STT adapter instance.
 *
 * The adapter captures audio via `MediaRecorder` and POSTs it to the
 * developer's `transcriptionEndpoint`. The endpoint must return
 * `{ transcript: string }`.
 *
 * Pass the returned adapter to `VoiceFormConfig.sttAdapter` to use it
 * instead of the default Web Speech API adapter.
 *
 * @example
 * ```typescript
 * const adapter = createWhisperAdapter({
 *   transcriptionEndpoint: '/api/transcribe',
 *   headers: { Authorization: `Bearer ${token}` },
 * })
 * if (!adapter.isSupported()) {
 *   console.warn('MediaRecorder is not available in this browser')
 * }
 * const instance = createVoiceForm({
 *   endpoint: '/api/parse',
 *   schema: mySchema,
 *   sttAdapter: adapter,
 * })
 * ```
 */
export function createWhisperAdapter(config: WhisperAdapterConfig): STTAdapter {
  return new WhisperAdapter(config)
}
