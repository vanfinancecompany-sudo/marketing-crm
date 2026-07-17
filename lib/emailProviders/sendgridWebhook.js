import crypto from "node:crypto";
import { resolvedRecipientStatus } from "../marketingRecipientOutcomes.js";

const MAX_REASON_LENGTH = 1000;

function safeText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function sendGridVerificationPublicKey(value) {
  const configured = String(value || "").trim();
  if (!configured) throw new Error("SendGrid webhook verification key is not configured.");
  if (configured.includes("BEGIN PUBLIC KEY")) return crypto.createPublicKey(configured);
  const decoded = Buffer.from(configured.replace(/\s+/g, ""), "base64");
  if (decoded.length === 65 && decoded[0] === 4) {
    return crypto.createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: base64Url(decoded.subarray(1, 33)),
        y: base64Url(decoded.subarray(33, 65)),
      },
    });
  }
  return crypto.createPublicKey({ key: decoded, format: "der", type: "spki" });
}

export function verifySendGridSignature({ rawBody, signature, timestamp, verificationKey }) {
  if (!Buffer.isBuffer(rawBody) || !rawBody.length || !signature || !timestamp || !verificationKey) return false;
  try {
    const publicKey = sendGridVerificationPublicKey(verificationKey);
    const signedPayload = Buffer.concat([Buffer.from(String(timestamp), "utf8"), rawBody]);
    return crypto.verify("sha256", signedPayload, publicKey, Buffer.from(String(signature), "base64"));
  } catch {
    return false;
  }
}

export async function readRawRequestBody(request, limit = 1024 * 1024) {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (typeof request.rawBody === "string") return Buffer.from(request.rawBody, "utf8");
  if (typeof request?.[Symbol.asyncIterator] === "function" && !request.readableEnded) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) throw new Error("SendGrid webhook payload is too large.");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") return Buffer.from(request.body, "utf8");
  throw new Error("Exact raw webhook body is unavailable.");
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

function invalidAddressReason(value) {
  return /invalid (?:address|email|recipient)|unknown user|user unknown|no such user|mailbox not found|mailbox does not exist|bad address|bounced address|address does not exist/i.test(String(value || ""));
}

function hardBounce(payload = {}) {
  const type = safeText(payload.type, 80).toLowerCase();
  const status = safeText(payload.status, 40);
  const detail = `${payload.reason || ""} ${payload.response || ""}`;
  if (type === "blocked" || type === "expired" || /^4(?:\.|\d)/.test(status)) return false;
  return type === "bounce" || /^5(?:\.|\d)/.test(status) || invalidAddressReason(detail) || !type;
}

export function normalizeSendGridEvent(payload = {}) {
  const rawEvent = safeText(payload.event, 80).toLowerCase().replace(/[\s-]+/g, "_");
  const reason = safeText(payload.reason || payload.response || payload.status || "", MAX_REASON_LENGTH);
  let eventType = "unknown";
  if (rawEvent === "processed") eventType = "accepted";
  else if (rawEvent === "delivered") eventType = "delivered";
  else if (rawEvent === "open") eventType = "opened";
  else if (rawEvent === "click") eventType = "clicked";
  else if (rawEvent === "deferred") eventType = "deferred";
  else if (rawEvent === "bounce") eventType = hardBounce(payload) ? "hard_bounce" : "soft_bounce";
  else if (rawEvent === "spamreport") eventType = "complaint";
  else if (["unsubscribe", "group_unsubscribe"].includes(rawEvent)) eventType = "unsubscribed";
  else if (rawEvent === "dropped") {
    if (/unsubscrib/i.test(reason)) eventType = "unsubscribed";
    else if (/spam/i.test(reason)) eventType = "complaint";
    else eventType = invalidAddressReason(reason) ? "invalid_email" : "blocked";
  }

  const providerMessageId = safeText(payload.sg_message_id || payload["smtp-id"] || "", 500);
  const email = normalizeEmail(payload.email);
  const linkUrl = safeText(payload.url, 2000);
  const eventAt = eventDate(payload.timestamp);
  const rawEventId = safeText(payload.sg_event_id, 500);
  const providerEventId = rawEventId
    ? `sendgrid:event:${rawEventId}`
    : `sendgrid:sha256:${hashValue(canonicalJson({ providerMessageId, eventType, timestamp: payload.timestamp ?? "", email, linkUrl, reason }))}`;

  return {
    provider: "sendgrid",
    provider_event_id: providerEventId,
    provider_message_id: providerMessageId || null,
    event_type: eventType,
    event_at: eventAt,
    email_normalized: email || null,
    link_url: linkUrl || null,
    reason: reason || null,
    hints: {
      campaign_id: safeText(payload.marketing_campaign_id, 80),
      send_id: safeText(payload.marketing_send_id, 80),
      recipient_id: safeText(payload.marketing_recipient_id, 80),
      send_type: safeText(payload.marketing_send_type, 20).toLowerCase(),
      email,
      provider_message_id: providerMessageId,
    },
    metadata: {
      source_provider: "sendgrid",
      sendgrid_event: rawEvent,
      sendgrid_event_id: rawEventId,
      sendgrid_bounce_type: safeText(payload.type, 80),
      sendgrid_status: safeText(payload.status, 80),
      has_correlation_hints: Boolean(payload.marketing_recipient_id || payload.marketing_send_id || payload.marketing_campaign_id || providerMessageId),
      correlation_ids: {
        campaign_id: safeText(payload.marketing_campaign_id, 80) || null,
        send_id: safeText(payload.marketing_send_id, 80) || null,
        recipient_id: safeText(payload.marketing_recipient_id, 80) || null,
      },
    },
  };
}

export function verifySendGridRecipientHints(recipient, hints = {}) {
  if (!recipient || recipient.metadata?.email_provider !== "sendgrid") return false;
  if (!hints.recipient_id || !hints.send_id || !hints.campaign_id || !hints.send_type || !hints.email) return false;
  if (hints.recipient_id && hints.recipient_id !== recipient.id) return false;
  if (hints.send_id && hints.send_id !== recipient.send_id) return false;
  if (hints.campaign_id && hints.campaign_id !== recipient.campaign_id) return false;
  if (hints.send_type && hints.send_type !== recipient.send_type) return false;
  if (hints.email && hints.email !== normalizeEmail(recipient.email)) return false;
  return true;
}

export function nextSendGridRecipientStatus(currentStatus, eventType) {
  if (eventType === "unknown" || eventType === "deferred") return currentStatus || "accepted";
  if (["hard_bounced", "complained", "unsubscribed"].includes(currentStatus)) return currentStatus;
  if (eventType === "clicked") return "clicked";
  if (eventType === "opened") return currentStatus === "clicked" ? currentStatus : "opened";
  if (eventType === "delivered") return ["opened", "clicked"].includes(currentStatus) ? currentStatus : "delivered";
  if (eventType === "accepted") return ["sent", "delivered", "opened", "clicked", "soft_bounced", "blocked"].includes(currentStatus) ? currentStatus : "accepted";
  if (eventType === "soft_bounce") return ["delivered", "opened", "clicked"].includes(currentStatus) ? currentStatus : "soft_bounced";
  if (eventType === "blocked") return ["delivered", "opened", "clicked"].includes(currentStatus) ? currentStatus : "blocked";
  if (["hard_bounce", "invalid_email"].includes(eventType)) return "hard_bounced";
  if (eventType === "complaint") return "complained";
  if (eventType === "unsubscribed") return "unsubscribed";
  return currentStatus || "accepted";
}

function newerOrEqual(incoming, stored) {
  return !stored || new Date(incoming).getTime() >= new Date(stored).getTime();
}

export function sendGridRecipientUpdates(recipient, event) {
  const updates = {};
  const setIfNewer = (field) => {
    if (newerOrEqual(event.event_at, recipient[field])) updates[field] = event.event_at;
  };
  if (event.event_type === "delivered") setIfNewer("delivered_at");
  if (event.event_type === "opened") setIfNewer("opened_at");
  if (event.event_type === "clicked") setIfNewer("clicked_at");
  if (event.event_type === "soft_bounce") setIfNewer("soft_bounced_at");
  if (["hard_bounce", "invalid_email"].includes(event.event_type)) setIfNewer("hard_bounced_at");
  if (event.event_type === "complaint") setIfNewer("complained_at");
  if (event.event_type === "unsubscribed") setIfNewer("unsubscribed_at");
  if (event.event_type === "blocked") setIfNewer("blocked_at");
  if (event.event_type === "deferred") setIfNewer("deferred_at");
  if (event.event_type !== "unknown" && newerOrEqual(event.event_at, recipient.last_event_at)) {
    updates.last_event_at = event.event_at;
    updates.last_event_type = event.event_type;
    updates.last_event_reason = event.reason || null;
  }
  const updatedRecipient = { ...recipient, ...updates };
  updates.status = resolvedRecipientStatus(updatedRecipient);
  if (["soft_bounce", "hard_bounce", "invalid_email", "blocked", "complaint", "unsubscribed"].includes(event.event_type)
    && !["delivered", "opened", "clicked"].includes(updates.status)) {
    updates.failure_reason = event.reason || event.event_type.replace(/_/g, " ");
  }
  if (["delivered", "opened", "clicked"].includes(updates.status)
    && ["delivered", "opened", "clicked"].includes(event.event_type)) updates.failure_reason = null;
  return updates;
}

export function sendGridSuppression(event) {
  if (["hard_bounce", "invalid_email"].includes(event.event_type)) {
    return { type: "email_bounced", reason: `SendGrid ${event.event_type.replace(/_/g, " ")} event` };
  }
  if (event.event_type === "unsubscribed") return { type: "email_unsubscribed", reason: "SendGrid unsubscribe event" };
  if (event.event_type === "complaint") return { type: "global_do_not_contact", reason: "SendGrid spam complaint event" };
  return null;
}

export async function processSendGridEvent(repository, event) {
  const recipient = await repository.findRecipient(event);
  const inserted = await repository.insertEvent(event, recipient);
  if (!recipient || event.event_type === "unknown") {
    return { duplicate: inserted.duplicate, correlated: Boolean(recipient), suppressed: false };
  }
  await repository.updateRecipient(recipient.id, sendGridRecipientUpdates(recipient, event));
  const suppression = sendGridSuppression(event);
  if (recipient.send_type !== "production" || !suppression) {
    return { duplicate: inserted.duplicate, correlated: true, suppressed: false };
  }
  await repository.applySuppression(recipient, event, suppression);
  return { duplicate: inserted.duplicate, correlated: true, suppressed: true };
}
