const DEFAULT_MAIN_CRM_EVENT_URL = "https://crm-roan-rho.vercel.app/api/application-received-email-event";
const APPLICATION_EVENT_TYPES = new Set([
  "accepted",
  "delivered",
  "opened",
  "clicked",
  "deferred",
  "soft_bounce",
  "hard_bounce",
  "invalid_email",
  "blocked",
]);

function safeText(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function categories(payload = {}) {
  const raw = payload.category ?? payload.categories ?? [];
  return (Array.isArray(raw) ? raw : [raw]).map((value) => safeText(value, 100).toLowerCase()).filter(Boolean);
}

export function isApplicationReceivedSendGridPayload(payload = {}) {
  const leadId = safeText(payload.crm_lead_id, 80);
  if (!leadId) return false;
  const template = safeText(payload.transactional_template, 160).toLowerCase();
  const tagged = categories(payload).includes("application-received");
  return tagged || template.includes("application received");
}

export function buildApplicationReceivedCrmEvent(payload = {}, event = {}) {
  if (!isApplicationReceivedSendGridPayload(payload)) return null;
  const eventType = safeText(event.event_type, 80).toLowerCase();
  if (!APPLICATION_EVENT_TYPES.has(eventType)) return null;
  return {
    lead_id: safeText(payload.crm_lead_id, 80),
    application_type: safeText(payload.application_type, 40).toLowerCase(),
    application_ref: safeText(payload.application_ref, 160),
    acknowledgement_send_id: safeText(payload.acknowledgement_send_id, 200),
    provider: "sendgrid",
    provider_event_id: safeText(event.provider_event_id, 500),
    provider_message_id: safeText(event.provider_message_id, 500),
    event_type: eventType,
    event_at: safeText(event.event_at, 80),
    reason: safeText(event.reason, 1000),
  };
}

export async function forwardApplicationReceivedCrmEvent({
  payload = {},
  event = {},
  endpoint = DEFAULT_MAIN_CRM_EVENT_URL,
  apiKey = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const body = buildApplicationReceivedCrmEvent(payload, event);
  if (!body) return { forwarded: false, skipped: true, reason: "not_application_received" };
  const url = safeText(endpoint, 2000);
  const key = safeText(apiKey, 1000);
  if (!url || !key || typeof fetchImpl !== "function") {
    return { forwarded: false, skipped: true, reason: "missing_configuration" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-marketing-customer-database-key": key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { forwarded: false, skipped: false, reason: `crm_http_${response.status}` };
    }
    return { forwarded: true, skipped: false };
  } catch (error) {
    return { forwarded: false, skipped: false, reason: error?.name === "AbortError" ? "crm_timeout" : "crm_request_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export { DEFAULT_MAIN_CRM_EVENT_URL };
