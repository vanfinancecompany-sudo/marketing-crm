// Copy this file into the Wix site's Public files as aiAssistantPageAdapter.js.
import { local } from "wix-storage-frontend";
import { fetch } from "wix-fetch";

const CHANNEL = "vfc-ai-assistant-widget-v1";
const STORAGE_KEY_PREFIX = "vfc_ai_assistant_conversation_id";
const PAGE_TYPES = ["finance_vehicle", "finance_general", "rent2buy_general", "homepage"];
const PRODUCTS = ["finance", "rent2buy"];

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

function normalisePrice(value) {
  const text = clean(value, 80).replace(/\s+/g, " ");
  if (!text) return null;
  return /^(?:from\s+)?£?\s*\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?(?:\s*(?:\+|plus|inc(?:luding)?|incl\.?|excl\.?|excluding)?\s*vat)?(?:\s*(?:per month|pcm|p\/m|monthly))?$/i.test(text) ? text : null;
}

function safeFormAnchor(value) {
  const candidate = clean(value, 80) || "#finance-application";
  return /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(candidate) ? candidate : "#finance-application";
}

function normaliseContext(input = {}) {
  const pageType = clean(input.pageType, 40).toLowerCase();
  if (!PAGE_TYPES.includes(pageType)) throw new Error("AI Assistant requires a supported pageType.");
  const productContext = clean(input.productContext, 20).toLowerCase() || null;
  if (productContext && !PRODUCTS.includes(productContext)) throw new Error("AI Assistant productContext is invalid.");
  if (["finance_vehicle", "finance_general"].includes(pageType) && productContext && productContext !== "finance") throw new Error("Finance page context cannot be overridden.");
  if (pageType === "rent2buy_general" && productContext && productContext !== "rent2buy") throw new Error("Rent2Buy page context cannot be overridden.");
  const applicationMode = clean(input.vehicle?.applicationMode, 20) || (pageType === "finance_vehicle" ? "page_form" : "generic");
  if (pageType === "finance_vehicle" && applicationMode !== "page_form") throw new Error("Finance vehicle pages must use the existing page application.");
  return {
    pageType,
    productContext,
    vehicle: {
      registration: clean(input.vehicle?.registration, 20).toUpperCase() || null,
      stockId: clean(input.vehicle?.stockId, 100) || null,
      title: clean(input.vehicle?.title, 200) || null,
      pricing: {
        financeMonthly: normalisePrice(input.vehicle?.pricing?.financeMonthly ?? input.vehicle?.pricing?.finance_monthly),
        monthlyRental: normalisePrice(input.vehicle?.pricing?.monthlyRental ?? input.vehicle?.pricing?.rent2buy_monthly),
        initialRental: normalisePrice(input.vehicle?.pricing?.initialRental ?? input.vehicle?.pricing?.rent2buy_initial),
      },
      applicationMode,
      formAnchor: safeFormAnchor(input.vehicle?.formAnchor),
    },
  };
}

function endpointContext(context) {
  return {
    pageType: context.pageType,
    vehicle: context.pageType === "finance_vehicle" ? {
      registration: context.vehicle.registration,
      vehicle_id: context.vehicle.stockId,
      title: context.vehicle.title,
      pricing: {
        finance_monthly: context.vehicle.pricing.financeMonthly,
      },
    } : {},
  };
}

function sessionStorageKey(context) {
  const pageIdentity = context.pageType === "finance_vehicle" ? clean(context.vehicle.stockId || context.vehicle.registration, 100) || "vehicle" : context.pageType;
  return `${STORAGE_KEY_PREFIX}:${pageIdentity}`;
}

function safePrivacyUrl(value) {
  if (!clean(value, 500)) return null;
  try {
    const url = new URL(value, "https://www.vanfinancecompany.co.uk");
    return url.origin === "https://www.vanfinancecompany.co.uk" ? url.href : null;
  } catch { return null; }
}

function safeServerCta(_cta, _context) {
  // The Wix page's own APPLY NOW control is the only application action. Chat never creates a second CTA.
  return null;
}

function safeResponse(payload, context) {
  return {
    reply: clean(payload?.reply, 5000),
    cta: safeServerCta(payload?.cta, context),
    conversation_id: clean(payload?.conversation_id, 100) || null,
    status: ["ready", "needs_product", "rate_limited", "invalid_request", "unavailable"].includes(payload?.status) ? payload.status : "unavailable",
  };
}

export function installAiAssistantWidget({
  $w,
  elementId = "#htmlAiAssistant",
  endpoint,
  pageContext,
  privacyUrl = null,
}) {
  const context = normaliseContext(pageContext);
  const apiUrl = new URL(endpoint);
  if (apiUrl.protocol !== "https:" && apiUrl.hostname !== "localhost") throw new Error("AI Assistant endpoint must use HTTPS.");
  const html = $w(elementId);
  const storageKey = sessionStorageKey(context);
  let requestInFlight = false;

  const sendToWidget = (message) => html.postMessage({ channel: CHANNEL, ...message });

  async function callAssistant(message) {
    if (requestInFlight) return;
    requestInFlight = true;
    try {
      const restarting = message.action === "restart";
      if (restarting) local.removeItem(storageKey);
      const conversationId = local.getItem(storageKey);
      const action = message.action === "message" ? "message" : "start";
      const body = action === "start" ? {
        action: "start",
        page_context: endpointContext(context),
      } : {
        action: "message",
        conversation_id: conversationId,
        page_context: endpointContext(context),
        message: clean(message.message, 3000),
        product_choice: context.pageType === "homepage" && PRODUCTS.includes(message.productChoice) ? message.productChoice : null,
      };
      const response = await fetch(apiUrl.href, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      const safe = safeResponse(payload, context);
      if (safe.conversation_id) local.setItem(storageKey, safe.conversation_id);
      if (!response.ok && !safe.reply) throw new Error("Assistant request failed.");
      sendToWidget({ type: "assistant_response", payload: safe });
    } catch (_error) {
      sendToWidget({ type: "assistant_error" });
    } finally {
      requestInFlight = false;
    }
  }

  html.onMessage(async (event) => {
    const message = event.data;
    if (message?.channel !== CHANNEL) return;
    if (message.type === "widget_ready") {
      sendToWidget({
        type: "initialise",
        pageContext: context,
        conversationId: local.getItem(storageKey),
        privacyUrl: safePrivacyUrl(privacyUrl),
      });
      return;
    }
    if (message.type === "assistant_request" && ["start", "message", "restart"].includes(message.action)) {
      await callAssistant(message);
    }
  });

  return {
    restart() { return callAssistant({ action: "restart" }); },
    clearSession() { local.removeItem(storageKey); },
  };
}
