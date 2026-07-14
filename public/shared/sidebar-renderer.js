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

  function render(target, options = {}) {
    const navigation = window.MarketingCrmNavigation;
    const host = typeof target === "string" ? document.querySelector(target) : target;
    if (!navigation || !host) return null;

    const pathname = options.pathname || window.location.pathname;
    const externalUrls = options.externalUrls || {};
    const aside = document.createElement("aside");
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

    aside.append(createBrand(), nav);
    host.replaceChildren(aside);
    return aside;
  }

  window.MarketingCrmSidebarRenderer = Object.freeze({ render });
})();
