(() => {
  function createBrand() {
    const brand = document.createElement("div");
    brand.className = "marketing-sidebar__brand";

    const eyebrow = document.createElement("div");
    eyebrow.className = "marketing-sidebar__eyebrow";
    eyebrow.textContent = "CRM Suite";

    const title = document.createElement("h1");
    title.textContent = "Marketing CRM";

    brand.append(eyebrow, title);
    return brand;
  }

  function resolvedHref(item, externalUrls) {
    return externalUrls[item.id] || item.href || item.path || "/";
  }

  function isMountNoise(node) {
    if (node.nodeType === 8) return true;
    if (node.nodeType !== 3) return false;
    return String(node.textContent || "").replace(/\\[nr]/g, "").trim() === "";
  }

  function removeLeadingMountNoise(host) {
    let node = host.previousSibling;
    while (node && isMountNoise(node)) {
      const previous = node.previousSibling;
      node.remove();
      node = previous;
    }
  }

  function render(target, options = {}) {
    const navigation = window.MarketingCrmNavigation;
    const host = typeof target === "string" ? document.querySelector(target) : target;
    if (!navigation || !host) return null;

    removeLeadingMountNoise(host);

    const pathname = options.pathname || window.location.pathname;
    const externalUrls = options.externalUrls || {};
    const aside = host.tagName === "ASIDE" ? host : document.createElement("aside");
    aside.className = "marketing-sidebar";

    const nav = document.createElement("nav");
    nav.className = "marketing-sidebar__nav";
    nav.setAttribute("aria-label", "Marketing CRM navigation");

    navigation.items.forEach((item) => {
      const link = document.createElement("a");
      const active = navigation.isItemActive(pathname, item);
      link.className = item.variant === "primary"
        ? "marketing-sidebar__main-crm"
        : `marketing-sidebar__link${active ? " is-active" : ""}`;
      link.href = resolvedHref(item, externalUrls);
      link.textContent = item.label;
      if (active) link.setAttribute("aria-current", "page");
      nav.appendChild(link);
    });

    aside.replaceChildren(createBrand(), nav);
    if (aside !== host) host.replaceChildren(aside);
    return aside;
  }

  function mountAll() {
    document.querySelectorAll("[data-marketing-sidebar]").forEach((target) => render(target));
    mountDailyTargetWarning();
  }

  async function mountDailyTargetWarning() {
    const apiKey = window.localStorage?.getItem("marketingCustomerDatabaseApiKey") || "";
    if (!apiKey || window.location.pathname === "/") return;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).reduce((value, part) => ({ ...value, [part.type]: part.value }), {});
    const activityDate = `${parts.year}-${parts.month}-${parts.day}`;
    try {
      const response = await fetch("/api/marketing-daily-operations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-marketing-customer-database-key": apiKey },
        body: JSON.stringify({ action: "overview", activity_date: activityDate }),
      });
      const result = await response.json();
      if (!response.ok || !result.day || result.day.complete || result.day.off_day) return;
      const warning = document.createElement("a");
      warning.className = "marketing-daily-warning";
      warning.href = "/";
      warning.innerHTML = `<strong>TODAY'S MARKETING TARGET IS INCOMPLETE</strong><span>${result.day.remaining_total} actions remaining Â· ${result.day.completion_percentage}% complete</span>`;
      document.body.appendChild(warning);
    } catch {
      // The warning is advisory; existing document pages must keep working if it cannot load.
    }
  }

  window.MarketingCrmSidebarRenderer = Object.freeze({ render, mountAll });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
  else mountAll();
})();

