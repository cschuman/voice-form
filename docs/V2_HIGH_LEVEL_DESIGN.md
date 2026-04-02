# voice-form: V2 High-Level Design (Backend / Infrastructure Scope)

**Status**: Draft
**Date**: 2026-04-01
**Version**: 2.0
**Audience**: Architects (review), engineers (low-level design input), frontend HLD author (merge target)

---

## Document Scope

This document covers the three backend and infrastructure features assigned to this scope for v2. A parallel frontend HLD document covers the remaining v2 features (partial fill, multi-step support, DOM auto-detection, field-level correction UX). The two documents will be merged into a unified V2_HLD before the engineering kickoff.

**Features in scope:**

1. **Whisper STT Adapter** — `@voiceform/core/adapters/whisper` (FR-104 through FR-107)
2. **`@voiceform/dev` Package** — schema inspector, request/response logger, state visualizer (FR-117 through FR-120)
3. **React Wrapper Architecture** — `@voiceform/react`, `useVoiceForm` hook, `<VoiceForm>` component, ref forwarding, controlled injection (FR-101 through FR-103, NFR-101)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Feature 1: Whisper STT Adapter](#3-feature-1-whisper-stt-adapter)
4. [Feature 2: @voiceform/dev Package](#4-feature-2-voiceformdev-package)
5. [Feature 3: React Wrapper Architecture](#5-feature-3-react-wrapper-architecture)
6. [Updated Package Structure and Dependency Graph](#6-updated-package-structure-and-dependency-graph)
7. [Technology Stack Rationale](#7-technology-stack-rationale)
8. [Key Considerations](#8-key-considerations)

---

## 1. Executive Summary

v1 delivered a working core engine, a Svelte wrapper, and a Web Speech API adapter. v2 extends the adapter model with Whisper support, brings the library to the React ecosystem, and adds a `@voiceform/dev` package for development-time debugging.

All three features build on v1's established patterns without requiring changes to `@voiceform/core`'s public API surface. That is a deliberate design constraint: the `STTAdapter` interface defined in v1 is proven sufficient for the Whisper adapter; the `VoiceFormInstance` interface is the integration surface for both `@voiceform/react` and `@voiceform/dev`. No core API breaking changes are required or introduced.

The three key architectural decisions for v2 are:

- **Whisper adapter ships as a subpath export of `@voiceform/core`**, not a separate package. The adapter is ~2–3 KB gzipped, satisfies the existing `STTAdapter` interface exactly, and has no dependencies beyond the browser's `MediaRecorder` API and `fetch`. A separate package would add publishing overhead with no benefit.
- **`@voiceform/react` is a thin hook + component layer over `createVoiceForm`**, following the same pattern as `@voiceform/svelte`. The hook owns the `VoiceFormInstance` lifecycle (`create` on mount, `destroy` on unmount) and bridges core state to React's rendering model via a single `useSyncExternalStore` subscription.
- **`@voiceform/dev` is a pure development utility** with `"sideEffects": false` in its `package.json`. It has no runtime footprint in production builds. Every export is a named function with no module-level side effects.

---

## 2. Architecture Overview

### 2.1 V2 System Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Developer's Web App                                                     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  React Application                                                 │  │
│  │                                                                    │  │
│  │  ┌──────────────────┐    ┌───────────────────────────────────────┐ │  │
│  │  │  Developer's     │    │  @voiceform/react                     │ │  │
│  │  │  Form Components │◄───│                                       │ │  │
│  │  │  (controlled)    │    │  useVoiceForm(options)                │ │  │
│  │  │                  │    │    └─► VoiceFormInstance (from core)  │ │  │
│  │  └──────────────────┘    │  <VoiceForm> component               │ │  │
│  │                          │    └─► render props / children-fn    │ │  │
│  │                          └───────────────────┬───────────────────┘ │  │
│  └────────────────────────────────────────────  │ ─────────────────────┘  │
│                                                 │                        │
│  ┌──────────────────────────────────────────────▼─────────────────────┐  │
│  │  @voiceform/core                                                    │  │
│  │                                                                     │  │
│  │  ┌─────────────┐  ┌─────────────────────────────────────────────┐  │  │
│  │  │   State     │  │  STT Adapter (pluggable)                    │  │  │
│  │  │   Machine   │  │                                             │  │  │
│  │  └─────────────┘  │  ┌──────────────────┐ ┌──────────────────┐ │  │  │
│  │  ┌─────────────┐  │  │ WebSpeechAdapter │ │  WhisperAdapter  │ │  │  │
│  │  │  Schema     │  │  │ @core/stt        │ │  @core/adapters/ │ │  │  │
│  │  │  Engine     │  │  │ (v1, default)    │ │  whisper (v2)    │ │  │  │
│  │  └─────────────┘  │  └──────────────────┘ └────────┬─────────┘ │  │  │
│  │  ┌─────────────┐  └────────────────────────────────│───────────┘  │  │
│  │  │  Endpoint   │                                   │              │  │
│  │  │  Client     │                                   │ POST audio   │  │
│  │  └─────────────┘                                   │ blob (BYOE)  │  │
│  │  ┌─────────────┐                                   ▼              │  │
│  │  │  DOM        │            ┌───────────────────────────────────┐  │  │
│  │  │  Injector   │            │  Developer's Transcription        │  │  │
│  │  └─────────────┘            │  Endpoint (Whisper proxy)         │  │  │
│  └─────────────────────────────┴───────────────────────────────────┘  │
│                                        │ { transcript: string }        │
│                                        ▼                               │
│                          ┌─────────────────────────────┐               │
│                          │  Developer's Parse Endpoint  │               │
│                          │  (existing BYOE endpoint)   │               │
│                          └─────────────────────────────┘               │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  @voiceform/dev (devDependency only — never in production build)  │  │
│  │                                                                   │  │
│  │  inspectSchema()          validateSchemaAgainstDOM()              │  │
│  │  createLoggingMiddleware()                                        │  │
│  │  attachStateVisualizer()  detachStateVisualizer()                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Whisper Two-Endpoint Data Flow

The Whisper adapter introduces a second BYOE endpoint — the transcription proxy — that is distinct from the existing parse endpoint. The audio never leaves the developer's infrastructure.

```
┌──────────┐  tap   ┌────────────┐  MediaRecorder   ┌──────────────────┐
│   User   │───────►│  Mic       │─────────────────►│  WhisperAdapter  │
└──────────┘        │  Button    │                  │  (collects       │
                    └────────────┘                  │   audio chunks)  │
                                                    └────────┬─────────┘
                                                             │ stop()
                                                             ▼
                                                    ┌──────────────────┐
                                                    │  Blob assembled  │
                                                    │  (webm/opus)     │
                                                    └────────┬─────────┘
                                                             │ POST /api/transcribe
                                                             │ Content-Type: audio/webm
                                                             ▼
                                               ┌────────────────────────────┐
                                               │  Developer's Transcription │
                                               │  Endpoint                  │
                                               │  (proxies to OpenAI        │
                                               │   Whisper or self-hosted)  │
                                               └────────────┬───────────────┘
                                                            │ { transcript: "..." }
                                                            ▼
                                                   ┌─────────────────┐
                                                   │  WhisperAdapter │
                                                   │  calls          │
                                                   │  events.onFinal │
                                                   │  Blob = null ←── PERF 2.7
                                                   │  chunks = []    │
                                                   └────────┬────────┘
                                                            │
                                                            ▼ (existing flow continues)
                                                   ┌─────────────────┐
                                                   │  Core engine:   │
                                                   │  processing     │
                                                   │  state →        │
                                                   │  BYOE parse     │
                                                   │  endpoint       │
                                                   └─────────────────┘
```

---

## 3. Feature 1: Whisper STT Adapter

### 3.1 Module Location and Entry Point

The adapter lives at `packages/core/src/adapters/whisper.ts` and is exposed via a dedicated subpath export. This keeps the adapter tree-shakeable from consumers using the Web Speech API.

```
@voiceform/core/adapters/whisper
  └── packages/core/src/adapters/whisper.ts
```

The `packages/core/package.json` exports field:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./stt": {
      "import": "./dist/stt.mjs",
      "require": "./dist/stt.cjs",
      "types": "./dist/stt.d.ts"
    },
    "./ui": {
      "import": "./dist/ui.mjs",
      "require": "./dist/ui.cjs",
      "types": "./dist/ui.d.ts"
    },
    "./adapters/whisper": {
      "import": "./dist/adapters/whisper.mjs",
      "require": "./dist/adapters/whisper.cjs",
      "types": "./dist/adapters/whisper.d.ts"
    }
  }
}
```

### 3.2 Interface Compliance

`WhisperAdapter` satisfies `STTAdapter` exactly as defined in `packages/core/src/types.ts`. No changes to the `STTAdapter` interface are required.

```typescript
// packages/core/src/adapters/whisper.ts

import type {
  STTAdapter,
  STTAdapterEvents,
  STTError,
  STTErrorCode,
} from '../types.js'

export interface WhisperAdapterConfig {
  /**
   * URL of the developer's transcription endpoint.
   * The adapter POSTs audio to this URL and expects { transcript: string }.
   *
   * This MUST be a developer-controlled endpoint that proxies to Whisper
   * (or any Whisper-compatible API). Audio never leaves the developer's
   * infrastructure directly from this library.
   */
  transcriptionEndpoint: string

  /**
   * Maximum recording duration in milliseconds before stop() is called
   * automatically. Default: 60000 (60 seconds).
   */
  maxDurationMs?: number

  /**
   * Additional headers sent with the transcription POST request.
   * Use for authentication tokens on the developer's transcription endpoint.
   */
  headers?: Record<string, string>

  /**
   * Request timeout for the transcription POST in milliseconds.
   * Default: 30000 (30 seconds — Whisper inference is slower than STT streaming).
   */
  timeoutMs?: number
}

export declare class WhisperAdapter implements STTAdapter {
  constructor(config: WhisperAdapterConfig)

  /** Returns true in any browser that supports MediaRecorder. */
  isSupported(): boolean

  /**
   * Requests microphone access, begins MediaRecorder session, and starts
   * collecting audio chunks. Resolves when MediaRecorder reaches 'recording'
   * state. Rejects with STTError if getUserMedia is denied.
   */
  start(events: STTAdapterEvents): Promise<void>

  /**
   * Stops the MediaRecorder gracefully. The adapter assembles the collected
   * chunks into a Blob, POSTs to transcriptionEndpoint, and calls events.onFinal
   * with the returned transcript. Calls events.onEnd after the POST completes
   * (success or error).
   *
   * The audio Blob and chunks array are dereferenced immediately after the
   * POST response is processed — whether it succeeds or fails. (PERF 2.7)
   */
  stop(): void

  /**
   * Cancels the recording session immediately. Does NOT POST to the endpoint.
   * Dereferences all audio data (Blob and chunks array) before calling events.onEnd.
   * (PERF 2.7 — abort path)
   */
  abort(): void
}
```

### 3.3 Audio Format Selection

The adapter uses `MediaRecorder.isTypeSupported` to select the best available format. Priority order matches Whisper API compatibility:

```typescript
// packages/core/src/adapters/whisper.ts (internal implementation detail)

const MIME_TYPE_PRIORITY = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',   // fallback without codec hint
] as const

function selectMimeType(): string {
  for (const mimeType of MIME_TYPE_PRIORITY) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }
  // If none of the above are supported, let MediaRecorder use its default.
  // This is unlikely on any browser in the support matrix.
  return ''
}
```

The selected MIME type is stored on the adapter instance and sent as the `Content-Type` header on the POST to the transcription endpoint. This allows the developer's Whisper proxy to pass the correct content type to the Whisper API.

### 3.4 Memory Management (PERF 2.7 — Blob Cleanup)

Blob cleanup is the most operationally important correctness requirement for this adapter. A 60-second WebM/opus recording at the browser's default bitrate is approximately 400–600 KB. Repeated invocations without cleanup accumulate this in the JS heap.

The adapter maintains three internal references that must be cleaned up:

| Reference | Type | Cleanup trigger |
|---|---|---|
| `this.chunks` | `Blob[]` | After Blob assembly (or on abort) |
| `this.audioBlob` | `Blob \| null` | After POST completes (success or error) or on abort |
| `this.mediaStream` | `MediaStream \| null` | On stop/abort — tracks must be stopped to release the OS-level mic lock |
| `this.recorder` | `MediaRecorder \| null` | After stop/abort — set to null after final state |

Cleanup sequence for the normal (stop) path:

```
MediaRecorder 'stop' event fires
  └── Blob assembled from this.chunks
  └── this.chunks = []                     ← clear chunk array immediately
  └── POST audio Blob to transcriptionEndpoint
      └── (success) events.onFinal(transcript)
      └── (error)   events.onError(sttError)
      └── (either)  this.audioBlob = null  ← dereference Blob
                    this.recorder = null
                    this.mediaStream?.getTracks().forEach(t => t.stop())
                    this.mediaStream = null
                    events.onEnd()
```

Cleanup sequence for the abort path:

```
abort() called
  └── this.recorder?.stop()       ← stop MediaRecorder (no onStop processing)
  └── this.chunks = []            ← dereference without assembling Blob
  └── this.audioBlob = null       ← no-op if never assembled, safe
  └── this.recorder = null
  └── this.mediaStream?.getTracks().forEach(t => t.stop())
  └── this.mediaStream = null
  └── pendingAbortController?.abort()   ← cancel any in-flight POST
  └── events.onEnd()
```

The `abort()` path must NOT call `events.onFinal`. The `STTAdapter` contract requires that `abort()` produces no transcript. Any `MediaRecorder.ondataavailable` callbacks that fire after `abort()` is called must be ignored — the adapter sets an internal `aborted` flag to guard against this race.

### 3.5 Transcription Endpoint Contract

The Whisper adapter introduces a second BYOE endpoint with a different contract than the parse endpoint. This is a new contract the developer must implement.

**Request (adapter → developer's endpoint):**

```
POST /api/transcribe
Content-Type: audio/webm;codecs=opus   (or whichever MIME type was selected)
X-VoiceForm-Request: 1                 (same CSRF signal header as parse requests)
[developer-configured headers]

<binary audio data>
```

**Success response (developer's endpoint → adapter):**

```json
HTTP 200
Content-Type: application/json

{
  "transcript": "the user's spoken words as plain text"
}
```

**Error response:**

Any non-2xx HTTP status causes `events.onError` to be called with `code: 'STT_ERROR'`. The adapter does not attempt to parse the error body (it may not be JSON).

**Developer implementation notes (for reference documentation):**

The developer's transcription endpoint receives raw binary audio. A reference implementation pattern for an OpenAI Whisper proxy:

```typescript
// apps/demo/src/routes/api/transcribe/+server.ts (SvelteKit reference)
// This is guidance for the docs — not part of the library.

import { OPENAI_API_KEY } from '$env/static/private'

export async function POST({ request }) {
  // Validate CSRF signal header
  if (request.headers.get('X-VoiceForm-Request') !== '1') {
    return new Response('Bad Request', { status: 400 })
  }

  const audioBuffer = await request.arrayBuffer()
  const contentType = request.headers.get('content-type') ?? 'audio/webm'

  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer], { type: contentType }), 'audio.webm')
  formData.append('model', 'whisper-1')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  })

  if (!response.ok) {
    return new Response('Transcription failed', { status: 502 })
  }

  const result = await response.json()
  return Response.json({ transcript: result.text })
}
```

### 3.6 Error Handling

All errors produce an `STTError` with `code: 'STT_ERROR'` (using the existing `STTErrorCode` type). The adapter maps failure modes as follows:

| Failure | `STTErrorCode` | Notes |
|---|---|---|
| `getUserMedia` permission denied | `PERMISSION_DENIED` | Existing code in the type system |
| `getUserMedia` no hardware | `AUDIO_CAPTURE_FAILED` | Existing code |
| `MediaRecorder` `onerror` event | `STT_ERROR` (mapped from UNKNOWN) | `originalError` contains the `MediaRecorderErrorEvent` |
| Non-2xx from transcription endpoint | `NETWORK_ERROR` | HTTP status in `originalError` |
| Missing `transcript` field in response | `UNKNOWN` | With descriptive message |
| POST network failure | `NETWORK_ERROR` | |
| POST timeout | `NETWORK_ERROR` | Distinguished by message string |

The adapter does not use `UNKNOWN` catch-all silently — each branch has a descriptive `message` string suitable for developer debugging.

### 3.7 Security Considerations

**Audio never reaches a third party directly from this library.** The adapter POSTs to the developer's own endpoint. The developer is responsible for the proxy relationship with OpenAI/Whisper. This is the same BYOE principle as the parse endpoint.

The `X-VoiceForm-Request: 1` header is included on the transcription POST for the same reason it is included on the parse POST: it gives the developer's endpoint a lightweight CSRF signal to distinguish voice-form requests from arbitrary cross-origin POSTs.

The `transcriptionEndpoint` URL is developer-supplied configuration (not end-user input), so there is no injection risk in constructing the request. The `headers` config option allows auth tokens but, like all `EndpointOptions.headers`, these must never include LLM provider API keys — they belong on the developer's server.

The audio blob is binary data with no user-controlled metadata attached by this library. The developer is responsible for what their transcription endpoint logs or stores.

### 3.8 Bundle Size Budget (NFR-102)

Target: ≤ 3 KB gzip over the base `@voiceform/core` bundle.

Estimated module contributions:

| Component | Estimated gzip |
|---|---|
| `MediaRecorder` wrapper + event wiring | ~0.9 KB |
| MIME type selection logic | ~0.2 KB |
| POST logic (reuses browser `fetch`, no new dep) | ~0.6 KB |
| Cleanup / abort logic | ~0.3 KB |
| Type declarations (erased at runtime) | 0 |
| **Total** | **~2.0 KB** |

This is comfortably within the 3 KB NFR-102 budget. The adapter has zero runtime dependencies. It does not import from `@voiceform/core`'s main entry — it is an independent module that happens to satisfy the `STTAdapter` interface.

---

## 4. Feature 2: @voiceform/dev Package

### 4.1 Package Charter

`@voiceform/dev` is a development-time debugging tool. It exists so developers can inspect schema quality, observe BYOE traffic, and visualize state transitions without adding `console.log` calls throughout their app. It ships no code to production.

Design constraints that follow from this charter:

1. Every export is a pure function. No module-level side effects. (`"sideEffects": false`)
2. Every function is a no-op in production (`process.env.NODE_ENV === 'production'`), but the preferred usage pattern is conditional import, not runtime guard.
3. The package does not depend on React, Svelte, or any framework. It uses vanilla DOM APIs where needed (the state visualizer overlay).
4. The package does not modify the `VoiceFormConfig` it receives in ways that affect runtime behavior — it only wraps and observes.

### 4.2 Package Structure

```
packages/dev/
├── src/
│   ├── index.ts              Public API barrel (named exports only)
│   ├── schema-inspector.ts   inspectSchema, validateSchemaAgainstDOM
│   ├── logging-middleware.ts createLoggingMiddleware
│   └── state-visualizer.ts   attachStateVisualizer, detachStateVisualizer
├── package.json
├── tsup.config.ts
└── tsconfig.json
```

**`packages/dev/package.json` (key fields):**

```json
{
  "name": "@voiceform/dev",
  "version": "2.0.0",
  "sideEffects": false,
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "peerDependencies": {
    "@voiceform/core": ">=2.0.0"
  },
  "devDependencies": {
    "@voiceform/core": "workspace:*"
  }
}
```

`@voiceform/core` is a peer dependency, not a production dependency. This prevents bundlers from including core twice if the developer already has it installed. The dev package never ships its own copy of core.

### 4.3 Schema Inspector

**Purpose:** Lets a developer examine a `FormSchema` in the browser console during development. Two distinct functions with different concerns.

**Type definitions:**

```typescript
// packages/dev/src/schema-inspector.ts

import type { FormSchema } from '@voiceform/core'

export interface SchemaDiagnostic {
  /** The FieldSchema.name this diagnostic applies to. */
  field: string
  severity: 'error' | 'warning' | 'suggestion'
  message: string
}

export interface SchemaInspectionResult {
  valid: boolean
  fieldCount: number
  diagnostics: SchemaDiagnostic[]
}

export interface DOMValidationResult {
  /** Fields in the schema with no matching DOM element. */
  missingInDOM: string[]
  /** DOM elements with name/id that have no matching schema entry. */
  unmatchedInDOM: string[]
  /** Fields that matched successfully. */
  matched: string[]
}
```

**`inspectSchema(schema: FormSchema): SchemaInspectionResult`**

Runs a richer set of diagnostics than the runtime `validateSchema` in core:

| Rule | Severity | Example |
|---|---|---|
| Field has no `label` | `warning` | LLM gets `name` only — lower parse quality |
| `select`/`radio` field has fewer than 2 options | `warning` | Single-option select likely misconfigured |
| `description` is longer than 200 characters | `suggestion` | Very long descriptions inflate token count |
| Field `name` contains spaces or special characters | `error` | Will likely fail CSS selector lookup |
| `formName` or `formDescription` absent | `suggestion` | Missing context for LLM |
| Duplicate field `name` values | `error` | Second field silently shadows first |
| `required: true` field with `type: 'boolean'` | `suggestion` | A boolean is always present; `required` has no effect |

Output is printed to the browser console as a `console.table` plus individual `console.warn` / `console.error` calls per diagnostic.

**`validateSchemaAgainstDOM(schema: FormSchema, formElement: HTMLElement): DOMValidationResult`**

Queries the DOM to find which schema fields have matching elements. Uses the same lookup strategy as the core injector:

1. `[name="${CSS.escape(field.name)}"]`
2. `#${CSS.escape(field.name)}`
3. `[data-voiceform="${CSS.escape(field.name)}"]`

Logs results using `console.group`:

```
voiceform dev — Schema/DOM Validation
  ✓ Matched (3): firstName, lastName, email
  ✗ Missing in DOM (1): phoneNumber
      → No element found for field "phoneNumber". Check the name/id attribute.
  ⚠ Unmatched DOM elements (2): notes, subscribeCheckbox
      → These form elements have no schema entry. Voice input cannot fill them.
```

Both functions are no-ops when `process.env.NODE_ENV === 'production'`. In production, they return the result type without logging, so if accidentally imported, they cause no visible effect.

### 4.4 Request/Response Logger

**Purpose:** Intercepts the BYOE endpoint request/response cycle and logs it in a structured, readable format. This is the primary tool for debugging parse quality issues ("why did the LLM fill field X with value Y?").

**Design approach — options spread pattern:**

Rather than patching or wrapping `fetch`, the logger returns partial `VoiceFormConfig` options that the developer spreads into their config. This keeps the implementation entirely within the public API surface — no monkey-patching.

```typescript
// packages/dev/src/logging-middleware.ts

import type { VoiceFormConfig, VoiceFormEvents } from '@voiceform/core'

export interface LoggingMiddlewareOptions {
  /**
   * Whether to log the full schema in each request.
   * Default: false (logs field count only, to keep output concise).
   */
  logFullSchema?: boolean

  /**
   * Whether to log the rawResponse field from ParseResponse (if present).
   * Default: true.
   */
  logRawResponse?: boolean
}

/**
 * Returns a partial VoiceFormConfig that, when spread into the developer's
 * config, wraps the endpoint lifecycle to log request/response data.
 *
 * Usage:
 *   const loggingConfig = createLoggingMiddleware()
 *   const instance = createVoiceForm({ ...appConfig, ...loggingConfig })
 *
 * The returned config adds wrapped event handlers (onStateChange, onError).
 * If the developer also provides these callbacks in appConfig, the spread
 * order means the middleware callbacks win. The developer should instead
 * pass their callbacks to createLoggingMiddleware() via the options parameter
 * so both are called.
 */
export interface LoggingMiddlewareConfig {
  events: Pick<VoiceFormEvents, 'onStateChange' | 'onError'>
}

export declare function createLoggingMiddleware(
  options?: LoggingMiddlewareOptions
): LoggingMiddlewareConfig
```

**Log format:**

Each request/response cycle is wrapped in a `console.group`. The group is opened when the state transitions to `processing` and closed when it transitions out of `processing` (to `confirming` or `error`).

```
voiceform dev ─ Request #1  [14:32:01.234]
  Transcript     "John Smith, john at example dot com, 555-1234"
  Schema         3 fields: firstName (text), email (email), phone (tel)
  ─── Response [+412ms] HTTP 200 ───────────────────────────────────
  Fields
    firstName    "John Smith"         (confidence: 0.97)
    email        "john@example.com"   (confidence: 0.94)
    phone        "555-1234"           (confidence: 0.91)
  Raw LLM        {"firstName":"John Smith","email":"john@example.com",...}
```

If the request errors:

```
voiceform dev ─ Request #2  [14:32:45.001]
  Transcript     "um, I think my name is..."
  Schema         3 fields: firstName (text), email (email), phone (tel)
  ─── Error [+5002ms] ENDPOINT_TIMEOUT ──────────────────────────────
  Message        "Request to /api/parse timed out after 5000ms"
```

**Implementation note:** The logger subscribes to `onStateChange` to detect `processing` start time, and subscribes to subsequent state transitions to calculate elapsed time. It does not modify the request or response — it reads state from the events that core already emits.

The `createLoggingMiddleware` function is a no-op in production (returns an empty object `{}`).

### 4.5 State Visualizer

**Purpose:** Injects a fixed-position overlay into the document that shows live state machine transitions. Useful when developing headless integrations where there is no built-in UI to observe.

**Type definitions:**

```typescript
// packages/dev/src/state-visualizer.ts

import type { VoiceFormInstance } from '@voiceform/core'

export interface StateVisualizerOptions {
  /**
   * CSS position for the overlay. Default: 'bottom-right'.
   */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

  /**
   * Whether to show the full state object JSON. Default: false (shows status only).
   */
  verbose?: boolean
}

/**
 * Attaches a debug overlay to the document showing real-time state transitions.
 * Returns a detach function.
 *
 * @param instance  A VoiceFormInstance returned by createVoiceForm.
 * @param options   Optional display configuration.
 * @returns         A function that removes the overlay and cleans up listeners.
 */
export declare function attachStateVisualizer(
  instance: VoiceFormInstance,
  options?: StateVisualizerOptions
): () => void  // detach function

/**
 * Removes a previously attached state visualizer overlay.
 * Equivalent to calling the function returned by attachStateVisualizer.
 * Safe to call if no visualizer is attached (no-op).
 */
export declare function detachStateVisualizer(instance: VoiceFormInstance): void
```

**Overlay DOM structure:**

```html
<div id="vf-dev-visualizer" data-vf-dev="true"
     style="position:fixed; bottom:12px; right:12px; z-index:2147483647;
            background:#1e1e2e; color:#cdd6f4; font-family:monospace;
            font-size:12px; padding:12px 16px; border-radius:8px;
            border:1px solid #45475a; min-width:220px; max-width:400px;">
  <div style="font-size:10px; color:#6c7086; margin-bottom:4px; user-select:none;">
    voiceform dev
  </div>
  <div id="vf-dev-status">● idle</div>
  <div id="vf-dev-transcript" style="color:#89b4fa; margin-top:4px; word-break:break-word;">
    <!-- transcript shown during recording/processing -->
  </div>
  <div id="vf-dev-error" style="color:#f38ba8; margin-top:4px;">
    <!-- error shown in error state -->
  </div>
  <div id="vf-dev-history" style="color:#585b70; margin-top:8px; font-size:10px;">
    <!-- last 5 state transitions -->
  </div>
</div>
```

The overlay uses only inline styles to avoid conflicts with the host application's CSS. The `z-index` is `2147483647` (maximum) to ensure it is always visible over other overlays during development.

**State subscription:** The visualizer calls `instance.subscribe(listener)` and stores the unsubscribe function. When detached, the unsubscribe function is called and the overlay element is removed from the DOM.

**Auto-detach on instance destroy:** The visualizer wraps the `instance.destroy()` method to ensure the overlay is removed if the developer calls `destroy()` without explicitly detaching the visualizer first. This is done by monkey-patching the destroy method on the specific instance object (not the prototype) with a wrapper that calls the original.

**Security note:** The overlay renders state values using `textContent` only. Transcripts and error messages are never rendered via `innerHTML`. This is consistent with the core library's DOM output policy.

### 4.6 Production Safety (NFR-103)

The package achieves production safety through two mechanisms:

**Static tree-shaking (primary):** `"sideEffects": false` in `package.json` tells bundlers that every module in this package can be eliminated if its exports are not imported. A production build that does not import `@voiceform/dev` at all will never include it.

**Runtime guard (secondary / defense in depth):**

```typescript
// At the top of each exported function:
if (process.env.NODE_ENV === 'production') {
  // Return empty/no-op result without logging
  return ...
}
```

This guard is a secondary defense. The correct pattern for developers is conditional import:

```typescript
// Recommended usage pattern (documented in package README):
if (process.env.NODE_ENV !== 'production') {
  const { attachStateVisualizer } = await import('@voiceform/dev')
  attachStateVisualizer(voiceFormInstance)
}
```

The `package.json` should list `@voiceform/dev` in `devDependencies` in the reference demo app. The README must explicitly state: "Do not list this package in `dependencies`. List it in `devDependencies` only. If it appears in a production bundle, your import strategy is incorrect."

---

## 5. Feature 3: React Wrapper Architecture

### 5.1 Design Constraints and Goals

The React wrapper must satisfy:

- **Concurrent mode safety** — no use of `setState` during render, no side effects in render, no deprecated legacy APIs (FR-101)
- **≤ 4 KB gzip** excluding React runtime (NFR-101)
- **Ref forwarding to the DOM button element** (FR-102)
- **Controlled component compatibility** — the native setter trick already in core works, but React 18/19 concurrent mode requires explicit handling of batched updates and `useSyncExternalStore` for subscribing to external state (FR-103)
- **Lifecycle safety** — `VoiceFormInstance.destroy()` must be called on unmount to prevent memory leaks (NFR-014 from v1, extended to React)

### 5.2 Package Structure

```
packages/react/
├── src/
│   ├── index.ts              Public API barrel
│   ├── useVoiceForm.ts       Core hook
│   ├── VoiceForm.tsx         Compound component
│   └── types.ts              React-specific type extensions
├── package.json
├── tsup.config.ts
└── tsconfig.json
```

**`packages/react/package.json` (key fields):**

```json
{
  "name": "@voiceform/react",
  "version": "2.0.0",
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0",
    "@voiceform/core": ">=2.0.0"
  },
  "sideEffects": false,
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  }
}
```

### 5.3 `useVoiceForm` Hook

The hook is the primary integration surface. It owns the `VoiceFormInstance` lifecycle — it creates the instance once on mount and destroys it on unmount. It subscribes to state changes and re-renders the consuming component using `useSyncExternalStore`.

**Type signature:**

```typescript
// packages/react/src/useVoiceForm.ts

import type { VoiceFormConfig, VoiceFormState, VoiceFormInstance } from '@voiceform/core'

export interface UseVoiceFormOptions extends VoiceFormConfig {
  // No React-specific additions to the options at the hook level.
  // All VoiceFormConfig options are forwarded directly to createVoiceForm.
}

export interface UseVoiceFormResult {
  /** The current state of the voice form engine. Safe to render directly. */
  state: VoiceFormState

  /** The VoiceFormInstance. Stable reference — same object across renders. */
  instance: VoiceFormInstance
}

export declare function useVoiceForm(options: UseVoiceFormOptions): UseVoiceFormResult
```

**Hook implementation design:**

```typescript
// packages/react/src/useVoiceForm.ts (design sketch — not final code)

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createVoiceForm } from '@voiceform/core'
import type { VoiceFormConfig, VoiceFormState, VoiceFormInstance } from '@voiceform/core'

export function useVoiceForm(options: VoiceFormConfig): UseVoiceFormResult {
  // The instance ref is stable — createVoiceForm is called once on mount.
  const instanceRef = useRef<VoiceFormInstance | null>(null)

  // Options ref: keep a mutable ref so the subscribe/getSnapshot closures
  // always see the latest options without re-creating the instance.
  // NOTE: options changes do NOT re-create the instance. If schema needs to
  // change, the developer calls instance.updateSchema() directly.
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Lazy-initialize the instance. The instance is created once and destroyed
  // on unmount. This must not be in a useEffect because we need the instance
  // to be synchronously available for the initial render's getSnapshot call.
  if (instanceRef.current === null) {
    instanceRef.current = createVoiceForm(options)
  }

  // subscribe/getSnapshot are stable references (via useCallback with empty deps
  // in the real implementation) so useSyncExternalStore does not re-subscribe
  // on every render.
  const subscribe = (onStoreChange: () => void) => {
    const instance = instanceRef.current!
    const unsubscribe = instance.subscribe(() => onStoreChange())
    return unsubscribe
  }

  const getSnapshot = (): VoiceFormState => {
    return instanceRef.current!.getState()
  }

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Destroy the instance on unmount. This is the critical cleanup path.
  useEffect(() => {
    return () => {
      instanceRef.current?.destroy()
      instanceRef.current = null
    }
  }, []) // empty deps — runs only on unmount

  return {
    state,
    instance: instanceRef.current,
  }
}
```

**Why `useSyncExternalStore`:**

`useSyncExternalStore` is the React 18 canonical API for subscribing to external stores. It solves the "tearing" problem in concurrent mode: if React renders a component tree in multiple passes (as it may in concurrent features like `startTransition`), `useSyncExternalStore` ensures all renders within a single commit see the same store snapshot. A naive `useState` + `useEffect` subscription would not provide this guarantee and could produce inconsistent UI in apps using `startTransition` or `Suspense`.

The `getSnapshot` function is called synchronously during render. It returns the current `VoiceFormState`. This must be a stable value — the same reference if the state has not changed — to prevent unnecessary re-renders. The core `StateMachine` produces a new state object on each transition, so React's `Object.is` comparison will correctly identify state changes.

**Instance initialization — synchronous vs. deferred:**

The instance is initialized synchronously on the first render (before the first `useSyncExternalStore` call) rather than in a `useEffect`. This is necessary because `getSnapshot` must return a valid state on the first render. If the instance were created in a `useEffect`, the first render would have no instance to call `getSnapshot` on.

This is safe in React 18 because `createVoiceForm` is synchronous and does not have side effects observable outside the React tree (it does not mount DOM elements until the developer explicitly renders the `<VoiceForm>` component or calls the returned instance methods).

In React's `<StrictMode>`, effects run twice in development. The instance initialization in the `if (instanceRef.current === null)` guard will only run once because the ref persists across the double-render in Strict Mode. The `useEffect` cleanup will run after the first simulated unmount, calling `destroy()` and setting `instanceRef.current = null`, then the mount will re-initialize. This means `createVoiceForm` is called twice in Strict Mode development — this is expected and correct. The second instance is the one that persists.

### 5.4 `<VoiceForm>` Component

The `<VoiceForm>` component provides two integration patterns: a render-props children-as-function API for full control, and a simpler default where it renders the built-in mic button and wires everything up automatically.

**Type signatures:**

```typescript
// packages/react/src/VoiceForm.tsx

import React from 'react'
import type { VoiceFormState, VoiceFormInstance, VoiceFormConfig } from '@voiceform/core'

export interface VoiceFormRenderProps {
  state: VoiceFormState
  instance: VoiceFormInstance
}

export interface VoiceFormProps extends VoiceFormConfig {
  /**
   * Children-as-function render prop. Receives the current state and
   * the VoiceFormInstance. Use this for headless/custom UI integrations.
   *
   * If provided, the default mic button UI is NOT rendered.
   * The developer is responsible for calling instance.start(), etc.
   */
  children?: (props: VoiceFormRenderProps) => React.ReactNode

  /**
   * Called after confirmation and injection complete.
   * Convenience alias for VoiceFormConfig.events.onDone.
   */
  onDone?: VoiceFormConfig['events'] extends object
    ? NonNullable<VoiceFormConfig['events']>['onDone']
    : never

  /**
   * Called when an error occurs.
   * Convenience alias for VoiceFormConfig.events.onError.
   */
  onError?: VoiceFormConfig['events'] extends object
    ? NonNullable<VoiceFormConfig['events']>['onError']
    : never
}

/**
 * VoiceForm compound component. Internally uses useVoiceForm.
 *
 * Usage (with default UI):
 *   <VoiceForm endpoint="/api/parse" schema={schema} />
 *
 * Usage (headless / custom UI via render prop):
 *   <VoiceForm endpoint="/api/parse" schema={schema}>
 *     {({ state, instance }) => (
 *       <button onClick={() => instance.start()}>
 *         {state.status === 'recording' ? 'Stop' : 'Speak'}
 *       </button>
 *     )}
 *   </VoiceForm>
 */
export declare const VoiceForm: React.FC<VoiceFormProps>
```

**Render logic:**

```
VoiceForm
  └── useVoiceForm(options)   → { state, instance }
  └── if children (function)
        return children({ state, instance })
      else
        return <DefaultVoiceFormUI state={state} instance={instance} />
```

`DefaultVoiceFormUI` is an internal component that renders the core `DefaultUI` elements. It is imported from `@voiceform/core/ui` explicitly, making it tree-shakeable when the children-as-function pattern is used exclusively (a bundler can eliminate `DefaultVoiceFormUI` if that code path is never reached — though static analysis of the ternary is bundler-dependent; the preferred approach is to separate it into a distinct component so tree-shaking applies at the module level).

### 5.5 Ref Forwarding (FR-102)

The `<VoiceForm>` component forwards its ref to the underlying `<button>` DOM element. This allows the developer to manage focus on the mic button directly (e.g., for keyboard navigation flows where focus should return to the mic button after the confirmation panel closes).

```typescript
// packages/react/src/VoiceForm.tsx

export const VoiceForm = React.forwardRef<HTMLButtonElement, VoiceFormProps>(
  (props, ref) => {
    const { children, ...voiceFormConfig } = props
    const { state, instance } = useVoiceForm(voiceFormConfig)

    if (typeof children === 'function') {
      // Render prop — developer controls UI. Ref cannot be forwarded
      // to a button that the developer renders. Forwarding is a no-op here.
      // Document this limitation explicitly.
      return <>{children({ state, instance })}</>
    }

    // Default UI — forward ref to the internal button
    return (
      <DefaultVoiceFormUI
        state={state}
        instance={instance}
        buttonRef={ref}
      />
    )
  }
)

VoiceForm.displayName = 'VoiceForm'
```

The forwarded ref resolves to `HTMLButtonElement` as required by FR-102. When the render-prop pattern is used, the ref is not forwarded (the developer controls the DOM structure entirely). This limitation is documented in the API reference.

### 5.6 React Controlled Component Injection (FR-103)

#### The Problem

React controlled components manage their value in React state. When a developer writes:

```jsx
const [email, setEmail] = useState('')
<input value={email} onChange={e => setEmail(e.target.value)} />
```

React owns the `value` property. Setting `input.value = 'new@example.com'` directly is immediately overwritten by React on the next render cycle. This is why v1 uses the native prototype setter trick — it bypasses React's internal reconciler tracking just long enough for the synthetic event to propagate and React's own `onChange` handler to update state.

#### The Native Setter Approach (Default)

The native setter approach from v1 (FR-019) works correctly in React 18 and React 19 for `<input>` and `<textarea>` elements. The sequence is:

1. `nativeInputValueSetter.call(el, newValue)` — sets value bypassing React's property descriptor
2. `el.dispatchEvent(new Event('input', { bubbles: true }))` — triggers React's synthetic `onChange`
3. React's `onChange` fires → developer calls `setState(e.target.value)` → React reconciles

This works because React attaches its synthetic event handlers to the root container (not individual elements) and listens for native `input` events bubbling up. The native setter + dispatch pattern reliably triggers React's event delegation in React 18 with both the legacy and concurrent renderers.

#### React 19 Consideration

React 19 introduced changes to form handling (particularly around form actions and `useFormStatus`). The native setter trick continues to work for standard controlled `<input>` components because the synthetic event system is unchanged. However, if a developer is using React 19's new `<form action>` API, DOM injection may not be the right pattern — they should use `onFieldsResolved` instead.

#### `onFieldsResolved` Escape Hatch (FR-103)

For developers who want full control (or who use React 19 form actions, or third-party form libraries like React Hook Form that manage their own state registers), the `onFieldsResolved` callback bypasses DOM injection entirely:

```typescript
// Addition to VoiceFormProps in packages/react/src/VoiceForm.tsx

export interface VoiceFormProps extends VoiceFormConfig {
  // ...existing props...

  /**
   * If provided, DOM injection is skipped entirely. The developer receives
   * the parsed field values and is responsible for updating their form state.
   *
   * The confirmation step still occurs unless skipConfirmation is also true.
   * Values passed to this callback have been sanitized (stripHtml applied).
   *
   * Use this when:
   * - Using React Hook Form, Formik, or Zod-validated forms
   * - Using React 19 form actions
   * - Using a rich text editor for any field
   *
   * @param fields  Sanitized, confirmed field values keyed by field name.
   */
  onFieldsResolved?: (fields: Record<string, string>) => void
}
```

When `onFieldsResolved` is provided:
- After the user confirms, core calls `onFieldsResolved(sanitizedFields)` instead of running the DOM injector
- The developer calls their own state setters (e.g., `setValue` from React Hook Form)
- The state machine transitions `confirming → done` normally

This is implemented by detecting the `onFieldsResolved` prop in `useVoiceForm` and configuring the core instance with `headless: true` for the injection phase while still using the default confirmation UI.

### 5.7 Concurrent Mode Safety Checklist

| Concern | Handling |
|---|---|
| Side effects in render | None. Instance creation is in a ref guard (synchronous but only once). No `setState` in render. |
| Tearing on concurrent renders | `useSyncExternalStore` prevents tearing by design. |
| State updates from outside React | `VoiceFormInstance.subscribe` triggers `useSyncExternalStore`'s `onStoreChange`, which batches the re-render with React's scheduler. |
| Strict Mode double-invoke | The `useEffect` cleanup + re-initialization is handled correctly by the `instanceRef` guard. |
| `startTransition` interaction | State transitions in `useSyncExternalStore` are not deferred — they are synchronous updates. The mic button state always reflects the current engine state, never a stale transition-in-progress state. |
| Suspense interaction | `createVoiceForm` does not throw Promises. The component is not a Suspense consumer. No special handling required. |
| `use()` hook (React 19) | Not used. The wrapper is forward-compatible. |

### 5.8 Bundle Size (NFR-101)

Target: ≤ 4 KB gzip, excluding React runtime.

Estimated contributions (React listed as external in tsup config):

| Module | Estimated gzip |
|---|---|
| `useVoiceForm.ts` — hook logic | ~0.8 KB |
| `VoiceForm.tsx` — component shell + ref forwarding | ~0.6 KB |
| Type declarations (erased at runtime) | 0 |
| React API calls (`useRef`, `useEffect`, `useSyncExternalStore`) | 0 (external) |
| `@voiceform/core` calls | 0 (external peer dep) |
| **Total** | **~1.4 KB** |

The wrapper is genuinely thin. The 4 KB budget has substantial headroom. The primary risk to exceeding it would be accidentally bundling `@voiceform/core` rather than treating it as an external peer dependency. The `tsup.config.ts` must list `@voiceform/core` and all React packages in `external`.

---

## 6. Updated Package Structure and Dependency Graph

### 6.1 Full Monorepo Structure (V2)

```
voice-form/ (monorepo root)
├── packages/
│   ├── core/                     @voiceform/core
│   │   ├── src/
│   │   │   ├── state/            State machine
│   │   │   ├── stt/              STT adapter interface + Web Speech impl
│   │   │   ├── adapters/
│   │   │   │   └── whisper.ts    Whisper STT adapter (v2 — new)
│   │   │   ├── schema/           Schema engine
│   │   │   ├── client/           Endpoint client
│   │   │   ├── injector/         DOM injection
│   │   │   ├── ui/               Default UI (separate entry point)
│   │   │   ├── utils/            sanitize.ts, validate-transcript.ts
│   │   │   └── index.ts          Public API
│   │   └── package.json          (updated exports field for whisper subpath)
│   │
│   ├── server-utils/             @voiceform/server-utils
│   │   └── src/
│   │       └── promptBuilder.ts
│   │
│   ├── react/                    @voiceform/react (v2 — new)
│   │   └── src/
│   │       ├── useVoiceForm.ts
│   │       ├── VoiceForm.tsx
│   │       ├── types.ts
│   │       └── index.ts
│   │
│   ├── svelte/                   @voiceform/svelte (v1, unchanged)
│   │   └── src/
│   │       ├── voiceFormStore.ts
│   │       └── VoiceFormButton.svelte
│   │
│   └── dev/                      @voiceform/dev (v2 — new)
│       └── src/
│           ├── schema-inspector.ts
│           ├── logging-middleware.ts
│           ├── state-visualizer.ts
│           └── index.ts
│
├── examples/
│   ├── nextjs/                   Next.js 14 App Router example (v2 — new)
│   ├── sveltekit/                (v1)
│   └── vanilla/                  (v1)
├── pnpm-workspace.yaml
└── package.json
```

### 6.2 Dependency Graph (V2)

```
@voiceform/react     ──────┐
                           ├──► @voiceform/core  (zero runtime deps)
@voiceform/svelte    ──────┘         │
                                     │ subpath exports:
@voiceform/core/stt ─────────────────┤ WebSpeechAdapter
                                     │
@voiceform/core/adapters/whisper ────┤ WhisperAdapter
                                     │
@voiceform/core/ui ──────────────────┘ DefaultUI

@voiceform/server-utils  (standalone — no dep on core)

@voiceform/dev ──────────────► @voiceform/core  (peer dep only)
               (devDependency only — never in production dep tree)
```

**Cycle check:** No cycles. `@voiceform/dev` depends on `@voiceform/core` (as a peer), but core does not depend on dev. The Whisper adapter is a subpath of core — it is part of the core package, not a separate package with a dependency relationship.

### 6.3 `packages/core/tsup.config.ts` Changes (V2)

The `tsup` configuration must add the Whisper adapter as a separate entry point:

```typescript
// packages/core/tsup.config.ts

export default defineConfig({
  entry: {
    index:              'src/index.ts',
    stt:                'src/stt/index.ts',
    ui:                 'src/ui/index.ts',
    'adapters/whisper': 'src/adapters/whisper.ts',   // v2 addition
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  splitting: false,
  external: [],  // core has zero runtime deps
})
```

---

## 7. Technology Stack Rationale

### 7.1 `useSyncExternalStore` for State Subscription in the React Wrapper

**Choice:** `useSyncExternalStore` (React 18+ built-in) over `useState` + `useEffect` subscription pattern.

**Justification:**
- `useState` + `useEffect` subscriptions are not safe in concurrent mode. There is a window between render and effect-registration where state changes are missed, producing a "stale render." In concurrent mode, React may render the component multiple times without committing, widening this window.
- `useSyncExternalStore` was designed specifically for external store subscriptions and is the React team's documented recommendation for this pattern.
- The hook takes a `subscribe` callback and a `getSnapshot` function — both of which `VoiceFormInstance` supports directly through its `subscribe` method and `getState` method.

**Trade-off vs. `useReducer`:**
- An alternative is to copy state into a local `useReducer` on each `onStateChange` callback. This works but is one step removed from the authoritative state — it introduces a synchronization gap. `useSyncExternalStore` eliminates the gap by making the snapshot the authoritative source.

### 7.2 `MediaRecorder` API for Audio Capture in Whisper Adapter

**Choice:** `MediaRecorder` API (browser built-in) over Web Audio API with manual PCM encoding.

**Justification:**
- `MediaRecorder` is available in all browsers in the support matrix (Chrome 90+, Safari 15.4+, Firefox 90+, Edge 90+).
- It handles codec selection, encoding, and timing natively — producing a compressed, Whisper-compatible audio stream with zero additional library code.
- Web Audio API with manual PCM encoding would produce higher-quality raw audio but at the cost of significantly more code (~3–5 KB additional) and the need to handle resampling for the 16kHz Whisper model requirement. Browser-native `MediaRecorder` at WebM/opus is accepted by the OpenAI Whisper API without resampling.

**Trade-off:** `MediaRecorder` does not support real-time streaming to the endpoint — it produces a complete `Blob` after recording stops. This means the user must finish speaking before transcription begins, which adds latency compared to a streaming WebSocket approach. For v2, this is the correct trade-off: streaming requires a different endpoint contract, more complex abort handling, and a WebSocket dependency. Streaming STT is explicitly on the anti-roadmap for v2.

### 7.3 Subpath Export for Whisper Adapter (vs. Separate Package)

**Choice:** `@voiceform/core/adapters/whisper` subpath export rather than `@voiceform/adapter-whisper` separate npm package.

**Justification:**
- The adapter is ~2 KB and has no dependencies. A separate package adds publishing overhead (separate versioning, separate changelog, separate `package.json` to maintain) disproportionate to the module's size and complexity.
- The adapter satisfies an interface defined in core. Keeping it in core's repo prevents version skew between the adapter and the interface it implements.
- Subpath exports with `"sideEffects": false` are fully tree-shakeable — consumers who do not import `@voiceform/core/adapters/whisper` pay zero bytes for it.

**Trade-off vs. separate package:** A separate package would allow the adapter to have its own version number and release cadence. If the Whisper API changes and a breaking adapter update is needed, a subpath would require a core version bump. Given that the `MediaRecorder` + `fetch` approach is stable and unlikely to require breaking changes, this risk is acceptable for v2.

### 7.4 `"sideEffects": false` in `@voiceform/dev`

**Choice:** Mark `@voiceform/dev` as side-effect-free.

**Justification:**
- All exports are pure functions. No module-level code runs on import (no `console.log`, no DOM manipulation, no global state mutation).
- `"sideEffects": false` in `package.json` allows bundlers (webpack, Rollup, esbuild, Parcel) to tree-shake the entire package away if none of its exports are imported. This is the primary production safety mechanism.
- This requires discipline in the implementation: no top-level `console.group`, no `document.getElementById` at module scope, no instantiation of overlay elements on load. Everything must be deferred until a function is called.

---

## 8. Key Considerations

### 8.1 Scalability

**Whisper adapter at scale:**
The adapter does not add server-side infrastructure. Developer endpoints receive audio `POST` requests rather than text, which are larger (~400–600 KB vs. ~1 KB for transcript text) but structurally identical to the existing parse requests. Developers should plan for audio payloads in their endpoint rate limiting and timeout configurations. The transcription endpoint contract is documented with this note.

**React wrapper at scale:**
The wrapper is stateless from a server perspective. Multiple instances on the same page each create an independent `VoiceFormInstance`. There is no shared state between instances. The `@voiceform/dev` visualizer does create a global DOM node, but at most one per `attachStateVisualizer` call — it is cleaned up on `detach`.

### 8.2 Security

**Whisper adapter:**

- Audio data never reaches any third party directly. It POSTs to a developer-supplied endpoint. The BYOE principle is upheld.
- The `X-VoiceForm-Request: 1` header is sent on the transcription POST, same as on parse requests. The developer's transcription endpoint should validate it.
- The `transcriptionEndpoint` URL is developer configuration, not user input, so there is no SSRF risk from the library's perspective.
- The adapter does not log, store, or re-use audio data. After the POST response, all references are nullified (PERF 2.7 / ROADMAP security baseline: "Blob cleanup after Whisper POST — Required at v2.0").

**`@voiceform/dev`:**

- The state visualizer renders all values with `textContent`, never `innerHTML`. Transcripts and error messages are treated as untrusted text.
- The logging middleware logs transcripts to `console.group`. Transcripts may contain PII. The package README must include a warning: "Request/response logs may contain sensitive user speech. Do not use this middleware in production or in environments where logs are shipped to external services."
- The package has no network activity of its own.

**React wrapper:**

- The wrapper introduces no new security surface. It delegates all security-sensitive operations (sanitization, transcript validation, CSRF headers) to core.
- The `onFieldsResolved` callback receives sanitized values — the same `stripHtml` pipeline that runs before DOM injection also runs before this callback is called. This is consistent with the `onBeforeConfirm` re-sanitization requirement (FR-116).
- Ref forwarding to the DOM button element is safe — it gives the developer a reference to a `<button>` that they already control.

### 8.3 Observability

**Development phase (using `@voiceform/dev`):**

- `attachStateVisualizer` provides real-time state transition visibility without any external tooling.
- `createLoggingMiddleware` produces structured console output for every request/response cycle, including timing, transcript, and parsed fields. This is the primary debugging tool during integration.
- `inspectSchema` surfaces schema quality issues before the first voice session.

**Production phase:**

The library itself produces no telemetry. Observability in production is the developer's responsibility via the `onStateChange`, `onError`, and `onDone` callbacks. The v2 reference Next.js example demonstrates instrumenting these callbacks with a minimal logging setup.

Recommended developer instrumentation points:
- `onError` → log `error.code` and (in debug mode) `error.debugInfo` to an error tracking service
- `onDone` → log `result.fields` (keys only, not values, to avoid PII) and whether `result.success` is true
- `onStateChange` → can be used to track session abandonment rates (if session reaches `recording` but never `done` or the user cancels from `confirming`)

### 8.4 Deployment and CI/CD

**Bundle size gates (existing + additions):**

The existing `size-limit` CI gate must be extended to cover new entry points:

| Entry point | Budget | Measurement |
|---|---|---|
| `@voiceform/core` (headless) | ≤ 5 KB gzip | Unchanged from v1 |
| `@voiceform/core/ui` | ≤ 9 KB gzip combined | Unchanged from v1 |
| `@voiceform/core/adapters/whisper` | ≤ 3 KB gzip delta | New — measured as delta over core headless |
| `@voiceform/react` | ≤ 4 KB gzip | New — React listed as external |
| `@voiceform/svelte` | ≤ 3 KB gzip | Unchanged from v1 |
| `@voiceform/dev` | Not measured (devDep) | Must not appear in production bundles |

**`@voiceform/dev` production bundle audit:**
Add a CI check that builds the Next.js reference app with `NODE_ENV=production` and runs a bundle analyzer to verify that `@voiceform/dev` does not appear in the output chunks. This is the acceptance criterion for NFR-103.

**New reference example:**
A Next.js 14 App Router example at `examples/nextjs/` is the reference implementation for the React wrapper. It must:
- Demonstrate `useVoiceForm` with a controlled form (React Hook Form)
- Demonstrate `<VoiceForm>` with the default UI
- Demonstrate `onFieldsResolved` for React Hook Form integration
- Include a dev-mode import pattern for `@voiceform/dev`
- Include the transcription endpoint route (`/app/api/transcribe/route.ts`) as a Whisper proxy reference

---

## Appendix A: Open Questions for Frontend HLD Merge

The following questions arose during this design that will need resolution when merging with the frontend HLD:

| ID | Question | Impact |
|---|---|---|
| A-01 | The `<VoiceForm>` component with render props pattern uses `VoiceFormConfig` directly as props. When the frontend HLD defines the confirmation panel render prop and field correction UX, those will need corresponding props on `VoiceFormProps`. Ensure the frontend HLD's `VoiceFormProps` additions are additive (no conflicts). | `packages/react/src/types.ts` |
| A-02 | FR-103's `onFieldsResolved` callback bypasses DOM injection. The frontend HLD's field-level correction UX (FR-114, FR-115) produces a `correctedFields` object distinct from `fields`. The `onFieldsResolved` callback should receive `correctedFields` (the user's final values) not the raw LLM `fields`. Confirm this in the frontend HLD. | `useVoiceForm` hook return type |
| A-03 | The `@voiceform/dev` logging middleware subscribes to `onStateChange`. Multi-step form support (FR-110, FR-111) changes the state machine behavior on `setSchema()` calls. Verify that the logger handles `setSchema` mid-session gracefully (no grouped logs left open). | `logging-middleware.ts` |
| A-04 | OQ-003 from the BRD (open question) asks whether the Whisper transcription endpoint should share the parse endpoint contract or be a separate contract. This design resolves it as a separate, simpler contract (`POST audio → { transcript }`). The frontend HLD author should be aware this is settled. | `WhisperAdapterConfig.transcriptionEndpoint` |
