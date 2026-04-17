const MAIN_CRM_URL = "https://crm-roan-rho.vercel.app";

export default function Sidebar({ currentView, onNavigate }) {
  const items = [
   "Dashboard",
    "Stock",
    "Reel Factory",
    "Creative Library",
    "Van Finance Facebook",
    "Rent2Buy Facebook",
    "Facebook Marketplace",
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__eyebrow">Separate App</div>
        <h1>Marketing CRM</h1>
      </div>

      <nav className="sidebar__nav">
        <a className="sidebar__main-crm" href={MAIN_CRM_URL}>
          MAIN CRM
        </a>
        {items.map((item) => (
          <button
            key={item}
            className={currentView === item ? "sidebar__link is-active" : "sidebar__link"}
            onClick={() => onNavigate(item)}
          >
            {item}
          </button>
        ))}
      </nav>
    </aside>
  );
}
