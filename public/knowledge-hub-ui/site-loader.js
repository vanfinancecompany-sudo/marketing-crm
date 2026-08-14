(() => {
  "use strict";

  if (window.__VFC_KNOWLEDGE_HUB_UI_POLISH__) return;
  window.__VFC_KNOWLEDGE_HUB_UI_POLISH__ = true;

  const STYLE_ID = "vfc-kh-ui-polish-style";
  const DESKTOP_QUERY = "(min-width: 769px)";
  const CATEGORY_LABELS = {
    "van-finance": "Van Finance",
    "finance-guides": "Van Finance",
    "rent2buy": "Rent2Buy",
    "about-rent2buy": "Rent2Buy",
    "credit": "Credit",
    "finance-and-credit": "Credit",
    "vehicle-guides": "Vehicle Guides",
    "faqs": "FAQs",
    "finance-faqs": "FAQs",
    "business-advice": "Business Advice",
    "self-employed": "Self Employed",
    "limited-companies": "Limited Companies",
    "trades": "Finance for Trades",
    "finance-for-trades": "Finance for Trades",
    "comparisons": "Comparisons",
    "compare-van-options": "Comparisons",
  };

  let observer = null;
  let timer = null;

  function clean(value, limit = 1000) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function normalisedPath() {
    return String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
  }

  function hubMode() {
    const path = normalisedPath();
    if (path === "/knowledge-hub") return "hub";
    if (path.startsWith("/knowledge-hub-category/")) return "category";
    if (path.startsWith("/knowledge-hub-articles/")) return "article";
    return null;
  }

  function isDesktop() {
    return Boolean(window.matchMedia?.(DESKTOP_QUERY).matches);
  }

  function escapeHtml(value) {
    return clean(value, 2000)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [data-vfc-kh-card-root="true"] {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        overflow: visible !important;
      }
      [data-vfc-kh-card-root="true"] > :not(.vfc-kh-modern-card) {
        display: none !important;
      }
      [data-vfc-kh-card-wrap="true"] {
        min-height: 0 !important;
        height: auto !important;
        max-height: none !important;
      }
      .vfc-kh-modern-card {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        height: auto !important;
        padding: 16px 17px !important;
        border: 1px solid #e1e1e1 !important;
        border-radius: 13px !important;
        background: #fff !important;
        color: #161616 !important;
        text-decoration: none !important;
        box-shadow: none !important;
        font-family: Arial, Helvetica, sans-serif !important;
        transition: border-color .14s ease, transform .14s ease, box-shadow .14s ease !important;
        cursor: pointer !important;
      }
      .vfc-kh-modern-card:hover,
      .vfc-kh-modern-card:focus-visible {
        border-color: #b30d14 !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 7px 20px rgba(0,0,0,.06) !important;
        outline: none !important;
      }
      .vfc-kh-modern-card__meta {
        display: block !important;
        margin: 0 0 5px !important;
        color: #b30d14 !important;
        font: 800 11px/1.2 Arial, Helvetica, sans-serif !important;
        letter-spacing: .05em !important;
        text-transform: uppercase !important;
      }
      .vfc-kh-modern-card__title {
        display: block !important;
        margin: 0 !important;
        color: #161616 !important;
        font: 800 17px/1.28 Arial, Helvetica, sans-serif !important;
        letter-spacing: 0 !important;
        text-decoration: none !important;
      }
      .vfc-kh-modern-card__excerpt {
        display: block !important;
        margin: 6px 0 0 !important;
        color: #5b5b5b !important;
        font: 400 14px/1.5 Arial, Helvetica, sans-serif !important;
        text-decoration: none !important;
      }
      .vfc-kh-modern-card__count {
        display: block !important;
        margin: 9px 0 0 !important;
        color: #b30d14 !important;
        font: 800 13px/1.3 Arial, Helvetica, sans-serif !important;
        text-decoration: none !important;
      }
      @media (min-width: 769px) {
        .vfc-kh-modern-card { padding: 17px 18px !important; }
        .vfc-kh-modern-card__meta { font-size: 12px !important; }
        .vfc-kh-modern-card__title { font-size: 18px !important; }

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
        [data-vfc-kh-category-links="true"] img,
        [data-vfc-kh-back-wrap="true"] svg,
        [data-vfc-kh-back-wrap="true"] img {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function tightenSearchWidth() {
    if (hubMode() !== "hub" || !isDesktop()) return false;
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

  function hideBackArrows(control) {
    let wrap = control?.parentElement || null;
    for (let depth = 0; wrap && depth < 3; depth += 1, wrap = wrap.parentElement) {
      const text = clean(wrap.textContent, 80);
      if (!text || text.length > 40) continue;
      wrap.dataset.vfcKhBackWrap = "true";
      wrap.querySelectorAll("svg,img").forEach((element) => {
        if (!control.contains(element)) element.style.setProperty("display", "none", "important");
      });
      Array.from(wrap.children).forEach((element) => {
        if (element === control || control.contains(element)) return;
        const arrowText = clean(element.textContent, 20);
        if (/^(?:>|›|»|<|‹|«|←|→){1,4}$/.test(arrowText)) {
          element.style.setProperty("display", "none", "important");
        }
      });
      return;
    }
  }

  function polishBackControl() {
    if (!isDesktop()) return false;
    const control = findBackControl();
    if (!control) return false;
    control.dataset.vfcKhBack = "true";
    control.setAttribute("aria-label", "Go back to the previous page");
    if (clean(control.textContent, 40) !== "← Back") control.textContent = "← Back";
    hideBackArrows(control);
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
      if (/^(?:>|›|»|<|‹|«|←|→){1,4}$/.test(text)) {
        element.style.setProperty("display", "none", "important");
      }
    });
  }

  function polishCategoryLinks() {
    if (hubMode() !== "hub" || !isDesktop()) return false;
    const heading = findCategoriesHeading();
    const root = tightCategoryRoot(heading);
    if (!heading || !root) return false;
    root.dataset.vfcKhCategoryLinks = "true";
    const links = Array.from(root.querySelectorAll("a"));
    links.forEach((link) => {
      link.dataset.vfcKhCategoryLink = "true";
    });
    hideArrowOnlyElements(root);
    return links.length > 0;
  }

  function targetSelector(mode) {
    if (mode === "hub") return 'a[href*="/knowledge-hub-category/"]';
    if (mode === "category" || mode === "article") return 'a[href*="/knowledge-hub-articles/"]';
    return "";
  }

  function hrefPath(link) {
    try {
      return new URL(link.getAttribute("href") || link.href || "", window.location.href).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return "";
    }
  }

  function distinctTargetHrefs(root, selector) {
    const values = new Set();
    root?.querySelectorAll?.(selector).forEach((link) => {
      if (link.closest(".vfc-kh-modern-card")) return;
      const path = hrefPath(link);
      if (path) values.add(path);
    });
    return values;
  }

  function cardScore(node, selector) {
    if (!node || node === document.body || node === document.documentElement) return -100;
    const tag = String(node.tagName || "").toLowerCase();
    if (["main", "header", "footer", "nav"].includes(tag)) return -100;
    const text = clean(node.innerText || node.textContent, 1800);
    if (text.length < 18) return -50;
    const hrefs = distinctTargetHrefs(node, selector);
    if (!hrefs.size || hrefs.size > 4) return -50;

    const hasMedia = Boolean(node.querySelector("img,picture,wix-image"));
    const hasReadMore = /read\s*more/i.test(text);
    if (!hasMedia && !hasReadMore) return -50;

    let score = 0;
    if (hrefs.size === 1) score += 8;
    else score -= (hrefs.size - 1) * 5;
    if (hasMedia) score += 5;
    if (hasReadMore) score += 4;
    if (node.querySelector("h1,h2,h3,h4,h5,h6,[role=\"heading\"]")) score += 3;
    if (text.length >= 45 && text.length <= 900) score += 3;
    if (text.length > 1200) score -= 8;
    if (node.children.length <= 12) score += 1;
    return score;
  }

  function findCardRoot(link, selector) {
    let current = link?.parentElement || null;
    let best = null;
    let bestScore = -100;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const score = cardScore(current, selector);
      if (score > bestScore) {
        best = current;
        bestScore = score;
      }
      if (score >= 18 && distinctTargetHrefs(current, selector).size === 1) break;
    }
    return bestScore >= 10 ? best : null;
  }

  function isBoilerplateText(value) {
    const text = clean(value, 500);
    if (!text) return true;
    return /^(?:read\s*more|back|home|apply\s*now|view\s*vans?)$/i.test(text)
      || /^number of articles\s*\d+$/i.test(text)
      || /^\d+\s+articles?$/i.test(text);
  }

  function titleFromSlug(path) {
    const slug = clean(path.split("/").filter(Boolean).pop() || "", 160);
    return slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function extractTitle(root, targetPath) {
    const linked = Array.from(root.querySelectorAll("a"))
      .filter((link) => hrefPath(link) === targetPath)
      .map((link) => clean(link.innerText || link.textContent, 220))
      .filter((text) => text.length >= 6 && text.length <= 180 && !isBoilerplateText(text));
    if (linked.length) return linked.sort((a, b) => b.length - a.length)[0];

    const headings = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=\"heading\"]"))
      .map((element) => clean(element.innerText || element.textContent, 220))
      .filter((text) => text.length >= 6 && text.length <= 180 && !isBoilerplateText(text));
    if (headings.length) return headings.sort((a, b) => b.length - a.length)[0];

    return titleFromSlug(targetPath);
  }

  function extractExcerpt(root, title) {
    const preferred = Array.from(root.querySelectorAll("p"))
      .map((element) => clean(element.innerText || element.textContent, 500))
      .filter((text) => text.length >= 28 && text.length <= 360 && text !== title && !isBoilerplateText(text));
    if (preferred.length) return preferred.sort((a, b) => b.length - a.length)[0];

    const fallback = Array.from(root.querySelectorAll("span,div"))
      .filter((element) => element.children.length <= 2)
      .map((element) => clean(element.innerText || element.textContent, 500))
      .filter((text) => text.length >= 28 && text.length <= 320 && text !== title && !isBoilerplateText(text));
    return fallback.sort((a, b) => b.length - a.length)[0] || "";
  }

  function extractCount(root) {
    const text = clean(root.innerText || root.textContent, 1200);
    const match = text.match(/number of articles\s*(\d+)/i) || text.match(/\b(\d+)\s+articles?\b/i);
    return match ? Number(match[1]) : null;
  }

  function categoryLabelFromPath() {
    const parts = normalisedPath().split("/").filter(Boolean);
    const slug = parts[1] || "";
    return CATEGORY_LABELS[slug] || titleFromSlug(`/x/${slug}`) || "Knowledge Hub";
  }

  function metaLabel(mode) {
    if (mode === "hub") return "Knowledge Hub Category";
    if (mode === "category") return categoryLabelFromPath();
    return "Related Guide";
  }

  function createModernCard({ href, title, excerpt, count, label }) {
    const card = document.createElement("a");
    card.className = "vfc-kh-modern-card";
    card.dataset.vfcKhModernCard = "true";
    card.href = href;
    card.innerHTML = `
      <span class="vfc-kh-modern-card__meta">${escapeHtml(label)}</span>
      <span class="vfc-kh-modern-card__title">${escapeHtml(title)}</span>
      ${excerpt ? `<span class="vfc-kh-modern-card__excerpt">${escapeHtml(excerpt)}</span>` : ""}
      ${Number.isFinite(count) ? `<span class="vfc-kh-modern-card__count">${count} ${count === 1 ? "article" : "articles"}</span>` : ""}
    `;
    return card;
  }

  function relaxCardAncestors(root, selector) {
    let current = root?.parentElement || null;
    for (let depth = 0; current && depth < 2; depth += 1, current = current.parentElement) {
      const hrefs = distinctTargetHrefs(current, selector);
      const text = clean(current.innerText || current.textContent, 1400);
      if (hrefs.size !== 1 || text.length > 1200) break;
      current.dataset.vfcKhCardWrap = "true";
    }
  }

  function moderniseCards() {
    const mode = hubMode();
    const selector = targetSelector(mode);
    if (!mode || !selector) return 0;

    const currentPath = normalisedPath();
    const links = Array.from(document.querySelectorAll(selector));
    const seenRoots = new Set();
    let changed = 0;

    links.forEach((link) => {
      if (link.closest(".vfc-kh-modern-card")) return;
      const targetPath = hrefPath(link);
      if (!targetPath || targetPath === currentPath) return;
      const root = findCardRoot(link, selector);
      if (!root || seenRoots.has(root)) return;
      seenRoots.add(root);
      if (root.dataset.vfcKhCardRoot === "true") return;

      const title = extractTitle(root, targetPath);
      if (!title || title.length < 4) return;
      const excerpt = extractExcerpt(root, title);
      const count = mode === "hub" ? extractCount(root) : null;
      const card = createModernCard({
        href: link.href || targetPath,
        title,
        excerpt,
        count,
        label: metaLabel(mode),
      });

      root.dataset.vfcKhCardRoot = "true";
      root.appendChild(card);
      relaxCardAncestors(root, selector);
      changed += 1;
    });

    return changed;
  }

  function applyPolish() {
    const mode = hubMode();
    if (!mode) return;
    ensureStyle();
    moderniseCards();
    tightenSearchWidth();
    polishBackControl();
    polishCategoryLinks();
  }

  function scheduleApply() {
    window.clearTimeout(timer);
    timer = window.setTimeout(applyPolish, 80);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function syncRoute() {
    if (!hubMode()) return;
    applyPolish();
    startObserver();
  }

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("resize", scheduleApply, { passive: true });
  window.setInterval(syncRoute, 700);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRoute, { once: true });
  else syncRoute();
})();
