export const WIDGET_CHANNEL = "vfc-ai-assistant-widget-v1";
export const PAGE_TYPES = Object.freeze(["finance_vehicle", "finance_general", "rent2buy_general", "homepage"]);
export const PRODUCT_CONTEXTS = Object.freeze(["finance", "rent2buy"]);
const SAFE_STATUSES = new Set(["ready", "needs_product", "rate_limited", "invalid_request", "unavailable"]);
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
  if (!["page_form", "generic"].includes(applicationMode)) throw new Error("Choose a supported applicationMode.");
  if (pageType === "finance_vehicle" && applicationMode !== "page_form") throw new Error("Finance vehicle pages must use their existing page form.");
  return {
    pageType,
    productContext: product,
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

export function endpointPageContext(context) {
  const safe = normaliseWidgetPageContext(context);
  const hasVehicle = safe.pageType === "finance_vehicle" || (
    safe.pageType === "rent2buy_general"
    && Boolean(safe.vehicle.registration || safe.vehicle.stockId || safe.vehicle.title)
  );
  if (!hasVehicle) return { pageType: safe.pageType, vehicle: {} };

  const pricing = safe.productContext === "rent2buy"
    ? compactObject({
      rent2buy_monthly: safe.vehicle.pricing.monthlyRental,
      rent2buy_initial: safe.vehicle.pricing.initialRental,
    })
    : compactObject({
      finance_monthly: safe.vehicle.pricing.financeMonthly,
      finance_retail_vat: safe.vehicle.pricing.retailPriceVat,
    });

  return {
    pageType: safe.pageType,
    vehicle: compactObject({
      registration: safe.vehicle.registration,
      vehicle_id: safe.vehicle.stockId,
      title: safe.vehicle.title,
      pricing,
      term_months: safe.productContext === "rent2buy" ? safe.vehicle.termMonths : null,
    }),
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

export function safeWidgetCta(_serverCta, _pageContext) {
  // Applications are deliberately not actioned from inside chat. The assistant tells the customer to use
  // the existing APPLY NOW button on the Wix page, which remains the single application control.
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
