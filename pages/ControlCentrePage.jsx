import StatCard from "../components/StatCard.jsx";

const MAIN_CRM_URL = import.meta.env.VITE_MAIN_CRM_URL || "/";

export default function ControlCentrePage({ stats, onNavigate }) {
  function stopCardClick(event) {
    event.stopPropagation();
  }

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Control Centre</div>
          <h2>Control Centre</h2>
          <p>Overview and quick access</p>
          <div className="control-live-note">Live system overview | Last updated just now</div>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Vehicles in stock" value={stats.totalStock} tone="blue" />
        <StatCard label="Vans posted today" value={stats.postedToday} tone="green" />
        <StatCard label="Reels created today" value={stats.reelsCreatedToday} tone="amber" />
        <StatCard label="Total visible vans" value={stats.totalVisibleVans} tone="default" />
        <StatCard label="Finance vans" value={stats.financeVans} tone="blue" />
        <StatCard label="Rent2Buy vans" value={stats.rentVans} tone="green" />
      </section>

      <section className="panel control-finance-panel">
        <div className="panel__header">
          <div>
            <h3>Finance Overview</h3>
            <p>Main CRM access for leads, pipeline, and manual enquiry handling.</p>
          </div>
        </div>
        <div className="control-finance-grid">
          <a className="control-finance-card" href={MAIN_CRM_URL}>
            <strong>Pipeline Board</strong>
            <span>Open finance pipeline</span>
          </a>
          <a className="control-finance-card" href={MAIN_CRM_URL}>
            <strong>Lead List</strong>
            <span>View customer enquiries</span>
          </a>
          <a className="control-finance-card" href={MAIN_CRM_URL}>
            <strong>Finance Leads</strong>
            <span>Prioritise active leads</span>
          </a>
          <a className="control-finance-card" href={MAIN_CRM_URL}>
            <strong>Add Manual Lead</strong>
            <span>Create a new enquiry</span>
          </a>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Quick Actions</h3>
            <p>Jump into finance first, then marketing workflows.</p>
          </div>
        </div>
        <div className="control-action-grid">
          <a className="button button--primary control-action-button control-action-button--finance" href={MAIN_CRM_URL}>
            Open Pipeline Board
          </a>
          <a className="button button--primary control-action-button control-action-button--finance" href={MAIN_CRM_URL}>
            View Lead List
          </a>
          <a className="button button--ghost control-action-button" href={MAIN_CRM_URL}>
            Add Manual Lead
          </a>
          <button className="button button--primary control-action-button" onClick={() => onNavigate("Premium Reel Studio")}>
            <span aria-hidden="true">🎥</span>
            Create Reel
          </button>
          <button className="button button--primary control-action-button" onClick={() => onNavigate("Van Finance Facebook")}>
            <span aria-hidden="true">📣</span>
            Post Vans
          </button>
          <button className="button button--ghost control-action-button" onClick={() => onNavigate("Stock")}>
            <span aria-hidden="true">🚐</span>
            View Stock
          </button>
          <button className="button button--ghost control-action-button" onClick={() => onNavigate("Creative Library")}>
            <span aria-hidden="true">📁</span>
            Creative Library
          </button>
        </div>
      </section>

      <section className="control-app-grid">
        <article
          className="panel control-app-card"
          onClick={() => {
            window.location.href = MAIN_CRM_URL;
          }}
        >
          <div>
            <h3>Main CRM</h3>
            <p>Leads, pipeline, customer management</p>
          </div>
          <a className="button button--primary" href={MAIN_CRM_URL} onClick={stopCardClick}>
            Open CRM
          </a>
        </article>

        <article className="panel control-app-card" onClick={() => onNavigate("Stock")}>
          <div>
            <h3>Marketing CRM</h3>
            <p>Stock, reels, Facebook posting</p>
          </div>
          <div className="control-button-row">
            <button className="button button--ghost" onClick={(event) => {
              stopCardClick(event);
              onNavigate("Stock");
            }}>
              Stock
            </button>
            <button className="button button--ghost" onClick={(event) => {
              stopCardClick(event);
              onNavigate("Premium Reel Studio");
            }}>
              Premium Reel Studio
            </button>
            <button className="button button--ghost" onClick={(event) => {
              stopCardClick(event);
              onNavigate("Van Finance Facebook");
            }}>
              Posting Pages
            </button>
            <button className="button button--ghost" onClick={(event) => {
              stopCardClick(event);
              onNavigate("Creative Library");
            }}>
              Creative Library
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
