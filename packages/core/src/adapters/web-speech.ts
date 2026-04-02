/**
 * Web Speech API STT Adapter
 *
 * Implements the `STTAdapter` interface using the browser's built-in
 * `SpeechRecognition` / `webkitSpeechRecognition` API.
 *
 * Design constraints enforced here (P1-03 / P1-NEW-11):
 * - A **single** `onresult` handler covers both interim and final branches.
 * - The handler iterates from `event.resultIndex` — never from 0.
 * - `Array.from()` is never used on `event.results`.
 * - The handler is assigned exactly once; it is never conditionally overwritten.
 *
 * Zero npm dependencies. Only imports from the sibling `types.ts` module.
 */

import type { STTAdapter, STTAdapterEvents, STTError, STTErrorCode } from '../types.js'

// ─── STTError concrete class ─────────────────────────────────────────────────

/**
 * Concrete implementation of the `STTError` interface.
 * Extends `Error` so stack traces are available.
 */
class SpeechAdapterError extends Error implements STTError {
  readonly code: STTErrorCode
  readonly originalError?: unknown

  constructor(code: STTErrorCode, message: string, originalError?: unknown) {
    super(message)
    this.name = 'STTError'
    this.code = code
    this.originalError = originalError

    // Restore prototype chain for `instanceof` checks across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─── Error code mapping ───────────────────────────────────────────────────────

/**
 * Maps a raw `SpeechRecognitionErrorEvent.error` string to a typed
 * `STTErrorCode`. Unknown codes fall through to `'UNKNOWN'`.
 *
 * Spec: docs/LOW_LEVEL_DESIGN.md § 4a — error mapping table.
 */
function mapSpeechErrorCode(error: string): STTErrorCode {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'PERMISSION_DENIED'
    case 'network':
      return 'NETWORK_ERROR'
    case 'no-speech':
      return 'NO_SPEECH'
    case 'audio-capture':
      return 'AUDIO_CAPTURE_FAILED'
    case 'aborted':
      return 'ABORTED'
    default:
      return 'UNKNOWN'
  }
}

// ─── Adapter factory ─────────────────────────────────────────────────────────

/**
 * Creates a new Web Speech API STT adapter instance.
 *
 * The adapter is stateful — call `start()` once per recording session.
 * After the session ends (via `stop()`, `abort()`, or natural completion),
 * create a fresh adapter for the next session.
 *
 * @returns An `STTAdapter` backed by `SpeechRecognition` / `webkitSpeechRecognition`.
 *
 * @example
 * const adapter = createWebSpeechAdapter()
 * if (!adapter.isSupported()) {
 *   showUnsupportedMessage()
 *   return
 * }
 * await adapter.start({
 *   onInterim: (t) => updatePreview(t),
 *   onFinal:   (t) => processTranscript(t),
 *   onError:   (e) => handleError(e),
 *   onEnd:     ()  => setIdle(),
 * })
 */
export function createWebSpeechAdapter(): STTAdapter {
  /** The active `SpeechRecognition` instance, or null if not yet started. */
  let recognition: SpeechRecognition | null = null

  /**
   * Set to `true` once a final transcript is emitted.
   * Prevents the `onend` fallback from emitting a spurious `onFinal("")`
   * when a real result was already delivered.
   *
   * Also set to `true` by `abort()` to suppress the silence-fallback that
   * would otherwise fire after the browser raises `onend` post-abort.
   */
  let finalCalled = false

  // ─── isSupported ──────────────────────────────────────────────────────────

  function isSupported(): boolean {
    if (typeof window === 'undefined') return false
    const w = window as Window & typeof globalThis & {
      SpeechRecognition?: typeof SpeechRecognition
      webkitSpeechRecognition?: typeof SpeechRecognition
    }
    return w.SpeechRecognition != null || w.webkitSpeechRecognition != null
  }

  // ─── start ────────────────────────────────────────────────────────────────

  /**
   * Begin a recording session.
   *
   * Steps (per spec § 4a `start()` implementation):
   * 1. Resolve the `SpeechRecognition` constructor (with webkit fallback).
   * 2. Create an instance and configure properties.
   * 3. Wire a **single** `onresult` handler using `event.resultIndex`.
   * 4. Wire `onerror` with code mapping; swallow `aborted` errors.
   * 5. Wire `onend`; emit `onFinal("")` if no final was received.
   * 6. Call `recognition.start()` and resolve immediately.
   */
  async function start(events: STTAdapterEvents): Promise<void> {
    // Step 1 — resolve constructor
    const SpeechRecognitionCtor =
      (window as Window & typeof globalThis & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
      (window as Window & typeof globalThis & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition

    if (SpeechRecognitionCtor == null) {
      const err = new SpeechAdapterError(
        'NOT_SUPPORTED',
        'SpeechRecognition is not available in this browser.',
      )
      events.onError(err)
      return
    }

    // Step 2 — create and configure
    finalCalled = false
    recognition = new SpeechRecognitionCtor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = navigator.language

    // Step 3 — single onresult handler (P1-NEW-11: no Array.from, no double-assign)
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result == null) continue

        if (result.isFinal) {
          finalCalled = true
          events.onFinal(result[0]!.transcript.trim())
        } else {
          events.onInterim(result[0]!.transcript)
        }
      }
    }

    // Step 4 — onerror handler with code mapping
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = mapSpeechErrorCode(event.error)

      // Intentional aborts must not propagate as errors (spec § 4a `abort()`)
      if (code === 'ABORTED') {
        return
      }

      // Mark as handled so onend doesn't emit a stale onFinal('') after the
      // error has already transitioned the state machine.
      finalCalled = true

      const err = new SpeechAdapterError(
        code,
        `SpeechRecognition error: ${event.error}`,
        event,
      )
      events.onError(err)
    }

    // Step 5 — onend handler
    recognition.onend = () => {
      if (!finalCalled) {
        events.onFinal('')
      }
      events.onEnd()
    }

    // Step 6 — start and resolve immediately
    recognition.start()
  }

  // ─── stop ────────────────────────────────────────────────────────────────

  /**
   * Stop listening gracefully. The browser will produce a final result
   * (if any speech was captured) and then fire `onend`.
   */
  function stop(): void {
    recognition?.stop()
  }

  // ─── abort ───────────────────────────────────────────────────────────────

  /**
   * Cancel the recording session immediately without producing a transcript.
   *
   * Sets `finalCalled = true` to suppress the silence-fallback `onFinal("")`
   * that `onend` would otherwise emit. The `aborted` error from `onerror`
   * is silently swallowed (see the `onerror` handler above).
   */
  function abort(): void {
    if (recognition == null) return
    finalCalled = true
    recognition.abort()
  }

  return { isSupported, start, stop, abort }
}
