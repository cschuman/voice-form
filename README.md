# voice-form

**Drop-in voice input for web forms. Speak naturally. Fill forms intelligently.**

voice-form transforms the way users interact with forms. Instead of typing, clicking, and tabbing through fields, users speak—and your forms fill themselves. Built on Web Speech API and LLM-powered parsing, it's framework-agnostic, requires zero configuration of API keys in the browser, and everything happens in under 30 milliseconds.

## Install

```bash
npm install @voiceform/core
# or pnpm, yarn, bun
pnpm add @voiceform/core
```

## Quickstart

Minimal example—contact form with voice input in 15 lines:

```ts
import { createVoiceForm } from '@voiceform/core'

const voiceForm = await createVoiceForm({
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
1. Tap mic → 2. Speak naturally → 3. Confirm values → 4. Fields fill
```

- **Capture**: Web Speech API captures audio from the user's microphone (same as Google Search and Slack)
- **Transcribe**: Raw speech is converted to text—either via Web Speech or your own STT backend
- **Parse**: You send the transcript to your backend endpoint, which calls an LLM to extract structured field values
- **Confirm**: Users verify what was heard before the form fills—no surprises
- **Inject**: Form fields update with sanitized values; synthetic `input` and `change` events fire so frameworks stay in sync

## BYOE: Bring Your Own Endpoint

voice-form never touches your API keys. You own the endpoint, the LLM calls, and all the secrets. The browser sends only the transcript and form schema—both visible on the Network tab and intentionally public-safe.

```ts
// Your backend (Node, Python, Go, whatever)
// POST /api/voice-parse
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

See [`@voiceform/server-utils`](#server-utils) for prompt builders. Full reference endpoints in [examples/](./examples/).

## Performance

Everything voice-form does takes under 30ms. That's one animation frame at 60fps. The LLM inference time (200–500ms), network latency, and the user reading time are all on your backend—not us.

## Security Highlights

- **No API keys in the browser.** Ever. BYOE is not an option—it's the only path.
- **Output sanitization.** All LLM values are sanitized before DOM injection. XSS impossible from parsed fields.
- **CSRF protection.** Requests include the `X-VoiceForm-Request` header. Your endpoint validates it.
- **Prompt injection defense.** The transcript is passed to the LLM as JSON-escaped data in a separate `user` message, not string-interpolated into instructions.
- **Transparent data flows.** Web Speech API sends audio to Google. If that concerns you, bring your own STT adapter.

See [SECURITY.md](./docs/SECURITY.md) for the full threat model and implementation checklist.

## Privacy

Voice input must be disclosed to users. The Web Speech API sends audio to Google's servers. voice-form provides built-in controls to show a privacy notice before requesting mic permission.

```ts
createVoiceForm({
  privacyNotice: 'Voice input uses your browser\'s speech recognition, processed by Google.',
  requirePrivacyAcknowledgement: true, // User must opt in
  // ... rest of config
})
```

Read [PRIVACY.md](./docs/PRIVACY.md) for data flows, GDPR considerations, and developer responsibilities.

## Links

- **[API Reference](./docs/API.md)** — Complete config, methods, types, and error codes
- **[Demo Site](./packages/demo/)** — Working contact form with voice input
- **[Security Guide](./docs/SECURITY.md)** — Threat model, developer checklist, mitigation strategies
- **[Privacy Guide](./docs/PRIVACY.md)** — Data flows, compliance, user disclosure
- **[High-Level Design](./docs/HIGH_LEVEL_DESIGN.md)** — Architecture, state machine, data flow
- **[Examples](./examples/)** — SvelteKit, Next.js, Express endpoint implementations

## First Use

The first time a user taps the mic button, their browser shows a microphone permission prompt. This is one-time only—the permission is remembered. No prompt after that.

## Browser Support

voice-form requires Web Speech API support:

- Chrome, Edge, Safari 14.1+ (full)
- Firefox 25+ (via flag in Nightly)

On unsupported browsers, the library gracefully disables the mic button and shows an "unavailable" message.

## Contributing

Issues and PRs welcome. Check [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow.

## License

MIT

---

**Questions?** Open an issue. Want to showcase your app? Add it to [SHOWCASE.md](./SHOWCASE.md).
