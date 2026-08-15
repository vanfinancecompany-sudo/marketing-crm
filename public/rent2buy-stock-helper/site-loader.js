(() => {
  "use strict";

  if (window.__RENT2BUY_STOCK_HELPER__) return;
  window.__RENT2BUY_STOCK_HELPER__ = true;

  const HOSTS = new Set(["rent2buyvans.co.uk", "www.rent2buyvans.co.uk"]);
  const PATH = "/view-all-vans";
  const API_URL = "https://marketing-crm-six.vercel.app/api/public-rent2buy-stock-count";

  let cachedCount = null;
  let countRequested = false;
  let observer = null;

  function isAllVansPage() {
    const host = String(window.location.hostname || "").toLowerCase();
    const path = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
    return HOSTS.has(host) && path.toLowerCase() === PATH;
  }

  function candidateHeadings() {
    return Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,div,span"))
      .filter((node) => node.children.length === 0 && /^null\s+vehicles\s+found$/i.test(String(node.textContent || "").trim()));
  }

  function label() {
    return Number.isFinite(cachedCount) ? `${cachedCount} Vehicles Found` : "Available Vehicles";
  }

  function repair() {
    if (!isAllVansPage()) return;
    for (const node of candidateHeadings()) node.textContent = label();
  }

  async function loadCount() {
    if (countRequested || !isAllVansPage()) return;
    countRequested = true;
    try {
      const response = await fetch(API_URL, { method: "GET", credentials: "omit" });
      const payload = await response.json().catch(() => ({}));
      const count = Number(payload?.count);
      if (response.ok && Number.isFinite(count) && count >= 0) cachedCount = count;
    } catch {
      // The fallback label still removes the broken "null" output.
    }
    repair();
  }

  function mount() {
    if (!isAllVansPage()) return;
    repair();
    loadCount();
    if (observer) return;
    observer = new MutationObserver(repair);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function unmount() {
    observer?.disconnect();
    observer = null;
    countRequested = false;
    cachedCount = null;
  }

  function syncRoute() {
    if (isAllVansPage()) mount();
    else if (observer) unmount();
  }

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.setInterval(syncRoute, 900);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRoute, { once: true });
  else syncRoute();
})();
