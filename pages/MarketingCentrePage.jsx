import { useEffect, useMemo, useState } from "react";
import StatCard from "../components/StatCard.jsx";
import {
  archiveMarketingCampaign,
  createMarketingCampaign,
  downloadMarketingCampaignBatchCsv,
  exportMarketingCampaignBatch,
  generateMarketingCampaignBatch,
  getMarketingCampaignAudienceOptions,
  listMarketingCampaignBatchHistory,
  listMarketingCampaigns,
  previewMarketingCampaignAudience,
  previewMarketingCampaignBatch,
  saveMarketingCampaignAudience,
  updateMarketingCampaign,
} from "../services/marketingCampaigns.js";

const EMPTY_CAMPAIGN_FORM = { name: "", description: "", channel: "email", objective: "custom", status: "draft" };
const EMPTY_CAMPAIGN_STATS = { total: 0, draft: 0, active: 0, completed: 0, archived: 0 };
const DEFAULT_AUDIENCE_RULES = { pipeline: "all", source: "all", required_tags: [], exclude_tags: [], last_seen_period: "all", created_period: "all", exclude_unknown_pipeline: false };
const EMPTY_BATCH_SUMMARY = { total_batches: 0, total_customers_batched: 0, total_customers_exported: 0 };
const EMPTY_BATCH_PREVIEW = { eligible_count: 0, already_batched: 0, remaining_count: 0, requested_size: 100, selected_count: 0, next_batch_number: 1, total_batches: 0, total_customers_batched: 0 };
const BATCH_SIZE_PRESETS = [100, 250, 500, 1000];

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
const batchStatusTones = { pending: "amber", exported: "green", sent: "green", cancelled: "default" };
const channelRequirementLabels = { email: "Email Ready", sms: "SMS Ready", facebook: "Facebook Ready: email and/or mobile" };
const pipelineLabels = { all: "All", finance: "Finance", rent2buy: "Rent2Buy", both: "Both" };
const lastSeenLabels = { all: "Any time", last30: "Last 30 days", last90: "Last 90 days", last180: "Last 180 days", last365: "Last 365 days", more_than_180: "More than 180 days ago" };
const createdLabels = { all: "Any time", today: "Today", last7: "Last 7 days", last30: "Last 30 days", last90: "Last 90 days", this_year: "This year" };

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

function downloadCsvFile(csv) {
  if (!csv?.content || typeof window === "undefined") return;
  const blob = new Blob([csv.content], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = csv.filename || "campaign-batch.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function TableShell({ children }) {
  return <div style={{ overflowX: "auto" }}>{children}</div>;
}

function Modal({ title, eyebrow = "Marketing Centre", children, onClose }) {
  return <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 18, background: "rgba(15, 23, 42, 0.48)" }}><div className="panel" style={{ width: "min(940px, 100%)", maxHeight: "88vh", overflow: "auto" }}><div className="panel__header"><div><div className="eyebrow">{eyebrow}</div><h3>{title}</h3></div><button type="button" className="button button--ghost" onClick={onClose}>Close</button></div>{children}</div></div>;
}

function TonePill({ children, tone = "default" }) {
  return <span className={`status-pill stat-card--${tone}`}>{children}</span>;
}

function CampaignForm({ form, setForm, error, onSubmit, submitLabel, isArchived = false }) {
  return <form onSubmit={onSubmit} className="field-grid"><label className="field"><span className="field__label">Campaign Name</span><input className="field__input" value={form.name} onChange={(event) => updateFormValue(setForm, "name", event.target.value)} required /></label><label className="field"><span className="field__label">Channel</span><select className="field__input" value={form.channel} onChange={(event) => updateFormValue(setForm, "channel", event.target.value)}><option value="email">Email</option><option value="sms">SMS</option><option value="facebook">Facebook</option></select></label><label className="field"><span className="field__label">Objective</span><select className="field__input" value={form.objective} onChange={(event) => updateFormValue(setForm, "objective", event.target.value)}><option value="new_stock">New Stock</option><option value="promotion">Promotion</option><option value="finance_offer">Finance Offer</option><option value="rent2buy">Rent2Buy</option><option value="re_engagement">Re-engagement</option><option value="custom">Custom</option></select></label>{submitLabel === "Save Campaign" ? isArchived ? <div className="field"><span className="field__label">Status</span><div className="field__input">Archived</div></div> : <label className="field"><span className="field__label">Status</span><select className="field__input" value={form.status} onChange={(event) => updateFormValue(setForm, "status", event.target.value)}><option value="draft">Draft</option><option value="ready">Ready</option><option value="running">Running</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label> : null}<label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Description</span><textarea className="field__input" rows={4} value={form.description} onChange={(event) => updateFormValue(setForm, "description", event.target.value)} /></label>{isArchived ? <div className="notice" style={{ gridColumn: "1 / -1" }}>Archived campaigns can be edited for notes and metadata, but this PR does not add restore.</div> : null}<div className="card-actions" style={{ gridColumn: "1 / -1" }}><button type="submit" className="button button--primary">{submitLabel}</button></div>{error ? <div className="notice notice--error" style={{ gridColumn: "1 / -1" }}>{error}</div> : null}</form>;
}

function getCampaignAudience(campaign) {
  const audience = campaign?.metadata?.audience || {};
  return {
    rules: { ...DEFAULT_AUDIENCE_RULES, ...(audience.rules || {}) },
    eligible_count: Number.isFinite(Number(audience.eligible_count)) ? Number(audience.eligible_count) : null,
    calculated_at: audience.calculated_at || null,
  };
}

function getAudienceStatus(campaign) {
  const audience = campaign?.metadata?.audience;
  if (!audience?.rules) return "Not Selected";
  if (!audience.calculated_at || !Number.isFinite(Number(audience.eligible_count))) return "Needs Recalculation";
  return `${formatNumber(audience.eligible_count)} eligible`;
}

function getBatchStatus(campaign) {
  const summary = campaign?.batch_summary || EMPTY_BATCH_SUMMARY;
  const totalBatches = Number(summary.total_batches || 0);
  const totalCustomers = Number(summary.total_customers_batched || 0);
  const audience = getCampaignAudience(campaign);
  if (!totalBatches) return "No batches";
  if (audience.eligible_count !== null && totalCustomers >= audience.eligible_count) return "Complete audience batched";
  return `${formatNumber(totalBatches)} batches / ${formatNumber(totalCustomers)} customers`;
}

function getRequestedBatchSize(mode, customSize) {
  return mode === "custom" ? Number(customSize || 0) : Number(mode || 0);
}

function sameRules(first, second) {
  return JSON.stringify(first || {}) === JSON.stringify(second || {});
}

function BatchSection({ batches, batchSummary, batchPreview, batchSizeMode, customBatchSize, batchLoading, batchActionId, batchError, batchConfirm, isArchived, hasSavedAudience, onSizeModeChange, onCustomSizeChange, onPreview, onGenerate, onExport, onDownload, onConfirmChange }) {
  const safeSummary = batchSummary || EMPTY_BATCH_SUMMARY;
  const preview = batchPreview || EMPTY_BATCH_PREVIEW;
  const requestedSize = getRequestedBatchSize(batchSizeMode, customBatchSize);
  const canPreview = !isArchived && hasSavedAudience && requestedSize >= 1 && requestedSize <= 5000;
  const canGenerate = canPreview && batchPreview && batchPreview.selected_count > 0 && batchConfirm;

  return <section className="panel panel--nested" style={{ boxShadow: "none", marginTop: 16 }}><div className="panel__header"><div><h3>Campaign Batches</h3><p>Existing batches are permanent export batches. Updated audience rules apply only to future batches.</p></div>{isArchived ? <span className="status-pill">Read Only</span> : null}</div><div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}><div className="stat-card"><div className="stat-card__label">Customers Remaining</div><div className="stat-card__value">{batchPreview ? formatNumber(preview.remaining_count) : "-"}</div></div><div className="stat-card"><div className="stat-card__label">Customers Batched</div><div className="stat-card__value">{formatNumber(safeSummary.total_customers_batched)}</div></div><div className="stat-card"><div className="stat-card__label">Customers Exported</div><div className="stat-card__value">{formatNumber(safeSummary.total_customers_exported)}</div></div><div className="stat-card"><div className="stat-card__label">Batches Generated</div><div className="stat-card__value">{formatNumber(safeSummary.total_batches)}</div></div><div className="stat-card"><div className="stat-card__label">Eligible Now</div><div className="stat-card__value">{batchPreview ? formatNumber(preview.eligible_count) : "-"}</div></div></div>{!hasSavedAudience ? <div className="notice" style={{ marginTop: 12 }}>Save and preview an audience before generating campaign batches.</div> : null}{safeSummary.migration_required ? <div className="notice" style={{ marginTop: 12 }}>Campaign batch migration has not been applied yet.</div> : null}<div className="field-grid" style={{ marginTop: 14 }}><div className="field"><span className="field__label">Batch size</span><div className="card-actions">{BATCH_SIZE_PRESETS.map((size) => <button key={size} type="button" disabled={isArchived || batchLoading} className={String(batchSizeMode) === String(size) ? "button button--primary" : "button button--ghost"} onClick={() => onSizeModeChange(size)}>{formatNumber(size)}</button>)}<button type="button" disabled={isArchived || batchLoading} className={batchSizeMode === "custom" ? "button button--primary" : "button button--ghost"} onClick={() => onSizeModeChange("custom")}>Custom</button></div></div>{batchSizeMode === "custom" ? <label className="field"><span className="field__label">Custom size</span><input className="field__input" type="number" min="1" max="5000" value={customBatchSize} disabled={isArchived || batchLoading} onChange={(event) => onCustomSizeChange(event.target.value)} /></label> : null}</div>{batchPreview ? <div className="notice" style={{ marginTop: 12 }}><strong>Batch confirmation</strong><br />Eligible now: {formatNumber(preview.eligible_count)}<br />Already batched: {formatNumber(preview.already_batched)}<br />Remaining: {formatNumber(preview.remaining_count)}<br />Requested size: {formatNumber(preview.requested_size)}<br />Batch to create: {formatNumber(preview.selected_count)}<br />Next batch: {formatNumber(preview.next_batch_number)}</div> : null}<label className="toggle-row" style={{ marginTop: 12 }}><input type="checkbox" checked={batchConfirm} disabled={!batchPreview || isArchived || batchLoading} onChange={(event) => onConfirmChange(event.target.checked)} />I understand this batch is a permanent snapshot.</label>{batchError ? <div className="notice notice--error" style={{ marginTop: 12 }}>{batchError}</div> : null}<div className="card-actions" style={{ marginTop: 14 }}><button type="button" className="button button--ghost" disabled={!canPreview || batchLoading} onClick={onPreview}>{batchLoading ? "Working..." : "Preview Batch"}</button><button type="button" className="button button--primary" disabled={!canGenerate || batchLoading} onClick={onGenerate}>Generate Batch</button></div><div style={{ marginTop: 14 }}><TableShell><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>{["Batch #", "Created", "Customers", "Status", "Exported", "Export", "Download"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #dbe2ea", color: "#475569" }}>{heading}</th>)}</tr></thead><tbody>{batches.length === 0 ? <tr><td colSpan={7} style={{ padding: 18, color: "#64748b" }}>No batches yet.</td></tr> : batches.map((batch) => <tr key={batch.id}><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>#{batch.batch_number}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{formatDate(batch.created_at)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(batch.customer_count)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><TonePill tone={batchStatusTones[batch.status]}>{batch.status === "exported" ? "Exported" : "Pending"}</TonePill></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{batch.exported_at ? formatDate(batch.exported_at) : "-"}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><button type="button" className="button button--ghost" disabled={isArchived || batchActionId === batch.id} onClick={() => onExport(batch)}>{batchActionId === batch.id ? "Working..." : batch.status === "exported" ? "Export Again" : "Export CSV"}</button></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><button type="button" className="button button--ghost" disabled={batch.status !== "exported" || batchActionId === batch.id} onClick={() => onDownload(batch)}>Download</button></td></tr>)}</tbody></table></TableShell></div></section>;
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
  const [audienceRules, setAudienceRules] = useState(DEFAULT_AUDIENCE_RULES);
  const [audiencePreview, setAudiencePreview] = useState(null);
  const [audienceDirty, setAudienceDirty] = useState(false);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState("");
  const [audienceOptions, setAudienceOptions] = useState({ sources: [], tags: [] });
  const [batches, setBatches] = useState([]);
  const [batchSummary, setBatchSummary] = useState(EMPTY_BATCH_SUMMARY);
  const [batchPreview, setBatchPreview] = useState(null);
  const [batchSizeMode, setBatchSizeMode] = useState(100);
  const [customBatchSize, setCustomBatchSize] = useState(100);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchActionId, setBatchActionId] = useState("");
  const [batchError, setBatchError] = useState("");
  const [batchConfirm, setBatchConfirm] = useState(false);

  const hasCampaigns = campaigns.length > 0;
  const sortedCampaigns = useMemo(() => [...campaigns].sort((first, second) => new Date(second.updated_at || 0) - new Date(first.updated_at || 0)), [campaigns]);
  const savedAudience = selectedCampaign ? getCampaignAudience(selectedCampaign) : { rules: DEFAULT_AUDIENCE_RULES, eligible_count: null, calculated_at: null };
  const displayedAudience = audiencePreview || savedAudience;
  const selectedIsArchived = selectedCampaign?.status === "archived";
  const hasSavedAudience = Boolean(savedAudience.calculated_at && savedAudience.rules);

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

  async function loadAudienceOptions() {
    try {
      setAudienceOptions(await getMarketingCampaignAudienceOptions());
    } catch (optionsError) {
      setAudienceError(optionsError.message || "Could not load audience filter options.");
    }
  }

  async function loadBatches(campaign) {
    if (!campaign) return;
    setBatchError("");
    try {
      const response = await listMarketingCampaignBatchHistory(campaign);
      setBatches(response.batches || []);
      setBatchSummary({ ...EMPTY_BATCH_SUMMARY, ...(response.summary || {}) });
    } catch (loadError) {
      setBatches([]);
      setBatchSummary(EMPTY_BATCH_SUMMARY);
      setBatchError(loadError.message || "Could not load campaign batches.");
    }
  }

  useEffect(() => { loadCampaigns(); }, [includeArchived]);
  useEffect(() => { loadAudienceOptions(); }, []);

  function setAudienceRule(key, value) {
    setAudienceRules((current) => ({ ...current, [key]: value }));
    setAudienceDirty(true);
    setAudiencePreview(null);
  }

  function toggleAudienceTag(key, tag) {
    setAudienceRules((current) => {
      const values = new Set(current[key] || []);
      if (values.has(tag)) values.delete(tag);
      else values.add(tag);
      return { ...current, [key]: [...values].sort() };
    });
    setAudienceDirty(true);
    setAudiencePreview(null);
  }

  function resetAudienceState(campaign) {
    const audience = getCampaignAudience(campaign);
    setAudienceRules(audience.rules);
    setAudiencePreview(null);
    setAudienceDirty(false);
    setAudienceError("");
  }

  function resetBatchState() {
    setBatches([]);
    setBatchSummary(EMPTY_BATCH_SUMMARY);
    setBatchPreview(null);
    setBatchSizeMode(100);
    setCustomBatchSize(100);
    setBatchLoading(false);
    setBatchActionId("");
    setBatchError("");
    setBatchConfirm(false);
  }

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
    resetAudienceState(campaign);
    resetBatchState();
    setModalMode("view");
    loadBatches(campaign);
  }

  function closeModal() {
    setModalMode("");
    setSelectedCampaign(null);
    setFormError("");
    setAudienceError("");
    resetBatchState();
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

  async function handlePreviewAudience() {
    if (!selectedCampaign || selectedIsArchived) return;
    setAudienceLoading(true);
    setAudienceError("");
    try {
      const audience = await previewMarketingCampaignAudience(selectedCampaign, audienceRules);
      setAudiencePreview(audience);
      setAudienceDirty(false);
    } catch (previewError) {
      setAudienceError(previewError.message || "Could not preview audience.");
    } finally {
      setAudienceLoading(false);
    }
  }

  async function handleSaveAudience() {
    if (!selectedCampaign || selectedIsArchived) return;
    setAudienceLoading(true);
    setAudienceError("");
    try {
      const response = await saveMarketingCampaignAudience(selectedCampaign, audienceRules);
      setSelectedCampaign(response.campaign);
      setAudiencePreview(response.audience);
      setAudienceDirty(false);
      setBatchPreview(null);
      setBatchConfirm(false);
      await loadCampaigns();
    } catch (saveError) {
      setAudienceError(saveError.message || "Could not save audience rules.");
    } finally {
      setAudienceLoading(false);
    }
  }

  async function handlePreviewBatch() {
    if (!selectedCampaign || selectedIsArchived) return;
    const requestedSize = getRequestedBatchSize(batchSizeMode, customBatchSize);
    setBatchLoading(true);
    setBatchError("");
    setBatchConfirm(false);
    try {
      setBatchPreview(await previewMarketingCampaignBatch(selectedCampaign, requestedSize));
    } catch (previewError) {
      setBatchPreview(null);
      setBatchError(previewError.message || "Could not preview next batch.");
    } finally {
      setBatchLoading(false);
    }
  }

  async function handleGenerateBatch() {
    if (!selectedCampaign || selectedIsArchived || !batchPreview || !batchConfirm) return;
    const requestedSize = getRequestedBatchSize(batchSizeMode, customBatchSize);
    setBatchLoading(true);
    setBatchError("");
    try {
      await generateMarketingCampaignBatch(selectedCampaign, requestedSize);
      setBatchPreview(null);
      setBatchConfirm(false);
      await Promise.all([loadBatches(selectedCampaign), loadCampaigns()]);
    } catch (generateError) {
      setBatchError(generateError.message || "Could not generate campaign batch.");
    } finally {
      setBatchLoading(false);
    }
  }

  async function handleExportBatch(batch) {
    if (!selectedCampaign || !batch) return;
    const confirmExport = batch.status === "exported" ? window.confirm(`Batch #${batch.batch_number} has already been exported. Export it again?`) : true;
    if (!confirmExport) return;
    setBatchActionId(batch.id);
    setBatchError("");
    try {
      const result = await exportMarketingCampaignBatch(batch, { confirmExport });
      downloadCsvFile(result.csv);
      await Promise.all([loadBatches(selectedCampaign), loadCampaigns()]);
    } catch (exportError) {
      setBatchError(exportError.message || "Could not export campaign batch.");
    } finally {
      setBatchActionId("");
    }
  }

  async function handleDownloadBatch(batch) {
    if (!batch) return;
    setBatchActionId(batch.id);
    setBatchError("");
    try {
      const result = await downloadMarketingCampaignBatchCsv(batch);
      downloadCsvFile(result.csv);
    } catch (downloadError) {
      setBatchError(downloadError.message || "Could not download campaign batch CSV.");
    } finally {
      setBatchActionId("");
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
        {!hasCampaigns ? <div className="empty-state"><strong>No campaigns yet.</strong><p>Create your first campaign to start building an audience.</p><button type="button" className="button button--primary" onClick={() => openCreateCampaign()}>Create Campaign</button></div> : <TableShell><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>{["Name", "Channel", "Objective", "Status", "Audience", "Batches", "Created", "Last Updated", "Actions"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #dbe2ea", color: "#475569" }}>{heading}</th>)}</tr></thead><tbody>{sortedCampaigns.map((campaign) => <tr key={campaign.id}><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>{campaign.name}<br /><small style={{ color: "#64748b" }}>{campaign.description || "No description"}</small></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><TonePill tone={channelTones[campaign.channel]}>{channelLabels[campaign.channel] || campaign.channel}</TonePill></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{objectiveLabels[campaign.objective] || campaign.objective}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><TonePill tone={statusTones[campaign.status]}>{statusLabels[campaign.status] || campaign.status}</TonePill></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{getAudienceStatus(campaign)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{getBatchStatus(campaign)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{formatDate(campaign.created_at)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{formatDate(campaign.updated_at)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><div className="card-actions" style={{ gap: 6 }}><button type="button" className="button button--ghost" onClick={() => openViewCampaign(campaign)}>View</button><button type="button" className="button button--ghost" onClick={() => openEditCampaign(campaign)}>Edit</button><button type="button" className="button button--danger" disabled={campaign.status === "archived"} onClick={() => handleArchiveCampaign(campaign)}>Archive</button></div></td></tr>)}</tbody></table></TableShell>}
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
      {modalMode === "view" && selectedCampaign ? <Modal title="Campaign Detail" onClose={closeModal}><div className="field-grid">{[["Campaign Name", selectedCampaign.name], ["Description", selectedCampaign.description || "-"], ["Channel", channelLabels[selectedCampaign.channel] || selectedCampaign.channel], ["Objective", objectiveLabels[selectedCampaign.objective] || selectedCampaign.objective], ["Status", statusLabels[selectedCampaign.status] || selectedCampaign.status], ["Audience", displayedAudience.eligible_count === null ? "Not selected" : `${formatNumber(displayedAudience.eligible_count)} eligible`], ["Batches", getBatchStatus({ ...selectedCampaign, batch_summary: batchSummary })], ["Provider", "Not selected"], ["Created", formatDate(selectedCampaign.created_at)], ["Last Updated", formatDate(selectedCampaign.updated_at)]].map(([label, value]) => <div key={label} className="field"><span className="field__label">{label}</span><div className="field__input">{value}</div></div>)}{selectedCampaign.archived_at ? <div className="field"><span className="field__label">Archived</span><div className="field__input">{formatDate(selectedCampaign.archived_at)}</div></div> : null}</div><section className="panel panel--nested" style={{ boxShadow: "none", marginTop: 16 }}><div className="panel__header"><div><h3>Audience Builder</h3><p>This is a live preview. Customers are not assigned to this campaign until a future batch is generated.</p></div>{selectedIsArchived ? <span className="status-pill">Read Only</span> : null}</div><div className="field-grid"><div className="field"><span className="field__label">Campaign Channel</span><div className="field__input">{channelLabels[selectedCampaign.channel]}</div></div><div className="field"><span className="field__label">Automatic Readiness Rule</span><div className="field__input">{channelRequirementLabels[selectedCampaign.channel]}</div></div><label className="field"><span className="field__label">Pipeline</span><select className="field__input" disabled={selectedIsArchived} value={audienceRules.pipeline} onChange={(event) => setAudienceRule("pipeline", event.target.value)}>{Object.entries(pipelineLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">Source</span><select className="field__input" disabled={selectedIsArchived} value={audienceRules.source} onChange={(event) => setAudienceRule("source", event.target.value)}><option value="all">All Sources</option>{audienceOptions.sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label><label className="field"><span className="field__label">Last Seen / Last Activity</span><select className="field__input" disabled={selectedIsArchived} value={audienceRules.last_seen_period} onChange={(event) => setAudienceRule("last_seen_period", event.target.value)}>{Object.entries(lastSeenLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">Customer Created</span><select className="field__input" disabled={selectedIsArchived} value={audienceRules.created_period} onChange={(event) => setAudienceRule("created_period", event.target.value)}>{Object.entries(createdLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="toggle-row" style={{ marginTop: 20 }}><input type="checkbox" disabled={selectedIsArchived} checked={audienceRules.exclude_unknown_pipeline} onChange={(event) => setAudienceRule("exclude_unknown_pipeline", event.target.checked)} />Exclude Unknown Pipeline</label><div className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Required Tags - matches any selected tag</span><div className="card-actions">{audienceOptions.tags.length ? audienceOptions.tags.map((tag) => <button key={tag} type="button" disabled={selectedIsArchived} className={(audienceRules.required_tags || []).includes(tag) ? "button button--primary" : "button button--ghost"} onClick={() => toggleAudienceTag("required_tags", tag)}>{tag}</button>) : <span style={{ color: "#64748b" }}>No existing tags found.</span>}</div></div><div className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Excluded Tags - removes any selected tag</span><div className="card-actions">{audienceOptions.tags.length ? audienceOptions.tags.map((tag) => <button key={tag} type="button" disabled={selectedIsArchived} className={(audienceRules.exclude_tags || []).includes(tag) ? "button button--primary" : "button button--ghost"} onClick={() => toggleAudienceTag("exclude_tags", tag)}>{tag}</button>) : <span style={{ color: "#64748b" }}>No existing tags found.</span>}</div></div></div><div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 14 }}><div className="stat-card"><div className="stat-card__label">Eligible Customers</div><div className="stat-card__value">{displayedAudience.eligible_count === null ? "-" : formatNumber(displayedAudience.eligible_count)}</div></div><div className="stat-card"><div className="stat-card__label">Channel Requirement</div><div className="stat-card__value" style={{ fontSize: 22 }}>{channelRequirementLabels[selectedCampaign.channel]}</div></div><div className="stat-card"><div className="stat-card__label">Last Calculated</div><div className="stat-card__value" style={{ fontSize: 22 }}>{formatDate(displayedAudience.calculated_at)}</div></div></div>{audienceDirty || !sameRules(audienceRules, savedAudience.rules) ? <div className="notice" style={{ marginTop: 12 }}>Needs Recalculation. Preview again before using this count.</div> : null}{audienceError ? <div className="notice notice--error" style={{ marginTop: 12 }}>{audienceError}</div> : null}<div className="card-actions" style={{ marginTop: 14 }}><button type="button" className="button button--primary" disabled={selectedIsArchived || audienceLoading} onClick={handlePreviewAudience}>{audienceLoading ? "Calculating..." : "Preview Audience"}</button><button type="button" className="button button--ghost" disabled={selectedIsArchived || audienceLoading} onClick={handleSaveAudience}>Save Audience Rules</button></div></section><BatchSection batches={batches} batchSummary={batchSummary} batchPreview={batchPreview} batchSizeMode={batchSizeMode} customBatchSize={customBatchSize} batchLoading={batchLoading} batchActionId={batchActionId} batchError={batchError} batchConfirm={batchConfirm} isArchived={selectedIsArchived} hasSavedAudience={hasSavedAudience} onSizeModeChange={(value) => { setBatchSizeMode(value); setBatchPreview(null); setBatchConfirm(false); }} onCustomSizeChange={(value) => { setCustomBatchSize(value); setBatchPreview(null); setBatchConfirm(false); }} onPreview={handlePreviewBatch} onGenerate={handleGenerateBatch} onExport={handleExportBatch} onDownload={handleDownloadBatch} onConfirmChange={setBatchConfirm} /></Modal> : null}
    </div>
  );
}
