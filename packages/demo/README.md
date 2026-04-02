# voice-form Demo Site

A working demonstration of voice-form in action. Speak naturally and watch a form fill itself.

## What This Is

This is a Svelte 5 SPA that showcases the voice-form library with:

- A simple contact form (name, email, phone, message)
- A working mic button (uses your browser's Web Speech API)
- A mock LLM endpoint that parses speech into form fields
- Confirmation panel that shows what was heard before injection
- Clean, responsive design
- Mobile-friendly

## How It Works

1. **Click the mic button** to start recording
2. **Speak naturally** — e.g., "My name is John Smith, my email is john at example dot com, my phone is 555-1234"
3. **Review the confirmation panel** — see what was heard and what was extracted
4. **Click "Fill form"** to inject values into the form fields
5. **Submit the form** manually or let voice-form submit it for you

## Running the Demo

```bash
cd packages/demo
pnpm install
pnpm dev
```

Then open `http://localhost:5173` in your browser.

**Tip:** Use Chrome, Edge, or Safari for best Web Speech API support.

## Mock Server

The demo includes a **mock parsing server** that doesn't require an LLM. It uses simple heuristics to extract:

- **Names** — "my name is John Smith"
- **Emails** — "john at example dot com"
- **Phone numbers** — "555-1234" or "555-123-4567"
- **Messages** — everything else up to 500 characters

To use a **real LLM** (OpenAI, Anthropic, etc.), replace the mock server with a real backend:

1. Update `endpoint` in `src/App.svelte` to point to your real backend
2. Implement the backend using one of the reference endpoints in `examples/`
3. Deploy your backend

See `examples/sveltekit/+server.ts` for a working SvelteKit implementation.

## Design Notes

- **Pure Svelte 5** — No dependencies beyond voice-form itself
- **No real LLM** — The demo uses heuristic parsing, not AI. Perfect for testing the UX without API calls
- **Responsive** — Works on desktop, tablet, and mobile
- **Accessible** — Proper ARIA labels and semantic HTML
- **Privacy-first** — No data is stored. The mock endpoint is client-side only

## Building for Production

```bash
pnpm build
```

Output is in `dist/`. Deploy anywhere (Netlify, Vercel, GitHub Pages, etc.).

To add a real backend:

1. Uncomment/modify the endpoint URL in `src/App.svelte`
2. Replace the mock server with calls to your real backend
3. Deploy your backend alongside the frontend

## Browser Support

- Chrome/Edge 25+
- Safari 14.1+
- Firefox 25+ (behind a flag)
- Other Chromium browsers

Unsupported browsers will show "Voice input not available" message.

## Next Steps

1. **Read the docs** — Check out the main README for architecture and concepts
2. **Try the API** — Experiment with different schemas and field types
3. **Build your backend** — Implement a real BYOE endpoint (see `examples/`)
4. **Deploy** — Use your favorite host (Vercel, Netlify, etc.)

## Questions?

Open an issue in the main repo or check the docs.

**Remember:** This demo is educational. For production, implement proper authentication, rate limiting, and error handling on your backend endpoint.
