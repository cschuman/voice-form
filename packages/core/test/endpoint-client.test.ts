// @vitest-environment jsdom
/**
 * endpoint-client.test.ts
 *
 * TDD test suite for EndpointClient.
 *
 * Mock strategy: vi.stubGlobal('fetch', ...) — no real network calls.
 * Timer strategy: vi.useFakeTimers() for retry backoff (500ms) and timeoutMs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EndpointClient, EndpointError } from '../src/endpoint-client.js'
import type { ParseRequest, ParseResponse } from '../src/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid ParseRequest for all tests. */
function makeRequest(overrides: Partial<ParseRequest> = {}): ParseRequest {
  return {
    transcript: 'John Smith, john@example.com',
    schema: {
      formName: 'Contact',
      fields: [
        { name: 'name', type: 'text', label: 'Name' },
        { name: 'email', type: 'email', label: 'Email' },
      ],
    },
    requestId: 'test-uuid-1234',
    ...overrides,
  }
}

/** A valid ParseResponse body. */
const VALID_RESPONSE: ParseResponse = {
  fields: {
    name: { value: 'John Smith' },
    email: { value: 'john@example.com', confidence: 0.97 },
  },
}

/**
 * Build a mock fetch function that resolves with the given status and body.
 * The body is serialized to JSON by default.
 */
function mockFetchOk(body: unknown = VALID_RESPONSE, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

/**
 * Build a mock fetch that rejects with a network error (fetch throws).
 */
function mockFetchNetworkError(message = 'Failed to fetch'): ReturnType<typeof vi.fn> {
  return vi.fn().mockRejectedValue(new TypeError(message))
}

/**
 * Build a mock fetch that never resolves until the AbortSignal fires.
 * This correctly simulates a pending network request that can be aborted.
 * When the signal is aborted, the returned promise rejects with a DOMException
 * (AbortError), matching the behavior of real browser fetch.
 */
function mockFetchSignalAware(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(
    (_url: string, init?: RequestInit): Promise<Response> => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined
        if (signal?.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
          return
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    },
  )
}

/** Create a default EndpointClient with test-friendly settings. */
function makeClient(overrides: { timeoutMs?: number; retries?: number } = {}): EndpointClient {
  return new EndpointClient('https://api.example.com/parse', {
    timeoutMs: overrides.timeoutMs ?? 10_000,
    retries: overrides.retries ?? 1,
    headers: {},
  })
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Suite: Successful POST
// ---------------------------------------------------------------------------

describe('EndpointClient — successful POST', () => {
  it('POSTs to the configured URL', async () => {
    const mockFetch = mockFetchOk()
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient()
    await client.parse(makeRequest())

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/parse')
  })

  it('uses the POST method', async () => {
    const mockFetch = mockFetchOk()
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient()
    await client.parse(makeRequest())

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
  })

  it('sends the request payload as JSON in the body', async () => {
    const mockFetch = mockFetchOk()
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient()
    const req = makeRequest()
    await client.parse(req)

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as ParseRequest
    expect(body.transcript).toBe(req.transcript)
    expect(body.requestId).toBe(req.requestId)
  })

  it('returns a ParseResponse with parsed fields', async () => {
    vi.stubGlobal('fetch', mockFetchOk())

    const client = makeClient()
    const result = await client.parse(makeRequest())

    expect(result.fields).toBeDefined()
    expect(result.fields['name']?.value).toBe('John Smith')
    expect(result.fields['email']?.value).toBe('john@example.com')
  })

  it('preserves the optional confidence field in the response', async () => {
    vi.stubGlobal('fetch', mockFetchOk())

    const client = makeClient()
    const result = await client.parse(makeRequest())

    expect(result.fields['email']?.confidence).toBe(0.97)
  })
})

// ---------------------------------------------------------------------------
// Suite: Required headers
// ---------------------------------------------------------------------------

describe('EndpointClient — request headers', () => {
  it('includes Content-Type: application/json on every request', async () => {
    const mockFetch = mockFetchOk()
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient()
    await client.parse(makeRequest())

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('includes Accept: application/json on every request', async () => {
    const mockFetch = mockFetchOk()
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient()
    await client.parse(makeRequest())

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Accept']).toBe('application/json')
  })

  it('includes X-VoiceForm-Request: 1 on every request (CSRF mitigation)', async () => {
    const mockFetch = mockFetchOk()
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient()
    await client.parse(makeRequest())

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-VoiceForm-Request']).toBe('1')
  })

  it('merges extra headers from options into every request', async () => {
    const mockFetch = mockFetchOk()
    vi.stubGlobal('fetch', mockFetch)

    const client = new EndpointClient('https://api.example.com/parse', {
      timeoutMs: 10_000,
      retries: 1,
      headers: { Authorization: 'Bearer token123' },
    })
    await client.parse(makeRequest())

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer token123')
  })

  it('X-VoiceForm-Request header is present on retry attempts too', async () => {
    // First call → 500, second call → 200
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(VALID_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient({ retries: 1 })
    const parsePromise = client.parse(makeRequest())

    // Advance past the 500ms retry backoff
    await vi.advanceTimersByTimeAsync(500)
    await parsePromise

    expect(mockFetch).toHaveBeenCalledTimes(2)

    const [, secondInit] = mockFetch.mock.calls[1] as [string, RequestInit]
    const headers = secondInit.headers as Record<string, string>
    expect(headers['X-VoiceForm-Request']).toBe('1')
  })
})

// ---------------------------------------------------------------------------
// Suite: HTTP error responses
// ---------------------------------------------------------------------------

describe('EndpointClient — HTTP error responses', () => {
  it('throws EndpointError(HTTP_ERROR) on a 500 response after exhausting retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient({ retries: 1 })
    const parsePromise = client.parse(makeRequest())

    // Attach the rejection handler BEFORE advancing timers to avoid the
    // unhandled-rejection warning that fires when the retry settles inside
    // the advanceTimersByTimeAsync microtask chain.
    const assertion = expect(parsePromise).rejects.toMatchObject({ code: 'HTTP_ERROR' })

    // Advance past the single 500ms retry backoff
    await vi.advanceTimersByTimeAsync(500)
    await assertion

    expect(mockFetch).toHaveBeenCalledTimes(2) // 1 initial + 1 retry
  })

  it('thrown EndpointError includes the httpStatus for 500 errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 })),
    )

    const client = makeClient({ retries: 0 })

    await expect(client.parse(makeRequest())).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      httpStatus: 500,
    })
  })

  it('thrown error includes truncated rawBody (max 500 chars) in debugInfo', async () => {
    const longBody = 'x'.repeat(1000)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(longBody, { status: 500 })),
    )

    const client = makeClient({ retries: 0 })

    try {
      await client.parse(makeRequest())
      expect.fail('Expected an error to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(EndpointError)
      const endpointErr = err as EndpointError
      expect(endpointErr.debugInfo?.rawBody).toHaveLength(500)
    }
  })

  it('does NOT retry on a 400 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Bad Request', { status: 400 }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient({ retries: 1 })

    await expect(client.parse(makeRequest())).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      httpStatus: 400,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1) // no retry for 4xx
  })

  it('does NOT retry on a 404 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient({ retries: 1 })

    await expect(client.parse(makeRequest())).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      httpStatus: 404,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1) // no retry for 4xx
  })

  it('retries on 503 (5xx)', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(VALID_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient({ retries: 1 })
    const parsePromise = client.parse(makeRequest())

    await vi.advanceTimersByTimeAsync(500)
    const result = await parsePromise

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.fields['name']?.value).toBe('John Smith')
  })

  it('debugInfo.httpStatus is set for HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })),
    )

    const client = makeClient({ retries: 0 })

    try {
      await client.parse(makeRequest())
      expect.fail('Expected an error')
    } catch (err) {
      const e = err as EndpointError
      expect(e.debugInfo?.httpStatus).toBe(404)
    }
  })
})

// ---------------------------------------------------------------------------
// Suite: Network errors
// ---------------------------------------------------------------------------

describe('EndpointClient — network errors', () => {
  it('throws EndpointError(NETWORK_ERROR) when fetch rejects', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError())

    const client = makeClient({ retries: 0 })

    await expect(client.parse(makeRequest())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })

  it('retries once on network error when retries=1', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(VALID_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient({ retries: 1 })
    const parsePromise = client.parse(makeRequest())

    // Advance past the 500ms retry backoff
    await vi.advanceTimersByTimeAsync(500)
    const result = await parsePromise

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.fields['name']?.value).toBe('John Smith')
  })

  it('throws NETWORK_ERROR after exhausting all retries on repeated network failures', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError())

    const client = makeClient({ retries: 1 })
    const parsePromise = client.parse(makeRequest())

    // Attach the rejection handler before advancing timers (avoids unhandled-rejection warning)
    const assertion = expect(parsePromise).rejects.toMatchObject({ code: 'NETWORK_ERROR' })

    await vi.advanceTimersByTimeAsync(500)
    await assertion
  })
})

// ---------------------------------------------------------------------------
// Suite: Timeout
// ---------------------------------------------------------------------------

describe('EndpointClient — timeout', () => {
  it('throws EndpointError(TIMEOUT) when the request exceeds timeoutMs', async () => {
    // Use a signal-aware mock so the AbortController actually fires the rejection
    vi.stubGlobal('fetch', mockFetchSignalAware())

    // Use 1000ms timeout so we don't conflict with vitest's own 5s test timeout
    const client = new EndpointClient('https://api.example.com/parse', {
      timeoutMs: 1_000,
      retries: 0,
      headers: {},
    })
    const parsePromise = client.parse(makeRequest())

    // Attach the rejection handler before advancing timers (avoids unhandled-rejection warning)
    const assertion = expect(parsePromise).rejects.toMatchObject({ code: 'TIMEOUT' })

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })

  it('does not throw if the response arrives before timeoutMs elapses', async () => {
    vi.stubGlobal('fetch', mockFetchOk())

    const client = makeClient({ timeoutMs: 5_000, retries: 0 })
    const parsePromise = client.parse(makeRequest())

    // Advance only 1 second — well within the 5s timeout
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await parsePromise

    expect(result.fields['name']?.value).toBe('John Smith')
  })
})

// ---------------------------------------------------------------------------
// Suite: Invalid response body
// ---------------------------------------------------------------------------

describe('EndpointClient — invalid response body', () => {
  it('throws EndpointError(INVALID_JSON) when the body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('this is not json}{', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const client = makeClient({ retries: 0 })

    await expect(client.parse(makeRequest())).rejects.toMatchObject({
      code: 'INVALID_JSON',
    })
  })

  it('throws EndpointError(INVALID_RESPONSE_SHAPE) when JSON body is missing `fields`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const client = makeClient({ retries: 0 })

    await expect(client.parse(makeRequest())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE_SHAPE',
    })
  })

  it('throws EndpointError(INVALID_RESPONSE_SHAPE) when `fields` is not an object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ fields: 'not-an-object' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const client = makeClient({ retries: 0 })

    await expect(client.parse(makeRequest())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE_SHAPE',
    })
  })

  it('throws EndpointError(INVALID_RESPONSE_SHAPE) when a field entry is missing `value`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ fields: { name: { confidence: 0.9 } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const client = makeClient({ retries: 0 })

    await expect(client.parse(makeRequest())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE_SHAPE',
    })
  })

  it('throws EndpointError(INVALID_RESPONSE_SHAPE) when the body is null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(null), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const client = makeClient({ retries: 0 })

    await expect(client.parse(makeRequest())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE_SHAPE',
    })
  })
})

// ---------------------------------------------------------------------------
// Suite: abort() during an in-flight request
// ---------------------------------------------------------------------------

describe('EndpointClient — abort()', () => {
  it('throws EndpointError(ABORTED) when abort() is called during an in-flight request', async () => {
    // Use a signal-aware mock so abort() actually causes a rejection
    vi.stubGlobal('fetch', mockFetchSignalAware())

    const client = makeClient({ retries: 0 })
    const parsePromise = client.parse(makeRequest())

    // Abort the in-flight request immediately
    client.abort()

    await expect(parsePromise).rejects.toMatchObject({
      code: 'ABORTED',
    })
  })

  it('calling abort() when no request is in flight is a no-op', () => {
    const client = makeClient()
    expect(() => client.abort()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Suite: abort() during retry backoff
// ---------------------------------------------------------------------------

describe('EndpointClient — abort() during retry backoff', () => {
  it('prevents the retry from firing when abort() is called during the backoff window', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(VALID_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', mockFetch)

    const client = makeClient({ retries: 1 })
    const parsePromise = client.parse(makeRequest())

    // The first fetch resolves with a 500; the client is now in the 500ms backoff
    // window before the retry fires. We abort before that timer fires.
    await vi.advanceTimersByTimeAsync(100) // partial advance, backoff not yet complete
    client.abort()

    await expect(parsePromise).rejects.toMatchObject({
      code: 'ABORTED',
    })

    // Advance well past the backoff to prove the retry never fires
    await vi.advanceTimersByTimeAsync(1_000)

    // fetch was called exactly once — the retry was cancelled
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Suite: EndpointError is a proper Error subclass
// ---------------------------------------------------------------------------

describe('EndpointError', () => {
  it('is an instance of Error', () => {
    const err = new EndpointError('NETWORK_ERROR', 'network failure')
    expect(err).toBeInstanceOf(Error)
  })

  it('has the correct name', () => {
    const err = new EndpointError('HTTP_ERROR', 'not ok', 500)
    expect(err.name).toBe('EndpointError')
  })

  it('exposes code, message, and optional httpStatus', () => {
    const err = new EndpointError('HTTP_ERROR', 'server error', 503)
    expect(err.code).toBe('HTTP_ERROR')
    expect(err.message).toBe('server error')
    expect(err.httpStatus).toBe(503)
  })

  it('debugInfo.timestamp is a unix timestamp in ms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('error', { status: 500 })),
    )

    const client = makeClient({ retries: 0 })

    try {
      await client.parse(makeRequest())
      expect.fail('Expected an error')
    } catch (err) {
      const e = err as EndpointError
      expect(typeof e.debugInfo?.timestamp).toBe('number')
      expect(e.debugInfo?.timestamp).toBeGreaterThan(0)
    }
  })
})
