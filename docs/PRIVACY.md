# Privacy Policy and Data Flows

Complete documentation of how voice-form handles voice data, transcripts, and personal information. Read this before deploying voice-form in production, especially for applications subject to GDPR, CCPA, HIPAA, or other privacy regulations.

## Summary

**voice-form itself stores no data.** The library is stateless. However, voice data flows through multiple systems depending on your configuration:

1. **Audio** → Your user's microphone → (optional) Google/STT provider → Lost after transcription
2. **Transcript** → voice-form → Your BYOE endpoint → Your LLM provider (OpenAI, Anthropic, etc.)
3. **Parsed values** → Your endpoint → LLM → back to voice-form → DOM injection

**Your application is responsible for:**

- Obtaining user consent before recording
- Disclosing which STT provider processes audio (Google, OpenAI, etc.)
- Securing your BYOE endpoint (authentication, HTTPS, rate limiting)
- Protecting API keys for your LLM provider
- Complying with data retention and deletion requirements

**This is not legal advice.** Consult your privacy/legal team for your specific jurisdiction and use case.

---

## Table of Contents

1. [What voice-form Stores](#what-voice-form-stores)
2. [Audio Data Flow](#audio-data-flow)
3. [Transcript Data Flow](#transcript-data-flow)
4. [Field Value Flow](#field-value-flow)
5. [Privacy Controls in voice-form](#privacy-controls-in-voice-form)
6. [GDPR Compliance](#gdpr-compliance)
7. [CCPA Compliance](#ccpa-compliance)
8. [HIPAA Compliance](#hipaa-compliance)
9. [Data Retention and Deletion](#data-retention-and-deletion)
10. [Custom STT Adapters](#custom-stt-adapters)
11. [Developer Responsibilities](#developer-responsibilities)
12. [FAQ](#faq)

---

## What voice-form Stores

**Nothing.**

- No audio is stored by voice-form
- No transcripts are cached by voice-form
- No field values are stored by voice-form (except momentarily in memory during the confirmation step)
- No logs of user inputs are retained by voice-form
- No cookies or local storage are used by voice-form

The library is a stateless bridge between the user's microphone and your endpoint. It handles the transcript in memory, passes it to your server, and discards it once injection is complete.

**Your application and LLM providers may store data.** See [Developer Responsibilities](#developer-responsibilities).

---

## Audio Data Flow

### With Default Web Speech API

```
User's Microphone
       ↓
Browser (Web Speech API)
       ↓
Google Speech-to-Text API
       ↓
Transcript returned to voice-form
       ↓
Audio discarded by Google
```

**What leaves the device:**

- Raw audio from the user's microphone
- Sent directly to Google's servers by the Web Speech API

**What comes back:**

- Plain-text transcript
- Returned to the browser; not stored

**Google's privacy commitment:**

- Google states that Web Speech API audio is not retained for longer than necessary to process the request
- See [Google's Web Speech API Privacy Policy](https://www.google.com/intl/en/policies/privacy/)

### With a Custom STT Adapter (Whisper, AssemblyAI, etc.)

If you provide a custom `sttAdapter`, the audio handling depends on that adapter's implementation:

```ts
const customAdapter = {
  async start(events) {
    // Your adapter decides what happens to the audio
    // Example: POST to OpenAI Whisper
    const transcript = await fetch('/api/transcribe', {
      method: 'POST',
      body: audioBlob,
    })
  },
  // ...
}

createVoiceForm({
  sttAdapter: customAdapter,
  // ...
})
```

**Responsibility:** You must disclose which STT provider the custom adapter uses and ensure its privacy compliance matches your application's requirements.

---

## Transcript Data Flow

### Step 1: STT Produces Transcript

```
Google Speech-to-Text (or your custom adapter)
       ↓
Transcript (plain text string)
       ↓
voice-form receives final transcript
```

At this point:

- The transcript exists in the browser's memory
- It has not been sent to your backend yet
- It is available to the `onInterimTranscript` callback (if you subscribed)

**Security note:** The transcript at this stage is raw STT output. If you render it in the DOM via the interim callback, use textContent only, never the innerHTML property.

```ts
events: {
  onInterimTranscript: (transcript) => {
    // SAFE: uses textContent
    document.getElementById('status').textContent = `You said: ${transcript}`

    // UNSAFE: Do not do this
    // Avoid setting innerHTML with untrusted content
  },
}
```

### Step 2: voice-form Sends Transcript to Your Endpoint

```
voice-form (browser)
       ↓ HTTPS POST
Your BYOE Endpoint (/api/voice-parse)
       ↓
Your endpoint receives {transcript, schema, requestId}
```

**What is sent:**

- `transcript` — The final transcript as a JSON string
- `schema` — The form schema (including field names, labels, descriptions, and options)
- `requestId` — A unique UUID for logging and idempotency

**What is visible:**

- The request is visible in the Network tab of DevTools
- The request body includes the transcript and schema
- Both are readable by users (and any JavaScript on the page)

**Your responsibility:**

- Secure the endpoint with HTTPS
- Validate the `X-VoiceForm-Request` header (CSRF protection)
- Implement authentication if the endpoint is public
- Implement rate limiting to prevent abuse
- Handle the transcript securely (don't log it to plain-text files, don't send it to analytics, etc.)

### Step 3: Your Endpoint Calls the LLM

```
Your BYOE Endpoint
       ↓ HTTPS POST
LLM Provider (OpenAI, Anthropic, etc.)
       ↓
Returns parsed field values
```

**What is sent to the LLM:**

- The system prompt (built by `buildSystemPrompt` or written by you)
- The transcript embedded in the user prompt (escaped via JSON.stringify)

**The LLM provider's retention policy:**

- **OpenAI (GPT, Whisper):** By default, API requests are retained for 30 days for abuse detection, then deleted. [See OpenAI's privacy docs.](https://platform.openai.com/docs/guides/production-best-practices/managing-api-usage)
- **Anthropic (Claude):** API requests are not retained by default. [See Anthropic's privacy docs.](https://www.anthropic.com/legal/privacy)
- **Google (PaLM):** Requests are not retained for model training. [See Google's API privacy docs.](https://cloud.google.com/vertex-ai/docs/generative-ai/privacy-and-security)

**Your responsibility:**

- Choose an LLM provider whose data retention policy complies with your regulations
- If you're subject to HIPAA or other regulations, verify the provider's BAA (Business Associate Agreement)
- Never send sensitive fields (SSNs, medical records, financial data) without encryption or data minimization

---

## Field Value Flow

### Step 1: LLM Returns Parsed Values

```
LLM Provider
       ↓
Returns JSON: {fields: {fullName: {value: "John Smith"}, ...}}
       ↓
Your BYOE Endpoint
       ↓
Returns ParseResponse to voice-form
```

The LLM has extracted field values from the transcript and returned them as a `ParseResponse`.

### Step 2: Confirmation Step

```
voice-form (browser)
       ↓
Shows confirmation UI with:
  - Original transcript
  - Parsed field values
  - Any missing or invalid fields
       ↓
User confirms or cancels
```

At this point:

- The original transcript is visible to the user
- Parsed values are visible to the user (and any JavaScript on the page)
- The user can see what was heard and what was understood
- The user can approve or reject before injection

**Sanitization:** All parsed values are sanitized before display. XSS is not possible via LLM output.

### Step 3: DOM Injection

```
User clicks "Confirm"
       ↓
voice-form injects sanitized values into form fields
       ↓
Form data now in DOM (visible to all JavaScript on the page)
       ↓
User submits form (or you submit programmatically)
       ↓
Form data sent to your form endpoint
```

Once injected, the form data is no different from manually typed data. It's subject to your form's normal security and retention policies.

---

## Privacy Controls in voice-form

### Privacy Notice

Use the `privacyNotice` config option to disclose how voice data is processed.

```ts
createVoiceForm({
  privacyNotice: `Voice input uses your browser's speech recognition, which is processed by Google. 
Your audio is not stored by this application. For details, see our Privacy Policy.`,
  requirePrivacyAcknowledgement: false, // Optional: require explicit opt-in
})
```

The notice is displayed before the first microphone permission request.

**When to use:**

- Always, if you're subject to GDPR, CCPA, or other privacy regulations
- If you're using the default Web Speech API (which sends audio to Google)
- If you're using a custom STT adapter that sends data outside your infrastructure

**When to omit:**

- Only if you can prove no audio/transcript leaves your infrastructure (e.g., completely offline local STT with no network calls)

### Require Privacy Acknowledgement

```ts
createVoiceForm({
  privacyNotice: '...',
  requirePrivacyAcknowledgement: true, // User must click "I understand"
})
```

When enabled, the user must explicitly acknowledge the privacy notice before the microphone permission request is triggered. This creates a clear audit trail of consent.

**Recommended for:**

- GDPR applications (especially with minors)
- CCPA applications in California
- HIPAA-regulated applications
- Any app handling sensitive data

**When to require:**

- If you're uncertain about whether you need it, require it. The UX friction is minimal (one click).

---

## GDPR Compliance

**Applicable if:** Your application is accessed by users in the EU, or you're a company serving the EU.

### Legal Basis

Voice input involves processing **personal data** (the content of the user's speech). You must establish a legal basis:

- **Consent** — Most common. User opts in to voice input before recording.
- **Contract** — If voice input is necessary for a service the user has contracted for (e.g., voice-activated CRM internal to a company)
- **Legitimate Interest** — Less common for voice input. Requires impact assessment.

### User Rights (Articles 15–22)

GDPR grants users the right to:

- **Access** — Retrieve data you've collected about them
- **Correction** — Request corrections to inaccurate data
- **Deletion** — Request deletion (Right to be Forgotten)
- **Portability** — Download their data in a structured format
- **Restriction** — Limit how you use their data
- **Objection** — Opt out of processing
- **Not be subject to automated decision-making** — If a decision is made based solely on the LLM's output without human review

### Practical Steps

1. **Obtain explicit consent** before recording:

   ```ts
   createVoiceForm({
     requirePrivacyAcknowledgement: true,
     privacyNotice: `Your voice will be processed by Google Speech-to-Text and OpenAI's GPT models. 
This data is used only to fill your form and is not retained by us. 
See our Privacy Policy for details.`,
   })
   ```

2. **Disclose the data flow:**

   > Your voice is processed by the following services:
   > - Google Speech-to-Text API (audio-to-text conversion)
   > - OpenAI GPT API (natural language understanding)
   >
   > These services retain data according to their own privacy policies. We do not retain your voice data.

3. **Implement data subject rights:**

   - If a user requests deletion, ensure you delete any voice data you've stored (logs, backups, etc.)
   - voice-form doesn't store anything, but your endpoint might

4. **Privacy Impact Assessment (DPIA):**

   - Required if processing poses a risk
   - Document how you process voice data and what safeguards you have
   - Share with your Data Protection Officer if you have one

5. **No profiling without consent:**

   - Don't use voice tone or speech patterns to infer preferences or characteristics beyond what the user explicitly stated
   - The LLM may do this; you're responsible for not acting on it

### Third-Party Data Processing Agreements

If you use Google Speech-to-Text or OpenAI's API, ensure you have Data Processing Agreements (DPAs) or similar:

- **Google:** Google Cloud includes a Data Processing Amendment (DPA) by default for EU users
- **OpenAI:** Requires a Data Processing Agreement for EU users. You must opt in.

---

## CCPA Compliance

**Applicable if:** Your application is accessed by users in California, or you meet CCPA's definition of a business.

### Consumer Rights

CCPA grants California residents the right to:

- **Know** — Disclose what data you collect and how you use it
- **Delete** — Delete their data (with some exceptions)
- **Opt-out** — Opt out of data sales (voice-form doesn't sell data, but you might)
- **Non-discrimination** — Don't discriminate for exercising their rights

### Practical Steps

1. **Update your Privacy Policy** to include:

   > We collect voice data when you use voice input. Your voice is processed by third-party speech recognition and AI services (Google, OpenAI). For details, see their privacy policies. We do not retain your voice data after processing.

2. **Provide a "Do Not Sell My Personal Information" link:**

   - If you're not selling voice data, make this clear
   - If you're using analytics that might trigger CCPA's "sale" definition, disclose it

3. **Honor opt-out requests:**

   - Even though voice-form sends data to third parties, you should honor requests to not process voice
   - Implement: "No, I don't want to use voice input for this form"

4. **Implement deletion on request:**

   - Ensure your BYOE endpoint and backend logs are purged when a user requests deletion

---

## HIPAA Compliance

**Applicable if:** Your application handles Protected Health Information (PHI) for a healthcare provider, health plan, or healthcare clearinghouse.

### HIPAA and voice-form

HIPAA prohibits sending PHI to systems that are not HIPAA-compliant. **By default, voice-form is not HIPAA-compliant** because:

1. Google Speech-to-Text does not have a Business Associate Agreement (BAA) with healthcare entities
2. Many LLM providers (OpenAI, etc.) do not offer HIPAA-compliant API tiers
3. voice-form itself provides no encryption or audit logging

### If You Need HIPAA Compliance

**Option 1: Do not use voice input for PHI fields.**

- Don't use voice-form to capture diagnoses, medications, patient names, SSNs, etc.
- Use it only for non-sensitive data (appointment preferences, feedback, etc.)

**Option 2: Use a HIPAA-compliant custom STT adapter + HIPAA-compliant LLM.**

```ts
// Custom adapter using a HIPAA-compliant STT service (e.g., Transcription service with BAA)
const hipaaAdapter = {
  async start(events) {
    // Implement custom STT that has a BAA
    const transcript = await fetch('https://your-hipaa-compliant-stt.com/transcribe', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hcToken}` },
      body: audioBlob,
    }).then(r => r.json())
    events.onFinal(transcript)
    events.onEnd()
  },
  // ...
}

createVoiceForm({
  sttAdapter: hipaaAdapter,
  endpoint: '/api/hipaa-parse', // Your own secure endpoint
  schema: { ... },
})
```

Your BYOE endpoint must:

- Run on infrastructure inside your HIPAA-compliant system (not cloud)
- Call an LLM with a HIPAA BAA (e.g., Azure OpenAI with HIPAA coverage)
- Log and audit all access
- Encrypt data in transit and at rest

**Recommendation:** Consult your HIPAA compliance officer before using voice input with PHI.

---

## Data Retention and Deletion

### voice-form Data (No Retention)

voice-form retains nothing. No data cleanup needed.

### Your Endpoint Data

You're responsible for implementing retention and deletion policies:

```ts
// Example: Node.js / Express BYOE endpoint
export async function parseVoice(req, res) {
  const { transcript, schema, requestId } = req.body

  // Your responsibility:
  // 1. Do NOT log the transcript to plain files or unencrypted databases
  // 2. If you log for debugging, set a retention policy (e.g., 7 days)
  // 3. Do NOT send the transcript to analytics without consent

  // OK: Log the request ID and outcome, not the transcript
  logger.info(`Voice parse request: ${requestId} completed`)

  // NOT OK: Logging the transcript
  // logger.info(`Transcript: ${transcript}`) ← BAD

  // Call LLM
  const response = await openai.chat.completions.create({...})

  // Return result
  res.json({ fields: ... })
}
```

### LLM Provider Retention

Each LLM provider has its own retention policy:

- **OpenAI:** Default 30 days; can opt out of retention for EU data
- **Anthropic:** No retention by default
- **Google Vertex AI:** Can configure retention window
- **Azure OpenAI:** Follows your Azure subscription's data residency rules

**Your responsibility:** Choose providers whose retention aligns with your requirements and implement opt-outs if available.

### User Deletion Requests

Implement a deletion flow for GDPR/CCPA:

```ts
// Endpoint for users to request their data be deleted
export async function deleteUserData(req, res) {
  const { userId } = req.user

  // 1. Delete any logs/backups containing their voice data
  await db.voiceLogs.deleteMany({ userId })

  // 2. Notify LLM provider if they offer deletion APIs
  // (Most don't; retention is automatic)

  // 3. Confirm deletion
  res.json({ success: true })
}
```

---

## Custom STT Adapters

If you implement a custom STT adapter (instead of using the default Web Speech API), you're responsible for its privacy compliance.

### Example: Whisper via Your Own Backend

```ts
const whisperAdapter: STTAdapter = {
  isSupported() { return true },
  
  async start(events) {
    // 1. Capture audio locally
    const mediaRecorder = new MediaRecorder(stream)
    const chunks: BlobPart[] = []
    
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
    mediaRecorder.onstop = async () => {
      // 2. Send to YOUR backend (not to OpenAI directly)
      const formData = new FormData()
      formData.append('file', new Blob(chunks, { type: 'audio/webm' }))
      
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      })
      
      const { text } = await res.json()
      events.onFinal(text)
      events.onEnd()
    }
    
    mediaRecorder.start()
  },
  
  stop() { /* ... */ },
  abort() { /* ... */ },
}

createVoiceForm({ sttAdapter: whisperAdapter })
```

**Privacy implications:**

- Audio is sent to YOUR backend (good for privacy)
- Your backend calls Whisper API (audio goes to OpenAI)
- OpenAI's retention policy applies
- You can delete locally stored audio if you choose

**Your responsibility:**

- Log and audit who accessed the audio
- Delete local audio files according to policy
- Have a DPA with OpenAI if required

---

## Developer Responsibilities

### Before Deploying voice-form

1. **Identify data sensitivity:**
   - What kind of data will users speak? (Names, addresses, financial data, health info?)
   - Is it personal data under GDPR, CCPA, or other regulations?

2. **Choose an STT provider:**
   - Web Speech API (default) — Audio goes to Google
   - Custom adapter — Depends on your implementation
   - Evaluate: privacy policy, data retention, compliance certifications

3. **Choose an LLM provider:**
   - OpenAI (GPT) — 30-day retention by default in US; EU DPA required
   - Anthropic (Claude) — No retention
   - Google Vertex AI — Configurable retention
   - Evaluate: compliance certifications, BAAs, data residency

4. **Secure your BYOE endpoint:**
   - Require HTTPS (never HTTP)
   - Implement authentication if public
   - Validate the `X-VoiceForm-Request` header
   - Implement rate limiting
   - Log accesses and errors
   - Never log the transcript itself

5. **Disclose to users:**
   - Add a privacy notice via `privacyNotice` config
   - Explain which services process voice
   - Link to privacy policies
   - For GDPR/CCPA: Require explicit acknowledgement (`requirePrivacyAcknowledgement: true`)

6. **Data minimization:**
   - Only voice-fill fields that need it
   - Don't voice-fill sensitive fields (SSN, passwords) if avoidable
   - For HIPAA: Don't use voice for PHI without a HIPAA-compliant setup

7. **Retention and deletion:**
   - Document how long you retain voice logs
   - Implement user deletion flows
   - Clean up logs and backups per policy

8. **Legal review:**
   - Have your privacy team review before launch
   - If GDPR/CCPA/HIPAA applies: Consult legal
   - Ensure your LLM provider has required agreements in place

---

## FAQ

### Q: Does voice-form encrypt the audio?

**A:** No. Audio is sent unencrypted by the Web Speech API to Google's servers (or your custom adapter's endpoint). HTTPS protects the transcript on the wire, but not the audio stream itself. This is inherent to the Web Speech API. If encryption is required, implement a custom STT adapter with encrypted transmission.

### Q: Can I use voice-form without sending data to Google?

**A:** Yes. Implement a custom `sttAdapter` that runs entirely on your backend:

```ts
const localWhisperAdapter = { ... } // Custom adapter using your Whisper instance
createVoiceForm({ sttAdapter: localWhisperAdapter })
```

Then audio goes to your infrastructure, not Google.

### Q: What about voice analytics and profiling?

**A:** voice-form doesn't do any profiling. The LLM receives the transcript as-is. However, if your backend logs voice data or if the LLM provider does profiling on their side, that's outside voice-form's scope. You're responsible for the policies of services you use.

### Q: Can I use voice-form for children's data (COPPA)?

**A:** Requires caution. COPPA (US) and similar laws (UK, EU) impose strict requirements on collecting data from children under 13. You must:

1. Obtain verifiable parental consent before collecting voice data
2. Use a privacy-preserving STT provider
3. Minimize data retention
4. Be very clear about third-party vendors

**Recommendation:** Consult legal before using voice input in child-oriented applications.

### Q: What if my LLM provider changes their retention policy?

**A:** Monitor your LLM provider's terms of service. If they change retention in a way that violates your compliance requirements:

1. Switch to a different LLM provider
2. Implement a custom adapter that pipes to a new provider
3. Update your privacy notice

This is a business risk, not a technical risk with voice-form.

### Q: Can users opt out of voice input?

**A:** Yes. voice-form gracefully disables itself if:

- Browser doesn't support Web Speech API
- User denies microphone permission
- You disable the mic button UI

Always provide a fallback to manual form filling.

### Q: Does voice-form work offline?

**A:** No. The default Web Speech API requires network access to Google. Custom adapters may support offline STT if you run it locally, but voice-form itself is online-only.

### Q: How do I know what LLM sees my data?

**A:** Voice-form sends the transcript + schema to YOUR endpoint. You choose which LLM to call. The data flows are:

```
Browser → Your endpoint (you control) → OpenAI/Anthropic/Google (your choice)
```

You have full transparency. Audit your endpoint's logs to see what's being sent.

### Q: Is there a data processing agreement (DPA) for voice-form?

**A:** No. voice-form is open-source software. There's no company to sign a DPA with. However, the LLM providers you use (OpenAI, Anthropic, etc.) have DPAs available. You sign DPAs with them.

---

## Related Documents

- [SECURITY.md](./SECURITY.md) — Threat model and security guidance
- [API.md](./API.md) — `privacyNotice` and `requirePrivacyAcknowledgement` config
- [@voiceform/server-utils](../packages/server-utils/) — Prompt builders to see what the LLM receives

For questions about privacy compliance, consult your privacy/legal team.
