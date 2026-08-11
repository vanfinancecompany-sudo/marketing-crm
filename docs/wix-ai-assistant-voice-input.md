# Wix AI Assistant Voice Input

The site-wide VFC/Rent2Buy assistant supports optional microphone input while keeping all assistant replies as text.

## Customer flow

1. Open the existing website assistant.
2. Tap the microphone button beside Send.
3. Allow browser microphone access when prompted.
4. Speak for up to 45 seconds.
5. Tap the red microphone to stop, or wait for the 45-second cap.
6. The recording is transcribed and placed into the existing text box.
7. The customer can check or edit the transcript before pressing Send.
8. The existing Knowledge Hub / assistant conversation path handles the message exactly like typed text.

The transcript is never auto-sent.

## Architecture

- `public/wix-ai-assistant/widget.mjs` records browser audio with `MediaRecorder`.
- `public/wix-ai-assistant/site-loader.js` grants microphone permission to the hosted assistant iframe.
- `api/ai-assistant-transcribe.js` accepts a bounded same-origin recording and sends it to OpenAI's audio transcription endpoint.
- Default transcription model: `gpt-4o-mini-transcribe`.
- Existing `OPENAI_API_KEY` is reused. Optional `OPENAI_TRANSCRIBE_MODEL` may override the model.
- Audio is not written to Supabase or other persistent storage by this feature.
- Server-side limits: 6 voice requests per minute and 60 per day per visitor IP, using the existing assistant rate-limit RPC.

## Wix changes

For the current preferred site-wide Custom Code installation, no new Wix code block is required. Keep the existing loader snippet:

```html
<script src="https://marketing-crm-github-work.vercel.app/wix-ai-assistant/site-loader.js" defer></script>
```

The loader itself now creates the hosted frame with `allow="clipboard-write; microphone"`.

After production deployment, Wix may cache the script briefly. If the mic does not appear immediately, republish the Wix site and hard-refresh the page.

## Browser behaviour

Microphone access is requested only after the customer taps the microphone. If permission is denied or the browser does not support `MediaRecorder`, the existing typed chat remains available.
