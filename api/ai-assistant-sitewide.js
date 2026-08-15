import { handleCustomerAssistantRequest } from "./ai-assistant-customer.js";
import { safeCustomerPayload, validateWixOrigin } from "../lib/publicAssistantFoundation.js";
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
