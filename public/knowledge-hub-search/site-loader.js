(() => {
  "use strict";

  if (window.__VFC_KNOWLEDGE_HUB_SEARCH__) return;
  window.__VFC_KNOWLEDGE_HUB_SEARCH__ = true;

  const ANALYTICS_SESSION_KEY = "vfc_ai_assistant_analytics_session_v1";
  const INTERNAL_ANALYTICS_STORAGE_KEY = "vfc_internal_analytics_v1";
  const INTERNAL_TEST_PARAM = "vfc_internal_test";
  const INTERNAL_ANALYTICS_PREFIX = "internal:";
  const SCRIPT_ORIGIN = (() => {
    try {
      return new URL(document.currentScript?.src || "https://marketing-crm-six.vercel.app").origin;
    } catch {
      return "https://marketing-crm-six.vercel.app";
    }
  })();
  const API_URL = `${SCRIPT_ORIGIN}/api/public-knowledge-hub-search`;
  const RENT2BUY_HOSTS = new Set(["rent2buyvans.co.uk", "www.rent2buyvans.co.uk"]);
  const VFC_CATEGORIES = [
    "all",
    "Van Finance",
    "Rent2Buy",
    "Credit",
    "Vehicle Guides",
    "FAQs",
    "Business Advice",
    "Self Employed",
  ];
  const SITE = siteConfiguration();

  let host = null;
  let shadow = null;
  let input = null;
  let searchView = null;
  let resultsView = null;
  let status = null;
  let matchList = null;
  let emptyState = null;
  let queryLabel = null;
  let searchButton = null;
  let category = "all";
  let requestSequence = 0;
  let activeSearch = null;
  let targetObserver = null;
  const visitorId = analyticsVisitorId();

  function clean(value, limit = 5000) {
    return String(value || "").trim().slice(0, limit);
  }

  function siteConfiguration() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    if (RENT2BUY_HOSTS.has(hostname)) {
      return {
        brand: "rent2buy",
        paths: new Set(["/knowledge-hub-category/rent2buy"]),
        categories: ["all"],
        eyebrow: "Rent2Buy Knowledge Hub",
        title: "What do you need help with?",
        intro: "Ask a question or search by keyword across our Rent2Buy guides.",
        ariaLabel: "Search the Rent2Buy Knowledge Hub",
      };
    }
    return {
      brand: "vfc",
      paths: new Set(["/knowledge-hub"]),
      categories: VFC_CATEGORIES,
      eyebrow: "Knowledge Hub",
      title: "What do you need help with?",
      intro: "Ask a question or search by keyword to find practical guides from Van Finance Company.",
      ariaLabel: "Search the Knowledge Hub",
    };
  }

  function isKnowledgeHubPath() {
    const normalisedPath = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
    return SITE.paths.has(normalisedPath.toLowerCase());
  }

  function analyticsVisitorId() {
    try {
      const existing = clean(window.sessionStorage.getItem(ANALYTICS_SESSION_KEY), 160);
      if (existing) return existing;
      const generated = globalThis.crypto?.randomUUID?.() || `knowledge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.sessionStorage.setItem(ANALYTICS_SESSION_KEY, generated);
      return generated;
    } catch {
      return globalThis.crypto?.randomUUID?.() || `knowledge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  function requestedInternalTestMode() {
    try {
      return clean(new URL(window.location.href).searchParams.get(INTERNAL_TEST_PARAM), 20).toLowerCase();
    } catch {
      return "";
    }
  }

  function internalAnalyticsTestEnabled() {
    const requested = requestedInternalTestMode();
    try {
      if (["1", "true", "yes", "on"].includes(requested)) window.localStorage.setItem(INTERNAL_ANALYTICS_STORAGE_KEY, "1");
      if (["0", "false", "no", "off"].includes(requested)) window.localStorage.removeItem(INTERNAL_ANALYTICS_STORAGE_KEY);
      return window.localStorage.getItem(INTERNAL_ANALYTICS_STORAGE_KEY) === "1";
    } catch {
      return ["1", "true", "yes", "on"].includes(requested);
    }
  }

  function analyticsVisitorForRequest() {
    if (!internalAnalyticsTestEnabled() || visitorId.startsWith(INTERNAL_ANALYTICS_PREFIX)) return visitorId;
    return `${INTERNAL_ANALYTICS_PREFIX}${visitorId}`;
  }

  function escapeHtml(value) {
    return clean(value, 2000)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function pageTarget() {
    return document.querySelector("main")
      || document.querySelector('[role="main"]')
      || document.querySelector("#SITE_PAGES")
      || document.querySelector("#PAGES_CONTAINER");
  }

  function categoryControls() {
    if (SITE.categories.length <= 1) return "";
    return `<div class="chips" role="group" aria-label="Filter Knowledge Hub category">
      ${SITE.categories.map((item) => `<button class="chip${item === "all" ? " is-active" : ""}" type="button" data-category="${escapeHtml(item)}">${item === "all" ? "All" : escapeHtml(item)}</button>`).join("")}
    </div>`;
  }

  function createHost(target) {
    if (!target || !isKnowledgeHubPath()) return;
    if (host?.isConnected) return;
    if (host && !host.isConnected) host = null;

    host = document.createElement("section");
    host.id = "vfc-knowledge-hub-search";
    host.setAttribute("aria-label", SITE.ariaLabel);
    host.dataset.brand = SITE.brand;
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display:block; width:100%; box-sizing:border-box; }
        * { box-sizing:border-box; }
        .hidden { display:none !important; }
        .shell {
          width:min(680px, calc(100% - 32px)); margin:22px auto 34px; padding:20px 24px;
          border:2px solid #111; border-radius:16px; background:#fff;
          box-shadow:0 4px 14px rgba(0,0,0,.28); color:#161616;
          font-family:Arial,Helvetica,sans-serif; overflow:hidden;
        }
        .eyebrow { margin:0 0 4px; color:#b30d14; font-size:12px; line-height:1.2; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
        h2 { margin:0; font-size:27px; line-height:1.1; letter-spacing:-.02em; }
        .intro { margin:6px 0 12px; color:#565656; font-size:15px; line-height:1.4; }
        .search-row { display:flex; gap:8px; align-items:stretch; }
        .search-input {
          flex:1 1 auto; min-width:0; min-height:46px; padding:0 15px; border:1.5px solid #cfcfcf; border-radius:11px;
          font:500 16px/1.2 Arial,Helvetica,sans-serif; color:#111; background:#fff; outline:none; touch-action:manipulation;
        }
        .search-input:focus { border-color:#b30d14; box-shadow:0 0 0 3px rgba(179,13,20,.11); }
        .search-button, .action-button {
          border:0; border-radius:999px; background:#111; color:#fff; font:800 13px/1 Arial,Helvetica,sans-serif;
          padding:0 18px; cursor:pointer; min-height:40px; touch-action:manipulation;
        }
        .search-button:hover, .search-button:focus-visible, .action-button:hover, .action-button:focus-visible { background:#b30d14; outline:none; }
        .search-button:disabled { opacity:.6; cursor:wait; }
        .chips { display:flex; flex-wrap:wrap; gap:7px; margin:10px 0 0; }
        .chip { border:1px solid #d6d6d6; border-radius:999px; background:#fff; color:#333; padding:7px 10px; font:700 12px/1 Arial,Helvetica,sans-serif; cursor:pointer; touch-action:manipulation; }
        .chip:hover, .chip:focus-visible { border-color:#b30d14; outline:none; }
        .chip.is-active { background:#151515; color:#fff; border-color:#151515; }
        .status { min-height:18px; margin:7px 0 0; color:#666; font-size:12px; }
        .status:empty { display:none; }
        .results-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:7px; }
        .results-copy { min-width:0; flex:1 1 auto; }
        .results-heading h2 { font-size:22px; }
        .query-label { margin:3px 0 0; color:#666; font-size:12px; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .results-actions { display:flex; flex:0 0 auto; gap:7px; justify-content:flex-end; }
        .action-button { min-height:36px; padding:0 14px; font-size:12px; }
        .action-button.secondary { background:#fff; color:#111; border:1px solid #cfcfcf; }
        .action-button.secondary:hover, .action-button.secondary:focus-visible { border-color:#b30d14; color:#b30d14; background:#fff; }
        .match-list { border-top:1px solid #e1e1e1; }
        .match { display:flex; align-items:center; height:41px; padding:7px 2px; border-bottom:1px solid #e1e1e1; color:#161616; text-decoration:none; font-size:14px; line-height:1.25; font-weight:800; }
        .match::after { content:"›"; margin-left:auto; padding-left:12px; color:#b30d14; font-size:20px; line-height:1; }
        .match:hover, .match:focus-visible { color:#b30d14; outline:none; }
        .match-title { display:block; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .empty-state { height:123px; display:flex; align-items:center; justify-content:center; text-align:center; color:#555; font-size:14px; line-height:1.4; }
        @media (max-width:640px) {
          .shell { width:calc(100% - 20px); margin:14px auto 26px; padding:16px 14px; border-radius:14px; }
          h2 { font-size:23px; }
          .intro { font-size:14px; }
          .search-row { gap:6px; }
          .search-input { min-height:44px; font-size:16px; }
          .search-button { padding:0 13px; font-size:12px; }
          .chips { gap:6px; margin-top:9px; }
          .chip { font-size:11px; padding:6px 8px; }
          .results-heading { gap:7px; }
          .results-heading h2 { font-size:18px; }
          .query-label { font-size:11px; }
          .results-actions { gap:5px; }
          .action-button { min-height:34px; padding:0 10px; font-size:11px; }
          .match { height:40px; font-size:13px; }
        }
      </style>
      <div class="shell">
        <div id="searchView">
          <p class="eyebrow">${escapeHtml(SITE.eyebrow)}</p>
          <h2>${escapeHtml(SITE.title)}</h2>
          <p class="intro">${escapeHtml(SITE.intro)}</p>
          <div class="search-row">
            <input class="search-input" type="search" autocomplete="off" inputmode="search" aria-label="${escapeHtml(SITE.ariaLabel)}" placeholder="Ask a question or search by keyword..." />
            <button class="search-button" type="button">Search</button>
          </div>
          ${categoryControls()}
          <div class="status" role="status" aria-live="polite"></div>
        </div>
        <div id="resultsView" class="hidden">
          <div class="results-heading">
            <div class="results-copy">
              <p class="eyebrow">Top Matches</p>
              <h2>Choose a helpful guide</h2>
              <p class="query-label"></p>
            </div>
            <div class="results-actions">
              <button class="action-button search-again" type="button">Search again</button>
              <button class="action-button secondary cancel-results" type="button">Cancel</button>
            </div>
          </div>
          <div class="match-list"></div>
          <div class="empty-state hidden">No close matches found. Try a shorter phrase or a different keyword.</div>
        </div>
      </div>`;

    input = shadow.querySelector(".search-input");
    searchView = shadow.querySelector("#searchView");
    resultsView = shadow.querySelector("#resultsView");
    status = shadow.querySelector(".status");
    matchList = shadow.querySelector(".match-list");
    emptyState = shadow.querySelector(".empty-state");
    queryLabel = shadow.querySelector(".query-label");
    searchButton = shadow.querySelector(".search-button");

    searchButton.addEventListener("click", runSearch);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runSearch();
      } else if (event.key === "Escape") {
        input.value = "";
        status.textContent = "";
      }
    });
    shadow.querySelector(".search-again").addEventListener("click", () => showSearch(false));
    shadow.querySelector(".cancel-results").addEventListener("click", () => showSearch(true));
    shadow.querySelectorAll(".chip").forEach((button) => {
      button.addEventListener("click", () => {
        category = button.dataset.category || "all";
        shadow.querySelectorAll(".chip").forEach((item) => item.classList.toggle("is-active", item === button));
      });
    });

    target.insertBefore(host, target.firstChild || null);
  }

  function showSearch(clear) {
    requestSequence += 1;
    activeSearch = null;
    searchView?.classList.remove("hidden");
    resultsView?.classList.add("hidden");
    if (matchList) matchList.innerHTML = "";
    emptyState?.classList.add("hidden");
    if (status) status.textContent = "";
    if (clear && input) input.value = "";
    if (window.innerWidth > 640 && window.matchMedia?.("(pointer: fine)")?.matches) {
      try { input?.focus({ preventScroll: true }); } catch { input?.focus(); }
    }
  }

  async function runSearch() {
    if (!input || !matchList || !status || !isKnowledgeHubPath()) return;
    const query = clean(input.value, 200);
    if (query.length < 2) {
      status.textContent = "Enter at least two characters.";
      return;
    }
    const sequence = ++requestSequence;
    searchButton.disabled = true;
    status.textContent = "Searching…";
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query, category, visitor_id: analyticsVisitorForRequest() }),
        credentials: "omit",
      });
      const payload = await response.json();
      if (sequence !== requestSequence || !isKnowledgeHubPath()) return;
      if (!response.ok) throw new Error(payload?.error || "Search failed.");
      activeSearch = payload;
      renderResults(payload, query);
    } catch {
      if (sequence !== requestSequence || !isKnowledgeHubPath()) return;
      activeSearch = null;
      status.textContent = "Search is temporarily unavailable. Please try again.";
    } finally {
      if (sequence === requestSequence && searchButton) searchButton.disabled = false;
    }
  }

  function renderResults(payload, query) {
    const items = (Array.isArray(payload?.results) ? payload.results : []).slice(0, 3);
    if (queryLabel) queryLabel.textContent = category === "all" ? `For “${query}”` : `For “${query}” in ${category}`;
    input?.blur();
    searchView?.classList.add("hidden");
    resultsView?.classList.remove("hidden");
    matchList.innerHTML = "";
    emptyState?.classList.toggle("hidden", items.length > 0);
    if (!items.length) return;
    matchList.innerHTML = items.map((item, index) => `
      <a class="match" href="${escapeHtml(item.url)}" data-article-id="${escapeHtml(item.id)}" data-rank="${index + 1}" title="${escapeHtml(item.title)}">
        <span class="match-title">${escapeHtml(item.title)}</span>
      </a>`).join("");
    matchList.querySelectorAll(".match").forEach((link) => link.addEventListener("click", recordSelection));
  }

  function recordSelection(event) {
    const link = event.currentTarget;
    if (!activeSearch?.search_request_id) return;
    const body = {
      action: "select",
      search_request_id: activeSearch.search_request_id,
      query: clean(input?.value, 200),
      category,
      article_id: link.dataset.articleId,
      rank: Number(link.dataset.rank),
      visitor_id: analyticsVisitorForRequest(),
    };
    try {
      fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Search analytics must never block navigation to an article.
    }
  }

  function resetRefs() {
    host = null;
    shadow = null;
    input = null;
    searchView = null;
    resultsView = null;
    status = null;
    matchList = null;
    emptyState = null;
    queryLabel = null;
    searchButton = null;
    activeSearch = null;
    category = "all";
  }

  function teardown() {
    targetObserver?.disconnect();
    targetObserver = null;
    requestSequence += 1;
    host?.remove();
    resetRefs();
  }

  function mount() {
    if (!isKnowledgeHubPath() || host?.isConnected) return;
    if (host && !host.isConnected) resetRefs();
    const target = pageTarget();
    if (target) {
      createHost(target);
      return;
    }
    if (targetObserver) return;
    targetObserver = new MutationObserver(() => {
      if (!isKnowledgeHubPath()) return;
      const next = pageTarget();
      if (!next) return;
      targetObserver.disconnect();
      targetObserver = null;
      createHost(next);
    });
    targetObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function syncRoute() {
    internalAnalyticsTestEnabled();
    if (isKnowledgeHubPath()) mount();
    else if (host || targetObserver) teardown();
  }

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.setInterval(syncRoute, 700);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRoute, { once: true });
  else syncRoute();
})();