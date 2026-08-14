import { createClient } from "@supabase/supabase-js";
import { validateWixOrigin } from "../lib/publicAssistantFoundation.js";
import {
  PUBLIC_ASSISTANT_EVENT_TYPES,
  assistantTelemetryVisitorHash,
  isMissingAssistantTelemetryTableError,
  recordAssistantTelemetryEvent,
  resolveAssistantCustomerSessionId,
} from "../lib/aiAssistantTelemetry.js";

const PUBLIC_EVENTS = new Set(PUBLIC_ASSISTANT_EVENT_TYPES);
const clean = (value, limit = 500) => String(value || "").trim().slice(0, limit);

function requestOrigin(request) {
  return clean(request.headers?.origin || request.headers?.Origin, 500);
}

function setCors(response, origin) {
  response.setHeader?.("Access-Control-Allow-Origin", origin);
  response.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader?.("Access-Control-Max-Age", "600");
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  response.setHeader?.("Vary", "Origin");
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return {}; }
}

function getSupabase(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Assistant telemetry storage is unavailable.");
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function handleAssistantTelemetryRequest(request, response, dependencies = {}) {
  const environment = dependencies.environment || process.env;
  const origin = requestOrigin(request);
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (!validateWixOrigin(origin, environment)) return response.status(403).json({ ok: false });
  setCors(response, origin);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ ok: false });

  const body = parseBody(request);
  const eventType = clean(body.event_type, 60);
  if (!PUBLIC_EVENTS.has(eventType)) return response.status(400).json({ ok: false });

  try {
    const supabase = dependencies.supabase || getSupabase(environment);
    const customerSessionId = body.conversation_id
      ? await resolveAssistantCustomerSessionId(supabase, body.conversation_id, environment)
      : null;
    await recordAssistantTelemetryEvent(supabase, {
      event_type: eventType,
      visitor_hash: assistantTelemetryVisitorHash(body.visitor_id, environment),
      customer_session_id: customerSessionId,
      page_type: body.page_type,
      product_context: body.product_context,
      cta_action_key: eventType === "cta_click" ? body.cta_action_key : null,
      cta_label: eventType === "cta_click" ? body.cta_label : null,
    });
    return response.status(200).json({ ok: true });
  } catch (error) {
    if (isMissingAssistantTelemetryTableError(error)) return response.status(200).json({ ok: false, skipped: true });
    console.error("PUBLIC AI ASSISTANT TELEMETRY ERROR", {
      event_type: eventType || null,
      exception_type: error?.name || "Error",
      message: clean(error?.message, 500),
    });
    return response.status(500).json({ ok: false });
  }
}

export default async function handler(request, response) {
  return handleAssistantTelemetryRequest(request, response);
}
