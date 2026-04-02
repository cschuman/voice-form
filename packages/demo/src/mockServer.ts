/**
 * Mock server for the voice-form demo
 *
 * This file provides a client-side mock of the BYOE endpoint.
 * In production, this would be a real backend endpoint.
 *
 * The mock endpoint at `/api/voice-parse` returns parsed values
 * using simple heuristics based on the transcript.
 */

import type { ParseRequest, ParseResponse } from '@voiceform/core'

/**
 * Register the mock server
 * Intercepts fetch calls to /api/voice-parse
 */
export function setupMockServer() {
  // Store the original fetch
  const originalFetch = globalThis.fetch

  // Override fetch to intercept our mock endpoint
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)

    // Only intercept our mock endpoint
    if (typeof url === 'string' && url.includes('/api/voice-parse')) {
      return mockVoiceParse(init)
    }

    // Pass through all other requests
    return originalFetch(input, init)
  }
}

/**
 * Mock implementation of the voice-parse endpoint
 */
async function mockVoiceParse(init?: RequestInit): Promise<Response> {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 800))

  try {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const request = body as Partial<ParseRequest>

    if (!request.transcript || typeof request.transcript !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing transcript' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const transcript = request.transcript.toLowerCase()

    // Simple extraction heuristics (mock LLM)
    const fields: ParseResponse['fields'] = {}

    // Extract full name
    const nameMatch = transcript.match(
      /(?:my name is|i'm|i am|this is)\s+([a-z]+(?:\s+[a-z]+)?)/i,
    )
    if (nameMatch) {
      fields.fullName = {
        value: nameMatch[1].split(' ').map(capitalize).join(' '),
        confidence: 0.85,
      }
    }

    // Extract email
    const emailMatch = transcript.match(
      /([a-z0-9]+)\s+at\s+([a-z0-9]+)\s+dot\s+([a-z]+)(?:\s+dot\s+([a-z]+))?/i,
    )
    if (emailMatch) {
      fields.email = {
        value: `${emailMatch[1]}@${emailMatch[2]}.${emailMatch[3]}${emailMatch[4] ? '.' + emailMatch[4] : ''}`.toLowerCase(),
        confidence: 0.92,
      }
    }

    // Extract phone
    const phoneMatch = transcript.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\d{10}/)
    if (phoneMatch) {
      fields.phone = {
        value: phoneMatch[0].replace(/[-.\s]/g, ''),
        confidence: 0.88,
      }
    }

    // Everything else is the message (up to 500 chars)
    if (transcript.length > 0) {
      fields.message = {
        value: transcript.slice(0, 500),
        confidence: 0.80,
      }
    }

    const response: ParseResponse = {
      fields,
      rawResponse: `Mock LLM parsed the transcript: "${request.transcript}"`,
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to process voice input' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}
