<script lang="ts" module>
  import type {
    VoiceFormConfig,
    VoiceFormInstance,
    VoiceFormState,
    VoiceFormStrings,
    FormSchema,
    STTAdapter,
    EndpointOptions,
    UIOptions,
    VoiceFormEvents,
    ConfirmationData,
    ConfirmedField,
  } from '@voiceform/core'

  export type { VoiceFormInstance, VoiceFormState }
</script>

<script lang="ts">
  import { createVoiceForm } from '@voiceform/core'
  import { onMount, onDestroy, type Snippet } from 'svelte'

  // ─── Props ──────────────────────────────────────────────────────────────

  interface Props {
    /** URL of the BYOE parse endpoint. */
    endpoint: string
    /** Form field schema. */
    schema: FormSchema
    /** Optional STT adapter override. */
    sttAdapter?: STTAdapter
    /** DOM element or CSS selector for the form. */
    formElement?: HTMLElement | string
    /** Mount target for the mic button container. */
    mountTarget?: HTMLElement | string
    /** When true, renders nothing. Instance available via context. */
    headless?: boolean
    /** Cooldown between endpoint requests (ms). */
    requestCooldownMs?: number
    /** Privacy notice text. */
    privacyNotice?: string
    /** Require privacy acknowledgement before mic access. */
    requirePrivacyAcknowledgement?: boolean
    /** Max transcript characters. */
    maxTranscriptLength?: number
    /** Endpoint client options. */
    endpointOptions?: EndpointOptions
    /** UI customization. */
    ui?: UIOptions
    /** Developer event callbacks. */
    events?: VoiceFormEvents
    /** Debug mode. */
    debug?: boolean
    /** i18n string overrides. */
    strings?: Partial<VoiceFormStrings>
    /** CSS class for root element. */
    class?: string
    /** Custom button snippet: receives { state, onActivate, onStop }. */
    button?: Snippet<[{ state: VoiceFormState; onActivate: () => void; onStop: () => void }]>
    /** Custom confirmation snippet: receives { fields, onConfirm, onCancel }. */
    confirmation?: Snippet<[{ fields: Record<string, ConfirmedField>; onConfirm: () => void; onCancel: () => void }]>
  }

  let {
    endpoint,
    schema,
    sttAdapter,
    formElement,
    mountTarget,
    headless = false,
    requestCooldownMs,
    privacyNotice,
    requirePrivacyAcknowledgement,
    maxTranscriptLength,
    endpointOptions,
    ui,
    events,
    debug,
    strings,
    class: className = '',
    button: buttonSnippet,
    confirmation: confirmationSnippet,
  }: Props = $props()

  // ─── Instance lifecycle ─────────────────────────────────────────────────

  let instance: VoiceFormInstance | null = $state(null)
  let currentState: VoiceFormState = $state({ status: 'idle' })
  let unsubscribe: (() => void) | null = null

  // Build config from props
  function buildConfig(): VoiceFormConfig {
    const config: VoiceFormConfig = {
      endpoint,
      schema,
      headless,
    }
    if (sttAdapter !== undefined) config.sttAdapter = sttAdapter
    if (formElement !== undefined) config.formElement = formElement
    if (mountTarget !== undefined) config.mountTarget = mountTarget
    if (requestCooldownMs !== undefined) config.requestCooldownMs = requestCooldownMs
    if (privacyNotice !== undefined) config.privacyNotice = privacyNotice
    if (requirePrivacyAcknowledgement !== undefined) config.requirePrivacyAcknowledgement = requirePrivacyAcknowledgement
    if (maxTranscriptLength !== undefined) config.maxTranscriptLength = maxTranscriptLength
    if (endpointOptions !== undefined) config.endpointOptions = endpointOptions
    if (ui !== undefined) config.ui = ui
    if (events !== undefined) config.events = events
    if (debug !== undefined) config.debug = debug
    return config
  }

  onMount(() => {
    instance = createVoiceForm(buildConfig())
    unsubscribe = instance.subscribe((state: VoiceFormState) => {
      currentState = state
    })
  })

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    if (instance) {
      instance.destroy()
      instance = null
    }
  })

  // ─── Derived state ──────────────────────────────────────────────────────

  let status = $derived(currentState.status)
  let isRecording = $derived(status === 'recording')
  let isProcessing = $derived(status === 'processing')
  let isConfirming = $derived(status === 'confirming')
  let isDone = $derived(status === 'done')
  let isError = $derived(status === 'error')
  let isDisabled = $derived(
    status === 'processing' || status === 'confirming' || status === 'injecting',
  )

  let ariaLabel = $derived.by(() => {
    switch (status) {
      case 'idle': return 'Use voice input'
      case 'recording': return 'Stop recording'
      case 'processing': return 'Processing speech'
      case 'done': return 'Voice input complete'
      case 'error': return 'Voice input error'
      default: return 'Use voice input'
    }
  })

  let statusText = $derived.by(() => {
    switch (status) {
      case 'recording': return 'Listening\u2026'
      case 'processing': return 'Processing\u2026'
      case 'done': return 'Form filled'
      default: return ''
    }
  })

  let confirmationData = $derived.by(() => {
    if (currentState.status === 'confirming') {
      return currentState.confirmation
    }
    return null
  })

  // ─── Handlers ───────────────────────────────────────────────────────────

  function handleButtonClick(): void {
    if (!instance) return
    if (isRecording) {
      instance.stop()
    } else if (status === 'idle') {
      instance.start()
    }
  }

  function handleConfirm(): void {
    if (!instance) return
    instance.confirm()
  }

  function handleCancel(): void {
    if (!instance) return
    instance.cancel()
  }
</script>

{#if !headless}
  <div class="vf-root {className}">
    <!-- Button area -->
    {#if buttonSnippet}
      {@render buttonSnippet({ state: currentState, onActivate: () => instance?.start(), onStop: () => instance?.stop() })}
    {:else}
      <button
        type="button"
        class="vf-mic-button"
        class:vf-recording={isRecording}
        class:vf-processing={isProcessing}
        class:vf-done={isDone}
        class:vf-error={isError}
        aria-label={ariaLabel}
        aria-pressed={isRecording ? 'true' : 'false'}
        aria-disabled={isDisabled ? 'true' : undefined}
        aria-describedby="vf-status"
        onclick={handleButtonClick}
      >
        <span class="vf-mic-icon" aria-hidden="true"></span>
      </button>
    {/if}

    <!-- Status text / live region -->
    <div
      id="vf-status"
      class="vf-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {statusText}
    </div>

    <!-- Confirmation panel -->
    {#if isConfirming && confirmationData}
      {#if confirmationSnippet}
        {@render confirmationSnippet({
          fields: confirmationData.parsedFields,
          onConfirm: handleConfirm,
          onCancel: handleCancel,
        })}
      {:else}
        <div
          class="vf-confirmation"
          role="dialog"
          aria-modal="false"
          aria-label="Confirm voice input"
        >
          <h3 class="vf-confirmation-title">What I heard</h3>
          <p class="vf-confirmation-transcript">{confirmationData.transcript}</p>

          <dl class="vf-confirmation-fields">
            {#each Object.entries(confirmationData.parsedFields) as [name, field]}
              <div class="vf-confirmation-field">
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            {/each}
          </dl>

          {#if confirmationData.missingFields.length > 0}
            <p class="vf-confirmation-missing">
              Not recognized: {confirmationData.missingFields.join(', ')}
            </p>
          {/if}

          <div class="vf-confirmation-actions">
            <button
              type="button"
              class="vf-cancel-button"
              data-vf-cancel
              aria-label="Cancel and discard voice input"
              onclick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              class="vf-confirm-button"
              data-vf-confirm
              aria-label="Accept and fill form with these values"
              onclick={handleConfirm}
            >
              Fill form
            </button>
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}
