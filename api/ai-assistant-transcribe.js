import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const MAX_AUDIO_BYTES = 2_500_000;
const MAX_TRANSCRIPT_CHARS = 3000;
const MINUTE_LIMIT = 20;
const DAILY_LIMIT = 200;
const DEFAULT_MODEL = "gpt-4o-mini-transcribe";
const ALLOWED_MIME_TYPES = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "mp4"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/m4a", "m4a"],
]);

class VoiceInputError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "VoiceInputError";
    this.statusCode = statusCode;
  }
}

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

function requestIp(request) {
  const forwarded = clean(request?.headers?.["x-forwarded-for"], 500).split(",")[0].trim();
  return forwarded || clean(request?.headers?.["x-real-ip"], 100) || "unknown";
}

function requestOrigin(request) {
  return clean(request?.headers?.origin || request?.headers?.Origin, 1000);
}

function expectedOrigin(request) {
  const host = clean(request?.headers?.["x-forwarded-host"] || request?.headers?.host, 500);
  const proto = clean(request?.headers?.["x-forwarded-proto"], 20) || "https";
  return host ? `${proto}://${host}` : "";
}

export function isSameOriginVoiceRequest(request) {
  const origin = requestOrigin(request);
  const expected = expectedOrigin(request);
  return Boolean(origin && expected && origin === expected);
}

function parseBody(request) {
  if (!request?.body) return {};
  if (typeof request.body === "object") return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    throw new VoiceInputError(400, "The voice recording could not be read. Please try again.");
  }
}

export function normaliseAudioMime(value) {
  return clean(value, 120).toLowerCase().split(";")[0].trim();
}

export function decodeAudioPayload(body = {}) {
  const mimeType = normaliseAudioMime(body.mime_type);
  const extension = ALLOWED_MIME_TYPES.get(mimeType);
  if (!extension) throw new VoiceInputError(415, "This browser audio format is not supported. Please type your question instead.");

  const encoded = clean(body.audio_base64, 4_000_000).replace(/^data:[^;]+;base64,/i, "");
  if (!encoded) throw new VoiceInputError(400, "No voice recording was received. Please try again.");

  let bytes;
  try {
    bytes = Buffer.from(encoded, "base64");
  } catch {
    throw new VoiceInputError(400, "The voice recording could not be decoded. Please try again.");
  }
  if (!bytes.length) throw new VoiceInputError(400, "No voice recording was received. Please try again.");
  if (bytes.length > MAX_AUDIO_BYTES) throw new VoiceInputError(413, "That recording is too long. Please keep voice questions under 45 seconds.");
  return { bytes, mimeType, extension };
}

function getSupabase(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new VoiceInputError(503, "Voice input is temporarily unavailable. Please type your question instead.");
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function secureHash(value, secret) {
  return createHash("sha256").update(`${clean(secret, 1000)}:${value}`).digest("hex");
}

function rateWindow(now, durationMs) {
  return new Date(Math.floor(now.getTime() / durationMs) * durationMs).toISOString();
}

async function consumeRateLimit(supabase, keyHash, scope, windowStart, limit) {
  const result = await supabase.rpc("consume_ai_assistant_rate_limit", {
    p_key_hash: keyHash,
    p_scope: scope,
    p_window_start: windowStart,
    p_limit: limit,
  });
  if (result?.error) throw new VoiceInputError(503, "Voice input is temporarily unavailable. Please type your question instead.");
  if (result?.data !== true) throw new VoiceInputError(429, "You’ve used voice input very frequently. Please wait up to a minute, or type your question.");
}

async function enforceVoiceRateLimits(supabase, request, environment = process.env) {
  const secret = clean(environment.AI_ASSISTANT_SESSION_SECRET, 1000);
  if (!secret) throw new VoiceInputError(503, "Voice input is temporarily unavailable. Please type your question instead.");
  const keyHash = secureHash(`voice:${requestIp(request)}`, secret);
  const now = new Date();
  await consumeRateLimit(supabase, keyHash, "voice_minute", rateWindow(now, 60_000), MINUTE_LIMIT);
  await consumeRateLimit(supabase, keyHash, "voice_day", rateWindow(now, 86_400_000), DAILY_LIMIT);
}

export function transcriptionModel(environment = process.env) {
  return clean(environment.OPENAI_TRANSCRIBE_MODEL, 120) || DEFAULT_MODEL;
}

export async function transcribeAudio(audio, environment = process.env, fetchImplementation = fetch) {
  const apiKey = clean(environment.OPENAI_API_KEY, 10000);
  if (!apiKey) throw new VoiceInputError(503, "Voice input is temporarily unavailable. Please type your question instead.");

  const model = transcriptionModel(environment);
  const form = new FormData();
  form.append("file", new Blob([audio.bytes], { type: audio.mimeType }), `website-question.${audio.extension}`);
  form.append("model", model);
  form.append("language", "en");
  form.append("prompt", "UK van finance and Rent2Buy customer question. Common terms include Van Finance Company, Rent2Buy, registration, VAT, deposit, mileage and self-employed.");

  const response = await fetchImplementation("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    throw new VoiceInputError(502, "The voice recording could not be transcribed. Please try again or type your question.");
  }
  if (!response.ok) {
    console.error("WEBSITE VOICE TRANSCRIPTION ERROR", {
      status: response.status,
      model,
      error_type: clean(payload?.error?.type, 100) || null,
      error_code: clean(payload?.error?.code, 100) || null,
    });
    throw new VoiceInputError(502, "The voice recording could not be transcribed. Please try again or type your question.");
  }

  const text = clean(payload?.text, MAX_TRANSCRIPT_CHARS);
  if (!text) throw new VoiceInputError(422, "I couldn’t hear a clear question. Please try again or type your message.");
  return text;
}

export async function handleVoiceTranscriptionRequest(request, response, dependencies = {}) {
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ error: "That request method is not supported." });
  if (!isSameOriginVoiceRequest(request)) return response.status(403).json({ error: "Voice input is not available from this page." });

  try {
    const environment = dependencies.environment || process.env;
    const body = parseBody(request);
    const audio = decodeAudioPayload(body);
    const supabase = dependencies.supabase || getSupabase(environment);
    await enforceVoiceRateLimits(supabase, request, environment);
    const text = await transcribeAudio(audio, environment, dependencies.fetchImplementation || fetch);
    return response.status(200).json({ text });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    if (status >= 500) console.error("WEBSITE VOICE INPUT ERROR", { name: error?.name, message: clean(error?.message, 300), status });
    return response.status(status).json({ error: clean(error?.message, 300) || "Voice input is temporarily unavailable. Please type your question instead." });
  }
}

export default async function handler(request, response) {
  return handleVoiceTranscriptionRequest(request, response);
}
