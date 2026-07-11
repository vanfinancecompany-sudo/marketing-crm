import StatCard from "../components/StatCard.jsx";

const readinessCards = [
  ["Email Ready", "Pending", "blue"],
  ["SMS Ready", "Pending", "green"],
  ["Facebook Ready", "Pending", "default"],
  ["Suppressed", 0, "amber"],
  ["Never Contacted", "Pending", "default"],
  ["Recently Contacted", "Pending", "default"],
];

const channels = [
  {
    title: "Email Campaigns",
    description: "Prepare email audiences and controlled campaign batches.",
    actionLabel: "Create Email Campaign - Coming Soon",
  },
  {
    title: "SMS Campaigns",
    description: "Prepare UK mobile audiences for text campaign batches.",
    actionLabel: "Create SMS Campaign - Coming Soon",
  },
  {
    title: "Facebook Audiences",
    description: "Prepare matched customer audiences for Facebook advertising.",
    actionLabel: "Create Facebook Audience - Coming Soon",
  },
];

const quickActions = [
  "Create Email Campaign",
  "Create SMS Campaign",
  "Create Facebook Audience",
  "View Campaigns",
  "Campaign Templates",
  "Export Centre",
];

const opportunityRows = [
  "Customers ready for email",
  "Customers ready for SMS",
  "Customers ready for Facebook",
  "Customers never contacted",
  "Customers inactive for 180 days",
  "New customers added this week",
];

export default function MarketingCentrePage() {
  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Marketing Operations</div>
          <h2>Marketing Centre</h2>
          <p>
            Build audiences, manage campaigns and prepare marketing batches for email,
            SMS and Facebook.
          </p>
          <div className="card-actions" style={{ marginTop: 16 }}>
            <button type="button" className="button button--primary" disabled>
              Create Campaign - Coming Soon
            </button>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        {readinessCards.map(([label, value, tone]) => (
          <StatCard key={label} label={label} value={value} tone={tone} />
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Campaign Channels</h3>
            <p>Choose the marketing channel you want to prepare next.</p>
          </div>
        </div>
        <div className="card-grid">
          {channels.map((channel) => (
            <article key={channel.title} className="panel panel--nested" style={{ boxShadow: "none" }}>
              <div className="panel__header">
                <div>
                  <h3>{channel.title}</h3>
                  <p>{channel.description}</p>
                </div>
                <span className="status-pill">Coming Soon</span>
              </div>
              <div className="simple-list" style={{ marginBottom: 16 }}>
                <div className="simple-list__item">
                  <span>Ready Audience</span>
                  <strong>Pending</strong>
                </div>
                <div className="simple-list__item">
                  <span>Last Campaign</span>
                  <strong>None</strong>
                </div>
              </div>
              <button type="button" className="button button--ghost" disabled>
                {channel.actionLabel}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Recent Campaigns</h3>
            <p>Campaign history will appear here once campaign tools are built.</p>
          </div>
        </div>
        <div className="empty-state">
          <strong>No campaigns yet.</strong>
          <p>Create your first campaign to start building an audience.</p>
          <button type="button" className="button button--ghost" disabled>
            Create Campaign - Coming Soon
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Quick Actions</h3>
            <p>Campaign tools planned for email, SMS and Facebook audiences.</p>
          </div>
        </div>
        <div className="card-grid">
          {quickActions.map((action) => (
            <button key={action} type="button" className="button button--ghost" disabled>
              {action} - Coming Soon
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Marketing Opportunities</h3>
            <p>Live marketing opportunities will appear here once the audience engine is connected.</p>
          </div>
        </div>
        <div className="simple-list">
          {opportunityRows.map((row) => (
            <div key={row} className="simple-list__item">
              <strong>{row}</strong>
              <span className="status-pill">Pending</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
