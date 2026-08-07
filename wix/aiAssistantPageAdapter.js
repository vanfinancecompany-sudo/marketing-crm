// Copy this file and aiAssistantCmsVehicleContext.js into the Wix site's Public files.
import { local } from "wix-storage-frontend";
import { fetch } from "wix-fetch";
import {
  VEHICLE_DATASET_ID,
  FINANCE_VEHICLE_COLLECTION_ID,
  RENT2BUY_VEHICLE_COLLECTION_ID,
  buildCmsVehiclePageContext,
} from "./aiAssistantCmsVehicleContext.js";

export {
  VEHICLE_DATASET_ID,
  FINANCE_VEHICLE_COLLECTION_ID,
  RENT2BUY_VEHICLE_COLLECTION_ID,
  buildCmsVehiclePageContext,
};

const CHANNEL = "vfc-ai-assistant-widget-v1";
const STORAGE_KEY_PREFIX = "vfc_ai_assistant_conversation_id";
const PAGE_TYPES = ["finance_vehicle", "finance_general", "rent2buy_general", "homepage"];
const PRODUCTS = ["finance", "rent2buy"];
const SAFE_PRICE_WORDS = new Set([
  "from", "vat", "inc", "incl", "including", "inclusive", "ex", "excl", "excluding", "exclusive",
  "plus", "before", "with", "per", "month", "monthly", "pcm", "pm", "p", "m",
]);

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

function normalisePrice(value) {
  const text = clean(value, 160).replace(/\s+/g, " ");
  if (!text || !/\d/.test(text) || !/^[£0-9A-Za-z\s,./()+\-:&|]+$/.test(text)) return null;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  return words.some((word) => !SAFE_PRICE_WORDS.has(word)) ? null : text;
}

function normaliseTermMonths(value) {
  const text = clean(value, 40).replace(/\s+/g, " ");
  if (!/^\d{1,3}(?:\s*months?)?$/i.test(text)) return null;
  const months = Number.parseInt(text, 10);
  return months >= 1 && months <= 120 ? months : null;
}

function compactObject(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== ""));
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
  if (!["page_form", "generic"].includes(applicationMode)) throw new Error("AI Assistant applicationMode is invalid.");
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
        retailPriceVat: normalisePrice(input.vehicle?.pricing?.retailPriceVat ?? input.vehicle?.pricing?.finance_retail_vat),
        monthlyRental: normalisePrice(input.vehicle?.pricing?.monthlyRental ?? input.vehicle?.pricing?.rent2buy_monthly),
        initialRental: normalisePrice(input.vehicle?.pricing?.initialRental ?? input.vehicle?.pricing?.rent2buy_initial),
      },
      termMonths: normaliseTermMonths(input.vehicle?.termMonths ?? input.vehicle?.term_months),
      applicationMode,
      formAnchor: safeFormAnchor(input.vehicle?.formAnchor),
    },
  };
}

function endpointContext(context) {
  const hasVehicle = context.pageType === "finance_vehicle" || (
    context.pageType === "rent2buy_general"
    && Boolean(context.vehicle.registration || context.vehicle.stockId || context.vehicle.title)
  );
  if (!hasVehicle) return { pageType: context.pageType, vehicle: {} };

  const pricing = context.productContext === "rent2buy"
    ? compactObject({
      rent2buy_monthly: context.vehicle.pricing.monthlyRental,
      rent2buy_initial: context.vehicle.pricing.initialRental,
    })
    : compactObject({
      finance_monthly: context.vehicle.pricing.financeMonthly,
      finance_retail_vat: context.vehicle.pricing.retailPriceVat,
    });

  return {
    pageType: context.pageType,
    vehicle: compactObject({
      registration: context.vehicle.registration,
      vehicle_id: context.vehicle.stockId,
      title: context.vehicle.title,
      pricing,
      term_months: context.productContext === "rent2buy" ? context.vehicle.termMonths : null,
    }),
  };
}

function sessionStorageKey(context) {
  const hasVehicleIdentity = Boolean(context.vehicle?.stockId || context.vehicle?.registration);
  const pageIdentity = hasVehicleIdentity
    ? `${context.pageType}:${clean(context.vehicle.stockId || context.vehicle.registration, 100)}`
    : context.pageType;
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

export function installCmsVehicleAiAssistantWidget({
  collectionId,
  currentItem,
  ...options
}) {
  return installAiAssistantWidget({
    ...options,
    pageContext: buildCmsVehiclePageContext(collectionId, currentItem),
  });
}

export function installDynamicVehicleAiAssistantWidget({
  $w,
  collectionId,
  datasetId = VEHICLE_DATASET_ID,
  ...options
}) {
  const dataset = $w(datasetId);
  return new Promise((resolve, reject) => {
    dataset.onReady(() => {
      try {
        const currentItem = dataset.getCurrentItem();
        if (!currentItem?._id) throw new Error(`AI Assistant could not read the current vehicle from ${datasetId}.`);
        resolve(installCmsVehicleAiAssistantWidget({
          $w,
          collectionId,
          currentItem,
          ...options,
        }));
      } catch (error) {
        reject(error);
      }
    });
  });
}
