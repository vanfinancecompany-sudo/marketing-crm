import { useEffect, useMemo, useState } from "react";
import StatCard from "../components/StatCard.jsx";
import {
  archiveMarketingCampaign,
  createMarketingCampaign,
  listMarketingCampaigns,
  updateMarketingCampaign,
} from "../services/marketingCampaigns.js";

const EMPTY_CAMPAIGN_FORM = { name: "", description: "", channel: "email", objective: "custom", status: "draft" };
const EMPTY_CAMPAIGN_STATS = { total: 0, draft: 0, active: 0, completed: 0, archived: 0 };

const readinessCards = [
  ["Email Ready", "Pending", "blue"],
  ["SMS Ready", "Pending", "green"],
  ["Facebook Ready", "Pending", "default"],
  ["Suppressed", 0, "amber"],
  ["Never Contacted", "Pending", "default"],
  ["Recently Contacted", "Pending", "default"],
];

const campaignStatCards = [
  ["Total Campaigns", "total", "default"],
  ["Draft Campaigns", "draft", "amber"],
  ["Active Campaigns", "active", "blue"],
  ["Completed Campaigns", "completed", "green"],
  ["Archived Campaigns", "archived", "default"],
];

const channelLabels = { email: "Email", sms: "SMS", facebook: "Facebook" };
const objectiveLabels = {
  new_stock: "New Stock",
  promotion: "Promotion",
  finance_offer: "Finance Offer",
  rent2buy: "Rent2Buy",
  re_engagement: "Re-engagement",
  custom: "Custom",
};
const statusLabels = { draft: "Draft", ready: "Ready", running: "Running", paused: "Paused", completed: "Completed", archived: "Archived" };
const statusTones = { draft: "default", ready: "blue", running: "green", paused: "amber", completed: "green", archived: "default" };
const channelTones = { email: "blue", sms: "green", facebook: "default" };

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
  { label: "Create Email Campaign", action: "create" },
  { label: "Create SMS Campaign", action: "create" },
  { label: "Create Facebook Audience", action: "create" },
  { label: "View Campaigns", action: "view" },
  { label: "Campaign Templates", action: "soon" },
  { label: "Export Centre", action: "soon" },
];

const opportunityRows = [
  "Customers ready for email",
  "Customers ready for SMS",
  "Customers ready for Facebook",
  "Customers never contacted",
  "Customers inactive for 180 days",
  "New customers added this week",
];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-GB");
}

function updateFormValue(setForm, key, value) {
  setForm((current) => ({ ...current, [key]: value }));
}

function TableShell({ children }) {
  return <div style={{ overflowX: "auto" }}>{children}</div>;
}

function Modal({ title, eyebrow = "Marketing Centre", children, onClose }) {
  return <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 18, background: "rgba(15, 23, 42, 0.48)" }}><div className="panel" style={{ width: "min(840px, 100%)", maxHeight: "88vh", overflow: "auto" }}><div className="panel__header"><div><div className="eyebrow">{eyebrow}</div><h3>{title}</h3></div><button type="button" className="button button--ghost" onClick={onClose}>Close</button></div>{children}</div></div>;
}

function TonePill({ children, tone = "default" }) {
  return <span className={`status-pill stat-card--${tone}`}>{children}</span>;
}

function CampaignForm({ form, setForm, error, onSubmit, submitLabel, isArchived = false }) {
  return <form onSubmit={onSubmit} className="field-grid"><label className="field"><span className="field__label">Campaign Name</span><input className="field__input" value={form.name} onChange={(event) => updateFormValue(setForm, "name", event.target.value)} required /></label><label className="field"><span className="field__label">Channel</span><select className="field__input" value={form.channel} onChange={(event) => updateFormValue(setForm, "channel", event.target.value)}><option value="email">Email</option><option value="sms">SMS</option><option value="facebook">Facebook</option></select></label><label className="field"><span className="field__label">Objective</span><select className="field__input" value={form.objective} onChange={(event) => updateFormValue(setForm, "objective", event.target.value)}><option value="new_stock">New Stock</option><option value="promotion">Promotion</option><option value="finance_offer">Finance Offer</option><option value="rent2buy">Rent2Buy</option><option value="re_engagement">Re-engagement</option><option value="custom">Custom</option></select></label>{submitLabel === "Save Campaign" ? isArchived ? <div className="field"><span className="field__label">Status</span><div className="field__input">Archived</div></div> : <label className="field"><span className="field__label">Status</span><select className="field__input" value={form.status} onChange={(event) => updateFormValue(setForm, "status", event.target.value)}><option value="draft">Draft</option><option value="ready">Ready</option><option value="running">Running</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label> : null}<label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Description</span><textarea className="field__input" rows={4} value={form.description} onChange={(event) => updateFormValue(setForm, "description", event.target.value)} /></label>{isArchived ? <div className="notice" style={{ gridColumn: "1 / -1" }}>Archived campaigns can be edited for notes and metadata, but this PR does not add restore.</div> : null}<div className="card-actions" style={{ gridColumn: "1 / -1" }}><button type="submit" className="button button--primary">{submitLabel}</button></div>{error ? <div className="notice notice--error" style={{ gridColumn: "1 / -1" }}>{error}</div> : null}</form>;
}

export default function MarketingCentrePage() {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignStats, setCampaignStats] = useState(EMPTY_CAMPAIGN_STATS);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modalMode, setModalMode] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignForm, setCampaignForm] = useState(EMPTY_CAMPAIGN_FORM);
  const [formError, setFormError] = useState("");

  const hasCampaigns = campaigns.length > 0;
  const sortedCampaigns = useMemo(() => [...campaigns].sort((first, second) => new Date(second.updated_at || 0) - new Date(first.updated_at || 0)), [campaigns]);

  async function loadCampaigns() {
    setLoading(true);
    setError("");
    try {
      const response = await listMarketingCampaigns({ includeArchived });
      setCampaigns(response.campaigns || []);
      setCampaignStats({ ...EMPTY_CAMPAIGN_STATS, ...(response.stats || {}) });
    } catch (loadError) {
      setError(loadError.message || "Could not load marketing campaigns.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCampaigns(); }, [includeArchived]);

  function openCreateCampaign(channel = "email") {
    setCampaignForm({ ...EMPTY_CAMPAIGN_FORM, channel });
    setSelectedCampaign(null);
    setFormError("");
    setModalMode("create");
  }

  function openEditCampaign(campaign) {
    setCampaignForm({ name: campaign.name || "", description: campaign.description || "", channel: campaign.channel || "email", objective: campaign.objective || "custom", status: campaign.status || "draft" });
    setSelectedCampaign(campaign);
    setFormError("");
    setModalMode("edit");
  }

  function openViewCampaign(campaign) {
    setSelectedCampaign(campaign);
    setModalMode("view");
  }

  function closeModal() {
    setModalMode("");
    setSelectedCampaign(null);
    setFormError("");
  }

  async function handleCreateCampaign(event) {
    event.preventDefault();
    setFormError("");
    try {
      await createMarketingCampaign(campaignForm);
      closeModal();
      await loadCampaigns();
    } catch (createError) {
      setFormError(createError.message || "Could not create campaign.");
    }
  }

  async function handleUpdateCampaign(event) {
    event.preventDefault();
    if (!selectedCampaign) return;
    setFormError("");
    try {
      await updateMarketingCampaign(selectedCampaign, campaignForm);
      closeModal();
      await loadCampaigns();
    } catch (updateError) {
      setFormError(updateError.message || "Could not update campaign.");
    }
  }

  async function handleArchiveCampaign(campaign) {
    if (!campaign || campaign.status === "archived") return;
    const confirmed = window.confirm(`Archive ${campaign.name}? This keeps the campaign record for history.`);
    if (!confirmed) return;
    setError("");
    try {
      await archiveMarketingCampaign(campaign);
      await loadCampaigns();
    } catch (archiveError) {
      setError(archiveError.message || "Could not archive campaign.");
    }
  }

  function scrollToCampaigns() {
    document.getElementById("campaign-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="panel__header" style={{ marginBottom: 0 }}>
          <div>
            <div className="eyebrow">Marketing Operations</div>
            <h2>Marketing Centre</h2>
            <p>
              Build audiences, manage campaigns and prepare marketing batches for email,
              SMS and Facebook.
            </p>
          </div>
          <div className="card-actions">
            <button type="button" className="button button--primary" onClick={() => openCreateCampaign()}>
              Create Campaign
            </button>
          </div>
        </div>
      </section>

      {loading ? <div className="notice">Loading campaigns...</div> : null}
      {error ? <div className="notice notice--error">{error}</div> : null}

      <section className="stats-grid">
        {campaignStatCards.map(([label, key, tone]) => (
          <StatCard key={label} label={label} value={formatNumber(campaignStats[key])} tone={tone} />
        ))}
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

      <section id="campaign-list" className="panel">
        <div className="panel__header">
          <div>
            <h3>Campaigns</h3>
            <p>Campaign records are permanent. Archive campaigns instead of deleting them.</p>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
            Include Archived
          </label>
        </div>
        {!hasCampaigns ? <div className="empty-state"><strong>No campaigns yet.</strong><p>Create your first campaign to start building an audience.</p><button type="button" className="button button--primary" onClick={() => openCreateCampaign()}>Create Campaign</button></div> : <TableShell><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>{["Name", "Channel", "Objective", "Status", "Created", "Last Updated", "Actions"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #dbe2ea", color: "#475569" }}>{heading}</th>)}</tr></thead><tbody>{sortedCampaigns.map((campaign) => <tr key={campaign.id}><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>{campaign.name}<br /><small style={{ color: "#64748b" }}>{campaign.description || "No description"}</small></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><TonePill tone={channelTones[campaign.channel]}>{channelLabels[campaign.channel] || campaign.channel}</TonePill></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{objectiveLabels[campaign.objective] || campaign.objective}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><TonePill tone={statusTones[campaign.status]}>{statusLabels[campaign.status] || campaign.status}</TonePill></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{formatDate(campaign.created_at)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{formatDate(campaign.updated_at)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><div className="card-actions" style={{ gap: 6 }}><button type="button" className="button button--ghost" onClick={() => openViewCampaign(campaign)}>View</button><button type="button" className="button button--ghost" onClick={() => openEditCampaign(campaign)}>Edit</button><button type="button" className="button button--danger" disabled={campaign.status === "archived"} onClick={() => handleArchiveCampaign(campaign)}>Archive</button></div></td></tr>)}</tbody></table></TableShell>}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Quick Actions</h3>
            <p>Campaign tools planned for email, SMS and Facebook audiences.</p>
          </div>
        </div>
        <div className="card-grid">
          {quickActions.map((action) => {
            const onClick = action.action === "create" ? () => openCreateCampaign(action.label.includes("SMS") ? "sms" : action.label.includes("Facebook") ? "facebook" : "email") : action.action === "view" ? scrollToCampaigns : undefined;
            return <button key={action.label} type="button" className={action.action === "soon" ? "button button--ghost" : "button button--primary"} disabled={action.action === "soon"} onClick={onClick}>{action.action === "soon" ? `${action.label} - Coming Soon` : action.label}</button>;
          })}
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

      {modalMode === "create" ? <Modal title="Create Campaign" onClose={closeModal}><CampaignForm form={campaignForm} setForm={setCampaignForm} error={formError} onSubmit={handleCreateCampaign} submitLabel="Create Campaign" /></Modal> : null}
      {modalMode === "edit" && selectedCampaign ? <Modal title="Edit Campaign" onClose={closeModal}><CampaignForm form={campaignForm} setForm={setCampaignForm} error={formError} onSubmit={handleUpdateCampaign} submitLabel="Save Campaign" isArchived={selectedCampaign.status === "archived"} /></Modal> : null}
      {modalMode === "view" && selectedCampaign ? <Modal title="Campaign Detail" onClose={closeModal}><div className="field-grid">{[["Campaign Name", selectedCampaign.name], ["Description", selectedCampaign.description || "-"], ["Channel", channelLabels[selectedCampaign.channel] || selectedCampaign.channel], ["Objective", objectiveLabels[selectedCampaign.objective] || selectedCampaign.objective], ["Status", statusLabels[selectedCampaign.status] || selectedCampaign.status], ["Audience", "Not selected"], ["Batch Size", "Not selected"], ["Provider", "Not selected"], ["Created", formatDate(selectedCampaign.created_at)], ["Last Updated", formatDate(selectedCampaign.updated_at)]].map(([label, value]) => <div key={label} className="field"><span className="field__label">{label}</span><div className="field__input">{value}</div></div>)}{selectedCampaign.archived_at ? <div className="field"><span className="field__label">Archived</span><div className="field__input">{formatDate(selectedCampaign.archived_at)}</div></div> : null}</div></Modal> : null}
    </div>
  );
}
