/**
 * @voiceform/react — public API
 *
 * React wrapper for @voiceform/core providing:
 * - useVoiceForm hook for headless integration
 * - VoiceForm component for plug-and-play UI
 */

// ─── React-specific exports ───────────────────────────────────────────────────

export { useVoiceForm } from './use-voice-form.js'
export type { UseVoiceFormResult } from './use-voice-form.js'

export { VoiceForm } from './VoiceForm.js'
export type { VoiceFormProps, VoiceFormRenderProps } from './VoiceForm.js'

// ─── Re-exported core types (convenience) ─────────────────────────────────────

export type {
  VoiceFormConfig,
  VoiceFormInstance,
  VoiceFormState,
  VoiceFormError,
  VoiceFormErrorCode,
  FormSchema,
  FieldSchema,
  FieldType,
  ConfirmationData,
  ConfirmedField,
  InjectionResult,
  STTAdapter,
} from '@voiceform/core'
