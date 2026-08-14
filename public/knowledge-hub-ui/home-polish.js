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
        min-height: 0 !important;
        height: auto !important;
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
      [data-vfc-kh-category-link="true"] {
        width: auto !important;
        max-width: none !important;
        min-width: 0 !important;
        margin: 6px 8px !important;
        padding: 9px 15px !important;
        overflow: visible !important;
        text-overflow: clip !important;
        text-decoration: none !important;
      }
      [data-vfc-kh-category-link="true"] *,
      [data-vfc-kh-category-link="true"] span {
        width: auto !important;
        max-width: none !important;
        overflow: visible !important;
        text-overflow: clip !important;
        text-decoration: none !important;
        white-space: nowrap !important;
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
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,p,section"))
      .filter((element) => !element.closest("#vfc-knowledge-hub-search"))
      .filter((element) => /welcome to the van finance company knowledge hub/i.test(clean(element.textContent, 1000)))
      .sort((a, b) => clean(a.textContent, 1000).length - clean(b.textContent, 1000).length);

    const welcome = candidates[0] || null;
    if (!welcome) return null;

    let current = welcome;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const text = clean(current.innerText || current.textContent, 1400);
      if (!text || text.length > 1200) continue;
      const hasHeading = /van finance company\s*[-–]?\s*knowledge hub/i.test(text);
      const categoryLinks = current.querySelectorAll?.('a[href*="/knowledge-hub-category/"]').length || 0;
      const articleLinks = current.querySelectorAll?.('a[href*="/knowledge-hub-articles/"]').length || 0;
      const containsSearch = Boolean(current.querySelector?.("#vfc-knowledge-hub-search"));
      if (hasHeading && categoryLinks === 0 && articleLinks === 0 && !containsSearch) return current;
    }
    return welcome.parentElement || welcome;
  }

  function findBackControl(root) {
    const candidates = Array.from((root || document).querySelectorAll?.("a,button,[role=\"button\"]") || []);
    return candidates.find((element) => /^\s*(?:←\s*)?back\s*$/i.test(clean(element.textContent, 40))) || null;
  }

  function tightBackWrap(control, boundary) {
    if (!control) return null;
    let current = control;
    let best = control;
    for (let depth = 0; current && current !== boundary && depth < 4; depth += 1, current = current.parentElement) {
      const text = clean(current.innerText || current.textContent, 100);
      if (text && text.length <= 45) best = current;
      else break;
    }
    return best;
  }

  function tuneSearch(host) {
    const shadow = host?.shadowRoot;
    const shell = shadow?.querySelector?.(".shell");
    if (!shadow || !shell) return false;

    host.style.setProperty("min-height", "0", "important");
    host.style.setProperty("height", "auto", "important");

    let style = shadow.getElementById?.(SEARCH_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = SEARCH_STYLE_ID;
      style.textContent = `
        .shell {
          width: min(820px, calc(100% - 32px)) !important;
          margin: 24px auto 26px !important;
          padding: 24px 28px 18px !important;
          min-height: 0 !important;
          height: auto !important;
          max-height: none !important;
        }
        .chips {
          margin: 12px 0 0 !important;
        }
        .status:empty {
          display: none !important;
          min-height: 0 !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .results:empty {
          display: none !important;
          min-height: 0 !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
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

    const back = findBackControl(intro);
    const backWrap = tightBackWrap(back, intro);
    if (backWrap && backWrap !== intro) {
      if (backWrap.previousElementSibling !== host) backWrap.insertAdjacentElement("beforebegin", host);
    } else if (intro.nextElementSibling !== host) {
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