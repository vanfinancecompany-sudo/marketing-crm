import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const MAX_REASON_LENGTH = 1000;
const TERMINAL_STATUSES = new Set(["hard_bounced", "blocked", "complained", "unsubscribed", "failed"]);
const PROGRESSION_RANK = {
  pending: 0,
  accepted: 1,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  soft_bounced: 2,
  submission_unknown: 1,
};

function json(response, status, payload) {
  response.status(status).json(payload);
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables.");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function safeText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCustomerId(value) {
  return safeText(value, 80).toUpperCase();
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function timingSafeEqualString(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorizeWebhook(request) {
  const expected = String(process.env.BREVO_WEBHOOK_SECRET || "").trim();
  if (!expected) return false;
  const querySecret = String(request.query?.token || "").trim();
  const headerSecret = String(request.headers["x-brevo-webhook-secret"] || request.headers["x-webhook-secret"] || "").trim();
  return timingSafeEqualString(querySecret, expected) || timingSafeEqualString(headerSecret, expected);
}

function normalizeBrevoEvent(value) {
  const event = safeText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (["request", "sent", "accepted"].includes(event)) return "accepted";
  if (event === "delivered") return "delivered";
  if (["opened", "open", "unique_opened", "proxy_open", "unique_proxy_open"].includes(event)) return "opened";
  if (["click", "clicked", "unique_clicked"].includes(event)) return "clicked";
  if (["soft_bounce", "soft_bounced"].includes(event)) return "soft_bounce";
  if (["hard_bounce", "hard_bounced"].includes(event)) return "hard_bounce";
  if (event === "deferred") return "deferred";
  if (["complaint", "spam", "spam_report"].includes(event)) return "complaint";
  if (["unsubscribed", "unsubscribe"].includes(event)) return "unsubscribed";
  if (event === "blocked") return "blocked";
  if (["invalid", "invalid_email"].includes(event)) return "invalid_email";
  if (["error", "failed", "failure"].includes(event)) return "error";
  return "unknown";
}

function eventDate(value, fallback = new Date()) {
  if (value === null || value === undefined || value === "") return fallback.toISOString();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const millis = numeric > 9999999999 ? numeric : numeric * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map((item) => safeText(item, 200)).filter(Boolean);
  if (!value) return [];
  return String(value).split(/[;,]/).map((item) => safeText(item, 200)).filter(Boolean);
}

function extractUuidFromText(text, label) {
  const pattern = new RegExp(`${label}[^0-9a-fA-F-]*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`, "i");
  return safeText(String(text || "").match(pattern)?.[1] || "", 80);
}

function extractCorrelation(payload = {}) {
  const tags = arrayValue(payload.tags || payload.tag);
  const custom = safeText(payload["X-Mailin-custom"] || payload.X_Mailin_custom || payload.custom || "", 2000);
  return {
    campaignId: safeText(payload["X-Marketing-Campaign-Id"] || payload.campaign_id || payload.campaignId || extractUuidFromText(custom, "campaign") || tags.find((tag) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tag)) || "", 80),
    sendId: safeText(payload["X-Marketing-Send-Id"] || payload.send_id || payload.sendId || extractUuidFromText(custom, "send") || "", 80),
    recipientId: safeText(payload["X-Marketing-Recipient-Id"] || payload.recipient_id || payload.recipientId || extractUuidFromText(custom, "recipient") || "", 80),
    tags,
    custom,
  };
}

function normalizeEventPayload(payload = {}) {
  const now = new Date();
  const eventType = normalizeBrevoEvent(payload.event || payload.type || payload.event_type);
  const providerMessageId = safeText(payload["message-id"] || payload.messageId || payload.message_id || payload.message_id_header || "", 500);
  const email = normalizeEmail(payload.email);
  const linkUrl = safeText(payload.link || payload.url || payload.link_url || "", 2000);
  const reason = safeText(payload.reason || payload.message || payload.error || "", MAX_REASON_LENGTH);
  const eventAt = eventDate(payload.ts_event ?? payload.ts_epoch ?? payload.ts ?? payload.date, now);
  const rawEventId = safeText(payload.event_id || payload.eventId || payload.uuid || payload.id || "", 200);
  const fingerprint = hashValue(JSON.stringify({ providerMessageId, eventType, eventAt, email, linkUrl, reason, rawEventId }));
  const correlation = extractCorrelation(payload);
  return {
    provider: "brevo",
    provider_event_id: rawEventId ? `${rawEventId}:${fingerprint.slice(0, 24)}` : `sha256:${fingerprint}`,
    provider_message_id: providerMessageId || null,
    event_type: eventType,
    event_at: eventAt,
    email_normalized: email || null,
    link_url: linkUrl || null,
    reason: reason || null,
    campaign_id: correlation.campaignId || null,
    send_id: correlation.sendId || null,
    recipient_id: correlation.recipientId || null,
    metadata: {
      brevo_event: safeText(payload.event || payload.type || "", 80),
      subject: safeText(payload.subject, 300),
      tags: correlation.tags,
      has_custom_header: Boolean(correlation.custom),
      sending_ip_present: Boolean(payload.sending_ip),
      device_used: safeText(payload.device_used, 100),
      user_agent_present: Boolean(payload.user_agent),
    },
  };
}

async function loadRecipient(supabase, event) {
  if (event.recipient_id) {
    const result = await supabase.from("marketing_email_send_recipients").select("*").eq("id", event.recipient_id).maybeSingle();
    if (result.error) throw new Error(result.error.message || "Could not load recipient.");
    if (result.data) return result.data;
  }
  let query = supabase.from("marketing_email_send_recipients").select("*");
  if (event.provider_message_id) query = query.eq("provider_message_id", event.provider_message_id);
  else if (event.email_normalized && event.send_id) query = query.eq("send_id", event.send_id).eq("email", event.email_normalized);
  else if (event.email_normalized && event.campaign_id) query = query.eq("campaign_id", event.campaign_id).eq("email", event.email_normalized).order("created_at", { ascending: false }).limit(1);
  else return null;
  const result = await query.limit(2);
  if (result.error) throw new Error(result.error.message || "Could not load recipient.");
  const rows = result.data || [];
  return rows.length === 1 ? rows[0] : null;
}

function nextRecipientStatus(currentStatus, eventType) {
  if (TERMINAL_STATUSES.has(currentStatus)) return currentStatus;
  if (eventType === "clicked") return "clicked";
  if (eventType === "opened") return PROGRESSION_RANK[currentStatus] > PROGRESSION_RANK.opened ? currentStatus : "opened";
  if (eventType === "delivered") return PROGRESSION_RANK[currentStatus] > PROGRESSION_RANK.delivered ? currentStatus : "delivered";
  if (eventType === "accepted") return PROGRESSION_RANK[currentStatus] > PROGRESSION_RANK.accepted ? currentStatus : "accepted";
  if (eventType === "soft_bounce") return PROGRESSION_RANK[currentStatus] > PROGRESSION_RANK.soft_bounced ? currentStatus : "soft_bounced";
  if (eventType === "hard_bounce" || eventType === "invalid_email") return "hard_bounced";
  if (eventType === "blocked") return "blocked";
  if (eventType === "complaint") return "complained";
  if (eventType === "unsubscribed") return "unsubscribed";
  if (eventType === "error") return "failed";
  return currentStatus || "accepted";
}

function timestampUpdates(eventType, eventAt, reason) {
  const updates = { last_event_at: eventAt, last_event_type: eventType, last_event_reason: reason || null };
  if (eventType === "delivered") updates.delivered_at = eventAt;
  if (eventType === "opened") updates.opened_at = eventAt;
  if (eventType === "clicked") updates.clicked_at = eventAt;
  if (eventType === "soft_bounce") updates.soft_bounced_at = eventAt;
  if (eventType === "hard_bounce" || eventType === "invalid_email") updates.hard_bounced_at = eventAt;
  if (eventType === "complaint") updates.complained_at = eventAt;
  if (eventType === "unsubscribed") updates.unsubscribed_at = eventAt;
  if (eventType === "blocked") updates.blocked_at = eventAt;
  if (eventType === "deferred") updates.deferred_at = eventAt;
  if (eventType === "error") updates.failed_at = eventAt;
  return updates;
}

async function applyContactSuppression(supabase, recipient, event) {
  const customerId = normalizeCustomerId(recipient?.customer_id);
  if (!customerId) return;
  let type = "";
  let reason = "";
  if (event.event_type === "unsubscribed") {
    type = "email_unsubscribed";
    reason = "Brevo unsubscribe event";
  } else if (["hard_bounce", "invalid_email", "blocked"].includes(event.event_type)) {
    type = "email_bounced";
    reason = `Brevo ${event.event_type.replace(/_/g, " ")} event`;
  } else if (event.event_type === "complaint") {
    type = "global_do_not_contact";
    reason = "Brevo spam complaint event";
  }
  if (!type) return;
  const contact = await supabase.from("marketing_contacts").select("id").eq("customer_id", customerId).maybeSingle();
  if (contact.error) throw new Error(contact.error.message || "Could not load contact for suppression.");
  if (!contact.data?.id) return;
  const rpc = await supabase.rpc("marketing_apply_suppression", {
    p_contact_id: contact.data.id,
    p_type: type,
    p_reason: reason,
    p_added_by: "Brevo webhook",
    p_notes: safeText(`campaign:${event.campaign_id || recipient.campaign_id || ""} send:${event.send_id || recipient.send_id || ""} recipient:${recipient.id || ""} message:${event.provider_message_id || ""}`, 500),
  });
  if (rpc.error) throw new Error(rpc.error.message || "Could not apply suppression from Brevo event.");
}

async function recordEvent(supabase, event) {
  const recipient = await loadRecipient(supabase, event);
  const eventRow = {
    ...event,
    campaign_id: event.campaign_id || recipient?.campaign_id || null,
    send_id: event.send_id || recipient?.send_id || null,
    recipient_id: event.recipient_id || recipient?.id || null,
    customer_id: normalizeCustomerId(recipient?.customer_id) || null,
  };
  const insert = await supabase.from("marketing_email_events").insert(eventRow).select("id").maybeSingle();
  if (insert.error) {
    const message = String(insert.error.message || "").toLowerCase();
    if (message.includes("duplicate") || message.includes("unique")) return { duplicate: true, correlated: Boolean(recipient) };
    throw new Error(insert.error.message || "Could not record Brevo event.");
  }

  if (recipient?.id) {
    const updates = timestampUpdates(event.event_type, event.event_at, event.reason);
    updates.status = nextRecipientStatus(recipient.status, event.event_type);
    if (["soft_bounce", "hard_bounce", "invalid_email", "blocked", "complaint", "unsubscribed", "error"].includes(event.event_type)) {
      updates.failure_reason = event.reason || event.event_type.replace(/_/g, " ");
    }
    const update = await supabase.from("marketing_email_send_recipients").update(updates).eq("id", recipient.id);
    if (update.error) throw new Error(update.error.message || "Could not update recipient event status.");
    await applyContactSuppression(supabase, recipient, event);
  }

  return { duplicate: false, correlated: Boolean(recipient) };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!authorizeWebhook(request)) {
    json(response, 401, { ok: false, message: "Brevo webhook access denied." });
    return;
  }

  try {
    const body = parseBody(request);
    const payloads = Array.isArray(body) ? body : [body];
    const supabase = getSupabase();
    const summary = { received: payloads.length, recorded: 0, duplicates: 0, correlated: 0, unknown: 0 };

    for (const payload of payloads) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        summary.unknown += 1;
        continue;
      }
      const event = normalizeEventPayload(payload);
      const result = await recordEvent(supabase, event);
      if (result.duplicate) summary.duplicates += 1;
      else summary.recorded += 1;
      if (result.correlated) summary.correlated += 1;
      if (event.event_type === "unknown") summary.unknown += 1;
    }

    json(response, 200, { ok: true, ...summary });
  } catch (error) {
    json(response, 500, { ok: false, message: safeText(error?.message || "Brevo webhook processing failed.", 300) });
  }
}