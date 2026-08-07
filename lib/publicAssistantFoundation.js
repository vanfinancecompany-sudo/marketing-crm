import { createHash, createHmac, randomBytes } from "node:crypto";
import { detectProduct } from "./aiAssistantCompetence.js";
import { normalisePublicVehiclePricing } from "./publicVehiclePricing.js";

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

export const PUBLIC_ASSISTANT_PAGE_TYPES = Object.freeze([
  "finance_vehicle",
  "finance_general",
  "rent2buy_general",
  "homepage",
]);

export const PUBLIC_ASSISTANT_SAFE_STATUSES = Object.freeze([
  "ready",
  "needs_product",
  "rate_limited",
  "invalid_request",
  "unavailable",
]);

export const DEFAULT_WIX_ORIGINS = Object.freeze([
  "https://www.vanfinancecompany.co.uk",
  "https://vanfinancecompany.co.uk",
]);

const PROMPT_LEAKAGE = /(?:reveal|show|print|repeat|ignore|override|bypass|disregard).{0,60}(?:system prompt|developer message|hidden instructions?|business brain|internal prompt|retrieval context)|(?:system prompt|developer message|hidden instructions?|business brain|internal prompt).{0,60}(?:reveal|show|print|repeat)/i;

export function allowedWixOrigins(environment = process.env) {
  const configured = clean(environment.AI_ASSISTANT_ALLOWED_ORIGINS, 4000)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try { return new URL(value).origin; } catch { return ""; }
    })
    .filter(Boolean);
  return [...new Set(configured.length ? configured : DEFAULT_WIX_ORIGINS)];
}

export function validateWixOrigin(origin, environment = process.env) {
  const candidate = clean(origin, 500);
  if (!candidate) return false;
  try { return allowedWixOrigins(environment).includes(new URL(candidate).origin); } catch { return false; }
}

export function normalisePageContext(input = {}) {
  const pageType = clean(input.page_type ?? input.pageType, 40).toLowerCase();
  if (!PUBLIC_ASSISTANT_PAGE_TYPES.includes(pageType)) throw new Error("A supported Wix page type is required.");
  const registration = clean(input.vehicle?.registration, 20).toUpperCase().replace(/\s+/g, " ");
  if (registration && !/^[A-Z0-9 ]{2,10}$/.test(registration)) throw new Error("Vehicle registration is not valid.");
  const vehicle = pageType === "finance_vehicle" ? {
    registration: registration || null,
    vehicle_id: clean(input.vehicle?.vehicle_id, 100) || null,
    title: clean(input.vehicle?.title, 200) || null,
    pricing: normalisePublicVehiclePricing(input.vehicle?.pricing || {}),
  } : {};
  return { page_type: pageType, vehicle };
}

export function pageProductLock(pageType) {
  if (["finance_vehicle", "finance_general"].includes(pageType)) return "finance";
  if (pageType === "rent2buy_general") return "rent2buy";
  return null;
}

export function determineHomepageProduct(message, history = []) {
  const detected = detectProduct(clean(message, 3000), history);
  return ["finance", "rent2buy"].includes(detected) ? detected : null;
}

export function initialCustomerReply(pageType) {
  if (pageType === "finance_vehicle") return "Hi — ask me anything about this van or applying for finance.";
  if (pageType === "finance_general") return "Hi — how can I help with van finance?";
  if (pageType === "rent2buy_general") return "Hi — how can I help with Rent2Buy?";
  return "Hi — are you looking for Van Finance or Rent2Buy?";
}

export function productChoiceReply() {
  return "Are you looking for Van Finance or Rent2Buy?";
}

export function createPublicConversationId() {
  return randomBytes(32).toString("base64url");
}

export function secureHash(value, secret) {
  const key = clean(secret, 1000);
  if (!key) throw new Error("AI_ASSISTANT_SESSION_SECRET is not configured.");
  return createHmac("sha256", key).update(clean(value, 5000)).digest("hex");
}

export function historyHash(history = []) {
  return createHash("sha256").update(JSON.stringify(history)).digest("hex");
}

export function redactSensitiveCustomerData(value) {
  return clean(value, 3000)
    .replace(/\b[A-Z]{2}\d{6}[A-D]\b/gi, "[redacted]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted]")
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .replace(/(?<!\w)(?:\+44\s?\d{4}|0\d{4})[\s-]?\d{3}[\s-]?\d{3}(?!\w)/g, "[redacted]");
}

export function isPromptLeakageAttempt(value) {
  return PROMPT_LEAKAGE.test(clean(value, 3000));
}

export function promptLeakageReply() {
  return "I can help with Van Finance or Rent2Buy questions, but I can’t provide internal system information.";
}

export function publicApplicationCta(_pageType, _productLock, _assistantResult = {}) {
  // Application progression stays conversational. The customer uses the existing APPLY NOW control on the Wix page,
  // so the chat must never create a second application link/button or navigate away from the page.
  return null;
}

export function safeCustomerPayload({ reply = "", cta = null, conversationId = null, status = "ready" } = {}) {
  const safeStatus = PUBLIC_ASSISTANT_SAFE_STATUSES.includes(status) ? status : "unavailable";
  return {
    reply: clean(reply, 5000),
    cta: cta ? {
      label: clean(cta.label, 100),
      action: clean(cta.action, 100),
      behavior: clean(cta.behavior, 40),
      url: cta.url ? clean(cta.url, 500) : null,
    } : null,
    conversation_id: clean(conversationId, 100) || null,
    status: safeStatus,
  };
}

export function publicJourneyState(result = {}) {
  return {
    buying_intent_level: result.buying_intent_level || "Research",
    conversation_goal: result.conversation_goal || "Research",
    journey_stage: result.journey_stage || "Research",
    lead_completeness: result.lead_completeness || {},
    application_readiness: result.application_readiness || "Exploring",
    application_mode_active: Boolean(result.application_mode_active),
    application_state: result.application_state || "not_started",
    conversation_progressing: Boolean(result.conversation_progressing),
    conversation_stalled: Boolean(result.conversation_stalled),
  };
}

export function publicRememberedFacts(result = {}) {
  const facts = result.remembered_facts && typeof result.remembered_facts === "object" ? result.remembered_facts : {};
  return Object.fromEntries(Object.entries(facts).filter(([key]) => [
    "vehicle_interest", "vehicle_type", "budget_monthly_gbp", "budget", "employment_status",
    "trading_history", "trading_history_months", "credit_concern", "deposit", "deposit_budget_gbp",
    "location", "business_type", "vat_registered", "urgency", "product_context",
  ].includes(key)));
}
