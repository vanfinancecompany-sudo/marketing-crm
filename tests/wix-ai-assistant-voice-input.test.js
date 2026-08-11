import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  decodeAudioPayload,
  handleVoiceTranscriptionRequest,
  isSameOriginVoiceRequest,
  normaliseAudioMime,
  transcribeAudio,
  transcriptionModel,
} from "../api/ai-assistant-transcribe.js";

function responseCapture() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

const environment = {
  OPENAI_API_KEY: "test-key",
  AI_ASSISTANT_SESSION_SECRET: "test-secret",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

const sameOriginHeaders = {
  origin: "https://marketing-crm.example",
  host: "marketing-crm.example",
  "x-forwarded-host": "marketing-crm.example",
  "x-forwarded-proto": "https",
  "x-forwarded-for": "203.0.113.10",
};

test("voice endpoint accepts only the hosted widget same-origin request", () => {
  assert.equal(isSameOriginVoiceRequest({ headers: sameOriginHeaders }), true);
  assert.equal(isSameOriginVoiceRequest({ headers: { ...sameOriginHeaders, origin: "https://attacker.example" } }), false);
});

test("browser audio MIME values are normalised and bounded", () => {
  assert.equal(normaliseAudioMime("audio/webm;codecs=opus"), "audio/webm");
  const audio = decodeAudioPayload({
    mime_type: "audio/webm;codecs=opus",
    audio_base64: Buffer.from("small recording").toString("base64"),
  });
  assert.equal(audio.mimeType, "audio/webm");
  assert.equal(audio.extension, "webm");
  assert.equal(audio.bytes.toString(), "small recording");
  assert.throws(() => decodeAudioPayload({ mime_type: "text/plain", audio_base64: "dGVzdA==" }), /not supported/);
});

test("voice input defaults to the low-cost mini transcription model", () => {
  assert.equal(transcriptionModel({}), "gpt-4o-mini-transcribe");
  assert.equal(transcriptionModel({ OPENAI_TRANSCRIBE_MODEL: "gpt-4o-transcribe" }), "gpt-4o-transcribe");
});

test("OpenAI transcription sends audio only to the transcription endpoint", async () => {
  let request = null;
  const text = await transcribeAudio(
    { bytes: Buffer.from("audio"), mimeType: "audio/webm", extension: "webm" },
    environment,
    async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, async json() { return { text: "I am self-employed, can I get van finance?" }; } };
    },
  );
  assert.equal(text, "I am self-employed, can I get van finance?");
  assert.equal(request.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.equal(request.options.body.get("model"), "gpt-4o-mini-transcribe");
  assert.equal(request.options.body.get("language"), "en");
  assert.ok(request.options.body.get("file") instanceof Blob);
});

test("voice endpoint keeps a daily abuse cap without a short-term retry bucket", async () => {
  const calls = [];
  const supabase = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data: true, error: null };
    },
  };
  const request = {
    method: "POST",
    headers: sameOriginHeaders,
    body: {
      mime_type: "audio/webm",
      audio_base64: Buffer.from("audio").toString("base64"),
    },
  };
  const response = responseCapture();
  await handleVoiceTranscriptionRequest(request, response, {
    environment,
    supabase,
    fetchImplementation: async () => ({ ok: true, status: 200, async json() { return { text: "What deposit do I need?" }; } }),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { text: "What deposit do I need?" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.p_scope, "voice_day");
  assert.equal(calls[0].payload.p_limit, 200);
});

test("website widget adds microphone recording without auto-sending the transcript", async () => {
  const [widget, loader, embed, liveFeedback] = await Promise.all([
    readFile(new URL("../public/wix-ai-assistant/widget.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/wix-ai-assistant/site-loader.js", import.meta.url), "utf8"),
    readFile(new URL("../public/wix-ai-assistant/embed.html", import.meta.url), "utf8"),
    readFile(new URL("../public/wix-ai-assistant/voice-live-feedback.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(loader, /clipboard-write; microphone/);
  assert.match(widget, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(widget, /new MediaRecorder/);
  assert.match(widget, /VOICE_MAX_SECONDS = 45/);
  assert.match(widget, /\/api\/ai-assistant-transcribe/);
  assert.match(widget, /Turning your voice into text/);
  assert.match(widget, /Tap the microphone to speak, then check the text before sending/);
  assert.match(widget, /input\.value = transcript/);
  assert.doesNotMatch(widget, /input\.value = transcript;\s*this\.sendMessage\(/);
  assert.match(embed, /voice-live-feedback\.mjs/);
  assert.match(liveFeedback, /SpeechRecognition/);
  assert.match(liveFeedback, /webkitSpeechRecognition/);
  assert.match(liveFeedback, /interimResults = true/);
  assert.match(liveFeedback, /input\.value = String\(text/);
  assert.match(liveFeedback, /I can hear you/);
});
