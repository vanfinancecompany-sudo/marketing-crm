(() => {
  "use strict";

  if (window.__RENT2BUY_VEHICLE_SEO__) return;
  window.__RENT2BUY_VEHICLE_SEO__ = true;

  const HOSTS = new Set(["rent2buyvans.co.uk", "www.rent2buyvans.co.uk"]);
  const API_URL = "https://marketing-crm-six.vercel.app/api/public-rent2buy-vehicle-seo";

  let activeRegistration = "";
  let desiredTitle = "";
  let requestSequence = 0;

  function registrationFromPage() {
    const host = String(window.location.hostname || "").toLowerCase();
    if (!HOSTS.has(host)) return "";
    const parts = String(window.location.pathname || "").split("/").filter(Boolean);
    if (String(parts[0] || "").toLowerCase() !== "van-pages" || !parts[1]) return "";
    const registration = decodeURIComponent(parts[1]).toUpperCase().replace(/[^A-Z0-9]/g, "");
    return registration.length >= 5 && registration.length <= 8 ? registration : "";
  }

  function applyTitle() {
    if (!desiredTitle || !activeRegistration || registrationFromPage() !== activeRegistration) return;
    if (document.title !== desiredTitle) document.title = desiredTitle;
  }

  async function loadTitle(registration) {
    const sequence = ++requestSequence;
    try {
      const response = await fetch(`${API_URL}?registration=${encodeURIComponent(registration)}`, { method: "GET", credentials: "omit" });
      const payload = await response.json().catch(() => ({}));
      if (sequence !== requestSequence || registrationFromPage() !== registration) return;
      const title = String(payload?.title || "").trim();
      if (response.ok && title && title.length <= 80) {
        desiredTitle = title;
        applyTitle();
      }
    } catch {
      // Keep Wix's existing title if the optional enhancement cannot resolve the vehicle.
    }
  }

  function syncRoute() {
    const registration = registrationFromPage();
    if (!registration) {
      if (activeRegistration) requestSequence += 1;
      activeRegistration = "";
      desiredTitle = "";
      return;
    }
    if (registration !== activeRegistration) {
      activeRegistration = registration;
      desiredTitle = "";
      loadTitle(registration);
      return;
    }
    applyTitle();
  }

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.setInterval(syncRoute, 1200);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRoute, { once: true });
  else syncRoute();
})();
