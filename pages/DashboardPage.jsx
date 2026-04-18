import StatCard from "../components/StatCard.jsx";

function getCreativeActivityLabel(creative) {
  if (creative.status === "reel_asset" || creative.status === "draft") {
    return "Reel created";
  }

  if (creative.status === "ready_to_post") {
    return "Reel saved";
  }

  if (creative.status === "posted") {
    return "Reel asset";
  }

  return "Reel asset";
}

export default function DashboardPage({ stats, recentCreatives, topReels = [] }) {
  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Content Operations</div>
          <h2>Today&apos;s marketing workflow at a glance</h2>
          <p>
            Track reel assets created today, stock waiting to be posted, and vehicles already
            marked posted.
          </p>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Reel assets created today" value={stats.createdToday} tone="blue" />
        <StatCard label="Stock posts waiting" value={stats.readyToPost} tone="amber" />
        <StatCard label="Stock posts marked posted today" value={stats.postedToday} tone="green" />
        <StatCard label="Finance clicks today" value={stats.financeClicksToday || 0} tone="blue" />
        <StatCard label="Rent2Buy clicks today" value={stats.rent2BuyClicksToday || 0} tone="green" />
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Top Performing Reels</h3>
            <p>Tracked reel links ranked by click count.</p>
          </div>
        </div>

        {topReels.length === 0 ? (
          <div className="empty-state">No tracked reel clicks yet.</div>
        ) : (
          <div className="simple-list">
            {topReels.map((reel) => (
              <div key={`${reel.type}-${reel.reelId}`} className="simple-list__item">
                <div>
                  <strong>{reel.label || "Unknown reel"}</strong>
                  <div>
                    {reel.type === "rent2buy" ? "Rent2Buy" : "Van Finance"}
                    {reel.isUnknown ? " | missing reel id" : ""}
                  </div>
                </div>
                <div className="status-pill">{reel.clickCount} clicks</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Recent Reel Activity</h3>
            <p>Fresh reel assets from the separate Reel Factory workflow.</p>
          </div>
        </div>

        {recentCreatives.length === 0 ? (
          <div className="empty-state">No reel assets generated yet.</div>
        ) : (
          <div className="simple-list">
            {recentCreatives.map((creative) => (
              <div key={creative.id} className="simple-list__item">
                <div>
                  <strong>{creative.vehicle.name}</strong>
                  <div>
                    {creative.templateType} | {creative.hookStyle}
                  </div>
                </div>
                <div className="status-pill">{getCreativeActivityLabel(creative)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
