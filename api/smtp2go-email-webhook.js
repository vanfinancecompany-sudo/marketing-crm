import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const MAX_REASON_LENGTH = 1000;
const TERMINAL_STATUSES = new Set(["hard_bounced", "complained", "unsubscribed"]);
const PROGRESSION_RANK = { pending: 0, submission_unknown: 0, failed: 1, accepted: 2, sent: 2, delivered: 3, soft_bounced: 3, blocked: 3, opened: 4, clicked: 5 };

function json(response, status, payload) { response.status(status).json(payload); }

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables.");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body !== "string") return request.body;
  try { return JSON.parse(request.body); } catch {}
  return Object.fromEntries(new URLSearchParams(request.body));
}

function safeText(value, limit = 500) { return String(value || "").trim().slice(0, limit); }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function normalizeCustomerId(value) { return safeText(value, 80).toUpperCase(); }
function hashValue(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex"); }

function timingSafeEqualString(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorizeWebhook(request) {
  const expected = String(process.env.SMTP2GO_WEBHOOK_SECRET || "").trim();
  if (!expected) return false;
  const authorization = String(request.headers.authorization || "").trim();
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return timingSafeEqualString(bearer, expected);
}

function normalizeSMTP2GOEvent(payload = {}) {
  const event = safeText(payload.event || payload.type, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (event === "processed") return "accepted";
  if (event === "delivered") return "delivered";
  if (event === "open") return "opened";
  if (event === "click") return "clicked";
  if (event === "bounce") return safeText(payload.bounce, 20).toLowerCase() === "hard" ? "hard_bounce" : "soft_bounce";
  if (event === "reject") return "blocked";
  if (event === "spam") return "complaint";
  if (event === "unsubscribe") return "unsubscribed";
  return "unknown";
}

function eventDate(value, fallback = new Date()) {
  if (value === null || value === undefined || value === "") return fallback.toISOString();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const date = new Date(numeric > 9999999999 ? numeric : numeric * 1000);
    return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function firstRecipient(payload = {}) {
  if (payload.rcpt) return payload.rcpt;
  if (Array.isArray(payload.recipients)) return payload.recipients[0] || "";
  return String(payload.recipients || "").split(/[;,]/)[0] || "";
}

function normalizedCorrelationKey(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function correlationValue(payload, header, fallback = "") {
  const target = normalizedCorrelationKey(header);
  const sources = [payload, payload?.headers, payload?.custom_headers];
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        if (!item || typeof item !== "object") continue;
        const key = item.header || item.name || item.key;
        if (normalizedCorrelationKey(key) === target) return safeText(item.value, 80);
      }
      continue;
    }
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      if (normalizedCorrelationKey(key) === target) return safeText(value, 80);
    }
  }
  return safeText(fallback, 80);
}

function providerEventId({ rawEventId, providerMessageId, eventType, timestamp, email, linkUrl, reason, bounce }) {
  const stableRawId = safeText(rawEventId, 200).toLowerCase();
  if (stableRawId) return `smtp2go:event:${stableRawId}`;
  return `smtp2go:sha256:${hashValue(canonicalJson({ providerMessageId, eventType, timestamp, email, linkUrl, reason, bounce }))}`;
}

function normalizeEventPayload(payload = {}) {
  const eventType = normalizeSMTP2GOEvent(payload);
  const providerMessageId = safeText(payload.email_id || payload["message-id"] || payload.message_id || "", 500);
  const email = normalizeEmail(firstRecipient(payload));
  const linkUrl = safeText(payload.link || payload.url || payload.link_url || "", 2000);
  const reason = safeText(payload.message || payload.context || payload.reason || "", MAX_REASON_LENGTH);
  const timestamp = payload.time ?? payload.timestamp ?? payload.event_time;
  const eventAt = eventDate(timestamp);
  const campaignId = correlationValue(payload, "X-Marketing-Campaign-Id", payload.campaign_id);
  const sendId = correlationValue(payload, "X-Marketing-Send-Id", payload.send_id);
  const recipientId = correlationValue(payload, "X-Marketing-Recipient-Id", payload.recipient_id);
  return {
    // Migration 012 constrains this legacy column to "brevo". The namespaced ID
    // and metadata below retain the genuine provider identity without a schema change.
    provider: "brevo",
    provider_event_id: providerEventId({ rawEventId: payload.id, providerMessageId, eventType, timestamp, email, linkUrl, reason, bounce: payload.bounce }),
    provider_message_id: providerMessageId || null,
    event_type: eventType,
    event_at: eventAt,
    email_normalized: email || null,
    link_url: linkUrl || null,
    reason: reason || null,
    hints: { campaign_id: campaignId, send_id: sendId, recipient_id: recipientId, email, provider_message_id: providerMessageId },
    metadata: {
      source_provider: "smtp2go",
      smtp2go_event: safeText(payload.event || payload.type, 80),
      smtp2go_webhook_id: safeText(payload.id, 200),
      bounce_classification: safeText(payload.bounce, 20),
      subject_present: Boolean(payload.subject),
      has_correlation_hints: Boolean(campaignId || sendId || recipientId || providerMessageId || email),
      correlation_ids: {
        campaign_id: campaignId || null,
        send_id: sendId || null,
        recipient_id: recipientId || null,
      },
    },
  };
}

function recipientEmail(row = {}) { return normalizeEmail(row.email); }

function verifyRecipientHints(recipient, hints = {}) {
  if (!recipient) return false;
  if (hints.recipient_id && hints.recipient_id !== recipient.id) return false;
  if (hints.send_id && hints.send_id !== recipient.send_id) return false;
  if (hints.campaign_id && hints.campaign_id !== recipient.campaign_id) return false;
  if (hints.email && hints.email !== recipientEmail(recipient)) return false;
  if (hints.provider_message_id && recipient.provider_message_id && hints.provider_message_id !== recipient.provider_message_id) return false;
  return true;
}

async function queryUniqueRecipient(query) {
  const result = await query.limit(2);
  if (result.error) throw new Error(result.error.message || "Could not load recipient.");
  return (result.data || []).length === 1 ? result.data[0] : null;
}

async function loadRecipient(supabase, event) {
  const hints = event.hints || {};
  const internalHints = { ...hints, provider_message_id: "" };
  let recipient = null;
  if (hints.recipient_id) {
    const result = await supabase.from("marketing_email_send_recipients").select("*").eq("id", hints.recipient_id).maybeSingle();
    if (result.error) throw new Error(result.error.message || "Could not load recipient.");
    recipient = result.data || null;
    if (verifyRecipientHints(recipient, internalHints)) return recipient;
  }
  if (hints.email && hints.send_id) {
    recipient = await queryUniqueRecipient(supabase.from("marketing_email_send_recipients").select("*").eq("send_id", hints.send_id).eq("email", hints.email));
    if (verifyRecipientHints(recipient, internalHints)) return recipient;
  }
  if (hints.email && hints.campaign_id) {
    recipient = await queryUniqueRecipient(supabase.from("marketing_email_send_recipients").select("*").eq("campaign_id", hints.campaign_id).eq("email", hints.email).order("created_at", { ascending: false }));
    if (verifyRecipientHints(recipient, internalHints)) return recipient;
  }
  if (hints.provider_message_id) {
    recipient = await queryUniqueRecipient(supabase.from("marketing_email_send_recipients").select("*").eq("provider_message_id", hints.provider_message_id));
    if (verifyRecipientHints(recipient, hints)) return recipient;
  }
  return null;
}

function nextRecipientStatus(currentStatus, eventType) {
  if (eventType === "unknown") return currentStatus || "accepted";
  if (TERMINAL_STATUSES.has(currentStatus)) return currentStatus;
  if (eventType === "clicked") return "clicked";
  if (eventType === "opened") return PROGRESSION_RANK[currentStatus] > PROGRESSION_RANK.opened ? currentStatus : "opened";
  if (eventType === "delivered") return PROGRESSION_RANK[currentStatus] > PROGRESSION_RANK.delivered ? currentStatus : "delivered";
  if (eventType === "accepted") return PROGRESSION_RANK[currentStatus] > PROGRESSION_RANK.accepted ? currentStatus : "accepted";
  if (eventType === "soft_bounce") return PROGRESSION_RANK[currentStatus] > PROGRESSION_RANK.soft_bounced ? currentStatus : "soft_bounced";
  if (eventType === "blocked") return PROGRESSION_RANK[currentStatus] > PROGRESSION_RANK.blocked ? currentStatus : "blocked";
  if (eventType === "hard_bounce") return "hard_bounced";
  if (eventType === "complaint") return "complained";
  if (eventType === "unsubscribed") return "unsubscribed";
  return currentStatus || "accepted";
}

function newerOrEqual(incoming, stored) { return !stored || new Date(incoming).getTime() >= new Date(stored).getTime(); }

function timestampUpdates(recipient, eventType, eventAt, reason) {
  const updates = {};
  const setIfNewer = (field) => { if (newerOrEqual(eventAt, recipient[field])) updates[field] = eventAt; };
  if (eventType === "delivered") setIfNewer("delivered_at");
  if (eventType === "opened") setIfNewer("opened_at");
  if (eventType === "clicked") setIfNewer("clicked_at");
  if (eventType === "soft_bounce") setIfNewer("soft_bounced_at");
  if (eventType === "hard_bounce") setIfNewer("hard_bounced_at");
  if (eventType === "complaint") setIfNewer("complained_at");
  if (eventType === "unsubscribed") setIfNewer("unsubscribed_at");
  if (eventType === "blocked") setIfNewer("blocked_at");
  if (eventType !== "unknown" && newerOrEqual(eventAt, recipient.last_event_at)) {
    updates.last_event_at = eventAt;
    updates.last_event_type = eventType;
    updates.last_event_reason = reason || null;
  }
  return updates;
}

async function applyContactSuppression(supabase, recipient, event) {
  const customerId = normalizeCustomerId(recipient?.customer_id);
  const permanentBlocked = event.event_type === "blocked" && /invalid|unknown user|no such user|does not exist|blacklist|blocked recipient|suppression|globally blocked/i.test(String(event.reason || ""));
  if (!customerId || (!["hard_bounce", "complaint", "unsubscribed"].includes(event.event_type) && !permanentBlocked)) return;
  const type = event.event_type === "hard_bounce" ? "email_bounced" : event.event_type === "unsubscribed" ? "email_unsubscribed" : "global_do_not_contact";
  const contact = await supabase.from("marketing_contacts").select("id").eq("customer_id", customerId).maybeSingle();
  if (contact.error) throw new Error(contact.error.message || "Could not load contact for suppression.");
  if (!contact.data?.id) return;
  const rpc = await supabase.rpc("marketing_apply_suppression", {
    p_contact_id: contact.data.id,
    p_type: type,
    p_reason: permanentBlocked ? "SMTP2GO permanent blocked event" : `SMTP2GO ${event.event_type.replace(/_/g, " ")} event`,
    p_added_by: "SMTP2GO webhook",
    p_notes: safeText(`campaign:${recipient.campaign_id || ""} send:${recipient.send_id || ""} recipient:${recipient.id || ""} message:${event.provider_message_id || ""} email:${recipient.email || event.email_normalized || ""}`, 500),
  });
  if (rpc.error) throw new Error(rpc.error.message || "Could not apply suppression from SMTP2GO event.");
}

async function recordEvent(supabase, event) {
  const recipient = await loadRecipient(supabase, event);
  const insert = await supabase.from("marketing_email_events").insert({
    provider: event.provider,
    provider_event_id: event.provider_event_id,
    provider_message_id: event.provider_message_id,
    event_type: event.event_type,
    event_at: event.event_at,
    email_normalized: event.email_normalized,
    link_url: event.link_url,
    reason: event.reason,
    metadata: { ...(event.metadata || {}), correlated: Boolean(recipient), uncorrelated_reason: recipient ? "" : "No verified recipient match for supplied hints." },
    campaign_id: recipient?.campaign_id || null,
    send_id: recipient?.send_id || null,
    recipient_id: recipient?.id || null,
    customer_id: normalizeCustomerId(recipient?.customer_id) || null,
  }).select("id").maybeSingle();
  if (insert.error) {
    const message = String(insert.error.message || "").toLowerCase();
    if (message.includes("duplicate") || message.includes("unique")) return { duplicate: true, correlated: Boolean(recipient) };
    throw new Error(insert.error.message || "Could not record SMTP2GO event.");
  }
  if (recipient?.id && event.event_type !== "unknown") {
    const updates = timestampUpdates(recipient, event.event_type, event.event_at, event.reason);
    updates.status = nextRecipientStatus(recipient.status, event.event_type);
    if (["soft_bounce", "hard_bounce", "blocked", "complaint", "unsubscribed"].includes(event.event_type)) updates.failure_reason = event.reason || event.event_type.replace(/_/g, " ");
    const update = await supabase.from("marketing_email_send_recipients").update(updates).eq("id", recipient.id);
    if (update.error) throw new Error(update.error.message || "Could not update recipient event status.");
    await applyContactSuppression(supabase, recipient, event);
  }
  return { duplicate: false, correlated: Boolean(recipient) };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return json(response, 405, { ok: false, message: "Method not allowed." });
  if (!authorizeWebhook(request)) return json(response, 401, { ok: false, message: "SMTP2GO webhook access denied." });
  try {
    const body = parseBody(request);
    const payloads = Array.isArray(body) ? body : [body];
    const supabase = getSupabase();
    const summary = { received: payloads.length, recorded: 0, duplicates: 0, correlated: 0, uncorrelated: 0, unknown: 0 };
    for (const payload of payloads) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) { summary.unknown += 1; continue; }
      const event = normalizeEventPayload(payload);
      const result = await recordEvent(supabase, event);
      if (result.duplicate) summary.duplicates += 1; else summary.recorded += 1;
      if (result.correlated) summary.correlated += 1; else summary.uncorrelated += 1;
      if (event.event_type === "unknown") summary.unknown += 1;
    }
    return json(response, 200, { ok: true, ...summary });
  } catch {
    return json(response, 500, { ok: false, message: "SMTP2GO webhook processing failed." });
  }
}
