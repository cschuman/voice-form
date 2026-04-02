/**
 * @voiceform/dev — State Visualizer
 *
 * Attaches a fixed-position dev overlay to `document.body` showing the current
 * state and last 5 transitions. Returns a detach function.
 *
 * Security (review #7): ALL dynamic content is written via `textContent`.
 * `innerHTML` is NEVER used for content that originates from application data
 * (transcripts, field values, error messages). The overlay structure is built
 * with `document.createElement` calls — not `innerHTML`.
 *
 * No-op in production — returns an empty function and appends nothing.
 */

import type { VoiceFormInstance } from '@voiceform/core'

// ─── Public Types ─────────────────────────────────────────────────────────────

/**
 * Options for `attachStateVisualizer`.
 */
export interface StateVisualizerOptions {
  /**
   * Corner of the viewport where the overlay is anchored.
   * Default: `'bottom-right'`.
   */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

  /**
   * When true, renders the full state object as formatted JSON in the overlay.
   * Uses `textContent` — safe for all values. Default: `false`.
   */
  verbose?: boolean
}

// ─── attachStateVisualizer ────────────────────────────────────────────────────

/**
 * Attaches a fixed-position dev overlay to `document.body` showing live state
 * transitions for the given `VoiceFormInstance`.
 *
 * Security (review #7): All content is written via `textContent`. Never `innerHTML`.
 * This means transcript text containing `<script>` tags is stored as raw text and
 * never executed.
 *
 * The returned function removes the overlay and cleans up subscriptions.
 * If `instance.destroy()` is called before the detach function, the overlay is
 * removed automatically.
 *
 * Returns a no-op function and appends nothing in production.
 *
 * @param instance  The `VoiceFormInstance` to observe.
 * @param options   Optional position and verbosity configuration.
 * @returns A `detach` function. Call it to remove the overlay.
 */
export function attachStateVisualizer(
  instance: VoiceFormInstance,
  options?: StateVisualizerOptions,
): () => void {
  if (process.env['NODE_ENV'] === 'production') {
    return () => {}
  }

  const overlay = buildOverlay(options?.position ?? 'bottom-right')
  document.body.appendChild(overlay)

  // Cache element references so the subscription handler avoids repeated DOM queries.
  const statusEl = overlay.querySelector<HTMLElement>('#vf-dev-status')!
  const transcriptEl = overlay.querySelector<HTMLElement>('#vf-dev-transcript')!
  const errorEl = overlay.querySelector<HTMLElement>('#vf-dev-error')!
  const historyEl = overlay.querySelector<HTMLElement>('#vf-dev-history')!
  const verboseEl = overlay.querySelector<HTMLElement>('#vf-dev-verbose')!

  const history: string[] = []

  const unsubscribe = instance.subscribe((state) => {
    // (security review #7): textContent ONLY. Never assign to innerHTML.
    statusEl.textContent = `● ${state.status}`
    transcriptEl.textContent = ''
    errorEl.textContent = ''
    verboseEl.textContent = ''

    if (state.status === 'recording' && state.interimTranscript) {
      // Interim transcript from STT — must use textContent (not innerHTML).
      transcriptEl.textContent = state.interimTranscript
    }
    if (state.status === 'processing') {
      // Final transcript — must use textContent (not innerHTML).
      transcriptEl.textContent = state.transcript
    }
    if (state.status === 'error') {
      // Error message may contain any string — must use textContent.
      errorEl.textContent = `${state.error.code}: ${state.error.message}`
    }
    if (options?.verbose === true) {
      // JSON.stringify output — safe as textContent, not innerHTML.
      verboseEl.textContent = JSON.stringify(state, null, 2)
    }

    history.unshift(`${Date.now() % 100000} ${state.status}`)
    if (history.length > 5) history.pop()
    historyEl.textContent = history.join('\n')
  })

  // Wrap instance.destroy() to auto-detach the overlay.
  // Monkey-patches the specific instance object, not its prototype.
  // The original is restored when detach() is called.
  const originalDestroy = instance.destroy.bind(instance)
  ;(instance as unknown as Record<string, unknown>)['destroy'] = () => {
    detach()
    originalDestroy()
  }

  function detach() {
    unsubscribe()
    overlay.remove()
    // Restore the original destroy so subsequent calls work as expected.
    ;(instance as unknown as Record<string, unknown>)['destroy'] = originalDestroy
  }

  return detach
}

// ─── detachStateVisualizer ────────────────────────────────────────────────────

/**
 * Removes a previously attached state visualizer overlay from the DOM.
 *
 * This is a best-effort fallback — it removes the element by id but cannot
 * unsubscribe from the instance subscription without the detach closure.
 * Prefer calling the function returned by `attachStateVisualizer` when possible.
 *
 * Safe to call even if no visualizer is currently attached (no-op).
 *
 * @param _instance  Unused; present for API symmetry with `attachStateVisualizer`.
 */
export function detachStateVisualizer(_instance?: VoiceFormInstance): void {
  const el = document.getElementById('vf-dev-visualizer')
  if (el) el.remove()
}

// ─── buildOverlay ─────────────────────────────────────────────────────────────

/**
 * Constructs the overlay HTMLElement using `document.createElement`.
 * Structure is built programmatically — never via `innerHTML`.
 */
function buildOverlay(
  position: NonNullable<StateVisualizerOptions['position']>,
): HTMLElement {
  const el = document.createElement('div')
  el.id = 'vf-dev-visualizer'
  el.setAttribute('data-vf-dev', 'true')

  const posStyles: Record<string, string> = {
    'top-left': 'top:12px; left:12px',
    'top-right': 'top:12px; right:12px',
    'bottom-left': 'bottom:12px; left:12px',
    'bottom-right': 'bottom:12px; right:12px',
  }

  el.style.cssText = [
    'position:fixed',
    posStyles[position] ?? posStyles['bottom-right'],
    'z-index:2147483647',
    'background-color:#1e1e2e',
    'color:#cdd6f4',
    'font-family:monospace',
    'font-size:12px',
    'padding:12px 16px',
    'border-radius:8px',
    'border:1px solid #45475a',
    'min-width:220px',
    'max-width:400px',
    'white-space:pre-wrap',
  ].join('; ')

  // Build overlay children using DOM methods — never innerHTML.
  const label = document.createElement('div')
  label.style.cssText = 'font-size:10px; color:#6c7086; margin-bottom:4px; user-select:none'
  label.textContent = 'voiceform dev'

  const status = document.createElement('div')
  status.id = 'vf-dev-status'

  const transcript = document.createElement('div')
  transcript.id = 'vf-dev-transcript'
  transcript.style.cssText = 'color:#89b4fa; margin-top:4px; word-break:break-word'

  const error = document.createElement('div')
  error.id = 'vf-dev-error'
  error.style.cssText = 'color:#f38ba8; margin-top:4px'

  const historyDiv = document.createElement('div')
  historyDiv.id = 'vf-dev-history'
  historyDiv.style.cssText = 'color:#585b70; margin-top:8px; font-size:10px'

  const verbose = document.createElement('pre')
  verbose.id = 'vf-dev-verbose'
  verbose.style.cssText =
    'color:#a6e3a1; margin-top:8px; font-size:10px; max-height:200px; overflow:auto'

  el.append(label, status, transcript, error, historyDiv, verbose)
  return el
}
