import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { simulateCustomerConversation } from "./marketing-ai-assistant-competence.js";
import { isExplicitProductComparison } from "../lib/aiAssistantCompetence.js";
import {
  createPublicConversationId,
  determineHomepageProduct,
  initialCustomerReply,
  isPromptLeakageAttempt,
  normalisePageContext,
  pageProductLock,
  productChoiceReply,
  promptLeakageReply,
  publicApplicationCta,
  redactSensitiveCustomerData,
  safeCustomerPayload,
  secureHash,
  validateWixOrigin,
} from "../lib/publicAssistantFoundation.js";
import { publicApplicationGuidanceReply } from "../lib/publicApplicationGuidance.js";
import { publicVehiclePricingReply } from "../lib/publicVehiclePricing.js";
import {
  buildCanonicalConversationInput,
  canonicalSessionState,
} from "../lib/canonicalPublicAssistantSession.js";
import {
  assistantTelemetryVisitorHash,
  isMissingAssistantTelemetryTableError,
  recordAssistantTelemetryEvent,
  recordAssistantTelemetryEvents,
  telemetryFromAssistantResult,
} from "../lib/aiAssistantTelemetry.js";

const MAX_SESSION_MESSAGES = 100;
const MAX_HISTORY_MESSAGES = 60;
const MINUTE_LIMIT = 15;
const DAILY_LIMIT = 200;
const SESSION_HOURS = 24;
const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

class PublicAssistantError extends Error {
  constructor(statusCode, safeStatus, safeReply) {
    super(safeReply);
    this.name = "PublicAssistantError";
    this.statusCode = statusCode;
    this.safeStatus = safeStatus;
    this.safeReply = safeReply;
  }
}

function getSupabase(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new PublicAssistantError(503, "unavailable", "The assistant is temporarily unavailable. Please try again shortly.");
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { throw new PublicAssistantError(400, "invalid_request", "Please send that request again."); }
}

function requestOrigin(request) {
  return clean(request.headers?.origin || request.headers?.Origin, 500);
}

function requestIp(request) {
  const forwarded = clean(request.headers?.["x-forwarded-for"], 500).split(",")[0].trim();
  return forwarded || clean(request.headers?.["x-real-ip"], 100) || "unknown";
}

function setCors(response, origin) {
  response.setHeader?.("Access-Control-Allow-Origin", origin);
  response.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader?.("Access-Control-Max-Age", "600");
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  response.setHeader?.("Vary", "Origin");
}

function data(result, fallback) {
  if (result?.error) throw new Error(result.error.message || fallback);
  return result?.data;
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
  const allowed = data(result, "Rate limiting is unavailable.");
  if (allowed !== true) throw new PublicAssistantError(429, "rate_limited", "You’ve sent several messages quickly. Please wait a moment and try again.");
}

async function enforceRateLimits(supabase, request, environment = process.env) {
  const secret = clean(environment.AI_ASSISTANT_SESSION_SECRET, 1000);
  const keyHash = secureHash(`ip:${requestIp(request)}`, secret);
  const now = new Date();
  await consumeRateLimit(supabase, keyHash, "minute", rateWindow(now, 60_000), MINUTE_LIMIT);
  await consumeRateLimit(supabase, keyHash, "day", rateWindow(now, 86_400_000), DAILY_LIMIT);
}

function sessionExpiry() {
  return new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
}

async function createSession(supabase, pageContext, environment = process.env) {
  const conversationId = createPublicConversationId();
  const productLock = pageProductLock(pageContext.page_type);
  const greeting = initialCustomerReply(pageContext.page_type);
  const rememberedFacts = {
    ...(productLock ? { product_context: productLock } : {}),
    ...(pageContext.vehicle?.title || pageContext.vehicle?.registration
      ? { vehicle_interest: pageContext.vehicle.title || pageContext.vehicle.registration }
      : {}),
  };
  const payload = {
    public_token_hash: secureHash(conversationId, environment.AI_ASSISTANT_SESSION_SECRET),
    page_type: pageContext.page_type,
    product_lock: productLock,
    vehicle_context: pageContext.vehicle,
    conversation_history: [],
    remembered_facts: rememberedFacts,
    journey_state: {},
    application_readiness: "Exploring",
    budget: null,
    employment: null,
    message_count: 0,
    status: "active",
    expires_at: sessionExpiry(),
  };
  const session = data(await supabase.from("ai_customer_sessions").insert(payload).select("*").single(), "Anonymous assistant session could not be created.");
  return { session, conversationId, greeting };
}

async function loadSession(supabase, conversationId, environment = process.env) {
  const token = clean(conversationId, 100);
  if (!token) throw new PublicAssistantError(400, "invalid_request", "Please start a new assistant conversation.");
  const tokenHash = secureHash(token, environment.AI_ASSISTANT_SESSION_SECRET);
  const session = data(await supabase.from("ai_customer_sessions").select("*").eq("public_token_hash", tokenHash).eq("status", "active").maybeSingle(), "Assistant session could not be loaded.");
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) throw new PublicAssistantError(410, "invalid_request", "This conversation has expired. Please start a new one.");
  if (Number(session.message_count || 0) >= MAX_SESSION_MESSAGES) throw new PublicAssistantError(429, "rate_limited", "This conversation has reached its message limit. Please start a new conversation.");
  return session;
}

function boundedHistory(history = []) {
  return (Array.isArray(history) ? history : []).slice(-MAX_HISTORY_MESSAGES).map((item) => ({
    role: item?.role === "assistant" ? "assistant" : "user",
    content: clean(item?.content, 5000),
  })).filter((item) => item.content);
}

async function updateSession(supabase, session, changes) {
  return data(await supabase.from("ai_customer_sessions").update({
    ...changes,
    last_activity_at: new Date().toISOString(),
    expires_at: sessionExpiry(),
  }).eq("id", session.id).select("*").single(), "Assistant session could not be updated.");
}

function assertPageContext(session, supplied) {
  if (session.page_type !== supplied.page_type) throw new PublicAssistantError(409, "invalid_request", "The page context changed. Please start a new conversation on this page.");
  if (session.page_type === "finance_vehicle") {
    const storedRegistration = clean(session.vehicle_context?.registration, 20);
    const suppliedRegistration = clean(supplied.vehicle?.registration, 20);
    if (storedRegistration && suppliedRegistration && storedRegistration !== suppliedRegistration) throw new PublicAssistantError(409, "invalid_request", "The vehicle changed. Please start a new conversation for this van.");
  }
}

function explicitHomepageProduct(message, requestedChoice) {
  const choice = clean(requestedChoice, 20).toLowerCase();
  if (["finance", "rent2buy"].includes(choice)) return choice;
  const normalised = clean(message, 200).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/^(?:van )?finance$/.test(normalised)) return "finance";
  if (/^(?:rent ?2 ?buy|rent to buy)$/.test(normalised)) return "rent2buy";
  return null;
}

function productSelectionReply(product) {
  return product === "rent2buy"
    ? "Great — I’ll keep this conversation focused on Rent2Buy. What would you like to know?"
    : "Great — I’ll keep this conversation focused on Van Finance. What would you like to know?";
}

async function recordTelemetrySafely(supabase, payload) {
  try {
    if (Array.isArray(payload)) await recordAssistantTelemetryEvents(supabase, payload);
    else await recordAssistantTelemetryEvent(supabase, payload);
  } catch (error) {
    if (!isMissingAssistantTelemetryTableError(error)) {
      console.error("PUBLIC AI ASSISTANT TELEMETRY WRITE ERROR", {
        event_type: Array.isArray(payload) ? payload.map((item) => item?.event_type).filter(Boolean).join(",") : payload?.event_type || null,
        exception_type: error?.name || "Error",
        message: clean(error?.message, 500),
      });
    }
  }
}

async function recordResponseTelemetry({ supabase, body, environment, session, productContext, messageNumber, result = null, responseMode, cta = null }) {
  const diagnostics = result
    ? telemetryFromAssistantResult(result)
    : {
        conversation_intent: null,
        retrieval_required: false,
        retrieval_performed: false,
        retrieval_used: false,
        knowledge_gap: false,
        knowledge_sources: [],
      };
  const base = {
    visitor_hash: assistantTelemetryVisitorHash(body.analytics_visitor_id, environment),
    customer_session_id: session.id,
    page_type: session.page_type,
    product_context: productContext || session.product_lock,
    message_number: messageNumber,
  };
  const events = [
    {
      ...base,
      event_type: "customer_message",
    },
    {
      ...base,
      event_type: "assistant_response",
      ...diagnostics,
      response_mode: responseMode,
    },
  ];
  if (cta) events.push({
    ...base,
    event_type: "cta_shown",
    cta_action_key: cta.action_key,
    cta_label: cta.label,
  });
  await recordTelemetrySafely(supabase, events);
}

async function startConversation(supabase, body, environment) {
  const pageContext = normalisePageContext(body.page_context);
  const { session, conversationId, greeting } = await createSession(supabase, pageContext, environment);
  await recordTelemetrySafely(supabase, {
    event_type: "conversation_start",
    visitor_hash: assistantTelemetryVisitorHash(body.analytics_visitor_id, environment),
    customer_session_id: session.id,
    page_type: pageContext.page_type,
    product_context: session.product_lock,
  });
  return safeCustomerPayload({
    reply: greeting,
    cta: null,
    conversationId,
    status: pageContext.page_type === "homepage" ? "needs_product" : "ready",
  });
}

async function continueConversation(supabase, body, environment, simulateConversation = simulateCustomerConversation) {
  const conversationId = clean(body.conversation_id, 100);
  const session = await loadSession(supabase, conversationId, environment);
  const pageContext = normalisePageContext(body.page_context);
  assertPageContext(session, pageContext);
  const message = redactSensitiveCustomerData(body.message);
  if (!message) throw new PublicAssistantError(400, "invalid_request", "Please enter a message.");
  const history = boundedHistory(session.conversation_history);
  const messageNumber = Number(session.message_count || 0) + 1;

  if (isPromptLeakageAttempt(message)) {
    const reply = promptLeakageReply();
    await updateSession(supabase, session, {
      conversation_history: boundedHistory([...history, { role: "user", content: message }, { role: "assistant", content: reply }]),
      message_count: messageNumber,
    });
    await recordResponseTelemetry({ supabase, body, environment, session, productContext: session.product_lock, messageNumber, responseMode: "prompt_leakage" });
    return safeCustomerPayload({ reply, conversationId, status: "ready" });
  }

  let productLock = session.product_lock;
  if (session.page_type === "homepage") {
    const explicitChoice = explicitHomepageProduct(message, body.product_choice);
    if (explicitChoice) {
      const reply = productSelectionReply(explicitChoice);
      if (productLock !== explicitChoice) {
        productLock = explicitChoice;
        await updateSession(supabase, session, {
          product_lock: productLock,
          remembered_facts: { product_context: productLock },
          journey_state: {},
          conversation_history: [],
          message_count: messageNumber,
        });
      } else {
        await updateSession(supabase, session, {
          message_count: messageNumber,
        });
      }
      await recordResponseTelemetry({ supabase, body, environment, session, productContext: productLock, messageNumber, responseMode: "product_selection" });
      return safeCustomerPayload({ reply, conversationId, status: "ready" });
    }

    if (!productLock) {
      if (isExplicitProductComparison(message, history)) {
        const requestId = `public-${randomUUID()}`;
        const comparisonInput = buildCanonicalConversationInput({
          session: { ...session, product_lock: "finance" },
          message,
          requestId,
          history,
        });
        const generated = await simulateConversation(supabase, comparisonInput);
        const result = generated.result;
        const reply = clean(result.reply, 5000);
        await updateSession(supabase, session, {
          conversation_history: boundedHistory([...history, { role: "user", content: message }, { role: "assistant", content: reply }]),
          message_count: messageNumber,
        });
        await recordResponseTelemetry({ supabase, body, environment, session, productContext: "finance", messageNumber, result, responseMode: "ai_product_comparison" });
        return safeCustomerPayload({ reply, conversationId, status: "needs_product" });
      }

      productLock = determineHomepageProduct(message, history);
      if (!productLock) {
        const reply = productChoiceReply();
        await updateSession(supabase, session, {
          conversation_history: boundedHistory([...history, { role: "user", content: message }, { role: "assistant", content: reply }]),
          message_count: messageNumber,
        });
        await recordResponseTelemetry({ supabase, body, environment, session, productContext: null, messageNumber, responseMode: "product_clarification" });
        return safeCustomerPayload({ reply, conversationId, status: "needs_product" });
      }
    }
  }

  const applicationGuidanceReply = publicApplicationGuidanceReply({
    message,
    pageType: session.page_type,
    productLock,
  });
  if (applicationGuidanceReply) {
    await updateSession(supabase, session, {
      conversation_history: boundedHistory([...history, { role: "user", content: message }, { role: "assistant", content: applicationGuidanceReply }]),
      message_count: messageNumber,
    });
    await recordResponseTelemetry({ supabase, body, environment, session, productContext: productLock, messageNumber, responseMode: "application_guidance" });
    return safeCustomerPayload({ reply: applicationGuidanceReply, cta: null, conversationId, status: "ready" });
  }

  const pricingReply = publicVehiclePricingReply({
    message,
    pageType: session.page_type,
    productLock,
    vehicleContext: session.vehicle_context,
    rememberedFacts: session.remembered_facts,
  });
  if (pricingReply) {
    await updateSession(supabase, session, {
      conversation_history: boundedHistory([...history, { role: "user", content: message }, { role: "assistant", content: pricingReply }]),
      message_count: messageNumber,
    });
    await recordResponseTelemetry({ supabase, body, environment, session, productContext: productLock, messageNumber, responseMode: "vehicle_pricing" });
    return safeCustomerPayload({ reply: pricingReply, cta: null, conversationId, status: "ready" });
  }

  const requestId = `public-${randomUUID()}`;
  const canonicalInput = buildCanonicalConversationInput({
    session: { ...session, product_lock: productLock },
    message,
    requestId,
    history,
  });
  const generated = await simulateConversation(supabase, canonicalInput);
  const result = generated.result;
  const reply = clean(result.reply, 5000);
  const nextHistory = boundedHistory([...history, { role: "user", content: message }, { role: "assistant", content: reply }]);
  const state = canonicalSessionState({ session, result, productLock });
  await updateSession(supabase, session, {
    ...state,
    conversation_history: nextHistory,
    message_count: messageNumber,
  });
  const cta = publicApplicationCta(session.page_type, productLock, result);
  await recordResponseTelemetry({ supabase, body, environment, session, productContext: productLock, messageNumber, result, responseMode: "ai_generated", cta });
  return safeCustomerPayload({
    reply,
    cta,
    conversationId,
    status: "ready",
  });
}

export async function handleCustomerAssistantRequest(request, response, dependencies = {}) {
  const environment = dependencies.environment || process.env;
  const origin = requestOrigin(request);
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (!validateWixOrigin(origin, environment)) return response.status(403).json(safeCustomerPayload({ status: "invalid_request", reply: "This assistant request is not available from this website." }));
  setCors(response, origin);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json(safeCustomerPayload({ status: "invalid_request", reply: "That request method is not supported." }));
  let body = {};
  let conversationId = null;
  try {
    body = parseBody(request);
    conversationId = clean(body.conversation_id, 100) || null;
    const supabase = dependencies.supabase || getSupabase(environment);
    await enforceRateLimits(supabase, request, environment);
    const payload = body.action === "start"
      ? await startConversation(supabase, body, environment)
      : body.action === "message"
        ? await continueConversation(supabase, body, environment, dependencies.simulateConversation || simulateCustomerConversation)
        : (() => { throw new PublicAssistantError(400, "invalid_request", "Please start or continue an assistant conversation."); })();
    return response.status(200).json(payload);
  } catch (error) {
    const known = error instanceof PublicAssistantError;
    console.error("PUBLIC AI ASSISTANT ERROR", {
      request_id: `public-${randomUUID()}`,
      action: clean(body.action, 40) || null,
      conversation_present: Boolean(conversationId),
      exception_type: error?.name || "Error",
      message: clean(error?.message, 1000),
    });
    return response.status(known ? error.statusCode : 503).json(safeCustomerPayload({
      conversationId,
      status: known ? error.safeStatus : "unavailable",
      reply: known ? error.safeReply : "The assistant is temporarily unavailable. Please try again shortly.",
    }));
  }
}

export default async function handler(request, response) {
  return handleCustomerAssistantRequest(request, response);
}
