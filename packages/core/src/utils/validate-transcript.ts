import type { VoiceFormErrorCode } from '../types.js'

// ─── Result type ──────────────────────────────────────────────────────────────

/**
 * The discriminated-union result returned by `validateTranscript`.
 *
 * On success the `transcript` field holds the trimmed string ready for use.
 * On failure `code` is a `VoiceFormErrorCode` and `message` is a
 * human-readable explanation.
 */
export type TranscriptValidationResult =
  | { valid: true; transcript: string }
  | { valid: false; code: VoiceFormErrorCode; message: string }

// ─── Control-character pattern ────────────────────────────────────────────────
//
// Allowed whitespace inside a transcript:
//   0x09  HT  (horizontal tab)
//   0x0A  LF  (line feed / newline)
//   0x0D  CR  (carriage return)
//
// Rejected ASCII control characters:
//   0x00–0x08   NUL … BS
//   0x0B        VT  (vertical tab)
//   0x0C        FF  (form feed)
//   0x0E–0x1F   SO … US
//   0x7F        DEL
//
// Unicode code points above 0x7F are explicitly permitted — accented Latin,
// CJK, emoji, etc. are all valid transcript content.  (CRIT-003)
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/

/**
 * Default maximum transcript length in characters.
 * Aligns with `VoiceFormConfig.maxTranscriptLength` default.  (CRIT-003)
 */
const DEFAULT_MAX_LENGTH = 2000

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validates a raw STT transcript before it is sent to the developer's
 * BYOE endpoint.
 *
 * Checks performed in order:
 * 1. **Empty** — rejects strings that are empty or consist entirely of
 *    whitespace after trimming.
 * 2. **Length** — rejects strings whose `.length` exceeds `maxLength`
 *    (checked on the original, un-trimmed string).
 * 3. **Control characters** — rejects strings containing ASCII control
 *    characters that could be used to manipulate server-side prompt
 *    construction (null bytes, ESC, etc.).  Tab (0x09), LF (0x0A), and
 *    CR (0x0D) are allowed as normal whitespace that may appear in
 *    multi-sentence speech output.
 *
 * On success, returns the **trimmed** transcript so callers receive a
 * clean string without leading/trailing whitespace.
 *
 * @param transcript - The raw transcript string from the STT adapter.
 * @param maxLength  - Maximum allowed character count.  Defaults to 2000.
 * @returns          A `TranscriptValidationResult` discriminated union.
 *
 * @example
 * const result = validateTranscript(transcript, config.maxTranscriptLength)
 * if (!result.valid) {
 *   // surface result.code / result.message to the error state
 * }
 * const clean = result.transcript // trimmed, safe to send
 */
export function validateTranscript(
  transcript: string,
  maxLength: number = DEFAULT_MAX_LENGTH,
): TranscriptValidationResult {
  // 1. Empty / whitespace-only check (trim to detect whitespace-only input).
  if (transcript.trim().length === 0) {
    return {
      valid: false,
      code: 'INVALID_TRANSCRIPT',
      message: 'Transcript is empty',
    }
  }

  // 2. Length check — evaluated on the raw string before trimming so that
  //    a caller cannot bypass the limit by padding with whitespace.
  if (transcript.length > maxLength) {
    return {
      valid: false,
      code: 'TRANSCRIPT_TOO_LONG',
      message: `Transcript exceeds maximum length of ${maxLength} characters`,
    }
  }

  // 3. Control character check.
  if (CONTROL_CHAR_PATTERN.test(transcript)) {
    return {
      valid: false,
      code: 'INVALID_TRANSCRIPT',
      message: 'Transcript contains invalid characters',
    }
  }

  // All checks passed — return the trimmed transcript.
  return { valid: true, transcript: transcript.trim() }
}
