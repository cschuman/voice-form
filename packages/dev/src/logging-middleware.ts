/**
 * @voiceform/dev — Logging Middleware
 *
 * Provides `createLoggingMiddleware`, which wraps a `VoiceFormConfig` with
 * console logging for state transitions and errors. Developer callbacks are
 * always chained — never replaced. No-op in production.
 *
 * Security review #8: The `callbacks` option is the correct pattern for
 * preserving your existing event handlers when adding logging. Spreading the
 * returned object over a config that already has `events` would silently drop
 * those existing handlers. Always pass them via `callbacks`.
 */

import type { VoiceFormConfig } from '@voiceform/core'

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Events that can be chained through the logging middleware. */
type ChainableEvents = Pick<
  NonNullable<VoiceFormConfig['events']>,
  'onStateChange' | 'onError'
>

/**
 * Options for `createLoggingMiddleware`.
 */
export interface LoggingMiddlewareOptions {
  /**
   * When true, logs the full schema object in each processing group.
   * Default: false — logs field count only to keep output concise.
   */
  logFullSchema?: boolean

  /**
   * When true, logs the `rawResponse` field from `ParseResponse`.
   * Default: true.
   */
  logRawResponse?: boolean

  /**
   * Optional developer callbacks to chain with the logging callbacks.
   *
   * IMPORTANT (security review #8): Pass your existing `onStateChange` and
   * `onError` handlers here to ensure they fire alongside the logging
   * callbacks. Both are called — developer callback runs first, then logger.
   *
   * @example
   * const instance = createVoiceForm({
   *   ...appConfig,
   *   ...createLoggingMiddleware({ callbacks: appConfig.events }),
   * })
   */
  callbacks?: Partial<ChainableEvents>
}

// ─── createLoggingMiddleware ──────────────────────────────────────────────────

/**
 * Returns a partial `VoiceFormConfig` that wraps event handlers with console
 * logging for request/response timing, parsed fields, and errors.
 *
 * Usage:
 * ```ts
 * const instance = createVoiceForm({
 *   ...appConfig,
 *   ...createLoggingMiddleware({ callbacks: appConfig.events }),
 * })
 * ```
 *
 * IMPORTANT (security review #8): Always pass your existing callbacks via
 * the `callbacks` option to ensure they are chained. Spreading the result
 * replaces the `events` key — the `callbacks` option prevents handler loss.
 *
 * Returns `{}` in production (`process.env.NODE_ENV === 'production'`).
 *
 * @param options  Optional logging configuration.
 * @returns A `Pick<VoiceFormConfig, 'events'>` partial config, or `{}` in production.
 */
export function createLoggingMiddleware(
  options?: LoggingMiddlewareOptions,
): Pick<VoiceFormConfig, 'events'> {
  if (process.env['NODE_ENV'] === 'production') {
    return {}
  }

  let requestStartTime: number | null = null
  let requestNumber = 0

  return {
    events: {
      onStateChange(state) {
        // Chain developer callback first (security review #8).
        options?.callbacks?.onStateChange?.(state)

        if (state.status === 'processing') {
          requestNumber++
          requestStartTime = Date.now()
          const ts = new Date().toLocaleTimeString('en', {
            hour12: false,
            fractionalSecondDigits: 3,
          } as Intl.DateTimeFormatOptions)
          console.groupCollapsed(`voiceform dev — Request #${requestNumber}  [${ts}]`)
          console.log('Transcript', state.transcript)
        } else if (state.status === 'confirming' && requestStartTime !== null) {
          const elapsed = Date.now() - requestStartTime
          requestStartTime = null
          console.log(`─── Response [+${elapsed}ms] HTTP 200 ───`)
          console.table(
            Object.entries(state.confirmation.parsedFields).reduce<Record<string, unknown>>(
              (acc, [name, field]) => {
                acc[name] = {
                  value: field.value,
                  confidence: field.confidence ?? '—',
                }
                return acc
              },
              {},
            ),
          )
          console.groupEnd()
        } else if (state.status === 'error' && requestStartTime !== null) {
          requestStartTime = null
          console.groupEnd()
        }
      },

      onError(err) {
        // Chain developer callback first (security review #8).
        options?.callbacks?.onError?.(err)
        console.error('voiceform dev — Error', err.code, err.message)
      },
    },
  }
}
