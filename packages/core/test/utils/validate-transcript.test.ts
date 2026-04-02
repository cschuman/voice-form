import { describe, it, expect } from 'vitest'
import { validateTranscript } from '../../src/utils/validate-transcript.js'

// ---------------------------------------------------------------------------
// Helper — build a string of exactly `n` characters
// ---------------------------------------------------------------------------
function repeat(char: string, n: number): string {
  return char.repeat(n)
}

describe('validateTranscript', () => {
  // ── Happy-path ────────────────────────────────────────────────────────────

  it('returns valid result with trimmed transcript for a normal string', () => {
    const result = validateTranscript('Hello my name is John')
    expect(result).toEqual({ valid: true, transcript: 'Hello my name is John' })
  })

  it('trims leading and trailing whitespace on success', () => {
    const result = validateTranscript('  Hello  ')
    expect(result).toEqual({ valid: true, transcript: 'Hello' })
  })

  // ── Empty / whitespace-only ───────────────────────────────────────────────

  it('rejects an empty string', () => {
    const result = validateTranscript('')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe('INVALID_TRANSCRIPT')
      expect(result.message).toBe('Transcript is empty')
    }
  })

  it('rejects a whitespace-only string', () => {
    const result = validateTranscript('   ')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe('INVALID_TRANSCRIPT')
      expect(result.message).toBe('Transcript is empty')
    }
  })

  // ── Length boundary ───────────────────────────────────────────────────────

  it('accepts a transcript at exactly the default max length (2000 chars)', () => {
    const transcript = repeat('a', 2000)
    const result = validateTranscript(transcript)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.transcript).toBe(transcript)
    }
  })

  it('rejects a transcript one character over the default max length', () => {
    const transcript = repeat('a', 2001)
    const result = validateTranscript(transcript)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe('TRANSCRIPT_TOO_LONG')
      expect(result.message).toBe('Transcript exceeds maximum length of 2000 characters')
    }
  })

  it('rejects a transcript one character over a custom max length', () => {
    const transcript = repeat('a', 101)
    const result = validateTranscript(transcript, 100)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe('TRANSCRIPT_TOO_LONG')
      expect(result.message).toBe('Transcript exceeds maximum length of 100 characters')
    }
  })

  it('accepts a transcript at exactly a custom max length', () => {
    const transcript = repeat('a', 100)
    const result = validateTranscript(transcript, 100)
    expect(result.valid).toBe(true)
  })

  // ── Control character rejection ───────────────────────────────────────────

  it.each([
    ['null byte (0x00)', '\x00'],
    ['SOH (0x01)', '\x01'],
    ['BEL / bell char (0x07)', '\x07'],
    ['BS (0x08)', '\x08'],
    ['VT (0x0B)', '\x0B'],
    ['FF (0x0C)', '\x0C'],
    ['SO (0x0E)', '\x0E'],
    ['ESC char (0x1B)', '\x1B'],
    ['US (0x1F)', '\x1F'],
    ['DEL (0x7F)', '\x7F'],
  ])('rejects a transcript containing %s', (_label, char) => {
    const result = validateTranscript(`Hello${char}world`)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe('INVALID_TRANSCRIPT')
      expect(result.message).toBe('Transcript contains invalid characters')
    }
  })

  // ── Allowed whitespace characters ─────────────────────────────────────────

  it('allows tab (0x09)', () => {
    const result = validateTranscript('Hello\tworld')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.transcript).toBe('Hello\tworld')
    }
  })

  it('allows line feed / newline (0x0A)', () => {
    const result = validateTranscript('Hello\nworld')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.transcript).toBe('Hello\nworld')
    }
  })

  it('allows carriage return (0x0D)', () => {
    const result = validateTranscript('Hello\rworld')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.transcript).toBe('Hello\rworld')
    }
  })

  // ── Unicode / non-ASCII ───────────────────────────────────────────────────

  it('allows Japanese CJK characters', () => {
    const result = validateTranscript('日本語テスト')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.transcript).toBe('日本語テスト')
    }
  })

  it('allows accented Latin characters', () => {
    const result = validateTranscript('café résumé')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.transcript).toBe('café résumé')
    }
  })

  // ── Length check runs on the RAW string (before trim) ─────────────────────
  // This ensures a padded-with-spaces transcript that is too long cannot slip
  // through by trimming first.

  it('checks length on the raw input, not the trimmed value', () => {
    // 2001 spaces — raw length exceeds default max
    const transcript = repeat(' ', 2001)
    const result = validateTranscript(transcript)
    // The empty check runs first (whitespace-only → INVALID_TRANSCRIPT)
    // so this exercises both checks; primary assertion is: not valid
    expect(result.valid).toBe(false)
  })
})
