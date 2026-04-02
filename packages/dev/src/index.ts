/**
 * @voiceform/dev — Developer tooling for voice-form
 *
 * This package is intended for development environments only. All exports
 * are no-ops in production (`process.env.NODE_ENV === 'production'`).
 *
 * Available tools:
 * - `inspectSchema` — validates a FormSchema and returns rich diagnostics
 * - `validateSchemaAgainstDOM` — cross-checks a schema against live DOM elements
 * - `createLoggingMiddleware` — wraps VoiceFormConfig events with console logging
 * - `attachStateVisualizer` — attaches a fixed-position overlay showing live state
 * - `detachStateVisualizer` — removes the state visualizer overlay by element id
 *
 * @example
 * ```ts
 * // Gate on NODE_ENV to exclude from production bundles when tree-shaking
 * // is not available (e.g. CommonJS).
 * if (process.env.NODE_ENV !== 'production') {
 *   const { warnings } = inspectSchema(mySchema)
 *   warnings.forEach(w => console.warn(w))
 * }
 * ```
 */

export type { SchemaDiagnostic, SchemaInspectionResult, DOMValidationResult } from './schema-inspector.js'
export { inspectSchema, validateSchemaAgainstDOM } from './schema-inspector.js'

export type { LoggingMiddlewareOptions } from './logging-middleware.js'
export { createLoggingMiddleware } from './logging-middleware.js'

export type { StateVisualizerOptions } from './state-visualizer.js'
export { attachStateVisualizer, detachStateVisualizer } from './state-visualizer.js'
