(() => {
  "use strict";

  if (window.__VFC_KNOWLEDGE_HUB_STABLE_RUNTIME__) return;
  window.__VFC_KNOWLEDGE_HUB_STABLE_RUNTIME__ = true;

  const STYLE_ID = "vfc-kh-stable-style";
  const INTRO_ID = "vfc-kh-stable-intro";
  const SEARCH_STYLE_ID = "vfc-kh-stable-search-style";
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
  let microtaskQueued = false;
  let lastPath = "";
  let revealTimer = null;

  function clean(value, limit = 1200) {
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
      html.vfc-kh-preparing #SITE_PAGES,
      html.vfc-kh-preparing #PAGES_CONTAINER {
        visibility: hidden !important;
      }

      [data-vfc-kh-original-intro="true"] {
        display: none !important;
      }

      #${INTRO_ID} {
        width: min(820px, calc(100% - 32px));
        margin: 24px auto 0;
        text-align: center;
        color: #161616;
        font-family: Arial, Helvetica, sans-serif;
      }
      #${INTRO_ID} h1 {
        margin: 0;
        font-size: clamp(24px, 3vw, 32px);
        line-height: 1.15;
        letter-spacing: -.02em;
      }
      #${INTRO_ID} h1 strong { color: #e20d24; }
      #${INTRO_ID} p {
        margin: 18px auto 0;
        max-width: 760px;
        font-size: 18px;
        line-height: 1.55;
        font-weight: 600;
      }
      #${INTRO_ID} .vfc-kh-stable-back {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin: 18px 0 0;
        min-height: 34px;
        padding: 6px 11px;
        border: 1px solid #d5d5d5;
        border-radius: 999px;
        background: #fff;
        color: #111;
        font: 700 14px/1.1 Arial, Helvetica, sans-serif;
        cursor: pointer;
      }
      #${INTRO_ID} .vfc-kh-stable-back:hover,
      #${INTRO_ID} .vfc-kh-stable-back:focus-visible {
        border-color: #b30d14;
        outline: none;
      }

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
        overflow: visible !important;
      }
      .vfc-kh-modern-card {
        display: block !important;
        box-sizing: border-box !important;
        width: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        height: auto !important;
        padding: 17px 18px !important;
        border: 1px solid #d9d9d9 !important;
        border-radius: 13px !important;
        background: #fff !important;
        color: #161616 !important;
        text-decoration: none !important;
        box-shadow: 0 6px 18px rgba(0,0,0,.10) !important;
        font-family: Arial, Helvetica, sans-serif !important;
        transition: border-color .14s ease, box-shadow .14s ease !important;
        cursor: pointer !important;
      }
      .vfc-kh-modern-card:hover,
      .vfc-kh-modern-card:focus-visible {
        border-color: #b30d14 !important;
        box-shadow: 0 0 0 1px rgba(179,13,20,.9), 0 9px 24px rgba(0,0,0,.12) !important;
        outline: none !important;
      }
      .vfc-kh-modern-card__meta {
        display: block !important;
        margin: 0 0 5px !important;
        color: #b30d14 !important;
        font: 800 12px/1.2 Arial, Helvetica, sans-serif !important;
        letter-spacing: .05em !important;
        text-transform: uppercase !important;
      }
      .vfc-kh-modern-card__title {
        display: block !important;
        margin: 0 !important;
        color: #161616 !important;
        font: 800 19px/1.3 Arial, Helvetica, sans-serif !important;
        text-decoration: none !important;
      }
      .vfc-kh-modern-card__excerpt {
        display: block !important;
        margin: 6px 0 0 !important;
        color: #4f4f4f !important;
        font: 400 16px/1.48 Arial, Helvetica, sans-serif !important;
        text-decoration: none !important;
      }
      .vfc-kh-modern-card__count {
        display: block !important;
        margin: 9px 0 0 !important;
        color: #b30d14 !important;
        font: 800 15px/1.3 Arial, Helvetica, sans-serif !important;
      }

      [data-vfc-kh-category-nav-ready="true"] > :not(.vfc-kh-category-nav) {
        display: none !important;
      }
      [data-vfc-kh-category-nav-ready="true"] {
        display: block !important;
        width: 100% !important;
        min-height: 0 !important;
        height: auto !important;
        overflow: visible !important;
      }
      .vfc-kh-category-nav {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 0 2px;
        font-family: Arial, Helvetica, sans-serif;
      }
      .vfc-kh-category-nav h2 {
        margin: 0 0 12px;
        font-size: 24px;
        line-height: 1.2;
      }
      .vfc-kh-category-nav__links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 12px;
        align-items: center;
      }
      .vfc-kh-category-nav a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 38px;
        padding: 8px 14px;
        border: 1px solid #d6d6d6;
        border-radius: 999px;
        background: #fff;
        color: #111;
        font: 700 15px/1.15 Arial, Helvetica, sans-serif;
        text-decoration: none !important;
        white-space: nowrap;
      }
      .vfc-kh-category-nav a:hover,
      .vfc-kh-category-nav a:focus-visible {
        border-color: #b30d14;
        color: #b30d14;
        outline: none;
      }

      [data-vfc-kh-back="true"] {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: auto !important;
        min-width: 0 !important;
        min-height: 34px !important;
        padding: 6px 10px !important;
        border: 1px solid #d5d5d5 !important;
        border-radius: 999px !important;
        background: #fff !important;
        color: #111 !important;
        font: 700 14px/1.1 Arial, Helvetica, sans-serif !important;
        text-decoration: none !important;
        cursor: pointer !important;
      }
      [data-vfc-kh-back-wrap="true"] svg,
      [data-vfc-kh-back-wrap="true"] img { display: none !important; }

      @media (max-width: 768px) {
        #${INTRO_ID} { width: calc(100% - 20px); margin-top: 16px; }
        #${INTRO_ID} p { font-size: 16px; line-height: 1.5; }
        .vfc-kh-modern-card { padding: 14px !important; }
        .vfc-kh-modern-card__title { font-size: 18px !important; }
        .vfc-kh-modern-card__excerpt { font-size: 15px !important; }
        .vfc-kh-modern-card__count { font-size: 14px !important; }
        .vfc-kh-category-nav h2 { font-size: 21px; }
        .vfc-kh-category-nav__links { gap: 8px; }
        .vfc-kh-category-nav a { font-size: 14px; padding: 8px 12px; }
      }
    `;
    document.head.appendChild(style);
  }

  function findOriginalIntro() {
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,h4,p,div,section"))
      .filter((element) => !element.closest(`#${INTRO_ID}`))
      .filter((element) => !element.closest("#vfc-knowledge-hub-search"))
      .filter((element) => /welcome to the van finance company knowledge hub/i.test(clean(element.textContent, 1000)))
      .sort((a, b) => clean(a.textContent, 1000).length - clean(b.textContent, 1000).length);
    const welcome = candidates[0] || null;
    if (!welcome) return null;

    let best = welcome;
    let current = welcome;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      const text = clean(current.innerText || current.textContent, 1400);
      const categoryLinks = current.querySelectorAll?.('a[href*="/knowledge-hub-category/"]').length || 0;
      const articleLinks = current.querySelectorAll?.('a[href*="/knowledge-hub-articles/"]').length || 0;
      if (!text || text.length > 1000 || categoryLinks || articleLinks) break;
      if (/van finance company\s*[-–]?\s*knowledge hub/i.test(text)) best = current;
    }
    return best;
  }

  function hideOriginalIntro() {
    if (hubMode() !== "hub") return;
    const original = findOriginalIntro();
    if (original && original.id !== INTRO_ID) original.dataset.vfcKhOriginalIntro = "true";
  }

  function ensureStableIntro() {
    if (hubMode() !== "hub") return false;
    const searchHost = document.getElementById("vfc-knowledge-hub-search");
    if (!searchHost?.parentNode) return false;
    let intro = document.getElementById(INTRO_ID);
    if (!intro) {
      intro = document.createElement("section");
      intro.id = INTRO_ID;
      intro.innerHTML = `
        <h1><strong>Van Finance Company</strong> - Knowledge Hub</h1>
        <p>Welcome to the <strong>Van Finance Company Knowledge Hub</strong> - Explore clear, practical guides covering van finance, credit, Rent2Buy, self-employment, vehicle choices and common customer questions. Choose a category below to find straightforward information designed to help you understand your options and make a more confident decision.</p>
        <button class="vfc-kh-stable-back" type="button" aria-label="Go back to the previous page">← Back</button>
      `;
      intro.querySelector("button")?.addEventListener("click", () => {
        if (window.history.length > 1) window.history.back();
        else window.location.assign("/");
      });
      searchHost.parentNode.insertBefore(intro, searchHost);
    }
    hideOriginalIntro();
    return true;
  }

  function tuneSearch() {
    if (hubMode() !== "hub") return false;
    const host = document.getElementById("vfc-knowledge-hub-search");
    const shadow = host?.shadowRoot;
    if (!host || !shadow) return false;
    host.style.setProperty("min-height", "0", "important");
    host.style.setProperty("height", "auto", "important");
    let style = shadow.getElementById?.(SEARCH_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = SEARCH_STYLE_ID;
      style.textContent = `
        .shell {
          width: min(820px, calc(100% - 32px)) !important;
          margin: 22px auto 28px !important;
          padding: 24px 28px 18px !important;
          min-height: 0 !important;
          height: auto !important;
        }
        .chips { margin: 12px 0 0 !important; }
        .status:empty,
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
    return clean(path.split("/").filter(Boolean).pop() || "", 160)
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
    return headings.sort((a, b) => b.length - a.length)[0] || titleFromSlug(targetPath);
  }

  function extractExcerpt(root, title) {
    const preferred = Array.from(root.querySelectorAll("p"))
      .map((element) => clean(element.innerText || element.textContent, 500))
      .filter((text) => text.length >= 28 && text.length <= 360 && text !== title && !isBoilerplateText(text));
    if (preferred.length) return preferred.sort((a, b) => b.length - a.length)[0];
    return Array.from(root.querySelectorAll("span,div"))
      .filter((element) => element.children.length <= 2)
      .map((element) => clean(element.innerText || element.textContent, 500))
      .filter((text) => text.length >= 28 && text.length <= 320 && text !== title && !isBoilerplateText(text))
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  function extractCount(root) {
    const leaves = Array.from(root.querySelectorAll("p,span,div"))
      .filter((element) => element.children.length === 0)
      .map((element) => clean(element.textContent, 80));
    for (const text of leaves) {
      const match = text.match(/^number of articles\s*(\d+)$/i) || text.match(/^(\d+)\s+articles?$/i);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function categoryLabelFromPath() {
    const slug = normalisedPath().split("/").filter(Boolean)[1] || "";
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
      if (!root || seenRoots.has(root) || root.dataset.vfcKhCardRoot === "true") return;
      seenRoots.add(root);
      const title = extractTitle(root, targetPath);
      if (!title || title.length < 4) return;
      const card = createModernCard({
        href: link.href || targetPath,
        title,
        excerpt: extractExcerpt(root, title),
        count: mode === "hub" ? extractCount(root) : null,
        label: metaLabel(mode),
      });
      root.dataset.vfcKhCardRoot = "true";
      root.appendChild(card);
      relaxCardAncestors(root, selector);
      changed += 1;
    });
    return changed;
  }

  function findBackControl() {
    return Array.from(document.querySelectorAll("a,button,[role=\"button\"]")).find((element) => {
      const text = clean(element.textContent, 40).toLowerCase();
      return text && text.length <= 18 && /^back(?:\s*[<‹«←]+)?$/.test(text);
    }) || null;
  }

  function polishBackControl() {
    if (hubMode() === "hub" || !isDesktop()) return false;
    const control = findBackControl();
    if (!control) return false;
    control.dataset.vfcKhBack = "true";
    control.textContent = "← Back";
    control.setAttribute("aria-label", "Go back to the previous page");
    let wrap = control.parentElement;
    for (let depth = 0; wrap && depth < 3; depth += 1, wrap = wrap.parentElement) {
      const text = clean(wrap.textContent, 80);
      if (!text || text.length > 40) continue;
      wrap.dataset.vfcKhBackWrap = "true";
      break;
    }
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
    return Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,div,span"))
      .find((element) => clean(element.textContent, 80) === "Knowledge Hub Categories") || null;
  }

  function tightCategoryRoot(heading) {
    let current = heading?.parentElement || null;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const anchors = current.querySelectorAll("a").length;
      if (anchors >= 8 && anchors <= 20) return current;
    }
    return null;
  }

  function rebuildCategoryNav() {
    if (hubMode() !== "hub") return false;
    const heading = findCategoriesHeading();
    const root = tightCategoryRoot(heading);
    if (!heading || !root) return false;
    if (root.dataset.vfcKhCategoryNavReady === "true") return true;

    const seen = new Set();
    const links = Array.from(root.querySelectorAll("a")).map((link) => ({
      href: link.href || link.getAttribute("href") || "#",
      label: clean(link.textContent, 80),
    })).filter((item) => {
      const key = `${item.href}|${item.label}`;
      if (!item.label || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (links.length < 8) return false;

    const nav = document.createElement("section");
    nav.className = "vfc-kh-category-nav";
    nav.innerHTML = `
      <h2>Knowledge Hub Categories</h2>
      <div class="vfc-kh-category-nav__links">
        ${links.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join("")}
      </div>
    `;
    root.dataset.vfcKhCategoryNavReady = "true";
    root.appendChild(nav);
    return true;
  }

  function readyToReveal() {
    const mode = hubMode();
    if (!mode) return true;
    if (mode === "hub") {
      return Boolean(
        document.getElementById("vfc-knowledge-hub-search")
        && document.getElementById(INTRO_ID)
        && document.querySelector(".vfc-kh-modern-card")
      );
    }
    const selector = targetSelector(mode);
    const targets = selector ? document.querySelectorAll(selector).length : 0;
    return targets === 0 || Boolean(document.querySelector(".vfc-kh-modern-card"));
  }

  function revealWhenReady() {
    if (!document.documentElement.classList.contains("vfc-kh-preparing")) return;
    if (readyToReveal()) {
      requestAnimationFrame(() => document.documentElement.classList.remove("vfc-kh-preparing"));
      return;
    }
    window.clearTimeout(revealTimer);
    revealTimer = window.setTimeout(() => document.documentElement.classList.remove("vfc-kh-preparing"), 900);
  }

  function applyPolish() {
    if (!hubMode()) return;
    ensureStyle();
    ensureStableIntro();
    tuneSearch();
    moderniseCards();
    rebuildCategoryNav();
    polishBackControl();
    revealWhenReady();
  }

  function queueApply() {
    if (microtaskQueued) return;
    microtaskQueued = true;
    queueMicrotask(() => {
      microtaskQueued = false;
      applyPolish();
    });
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(queueApply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function syncRoute() {
    const path = normalisedPath();
    if (path === lastPath && hubMode()) return;
    lastPath = path;
    if (!hubMode()) {
      document.documentElement.classList.remove("vfc-kh-preparing");
      return;
    }
    document.documentElement.classList.add("vfc-kh-preparing");
    applyPolish();
    startObserver();
  }

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("resize", queueApply, { passive: true });
  window.setInterval(() => {
    const path = normalisedPath();
    if (path !== lastPath) syncRoute();
  }, 500);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRoute, { once: true });
  else syncRoute();
})();
