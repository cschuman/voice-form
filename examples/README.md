# Reference Endpoint Implementations

Complete working examples of voice-form BYOE (Bring Your Own Endpoint) implementations for popular frameworks.

Each example demonstrates:

- **CSRF protection** — Validating the `X-VoiceForm-Request` header
- **Prompt injection mitigation** — Using role-separated messages with `buildSystemPrompt` and `buildUserPrompt`
- **LLM integration** — Calling OpenAI (with Anthropic as alternative)
- **Response validation** — Ensuring the LLM response matches the expected schema
- **Error handling** — Proper error responses without leaking internals
- **Rate limiting guidance** — Comments on implementing rate limits
- **Security checklist** — Reminders of what to do before production

## SvelteKit

**File:** `sveltekit/+server.ts`

Location in your SvelteKit project: `src/routes/api/voice-parse/+server.ts`

**Usage:**

```ts
import { POST } from './+server.ts'

// The handler is the default export
```

Key features:

- `RequestHandler` type safety
- `@sveltejs/kit` imports (`json`, `RequestHandler`)
- SvelteKit conventions (request, return json responses)

## Next.js (App Router)

**File:** `nextjs/route.ts`

Location in your Next.js project: `app/api/voice-parse/route.ts`

**Usage:**

```ts
export { POST } from './route.ts'
```

Key features:

- `NextRequest` and `NextResponse` types
- App Router conventions (async function named `POST`)
- Built-in middleware support

## Express.js

**File:** `express/voice-parse.ts`

Usage in your Express app:

```ts
import express from 'express'
import voiceParseHandler from './voice-parse.ts'

const app = express()
app.use(express.json())
app.post('/api/voice-parse', voiceParseHandler)
app.listen(3000)
```

Key features:

- Standard Express middleware pattern
- `Request` and `Response` types from `express`
- Easily composable with other middleware (auth, rate limiting, etc.)

## Common Patterns Across All Examples

### 1. CSRF Validation

All examples check for the `X-VoiceForm-Request` header:

```ts
const csrfToken = request.headers.get('X-VoiceForm-Request')
if (!csrfToken) {
  return json({ error: 'Missing CSRF token' }, { status: 403 })
}
```

### 2. Request Parsing and Validation

Parse the request body and validate the shape:

```ts
const { transcript, schema, requestId } = req.body

if (!transcript || typeof transcript !== 'string') {
  return json({ error: 'Missing transcript' }, { status: 400 })
}

if (!schema || !Array.isArray(schema.fields)) {
  return json({ error: 'Invalid schema' }, { status: 400 })
}
```

### 3. Prompt Construction

Use the server-utils to build prompts:

```ts
import { buildSystemPrompt, buildUserPrompt } from '@voiceform/server-utils'

const systemPrompt = buildSystemPrompt(schema)
const userPrompt = buildUserPrompt(transcript)

const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userPrompt },
]
```

### 4. LLM Call (OpenAI Example)

```ts
const result = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages,
  temperature: 0,
  max_tokens: 500,
})

const llmResponse = result.choices[0]?.message?.content || ''
```

### 5. Response Parsing and Validation

```ts
let parsed: ParseResponse['fields']
try {
  const json_obj = JSON.parse(llmResponse)
  parsed = json_obj.fields || {}
} catch (err) {
  return json({ error: 'Invalid LLM response' }, { status: 500 })
}
```

### 6. Field Validation

Ensure returned fields are in the schema:

```ts
const validFieldNames = new Set(schema.fields.map((f) => f.name))
const validatedFields: ParseResponse['fields'] = {}

for (const [name, fieldValue] of Object.entries(parsed)) {
  if (validFieldNames.has(name) && fieldValue?.value) {
    validatedFields[name] = fieldValue
  }
}
```

### 7. Return the Response

```ts
const response: ParseResponse = {
  fields: validatedFields,
  rawResponse: llmResponse, // Optional
}

return json(response) // Or NextResponse.json() or res.json()
```

## Customization

### Using Anthropic Instead of OpenAI

Replace the LLM call with:

```ts
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const result = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 500,
  system: systemPrompt,
  messages: [
    { role: 'user', content: userPrompt },
  ],
})

llmResponse = result.content[0]?.type === 'text' ? result.content[0].text : ''
```

### Adding Authentication

```ts
const token = request.headers.get('Authorization')?.split(' ')[1]

// For JWT
const user = await verifyJWT(token)
if (!user) {
  return json({ error: 'Unauthorized' }, { status: 401 })
}

// For API keys
const apiKey = request.headers.get('X-API-Key')
if (!isValidApiKey(apiKey)) {
  return json({ error: 'Invalid API key' }, { status: 401 })
}
```

### Adding Rate Limiting

```ts
// Express: express-rate-limit
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
})

app.post('/api/voice-parse', limiter, voiceParseHandler)

// Next.js: Custom implementation
function getCacheKey(request: NextRequest): string {
  return request.headers.get('Authorization') || request.ip || 'unknown'
}

async function checkRateLimit(key: string): Promise<boolean> {
  // Implement with Redis, Upstash, or similar
  const count = await redis.incr(`voice-parse:${key}`)
  if (count === 1) {
    await redis.expire(`voice-parse:${key}`, 60)
  }
  return count <= 10
}
```

### Logging

```ts
// Log only metadata, not the transcript
logger.info(`Voice parse request: ${requestId}`, {
  userId: user?.id,
  fieldCount: schema.fields.length,
  timestamp: new Date().toISOString(),
})

// Log errors with context
logger.error(`LLM error (${requestId}):`, {
  error: err.message,
  model: 'gpt-4o-mini',
})
```

## Deployment

### SvelteKit

Deploy to any Node.js host (Vercel, Railway, Render, etc.):

```bash
pnpm build
node build
```

Or use SvelteKit's adapters for Vercel, Netlify, etc.

### Next.js

Deploy to Vercel (recommended) or any Node.js host:

```bash
pnpm build
pnpm start
```

Or push to GitHub and deploy via Vercel's GitHub integration.

### Express

Deploy to any Node.js host:

```bash
pnpm build
node dist/server.js
```

Or use PM2, Docker, etc. for process management.

## Environment Variables

All examples expect:

```
OPENAI_API_KEY=sk-...  # Or ANTHROPIC_API_KEY
```

For deployment, set these in your host's environment:

- **Vercel:** Project Settings → Environment Variables
- **Railway/Render:** Environment tab
- **Docker:** `.env` file or `docker run -e`

## Security Checklist Before Production

- [ ] HTTPS enabled (enforced at host level)
- [ ] CSRF validation working (X-VoiceForm-Request header)
- [ ] Authentication implemented (if needed)
- [ ] Rate limiting implemented (10-20 requests/minute per user)
- [ ] Error messages are generic (don't leak stack traces or keys)
- [ ] Transcripts are not logged
- [ ] LLM response is validated before injection
- [ ] Fields are validated against schema
- [ ] Dependencies are up to date (`pnpm audit`)
- [ ] Environment variables are secure (not committed to git)
- [ ] Monitoring/alerting is set up for errors

## Questions?

See the main [SECURITY.md](../docs/SECURITY.md) for the full security checklist.

See [API.md](../docs/API.md) for the full `ParseRequest` and `ParseResponse` types.
