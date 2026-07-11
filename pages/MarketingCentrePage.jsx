import StatCard from "../components/StatCard.jsx";

const summaryCards = [
  ["Total Campaigns", 0, "default"],
  ["Draft Campaigns", 0, "amber"],
  ["Active Campaigns", 0, "blue"],
  ["Completed Campaigns", 0, "green"],
  ["Customers Marketed", 0, "default"],
  ["Remaining Audience", "Pending", "default"],
];

const channels = [
  {
    title: "Email Campaigns",
    description: "Prepare email audiences and controlled export batches.",
    count: "0 campaigns",
  },
  {
    title: "SMS Campaigns",
    description: "Prepare mobile audiences for bulk text providers.",
    count: "0 campaigns",
  },
  {
    title: "Facebook Audiences",
    description: "Create customer audience files for Facebook advertising.",
    count: "0 audiences",
  },
];

const workflowSteps = [
  "Create Campaign",
  "Choose Audience",
  "Select Batch Size",
  "Download or Send",
  "Track Progress",
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
        {summaryCards.map(([label, value, tone]) => (
          <StatCard key={label} label={label} value={value} tone={tone} />
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Campaign Channels</h3>
            <p>Static placeholders for the future campaign workspace.</p>
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
                <span className="status-pill">{channel.count}</span>
              </div>
              <button type="button" className="button button--ghost" disabled>
                View Campaigns - Coming Soon
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
            <h3>Future Workflow</h3>
            <p>Planned campaign flow for email, SMS and Facebook audiences.</p>
          </div>
        </div>
        <div className="simple-list">
          {workflowSteps.map((step, index) => (
            <div key={step} className="simple-list__item">
              <div>
                <strong>{index + 1}. {step}</strong>
                <div>Coming soon</div>
              </div>
              <span className="status-pill">Planned</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
