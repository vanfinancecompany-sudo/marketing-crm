const CONTROL_CENTRE_URL =
  import.meta.env.VITE_CONTROL_CENTRE_URL ||
  "https://control-centre-navy.vercel.app";

const IMAGE_SUITE_URL = "https://vehicle-image-suite.vercel.app";
const WORK_DOCUMENTS_HUB_URL =
  import.meta.env.VITE_WORK_DOCUMENTS_HUB_URL ||
  "https://work-documents-hub.vercel.app";

export default function Sidebar({ currentView, onNavigate }) {
  const items = [
    "Dashboard",
    "Stock",
    "Vansco Stock Watch",
    "Reel Lab Beta",
    "YouTube Generator",
    "Creative Library",
    "Image Suite",
    "Documents Hub",
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
        <a className="sidebar__main-crm" href={CONTROL_CENTRE_URL}>
          Control Centre
        </a>

        {items.map((item) => {
          if (item === "Image Suite") {
            return (
              <a key={item} className="sidebar__link" href={IMAGE_SUITE_URL}>
                {item}
              </a>
            );
          }

          if (item === "Documents Hub") {
            return (
              <a key={item} className="sidebar__link" href={WORK_DOCUMENTS_HUB_URL}>
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
