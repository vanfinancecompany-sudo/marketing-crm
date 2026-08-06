export const WIDGET_CHANNEL = "vfc-ai-assistant-widget-v1";
export const PAGE_TYPES = Object.freeze(["finance_vehicle", "finance_general", "rent2buy_general", "homepage"]);
export const PRODUCT_CONTEXTS = Object.freeze(["finance", "rent2buy"]);
export const FINANCE_APPLICATION_URL = "https://www.vanfinancecompany.co.uk/apply-by-reg-finance/application-form";
export const RENT2BUY_APPLICATION_URL = "https://www.vanfinancecompany.co.uk/rent2buy-application";
const SAFE_STATUSES = new Set(["ready", "needs_product", "rate_limited", "invalid_request", "unavailable"]);

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

export function createWidgetReadyHandshake({ announce, schedule = globalThis.setInterval, cancel = globalThis.clearInterval, retryMs = 750 } = {}) {
  if (typeof announce !== "function") throw new Error("Widget readiness requires an announce function.");
  let timer = null;
  let acknowledged = false;
  const notify = () => {
    if (!acknowledged) announce({ channel: WIDGET_CHANNEL, type: "widget_ready" });
  };
  return {
    start() {
      if (acknowledged || timer !== null) return;
      notify();
      if (!acknowledged) timer = schedule(notify, retryMs);
    },
    acknowledge() {
      if (acknowledged) return;
      acknowledged = true;
      if (timer !== null) cancel(timer);
      timer = null;
    },
    get acknowledged() { return acknowledged; },
  };
}

export function escapeHtml(value) {
  return clean(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

export function safeFormAnchor(value) {
  const candidate = clean(value, 80) || "#finance-application";
  return /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(candidate) ? candidate : "#finance-application";
}

export function normaliseWidgetPageContext(input = {}) {
  const pageType = clean(input.pageType, 40).toLowerCase();
  if (!PAGE_TYPES.includes(pageType)) throw new Error("Choose a supported pageType.");
  const product = clean(input.productContext, 20).toLowerCase() || null;
  if (product && !PRODUCT_CONTEXTS.includes(product)) throw new Error("Choose a supported productContext.");
  if (["finance_vehicle", "finance_general"].includes(pageType) && product && product !== "finance") throw new Error("Finance page context cannot be changed to Rent2Buy.");
  if (pageType === "rent2buy_general" && product && product !== "rent2buy") throw new Error("Rent2Buy page context cannot be changed to Finance.");
  const applicationMode = clean(input.vehicle?.applicationMode, 20) || (pageType === "finance_vehicle" ? "page_form" : "generic");
  if (!['page_form', 'generic'].includes(applicationMode)) throw new Error("Choose a supported applicationMode.");
  if (pageType === "finance_vehicle" && applicationMode !== "page_form") throw new Error("Finance vehicle pages must use their existing page form.");
  return {
    pageType,
    productContext: product,
    vehicle: {
      registration: clean(input.vehicle?.registration, 20).toUpperCase() || null,
      stockId: clean(input.vehicle?.stockId, 100) || null,
      title: clean(input.vehicle?.title, 200) || null,
      applicationMode,
      formAnchor: safeFormAnchor(input.vehicle?.formAnchor),
    },
  };
}

export function endpointPageContext(context) {
  const safe = normaliseWidgetPageContext(context);
  return {
    pageType: safe.pageType,
    vehicle: safe.pageType === "finance_vehicle" ? {
      registration: safe.vehicle.registration,
      vehicle_id: safe.vehicle.stockId,
      title: safe.vehicle.title,
    } : {},
  };
}

export function safePrivacyUrl(value) {
  const candidate = clean(value, 500);
  if (!candidate) return null;
  try {
    const url = new URL(candidate, "https://www.vanfinancecompany.co.uk");
    return url.origin === "https://www.vanfinancecompany.co.uk" ? url.href : null;
  } catch { return null; }
}

export function safeWidgetCta(serverCta, pageContext) {
  if (!serverCta || typeof serverCta !== "object") return null;
  const context = normaliseWidgetPageContext(pageContext);
  const label = clean(serverCta.label, 100);
  if (serverCta.action === "open_current_page_finance_application"
    && serverCta.behavior === "same_page"
    && context.pageType === "finance_vehicle"
    && context.vehicle.applicationMode === "page_form") {
    return { type: "scroll_to_form", target: context.vehicle.formAnchor, label: label || "Apply for this van" };
  }
  if (serverCta.action !== "navigate" || serverCta.behavior !== "same_window") return null;
  if (serverCta.url === FINANCE_APPLICATION_URL
    && ["finance_general", "homepage"].includes(context.pageType)
    && context.productContext !== "rent2buy") {
    return { type: "navigate_same_window", url: FINANCE_APPLICATION_URL, label: label || "Start Finance Application" };
  }
  if (serverCta.url === RENT2BUY_APPLICATION_URL
    && ["rent2buy_general", "homepage"].includes(context.pageType)
    && context.productContext !== "finance") {
    return { type: "navigate_same_window", url: RENT2BUY_APPLICATION_URL, label: label || "Start Rent2Buy Application" };
  }
  return null;
}

export function safeAssistantResponse(payload = {}, pageContext = {}) {
  return {
    reply: clean(payload.reply, 5000),
    cta: safeWidgetCta(payload.cta, pageContext),
    conversation_id: clean(payload.conversation_id, 100) || null,
    status: SAFE_STATUSES.has(payload.status) ? payload.status : "unavailable",
  };
}

export function welcomeForPage(pageType) {
  if (pageType === "finance_vehicle") return "Hi — ask me anything about this van or applying for finance.";
  if (pageType === "finance_general") return "Hi — how can I help with van finance?";
  if (pageType === "rent2buy_general") return "Hi — how can I help with Rent2Buy?";
  return "Hi — are you looking for Van Finance or Rent2Buy?";
}

export function createWidgetState() {
  return {
    open: false,
    loading: false,
    initialised: false,
    conversationId: null,
    pageContext: null,
    privacyUrl: null,
    status: "ready",
    messages: [],
    cta: null,
    retryRequest: null,
  };
}

export function reduceWidgetState(state, event = {}) {
  if (event.type === "open") return { ...state, open: true };
  if (event.type === "close") return { ...state, open: false };
  if (event.type === "initialise") {
    if (state.initialised) return state;
    const pageContext = normaliseWidgetPageContext(event.pageContext);
    const conversationId = clean(event.conversationId, 100) || null;
    return {
      ...state,
      initialised: true,
      pageContext,
      privacyUrl: safePrivacyUrl(event.privacyUrl),
      conversationId,
      status: pageContext.pageType === "homepage" && !pageContext.productContext ? "needs_product" : "ready",
      messages: conversationId ? [{ role: "assistant", content: welcomeForPage(pageContext.pageType) }] : [],
    };
  }
  if (event.type === "request") return {
    ...state,
    loading: true,
    retryRequest: event.request || null,
    messages: event.customerMessage ? [...state.messages, { role: "customer", content: clean(event.customerMessage, 3000) }] : state.messages,
  };
  if (event.type === "response") {
    const response = safeAssistantResponse(event.payload, state.pageContext);
    const messages = response.reply ? [...state.messages, { role: "assistant", content: response.reply }] : state.messages;
    return { ...state, loading: false, retryRequest: null, conversationId: response.conversation_id || state.conversationId, status: response.status, messages, cta: response.cta };
  }
  if (event.type === "error") return { ...state, loading: false, status: "unavailable" };
  if (event.type === "restart") return { ...createWidgetState(), open: true, initialised: true, pageContext: state.pageContext, privacyUrl: state.privacyUrl };
  return state;
}

export function widgetRequest({ action, message = "", productChoice = null, conversationId = null, pageContext }) {
  if (!["start", "message", "restart"].includes(action)) throw new Error("Unsupported widget request.");
  return {
    channel: WIDGET_CHANNEL,
    type: "assistant_request",
    action,
    message: action === "message" ? clean(message, 3000) : "",
    productChoice: PRODUCT_CONTEXTS.includes(productChoice) ? productChoice : null,
    conversationId: clean(conversationId, 100) || null,
    pageContext: normaliseWidgetPageContext(pageContext),
  };
}
