(() => {
  "use strict";

  if (window.__VFC_KNOWLEDGE_HUB_SEARCH__) return;
  window.__VFC_KNOWLEDGE_HUB_SEARCH__ = true;

  const VFC_HOSTS = new Set(["vanfinancecompany.co.uk", "www.vanfinancecompany.co.uk"]);
  const PATH = "/knowledge-hub";
  const API_URL = (() => {
    try { return `${new URL(document.currentScript?.src || "https://marketing-crm-six.vercel.app").origin}/api/public-knowledge-hub-search`; }
    catch { return "https://marketing-crm-six.vercel.app/api/public-knowledge-hub-search"; }
  })();
  const SESSION_KEY = "vfc_ai_assistant_analytics_session_v1";
  const INTERNAL_KEY = "vfc_internal_analytics_v1";
  const INTERNAL_PARAM = "vfc_internal_test";
  const INTERNAL_PREFIX = "internal:";
  const CATEGORIES = ["all", "Van Finance", "Rent2Buy", "Credit", "Vehicle Guides", "FAQs", "Business Advice", "Self Employed"];

  let host = null;
  let shadow = null;
  let input = null;
  let status = null;
  let matchList = null;
  let searchView = null;
  let resultsView = null;
  let queryLabel = null;
  let emptyState = null;
  let searchButton = null;
  let category = "all";
  let requestSequence = 0;
  let activeSearch = null;
  let observer = null;
  let routeTimer = null;

  const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
  const escapeHtml = (value) => clean(value, 2000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  function isVfcKnowledgeHub() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    const path = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
    return VFC_HOSTS.has(hostname) && path.toLowerCase() === PATH;
  }

  function visitorId() {
    try {
      const existing = clean(sessionStorage.getItem(SESSION_KEY), 160);
      if (existing) return existing;
      const generated = crypto?.randomUUID?.() || `knowledge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(SESSION_KEY, generated);
      return generated;
    } catch {
      return crypto?.randomUUID?.() || `knowledge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  const visitor = visitorId();

  function internalTestEnabled() {
    let requested = "";
    try { requested = clean(new URL(window.location.href).searchParams.get(INTERNAL_PARAM), 20).toLowerCase(); } catch {}
    try {
      if (["1", "true", "yes", "on"].includes(requested)) localStorage.setItem(INTERNAL_KEY, "1");
      if (["0", "false", "no", "off"].includes(requested)) localStorage.removeItem(INTERNAL_KEY);
      return localStorage.getItem(INTERNAL_KEY) === "1";
    } catch {
      return ["1", "true", "yes", "on"].includes(requested);
    }
  }

  function analyticsVisitor() {
    return internalTestEnabled() && !visitor.startsWith(INTERNAL_PREFIX) ? `${INTERNAL_PREFIX}${visitor}` : visitor;
  }

  function pageTarget() {
    return document.querySelector("main") || document.querySelector('[role="main"]') || document.querySelector("#SITE_PAGES") || document.querySelector("#PAGES_CONTAINER");
  }

  function createHost(target) {
    if (!target || !isVfcKnowledgeHub() || host?.isConnected) return;
    host = document.createElement("section");
    host.id = "vfc-knowledge-hub-search";
    host.setAttribute("aria-label", "Search the Knowledge Hub");
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host{display:block;width:100%;box-sizing:border-box}*{box-sizing:border-box}.hidden{display:none!important}
        .shell{width:min(680px,calc(100% - 32px));margin:22px auto 34px;padding:20px 24px;border:2px solid #111;border-radius:16px;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.28);color:#161616;font-family:Arial,Helvetica,sans-serif;overflow:hidden}
        .eyebrow{margin:0 0 4px;color:#b30d14;font-size:12px;line-height:1.2;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h2{margin:0;font-size:27px;line-height:1.1;letter-spacing:-.02em}.intro{margin:6px 0 12px;color:#565656;font-size:15px;line-height:1.4}
        .search-row{display:flex;gap:8px;align-items:stretch}.search-input{flex:1 1 auto;min-width:0;min-height:46px;padding:0 15px;border:1.5px solid #cfcfcf;border-radius:11px;font:500 16px/1.2 Arial,Helvetica,sans-serif;color:#111;background:#fff;outline:none}.search-input:focus{border-color:#b30d14;box-shadow:0 0 0 3px rgba(179,13,20,.11)}
        .search-button,.action-button{border:0;border-radius:999px;background:#111;color:#fff;font:800 13px/1 Arial,Helvetica,sans-serif;padding:0 18px;cursor:pointer;min-height:40px}.search-button:hover,.action-button:hover{background:#b30d14}.search-button:disabled{opacity:.6;cursor:wait}
        .chips{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 0}.chip{border:1px solid #d6d6d6;border-radius:999px;background:#fff;color:#333;padding:7px 10px;font:700 12px/1 Arial,Helvetica,sans-serif;cursor:pointer}.chip.is-active{background:#151515;color:#fff;border-color:#151515}.status{min-height:18px;margin:7px 0 0;color:#666;font-size:12px}.status:empty{display:none}
        .results-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:7px}.results-copy{min-width:0;flex:1 1 auto}.results-heading h2{font-size:22px}.query-label{margin:3px 0 0;color:#666;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.results-actions{display:flex;gap:7px}.action-button{min-height:36px;padding:0 14px;font-size:12px}.action-button.secondary{background:#fff;color:#111;border:1px solid #cfcfcf}
        .match-list{border-top:1px solid #e1e1e1}.match{display:flex;align-items:center;height:41px;padding:7px 2px;border-bottom:1px solid #e1e1e1;color:#161616;text-decoration:none;font-size:14px;line-height:1.25;font-weight:800}.match::after{content:"›";margin-left:auto;padding-left:12px;color:#b30d14;font-size:20px}.match-title{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.empty-state{height:123px;display:flex;align-items:center;justify-content:center;text-align:center;color:#555;font-size:14px}
        @media(max-width:640px){.shell{width:calc(100% - 20px);margin:14px auto 26px;padding:16px 14px;border-radius:14px}h2{font-size:23px}.intro{font-size:14px}.search-row{gap:6px}.search-button{padding:0 13px;font-size:12px}.results-heading h2{font-size:18px}.action-button{padding:0 10px;font-size:11px}.match{height:40px;font-size:13px}}
      </style>
      <div class="shell">
        <div id="searchView"><p class="eyebrow">Knowledge Hub</p><h2>What do you need help with?</h2><p class="intro">Ask a question or search by keyword to find practical guides from Van Finance Company.</p><div class="search-row"><input class="search-input" type="search" autocomplete="off" inputmode="search" aria-label="Search the Knowledge Hub" placeholder="Ask a question or search by keyword..."><button class="search-button" type="button">Search</button></div><div class="chips">${CATEGORIES.map((item) => `<button class="chip${item === "all" ? " is-active" : ""}" type="button" data-category="${escapeHtml(item)}">${item === "all" ? "All" : escapeHtml(item)}</button>`).join("")}</div><div class="status" role="status" aria-live="polite"></div></div>
        <div id="resultsView" class="hidden"><div class="results-heading"><div class="results-copy"><p class="eyebrow">Top Matches</p><h2>Choose a helpful guide</h2><p class="query-label"></p></div><div class="results-actions"><button class="action-button search-again" type="button">Search again</button><button class="action-button secondary cancel-results" type="button">Cancel</button></div></div><div class="match-list"></div><div class="empty-state hidden">No close matches found. Try a shorter phrase or a different category.</div></div>
      </div>`;

    input = shadow.querySelector(".search-input"); status = shadow.querySelector(".status"); matchList = shadow.querySelector(".match-list"); searchView = shadow.querySelector("#searchView"); resultsView = shadow.querySelector("#resultsView"); queryLabel = shadow.querySelector(".query-label"); emptyState = shadow.querySelector(".empty-state"); searchButton = shadow.querySelector(".search-button");
    searchButton.addEventListener("click", runSearch);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") runSearch(); else if (event.key === "Escape") { input.value = ""; status.textContent = ""; } });
    shadow.querySelector(".search-again").addEventListener("click", () => showSearch(false));
    shadow.querySelector(".cancel-results").addEventListener("click", () => showSearch(true));
    shadow.querySelectorAll(".chip").forEach((button) => button.addEventListener("click", () => { category = button.dataset.category || "all"; shadow.querySelectorAll(".chip").forEach((item) => item.classList.toggle("is-active", item === button)); }));
    target.insertBefore(host, target.firstChild || null);
  }

  function showSearch(clear) { requestSequence += 1; activeSearch = null; searchView?.classList.remove("hidden"); resultsView?.classList.add("hidden"); matchList.innerHTML = ""; emptyState?.classList.add("hidden"); status.textContent = ""; if (clear) input.value = ""; }

  async function runSearch() {
    const query = clean(input?.value, 200); if (query.length < 2) { status.textContent = "Enter at least two characters."; return; }
    const sequence = ++requestSequence; searchButton.disabled = true; status.textContent = "Searching…";
    try {
      const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "search", query, category, visitor_id: analyticsVisitor() }), credentials: "omit" });
      const payload = await response.json(); if (sequence !== requestSequence || !isVfcKnowledgeHub()) return; if (!response.ok) throw new Error(); activeSearch = payload; renderResults(payload, query);
    } catch { if (sequence === requestSequence) status.textContent = "Search is temporarily unavailable. Please try again."; }
    finally { if (sequence === requestSequence) searchButton.disabled = false; }
  }

  function renderResults(payload, query) {
    const items = (Array.isArray(payload?.results) ? payload.results : []).slice(0, 3); queryLabel.textContent = category === "all" ? `For “${query}”` : `For “${query}” in ${category}`; input.blur(); searchView.classList.add("hidden"); resultsView.classList.remove("hidden"); matchList.innerHTML = ""; emptyState.classList.toggle("hidden", items.length > 0);
    matchList.innerHTML = items.map((item, index) => `<a class="match" href="${escapeHtml(item.url)}" data-article-id="${escapeHtml(item.id)}" data-rank="${index + 1}"><span class="match-title">${escapeHtml(item.title)}</span></a>`).join("");
    matchList.querySelectorAll(".match").forEach((link) => link.addEventListener("click", recordSelection));
  }

  function recordSelection(event) {
    const link = event.currentTarget; if (!activeSearch?.search_request_id) return;
    try { fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "select", search_request_id: activeSearch.search_request_id, query: clean(input?.value, 200), category, article_id: link.dataset.articleId, rank: Number(link.dataset.rank), visitor_id: analyticsVisitor() }), credentials: "omit", keepalive: true }).catch(() => {}); } catch { /* Search analytics must never block navigation to an article. */ }
  }

  function reset() { host = shadow = input = status = matchList = searchView = resultsView = queryLabel = emptyState = searchButton = activeSearch = null; category = "all"; }
  function teardown() { observer?.disconnect(); observer = null; requestSequence += 1; host?.remove(); reset(); }
  function mount() { if (!isVfcKnowledgeHub() || host?.isConnected) return; const target = pageTarget(); if (target) return createHost(target); if (observer) return; observer = new MutationObserver(() => { const next = pageTarget(); if (next && isVfcKnowledgeHub()) { observer.disconnect(); observer = null; createHost(next); } }); observer.observe(document.documentElement, { childList: true, subtree: true }); }
  function syncRoute() { internalTestEnabled(); if (isVfcKnowledgeHub()) mount(); else if (host || observer) teardown(); }

  function startRouteMonitoring() { if (routeTimer !== null || document.hidden) return; routeTimer = window.setInterval(syncRoute, 700); }
  function stopRouteMonitoring() { if (routeTimer === null) return; window.clearInterval(routeTimer); routeTimer = null; }
  function syncPageVisibility() { if (document.hidden) return stopRouteMonitoring(); syncRoute(); startRouteMonitoring(); }

  window.addEventListener("popstate", syncRoute); window.addEventListener("hashchange", syncRoute); document.addEventListener("visibilitychange", syncPageVisibility); startRouteMonitoring();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRoute, { once: true }); else syncRoute();
})();
