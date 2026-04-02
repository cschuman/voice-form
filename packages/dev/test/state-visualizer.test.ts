// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { VoiceFormInstance, VoiceFormState, StateListener } from '@voiceform/core'
import { attachStateVisualizer } from '../src/state-visualizer.js'

// ─── Mock VoiceFormInstance ───────────────────────────────────────────────────

type MockInstance = VoiceFormInstance & {
  _emit: (state: VoiceFormState) => void
  _destroyCallCount: number
}

function makeMockInstance(): MockInstance {
  const listeners: StateListener[] = []
  let destroyCallCount = 0
  let state: VoiceFormState = { status: 'idle' }

  const instance: MockInstance = {
    getState: () => state,
    getParsedFields: () => null,
    start: async () => {},
    stop: () => {},
    cancel: () => {},
    confirm: async () => {},
    updateSchema: () => {},
    setSchema: () => {},
    getSchema: () => ({ fields: [] }),
    correctField: () => false,
    destroy: () => {
      destroyCallCount++
    },
    subscribe: (listener: StateListener) => {
      listeners.push(listener)
      return () => {
        const idx = listeners.indexOf(listener)
        if (idx !== -1) listeners.splice(idx, 1)
      }
    },
    _emit: (newState: VoiceFormState) => {
      state = newState
      listeners.forEach((l) => l(newState))
    },
    get _destroyCallCount() {
      return destroyCallCount
    },
  }

  return instance
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('attachStateVisualizer', () => {
  let instance: MockInstance

  beforeEach(() => {
    instance = makeMockInstance()
    // Clean up any lingering overlay from a previous test
    document.getElementById('vf-dev-visualizer')?.remove()
  })

  afterEach(() => {
    // Ensure clean DOM after each test
    document.getElementById('vf-dev-visualizer')?.remove()
  })

  describe('attachment', () => {
    it('appends the overlay element to document.body', () => {
      attachStateVisualizer(instance)
      const overlay = document.getElementById('vf-dev-visualizer')
      expect(overlay).not.toBeNull()
      expect(document.body.contains(overlay)).toBe(true)
    })

    it('returns a detach function', () => {
      const detach = attachStateVisualizer(instance)
      expect(typeof detach).toBe('function')
    })
  })

  describe('detachment', () => {
    it('removes the overlay from the DOM when detach is called', () => {
      const detach = attachStateVisualizer(instance)
      expect(document.getElementById('vf-dev-visualizer')).not.toBeNull()
      detach()
      expect(document.getElementById('vf-dev-visualizer')).toBeNull()
    })

    it('auto-detaches when instance.destroy() is called', () => {
      attachStateVisualizer(instance)
      expect(document.getElementById('vf-dev-visualizer')).not.toBeNull()

      // Calling the patched destroy should auto-clean the overlay
      instance.destroy()

      expect(document.getElementById('vf-dev-visualizer')).toBeNull()
    })

    it('still calls the original destroy logic when auto-detaching', () => {
      const originalDestroy = vi.fn()
      ;(instance as Record<string, unknown>)['destroy'] = originalDestroy

      attachStateVisualizer(instance)
      instance.destroy()

      expect(originalDestroy).toHaveBeenCalledOnce()
    })
  })

  describe('content updates use textContent, never innerHTML', () => {
    it('renders status via textContent', () => {
      attachStateVisualizer(instance)
      instance._emit({ status: 'recording', interimTranscript: '' })

      const statusEl = document.getElementById('vf-dev-status')
      expect(statusEl).not.toBeNull()
      expect(statusEl?.textContent).toContain('recording')
    })

    it('renders interim transcript via textContent, not innerHTML', () => {
      attachStateVisualizer(instance)
      const xssPayload = '<script>alert("xss")</script>'
      instance._emit({ status: 'recording', interimTranscript: xssPayload })

      const transcriptEl = document.getElementById('vf-dev-transcript')
      expect(transcriptEl).not.toBeNull()
      // innerHTML would interpret the script tag; textContent stores it as raw text
      expect(transcriptEl?.textContent).toBe(xssPayload)
      // The script tag should NOT be parsed into a child element
      expect(transcriptEl?.querySelector('script')).toBeNull()
    })

    it('renders error text via textContent, not innerHTML', () => {
      attachStateVisualizer(instance)
      const xssPayload = '<img src=x onerror="alert(1)">'
      instance._emit({
        status: 'error',
        error: { code: 'UNKNOWN', message: xssPayload, recoverable: true },
        previousStatus: 'processing',
      })

      const errorEl = document.getElementById('vf-dev-error')
      expect(errorEl).not.toBeNull()
      // textContent stores raw, innerHTML would parse the img tag
      expect(errorEl?.textContent).toContain(xssPayload)
      expect(errorEl?.querySelector('img')).toBeNull()
    })

    it('renders processing transcript via textContent', () => {
      attachStateVisualizer(instance)
      instance._emit({ status: 'processing', transcript: 'hello world' })

      const transcriptEl = document.getElementById('vf-dev-transcript')
      expect(transcriptEl?.textContent).toBe('hello world')
    })
  })

  describe('verbose mode', () => {
    it('renders full state JSON in verbose element when verbose:true', () => {
      attachStateVisualizer(instance, { verbose: true })
      instance._emit({ status: 'idle' })

      const verboseEl = document.getElementById('vf-dev-verbose')
      expect(verboseEl).not.toBeNull()
      expect(verboseEl?.textContent).toContain('idle')
    })

    it('does not populate verbose element when verbose is false', () => {
      attachStateVisualizer(instance, { verbose: false })
      instance._emit({ status: 'idle' })

      const verboseEl = document.getElementById('vf-dev-verbose')
      expect(verboseEl?.textContent ?? '').toBe('')
    })
  })

  describe('position option', () => {
    it('applies top-left positioning style', () => {
      attachStateVisualizer(instance, { position: 'top-left' })
      const overlay = document.getElementById('vf-dev-visualizer') as HTMLElement
      expect(overlay).not.toBeNull()
      // jsdom reflects individual style properties rather than cssText
      expect(overlay.style.top).toBeTruthy()
      expect(overlay.style.left).toBeTruthy()
    })

    it('applies bottom-right positioning style', () => {
      attachStateVisualizer(instance, { position: 'bottom-right' })
      const overlay = document.getElementById('vf-dev-visualizer') as HTMLElement
      expect(overlay).not.toBeNull()
      expect(overlay.style.bottom).toBeTruthy()
      expect(overlay.style.right).toBeTruthy()
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

    it('returns a no-op function without appending any DOM in production', () => {
      const detach = attachStateVisualizer(instance)
      expect(document.getElementById('vf-dev-visualizer')).toBeNull()
      expect(typeof detach).toBe('function')
      expect(() => detach()).not.toThrow()
    })
  })
})
