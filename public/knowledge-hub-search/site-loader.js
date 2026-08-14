(() => {
  "use strict";

  if (window.__VFC_KNOWLEDGE_HUB_SEARCH__) return;
  window.__VFC_KNOWLEDGE_HUB_SEARCH__ = true;

  const ANALYTICS_SESSION_KEY = "vfc_ai_assistant_analytics_session_v1";
  const SCRIPT_ORIGIN = (() => {
    try {
      return new URL(document.currentScript?.src || "https://marketing-crm-six.vercel.app").origin;
    } catch {
      return "https://marketing-crm-six.vercel.app";
    }
  })();
  const API_URL = `${SCRIPT_ORIGIN}/api/public-knowledge-hub-search`;
  const CATEGORIES = [
    "all",
    "Van Finance",
    "Rent2Buy",
    "Credit",
    "Vehicle Guides",
    "FAQs",
    "Business Advice",
    "Self Employed",
  ];

  let host = null;
  let shadow = null;
  let input = null;
  let results = null;
  let status = null;
  let category = "all";
  let timer = null;
  let requestSequence = 0;
  let activeSearch = null;
  let targetObserver = null;
  const visitorId = analyticsVisitorId();

  function clean(value, limit = 5000) {
    return String(value || "").trim().slice(0, limit);
  }

  function isKnowledgeHubPath() {
    const normalisedPath = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
    return normalisedPath === "/knowledge-hub";
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

  function createHost(target) {
    if (!target || !isKnowledgeHubPath()) return;
    if (host?.isConnected) return;
    if (host && !host.isConnected) host = null;

    host = document.createElement("section");
    host.id = "vfc-knowledge-hub-search";
    host.setAttribute("aria-label", "Search the Knowledge Hub");
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display:block; width:100%; box-sizing:border-box; }
        * { box-sizing:border-box; }
        .shell {
          width:min(1120px, calc(100% - 32px)); margin:22px auto 34px; padding:28px;
          border:1px solid #e6e6e6; border-radius:18px; background:#fff;
          box-shadow:0 12px 34px rgba(0,0,0,.07); color:#161616;
          font-family:Arial,Helvetica,sans-serif;
        }
        .eyebrow { margin:0 0 7px; color:#b30d14; font-size:12px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; }
        h2 { margin:0; font-size:clamp(24px,3vw,34px); line-height:1.12; letter-spacing:-.025em; }
        .intro { margin:9px 0 18px; color:#565656; font-size:16px; line-height:1.5; }
        .search-input {
          width:100%; min-height:52px; padding:0 16px; border:1.5px solid #cfcfcf; border-radius:12px;
          font:500 16px/1.2 Arial,Helvetica,sans-serif; color:#111; background:#fff; outline:none;
        }
        .search-input:focus { border-color:#b30d14; box-shadow:0 0 0 3px rgba(179,13,20,.11); }
        .chips { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 0; }
        .chip {
          border:1px solid #d6d6d6; border-radius:999px; background:#fff; color:#333; padding:8px 12px;
          font:700 13px/1 Arial,Helvetica,sans-serif; cursor:pointer;
        }
        .chip:hover, .chip:focus-visible { border-color:#b30d14; outline:none; }
        .chip.is-active { background:#151515; color:#fff; border-color:#151515; }
        .status { min-height:22px; margin:16px 0 0; color:#666; font-size:14px; }
        .results { display:grid; gap:10px; margin-top:8px; }
        .result {
          display:block; padding:16px 17px; border:1px solid #e1e1e1; border-radius:13px;
          color:inherit; text-decoration:none; background:#fff; transition:border-color .14s ease, transform .14s ease, box-shadow .14s ease;
        }
        .result:hover, .result:focus-visible { border-color:#b30d14; transform:translateY(-1px); box-shadow:0 7px 20px rgba(0,0,0,.06); outline:none; }
        .result-meta { color:#b30d14; font-size:12px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; }
        .result-title { margin:5px 0 5px; font-size:18px; line-height:1.28; font-weight:800; }
        .result-excerpt { margin:0; color:#5b5b5b; font-size:14px; line-height:1.5; }
        .empty { padding:16px; border-radius:12px; background:#f7f7f7; color:#4a4a4a; font-size:14px; line-height:1.45; }
        @media (max-width:640px) {
          .shell { width:calc(100% - 20px); margin:14px auto 26px; padding:20px 16px; border-radius:15px; }
          .intro { font-size:15px; }
          .search-input { min-height:50px; font-size:16px; }
          .chips { gap:7px; }
          .chip { padding:8px 10px; font-size:12px; }
          .result { padding:14px; }
          .result-title { font-size:17px; }
        }
      </style>
      <div class="shell">
        <p class="eyebrow">Knowledge Hub</p>
        <h2>What do you need help with?</h2>
        <p class="intro">Ask a question or search by keyword to find practical guides from Van Finance Company.</p>
        <input class="search-input" type="search" autocomplete="off" inputmode="search" aria-label="Search Knowledge Hub" placeholder="Ask a question or search by keyword..." />
        <div class="chips" role="group" aria-label="Filter Knowledge Hub category">
          ${CATEGORIES.map((item) => `<button class="chip${item === "all" ? " is-active" : ""}" type="button" data-category="${escapeHtml(item)}">${item === "all" ? "All" : escapeHtml(item)}</button>`).join("")}
        </div>
        <div class="status" role="status" aria-live="polite"></div>
        <div class="results"></div>
      </div>`;
    input = shadow.querySelector(".search-input");
    results = shadow.querySelector(".results");
    status = shadow.querySelector(".status");
    input.addEventListener("input", scheduleSearch);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        input.value = "";
        clearSearch();
      }
    });
    shadow.querySelectorAll(".chip").forEach((button) => {
      button.addEventListener("click", () => {
        category = button.dataset.category || "all";
        shadow.querySelectorAll(".chip").forEach((item) => item.classList.toggle("is-active", item === button));
        if (clean(input.value, 200).length >= 2) runSearch();
      });
    });
    target.insertBefore(host, target.firstChild || null);
  }

  function clearSearch() {
    requestSequence += 1;
    activeSearch = null;
    if (status) status.textContent = "";
    if (results) results.innerHTML = "";
  }

  function scheduleSearch() {
    window.clearTimeout(timer);
    const query = clean(input?.value, 200);
    if (query.length < 2) {
      clearSearch();
      return;
    }
    timer = window.setTimeout(runSearch, 280);
  }

  async function runSearch() {
    if (!input || !results || !status || !isKnowledgeHubPath()) return;
    const query = clean(input.value, 200);
    if (query.length < 2) return clearSearch();
    const sequence = ++requestSequence;
    status.textContent = "Searching…";
    results.innerHTML = "";
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query, category, visitor_id: visitorId }),
        credentials: "omit",
      });
      const payload = await response.json();
      if (sequence !== requestSequence || !isKnowledgeHubPath()) return;
      if (!response.ok) throw new Error(payload?.error || "Search failed.");
      activeSearch = payload;
      renderResults(payload);
    } catch {
      if (sequence !== requestSequence || !isKnowledgeHubPath()) return;
      activeSearch = null;
      status.textContent = "Search is temporarily unavailable. Please try again.";
      results.innerHTML = "";
    }
  }

  function renderResults(payload) {
    const items = Array.isArray(payload?.results) ? payload.results : [];
    if (!items.length) {
      status.textContent = "No close matches found.";
      results.innerHTML = '<div class="empty">Try a shorter phrase, a different keyword, or choose another category.</div>';
      return;
    }
    status.textContent = `${items.length} helpful ${items.length === 1 ? "result" : "results"}`;
    results.innerHTML = items.map((item, index) => `
      <a class="result" href="${escapeHtml(item.url)}" data-article-id="${escapeHtml(item.id)}" data-rank="${index + 1}">
        <div class="result-meta">${escapeHtml(item.category)}</div>
        <div class="result-title">${escapeHtml(item.title)}</div>
        ${item.excerpt ? `<p class="result-excerpt">${escapeHtml(item.excerpt)}</p>` : ""}
      </a>`).join("");
    results.querySelectorAll(".result").forEach((link) => link.addEventListener("click", recordSelection));
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
      visitor_id: visitorId,
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
    results = null;
    status = null;
    activeSearch = null;
    category = "all";
  }

  function teardown() {
    window.clearTimeout(timer);
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
    if (isKnowledgeHubPath()) mount();
    else if (host || targetObserver) teardown();
  }

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.setInterval(syncRoute, 700);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRoute, { once: true });
  else syncRoute();
})();
