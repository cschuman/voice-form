// @voiceform/svelte — Svelte 5 wrapper for @voiceform/core
//
// The VoiceForm component is imported directly by consumers:
//   import VoiceForm from '@voiceform/svelte/VoiceForm.svelte'
//
// Stores and types are available from this entry point:
//   import { createVoiceFormStore } from '@voiceform/svelte'

export { createVoiceFormStore } from './stores.js'
export type { Readable } from './stores.js'

// Re-export commonly needed types from core
export type {
  VoiceFormConfig,
  VoiceFormInstance,
  VoiceFormState,
  VoiceFormStrings,
  FormSchema,
  FieldSchema,
  ConfirmationData,
  ConfirmedField,
  InjectionResult,
  VoiceFormError,
  VoiceFormErrorCode,
} from '@voiceform/core'

export const SVELTE_WRAPPER_VERSION = '0.0.0'
