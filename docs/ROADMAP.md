# voice-form — Product Roadmap

## Guiding Rule

Each version must be independently shippable and useful. A developer picking up v0.1 should have a complete, working experience — not a preview of something that will be finished later.

---

## Security Baseline

Security controls are not features. They are requirements for each version to ship. This table defines the minimum security posture at each milestone.

| Control | v0.1 | v1.0 | v2.0 |
|---|---|---|---|
| API keys absent from all browser-side code paths | Required | Required | Required |
| LLM output sanitized (`stripHtml`) before DOM injection | Required | Required | Required |
| Transcript validation (maxTranscriptLength, control char rejection) | Required | Required | Required |
| CSRF signal header (`X-VoiceForm-Request`) on all parse requests | Required | Required | Required |
| Role-separated prompt template (not string-interpolated user input) | Required | Required | Required |
| Privacy notice config option for STT data disclosure | — | Required | Required |
| Request cooldown (`requestCooldownMs`) to prevent abuse | — | Required | Required |
| Documented threat model in `/docs/security.md` | — | Required | Required |
| SRI guidance for CDN distribution | — | Required | Required |
| Blob cleanup after Whisper POST | — | — | Required |

---

## v0.1 — MVP (Target: "Does it work?")

**Definition of done:** A developer with zero prior knowledge of voice-form can clone the repo, follow the README, and have voice input working in a local form within 20 minutes.

### What ships

- `@voiceform/core` — TypeScript core package
  - Mic lifecycle management (request permission, start, stop, error states)
  - Web Speech API adapter (default, no install required)
  - Schema config interface: field name, type, description
  - LLM parse request builder — formats transcript + schema into a prompt payload using role-separated templates, not string interpolation of user input
  - Confirmation step — surfaces parsed values to user before injecting
  - Field injection callback — developer owns the write
  - Output sanitization — `stripHtml` applied to all LLM-returned values before any DOM operation; LLM responses are never treated as trusted input
  - Transcript validation — `maxTranscriptLength` enforced, control characters rejected before the transcript is sent to the BYOE endpoint
  - CSRF signal header — `X-VoiceForm-Request: 1` included on all parse requests so server-side middleware can distinguish voice-form traffic from arbitrary cross-origin POSTs
  - DOM injection batching — field writes and event dispatches batched with `requestAnimationFrame` (two-pass: write all values in one frame, dispatch all synthetic events in the next); cached native value setters and element cache for repeated invocations on the same form
- `@voiceform/svelte` — Svelte 5 wrapper (thin component over core)
- BYOE pattern — documented API contract the developer's endpoint must fulfill
- Demo site — single-page Svelte app showing a realistic form (5+ fields, mixed types)
- README with a working quickstart (copy-paste runnable), including a note that the default Web Speech API adapter sends audio to Google's servers
- Monorepo scaffolded with pnpm workspaces and `tsup` for builds

### Acceptance Criteria

- [ ] `pnpm install && pnpm build` completes with zero errors across all packages
- [ ] Demo site runs locally and completes a full voice-to-form flow end-to-end
- [ ] Core package has no runtime dependencies (dev dependencies are fine)
- [ ] Schema config is explicitly defined — no DOM scanning
- [ ] No API key, token, or credential appears in any browser-side code path, including configuration options
- [ ] Confirmation dialog is not bypassable by configuration in v0.1
- [ ] All LLM-returned field values pass through `stripHtml` before any DOM operation
- [ ] Transcripts exceeding `maxTranscriptLength` are rejected with a recoverable error state
- [ ] All parse requests include the `X-VoiceForm-Request` header
- [ ] Field injection completes within a single `requestAnimationFrame` cycle for forms up to 20 fields

### What is explicitly NOT in v0.1

- React wrapper
- Whisper or any paid STT adapter
- npm publish / versioned releases
- Accessibility audit
- Any test coverage (deferred to v1.0 pre-release gate)
- Privacy acknowledgement UI (the README disclosure is sufficient at this stage)

---

## v1.0 — Stable (Target: "Production ready")

**Definition of done:** A team can adopt voice-form in a production internal tool and trust it to behave correctly, fail gracefully, and be maintained.

### What ships (incremental over v0.1)

- Test suite — 85%+ coverage on `@voiceform/core`, integration tests on the Svelte wrapper
- Error handling hardened — mic denied, browser unsupported, endpoint timeout, LLM parse failure all produce recoverable states with clear developer-facing messages
- Accessibility baseline — keyboard fallback always present, ARIA labels on mic button, confirmation dialog focus-managed
- STT adapter interface formalized — documented contract so community adapters can be built against it
- Configuration surface stabilized — `VoiceFormConfig` type is the public API contract, considered stable at 1.0
- npm publish pipeline — `@voiceform/core` and `@voiceform/svelte` published under a real version
- CHANGELOG and contribution guide
- Privacy notice config — `privacyNotice` option accepts a string displayed near the mic button; `requirePrivacyAcknowledgement` blocks recording until the user has acknowledged it. This is how applications disclose that audio is processed by a third-party STT provider (e.g., Google Web Speech API)
- `requestCooldownMs` — configurable cooldown between parse requests, preventing abuse patterns where repeated rapid submissions probe the BYOE endpoint
- Bundle size CI gate — `size-limit` configured to measure the actual tree-shaken output of `import { createVoiceForm } from '@voiceform/core'`; build fails if the headless core exceeds the 8 KB target
- Default UI code-split — `@voiceform/core/ui` is a separate subpath export; headless consumers and server-side bundles never pay for the default UI module (~2.5–3.5 KB savings for headless usage)
- Prompt builder strings moved to `@voiceform/server-utils` — `buildSystemPrompt` and `buildUserPrompt` live in a server-side package, not in the browser bundle; the ~700–900 byte prompt template is eliminated from the client bundle
- Tree-shakeable exports — `DefaultUI` and `WebSpeechAdapter` are explicit named imports from their respective subpaths, not implicit defaults wired in by the factory; bundlers can eliminate them at build time for headless or custom-adapter usage
- Security review of BYOE pattern — documented threat model in `/docs/security.md`, covering what the library does and does not protect against, with SRI guidance for CDN distribution
- `PRIVACY.md` — document describing the data flows for each supported STT backend (what leaves the browser, where it goes, what the provider's retention policy is, and what the developer must disclose to their users)

### Acceptance Criteria

- [ ] All tests pass in CI on Node 20 LTS
- [ ] `@voiceform/core` and `@voiceform/svelte` published to npm at `1.0.0`
- [ ] A developer can handle all documented error states without the app crashing
- [ ] Keyboard-only user can submit a form normally when voice fails or is unavailable
- [ ] `VoiceFormConfig` type is documented with JSDoc — no undocumented required fields
- [ ] Threat model document exists in `/docs/security.md`
- [ ] `PRIVACY.md` exists and covers Web Speech API and Whisper data flows
- [ ] Zero `any` types in `@voiceform/core` public API surface
- [ ] Bundle size CI gate is active; headless core is at or under 8 KB minified+gzip
- [ ] `@voiceform/core` (headless, no UI import) does not include `DefaultUI` or its CSS string in the output bundle
- [ ] `privacyNotice` renders before recording begins when configured
- [ ] `requirePrivacyAcknowledgement: true` prevents recording until the user has dismissed the notice

### What is explicitly NOT in v1.0

- React wrapper (still v2)
- Multi-step / wizard form support
- Partial fills ("fill just the name field")
- Schema auto-detection from DOM

---

## v2.0 — Growth (Target: "Broadly compelling")

**Definition of done:** Developers outside the internal-tools niche have a reason to adopt. The React ecosystem is served. The adapter model has proven itself with community contributions.

### What ships (incremental over v1.0)

- `@voiceform/react` — React 18+ wrapper (hooks-based, same config interface as Svelte wrapper)
- Whisper adapter — `@voiceform/adapter-whisper` — optional package, plugs into the STT adapter interface defined in v1.0; documents explicit `Blob.arrayBuffer()` read and cleanup after the POST to the Whisper endpoint — no audio data lingers in memory after the request completes
- Partial fill support — user says "just set the priority to high" without filling all fields
- Multi-step form support — voice session spans across form steps, schema can be provided per-step
- Field-level correction UX — after confirmation, the user can re-record a single field without restarting the full voice session
- Schema auto-detection from DOM — `@voiceform/dom-detect` optional utility (experimental, opt-in)
- `@voiceform/dev` — scoped strictly to developer tooling: schema inspector, request/response logger, and state visualizer; not a general-purpose BYOE stub and not included in any production bundle

### Acceptance Criteria

- [ ] `@voiceform/react` published and passing its own test suite
- [ ] `@voiceform/adapter-whisper` published, documented, and works with the v1.0 adapter interface without patching core
- [ ] `@voiceform/adapter-whisper` source explicitly releases the audio Blob after the POST completes; this is called out in the adapter's documentation
- [ ] Partial fill does not overwrite fields the user did not mention
- [ ] Multi-step support tested against a 3-step form in the demo site
- [ ] Field-level correction re-records and re-parses only the targeted field
- [ ] `@voiceform/dev` is guarded so it cannot be imported in a production build (package.json `exports` condition or runtime check)

---

## Future / Icebox

These are things users will ask for. They are not on the roadmap. They may be revisited when the v2.0 adoption signal is clear.

- **Mobile / native app support** — React Native, Capacitor. Blocked on Web Speech API availability and mic permission models being meaningfully different.
- **Streaming transcription UX** — Show words as they are spoken. Real UX improvement but meaningfully complicates the confirmation step interaction model.
- **Offline / local LLM support** — WebLLM or similar. Interesting for privacy-sensitive deployments. Blocked on model quality and bundle size being viable.
- **Voice commands beyond field filling** — "Submit the form," "clear everything," navigation. Moves the product toward a voice assistant, which is a different product.
- **Analytics / telemetry** — Opt-in success rate tracking. Requires thinking carefully about what data leaves the user's app and under what terms.
- **Audio file upload support** — Drop an audio file instead of live mic. Useful for async workflows. Not a form UX problem.

---

## Anti-Roadmap

These are things we will never build. They are listed explicitly so we stop discussing them.

**Hosted backend / cloud service.** The BYOE pattern is a feature, not a limitation. The moment we host infrastructure, we own SLAs, data custody, and pricing decisions. That is a different company, not a library.

**Built-in LLM provider.** We will not bundle API keys, proxy LLM calls, or manage rate limits. The developer owns their LLM relationship. We provide the prompt contract.

**A UI component library.** The Svelte and React wrappers ship a mic button and a confirmation dialog. They are not a design system. Developers style them or replace them. We do not ship themes.

**Auto-submit without confirmation.** A form that submits what the LLM guessed, without the user reviewing it, is a liability. Confirmation is a product principle, not a configuration option.

**Auto-fill without confirmation step.** A variant of the above: no configuration option, no flag, and no API surface will ever write field values into a form without the user first seeing and approving the parsed result. This is not a missing feature — it is a deliberate constraint.

**DOM mutation for field injection without developer consent.** We call the developer's callback. We do not reach into the DOM and write field values directly. The developer owns the form state.

**A proprietary schema format.** The schema config is plain TypeScript objects. We will not invent a DSL, a JSON schema dialect, or a visual builder that generates config. Plain objects are enough.

**`llmAdapter` accepting remote API keys in the browser.** There will be no configuration option, escape hatch, or adapter pattern that passes an LLM API key through browser-side code. The principle is absolute: API keys belong on the developer's server. Any design that creates a path for credentials to exist in the browser is rejected regardless of how it is named or documented.
