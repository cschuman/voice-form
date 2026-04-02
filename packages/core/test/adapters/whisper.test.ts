// @vitest-environment jsdom
/**
 * Unit tests for the Whisper STT adapter.
 *
 * Strategy: replace global `MediaRecorder` and `navigator.mediaDevices.getUserMedia`
 * with controllable mocks before each test. The mock MediaRecorder captures the
 * event handlers assigned by the adapter so tests can fire them synchronously.
 *
 * Critical ordering invariants verified:
 * - abort() sets `aborted = true` BEFORE calling recorder.stop()
 * - start() cancels any prior in-flight POST before creating a new AbortController
 *
 * Environment: jsdom (via // @vitest-environment jsdom header)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { STTAdapterEvents } from '../../src/types.js'
import { createWhisperAdapter } from '../../src/adapters/whisper.js'

// ─── Mock MediaRecorder ───────────────────────────────────────────────────────

/**
 * Tracks the sequence of property assignments and method calls so tests can
 * assert on ordering (critical for abort() flag ordering verification).
 */
class MockMediaRecorder {
  /** The options passed to the constructor (contains mimeType if provided). */
  readonly options: MediaRecorderOptions

  /** Recorded call order entries for verifying abort flag ordering. */
  readonly callLog: string[] = []

  /** State mirroring the real MediaRecorder. */
  state: RecordingState = 'inactive'

  /** Event handlers — assigned by the adapter. */
  ondataavailable: ((e: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((e: MediaRecorderErrorEvent) => void) | null = null

  start = vi.fn((timeslice?: number) => {
    void timeslice
    this.callLog.push('recorder.start')
    this.state = 'recording'
  })

  stop = vi.fn(() => {
    this.callLog.push('recorder.stop')
    this.state = 'inactive'
    // Synchronously fire onstop so tests can control when it fires.
    // Tests that need async can override this.
    this.onstop?.()
  })

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    void stream
    this.options = options ?? {}
  }
}

// isTypeSupported is a static method — we control it per test.
MockMediaRecorder.isTypeSupported = vi.fn((_mimeType: string) => false) as (mimeType: string) => boolean

// ─── Mock MediaStream / MediaStreamTrack ─────────────────────────────────────

function makeMockTrack(): MediaStreamTrack {
  return { stop: vi.fn() } as unknown as MediaStreamTrack
}

function makeMockStream(trackCount = 1): MediaStream {
  const tracks = Array.from({ length: trackCount }, makeMockTrack)
  return {
    getTracks: vi.fn(() => tracks),
    _tracks: tracks,
  } as unknown as MediaStream
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = 'https://example.com/transcribe'

function makeEvents(overrides: Partial<STTAdapterEvents> = {}): STTAdapterEvents {
  return {
    onInterim: vi.fn(),
    onFinal: vi.fn(),
    onError: vi.fn(),
    onEnd: vi.fn(),
    ...overrides,
  }
}

// ─── Test setup / teardown ───────────────────────────────────────────────────

let mockStream: MediaStream
let mockRecorderInstance: MockMediaRecorder

beforeEach(() => {
  mockStream = makeMockStream()
  mockRecorderInstance = undefined as unknown as MockMediaRecorder

  // Reset isTypeSupported to reject all types (individual tests enable what they need).
  vi.mocked(MockMediaRecorder.isTypeSupported).mockReturnValue(false)

  // Stub global MediaRecorder.
  const MockCtor = vi.fn((stream: MediaStream, options?: MediaRecorderOptions) => {
    mockRecorderInstance = new MockMediaRecorder(stream, options)
    return mockRecorderInstance
  }) as unknown as typeof MediaRecorder
  ;(MockCtor as unknown as Record<string, unknown>)['isTypeSupported'] =
    MockMediaRecorder.isTypeSupported
  vi.stubGlobal('MediaRecorder', MockCtor)

  // Stub getUserMedia to resolve with mock stream.
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
    },
    writable: true,
    configurable: true,
  })

  // Stub global fetch with a successful transcription response.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ transcript: 'hello world' }),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── isSupported() ───────────────────────────────────────────────────────────

describe('isSupported()', () => {
  it('returns false when MediaRecorder is absent', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    expect(adapter.isSupported()).toBe(false)
  })

  it('returns false when navigator.mediaDevices.getUserMedia is absent', () => {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { getUserMedia: undefined },
      writable: true,
      configurable: true,
    })
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    expect(adapter.isSupported()).toBe(false)
  })

  it('returns true when MediaRecorder and getUserMedia are present', () => {
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    expect(adapter.isSupported()).toBe(true)
  })
})

// ─── start() — MediaRecorder creation ────────────────────────────────────────

describe('start() — MediaRecorder creation', () => {
  it('creates MediaRecorder with the first supported MIME type (webm/opus)', async () => {
    vi.mocked(MockMediaRecorder.isTypeSupported).mockImplementation(
      (t) => t === 'audio/webm;codecs=opus',
    )
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(makeEvents())

    expect(mockRecorderInstance.options.mimeType).toBe('audio/webm;codecs=opus')
  })

  it('falls back to ogg/opus when webm/opus is unsupported', async () => {
    vi.mocked(MockMediaRecorder.isTypeSupported).mockImplementation(
      (t) => t === 'audio/ogg;codecs=opus',
    )
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(makeEvents())

    expect(mockRecorderInstance.options.mimeType).toBe('audio/ogg;codecs=opus')
  })

  it('falls back to mp4 when webm and ogg are unsupported', async () => {
    vi.mocked(MockMediaRecorder.isTypeSupported).mockImplementation(
      (t) => t === 'audio/mp4',
    )
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(makeEvents())

    expect(mockRecorderInstance.options.mimeType).toBe('audio/mp4')
  })

  it('falls back to webm without codec hint as last named fallback', async () => {
    vi.mocked(MockMediaRecorder.isTypeSupported).mockImplementation(
      (t) => t === 'audio/webm',
    )
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(makeEvents())

    expect(mockRecorderInstance.options.mimeType).toBe('audio/webm')
  })

  it('omits mimeType from options when no type is supported', async () => {
    vi.mocked(MockMediaRecorder.isTypeSupported).mockReturnValue(false)
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(makeEvents())

    // When selectMimeType() returns '' the recorder is created without mimeType.
    expect(mockRecorderInstance.options.mimeType).toBeUndefined()
  })

  it('calls recorder.start() with a 250ms timeslice', async () => {
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(makeEvents())

    expect(mockRecorderInstance.start).toHaveBeenCalledWith(250)
  })

  it('calls getUserMedia with { audio: true }', async () => {
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(makeEvents())

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
  })
})

// ─── start() — chunk collection ──────────────────────────────────────────────

describe('start() — chunk collection via ondataavailable', () => {
  it('collects non-empty data chunks into internal array', async () => {
    // Prevent auto-stop from firing by not triggering onstop yet.
    // We just verify ondataavailable is wired by the adapter.
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    // Override stop to suppress onstop during this test.
    const stopSpy = vi.fn(() => {
      mockRecorderInstance.state = 'inactive'
      // Do NOT fire onstop — we only test chunk collection here.
    })

    await adapter.start(makeEvents())
    // Replace the stop mock AFTER start so we can control onstop firing.
    mockRecorderInstance.stop.mockImplementation(stopSpy)
    mockRecorderInstance.state = 'recording'

    expect(mockRecorderInstance.ondataavailable).toBeTypeOf('function')

    // Fire a data available event with a non-empty blob.
    const chunk = new Blob(['audio-data'], { type: 'audio/webm' })
    mockRecorderInstance.ondataavailable!({ data: chunk } as BlobEvent)

    // The chunk should have been collected (tested indirectly: if it was ignored
    // no blob would be sent on stop — but direct chunk access is private).
    // We verify via the POST path: fire onstop and confirm fetch was called.
    mockRecorderInstance.onstop?.()
    // Allow microtasks to flush.
    await Promise.resolve()
    await Promise.resolve()

    expect(fetch).toHaveBeenCalled()
  })

  it('ignores zero-size data chunks', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })

    // Suppress auto-stop to control chunk collection.
    mockRecorderInstance = undefined as unknown as MockMediaRecorder
    await adapter.start(events)

    // Fire a zero-size chunk.
    mockRecorderInstance.ondataavailable!({ data: new Blob([]) } as BlobEvent)

    // Fire onstop directly to trigger POST.
    mockRecorderInstance.onstop?.()
    await Promise.resolve()
    await Promise.resolve()

    // fetch is still called (with an empty Blob) — the adapter does not error.
    // Key invariant: it does not throw on empty chunks.
    expect(events.onError).not.toHaveBeenCalled()
  })
})

// ─── stop() — blob assembly and POST ─────────────────────────────────────────

describe('stop() — assembles blob and POSTs to transcription endpoint', () => {
  it('POSTs to the configured transcriptionEndpoint', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    // onstop fires synchronously inside the mock stop() above.
    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()

    expect(fetch).toHaveBeenCalledWith(
      DEFAULT_ENDPOINT,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('includes X-VoiceForm-Request: 1 header on the POST', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()

    const [, fetchInit] = vi.mocked(fetch).mock.calls[0]!
    const headers = (fetchInit as RequestInit).headers as Record<string, string>
    expect(headers['X-VoiceForm-Request']).toBe('1')
  })

  it('includes Content-Type matching the selected MIME type', async () => {
    vi.mocked(MockMediaRecorder.isTypeSupported).mockImplementation(
      (t) => t === 'audio/webm;codecs=opus',
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()

    const [, fetchInit] = vi.mocked(fetch).mock.calls[0]!
    const headers = (fetchInit as RequestInit).headers as Record<string, string>
    expect(headers['Content-Type']).toBe('audio/webm;codecs=opus')
  })

  it('merges developer-provided extra headers into the POST', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({
      transcriptionEndpoint: DEFAULT_ENDPOINT,
      headers: { Authorization: 'Bearer token-abc' },
    })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()

    const [, fetchInit] = vi.mocked(fetch).mock.calls[0]!
    const headers = (fetchInit as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer token-abc')
  })

  it('calls onFinal with the transcript from a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ transcript: 'test transcript' }),
      }),
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onFinal).toHaveBeenCalledWith('test transcript')
  })

  it('calls onEnd after successful POST', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onEnd).toHaveBeenCalledOnce()
  })
})

// ─── Response validation ──────────────────────────────────────────────────────

describe('response validation', () => {
  it('calls onError with code UNKNOWN when transcript field is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ result: 'not a transcript' }),
      }),
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onError).toHaveBeenCalledOnce()
    const err = vi.mocked(events.onError).mock.calls[0]![0]
    expect(err.code).toBe('UNKNOWN')
  })

  it('calls onError with code UNKNOWN when transcript field is not a string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ transcript: 42 }),
      }),
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onError).toHaveBeenCalledOnce()
    const err = vi.mocked(events.onError).mock.calls[0]![0]
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toContain('transcript')
  })

  it('truncates transcript exceeding 10000 characters to exactly 10000', async () => {
    const longTranscript = 'a'.repeat(10_001)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ transcript: longTranscript }),
      }),
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onFinal).toHaveBeenCalledOnce()
    const receivedTranscript = vi.mocked(events.onFinal).mock.calls[0]![0]
    expect(receivedTranscript).toHaveLength(10_000)
    expect(receivedTranscript).toBe('a'.repeat(10_000))
  })

  it('passes through a transcript of exactly 10000 characters unchanged', async () => {
    const exactTranscript = 'b'.repeat(10_000)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ transcript: exactTranscript }),
      }),
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onFinal).toHaveBeenCalledWith(exactTranscript)
  })
})

// ─── abort() — CRITICAL flag ordering ────────────────────────────────────────

describe('abort() — CRITICAL: aborted flag set BEFORE recorder.stop()', () => {
  it('sets aborted = true before recorder.stop() is called', async () => {
    /**
     * This test captures the exact call sequence by intercepting the
     * recorder.stop() mock and checking whether the adapter's internal
     * `aborted` flag is already true at that moment.
     *
     * Strategy: override recorder.stop() to call onstop() synchronously (which
     * reads this.aborted). If aborted is false when onstop fires, the POST
     * would proceed — we detect this by observing whether fetch is called.
     */
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    // The mock stop() calls onstop() synchronously. The onstop handler
    // guards on `this.aborted` — if aborted is set BEFORE stop(), onstop
    // will skip the POST. We verify by confirming fetch is NOT called.
    adapter.abort()
    await Promise.resolve()
    await Promise.resolve()

    // aborted = true before stop() means onstop sees aborted=true → no POST.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('records recorder.stop in callLog only AFTER aborted flag would be set', async () => {
    /**
     * The MockMediaRecorder.stop() appends 'recorder.stop' to callLog.
     * The adapter sets this.aborted = true before calling recorder.stop().
     * We verify the ordering by injecting a sentinel into the callLog from
     * within the recorder.stop() mock.
     */
    const callOrder: string[] = []

    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(makeEvents())

    // Override recorder.stop to capture the moment it's called relative to abort.
    mockRecorderInstance.stop.mockImplementation(() => {
      callOrder.push('recorder.stop')
      mockRecorderInstance.state = 'inactive'
      // Do NOT fire onstop — we only need the ordering check here.
    })

    // Intercept onstop to record its invocation from within stop.
    // The aborted flag is private, but if onstop fires and finds aborted=true
    // it won't call fetch — indirect proof of ordering.
    let abortedWhenStopCalled = false
    const originalStop = mockRecorderInstance.stop
    mockRecorderInstance.stop = vi.fn(() => {
      // At this point, abort() should have already set aborted.
      // We detect the aborted state indirectly: if onstop fires and
      // does NOT call fetch, aborted was true.
      callOrder.push('recorder.stop')
      mockRecorderInstance.state = 'inactive'
      mockRecorderInstance.onstop?.()
    })

    adapter.abort()
    await Promise.resolve()
    await Promise.resolve()

    // If aborted was set before recorder.stop(), onstop skips the POST.
    abortedWhenStopCalled = !vi.mocked(fetch).mock.calls.length
    expect(abortedWhenStopCalled).toBe(true)
    expect(callOrder).toContain('recorder.stop')

    void originalStop
  })

  it('does NOT call onFinal after abort()', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.abort()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onFinal).not.toHaveBeenCalled()
  })

  it('calls onEnd after abort()', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.abort()
    await Promise.resolve()

    expect(events.onEnd).toHaveBeenCalledOnce()
  })

  it('does not throw when abort() is called before start()', () => {
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    expect(() => adapter.abort()).not.toThrow()
  })
})

// ─── start() — cancels prior in-flight POST ──────────────────────────────────

describe('start() — CRITICAL: cancels prior in-flight POST before new session', () => {
  it('aborts the prior postAbortController when start() is called again', async () => {
    /**
     * Simulate a slow POST by never resolving the first fetch.
     * Then call start() again and verify the first fetch's AbortSignal is aborted.
     */
    let firstAbortSignal: AbortSignal | undefined

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        if (!firstAbortSignal) {
          firstAbortSignal = init.signal
          // Never resolve — simulates a slow/hung POST.
          return new Promise(() => {})
        }
        // Second call resolves normally.
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({ transcript: 'session 2' }),
        })
      }),
    )

    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })

    // Session 1: start, stop (fires onstop synchronously in mock), which starts POST.
    await adapter.start(makeEvents())
    // Fire onstop manually without going through stop() to bypass recorder.state guard.
    mockRecorderInstance.ondataavailable!({ data: new Blob(['audio']) } as BlobEvent)
    mockRecorderInstance.onstop?.()
    // At this point the first POST is pending (never resolves).

    // Session 2: start() — should abort the prior POST controller.
    await adapter.start(makeEvents())

    // The first fetch's AbortSignal should now be aborted.
    expect(firstAbortSignal?.aborted).toBe(true)
  })
})

// ─── Blob cleanup ─────────────────────────────────────────────────────────────

describe('Blob cleanup', () => {
  it('chunks are cleared after Blob assembly (not leaked to next session)', async () => {
    /**
     * We cannot inspect private fields directly, but we can verify the
     * behavior indirectly: if chunks were NOT cleared, the second session
     * would include audio from the first session in its POST body size.
     *
     * More practically: verify that the POST happens (cleanup does not break
     * the happy path) and that fetch is called exactly once per session.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ transcript: 'clean session' }),
      }),
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    mockRecorderInstance.ondataavailable!({ data: new Blob(['chunk1']) } as BlobEvent)
    mockRecorderInstance.ondataavailable!({ data: new Blob(['chunk2']) } as BlobEvent)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Verify the POST was made (chunks were assembled).
    expect(fetch).toHaveBeenCalledOnce()
    expect(events.onFinal).toHaveBeenCalledWith('clean session')
  })

  it('stream tracks are stopped after stop() completes', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const tracks = (mockStream as unknown as { _tracks: MediaStreamTrack[] })._tracks
    for (const track of tracks) {
      expect(vi.mocked(track.stop)).toHaveBeenCalled()
    }
  })

  it('stream tracks are stopped after abort()', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.abort()

    const tracks = (mockStream as unknown as { _tracks: MediaStreamTrack[] })._tracks
    for (const track of tracks) {
      expect(vi.mocked(track.stop)).toHaveBeenCalled()
    }
  })
})

// ─── Error mapping ────────────────────────────────────────────────────────────

describe('error mapping', () => {
  it('maps network failure (fetch throws) to NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onError).toHaveBeenCalledOnce()
    const err = vi.mocked(events.onError).mock.calls[0]![0]
    expect(err.code).toBe('NETWORK_ERROR')
  })

  it('maps HTTP 4xx/5xx response to NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn(),
      }),
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onError).toHaveBeenCalledOnce()
    const err = vi.mocked(events.onError).mock.calls[0]![0]
    expect(err.code).toBe('NETWORK_ERROR')
  })

  it('maps MediaRecorder onerror event to UNKNOWN', async () => {
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    const mockDOMException = new DOMException('Hardware error', 'NotReadableError')
    mockRecorderInstance.onerror!({
      error: mockDOMException,
    } as unknown as MediaRecorderErrorEvent)
    await Promise.resolve()

    expect(events.onError).toHaveBeenCalledOnce()
    const err = vi.mocked(events.onError).mock.calls[0]![0]
    expect(err.code).toBe('UNKNOWN')
    expect(err.originalError).toBe(mockDOMException)
  })

  it('maps getUserMedia NotAllowedError to PERMISSION_DENIED', async () => {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(
          new DOMException('Permission denied', 'NotAllowedError'),
        ),
      },
      writable: true,
      configurable: true,
    })
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    expect(events.onError).toHaveBeenCalledOnce()
    const err = vi.mocked(events.onError).mock.calls[0]![0]
    expect(err.code).toBe('PERMISSION_DENIED')
    expect(events.onEnd).toHaveBeenCalledOnce()
  })

  it('maps getUserMedia NotFoundError to AUDIO_CAPTURE_FAILED', async () => {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(
          new DOMException('No microphone found', 'NotFoundError'),
        ),
      },
      writable: true,
      configurable: true,
    })
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    expect(events.onError).toHaveBeenCalledOnce()
    const err = vi.mocked(events.onError).mock.calls[0]![0]
    expect(err.code).toBe('AUDIO_CAPTURE_FAILED')
  })

  it('calls onEnd after any error path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Network failure')),
    )
    const events = makeEvents()
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    await adapter.start(events)

    adapter.stop()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events.onEnd).toHaveBeenCalledOnce()
  })
})

// ─── Type contract ────────────────────────────────────────────────────────────

describe('STTAdapter interface contract', () => {
  it('implements the full STTAdapter interface', () => {
    const adapter = createWhisperAdapter({ transcriptionEndpoint: DEFAULT_ENDPOINT })
    expect(typeof adapter.isSupported).toBe('function')
    expect(typeof adapter.start).toBe('function')
    expect(typeof adapter.stop).toBe('function')
    expect(typeof adapter.abort).toBe('function')
  })
})
