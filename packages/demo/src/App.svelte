<script lang="ts">
  import { onMount } from 'svelte'
  import { createVoiceForm } from '@voiceform/core'
  import type { VoiceFormInstance, ConfirmationData, InjectionResult } from '@voiceform/core'

  let voiceInstance: VoiceFormInstance | null = null
  let micButtonContainer: HTMLElement
  let isLoading = false
  let errorMessage = ''
  let formData = {
    fullName: '',
    email: '',
    phone: '',
    message: '',
  }

  // Mock endpoint that simulates LLM parsing
  async function mockVoiceParse(req: {
    transcript: string
    schema: unknown
    requestId: string
  }) {
    // Simulate network latency
    await new Promise((r) => setTimeout(r, 800))

    // Very simple parsing: extract likely values from transcript
    const transcript = req.transcript.toLowerCase()

    const response = {
      fields: {
        fullName: extractName(transcript) ? { value: extractName(transcript) } : undefined,
        email: extractEmail(transcript) ? { value: extractEmail(transcript) } : undefined,
        phone: extractPhone(transcript) ? { value: extractPhone(transcript) } : undefined,
        message: extractMessage(transcript) ? { value: extractMessage(transcript) } : undefined,
      },
    }

    // Remove undefined fields
    Object.keys(response.fields).forEach(
      (key) => response.fields[key] === undefined && delete response.fields[key],
    )

    return response
  }

  function extractName(text: string): string {
    // Simple heuristic: look for capitalized words at the start
    const match = text.match(/^.*?(?:my name is|i'm|i am)\s+([a-z]+(?:\s+[a-z]+)?)/i)
    return match ? match[1] : ''
  }

  function extractEmail(text: string): string {
    // Look for email-like patterns: "john at example dot com"
    const match = text.match(
      /([a-z0-9]+)\s+at\s+([a-z0-9]+)\s+dot\s+([a-z]+)(?:\s+dot\s+([a-z]+))?/i,
    )
    if (match) {
      return `${match[1]}@${match[2]}.${match[3]}${match[4] ? '.' + match[4] : ''}`
    }

    // Also try standard email pattern
    const emailMatch = text.match(/[\w\.-]+@[\w\.-]+\.\w+/i)
    return emailMatch ? emailMatch[0] : ''
  }

  function extractPhone(text: string): string {
    // Look for phone number patterns
    const match = text.match(/(?:\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\d{10})/);
    return match ? match[0] : ''
  }

  function extractMessage(text: string): string {
    // Everything else is the message
    return text.slice(0, 500) // Limit to 500 chars
  }

  onMount(async () => {
    try {
      isLoading = true

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
              description: 'Your full name',
            },
            {
              name: 'email',
              label: 'Email Address',
              type: 'email',
              required: true,
              description: 'Your email address',
            },
            {
              name: 'phone',
              label: 'Phone Number',
              type: 'tel',
              description: 'Your phone number (optional)',
            },
            {
              name: 'message',
              label: 'Message',
              type: 'textarea',
              description: 'Your message to us',
              validation: {
                minLength: 10,
                maxLength: 500,
              },
            },
          ],
        },
        mountTarget: micButtonContainer,
        privacyNotice:
          'Voice input uses your browser\'s speech recognition, which is processed by Google. This demo does not store any data.',
        requirePrivacyAcknowledgement: true,
        events: {
          onDone: (result: InjectionResult) => {
            if (result.success) {
              // Form was filled successfully
              submitForm()
            }
          },
          onError: (error) => {
            if (!error.recoverable) {
              errorMessage = `Error: ${error.message}. Please refresh and try again.`
            }
          },
          onBeforeConfirm: (data: ConfirmationData) => {
            // You can augment the confirmation data here if needed
            return data
          },
        },
      })

      isLoading = false
    } catch (err) {
      errorMessage = `Failed to initialize voice input: ${err instanceof Error ? err.message : 'Unknown error'}`
      isLoading = false
    }
  })

  function submitForm() {
    // In a real app, this would POST to your backend
    const message = `Form submitted!\n\nName: ${formData.fullName}\nEmail: ${formData.email}\nPhone: ${formData.phone}\nMessage: ${formData.message}`
    alert(message)
  }

  function handleManualSubmit(e: Event) {
    e.preventDefault()
    if (formData.fullName && formData.email) {
      submitForm()
    }
  }
</script>

<main>
  <div class="container">
    <div class="header">
      <h1>voice-form Demo</h1>
      <p>Speak naturally. Fill forms intelligently.</p>
    </div>

    {#if isLoading}
      <p class="loading">Initializing voice input...</p>
    {/if}

    {#if errorMessage}
      <div class="error">{errorMessage}</div>
    {/if}

    <form on:submit={handleManualSubmit}>
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
        <div bind:this={micButtonContainer} class="mic-button-container"></div>
        <button type="submit" class="submit-button">Submit Form</button>
      </div>
    </form>

    <div class="info">
      <h2>How it works</h2>
      <ol>
        <li>Click the mic button below to start</li>
        <li>Speak naturally: "My name is John Smith, my email is john at example dot com"</li>
        <li>Review what was heard in the confirmation panel</li>
        <li>Click "Fill form" to inject the values</li>
        <li>Submit the form</li>
      </ol>

      <h3>Try saying:</h3>
      <code>"John Smith, john at example dot com, 555-1234, I love your product"</code>

      <h3>About this demo</h3>
      <p>
        This demo uses a mock parsing function (no real LLM) to show how voice-form works. In
        production, the BYOE endpoint would call your LLM provider (OpenAI, Anthropic, etc.).
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

  .loading {
    text-align: center;
    color: #667eea;
    font-weight: 500;
    margin: 20px 0;
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

  .mic-button-container {
    display: flex;
    justify-content: center;
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
  }

  .submit-button:hover {
    background: #5568d3;
  }

  .submit-button:active {
    transform: scale(0.98);
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
      font-size: 16px; /* Prevent zoom on iOS */
    }
  }
</style>
