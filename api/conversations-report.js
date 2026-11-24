// Receives heartbeats and conversation events pushed by the local Facebook
// Marketplace assistant (the hosted CRM cannot reach the PC). Bearer token:
// CONVERSATIONS_REPORT_TOKEN. Idempotent: repeated events are ignored.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { normaliseReport } from "../lib/conversationsMonitor.js";

function tokenOk(request, environment) {
  const expected = String(environment.CONVERSATIONS_REPORT_TOKEN || "");
  const given = String(request.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 24 || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function handleConversationsReport(request, response, { environment = process.env, supabase } = {}) {
  response.setHeader?.("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "POST only" });
  if (!tokenOk(request, environment)) return response.status(401).json({ error: "Unauthorised" });
  const db = supabase || createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const { status, events } = normaliseReport(body);
  if (status) {
    const { error } = await db.from("conversation_channel_status").upsert({
      channel: "facebook_marketplace", last_heartbeat_at: new Date().toISOString(), status, updated_at: new Date().toISOString(),
    }, { onConflict: "channel" });
    if (error) return response.status(500).json({ error: "Status could not be stored" });
  }
  if (events.length) {
    const { error } = await db.from("conversation_events").upsert(events, { onConflict: "source_id", ignoreDuplicates: true });
    if (error) return response.status(500).json({ error: "Events could not be stored" });
  }
  return response.status(200).json({ ok: true, stored: events.length });
}

export default function handler(request, response) {
  return handleConversationsReport(request, response).catch(() => response.status(500).json({ error: "Report failed" }));
}
