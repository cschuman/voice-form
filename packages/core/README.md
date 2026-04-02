# @voiceform/core

Headless voice-to-form library. Zero runtime dependencies.

## Installation

```bash
npm install @voiceform/core
```

## CDN usage

For quick prototyping without a bundler, use the IIFE build via a CDN:

```html
<script
  src="https://unpkg.com/@voiceform/core@0.1.0/dist/voiceform.global.js"
  integrity="sha384-HASH_HERE"
  crossorigin="anonymous"
></script>
<script>
  const form = VoiceForm.createVoiceForm({ /* config */ });
</script>
```

### Subresource Integrity (SRI)

When loading the CDN build in production, always use the `integrity` attribute
to protect against CDN tampering. To generate the SRI hash for any version:

```bash
# Download the file and compute the hash
curl -sL https://unpkg.com/@voiceform/core@VERSION/dist/voiceform.global.js \
  | openssl dgst -sha384 -binary \
  | openssl base64 -A
```

Use the output as `integrity="sha384-<hash>"` on your `<script>` tag. The
publish CI pipeline also outputs the SRI hash in the GitHub Actions summary
for each release.

## API

```typescript
import { createVoiceForm } from '@voiceform/core'

// Headless mode (no UI)
const form = createVoiceForm({ schema, endpointUrl })

// With default UI
import { mountDefaultUI } from '@voiceform/core/ui'
```

See the [monorepo README](https://github.com/cschuman/voice-form#readme) for full documentation.
