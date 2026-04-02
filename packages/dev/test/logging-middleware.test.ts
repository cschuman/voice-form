import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { VoiceFormState } from '@voiceform/core'
import { createLoggingMiddleware } from '../src/logging-middleware.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeState(status: VoiceFormState['status'], extra?: Record<string, unknown>): VoiceFormState {
  switch (status) {
    case 'idle':
      return { status: 'idle' }
    case 'recording':
      return { status: 'recording', interimTranscript: (extra?.['interimTranscript'] as string) ?? '' }
    case 'processing':
      return { status: 'processing', transcript: (extra?.['transcript'] as string) ?? 'hello world' }
    case 'confirming':
      return {
        status: 'confirming',
        transcript: 'hello world',
        confirmation: {
          transcript: 'hello world',
          parsedFields: {
            name: { label: 'Name', value: 'Alice', confidence: 0.9 },
          },
          missingFields: [],
          invalidFields: [],
          appendMode: false,
        },
      }
    case 'injecting':
      return {
        status: 'injecting',
        confirmation: {
          transcript: 'hello world',
          parsedFields: {},
          missingFields: [],
          invalidFields: [],
          appendMode: false,
        },
      }
    case 'done':
      return { status: 'done', result: { success: true, fields: {} } }
    case 'error':
      return {
        status: 'error',
        error: { code: 'UNKNOWN', message: 'test error', recoverable: true },
        previousStatus: 'processing',
      }
    default:
      return { status: 'idle' }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createLoggingMiddleware', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleGroupSpy: ReturnType<typeof vi.spyOn>
  let consoleGroupEndSpy: ReturnType<typeof vi.spyOn>
  let consoleTableSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    consoleGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {})
    consoleGroupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    consoleTableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleGroupSpy.mockRestore()
    consoleGroupEndSpy.mockRestore()
    consoleTableSpy.mockRestore()
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('return shape', () => {
    it('returns a config object with an events key containing onStateChange', () => {
      const result = createLoggingMiddleware()
      expect(result).toHaveProperty('events')
      expect(result.events).toHaveProperty('onStateChange')
      expect(typeof result.events?.onStateChange).toBe('function')
    })

    it('returns a config object with onError', () => {
      const result = createLoggingMiddleware()
      expect(result.events).toHaveProperty('onError')
      expect(typeof result.events?.onError).toBe('function')
    })

    it('does not throw when called with no options', () => {
      expect(() => createLoggingMiddleware()).not.toThrow()
    })
  })

  describe('callback chaining', () => {
    it('calls both the developer onStateChange callback and the logging callback', () => {
      const devCallback = vi.fn()
      const result = createLoggingMiddleware({
        callbacks: { onStateChange: devCallback },
      })

      result.events?.onStateChange?.(makeState('processing'))

      expect(devCallback).toHaveBeenCalledOnce()
      // Logging side effect: groupCollapsed should also have been called
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('calls developer onStateChange before the logging side effect', () => {
      const callOrder: string[] = []

      const devCallback = vi.fn(() => {
        callOrder.push('dev')
      })
      consoleSpy.mockImplementation(() => {
        callOrder.push('log')
      })

      const result = createLoggingMiddleware({
        callbacks: { onStateChange: devCallback },
      })
      result.events?.onStateChange?.(makeState('processing'))

      expect(callOrder[0]).toBe('dev')
      expect(callOrder[1]).toBe('log')
    })

    it('calls both the developer onError callback and the logging callback', () => {
      const devError = vi.fn()
      const result = createLoggingMiddleware({
        callbacks: { onError: devError },
      })

      const error = { code: 'UNKNOWN' as const, message: 'oops', recoverable: true }
      result.events?.onError?.(error)

      expect(devError).toHaveBeenCalledWith(error)
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('calls developer onError before the logging side effect', () => {
      const callOrder: string[] = []
      const devError = vi.fn(() => callOrder.push('dev'))
      consoleErrorSpy.mockImplementation(() => { callOrder.push('log') })

      const result = createLoggingMiddleware({
        callbacks: { onError: devError },
      })
      result.events?.onError?.({ code: 'UNKNOWN', message: 'test', recoverable: true })

      expect(callOrder[0]).toBe('dev')
      expect(callOrder[1]).toBe('log')
    })

    it('does not throw when callbacks option is not provided', () => {
      const result = createLoggingMiddleware()
      expect(() => result.events?.onStateChange?.(makeState('idle'))).not.toThrow()
    })
  })

  describe('state transition logging', () => {
    it('opens a console.groupCollapsed when state is processing', () => {
      const result = createLoggingMiddleware()
      result.events?.onStateChange?.(makeState('processing'))
      expect(consoleSpy).toHaveBeenCalledOnce()
    })

    it('logs the transcript when state is processing', () => {
      const result = createLoggingMiddleware()
      result.events?.onStateChange?.(makeState('processing', { transcript: 'test transcript' }))
      expect(consoleLogSpy).toHaveBeenCalledWith('Transcript', 'test transcript')
    })

    it('logs elapsed time and calls console.table when state transitions to confirming', () => {
      const result = createLoggingMiddleware()

      // First go through processing to set requestStartTime
      result.events?.onStateChange?.(makeState('processing'))
      consoleTableSpy.mockClear()
      consoleLogSpy.mockClear()

      result.events?.onStateChange?.(makeState('confirming'))

      expect(consoleTableSpy).toHaveBeenCalledOnce()
      // The elapsed time log should contain a number
      const logCall = consoleLogSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('ms'),
      )
      expect(logCall).toBeDefined()
    })

    it('calls console.groupEnd when transitioning from processing to confirming', () => {
      const result = createLoggingMiddleware()
      result.events?.onStateChange?.(makeState('processing'))
      result.events?.onStateChange?.(makeState('confirming'))
      expect(consoleGroupEndSpy).toHaveBeenCalledOnce()
    })

    it('calls console.groupEnd when transitioning from processing to error', () => {
      const result = createLoggingMiddleware()
      result.events?.onStateChange?.(makeState('processing'))
      consoleGroupEndSpy.mockClear()
      result.events?.onStateChange?.(makeState('error'))
      expect(consoleGroupEndSpy).toHaveBeenCalledOnce()
    })

    it('logs elapsed time using Date.now()', () => {
      const dateSpy = vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000)  // processing start
        .mockReturnValueOnce(1250)  // confirming elapsed

      const result = createLoggingMiddleware()
      result.events?.onStateChange?.(makeState('processing'))
      result.events?.onStateChange?.(makeState('confirming'))

      // The elapsed log should contain 250ms
      const elapsedLog = consoleLogSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('250ms'),
      )
      expect(elapsedLog).toBeDefined()

      dateSpy.mockRestore()
    })
  })

  describe('production mode', () => {
    const originalEnv = process.env['NODE_ENV']

    beforeEach(() => {
      process.env['NODE_ENV'] = 'production'
    })

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv
    })

    it('returns an empty object in production mode', () => {
      const result = createLoggingMiddleware()
      expect(result).toEqual({})
    })

    it('does not have an events key in production mode', () => {
      const result = createLoggingMiddleware()
      expect(result).not.toHaveProperty('events')
    })

    it('the returned empty object does not call console when used', () => {
      const result = createLoggingMiddleware()
      // Spread should not cause errors even if no events key
      const events = (result as { events?: { onStateChange?: (s: VoiceFormState) => void } }).events
      expect(events).toBeUndefined()
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })
})
