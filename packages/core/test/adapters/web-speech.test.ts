// @vitest-environment jsdom
/**
 * Unit tests for the Web Speech API STT adapter.
 *
 * Strategy: replace `window.SpeechRecognition` with a controllable mock class
 * before each test. The mock captures the event handlers assigned by the
 * adapter so tests can fire them synchronously and assert on the results.
 *
 * Environment: jsdom (configured in vitest.config.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { STTAdapterEvents } from '../../src/types.js'
import { createWebSpeechAdapter } from '../../src/adapters/web-speech.js'

// ─── Mock SpeechRecognition ───────────────────────────────────────────────────

/**
 * A minimal, synchronous stand-in for the browser's SpeechRecognition class.
 * The adapter assigns handlers to `.onresult`, `.onerror`, and `.onend`
 * directly — so we expose those as mutable properties here.
 */
class MockSpeechRecognition {
  continuous = false
  interimResults = false
  lang = ''

  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()

  onresult: ((e: SpeechRecognitionEvent) => void) | null = null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null = null
  onend: (() => void) | null = null
}

/**
 * Build a synthetic `SpeechRecognitionEvent` for a list of result entries.
 * `resultIndex` controls which index the browser "reports as new".
 */
function makeSpeechResultEvent(
  results: Array<{ transcript: string; isFinal: boolean }>,
  resultIndex = 0,
): SpeechRecognitionEvent {
  const speechResults = results.map(({ transcript, isFinal }) => {
    const alternative = { transcript, confidence: 0.9 } as SpeechRecognitionAlternative
    const result = Object.assign([alternative], { isFinal, length: 1 }) as unknown as SpeechRecognitionResult
    result[Symbol.iterator] = function* () { yield alternative }
    return result
  })

  const resultList = Object.assign(speechResults, {
    length: speechResults.length,
    item: (i: number) => speechResults[i],
  }) as unknown as SpeechRecognitionResultList

  return {
    resultIndex,
    results: resultList,
  } as unknown as SpeechRecognitionEvent
}

/**
 * Build a synthetic `SpeechRecognitionErrorEvent`.
 */
function makeSpeechErrorEvent(error: string): SpeechRecognitionErrorEvent {
  return { error } as unknown as SpeechRecognitionErrorEvent
}

// ─── Test setup / teardown ───────────────────────────────────────────────────

let mockRecognitionInstance: MockSpeechRecognition

beforeEach(() => {
  mockRecognitionInstance = new MockSpeechRecognition()

  const MockCtor = vi.fn(() => mockRecognitionInstance) as unknown as typeof SpeechRecognition
  vi.stubGlobal('SpeechRecognition', MockCtor)
  // Ensure webkit variant is absent so tests are deterministic
  vi.stubGlobal('webkitSpeechRecognition', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Helper: default no-op events ────────────────────────────────────────────

function makeEvents(overrides: Partial<STTAdapterEvents> = {}): STTAdapterEvents {
  return {
    onInterim: vi.fn(),
    onFinal: vi.fn(),
    onError: vi.fn(),
    onEnd: vi.fn(),
    ...overrides,
  }
}

// ─── isSupported() ───────────────────────────────────────────────────────────

describe('isSupported()', () => {
  it('returns true when window.SpeechRecognition is present', () => {
    const adapter = createWebSpeechAdapter()
    expect(adapter.isSupported()).toBe(true)
  })

  it('returns true when only window.webkitSpeechRecognition is present', () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', vi.fn())

    const adapter = createWebSpeechAdapter()
    expect(adapter.isSupported()).toBe(true)
  })

  it('returns false when neither SpeechRecognition variant is present', () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', undefined)

    const adapter = createWebSpeechAdapter()
    expect(adapter.isSupported()).toBe(false)
  })
})

// ─── start() ────────────────────────────────────────────────────────────────

describe('start()', () => {
  it('calls recognition.start()', async () => {
    const adapter = createWebSpeechAdapter()
    await adapter.start(makeEvents())
    expect(mockRecognitionInstance.start).toHaveBeenCalledOnce()
  })

  it('sets continuous=false, interimResults=true, lang=navigator.language', async () => {
    const adapter = createWebSpeechAdapter()
    await adapter.start(makeEvents())
    expect(mockRecognitionInstance.continuous).toBe(false)
    expect(mockRecognitionInstance.interimResults).toBe(true)
    expect(mockRecognitionInstance.lang).toBe(navigator.language)
  })

  it('assigns onresult, onerror, and onend handlers', async () => {
    const adapter = createWebSpeechAdapter()
    await adapter.start(makeEvents())
    expect(mockRecognitionInstance.onresult).toBeTypeOf('function')
    expect(mockRecognitionInstance.onerror).toBeTypeOf('function')
    expect(mockRecognitionInstance.onend).toBeTypeOf('function')
  })
})

// ─── onresult handler ────────────────────────────────────────────────────────

describe('onresult handler', () => {
  it('fires onFinal with trimmed transcript for a final result', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    const event = makeSpeechResultEvent([{ transcript: '  hello world  ', isFinal: true }])
    mockRecognitionInstance.onresult!(event)

    expect(events.onFinal).toHaveBeenCalledOnce()
    expect(events.onFinal).toHaveBeenCalledWith('hello world')
    expect(events.onInterim).not.toHaveBeenCalled()
  })

  it('fires onInterim (without trimming) for a non-final result', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    const event = makeSpeechResultEvent([{ transcript: 'hel', isFinal: false }])
    mockRecognitionInstance.onresult!(event)

    expect(events.onInterim).toHaveBeenCalledOnce()
    expect(events.onInterim).toHaveBeenCalledWith('hel')
    expect(events.onFinal).not.toHaveBeenCalled()
  })

  it('iterates from event.resultIndex — skips already-processed results', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    // resultIndex=1 means index 0 is already processed; only index 1 is new
    const event = makeSpeechResultEvent(
      [
        { transcript: 'old result', isFinal: true },  // index 0 — should NOT fire
        { transcript: 'new result', isFinal: true },  // index 1 — should fire
      ],
      1, // resultIndex
    )
    mockRecognitionInstance.onresult!(event)

    expect(events.onFinal).toHaveBeenCalledOnce()
    expect(events.onFinal).toHaveBeenCalledWith('new result')
  })

  it('onresult is assigned exactly once — not overwritten conditionally', async () => {
    // We verify this by counting unique function references. Because JavaScript
    // closures are created once, the handler assigned to onresult should be the
    // same reference throughout the session.
    const adapter = createWebSpeechAdapter()
    await adapter.start(makeEvents())

    const handlerAfterStart = mockRecognitionInstance.onresult

    // Simulate a result event — a buggy "double-assign" implementation would
    // overwrite onresult inside the first result callback.
    const event = makeSpeechResultEvent([{ transcript: 'test', isFinal: false }])
    mockRecognitionInstance.onresult!(event)

    expect(mockRecognitionInstance.onresult).toBe(handlerAfterStart)
  })

  it('handles a mix of interim and final results in one event', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    // resultIndex=0 — both entries are new
    const event = makeSpeechResultEvent(
      [
        { transcript: 'partial', isFinal: false },
        { transcript: 'full sentence', isFinal: true },
      ],
      0,
    )
    mockRecognitionInstance.onresult!(event)

    expect(events.onInterim).toHaveBeenCalledWith('partial')
    expect(events.onFinal).toHaveBeenCalledWith('full sentence')
  })
})

// ─── onerror handler / error mapping ────────────────────────────────────────

describe('onerror handler — error code mapping', () => {
  const errorCases: Array<[string, string]> = [
    ['not-allowed', 'PERMISSION_DENIED'],
    ['service-not-allowed', 'PERMISSION_DENIED'],
    ['network', 'NETWORK_ERROR'],
    ['no-speech', 'NO_SPEECH'],
    ['audio-capture', 'AUDIO_CAPTURE_FAILED'],
    ['bad-grammar', 'UNKNOWN'],
    ['language-not-supported', 'UNKNOWN'],
  ]

  it.each(errorCases)(
    'maps browser error "%s" to STTErrorCode "%s"',
    async (browserError, expectedCode) => {
      const events = makeEvents()
      const adapter = createWebSpeechAdapter()
      await adapter.start(events)

      mockRecognitionInstance.onerror!(makeSpeechErrorEvent(browserError))

      expect(events.onError).toHaveBeenCalledOnce()
      const sttError = vi.mocked(events.onError).mock.calls[0]?.[0]
      expect(sttError).toBeDefined()
      expect(sttError!.code).toBe(expectedCode)
      expect(sttError!.name).toBe('STTError')
      expect(sttError).toBeInstanceOf(Error)
    },
  )

  it('does NOT forward the "aborted" error to events.onError', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    mockRecognitionInstance.onerror!(makeSpeechErrorEvent('aborted'))

    expect(events.onError).not.toHaveBeenCalled()
  })
})

// ─── onend handler ───────────────────────────────────────────────────────────

describe('onend handler', () => {
  it('calls events.onEnd when recognition ends', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    mockRecognitionInstance.onend!()

    expect(events.onEnd).toHaveBeenCalledOnce()
  })

  it('calls onFinal("") when recognition ends without a final result', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    // No onresult fired before onend — silence timeout scenario
    mockRecognitionInstance.onend!()

    expect(events.onFinal).toHaveBeenCalledOnce()
    expect(events.onFinal).toHaveBeenCalledWith('')
  })

  it('does NOT call onFinal("") when a final result was already emitted', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    // Fire a final result first
    const event = makeSpeechResultEvent([{ transcript: 'done', isFinal: true }])
    mockRecognitionInstance.onresult!(event)

    // Now recognition ends — should not emit a second onFinal
    mockRecognitionInstance.onend!()

    expect(events.onFinal).toHaveBeenCalledOnce()
    expect(events.onFinal).toHaveBeenCalledWith('done')
  })
})

// ─── abort() ────────────────────────────────────────────────────────────────

describe('abort()', () => {
  it('calls recognition.abort()', async () => {
    const adapter = createWebSpeechAdapter()
    await adapter.start(makeEvents())

    adapter.abort()

    expect(mockRecognitionInstance.abort).toHaveBeenCalledOnce()
  })

  it('prevents onFinal("") from being called when recognition ends after abort', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    adapter.abort()
    // Browser fires onend after abort
    mockRecognitionInstance.onend!()

    expect(events.onFinal).not.toHaveBeenCalled()
  })

  it('still calls events.onEnd after abort', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    adapter.abort()
    mockRecognitionInstance.onend!()

    expect(events.onEnd).toHaveBeenCalledOnce()
  })

  it('does not throw when abort is called before start', () => {
    const adapter = createWebSpeechAdapter()
    expect(() => adapter.abort()).not.toThrow()
  })
})

// ─── stop() ─────────────────────────────────────────────────────────────────

describe('stop()', () => {
  it('calls recognition.stop()', async () => {
    const adapter = createWebSpeechAdapter()
    await adapter.start(makeEvents())

    adapter.stop()

    expect(mockRecognitionInstance.stop).toHaveBeenCalledOnce()
  })

  it('allows onFinal to fire normally after stop()', async () => {
    const events = makeEvents()
    const adapter = createWebSpeechAdapter()
    await adapter.start(events)

    adapter.stop()

    // Browser delivers a final result then fires onend
    const event = makeSpeechResultEvent([{ transcript: 'graceful stop', isFinal: true }])
    mockRecognitionInstance.onresult!(event)
    mockRecognitionInstance.onend!()

    expect(events.onFinal).toHaveBeenCalledWith('graceful stop')
    // onFinal should only be called once (from the real result, not from onend fallback)
    expect(events.onFinal).toHaveBeenCalledOnce()
  })

  it('does not throw when stop is called before start', () => {
    const adapter = createWebSpeechAdapter()
    expect(() => adapter.stop()).not.toThrow()
  })
})

// ─── webkit fallback ────────────────────────────────────────────────────────

describe('webkitSpeechRecognition fallback', () => {
  it('uses webkitSpeechRecognition when SpeechRecognition is absent', async () => {
    const webkitMock = new MockSpeechRecognition()
    const WebkitCtor = vi.fn(() => webkitMock) as unknown as typeof SpeechRecognition

    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', WebkitCtor)

    const adapter = createWebSpeechAdapter()
    await adapter.start(makeEvents())

    expect(webkitMock.start).toHaveBeenCalledOnce()
  })
})
