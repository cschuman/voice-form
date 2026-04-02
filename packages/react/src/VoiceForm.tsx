/**
 * VoiceForm — React component wrapper for @voiceform/core
 *
 * Provides two usage modes:
 *
 * 1. **Render prop** (headless): Pass `children` as a function to receive
 *    `{ state, instance }` and render your own UI. Ref forwarding is a
 *    no-op in this mode — ref.current will be null.
 *
 * 2. **Default UI**: Omit `children` to render the built-in mic button UI.
 *    The forwarded ref resolves to the underlying `<button>` element.
 *
 * @example Render prop (headless)
 * ```tsx
 * <VoiceForm endpoint="/api/parse" schema={schema}>
 *   {({ state, instance }) => (
 *     <button onClick={() => instance.start()}>
 *       {state.status === 'recording' ? 'Stop' : 'Speak'}
 *     </button>
 *   )}
 * </VoiceForm>
 * ```
 *
 * @example Default UI with ref
 * ```tsx
 * const buttonRef = React.createRef<HTMLButtonElement>()
 * <VoiceForm ref={buttonRef} endpoint="/api/parse" schema={schema} />
 * ```
 */

import React from 'react'
import { useVoiceForm } from './use-voice-form.js'
import type { VoiceFormConfig, VoiceFormState, VoiceFormInstance } from '@voiceform/core'

// ─── Public types ──────────────────────────────────────────────────────────────

export interface VoiceFormRenderProps {
  state: VoiceFormState
  instance: VoiceFormInstance
}

export interface VoiceFormProps extends VoiceFormConfig {
  /**
   * Render prop / children-as-function API.
   * When provided, the default mic button UI is NOT rendered.
   * The developer is responsible for calling instance.start(), etc.
   * Ref forwarding is a no-op when this prop is used.
   */
  children?: (props: VoiceFormRenderProps) => React.ReactNode

  /**
   * Convenience prop: called after confirmation and injection complete.
   * Equivalent to VoiceFormConfig.events.onDone.
   * When both are provided, both callbacks are called (chained, not replaced).
   */
  onDone?: NonNullable<NonNullable<VoiceFormConfig['events']>['onDone']>

  /**
   * Convenience prop: called when an error occurs.
   * Equivalent to VoiceFormConfig.events.onError.
   * Chained with events.onError when both are provided.
   */
  onError?: NonNullable<NonNullable<VoiceFormConfig['events']>['onError']>

  /**
   * When provided, DOM injection is skipped. The developer receives parsed,
   * sanitized field values and updates their form state directly.
   *
   * Use for: React Hook Form, Formik, React 19 form actions, rich text editors.
   *
   * The confirmation step still occurs unless skipConfirmation is also set.
   * Values have been sanitized through sanitizeFieldValue before being passed here.
   *
   * WARNING: onChange handlers on controlled inputs may fire during DOM injection
   * when onFieldsResolved is NOT used.
   */
  onFieldsResolved?: (fields: Record<string, string>) => void
}

// ─── DefaultVoiceFormUI ────────────────────────────────────────────────────────

interface DefaultVoiceFormUIProps {
  state: VoiceFormState
  instance: VoiceFormInstance
  buttonRef: React.ForwardedRef<HTMLButtonElement>
  onFieldsResolved?: ((fields: Record<string, string>) => void) | undefined
}

function DefaultVoiceFormUI({
  state,
  instance,
  buttonRef,
}: DefaultVoiceFormUIProps) {
  const isRecording = state.status === 'recording'
  const isProcessing = state.status === 'processing'
  const isDisabled = isProcessing || state.status === 'injecting'

  function handleClick() {
    if (isRecording) {
      instance.stop()
    } else if (state.status === 'idle' || state.status === 'done' || state.status === 'error') {
      void instance.start()
    }
  }

  let label = 'Start voice input'
  if (isRecording) label = 'Stop recording'
  else if (isProcessing) label = 'Processing…'
  else if (state.status === 'confirming') label = 'Confirm or cancel'
  else if (state.status === 'injecting') label = 'Injecting…'
  else if (state.status === 'done') label = 'Voice input complete'
  else if (state.status === 'error') label = 'Voice input error'

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      disabled={isDisabled}
      onClick={handleClick}
      data-voiceform-status={state.status}
    >
      {label}
    </button>
  )
}

// ─── VoiceForm ─────────────────────────────────────────────────────────────────

export const VoiceForm = React.forwardRef<HTMLButtonElement, VoiceFormProps>(
  (props, ref) => {
    const { children, onDone, onError, onFieldsResolved, ...voiceFormConfig } = props

    // Chain developer convenience callbacks with any events already in config.
    // Do NOT override events by spreading — chain them so both run.
    const mergedConfig: VoiceFormConfig = {
      ...voiceFormConfig,
      events: {
        ...voiceFormConfig.events,
        ...(onDone !== undefined || voiceFormConfig.events?.onDone !== undefined
          ? {
              onDone: (result) => {
                voiceFormConfig.events?.onDone?.(result)
                onDone?.(result)
              },
            }
          : {}),
        ...(onError !== undefined || voiceFormConfig.events?.onError !== undefined
          ? {
              onError: (err) => {
                voiceFormConfig.events?.onError?.(err)
                onError?.(err)
              },
            }
          : {}),
      },
    }

    const { state, instance } = useVoiceForm(mergedConfig)

    if (typeof children === 'function') {
      // Render prop: developer controls UI. Ref forwarding is a no-op here.
      return <>{children({ state, instance })}</>
    }

    // Default UI: forward ref to the internal mic button.
    return (
      <DefaultVoiceFormUI
        state={state}
        instance={instance}
        buttonRef={ref}
        onFieldsResolved={onFieldsResolved}
      />
    )
  },
)

VoiceForm.displayName = 'VoiceForm'
