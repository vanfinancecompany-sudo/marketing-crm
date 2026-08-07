(() => {
  "use strict";

  if (window.__VFC_SITEWIDE_AI_ASSISTANT__) return;
  window.__VFC_SITEWIDE_AI_ASSISTANT__ = true;

  const CHANNEL = "vfc-ai-assistant-widget-v1";
  const STORAGE_PREFIX = "vfc_ai_assistant_sitewide";
  const SCRIPT_ORIGIN = (() => {
    try {
      return new URL(document.currentScript?.src || "https://marketing-crm-github-work.vercel.app").origin;
    } catch {
      return "https://marketing-crm-github-work.vercel.app";
    }
  })();
  const API_URL = `${SCRIPT_ORIGIN}/api/ai-assistant-sitewide`;
  const EMBED_URL = `${SCRIPT_ORIGIN}/wix-ai-assistant/embed.html?mode=panel&v=sitewide-1`;

  let host = null;
  let shadow = null;
  let launcher = null;
  let frame = null;
  let requestInFlight = false;
  let activeHref = window.location.href;
  let activeContext = inferPageContext(activeHref);
  let storageKey = buildStorageKey(activeContext);

  function clean(value, limit = 5000) {
    return String(value || "").trim().slice(0, limit);
  }

  function compactRegistration(value) {
    const compact = clean(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (compact.length < 5 || compact.length > 8 || !/[A-Z]/.test(compact) || !/\d/.test(compact)) return "";
    return compact;
  }

  function inferPageContext(href) {
    let url;
    try { url = new URL(href, window.location.origin); }
    catch { url = new URL(window.location.href); }
    const segments = url.pathname.split("/").map((part) => decodeURIComponent(part).trim()).filter(Boolean);
    const first = clean(segments[0], 120).toLowerCase();
    const second = clean(segments[1], 80);

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

  function createUi() {
    if (host) return;
    host = document.createElement("div");
    host.id = "vfc-sitewide-live-chat";
    host.setAttribute("aria-live", "off");
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .layer { position:fixed; inset:0; z-index:2147483000; pointer-events:none; font-family:Arial,sans-serif; }
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
        }
        .hidden { display:none !important; }
        @media (max-width:520px) {
          .launcher { right:12px; bottom:56px; width:80px; height:44px; font-size:10.5px; }
          .panel-frame {
            right:12px; bottom:84px; width:calc(100vw - 24px);
            height:min(560px, calc(100vh - 120px)); height:min(560px, calc(100dvh - 120px));
            border-radius:14px;
          }
        }
      </style>
      <div class="layer">
        <button class="launcher" type="button" aria-label="Open Live Chat" title="Live Chat">Live Chat</button>
      </div>`;
    launcher = shadow.querySelector(".launcher");
    launcher.addEventListener("click", showPanel);
    document.body.appendChild(host);
  }

  function ensureFrame() {
    if (frame) return frame;
    frame = document.createElement("iframe");
    frame.className = "panel-frame hidden";
    frame.src = EMBED_URL;
    frame.title = "Live Chat";
    frame.setAttribute("allow", "clipboard-write");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    shadow.querySelector(".layer").appendChild(frame);
    return frame;
  }

  function showPanel() {
    const currentFrame = ensureFrame();
    launcher.classList.add("hidden");
    currentFrame.classList.remove("hidden");
  }

  function hidePanel() {
    frame?.classList.add("hidden");
    launcher?.classList.remove("hidden");
    launcher?.focus();
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
      const body = action === "start"
        ? { action: "start", page_url: window.location.href }
        : {
            action: "message",
            conversation_id: storedConversationId(),
            page_url: window.location.href,
            message: clean(message.message, 3000),
            product_choice: ["finance", "rent2buy"].includes(message.productChoice) ? message.productChoice : null,
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
    if (message.type === "ui_close") hidePanel();
  }

  function resetForNavigation() {
    const nextHref = window.location.href;
    if (nextHref === activeHref) return;
    const previousUrl = new URL(activeHref);
    const nextUrl = new URL(nextHref);
    activeHref = nextHref;
    if (previousUrl.pathname === nextUrl.pathname) return;

    hidePanel();
    frame?.remove();
    frame = null;
    requestInFlight = false;
    activeContext = inferPageContext(nextHref);
    storageKey = buildStorageKey(activeContext);
  }

  window.addEventListener("message", handleWidgetMessage);
  window.addEventListener("popstate", resetForNavigation);
  window.addEventListener("hashchange", resetForNavigation);
  window.setInterval(resetForNavigation, 750);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", createUi, { once: true });
  else createUi();
})();
