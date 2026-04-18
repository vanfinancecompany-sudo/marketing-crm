const MAIN_CRM_URL = import.meta.env.VITE_MAIN_CRM_URL || "https://crm-roan-rho.vercel.app";
const IMAGE_SUITE_URL = "http://localhost:5173";

export default function Sidebar({ currentView, onNavigate }) {
  const items = [
    "Dashboard",
    "Stock",
    "Reel Factory",
    "Creative Library",
    "Image Suite",
    "Van Finance Facebook",
    "Rent2Buy Facebook",
    "Facebook Marketplace",
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__eyebrow">CRM Suite</div>
        <h1>Marketing CRM</h1>
      </div>

      <nav className="sidebar__nav">
        <a className="sidebar__main-crm" href={MAIN_CRM_URL}>
          Main CRM
        </a>

        {items.map((item) => {
          if (item === "Image Suite") {
            return (
<a
  key={item}
  className="sidebar__link"
  href={IMAGE_SUITE_URL}
>
  {item}
</a>
              
                {item}
              </a>
            );
          }

          return (
            <button
              key={item}
              className={currentView === item ? "sidebar__link is-active" : "sidebar__link"}
              onClick={() => onNavigate(item)}
            >
              {item}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
