<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { createVoiceForm } from '@voiceform/core'
  import type {
    VoiceFormInstance,
    VoiceFormState,
    ConfirmationData,
    ConfirmedField,
  } from '@voiceform/core'

  let voiceInstance: VoiceFormInstance | null = null
  let currentState: VoiceFormState = $state({ status: 'idle' })
  let errorMessage = $state('')
  let unsubscribe: (() => void) | null = null

  let formData = $state({
    fullName: '',
    email: '',
    phone: '',
    message: '',
  })

  // Derived state
  let status = $derived(currentState.status)
  let isRecording = $derived(status === 'recording')
  let isProcessing = $derived(status === 'processing')
  let isConfirming = $derived(status === 'confirming')
  let isBusy = $derived(
    status === 'recording' || status === 'processing' || status === 'injecting',
  )

  let confirmationFields = $derived.by(() => {
    if (currentState.status === 'confirming') {
      return currentState.confirmation?.parsedFields ?? {}
    }
    return {}
  })

  onMount(() => {
    try {
      voiceInstance = createVoiceForm({
        endpoint: '/api/voice-parse',
        schema: {
          formName: 'Contact Form',
          formDescription: 'Get in touch with us',
          fields: [
            {
              name: 'fullName',
              label: 'Full Name',
              type: 'text',
              required: true,
              description: "The person's full name",
            },
            {
              name: 'email',
              label: 'Email Address',
              type: 'email',
              required: true,
              description: 'Email address',
            },
            {
              name: 'phone',
              label: 'Phone Number',
              type: 'tel',
              description: 'Phone number (optional)',
            },
            {
              name: 'message',
              label: 'Message',
              type: 'textarea',
              description: 'What they want to tell us',
            },
          ],
        },
        formElement: '#demo-form',
        events: {
          onDone: () => {
            // Read values from the DOM after injection
            const form = document.getElementById('demo-form') as HTMLFormElement
            if (form) {
              formData.fullName =
                (form.querySelector('[name="fullName"]') as HTMLInputElement)?.value ?? ''
              formData.email =
                (form.querySelector('[name="email"]') as HTMLInputElement)?.value ?? ''
              formData.phone =
                (form.querySelector('[name="phone"]') as HTMLInputElement)?.value ?? ''
              formData.message =
                (form.querySelector('[name="message"]') as HTMLTextAreaElement)?.value ?? ''
            }
          },
          onError: (error) => {
            if (error.code === 'COOLDOWN_ACTIVE') return
            errorMessage = error.message
            setTimeout(() => {
              errorMessage = ''
            }, 5000)
          },
        },
      })

      unsubscribe = voiceInstance.subscribe((state: VoiceFormState) => {
        currentState = state
      })
    } catch (err) {
      errorMessage = `Failed to initialize: ${err instanceof Error ? err.message : 'Unknown error'}`
    }
  })

  onDestroy(() => {
    unsubscribe?.()
    voiceInstance?.destroy()
  })

  function handleMicClick() {
    if (!voiceInstance) return
    if (isRecording) {
      voiceInstance.stop()
    } else {
      voiceInstance.start()
    }
  }

  function handleConfirm() {
    voiceInstance?.confirm()
  }

  function handleCancel() {
    voiceInstance?.cancel()
  }

  function handleManualSubmit(e: Event) {
    e.preventDefault()
    if (formData.fullName && formData.email) {
      alert(
        `Form submitted!\n\nName: ${formData.fullName}\nEmail: ${formData.email}\nPhone: ${formData.phone}\nMessage: ${formData.message}`,
      )
    }
  }

  function micLabel(): string {
    if (isRecording) return 'Stop listening'
    if (isProcessing) return 'Processing...'
    if (isConfirming) return 'Review below'
    return 'Speak to fill form'
  }
</script>

<main>
  <div class="container">
    <div class="header">
      <h1>voice-form Demo</h1>
      <p>Speak naturally. Fill forms intelligently.</p>
    </div>

    {#if errorMessage}
      <div class="error" role="alert">{errorMessage}</div>
    {/if}

    <form id="demo-form" onsubmit={handleManualSubmit}>
      <div class="form-group">
        <label for="fullName">Full Name *</label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          placeholder="John Smith"
          bind:value={formData.fullName}
          required
        />
      </div>

      <div class="form-group">
        <label for="email">Email Address *</label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="john@example.com"
          bind:value={formData.email}
          required
        />
      </div>

      <div class="form-group">
        <label for="phone">Phone Number</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          placeholder="555-1234"
          bind:value={formData.phone}
        />
      </div>

      <div class="form-group">
        <label for="message">Message</label>
        <textarea
          id="message"
          name="message"
          placeholder="Tell us what you think..."
          bind:value={formData.message}
          rows="4"
        ></textarea>
      </div>

      <div class="controls">
        <button
          type="button"
          class="mic-button"
          class:recording={isRecording}
          class:processing={isProcessing}
          class:confirming={isConfirming}
          onclick={handleMicClick}
          disabled={isProcessing || isConfirming}
          aria-label={micLabel()}
        >
          {#if isRecording}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          {:else if isProcessing}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" stroke-dasharray="31" stroke-dashoffset="10">
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 12 12"
                  to="360 12 12"
                  dur="1s"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          {:else}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"
              />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          {/if}
          <span class="mic-label">{micLabel()}</span>
        </button>

        <button type="submit" class="submit-button">Submit Form</button>
      </div>
    </form>

    {#if isConfirming}
      <div class="confirmation-panel" role="dialog" aria-label="Confirm voice input">
        <h3>Review parsed values</h3>
        <dl class="field-list">
          {#each Object.entries(confirmationFields) as [name, field]}
            <div class="field-row">
              <dt>{field.label || name}</dt>
              <dd>{typeof field.value === 'string' ? field.value : String(field.value)}</dd>
            </div>
          {/each}
        </dl>
        <div class="confirmation-actions">
          <button class="confirm-btn" onclick={handleConfirm}>Fill form</button>
          <button class="cancel-btn" onclick={handleCancel}>Cancel</button>
        </div>
      </div>
    {/if}

    <div class="info">
      <h2>How it works</h2>
      <ol>
        <li>Click the mic button above</li>
        <li>
          Speak naturally: "My name is John Smith, my email is john at example dot com, my number is
          555-1234, I love your product"
        </li>
        <li>Review the parsed values</li>
        <li>Click "Fill form" to inject the values</li>
        <li>Submit the form</li>
      </ol>

      <h3>Try saying:</h3>
      <code>"John Smith, john at example dot com, 555-1234, I love your product"</code>

      <h3>About this demo</h3>
      <p>
        This demo uses Groq's Llama 3.1 8B model to parse your speech into form fields. The
        endpoint runs as a Netlify Function — no server to manage, $0/month. See the
        <a href="https://github.com/cschuman/voice-form">source on GitHub</a>.
      </p>
    </div>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu',
      'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
  }

  main {
    min-height: 100vh;
  }

  .container {
    max-width: 600px;
    margin: 0 auto;
    background: white;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    padding: 40px;
  }

  .header {
    text-align: center;
    margin-bottom: 40px;
  }

  h1 {
    margin: 0 0 10px 0;
    color: #333;
    font-size: 28px;
  }

  .header p {
    margin: 0;
    color: #666;
    font-size: 16px;
  }

  .error {
    background: #fee;
    color: #c33;
    padding: 12px 16px;
    border-radius: 6px;
    margin-bottom: 20px;
    font-size: 14px;
  }

  form {
    margin: 30px 0;
  }

  .form-group {
    margin-bottom: 20px;
  }

  label {
    display: block;
    margin-bottom: 6px;
    color: #333;
    font-weight: 500;
    font-size: 14px;
  }

  input,
  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-family: inherit;
    font-size: 14px;
    box-sizing: border-box;
    transition: border-color 0.2s;
  }

  input:focus,
  textarea:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  .controls {
    display: flex;
    gap: 12px;
    margin: 30px 0;
    align-items: center;
    justify-content: center;
  }

  .mic-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 50px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 14px;
    font-family: inherit;
  }

  .mic-button:hover:not(:disabled) {
    background: #5568d3;
    transform: scale(1.02);
  }

  .mic-button:active:not(:disabled) {
    transform: scale(0.98);
  }

  .mic-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .mic-button.recording {
    background: #e53e3e;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .mic-button.processing {
    background: #d69e2e;
  }

  .mic-button.confirming {
    background: #38a169;
  }

  @keyframes pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(229, 62, 62, 0.4);
    }
    50% {
      box-shadow: 0 0 0 12px rgba(229, 62, 62, 0);
    }
  }

  .mic-label {
    white-space: nowrap;
  }

  .submit-button {
    padding: 10px 24px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    font-size: 14px;
    font-family: inherit;
  }

  .submit-button:hover {
    background: #5568d3;
  }

  .confirmation-panel {
    background: #f7fafc;
    border: 2px solid #667eea;
    border-radius: 8px;
    padding: 20px;
    margin: 20px 0;
  }

  .confirmation-panel h3 {
    margin: 0 0 15px 0;
    color: #333;
    font-size: 16px;
  }

  .field-list {
    margin: 0;
  }

  .field-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #e2e8f0;
  }

  .field-row:last-child {
    border-bottom: none;
  }

  dt {
    color: #666;
    font-size: 14px;
    font-weight: 500;
  }

  dd {
    margin: 0;
    color: #333;
    font-size: 14px;
  }

  .confirmation-actions {
    display: flex;
    gap: 10px;
    margin-top: 15px;
    justify-content: flex-end;
  }

  .confirm-btn {
    padding: 8px 20px;
    background: #38a169;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    font-size: 14px;
    font-family: inherit;
  }

  .confirm-btn:hover {
    background: #2f855a;
  }

  .cancel-btn {
    padding: 8px 20px;
    background: #e2e8f0;
    color: #333;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    font-size: 14px;
    font-family: inherit;
  }

  .cancel-btn:hover {
    background: #cbd5e0;
  }

  .info {
    margin-top: 40px;
    padding-top: 30px;
    border-top: 1px solid #eee;
  }

  h2 {
    margin: 0 0 15px 0;
    color: #333;
    font-size: 18px;
  }

  h3 {
    margin: 20px 0 10px 0;
    color: #666;
    font-size: 14px;
    font-weight: 600;
  }

  ol {
    margin: 0;
    padding-left: 20px;
    color: #666;
    font-size: 14px;
    line-height: 1.6;
  }

  code {
    background: #f5f5f5;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Monaco', 'Courier New', monospace;
    font-size: 13px;
    color: #d63384;
  }

  .info p {
    color: #666;
    font-size: 14px;
    line-height: 1.6;
    margin: 10px 0;
  }

  .info a {
    color: #667eea;
    text-decoration: none;
  }

  .info a:hover {
    text-decoration: underline;
  }

  @media (prefers-reduced-motion: reduce) {
    .mic-button.recording {
      animation: none;
    }
  }

  @media (max-width: 600px) {
    .container {
      padding: 24px;
    }

    h1 {
      font-size: 24px;
    }

    .controls {
      flex-direction: column;
    }

    input,
    textarea {
      font-size: 16px;
    }
  }
</style>
