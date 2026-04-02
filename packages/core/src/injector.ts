/**
 * @voiceform/core — DOM Injector / Field Callback Orchestrator
 *
 * Implements two modes of operation:
 *
 * 1. **Callback mode** — when `config.onFill` is provided, calls it for each
 *    field in series (awaiting async callbacks one at a time). If a callback
 *    throws or rejects, the field is recorded as failed and iteration
 *    continues to the next field.
 *
 * 2. **DOM injection mode** — when `config.formElement` is provided, locates
 *    each named element and injects its value using native property setters,
 *    then dispatches synthetic `input` and `change` events.  All writes are
 *    batched into a single `requestAnimationFrame` callback (two-pass:
 *    write-all → dispatch-all) to prevent interleaved layout thrash.
 *
 * Security:
 *   Every string value passes through `sanitizeFieldValue` before being
 *   written to the DOM.  This is the primary XSS defence for LLM output.
 *   (CRIT-001)
 *
 * Performance:
 *   - Module-scoped native setter cache (PERF 2.4) — resolved once at module
 *     load time and shared across all injector instances and calls.
 *   - Per-instance element reference cache (PERF 2.8) — Map keyed by field
 *     name, invalidated via `clearCache()`.
 *   - Two-pass batched injection inside a single rAF callback to keep all
 *     DOM writes in one frame.
 */

import { sanitizeFieldValue } from './utils/sanitize.js'
import type { FieldType, InjectionResult, FieldInjectionOutcome, ParsedFieldValue } from './types.js'

// ─── Module-scope native setter cache ────────────────────────────────────────
//
// Resolved ONCE at module load — never per-instance, never per-call.
// Using the native setter bypasses framework value-tracker overrides (e.g.
// React controlled-component internals) so that synthetic events are
// correctly interpreted as real user input by React's reconciler.
// (PERF 2.4)

const nativeInputSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
)?.set

const nativeTextAreaSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value',
)?.set

// ─── Truthy strings for checkbox fields ───────────────────────────────────────
//
// LLM returns strings for all field types.  For checkboxes we map a set of
// canonical truthy strings to `checked = true`; everything else → false.

const TRUTHY_VALUES = new Set(['true', 'yes', '1', 'on', 'checked'])

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Configuration for {@link createInjector}.
 *
 * Exactly one of `formElement` or `onFill` should be supplied:
 * - Supply `formElement` for the built-in DOM injection path.
 * - Supply `onFill` to delegate value-setting to user code (headless mode).
 *
 * If both are provided, `onFill` takes precedence.
 */
export interface InjectorConfig {
  /**
   * The form element (or a root element containing the form) to scope
   * DOM queries against.  Used only in DOM injection mode.
   */
  formElement?: HTMLElement

  /**
   * Developer-supplied callback invoked for each field in callback mode.
   * Receives the field name and the sanitized value.
   * May be synchronous or async; async variants are awaited in series.
   */
  onFill?: (
    fieldName: string,
    value: string | boolean | string[],
  ) => void | Promise<void>
}

/**
 * The object returned by {@link createInjector}.
 */
export interface Injector {
  /**
   * Inject the supplied parsed field values.
   *
   * In callback mode the `onFill` callback is invoked for each field in
   * insertion order, awaited in series.
   *
   * In DOM injection mode element lookup, value write, and event dispatch all
   * happen inside a single `requestAnimationFrame` callback (two-pass batch).
   *
   * @returns A Promise that resolves to an {@link InjectionResult} describing
   *   the per-field outcome.
   */
  inject(fields: Record<string, ParsedFieldValue>): Promise<InjectionResult>

  /**
   * Clears the internal element lookup cache.
   *
   * Call this whenever the form DOM is known to have been reconstructed, or
   * when `updateSchema()` is called on the parent `VoiceFormInstance`, so
   * that the next `inject()` call re-queries for freshly mounted elements.
   * (PERF 2.8)
   */
  clearCache(): void
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates an {@link Injector} configured for either callback mode or DOM
 * injection mode.
 *
 * @example Callback mode
 * ```typescript
 * const injector = createInjector({
 *   onFill: (name, value) => {
 *     myForm.setValue(name, value)
 *   },
 * })
 * await injector.inject(parsedFields)
 * ```
 *
 * @example DOM injection mode
 * ```typescript
 * const injector = createInjector({ formElement: document.querySelector('form')! })
 * await injector.inject(parsedFields)
 * ```
 */
export function createInjector(config: InjectorConfig): Injector {
  // Per-instance element cache: Map<fieldName, HTMLElement | null>
  // `null` means "we looked and found nothing" — avoids repeated failed queries.
  const elementCache = new Map<string, HTMLElement | null>()

  // ── Callback mode ────────────────────────────────────────────────────────
  if (config.onFill) {
    const { onFill } = config
    return {
      inject: (fields) => runCallbackMode(fields, onFill),
      clearCache: () => { /* no-op in callback mode */ },
    }
  }

  // ── DOM injection mode ───────────────────────────────────────────────────
  const root: HTMLElement | Document = config.formElement ?? document

  return {
    inject: (fields) => runDomMode(fields, root, elementCache),
    clearCache: () => elementCache.clear(),
  }
}

// ─── Callback mode implementation ────────────────────────────────────────────

async function runCallbackMode(
  fields: Record<string, ParsedFieldValue>,
  onFill: NonNullable<InjectorConfig['onFill']>,
): Promise<InjectionResult> {
  const outcomes: Record<string, FieldInjectionOutcome> = {}

  for (const [fieldName, parsed] of Object.entries(fields)) {
    try {
      // Await in series — no Promise.all — to preserve deterministic order and
      // give the callback a chance to react to each value before the next is set.
      await onFill(fieldName, parsed.value)
      outcomes[fieldName] = { status: 'injected', value: parsed.value }
    } catch (err) {
      outcomes[fieldName] = {
        status: 'failed',
        error: errorMessage(err),
      }
    }
  }

  return buildResult(outcomes)
}

// ─── DOM injection mode implementation ───────────────────────────────────────

/**
 * Schedules the two-pass batched injection inside a single rAF callback and
 * returns a Promise that resolves once the frame has executed.
 *
 * Phase 1: Write all values using native setters (no events fired).
 * Phase 2: Dispatch `input` + `change` events on every element that was written.
 *
 * This keeps all DOM writes in a single frame, preventing interleaved
 * layout thrash caused by alternating write/read cycles. (PERF 2.4)
 */
function runDomMode(
  fields: Record<string, ParsedFieldValue>,
  root: HTMLElement | Document,
  elementCache: Map<string, HTMLElement | null>,
): Promise<InjectionResult> {
  return new Promise<InjectionResult>((resolve) => {
    requestAnimationFrame(() => {
      const outcomes: Record<string, FieldInjectionOutcome> = {}

      // Pre-resolve all elements and sanitize all values BEFORE Phase 1 so
      // that nothing inside the rAF callback can throw unexpectedly and leave
      // the DOM in a half-written state.
      type FieldWork =
        | { kind: 'skip'; reason: FieldInjectionOutcome }
        | { kind: 'text'; el: HTMLInputElement | HTMLTextAreaElement; value: string }
        | { kind: 'select'; el: HTMLSelectElement; value: string }
        | { kind: 'checkbox'; el: HTMLInputElement; checked: boolean }
        | { kind: 'radio'; allRadios: HTMLInputElement[]; targetValue: string }

      const work: Array<{ name: string; plan: FieldWork }> = []

      for (const [fieldName, parsed] of Object.entries(fields)) {
        const el = resolveElement(fieldName, root, elementCache)

        if (el === null) {
          work.push({
            name: fieldName,
            plan: { kind: 'skip', reason: { status: 'skipped', reason: 'element-not-found' } },
          })
          continue
        }

        if (el.hasAttribute('disabled')) {
          work.push({
            name: fieldName,
            plan: { kind: 'skip', reason: { status: 'skipped', reason: 'disabled' } },
          })
          continue
        }

        if (el.hasAttribute('readonly')) {
          work.push({
            name: fieldName,
            plan: { kind: 'skip', reason: { status: 'skipped', reason: 'read-only' } },
          })
          continue
        }

        // Determine the field type from the element itself.
        const fieldType = detectFieldType(el)

        // Sanitize the raw LLM value before it touches the DOM.
        // For select and radio elements the injector does not have access to
        // the schema's options list, so we sanitize as 'text' (HTML strip only)
        // and perform the option-membership check inline against the live DOM.
        const sanitizeType: FieldType =
          fieldType === 'select' || fieldType === 'radio' ? 'text' : fieldType

        let sanitizedValue: string
        try {
          const result = sanitizeFieldValue(parsed.value, sanitizeType)
          sanitizedValue = typeof result.value === 'string' ? result.value : String(result.value)
        } catch {
          outcomes[fieldName] = { status: 'failed', error: 'INVALID_FIELD_VALUE' }
          continue
        }

        // Build the work plan for this field based on element type.
        if (el instanceof HTMLSelectElement) {
          // Validate the value against the select's own option list.
          // Iterate directly — avoids allocating two intermediate arrays per call.
          let matchIndex = -1
          const optionCount = el.options.length
          for (let i = 0; i < optionCount; i++) {
            if (el.options[i]!.value === sanitizedValue) { matchIndex = i; break }
          }
          if (optionCount > 0 && matchIndex === -1) {
            work.push({
              name: fieldName,
              plan: { kind: 'skip', reason: { status: 'skipped', reason: 'value-not-in-options' } },
            })
            continue
          }
          work.push({ name: fieldName, plan: { kind: 'select', el, value: sanitizedValue } })
        } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
          work.push({
            name: fieldName,
            plan: {
              kind: 'checkbox',
              el,
              checked: TRUTHY_VALUES.has(sanitizedValue.toLowerCase()),
            },
          })
        } else if (el instanceof HTMLInputElement && el.type === 'radio') {
          // Find ALL radio inputs that share this name within the root.
          const escaped = CSS.escape(fieldName)
          const allRadios = Array.from(
            root.querySelectorAll<HTMLInputElement>(`[name="${escaped}"]`),
          ).filter((r): r is HTMLInputElement => r instanceof HTMLInputElement && r.type === 'radio')
          work.push({
            name: fieldName,
            plan: { kind: 'radio', allRadios, targetValue: sanitizedValue },
          })
        } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          work.push({ name: fieldName, plan: { kind: 'text', el, value: sanitizedValue } })
        } else {
          // Unknown element type — skip.
          outcomes[fieldName] = { status: 'failed', error: 'Unsupported element type' }
          continue
        }
      }

      // ── Phase 1: write all values, no events ─────────────────────────────
      for (const { plan } of work) {
        switch (plan.kind) {
          case 'skip':
            break
          case 'text':
            setNativeValue(plan.el, plan.value)
            break
          case 'select':
            plan.el.value = plan.value
            break
          case 'checkbox':
            plan.el.checked = plan.checked
            break
          case 'radio': {
            for (const radio of plan.allRadios) {
              radio.checked = radio.value === plan.targetValue
            }
            break
          }
        }
      }

      // ── Phase 2: dispatch events for all written fields ───────────────────
      for (const { name: fieldName, plan } of work) {
        switch (plan.kind) {
          case 'skip':
            outcomes[fieldName] = plan.reason
            break
          case 'text': {
            plan.el.dispatchEvent(new Event('input', { bubbles: true }))
            plan.el.dispatchEvent(new Event('change', { bubbles: true }))
            outcomes[fieldName] = { status: 'injected', value: plan.value }
            break
          }
          case 'select':
            plan.el.dispatchEvent(new Event('change', { bubbles: true }))
            outcomes[fieldName] = { status: 'injected', value: plan.value }
            break
          case 'checkbox':
            plan.el.dispatchEvent(new Event('change', { bubbles: true }))
            outcomes[fieldName] = {
              status: 'injected',
              value: String(plan.checked),
            }
            break
          case 'radio': {
            const target = plan.allRadios.find((r) => r.value === plan.targetValue)
            if (target) {
              target.dispatchEvent(new Event('change', { bubbles: true }))
              outcomes[fieldName] = { status: 'injected', value: plan.targetValue }
            } else {
              outcomes[fieldName] = { status: 'skipped', reason: 'element-not-found' }
            }
            break
          }
        }
      }

      resolve(buildResult(outcomes))
    })
  })
}

// ─── Element lookup ───────────────────────────────────────────────────────────

/**
 * Resolves a field name to its DOM element using the three-step lookup
 * strategy specified in the LLD (§ 4d):
 *
 * 1. `[name="<escaped>"]`
 * 2. `#<escaped>`
 * 3. `[data-voiceform="<escaped>"]`
 *
 * Results are stored in `elementCache` after the first lookup so that
 * repeated `inject()` calls do not issue redundant DOM queries. (PERF 2.8)
 *
 * `CSS.escape` is applied to the field name in every selector to prevent
 * CSS selector injection from field names containing dots, brackets, or
 * other special characters. (MED-002)
 */
function resolveElement(
  fieldName: string,
  root: HTMLElement | Document,
  cache: Map<string, HTMLElement | null>,
): HTMLElement | null {
  if (cache.has(fieldName)) {
    return cache.get(fieldName) ?? null
  }

  const escaped = CSS.escape(fieldName)

  const el =
    (root.querySelector(`[name="${escaped}"]`) as HTMLElement | null) ??
    (root.querySelector(`#${escaped}`) as HTMLElement | null) ??
    (root.querySelector(`[data-voiceform="${escaped}"]`) as HTMLElement | null)

  cache.set(fieldName, el)
  return el
}

// ─── Native setter helper ─────────────────────────────────────────────────────

/**
 * Sets an input or textarea value via the native property descriptor setter.
 *
 * Using `element.value = "..."` directly is intercepted by React's controlled-
 * component override, which means the subsequent synthetic `input` / `change`
 * events are ignored by React's reconciler.  Calling the original native setter
 * bypasses that override so that the events are treated as real user input.
 */
function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const setter =
    element instanceof HTMLTextAreaElement ? nativeTextAreaSetter : nativeInputSetter
  setter?.call(element, value)
}

// ─── Field type detection ─────────────────────────────────────────────────────

/**
 * Infers the {@link FieldType} for sanitization purposes from the element's
 * tag name and `type` attribute.  This is a best-effort mapping — the schema
 * is not available inside the injector, so we use the DOM as the source of
 * truth for the element's type.
 */
function detectFieldType(el: HTMLElement): FieldType {
  if (el instanceof HTMLTextAreaElement) return 'textarea'
  if (el instanceof HTMLSelectElement) return 'select'
  if (el instanceof HTMLInputElement) {
    switch (el.type) {
      case 'email':    return 'email'
      case 'tel':      return 'tel'
      case 'number':   return 'number'
      case 'date':     return 'date'
      case 'checkbox': return 'checkbox'
      case 'radio':    return 'radio'
      default:         return 'text'
    }
  }
  return 'text'
}

// ─── Result builder ───────────────────────────────────────────────────────────

/**
 * Derives an {@link InjectionResult} from the per-field outcome map.
 * `success` is `true` only when every field has `status: 'injected'`.
 */
function buildResult(outcomes: Record<string, FieldInjectionOutcome>): InjectionResult {
  const success = Object.values(outcomes).every((o) => o.status === 'injected')
  return { success, fields: outcomes }
}

// ─── Error helpers ────────────────────────────────────────────────────────────

/** Extracts a human-readable message string from an unknown thrown value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}
