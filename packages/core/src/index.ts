// @voiceform/core — public API entry point
//
// Only symbols that form the documented public contract are exported here.
// Internal modules (state-machine, endpoint-client, injector, sanitize,
// validate-transcript) are deliberately excluded — consumers have no need
// to import them directly and isolating them keeps the public surface small.

// ─── Runtime values ───────────────────────────────────────────────────────────

export { createVoiceForm, VoiceFormConfigError } from './create-voice-form.js'
export { buildPrompt, buildFieldPrompt, VERSION } from './prompt-builder.js'
export { createWebSpeechAdapter } from './adapters/web-speech.js'
export { validateSchema } from './schema-validator.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export type {
  // Field schema
  FieldType,
  FieldSchema,
  FormSchema,
  // STT adapter
  STTErrorCode,
  STTError,
  STTAdapterEvents,
  STTAdapter,
  // BYOE contract
  ParsedFieldValue,
  ParseResponse,
  // State machine
  VoiceFormState,
  VoiceFormEvent,
  // Confirmation
  ConfirmationData,
  // Injection
  InjectionResult,
  // Strings / i18n
  VoiceFormStrings,
  // Errors
  VoiceFormErrorCode,
  VoiceFormError,
  // Configuration and instance
  VoiceFormConfig,
  VoiceFormInstance,
} from './types.js'
