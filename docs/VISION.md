# voice-form — Product Vision

## Problem Statement

Forms are the primary data-entry interface on the web, and they are bad at their job. Tabbing through fields, typing carefully, correcting mistakes — it is friction that exists not because it is necessary, but because keyboards were the only input device we designed for.

Voice changes that calculus. People speak at 130 words per minute and type at 40. The gap between what a user knows and what a form captures is almost entirely input friction. For internal tools — admin panels, CRM entry, ops dashboards — this friction compounds across hundreds of repetitive submissions per day.

The technology has finally caught up. Web Speech API ships in every major browser. LLMs can parse natural language into structured field values with high accuracy. The missing piece is not capability. It is a clean, composable, drop-in component that handles the messy parts: mic lifecycle, speech-to-text, schema-aware parsing, confirmation UX, and graceful fallback. Developers currently have to build all of that from scratch or skip voice entirely. Neither is a good answer.

## Vision Statement

voice-form is the drop-in voice input layer for web forms — open source, framework-friendly, backend-agnostic, and designed so that adding voice to a form takes minutes, not sprints.

## Target Users

**Primary — Internal tools developers.** Building admin UIs, ops dashboards, and CRM workflows inside companies. They own the form schema, they control the backend, and they feel the friction daily. They want fast, reliable, and unobtrusive. They will not tolerate magic they cannot debug.

**Secondary — Product engineers at SaaS companies.** Adding voice as a differentiating input method for end users. More sensitive to bundle size and accessibility. Will evaluate polish and documentation before adopting.

**Tertiary — Open-source contributors and framework ecosystem maintainers.** Interested in extending the adapter model (new STT backends, new framework wrappers). They care about API design and internal architecture quality.

## Value Proposition

For a developer, integrating voice-form means:

1. Install the package and configure a schema — 5 minutes.
2. Add one API route to your existing server — 10 minutes.
3. Drop the component into your form — 2 minutes.

The developer retains full ownership: their form, their endpoint, their LLM call, their keys. voice-form handles everything between the user's mouth and the form fields, and nothing else.

## Key Principles

**We will:**
- Ship a zero-dependency TypeScript core with adapters as the extension point
- Default to the Web Speech API so nothing extra is needed to try it
- Require explicit schema configuration — we parse what developers define, not what we guess
- Show users what was heard before injecting values (confirmation is not optional)
- Keep API keys off the browser by design — BYOE means the developer's server is the trust boundary, with no escape hatches and no configuration options that put credentials in browser-side code
- Treat all external data as untrusted — LLM responses are sanitized before any DOM operation; the library has no implicit trust in any external system
- Be transparent about data flows — every STT backend that sends audio or text off the user's device is documented, and applications are given the tools to disclose this to their users
- Own zero perceptible latency — everything voice-form does completes within a single animation frame; the dominant costs (LLM inference, network, user reading time) belong to the developer's stack, not ours
- Document every architectural decision so contributors understand the reasoning, not just the rules

**We will not:**
- Host infrastructure, store audio, or proxy LLM calls
- Auto-detect fields from the DOM in v1 — this trades correctness for convenience at the wrong tradeoff
- Bundle a UI framework — wrappers are thin adapters, not design systems
- Solve for every edge case before shipping — a working v0.1 beats a perfect v0.0

## Success Metrics

**v0.1 (working):** A developer can add voice input to a form in under 20 minutes following the README. The demo site demonstrates a complete end-to-end flow.

**v1.0 (trusted):** voice-form is cited in at least 3 production internal tools. Zero reported cases of API keys leaking through the library. Test coverage above 85% on core. Applications using voice-form have a documented, configurable way to inform users that their voice data is processed by a third-party STT provider.

**v2.0 (adopted):** 500+ GitHub stars. React wrapper shipped and used in at least one publicly listed project. At least 2 community-contributed STT adapters merged.

**Long-term signal:** Developers recommend it to each other unprompted. The architecture debate in the README is shorter than the getting-started guide.

## Competitive Landscape

| Tool | What it is | Why we're different |
|---|---|---|
| **Speechly** | Hosted voice platform with proprietary SDK | Hosted infra, closed source, not drop-in for existing forms |
| **Alan AI** | Conversational voice assistant builder | Conversation-oriented, not form-field-oriented, requires their cloud |
| **react-speech-recognition** | React hook wrapping Web Speech API | Raw transcription only — no LLM parsing, no schema awareness, no confirmation |
| **browser built-ins** (`<input speech>`) | Deprecated Chrome-only attribute | Dead, no parsing layer, no UX |
| **Roll your own** | What most teams do | Expensive, inconsistent, rarely reused across projects |

The gap voice-form fills is specific: schema-aware, LLM-powered field mapping, with a confirmation step, no hosted dependency, sanitized output, documented data flows, and first-class framework wrappers. Nothing in the current landscape covers that combination.
