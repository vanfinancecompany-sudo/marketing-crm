import { createClient } from "@supabase/supabase-js";
import { handleCustomerAssistantRequest } from "./ai-assistant-customer.js";
import { safeCustomerPayload, secureHash, validateWixOrigin } from "../lib/publicAssistantFoundation.js";
import { resolvePublicWixPageContext } from "../lib/publicWixSiteContext.js";
import { personaliseCustomerPayload } from "../lib/customerAssistantPersonality.js";

const INTERNAL_ANALYTICS_PREFIX = "internal:";
const INTERNAL_TEST_PARAM = "vfc_internal_test";
const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

function bodyObject(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return {}; }
}

function requestOrigin(request) {
  return clean(request.headers?.origin || request.headers?.Origin, 500);
}

function internalTestRequested(pageUrl) {
  try {
    const value = clean(new URL(pageUrl).searchParams.get(INTERNAL_TEST_PARAM), 20).toLowerCase();
    return ["1", "true", "yes", "on"].includes(value);
  } catch {
    return false;
  }
}

function analyticsVisitorId(body, pageUrl) {
  const value = clean(body.analytics_visitor_id, 160);
  if (!value || !internalTestRequested(pageUrl)) return value || null;
  return value.startsWith(INTERNAL_ANALYTICS_PREFIX) ? value : `${INTERNAL_ANALYTICS_PREFIX}${value}`;
}

function installCustomerVoice(response, body = {}) {
  if (response.__customerAssistantVoiceInstalled || typeof response.json !== "function") return;
  response.__customerAssistantVoiceInstalled = true;
  const originalJson = response.json.bind(response);
  response.json = (payload) => originalJson(personaliseCustomerPayload(payload, {
    message: clean(body.message, 3000),
  }));
}

function sameVehicleIdentity(stored = {}, supplied = {}) {
  const storedRegistration = clean(stored.registration, 20).toUpperCase().replace(/\s+/g, "");
  const suppliedRegistration = clean(supplied.registration, 20).toUpperCase().replace(/\s+/g, "");
  if (storedRegistration && suppliedRegistration) return storedRegistration === suppliedRegistration;

  const storedId = clean(stored.vehicle_id, 100);
  const suppliedId = clean(supplied.vehicle_id, 100);
  if (storedId && suppliedId) return storedId === suppliedId;

  const storedTitle = clean(stored.title, 200).toLowerCase();
  const suppliedTitle = clean(supplied.title, 200).toLowerCase();
  return !storedTitle || !suppliedTitle || storedTitle === suppliedTitle;
}

function hasUsefulVehicleRefresh(vehicle = {}) {
  const pricing = vehicle.pricing || {};
  return Boolean(
    clean(vehicle.title, 200)
    || clean(vehicle.description, 500)
    || clean(vehicle.highlights, 500)
    || clean(vehicle.specification, 500)
    || clean(pricing.finance_monthly, 160)
    || clean(pricing.finance_retail_vat, 160)
    || clean(pricing.rent2buy_monthly, 160)
    || clean(pricing.rent2buy_initial, 160)
  );
}

async function refreshTrustedVehicleSession({ body, pageContext, environment, dependencies }) {
  if (body.action !== "message" || !clean(body.conversation_id, 100) || !hasUsefulVehicleRefresh(pageContext.vehicle)) return;
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY || !environment.AI_ASSISTANT_SESSION_SECRET) return;

  const supabase = dependencies.supabase || createClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const tokenHash = secureHash(clean(body.conversation_id, 100), environment.AI_ASSISTANT_SESSION_SECRET);
  const loaded = await supabase
    .from("ai_customer_sessions")
    .select("id,page_type,vehicle_context,remembered_facts")
    .eq("public_token_hash", tokenHash)
    .eq("status", "active")
    .maybeSingle();
  if (loaded.error) throw loaded.error;
  const session = loaded.data;
  if (!session || session.page_type !== pageContext.page_type) return;
  if (!sameVehicleIdentity(session.vehicle_context || {}, pageContext.vehicle || {})) return;

  const rememberedFacts = session.remembered_facts && typeof session.remembered_facts === "object"
    ? session.remembered_facts
    : {};
  const vehicleInterest = clean(pageContext.vehicle?.title || pageContext.vehicle?.registration, 200);
  const refreshed = await supabase
    .from("ai_customer_sessions")
    .update({
      vehicle_context: pageContext.vehicle,
      remembered_facts: vehicleInterest
        ? { ...rememberedFacts, vehicle_interest: vehicleInterest }
        : rememberedFacts,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", session.id);
  if (refreshed.error) throw refreshed.error;
}

export async function handleSitewideAssistantRequest(request, response, dependencies = {}) {
  const environment = dependencies.environment || process.env;

  // Let the canonical endpoint own OPTIONS/method/CORS responses. Do not perform a Wix lookup for an untrusted origin.
  if (request.method !== "POST" || !validateWixOrigin(requestOrigin(request), environment)) {
    return handleCustomerAssistantRequest(request, response, dependencies);
  }

  const body = bodyObject(request);
  installCustomerVoice(response, body);
  const pageUrl = clean(body.page_url, 2000);
  if (!pageUrl) {
    response.setHeader?.("Cache-Control", "no-store, max-age=0");
    return response.status(400).json(safeCustomerPayload({
      status: "invalid_request",
      reply: "Please refresh this page and try the assistant again.",
      conversationId: clean(body.conversation_id, 100) || null,
    }));
  }

  try {
    const pageContext = await resolvePublicWixPageContext(pageUrl, {
      environment,
      fetchImpl: dependencies.fetchImpl || fetch,
    });

    // Existing browser conversations can outlive a deployment. Refresh the stored vehicle context from the
    // trusted server-side Wix lookup before the canonical handler loads the session, but only for the same vehicle.
    try {
      await refreshTrustedVehicleSession({ body, pageContext, environment, dependencies });
    } catch (error) {
      console.warn("SITEWIDE AI ASSISTANT SESSION CONTEXT REFRESH FAILED", {
        page_type: pageContext.page_type,
        vehicle_present: Boolean(pageContext.vehicle?.registration || pageContext.vehicle?.vehicle_id || pageContext.vehicle?.title),
        exception_type: error?.name || "Error",
        message: clean(error?.message, 500),
      });
    }

    // The browser cannot provide product, vehicle or pricing context in site-wide mode. It is replaced here
    // with server-resolved context from the current VFC URL and, on vehicle pages, the Wix CMS.
    request.body = {
      ...body,
      analytics_visitor_id: analyticsVisitorId(body, pageUrl),
      page_context: pageContext,
    };

    return handleCustomerAssistantRequest(request, response, dependencies);
  } catch (error) {
    console.error("SITEWIDE AI ASSISTANT PAGE CONTEXT ERROR", {
      page_url_present: Boolean(pageUrl),
      exception_type: error?.name || "Error",
      message: clean(error?.message, 500),
    });
    response.setHeader?.("Cache-Control", "no-store, max-age=0");
    return response.status(400).json(safeCustomerPayload({
      status: "invalid_request",
      reply: "Please refresh this page and try the assistant again.",
      conversationId: clean(body.conversation_id, 100) || null,
    }));
  }
}

export default async function handler(request, response) {
  return handleSitewideAssistantRequest(request, response);
}
