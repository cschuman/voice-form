/**
 * SvelteKit API route example for voice-form BYOE endpoint
 *
 * Location: src/routes/api/voice-parse/+server.ts
 *
 * This example demonstrates:
 * - CSRF protection via X-VoiceForm-Request header validation
 * - Prompt injection mitigation with role-separated messages
 * - OpenAI API integration (with Anthropic alternative)
 * - Rate limiting guidance
 * - Proper error handling and response validation
 */

import { json, type RequestHandler } from '@sveltejs/kit'
import { buildSystemPrompt, buildUserPrompt } from '@voiceform/server-utils'
import type { ParseRequest, ParseResponse } from '@voiceform/core'
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Rate limiting: In production, implement per-IP or per-user rate limiting.
 *
 * Example with rate-limit-check (pseudocode):
 * ```ts
 * import { RateLimiter } from 'some-rate-limit-library'
 * const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 })
 *
 * if (!limiter.tryConsume(request.headers.get('x-forwarded-for'))) {
 *   return json({ error: 'Too many requests' }, { status: 429 })
 * }
 * ```
 */

export const POST: RequestHandler = async ({ request }) => {
  // Step 1: Validate CSRF token
  // The X-VoiceForm-Request header is set by the browser and acts as a CSRF check.
  // Without it, the request is rejected (403 Forbidden).
  const csrfToken = request.headers.get('X-VoiceForm-Request')
  if (!csrfToken) {
    console.warn('Rejected request: missing X-VoiceForm-Request header')
    return json(
      { error: 'Missing CSRF token' },
      { status: 403 },
    )
  }

  // Step 2: Parse request body
  let body: ParseRequest
  try {
    body = await request.json()
  } catch (err) {
    console.error('Failed to parse request body:', err)
    return json(
      { error: 'Invalid JSON in request body' },
      { status: 400 },
    )
  }

  const { transcript, schema, requestId } = body

  // Step 3: Validate request shape
  if (!transcript || typeof transcript !== 'string') {
    return json(
      { error: 'Missing or invalid transcript' },
      { status: 400 },
    )
  }

  if (!schema || !schema.fields || !Array.isArray(schema.fields)) {
    return json(
      { error: 'Missing or invalid schema' },
      { status: 400 },
    )
  }

  // Step 4: (Optional) Implement authentication middleware
  // Example:
  // const auth = await verifyAuthToken(request.headers.get('Authorization'))
  // if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

  // Step 5: Build prompts using role separation
  // CRITICAL: The transcript is passed in the user message, not interpolated into the system prompt.
  // This prevents prompt injection attacks.
  const systemPrompt = buildSystemPrompt(schema)
  const userPrompt = buildUserPrompt(transcript)

  // Step 6: Call the LLM with role-separated messages
  // Using OpenAI as the example. For Anthropic, use the client.messages API instead.
  let llmResponse: string
  try {
    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini', // Use a faster/cheaper model if budget is a concern
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0, // No creativity; extract data precisely
      max_tokens: 500, // Limit response length
    })

    llmResponse = result.choices[0]?.message?.content || ''
  } catch (err) {
    console.error(`OpenAI API error (request ${requestId}):`, err)
    return json(
      { error: 'Failed to process voice input' },
      { status: 500 },
    )
  }

  // Step 7: Parse the LLM response
  // The LLM returns a JSON object with a "fields" key.
  let parsed: ParseResponse['fields']
  try {
    const json_obj = JSON.parse(llmResponse)
    parsed = json_obj.fields || {}
  } catch (err) {
    console.error(`Failed to parse LLM response (request ${requestId}):`, err)
    return json(
      { error: 'Invalid LLM response format' },
      { status: 500 },
    )
  }

  // Step 8: Validate parsed fields match schema
  // Optional but recommended: ensure the LLM only returned fields from the schema.
  const validFieldNames = new Set(schema.fields.map((f) => f.name))
  const validatedFields: ParseResponse['fields'] = {}
  for (const [name, fieldValue] of Object.entries(parsed)) {
    if (validFieldNames.has(name) && fieldValue && typeof fieldValue.value === 'string') {
      validatedFields[name] = fieldValue
    }
  }

  // Step 9: Return the response
  const response: ParseResponse = {
    fields: validatedFields,
    rawResponse: llmResponse, // Optional; for debugging
  }

  return json(response)
}

/**
 * Alternative: Using Anthropic instead of OpenAI
 *
 * Replace the LLM call (Step 6) with:
 * ```ts
 * import Anthropic from "@anthropic-ai/sdk"
 *
 * const anthropic = new Anthropic({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * })
 *
 * const result = await anthropic.messages.create({
 *   model: 'claude-3-5-sonnet-20241022',
 *   max_tokens: 500,
 *   messages: [
 *     { role: 'user', content: userPrompt },
 *   ],
 *   system: systemPrompt,
 * })
 *
 * llmResponse = result.content[0]?.type === 'text' ? result.content[0].text : ''
 * ```
 */

/**
 * Security Checklist for this endpoint:
 *
 * ✓ CSRF token validation (X-VoiceForm-Request header)
 * ✓ Role-separated LLM prompts (system + user, not interpolation)
 * ✓ Transcript escaped via JSON.stringify in buildUserPrompt
 * ✓ Anti-injection instruction in buildSystemPrompt system prompt
 * ✓ HTTPS enforced (via SvelteKit's hook or hosting provider)
 * ✓ Authentication middleware placeholder (commented)
 * ✓ Rate limiting guidance (commented)
 * ✓ Error handling without leaking internals
 * ✓ LLM response validated before returning to client
 * ✓ Field values validated against schema
 *
 * Still TODO in production:
 * - [ ] Implement actual rate limiting
 * - [ ] Add authentication (OAuth, API key, JWT, etc.)
 * - [ ] Log accesses for security auditing
 * - [ ] Set appropriate CORS headers if called cross-origin
 * - [ ] Add monitoring/alerting for errors or unusual patterns
 */
