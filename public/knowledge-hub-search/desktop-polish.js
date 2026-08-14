(() => {
  "use strict";

  if (window.__VFC_KNOWLEDGE_HUB_DESKTOP_POLISH__) return;
  window.__VFC_KNOWLEDGE_HUB_DESKTOP_POLISH__ = true;

  const DESKTOP_QUERY = "(min-width: 769px)";
  const STYLE_ID = "vfc-kh-desktop-polish-style";
  let observer = null;
  let timer = null;

  function clean(value, limit = 300) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function isKnowledgeHubPath() {
    const normalisedPath = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
    return normalisedPath === "/knowledge-hub";
  }

  function isDesktop() {
    return Boolean(window.matchMedia?.(DESKTOP_QUERY).matches);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @media (min-width: 769px) {
        [data-vfc-kh-back="true"] {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: auto !important;
          min-width: 0 !important;
          min-height: 34px !important;
          padding: 6px 10px !important;
          margin: 0 !important;
          border: 1px solid #d5d5d5 !important;
          border-radius: 999px !important;
          background: #fff !important;
          color: #111 !important;
          font: 700 14px/1.1 Arial, Helvetica, sans-serif !important;
          text-decoration: none !important;
          cursor: pointer !important;
          box-shadow: none !important;
        }
        [data-vfc-kh-back="true"]:hover,
        [data-vfc-kh-back="true"]:focus-visible {
          border-color: #b30d14 !important;
          outline: none !important;
        }
        [data-vfc-kh-category-link="true"] {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          min-height: 38px !important;
          padding: 8px 13px !important;
          margin: 4px 5px !important;
          border: 1px solid #d6d6d6 !important;
          border-radius: 999px !important;
          background: #fff !important;
          color: #111 !important;
          font: 700 15px/1.15 Arial, Helvetica, sans-serif !important;
          text-decoration: none !important;
          white-space: nowrap !important;
          box-shadow: none !important;
        }
        [data-vfc-kh-category-link="true"]:hover,
        [data-vfc-kh-category-link="true"]:focus-visible {
          border-color: #b30d14 !important;
          color: #b30d14 !important;
          outline: none !important;
        }
        [data-vfc-kh-category-links="true"] svg,
        [data-vfc-kh-category-links="true"] img {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function tightenSearchWidth() {
    const searchHost = document.getElementById("vfc-knowledge-hub-search");
    const shell = searchHost?.shadowRoot?.querySelector?.(".shell");
    if (!shell) return false;
    shell.style.width = "min(820px, calc(100% - 32px))";
    return true;
  }

  function findBackControl() {
    const candidates = Array.from(document.querySelectorAll("a,button,[role=\"button\"]"));
    return candidates.find((element) => {
      const text = clean(element.textContent, 40).toLowerCase();
      if (!text || text.length > 18) return false;
      return /^back(?:\s*[<‹«←]+)?$/.test(text);
    }) || null;
  }

  function polishBackControl() {
    const control = findBackControl();
    if (!control) return false;
    control.dataset.vfcKhBack = "true";
    control.setAttribute("aria-label", "Go back to the previous page");
    if (clean(control.textContent, 40) !== "← Back") control.textContent = "← Back";
    if (control.dataset.vfcKhBackBound !== "true") {
      control.dataset.vfcKhBackBound = "true";
      control.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (window.history.length > 1) window.history.back();
        else window.location.assign("/");
      }, true);
    }
    return true;
  }

  function findCategoriesHeading() {
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,div,span"));
    return candidates.find((element) => clean(element.textContent, 80) === "Knowledge Hub Categories") || null;
  }

  function tightCategoryRoot(heading) {
    let current = heading?.parentElement || null;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const anchors = current.querySelectorAll("a").length;
      if (anchors >= 8 && anchors <= 20) return current;
    }
    return null;
  }

  function hideArrowOnlyElements(root) {
    if (!root) return;
    root.querySelectorAll("svg,img").forEach((element) => {
      element.style.setProperty("display", "none", "important");
    });
    root.querySelectorAll("span,div,p").forEach((element) => {
      const text = clean(element.textContent, 20);
      if (/^(?:>|›|»|<|‹|«){1,4}$/.test(text)) {
        element.style.setProperty("display", "none", "important");
      }
    });
  }

  function polishCategoryLinks() {
    const heading = findCategoriesHeading();
    const root = tightCategoryRoot(heading);
    if (!heading || !root) return false;
    root.dataset.vfcKhCategoryLinks = "true";
    const links = Array.from(root.querySelectorAll("a"));
    links.forEach((link) => {
      link.dataset.vfcKhCategoryLink = "true";
      link.removeAttribute("style");
    });
    hideArrowOnlyElements(root);
    return links.length > 0;
  }

  function applyDesktopPolish() {
    if (!isKnowledgeHubPath() || !isDesktop()) return;
    ensureStyle();
    tightenSearchWidth();
    polishBackControl();
    polishCategoryLinks();
  }

  function scheduleApply() {
    window.clearTimeout(timer);
    timer = window.setTimeout(applyDesktopPolish, 60);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function syncRoute() {
    if (isKnowledgeHubPath()) {
      applyDesktopPolish();
      startObserver();
    }
  }

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("resize", scheduleApply, { passive: true });
  window.setInterval(syncRoute, 700);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRoute, { once: true });
  else syncRoute();
})();
