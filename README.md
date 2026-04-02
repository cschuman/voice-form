# voice-form

[![CI](https://img.shields.io/github/actions/workflow/status/cschuman/voice-form/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/cschuman/voice-form/actions)
[![npm version](https://img.shields.io/npm/v/@voiceform/core?style=flat-square)](https://www.npmjs.com/package/@voiceform/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@voiceform/core?style=flat-square&label=bundle%20size)](https://bundlephobia.com/package/@voiceform/core)
[![license](https://img.shields.io/github/license/cschuman/voice-form?style=flat-square)](https://github.com/cschuman/voice-form/blob/main/LICENSE)

**Drop-in voice input for web forms. Speak naturally. Fill forms intelligently.**

voice-form transforms the way users interact with forms. Instead of typing, clicking, and tabbing through fields, users speak — and your forms fill themselves. Built on the [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) and LLM-powered parsing, it's framework-agnostic, requires zero API keys in the browser, and everything happens in under 30 milliseconds.

## Install

```bash
npm install @voiceform/core
# or
pnpm add @voiceform/core
```

## Quickstart

Minimal example — contact form with voice input in 15 lines:

```ts
import { createVoiceForm } from '@voiceform/core'

const voiceForm = createVoiceForm({
  endpoint: '/api/voice-parse', // Your backend endpoint
  schema: {
    formName: 'Contact Form',
    fields: [
      { name: 'fullName', label: 'Full Name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'message', label: 'Message', type: 'textarea' },
    ],
  },
  events: {
    onDone: (result) => {
      if (result.success) {
        document.querySelector('form')?.submit()
      }
    },
  },
})
```

The mic button appears automatically. User taps it, speaks `"John Smith, john at example dot com, tell them I'm interested"`, and the form fields fill before they even finish speaking. One confirmation tap and you're done.

## How It Works

```
1. Tap mic  →  2. Speak naturally  →  3. Confirm values  →  4. Fields fill
```

- **Capture**: [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) captures audio from the user's microphone
- **Transcribe**: Raw speech is converted to text — via Web Speech or your own STT backend
- **Parse**: You send the transcript to your backend endpoint, which calls an LLM to extract structured field values (see [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs) or [Anthropic Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use))
- **Confirm**: Users verify what was heard before the form fills — no surprises
- **Inject**: Form fields update with sanitized values; synthetic `input` and `change` events fire so frameworks stay in sync

## BYOE: Bring Your Own Endpoint

voice-form never touches your API keys. You own the endpoint, the LLM calls, and all the secrets. The browser sends only the transcript and form schema — both visible on the Network tab and intentionally public-safe.

```ts
// Your backend (Node, Python, Go, whatever)
// POST /api/voice-parse
import { buildSystemPrompt, buildUserPrompt } from '@voiceform/server-utils'

export async function parseVoice(req) {
  const { transcript, schema } = req.body

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildSystemPrompt(schema) },
      { role: 'user', content: buildUserPrompt(transcript) },
    ],
  })

  return {
    fields: {
      fullName: { value: 'John Smith' },
      email: { value: 'john@example.com' },
    },
  }
}
```

Full reference endpoints for [SvelteKit](./examples/sveltekit/), [Next.js](./examples/nextjs/), and [Express](./examples/express/) in [examples/](./examples/).

## Performance

Everything voice-form does takes under 30ms. That's one animation frame at 60fps. The LLM inference time (200-500ms), network latency, and user reading time are all on your backend — not us. Check our bundle size on [Bundlephobia](https://bundlephobia.com/package/@voiceform/core).

| Package | Size (gzip) |
|---|---|
| `@voiceform/core` (headless) | ~7.2 KB |
| `@voiceform/core/ui` | ~4.8 KB |
| `@voiceform/svelte` | ~171 B |

## Svelte Integration

First-class [Svelte 5](https://svelte.dev/docs/svelte) support:

```bash
pnpm add @voiceform/svelte
```

```svelte
<script>
  import { VoiceForm } from '@voiceform/svelte'
</script>

<VoiceForm
  endpoint="/api/voice-parse"
  schema={mySchema}
/>
```

See the [API Reference](./docs/API.md) for the full component API, snippets, and store integration.

## Security Highlights

- **No API keys in the browser.** Ever. BYOE is not an option — it's the only path.
- **Output sanitization.** All LLM values are sanitized before DOM injection. XSS impossible from parsed fields.
- **CSRF protection.** Requests include the `X-VoiceForm-Request` header. Your endpoint validates it.
- **Prompt injection defense.** The transcript is passed to the LLM as JSON-escaped data in a separate `user` message, not string-interpolated into instructions. See [OWASP LLM01: Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) and the [Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).
- **Transparent data flows.** Web Speech API sends audio to Google. If that concerns you, bring your own STT adapter.

See [SECURITY.md](./docs/SECURITY.md) for the full threat model and the [OWASP Top 10 for LLM Applications](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/).

## Privacy

Voice input must be disclosed to users. The [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API) sends audio to Google's servers. voice-form provides built-in controls to show a privacy notice before requesting mic permission.

```ts
createVoiceForm({
  privacyNotice: 'Voice input uses your browser\'s speech recognition, processed by Google.',
  requirePrivacyAcknowledgement: true,
  // ...
})
```

Read [PRIVACY.md](./docs/PRIVACY.md) for data flows, GDPR considerations, and developer responsibilities.

## Accessibility

voice-form follows [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) for all interactive elements:

- Mic button: `role="button"`, keyboard-activatable (Enter/Space), `aria-label` per state
- Confirmation panel: `role="dialog"`, focus trap, Escape to cancel
- Screen reader announcements via `aria-live` regions
- `prefers-reduced-motion` respected for all animations

## Browser Support

voice-form requires [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) support:

- Chrome, Edge, Safari 14.1+ (full)
- Firefox 25+ (via flag in Nightly)

On unsupported browsers, the library gracefully disables the mic button and shows an "unavailable" message.

## First Use

The first time a user taps the mic button, their browser shows a microphone permission prompt. This is one-time only — the permission is remembered per origin.

## Links

- **[API Reference](./docs/API.md)** — Complete config, methods, types, and error codes
- **[Demo Site](./packages/demo/)** — Working contact form with voice input
- **[Security Guide](./docs/SECURITY.md)** — Threat model, developer checklist, mitigation strategies
- **[Privacy Guide](./docs/PRIVACY.md)** — Data flows, compliance, user disclosure
- **[Architecture](./docs/HIGH_LEVEL_DESIGN.md)** — High-level design, state machine, data flow
- **[Examples](./examples/)** — SvelteKit, Next.js, Express endpoint implementations

## Related Projects

- [form2agent-ai-react](https://github.com/fmtops/form2agent-ai-react) — Voice-assisted AI form filling with React and OpenAI
- [whisper-anywhere](https://github.com/Alireza29675/whisper-anywhere) — Chrome extension for voice input using Whisper
- [Vocode](https://github.com/vocodedev/vocode-core) — Open-source library for voice-based LLM applications
- [Ultravox](https://github.com/fixie-ai/ultravox) — Multimodal LLM with native speech understanding

## Contributing

Issues and PRs welcome. We use [Changesets](https://github.com/changesets/changesets) for versioning. Check [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

## License

[MIT](./LICENSE)
