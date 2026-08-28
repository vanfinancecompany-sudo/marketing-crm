(() => {
  "use strict";

  if (window.__VFC_SITEWIDE_AI_ASSISTANT__) return;
  window.__VFC_SITEWIDE_AI_ASSISTANT__ = true;

  const CHANNEL = "vfc-ai-assistant-widget-v1";
  const STORAGE_PREFIX = "vfc_ai_assistant_sitewide";
  const ANALYTICS_SESSION_KEY = "vfc_ai_assistant_analytics_session_v1";
  const INTERNAL_ANALYTICS_STORAGE_KEY = "vfc_internal_analytics_v1";
  const INTERNAL_TEST_PARAM = "vfc_internal_test";
  const INTERNAL_ANALYTICS_PREFIX = "internal:";
  const RENT2BUY_ONLY_HOSTS = new Set(["rent2buyvans.co.uk", "www.rent2buyvans.co.uk"]);
  const WHATSAPP_SELECTOR = [
    'a[href*="wa.me" i]',
    'a[href*="whatsapp" i]',
    'iframe[src*="whatsapp" i]',
    'iframe[title*="whatsapp" i]',
    '[aria-label*="whatsapp" i]',
    '[title*="whatsapp" i]',
    '[data-hook*="whatsapp" i]',
    '[id*="whatsapp" i]',
    '[class*="whatsapp" i]',
  ].join(",");
  const SCRIPT_ORIGIN = (() => {
    try {
      return new URL(document.currentScript?.src || "https://marketing-crm-github-work.vercel.app").origin;
    } catch {
      return "https://marketing-crm-github-work.vercel.app";
    }
  })();
  const API_URL = `${SCRIPT_ORIGIN}/api/ai-assistant-sitewide`;
  const TELEMETRY_URL = `${SCRIPT_ORIGIN}/api/ai-assistant-telemetry`;
  const EMBED_URL = `${SCRIPT_ORIGIN}/wix-ai-assistant/embed.html?mode=panel&v=sitewide-1`;

  let host = null;
  let shadow = null;
  let launcher = null;
  let frame = null;
  let requestInFlight = false;
  let activeHref = window.location.href;
  let activeContext = inferPageContext(activeHref);
  let storageKey = buildStorageKey(activeContext);
  let whatsappObserver = null;
  let pageScrollLock = null;
  let routeTimer = null;
  const hiddenWhatsAppControls = new Map();
  const analyticsVisitorId = loadAnalyticsVisitorId();
  let internalAnalyticsTest = loadInternalAnalyticsTest(activeHref);

  function clean(value, limit = 5000) {
    return String(value || "").trim().slice(0, limit);
  }

  function loadAnalyticsVisitorId() {
    try {
      const existing = clean(window.sessionStorage.getItem(ANALYTICS_SESSION_KEY), 160);
      if (existing) return existing;
      const generated = globalThis.crypto?.randomUUID?.() || `analytics-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.sessionStorage.setItem(ANALYTICS_SESSION_KEY, generated);
      return generated;
    } catch {
      return globalThis.crypto?.randomUUID?.() || `analytics-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  function requestedInternalTestMode(href) {
    try { return clean(new URL(href, window.location.origin).searchParams.get(INTERNAL_TEST_PARAM), 20).toLowerCase(); }
    catch { return ""; }
  }

  function loadInternalAnalyticsTest(href = window.location.href) {
    const requested = requestedInternalTestMode(href);
    try {
      if (["1", "true", "yes", "on"].includes(requested)) window.localStorage.setItem(INTERNAL_ANALYTICS_STORAGE_KEY, "1");
      if (["0", "false", "no", "off"].includes(requested)) window.localStorage.removeItem(INTERNAL_ANALYTICS_STORAGE_KEY);
      return window.localStorage.getItem(INTERNAL_ANALYTICS_STORAGE_KEY) === "1";
    } catch {
      return ["1", "true", "yes", "on"].includes(requested);
    }
  }

  function analyticsVisitorForRequest() {
    if (!internalAnalyticsTest || analyticsVisitorId.startsWith(INTERNAL_ANALYTICS_PREFIX)) return analyticsVisitorId;
    return `${INTERNAL_ANALYTICS_PREFIX}${analyticsVisitorId}`;
  }

  function compactRegistration(value) {
    const compact = clean(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (compact.length < 5 || compact.length > 8 || !/[A-Z]/.test(compact) || !/\d/.test(compact)) return "";
    return compact;
  }

  function rent2BuyVehicleRegistration(first, second) {
    if (!["van-pages", "van-page", "guaranteed-rent2buy-vans", "guaranteed-rent2buy-van"].includes(first) || !second) return "";
    return compactRegistration(second);
  }

  function inferPageContext(href) {
    let url;
    try { url = new URL(href, window.location.origin); }
    catch { url = new URL(window.location.href); }
    const hostname = url.hostname.toLowerCase();
    const rent2BuyOnly = RENT2BUY_ONLY_HOSTS.has(hostname);
    const segments = url.pathname.split("/").map((part) => decodeURIComponent(part).trim()).filter(Boolean);
    const first = clean(segments[0], 120).toLowerCase();
    const second = clean(segments[1], 80);

    if (rent2BuyOnly) {
      const registration = rent2BuyVehicleRegistration(first, second);
      return {
        pageType: "rent2buy_general",
        productContext: "rent2buy",
        vehicle: registration
          ? { registration, stockId: null, title: null, applicationMode: "generic" }
          : { applicationMode: "generic" },
      };
    }

    if (first === "van-finance" && second) {
      const registration = compactRegistration(second);
      if (registration) {
        return {
          pageType: "finance_vehicle",
          productContext: "finance",
          vehicle: { registration, stockId: null, title: null, applicationMode: "page_form" },
        };
      }
    }

    if (["guaranteed-rent2buy-vans", "guaranteed-rent2buy-van"].includes(first) && second) {
      const registration = compactRegistration(second);
      if (registration) {
        return {
          pageType: "rent2buy_general",
          productContext: "rent2buy",
          vehicle: { registration, stockId: null, title: null, applicationMode: "generic" },
        };
      }
    }

    const path = url.pathname.toLowerCase();
    if (/rent(?:2|[- ]?to[- ]?)buy|rent-?2-?buy/.test(path)) {
      return { pageType: "rent2buy_general", productContext: "rent2buy", vehicle: { applicationMode: "generic" } };
    }
    if (path && path !== "/" && path.includes("finance")) {
      return { pageType: "finance_general", productContext: "finance", vehicle: { applicationMode: "generic" } };
    }
    return { pageType: "homepage", productContext: null, vehicle: { applicationMode: "generic" } };
  }

  function buildStorageKey(context) {
    const identity = context.vehicle?.registration || context.pageType;
    return `${STORAGE_PREFIX}:${context.pageType}:${clean(identity, 100)}`;
  }

  function storedConversationId() {
    try { return clean(window.localStorage.getItem(storageKey), 100) || null; }
    catch { return null; }
  }

  function storeConversationId(value) {
    try {
      if (value) window.localStorage.setItem(storageKey, clean(value, 100));
      else window.localStorage.removeItem(storageKey);
    } catch {
      // The chat still works for the current page load if browser storage is unavailable.
    }
  }

  function sendTelemetry(eventType, options = {}) {
    const body = {
      event_type: eventType,
      visitor_id: analyticsVisitorForRequest(),
      conversation_id: options.conversationId === undefined ? storedConversationId() : options.conversationId,
      page_type: activeContext.pageType,
      product_context: activeContext.productContext,
      cta_action_key: options.cta?.action_key || null,
      cta_label: options.cta?.label || null,
    };
    try {
      fetch(TELEMETRY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Measurement must never interfere with the customer assistant.
    }
  }

  function createUi() {
    if (host) return;
    host = document.createElement("div");
    host.id = "vfc-sitewide-live-chat";
    host.setAttribute("aria-live", "off");
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .layer { position:fixed; inset:0; z-index:100; pointer-events:none; font-family:Arial,sans-serif; }
        .launcher {
          pointer-events:auto; position:absolute; right:18px; bottom:58px; width:82px; height:44px;
          border:0; border-radius:999px; background:#d71920; color:#fff; cursor:pointer;
          display:flex; align-items:center; justify-content:center; padding:0 10px;
          font:700 11px/1 Arial,sans-serif; letter-spacing:.15px; white-space:nowrap;
          box-shadow:0 4px 14px rgba(0,0,0,.25); transition:transform .15s ease, box-shadow .15s ease;
        }
        .launcher:hover { transform:translateY(-1px); box-shadow:0 5px 16px rgba(0,0,0,.3); }
        .launcher:focus-visible { outline:3px solid #fff; outline-offset:3px; box-shadow:0 0 0 6px #d71920; }
        .panel-frame {
          pointer-events:auto; position:absolute; right:18px; bottom:88px; width:380px; height:610px;
          border:0; border-radius:16px; background:transparent; box-shadow:0 10px 36px rgba(0,0,0,.25);
          transition:height .18s ease, bottom .18s ease;
        }
        .panel-frame.is-open {
          bottom:18px;
          height:min(671px, calc(100vh - 110px));
          height:min(671px, calc(100dvh - 110px));
        }
        .hidden { display:none !important; }
        @media (max-width:520px) {
          .launcher {
            right:12px; bottom:58px; width:76px; height:38px; padding:0 8px;
            font-size:10.5px; box-shadow:0 4px 12px rgba(0,0,0,.24);
          }
          .panel-frame,
          .panel-frame.is-open {
            inset:0;
            right:0;
            bottom:0;
            width:100vw;
            max-width:none;
            height:100vh;
            height:100dvh;
            max-height:none;
            border-radius:0;
            box-shadow:none;
            transition:none;
          }
        }
      </style>
      <div class="layer">
        <button class="launcher" type="button" aria-label="Ask a question" title="Ask Me">Ask Me</button>
      </div>`;
    launcher = shadow.querySelector(".launcher");
    launcher.addEventListener("click", showPanel);
    document.body.appendChild(host);
    sendTelemetry("launcher_impression");
  }

  function assistantFrameTitle(context) {
    if (context?.productContext === "rent2buy") return "Rent2Buy Assistant";
    if (context?.productContext === "finance") return "Finance Assistant";
    return "Finance and Rent2Buy Assistant";
  }

  function ensureFrame() {
    if (frame) return frame;
    frame = document.createElement("iframe");
    frame.className = "panel-frame hidden";
    frame.src = EMBED_URL;
    frame.title = assistantFrameTitle(activeContext);
    frame.setAttribute("allow", "clipboard-write; microphone");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    shadow.querySelector(".layer").appendChild(frame);
    return frame;
  }

  function fixedControlContainer(candidate) {
    if (!(candidate instanceof Element) || candidate === host || host?.contains(candidate)) return null;
    let current = candidate;
    while (current && current !== document.body && current !== document.documentElement) {
      try {
        const position = window.getComputedStyle(current).position;
        if (position === "fixed" || position === "sticky") return current;
      } catch {
        return null;
      }
      current = current.parentElement;
    }
    return candidate.tagName === "IFRAME" ? candidate : null;
  }

  function rememberStyleProperty(element, property) {
    return {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    };
  }

  function restoreStyleProperty(element, property, previous) {
    if (previous?.value) element.style.setProperty(property, previous.value, previous.priority || "");
    else element.style.removeProperty(property);
  }

  function lockPageScroll() {
    if (pageScrollLock || !document.documentElement || !document.body) return;
    const html = document.documentElement;
    const body = document.body;
    pageScrollLock = {
      htmlOverflow: rememberStyleProperty(html, "overflow"),
      htmlOverscroll: rememberStyleProperty(html, "overscroll-behavior"),
      bodyOverflow: rememberStyleProperty(body, "overflow"),
      bodyOverscroll: rememberStyleProperty(body, "overscroll-behavior"),
    };
    html.style.setProperty("overflow", "hidden", "important");
    html.style.setProperty("overscroll-behavior", "none", "important");
    body.style.setProperty("overflow", "hidden", "important");
    body.style.setProperty("overscroll-behavior", "none", "important");
  }

  function unlockPageScroll() {
    if (!pageScrollLock || !document.documentElement || !document.body) return;
    restoreStyleProperty(document.documentElement, "overflow", pageScrollLock.htmlOverflow);
    restoreStyleProperty(document.documentElement, "overscroll-behavior", pageScrollLock.htmlOverscroll);
    restoreStyleProperty(document.body, "overflow", pageScrollLock.bodyOverflow);
    restoreStyleProperty(document.body, "overscroll-behavior", pageScrollLock.bodyOverscroll);
    pageScrollLock = null;
  }

  function hideWhatsAppTarget(target) {
    if (!target || hiddenWhatsAppControls.has(target)) return;
    hiddenWhatsAppControls.set(target, {
      visibility: rememberStyleProperty(target, "visibility"),
      opacity: rememberStyleProperty(target, "opacity"),
      pointerEvents: rememberStyleProperty(target, "pointer-events"),
    });
    target.setAttribute("data-vfc-ai-whatsapp-hidden", "true");
    target.style.setProperty("visibility", "hidden", "important");
    target.style.setProperty("opacity", "0", "important");
    target.style.setProperty("pointer-events", "none", "important");
  }

  function scanAndHideWhatsAppControls() {
    if (!frame || frame.classList.contains("hidden")) return;
    let candidates = [];
    try { candidates = [...document.querySelectorAll(WHATSAPP_SELECTOR)]; }
    catch { return; }
    candidates.forEach((candidate) => hideWhatsAppTarget(fixedControlContainer(candidate)));
  }

  function hideCompetingWhatsAppControl() {
    scanAndHideWhatsAppControls();
    if (whatsappObserver || typeof MutationObserver !== "function") return;
    whatsappObserver = new MutationObserver(() => scanAndHideWhatsAppControls());
    whatsappObserver.observe(document.body, { childList: true, subtree: true });
  }

  function restoreCompetingWhatsAppControl() {
    whatsappObserver?.disconnect();
    whatsappObserver = null;
    hiddenWhatsAppControls.forEach((previous, target) => {
      if (!(target instanceof Element)) return;
      restoreStyleProperty(target, "visibility", previous.visibility);
      restoreStyleProperty(target, "opacity", previous.opacity);
      restoreStyleProperty(target, "pointer-events", previous.pointerEvents);
      target.removeAttribute("data-vfc-ai-whatsapp-hidden");
    });
    hiddenWhatsAppControls.clear();
  }

  function showPanel() {
    const currentFrame = ensureFrame();
    launcher.classList.add("hidden");
    currentFrame.classList.remove("hidden");
    currentFrame.classList.add("is-open");
    lockPageScroll();
    hideCompetingWhatsAppControl();
    sendTelemetry("launcher_open");
  }

  function hidePanel() {
    const wasOpen = Boolean(frame && !frame.classList.contains("hidden"));
    restoreCompetingWhatsAppControl();
    unlockPageScroll();
    frame?.classList.remove("is-open");
    frame?.classList.add("hidden");
    launcher?.classList.remove("hidden");
    launcher?.focus();
    if (wasOpen) sendTelemetry("launcher_close");
  }

  function postToWidget(message) {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({ channel: CHANNEL, ...message }, SCRIPT_ORIGIN);
  }

  async function callAssistant(message) {
    if (requestInFlight) return;
    requestInFlight = true;
    try {
      const restarting = message.action === "restart";
      if (restarting) storeConversationId(null);
      const action = message.action === "message" ? "message" : "start";
      const homepageChoice = activeContext.pageType === "homepage"
        && ["finance", "rent2buy"].includes(message.productChoice)
        ? message.productChoice
        : null;
      const body = action === "start"
        ? { action: "start", page_url: window.location.href, analytics_visitor_id: analyticsVisitorForRequest() }
        : {
            action: "message",
            conversation_id: storedConversationId(),
            page_url: window.location.href,
            message: clean(message.message, 3000),
            product_choice: homepageChoice,
            analytics_visitor_id: analyticsVisitorForRequest(),
          };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
      });
      const payload = await response.json();
      if (payload?.conversation_id) storeConversationId(payload.conversation_id);
      if (!response.ok && !payload?.reply) throw new Error("Assistant request failed.");
      postToWidget({ type: "assistant_response", payload });
    } catch {
      postToWidget({ type: "assistant_error" });
    } finally {
      requestInFlight = false;
    }
  }

  function handleWidgetMessage(event) {
    if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
    if (event.origin !== SCRIPT_ORIGIN) return;
    const message = event.data;
    if (message?.channel !== CHANNEL) return;

    if (message.type === "widget_ready") {
      postToWidget({
        type: "initialise",
        pageContext: activeContext,
        conversationId: storedConversationId(),
        privacyUrl: null,
      });
      return;
    }
    if (message.type === "assistant_request" && ["start", "message", "restart"].includes(message.action)) {
      callAssistant(message);
      return;
    }
    if (message.type === "cta") {
      sendTelemetry("cta_click", { cta: message.cta });
      return;
    }
    if (message.type === "ui_close") hidePanel();
  }

  function resetForNavigation() {
    const nextHref = window.location.href;
    if (nextHref === activeHref) return;
    const previousUrl = new URL(activeHref);
    const nextUrl = new URL(nextHref);
    activeHref = nextHref;
    internalAnalyticsTest = loadInternalAnalyticsTest(nextHref);
    if (previousUrl.pathname === nextUrl.pathname) return;

    hidePanel();
    frame?.remove();
    frame = null;
    requestInFlight = false;
    activeContext = inferPageContext(nextHref);
    storageKey = buildStorageKey(activeContext);
    sendTelemetry("launcher_impression");
  }

  function startRouteMonitoring() {
    if (routeTimer !== null || document.hidden) return;
    routeTimer = window.setInterval(resetForNavigation, 750);
  }

  function stopRouteMonitoring() {
    if (routeTimer === null) return;
    window.clearInterval(routeTimer);
    routeTimer = null;
  }

  function syncPageVisibility() {
    if (document.hidden) {
      stopRouteMonitoring();
      return;
    }
    resetForNavigation();
    startRouteMonitoring();
  }

  function scheduleCreateUi() {
    const schedule = () => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(createUi, { timeout: 1200 });
        return;
      }
      window.setTimeout(createUi, 0);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
    else schedule();
  }

  window.addEventListener("message", handleWidgetMessage);
  window.addEventListener("popstate", resetForNavigation);
  window.addEventListener("hashchange", resetForNavigation);
  document.addEventListener("visibilitychange", syncPageVisibility);
  startRouteMonitoring();

  scheduleCreateUi();
})();
