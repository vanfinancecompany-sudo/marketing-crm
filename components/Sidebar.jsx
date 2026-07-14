const CONTROL_CENTRE_URL =
  import.meta.env.VITE_CONTROL_CENTRE_URL ||
  "https://control-centre-navy.vercel.app";

const WORK_DOCUMENTS_HUB_URL =
  import.meta.env.VITE_WORK_DOCUMENTS_HUB_URL ||
  "https://work-documents-hub.vercel.app";

const EXTERNAL_URL_OVERRIDES = {
  "control-centre": CONTROL_CENTRE_URL,
  "documents-hub": WORK_DOCUMENTS_HUB_URL,
};

export default function Sidebar({ onNavigate }) {
  const navigation = globalThis.MarketingCrmNavigation;
  const items = navigation?.items || [];
  const pathname = typeof window === "undefined" ? "/" : window.location.pathname;

  return (
    <aside className="marketing-sidebar">
      <div className="marketing-sidebar__brand">
        <div className="marketing-sidebar__eyebrow">CRM Suite</div>
        <h1>Marketing CRM</h1>
      </div>

      <nav className="marketing-sidebar__nav" aria-label="Marketing CRM navigation">
        {items.map((item) => {
          const active = navigation?.isItemActive(pathname, item) || false;
          const href = EXTERNAL_URL_OVERRIDES[item.id] || item.href || item.path;
          const className = item.variant === "primary"
            ? "marketing-sidebar__main-crm"
            : `marketing-sidebar__link${active ? " is-active" : ""}`;

          if (item.external || item.navigation === "document") {
            return (
              <a
                key={item.id}
                className={className}
                href={href}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </a>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              className={className}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(item.view)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
