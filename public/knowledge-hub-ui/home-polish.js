(() => {
  "use strict";

  if (window.__VFC_KNOWLEDGE_HUB_HOME_POLISH__) return;
  window.__VFC_KNOWLEDGE_HUB_HOME_POLISH__ = true;

  const STYLE_ID = "vfc-kh-home-polish-style";
  const SEARCH_STYLE_ID = "vfc-kh-home-search-polish";
  let observer = null;
  let timer = null;

  function clean(value, limit = 1200) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function isHubHome() {
    const path = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
    return path === "/knowledge-hub";
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #vfc-knowledge-hub-search {
        margin: 0 !important;
      }
      [data-vfc-kh-card-root="true"],
      [data-vfc-kh-card-wrap="true"] {
        overflow: visible !important;
      }
      .vfc-kh-modern-card {
        box-sizing: border-box !important;
        border-color: #d9d9d9 !important;
        box-shadow: 0 6px 18px rgba(0,0,0,.10) !important;
        transform: none !important;
      }
      .vfc-kh-modern-card:hover,
      .vfc-kh-modern-card:focus-visible {
        border-color: #b30d14 !important;
        box-shadow: 0 0 0 1px rgba(179,13,20,.9), 0 9px 24px rgba(0,0,0,.12) !important;
        transform: none !important;
      }
      .vfc-kh-modern-card__meta {
        font-size: 13px !important;
      }
      .vfc-kh-modern-card__title {
        font-size: 20px !important;
        line-height: 1.3 !important;
      }
      .vfc-kh-modern-card__excerpt {
        font-size: 18px !important;
        line-height: 1.45 !important;
      }
      .vfc-kh-modern-card__count {
        font-size: 16px !important;
      }
      @media (max-width: 768px) {
        .vfc-kh-modern-card__title { font-size: 18px !important; }
        .vfc-kh-modern-card__excerpt { font-size: 16px !important; }
        .vfc-kh-modern-card__count { font-size: 14px !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function removeStyle() {
    document.getElementById(STYLE_ID)?.remove();
  }

  function findIntroRoot() {
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,p,section"));
    const heading = candidates.find((element) => {
      const text = clean(element.textContent, 120).toLowerCase();
      return text.includes("van finance company") && text.includes("knowledge hub") && text.length <= 90;
    });
    if (!heading) return null;

    let current = heading;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const text = clean(current.innerText || current.textContent, 1400);
      if (text.length > 1200) continue;
      const hasWelcome = /welcome to the van finance company knowledge hub/i.test(text);
      const categoryLinks = current.querySelectorAll?.('a[href*="/knowledge-hub-category/"]').length || 0;
      if (hasWelcome && categoryLinks === 0) return current;
    }
    return null;
  }

  function tuneSearch(host) {
    const shadow = host?.shadowRoot;
    const shell = shadow?.querySelector?.(".shell");
    if (!shadow || !shell) return false;

    let style = shadow.getElementById?.(SEARCH_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = SEARCH_STYLE_ID;
      style.textContent = `
        .shell {
          width: min(820px, calc(100% - 32px)) !important;
          margin: 28px auto !important;
          padding: 28px !important;
          min-height: 0 !important;
        }
        .status:empty {
          display: none !important;
          min-height: 0 !important;
          margin: 0 !important;
        }
        .results:empty {
          display: none !important;
          margin: 0 !important;
        }
      `;
      shadow.appendChild(style);
    }
    return true;
  }

  function moveSearchAfterIntro() {
    const host = document.getElementById("vfc-knowledge-hub-search");
    const intro = findIntroRoot();
    if (!host || !intro || intro.contains(host)) return false;

    if (intro.nextElementSibling !== host) {
      intro.insertAdjacentElement("afterend", host);
    }
    tuneSearch(host);
    return true;
  }

  function apply() {
    if (!isHubHome()) return;
    ensureStyle();
    moveSearchAfterIntro();
  }

  function teardown() {
    removeStyle();
    observer?.disconnect();
    observer = null;
  }

  function scheduleApply() {
    window.clearTimeout(timer);
    timer = window.setTimeout(apply, 70);
  }

  function syncRoute() {
    if (!isHubHome()) {
      teardown();
      return;
    }
    apply();
    if (!observer) {
      observer = new MutationObserver(scheduleApply);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("resize", scheduleApply, { passive: true });
  window.setInterval(syncRoute, 700);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncRoute, { once: true });
  } else {
    syncRoute();
  }
})();
