(() => {
  const items = Object.freeze([
    { id: "control-centre", label: "Control Centre", href: "https://control-centre-navy.vercel.app", external: true, variant: "primary" },
    { id: "content-operations", label: "Content Operations", path: "/", paths: ["/", "/marketing-totals"], navigation: "react", view: "Content Operations" },
    { id: "marketing-dashboard", label: "Marketing Dashboard", path: "/marketing-dashboard/", paths: ["/marketing-dashboard/"], navigation: "document" },
    { id: "stock", label: "Stock", path: "/stock", paths: ["/stock"], navigation: "react", view: "Stock" },
    { id: "customer-database", label: "Customer Database", path: "/customer-database", paths: ["/customer-database"], navigation: "react", view: "Customer Database" },
    { id: "marketing-centre", label: "Marketing Centre", path: "/marketing-centre", paths: ["/marketing-centre"], navigation: "react", view: "Marketing Centre" },
    { id: "knowledge-hub", label: "Knowledge Hub", path: "/knowledge-hub", paths: ["/knowledge-hub"], navigation: "react", view: "Knowledge Hub" },
    { id: "content-factory", label: "Content Factory", path: "/content-factory", paths: ["/content-factory"], navigation: "react", view: "Content Factory" },
    { id: "ai-control-centre", label: "AI Control Centre", path: "/ai-control-centre/", paths: ["/ai-control-centre/"], navigation: "document" },
    { id: "ai-visibility", label: "AI Visibility", path: "/ai-visibility", paths: ["/ai-visibility"], navigation: "react", view: "AI Visibility" },
    { id: "ai-assistant-competence", label: "AI Assistant Test", path: "/ai-assistant-competence", paths: ["/ai-assistant-competence"], navigation: "react", view: "AI Assistant Competence Test" },
    { id: "ai-knowledge-opportunities", label: "AI Knowledge Opportunities", path: "/ai-knowledge-opportunities", paths: ["/ai-knowledge-opportunities"], navigation: "react", view: "AI Knowledge Opportunities" },
    { id: "ai-customer-simulation", label: "Real Customer Simulation", path: "/ai-customer-simulation", paths: ["/ai-customer-simulation"], navigation: "react", view: "Real Customer Simulation" },
    { id: "ai-assistant-health", label: "AI Assistant Health", path: "/ai-assistant-health", paths: ["/ai-assistant-health"], navigation: "react", view: "AI Assistant Health" },
    { id: "suppression-centre", label: "Suppression Centre", path: "/suppression-centre/", paths: ["/suppression-centre/"], navigation: "document" },
    { id: "email-templates", label: "Email Templates", path: "/email-templates/", paths: ["/email-templates/"], navigation: "document" },
    { id: "campaigns", label: "Campaigns", path: "/campaigns/", paths: ["/campaigns/"], navigation: "document" },
    { id: "vansco-stock-watch", label: "Vansco Stock Watch", path: "/vansco-stock-watch", paths: ["/vansco-stock-watch"], navigation: "react", view: "Vansco Stock Watch" },
    { id: "youtube-generator", label: "YouTube Generator", path: "/youtube-generator", paths: ["/youtube-generator", "/youtube-shorts-beta"], navigation: "react", view: "YouTube Generator" },
    { id: "creative-library", label: "Creative Library", path: "/creative-library", paths: ["/creative-library"], navigation: "react", view: "Creative Library" },
    { id: "image-suite", label: "Image Suite", href: "https://vehicle-image-suite.vercel.app", external: true },
    { id: "documents-hub", label: "Documents Hub", href: "https://work-documents-hub.vercel.app", external: true },
    { id: "van-finance-facebook", label: "Van Finance Facebook", path: "/van-finance-facebook", paths: ["/van-finance-facebook"], navigation: "react", view: "Van Finance Facebook" },
    { id: "rent2buy-facebook", label: "Rent2Buy Facebook", path: "/rent2buy-facebook", paths: ["/rent2buy-facebook"], navigation: "react", view: "Rent2Buy Facebook" },
    { id: "facebook-marketplace", label: "Facebook Marketplace", path: "/facebook-marketplace", paths: ["/facebook-marketplace"], navigation: "react", view: "Facebook Marketplace" },
  ]);

  function normalizePathname(value) {
    const raw = String(value || "/").split(/[?#]/, 1)[0] || "/";
    const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
    const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");
    return collapsed === "/" ? "/" : collapsed.replace(/\/+$/, "");
  }

  function isItemActive(pathname, item) {
    if (!item || item.external) return false;
    const current = normalizePathname(pathname);
    const paths = Array.isArray(item.paths) && item.paths.length ? item.paths : [item.path];
    return paths.filter(Boolean).some((path) => normalizePathname(path) === current);
  }

  window.MarketingCrmNavigation = Object.freeze({
    items,
    normalizePathname,
    isItemActive,
  });
})();