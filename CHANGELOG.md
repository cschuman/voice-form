# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-01

Initial release of the voice-form monorepo.

### @voiceform/core

#### Added
- `createVoiceForm()` factory — headless, framework-agnostic voice form engine
- Declarative `FormSchema` / `FieldSchema` DSL for defining voice-driven forms
- Schema validation via `validateSchema()`
- Finite state machine driving the conversation flow (idle, listening, processing, confirming, complete, error)
- Web Speech API adapter (`createWebSpeechAdapter()`) as the built-in STT provider
- Pluggable STT adapter interface for bring-your-own speech recognition
- BYOE (Bring Your Own Endpoint) architecture — LLM parsing runs server-side only
- Prompt builder for constructing system/user messages from schema and transcript
- Input sanitization and transcript validation utilities
- DOM injection system for mounting UI into host pages
- Default UI renderer (`mountDefaultUI()`) with confirmation panel and privacy notice
- Separate `@voiceform/core/ui` subpath export — headless consumers pay zero UI bundle cost
- CDN-ready IIFE build (`dist/voiceform.global.js`) exposing `window.VoiceForm`
- Full TypeScript type exports for all public interfaces

### @voiceform/svelte

#### Added
- `<VoiceForm>` Svelte 5 component wrapping `@voiceform/core`
- `createVoiceFormStore()` reactive store adapter
- Direct `.svelte` source export at `@voiceform/svelte/VoiceForm.svelte`
- Re-exports of commonly needed core types

### @voiceform/server-utils

#### Added
- `buildSystemPrompt()` and `buildUserPrompt()` for BYOE endpoint handlers
- Server-side prompt template construction from form schema and transcript
- Type re-exports of `FormSchema` and `FieldSchema` for server-side type safety
