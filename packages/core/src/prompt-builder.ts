/**
 * @voiceform/core — Prompt builder
 *
 * Responsible for two things:
 *   1. `buildPrompt` — assembles the `EndpointPayload` that is POSTed to the
 *      developer's BYOE endpoint. Contains the transcript, the full schema, and
 *      request metadata. No LLM prompt template strings live here; those belong
 *      in `@voiceform/server-utils`.
 *   2. `buildFieldPrompt` — serializes the schema fields into a human-readable
 *      string suitable for inclusion in an LLM prompt. This is the one
 *      prompt-related function that stays in core because it operates purely on
 *      the schema structure and has no browser or Node-specific dependencies.
 *
 * Canonical spec: docs/TASKS.md § P1-05
 */

import type { FormSchema, FieldSchema } from './types.js'

// ─── Version constant ─────────────────────────────────────────────────────────

/** Package version included in every endpoint payload for server-side diagnostics. */
export const VERSION = '0.0.0'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Metadata attached to every endpoint request.
 * Lets the server correlate logs and detect version mismatches without
 * requiring the developer to maintain their own request tracking.
 */
export interface EndpointPayloadMeta {
  /** Semver version of @voiceform/core that produced this payload. */
  version: string
  /** Unix timestamp (ms) at the moment buildPrompt was called. */
  timestamp: number
  /** UUID v4 uniquely identifying this request. Useful for idempotency and log correlation. */
  requestId: string
}

/**
 * The request body POSTed to the developer's BYOE endpoint.
 * Developers should type their server handler's request body with this interface.
 *
 * @example
 * // In a SvelteKit +server.ts:
 * import type { EndpointPayload } from '@voiceform/core'
 * export const POST: RequestHandler = async ({ request }) => {
 *   const payload: EndpointPayload = await request.json()
 *   // forward to your LLM …
 * }
 */
export interface EndpointPayload {
  /** The final transcript from the STT adapter, passed through unchanged. */
  transcript: string
  /** The form schema as configured by the developer. */
  schema: FormSchema
  /** Request metadata for diagnostics and log correlation. */
  meta: EndpointPayloadMeta
}

// ─── Format hints ─────────────────────────────────────────────────────────────

/**
 * Returns a format hint string for field types that have a canonical wire format,
 * or `null` if no hint applies.
 *
 * These hints are included in the LLM prompt so the model knows what value shape
 * to produce for structured fields.
 *
 * @param type - The FieldSchema type to look up.
 * @returns A hint string (e.g. `"YYYY-MM-DD"`) or `null`.
 */
function formatHintForType(type: FieldSchema['type']): string | null {
  switch (type) {
    case 'date':
      return 'YYYY-MM-DD'
    case 'email':
      return 'email'
    case 'tel':
      return 'E.164'
    default:
      return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Assembles the `EndpointPayload` to POST to the developer's BYOE endpoint.
 *
 * This function has no side effects. It does not validate the transcript or
 * the schema — callers are responsible for ensuring both are valid before
 * calling this function (see `validateTranscript` and `validateSchema`).
 *
 * `crypto.randomUUID()` is used for `requestId`. All target browsers and
 * Node ≥ 19 support it natively. No Math.random fallback is provided.
 *
 * @param transcript - The final transcript string from the STT adapter.
 * @param schema - The validated form schema.
 * @returns A fully-formed `EndpointPayload` ready for JSON serialization.
 */
export function buildPrompt(transcript: string, schema: FormSchema): EndpointPayload {
  return {
    transcript,
    schema,
    meta: {
      version: VERSION,
      timestamp: Date.now(),
      requestId: crypto.randomUUID(),
    },
  }
}

/**
 * Serializes the schema's fields into a human-readable list for inclusion in an
 * LLM prompt. This is the canonical schema serialization format for voice-form;
 * `@voiceform/server-utils` embeds the output of this function in the system
 * prompt it sends to the LLM.
 *
 * Output format:
 * ```
 * Fields to extract:
 * - fieldName (Label): type[, options: [A, B]][, format: hint][, required]
 * ```
 *
 * @param schema - The form schema to serialize.
 * @returns A multi-line string describing the fields.
 *
 * @example
 * buildFieldPrompt({
 *   fields: [
 *     { name: 'email', label: 'Email Address', type: 'email', required: true },
 *     { name: 'plan', label: 'Plan', type: 'select', options: ['Basic', 'Pro'] },
 *   ]
 * })
 * // =>
 * // Fields to extract:
 * // - email (Email Address): email, format: email, required
 * // - plan (Plan): select, options: [Basic, Pro]
 */
export function buildFieldPrompt(schema: FormSchema): string {
  const fieldLines = schema.fields.map((field) => {
    const label = field.label ?? field.name
    const parts: string[] = [`${field.type}`]

    // Append options for select/radio fields
    if (
      (field.type === 'select' || field.type === 'radio') &&
      field.options &&
      field.options.length > 0
    ) {
      parts.push(`options: [${field.options.join(', ')}]`)
    }

    // Append format hint when applicable
    const hint = formatHintForType(field.type)
    if (hint !== null) {
      parts.push(`format: ${hint}`)
    }

    // Append required marker
    if (field.required === true) {
      parts.push('required')
    }

    return `- ${field.name} (${label}): ${parts.join(', ')}`
  })

  return ['Fields to extract:', ...fieldLines].join('\n')
}
