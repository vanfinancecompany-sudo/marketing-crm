(() => {
  "use strict";

  if (window.__VFC_KNOWLEDGE_HUB_HOME_SAFE__) return;
  window.__VFC_KNOWLEDGE_HUB_HOME_SAFE__ = true;

  const STYLE_ID = "vfc-kh-home-safe-style";
  const INTRO_ID = "vfc-kh-home-safe-intro";
  const SEARCH_STYLE_ID = "vfc-kh-home-safe-search-style";
  let observer = null;
  let queued = false;

  function clean(value, limit = 1200) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function isHome() {
    const path = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
    return path === "/knowledge-hub";
  }

  function escapeHtml(value) {
    return clean(value, 300)
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
      [data-vfc-kh-home-original-intro="true"] { display:none !important; }
      [data-vfc-kh-home-original-back="true"] { display:none !important; }

      #${INTRO_ID} {
        box-sizing:border-box;
        width:min(820px, calc(100% - 32px));
        margin:24px auto 0;
        color:#161616;
        text-align:center;
        font-family:Arial,Helvetica,sans-serif;
      }
      #${INTRO_ID} h1 {
        margin:0;
        font-size:clamp(24px,3vw,32px);
        line-height:1.15;
        letter-spacing:-.02em;
      }
      #${INTRO_ID} h1 strong { color:#e20d24; }
      #${INTRO_ID} p {
        max-width:760px;
        margin:18px auto 0;
        font-size:18px;
        line-height:1.55;
        font-weight:600;
      }
      #${INTRO_ID} button {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-height:34px;
        margin:18px 0 0;
        padding:6px 11px;
        border:1px solid #d5d5d5;
        border-radius:999px;
        background:#fff;
        color:#111;
        font:700 14px/1.1 Arial,Helvetica,sans-serif;
        cursor:pointer;
      }
      #${INTRO_ID} button:hover,
      #${INTRO_ID} button:focus-visible { border-color:#b30d14; outline:none; }

      [data-vfc-kh-home-category-root="true"] > :not(.vfc-kh-home-category-nav) { display:none !important; }
      [data-vfc-kh-home-category-root="true"] {
        display:block !important;
        width:100% !important;
        min-height:0 !important;
        height:auto !important;
        overflow:visible !important;
      }
      .vfc-kh-home-category-nav {
        box-sizing:border-box;
        width:100%;
        padding:8px 0 4px;
        font-family:Arial,Helvetica,sans-serif;
      }
      .vfc-kh-home-category-nav h2 {
        margin:0 0 14px;
        font-size:24px;
        line-height:1.2;
      }
      .vfc-kh-home-category-links {
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:10px 12px;
      }
      .vfc-kh-home-category-links a {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-height:38px;
        padding:8px 14px;
        border:1px solid #d6d6d6;
        border-radius:999px;
        background:#fff;
        color:#111;
        font:700 15px/1.15 Arial,Helvetica,sans-serif;
        text-decoration:none !important;
        white-space:nowrap;
      }
      .vfc-kh-home-category-links a:hover,
      .vfc-kh-home-category-links a:focus-visible { border-color:#b30d14; color:#b30d14; outline:none; }

      @media (max-width:768px) {
        #${INTRO_ID} { width:calc(100% - 20px); margin-top:16px; }
        #${INTRO_ID} p { font-size:16px; line-height:1.5; }
        .vfc-kh-home-category-nav h2 { font-size:21px; }
        .vfc-kh-home-category-links { gap:8px; }
        .vfc-kh-home-category-links a { padding:8px 12px; font-size:14px; }
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
      const text = clean(current.innerText || current.textContent, 1300);
      const categoryLinks = current.querySelectorAll?.('a[href*="/knowledge-hub-category/"]').length || 0;
      const articleLinks = current.querySelectorAll?.('a[href*="/knowledge-hub-articles/"]').length || 0;
      if (!text || text.length > 1000 || categoryLinks || articleLinks) break;
      if (/van finance company\s*[-–]?\s*knowledge hub/i.test(text)) best = current;
    }
    return best;
  }

  function hideOldIntroAndBack() {
    const original = findOriginalIntro();
    if (original && original.id !== INTRO_ID) original.dataset.vfcKhHomeOriginalIntro = "true";

    Array.from(document.querySelectorAll("a,button,[role=\"button\"]")).forEach((element) => {
      if (element.closest(`#${INTRO_ID}`)) return;
      const text = clean(element.textContent, 40).toLowerCase();
      if (/^back(?:\s*[<‹«←]+)?$/.test(text)) {
        let wrap = element;
        for (let depth = 0; wrap?.parentElement && depth < 3; depth += 1) {
          const parent = wrap.parentElement;
          const parentText = clean(parent.textContent, 80);
          if (!parentText || parentText.length > 40) break;
          wrap = parent;
        }
        wrap.dataset.vfcKhHomeOriginalBack = "true";
      }
    });
  }

  function ensureIntroBesideSearch() {
    const search = document.getElementById("vfc-knowledge-hub-search");
    if (!search?.parentNode) return false;
    let intro = document.getElementById(INTRO_ID);
    if (!intro) {
      intro = document.createElement("section");
      intro.id = INTRO_ID;
      intro.innerHTML = `
        <h1><strong>Van Finance Company</strong> - Knowledge Hub</h1>
        <p>Welcome to the <strong>Van Finance Company Knowledge Hub</strong> - Explore clear, practical guides covering van finance, credit, Rent2Buy, self-employment, vehicle choices and common customer questions. Choose a category below to find straightforward information designed to help you understand your options and make a more confident decision.</p>
        <button type="button" aria-label="Go back to the previous page">← Back</button>
      `;
      intro.querySelector("button")?.addEventListener("click", () => {
        if (window.history.length > 1) window.history.back();
        else window.location.assign("/");
      });
    }
    if (intro.parentNode !== search.parentNode || intro.nextSibling !== search) {
      search.parentNode.insertBefore(intro, search);
    }
    hideOldIntroAndBack();
    return true;
  }

  function tuneSearch() {
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
          width:min(820px, calc(100% - 32px)) !important;
          margin:22px auto 28px !important;
          padding:24px 28px 18px !important;
          min-height:0 !important;
          height:auto !important;
        }
        .chips { margin:12px 0 0 !important; }
        .status:empty,.results:empty {
          display:none !important;
          min-height:0 !important;
          height:0 !important;
          margin:0 !important;
          padding:0 !important;
        }
      `;
      shadow.appendChild(style);
    }
    return true;
  }

  function findCategoryRoot() {
    const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,div,span"))
      .find((element) => clean(element.textContent, 80) === "Knowledge Hub Categories");
    let current = heading?.parentElement || null;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const anchors = current.querySelectorAll("a").length;
      if (anchors >= 8 && anchors <= 20) return current;
    }
    return null;
  }

  function rebuildCategoryNav() {
    const root = findCategoryRoot();
    if (!root) return false;
    if (root.dataset.vfcKhHomeCategoryRoot === "true") return true;

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
    nav.className = "vfc-kh-home-category-nav";
    nav.innerHTML = `
      <h2>Knowledge Hub Categories</h2>
      <div class="vfc-kh-home-category-links">
        ${links.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join("")}
      </div>
    `;
    root.dataset.vfcKhHomeCategoryRoot = "true";
    root.appendChild(nav);
    return true;
  }

  function apply() {
    if (!isHome()) return;
    ensureStyle();
    ensureIntroBesideSearch();
    tuneSearch();
    rebuildCategoryNav();
  }

  function queueApply() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      apply();
    });
  }

  function syncRoute() {
    if (!isHome()) return;
    apply();
    if (!observer) {
      observer = new MutationObserver(queueApply);
      observer.observe(document.documentElement, { childList:true, subtree:true });
    }
  }

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("resize", queueApply, { passive:true });
  window.setInterval(syncRoute, 700);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRoute, { once:true });
  else syncRoute();
})();
