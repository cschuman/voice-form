/**
 * Express.js route handler example for voice-form BYOE endpoint
 *
 * Usage:
 * ```ts
 * import express from 'express'
 * import voiceParseHandler from './voice-parse.js'
 *
 * const app = express()
 * app.use(express.json())
 * app.post('/api/voice-parse', voiceParseHandler)
 * app.listen(3000)
 * ```
 *
 * This example demonstrates:
 * - CSRF protection via X-VoiceForm-Request header validation
 * - Prompt injection mitigation with role-separated messages
 * - OpenAI API integration (with Anthropic alternative)
 * - Rate limiting guidance
 * - Proper error handling and response validation
 */

import { Request, Response } from 'express'
import { buildSystemPrompt, buildUserPrompt } from '@voiceform/server-utils'
import type { ParseRequest, ParseResponse } from '@voiceform/core'
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Rate limiting: In production, implement per-IP or per-user rate limiting.
 *
 * Example with express-rate-limit:
 * ```ts
 * import rateLimit from 'express-rate-limit'
 *
 * const limiter = rateLimit({
 *   windowMs: 1 * 60 * 1000, // 1 minute
 *   max: 10, // 10 requests per minute
 *   keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
 * })
 *
 * app.post('/api/voice-parse', limiter, voiceParseHandler)
 * ```
 */

async function voiceParseHandler(req: Request, res: Response): Promise<void> {
  // Step 1: Validate CSRF token
  // The X-VoiceForm-Request header is set by the browser and acts as a CSRF check.
  // Without it, the request is rejected (403 Forbidden).
  const csrfToken = req.headers['x-voiceform-request']
  if (!csrfToken) {
    console.warn('Rejected request: missing X-VoiceForm-Request header')
    res.status(403).json({ error: 'Missing CSRF token' })
    return
  }

  // Step 2: Parse request body
  const body = req.body as Partial<ParseRequest>

  // Step 3: Validate request shape
  if (!body.transcript || typeof body.transcript !== 'string') {
    res.status(400).json({ error: 'Missing or invalid transcript' })
    return
  }

  if (!body.schema || !body.schema.fields || !Array.isArray(body.schema.fields)) {
    res.status(400).json({ error: 'Missing or invalid schema' })
    return
  }

  const { transcript, schema, requestId } = body

  // Step 4: (Optional) Implement authentication middleware
  // Example:
  // const auth = req.headers.authorization?.split(' ')[1]
  // const user = await verifyJWT(auth)
  // if (!user) {
  //   res.status(401).json({ error: 'Unauthorized' })
  //   return
  // }

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
    res.status(500).json({ error: 'Failed to process voice input' })
    return
  }

  // Step 7: Parse the LLM response
  // The LLM returns a JSON object with a "fields" key.
  let parsed: ParseResponse['fields']
  try {
    const json_obj = JSON.parse(llmResponse)
    parsed = json_obj.fields || {}
  } catch (err) {
    console.error(`Failed to parse LLM response (request ${requestId}):`, err)
    res.status(500).json({ error: 'Invalid LLM response format' })
    return
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

  res.status(200).json(response)
}

export default voiceParseHandler

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
 * ✓ HTTPS enforced (via reverse proxy or hosting provider)
 * ✓ Authentication middleware placeholder (commented)
 * ✓ Rate limiting guidance (commented)
 * ✓ Error handling without leaking internals
 * ✓ LLM response validated before returning to client
 * ✓ Field values validated against schema
 *
 * Still TODO in production:
 * - [ ] Implement actual rate limiting (express-rate-limit, Redis, etc.)
 * - [ ] Add authentication (OAuth, API key, JWT, etc.)
 * - [ ] Log accesses for security auditing
 * - [ ] Set appropriate CORS headers if called cross-origin
 * - [ ] Add monitoring/alerting for errors or unusual patterns
 */
