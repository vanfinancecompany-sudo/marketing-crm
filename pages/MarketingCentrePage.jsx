import { useEffect, useMemo, useState } from "react";
import StatCard from "../components/StatCard.jsx";
import {
  archiveMarketingCampaign,
  createMarketingCampaign,
  downloadMarketingCampaignBatchCsv,
  exportMarketingCampaignBatch,
  generateMarketingCampaignBatch,
  getMarketingCampaignAudienceOptions,
  getMarketingCampaignDashboard,
  getMarketingOpportunities,
  listMarketingCampaignBatchHistory,
  listMarketingCampaigns,
  previewMarketingCampaignAudience,
  previewMarketingCampaignBatch,
  previewMarketingCampaignDraftAudience,
  saveMarketingCampaignAudience,
  updateMarketingCampaign,
} from "../services/marketingCampaigns.js";

const EMPTY_CAMPAIGN_FORM = { name: "", description: "", channel: "email", objective: "custom", status: "draft" };
const EMPTY_CAMPAIGN_STATS = { total: 0, draft: 0, active: 0, completed: 0, archived: 0, total_customers_batched: 0, total_customers_exported: 0, pending_batches: 0 };
const DEFAULT_AUDIENCE_RULES = { pipeline: "all", source: "all", required_tags: [], exclude_tags: [], last_seen_period: "all", created_period: "all", exclude_unknown_pipeline: false };
const EMPTY_BATCH_SUMMARY = { total_batches: 0, total_customers_batched: 0, total_customers_exported: 0, pending_batches: 0, last_batch_created_at: "", last_exported_at: "", last_activity_at: "" };
const EMPTY_BATCH_PREVIEW = { eligible_count: 0, already_batched: 0, remaining_count: 0, requested_size: 100, selected_count: 0, next_batch_number: 1, total_batches: 0, total_customers_batched: 0 };
const EMPTY_CAMPAIGN_DASHBOARD = { eligible_now: 0, customers_batched: 0, customers_exported: 0, customers_remaining: 0, batches_generated: 0, pending_batches: 0, estimated_batches_left: 0, preferred_batch_size: 1000, last_exported_at: "", last_activity_at: "", progress_percent: 0, preview: null };
const BATCH_SIZE_PRESETS = [100, 250, 500, 1000];
const DASHBOARD_BATCH_SIZE_PRESETS = [100, 250, 500, 1000];
const WIZARD_STEPS = ["Channel", "Details", "Audience", "Review", "Finish"];

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
  ["Total Customers Batched", "total_customers_batched", "blue"],
  ["Total Customers Exported", "total_customers_exported", "green"],
  ["Pending Batches", "pending_batches", "amber"],
];

const channelLabels = { email: "Email", sms: "SMS", facebook: "Facebook" };
const objectiveLabels = { new_stock: "New Stock", promotion: "Promotion", finance_offer: "Finance Offer", rent2buy: "Rent2Buy", re_engagement: "Re-engagement", custom: "Custom" };
const statusLabels = { draft: "Draft", ready: "Ready", running: "Running", paused: "Paused", completed: "Completed", archived: "Archived" };
const statusTones = { draft: "default", ready: "blue", running: "green", paused: "amber", completed: "green", archived: "default" };
const channelTones = { email: "blue", sms: "green", facebook: "default" };
const batchStatusTones = { pending: "amber", exported: "green", sent: "green", cancelled: "default" };
const channelRequirementLabels = { email: "Email Ready", sms: "SMS Ready", facebook: "Facebook Ready: email and/or mobile" };
const pipelineLabels = { all: "All", finance: "Finance", rent2buy: "Rent2Buy", both: "Both" };
const lastSeenLabels = { all: "Any time", last30: "Last 30 days", last90: "Last 90 days", last180: "Last 180 days", last365: "Last 365 days", more_than_180: "More than 180 days ago" };
const createdLabels = { all: "Any time", today: "Today", last7: "Last 7 days", last30: "Last 30 days", last90: "Last 90 days", this_year: "This year" };
const channelDescriptions = {
  email: "Build an email-ready audience and prepare controlled export batches.",
  sms: "Prepare UK mobile-ready customers for future SMS campaign batches.",
  facebook: "Create a Facebook-ready audience using email and/or mobile match identifiers.",
};

const channels = [
  { title: "Email Campaigns", description: "Prepare email audiences and controlled campaign batches.", actionLabel: "Create Email Campaign" },
  { title: "SMS Campaigns", description: "Prepare UK mobile audiences for text campaign batches.", actionLabel: "Create SMS Campaign" },
  { title: "Facebook Audiences", description: "Prepare matched customer audiences for Facebook advertising.", actionLabel: "Create Facebook Audience" },
];

const quickActions = [
  { label: "Create Email Campaign", action: "create" },
  { label: "Create SMS Campaign", action: "create" },
  { label: "Create Facebook Audience", action: "create" },
  { label: "View Campaigns", action: "view" },
  { label: "Campaign Templates", action: "soon" },
  { label: "Export Centre", action: "soon" },
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
  return <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 18, background: "rgba(15, 23, 42, 0.48)" }}><div className="panel" style={{ width: "min(980px, 100%)", maxHeight: "88vh", overflow: "auto" }}><div className="panel__header"><div><div className="eyebrow">{eyebrow}</div><h3>{title}</h3></div><button type="button" className="button button--ghost" onClick={onClose}>Close</button></div>{children}</div></div>;
}

function TonePill({ children, tone = "default" }) {
  return <span className={`status-pill stat-card--${tone}`}>{children}</span>;
}

function CampaignForm({ form, setForm, error, onSubmit, submitLabel, isArchived = false }) {
  return <form onSubmit={onSubmit} className="field-grid"><label className="field"><span className="field__label">Campaign Name</span><input className="field__input" value={form.name} onChange={(event) => updateFormValue(setForm, "name", event.target.value)} required /></label><label className="field"><span className="field__label">Channel</span><select className="field__input" value={form.channel} onChange={(event) => updateFormValue(setForm, "channel", event.target.value)}><option value="email">Email</option><option value="sms">SMS</option><option value="facebook">Facebook</option></select></label><label className="field"><span className="field__label">Objective</span><select className="field__input" value={form.objective} onChange={(event) => updateFormValue(setForm, "objective", event.target.value)}><option value="new_stock">New Stock</option><option value="promotion">Promotion</option><option value="finance_offer">Finance Offer</option><option value="rent2buy">Rent2Buy</option><option value="re_engagement">Re-engagement</option><option value="custom">Custom</option></select></label>{submitLabel === "Save Campaign" ? isArchived ? <div className="field"><span className="field__label">Status</span><div className="field__input">Archived</div></div> : <label className="field"><span className="field__label">Status</span><select className="field__input" value={form.status} onChange={(event) => updateFormValue(setForm, "status", event.target.value)}><option value="draft">Draft</option><option value="ready">Ready</option><option value="running">Running</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label> : null}<label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Description</span><textarea className="field__input" rows={4} value={form.description} onChange={(event) => updateFormValue(setForm, "description", event.target.value)} /></label>{isArchived ? <div className="notice" style={{ gridColumn: "1 / -1" }}>Archived campaigns can be edited for notes and metadata, but this PR does not add restore.</div> : null}<div className="card-actions" style={{ gridColumn: "1 / -1" }}><button type="submit" className="button button--primary">{submitLabel}</button></div>{error ? <div className="notice notice--error" style={{ gridColumn: "1 / -1" }}>{error}</div> : null}</form>;
}

function getCampaignAudience(campaign) {
  const audience = campaign?.metadata?.audience || {};
  return { rules: { ...DEFAULT_AUDIENCE_RULES, ...(audience.rules || {}) }, eligible_count: Number.isFinite(Number(audience.eligible_count)) ? Number(audience.eligible_count) : null, calculated_at: audience.calculated_at || null };
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

function getCampaignProgress(campaign) {
  const summary = campaign?.batch_summary || EMPTY_BATCH_SUMMARY;
  const batched = Number(summary.total_customers_batched || 0);
  const audience = getCampaignAudience(campaign);
  const eligible = Number(audience.eligible_count || 0);
  const remaining = Math.max(0, eligible - batched);
  const denominator = batched + remaining;
  return denominator ? Math.round((batched / denominator) * 100) : 0;
}

function getCampaignLastActivity(campaign) {
  return campaign?.batch_summary?.last_activity_at || campaign?.updated_at || "";
}

function getLowestPendingBatch(batches = []) {
  return [...batches].filter((batch) => batch.status === "pending").sort((first, second) => Number(first.batch_number || 0) - Number(second.batch_number || 0))[0] || null;
}

function getDashboardRecommendation(campaign, dashboard, batches = []) {
  if (campaign?.status === "archived") return { label: "Archived - Read Only", action: "none" };
  if (campaign?.status === "completed") return { label: "Completed", action: "none" };
  if (!campaign?.metadata?.audience?.rules) return { label: "Configure Audience", action: "audience" };
  if (!campaign?.metadata?.audience?.calculated_at) return { label: "Preview Audience", action: "previewAudience" };
  if (getLowestPendingBatch(batches)) return { label: "Export Pending Batch", action: "exportPending" };
  if (Number(dashboard?.customers_remaining || 0) > 0) return { label: "Generate Next Batch", action: "batch" };
  return { label: "Audience Fully Batched", action: "none" };
}

function getRequestedBatchSize(mode, customSize) {
  return mode === "custom" ? Number(customSize || 0) : Number(mode || 0);
}

function sameRules(first, second) {
  return JSON.stringify(first || {}) === JSON.stringify(second || {});
}

function buildRuleSummary(rules) {
  const safeRules = { ...DEFAULT_AUDIENCE_RULES, ...(rules || {}) };
  return [
    `Pipeline: ${pipelineLabels[safeRules.pipeline] || safeRules.pipeline}`,
    `Source: ${safeRules.source === "all" ? "All Sources" : safeRules.source}`,
    `Required tags: ${safeRules.required_tags?.length ? safeRules.required_tags.join(", ") : "None"}`,
    `Excluded tags: ${safeRules.exclude_tags?.length ? safeRules.exclude_tags.join(", ") : "None"}`,
    `Last activity: ${lastSeenLabels[safeRules.last_seen_period] || safeRules.last_seen_period}`,
    `Created: ${createdLabels[safeRules.created_period] || safeRules.created_period}`,
    safeRules.exclude_unknown_pipeline ? "Unknown pipeline excluded" : "Unknown pipeline included",
  ];
}

function StepIndicator({ currentStep }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginBottom: 18 }}>{WIZARD_STEPS.map((step, index) => <div key={step} style={{ display: "grid", gap: 6 }}><div style={{ height: 4, borderRadius: 999, background: index <= currentStep ? "#2563eb" : "#dbe2ea" }} /><div style={{ display: "flex", alignItems: "center", gap: 8, color: index === currentStep ? "#0f172a" : "#64748b", fontWeight: index === currentStep ? 800 : 600 }}><span className={index < currentStep ? "status-pill stat-card--green" : index === currentStep ? "status-pill stat-card--blue" : "status-pill"}>{index < currentStep ? "✓" : index + 1}</span><span>{step}</span></div></div>)}</div>;
}

function AudienceBuilderSection({ title = "Audience Builder", campaign, rules, preview, savedAudience, dirty, error, loading, options, isReadOnly, onRuleChange, onTagToggle, onPreview, onSave, showSave = true }) {
  const displayedAudience = preview || savedAudience || { eligible_count: null, calculated_at: null, rules };
  return <section id="campaign-audience-builder" className="panel panel--nested" style={{ boxShadow: "none", marginTop: 16 }}><div className="panel__header"><div><h3>{title}</h3><p>This is a live preview. Customers are not assigned to this campaign until a future batch is generated.</p></div>{isReadOnly ? <span className="status-pill">Read Only</span> : null}</div><div className="field-grid"><div className="field"><span className="field__label">Campaign Channel</span><div className="field__input">{channelLabels[campaign.channel]}</div></div><div className="field"><span className="field__label">Automatic Readiness Rule</span><div className="field__input">{channelRequirementLabels[campaign.channel]}</div></div><label className="field"><span className="field__label">Pipeline</span><select className="field__input" disabled={isReadOnly} value={rules.pipeline} onChange={(event) => onRuleChange("pipeline", event.target.value)}>{Object.entries(pipelineLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">Source</span><select className="field__input" disabled={isReadOnly} value={rules.source} onChange={(event) => onRuleChange("source", event.target.value)}><option value="all">All Sources</option>{options.sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label><label className="field"><span className="field__label">Last Seen / Last Activity</span><select className="field__input" disabled={isReadOnly} value={rules.last_seen_period} onChange={(event) => onRuleChange("last_seen_period", event.target.value)}>{Object.entries(lastSeenLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">Customer Created</span><select className="field__input" disabled={isReadOnly} value={rules.created_period} onChange={(event) => onRuleChange("created_period", event.target.value)}>{Object.entries(createdLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="toggle-row" style={{ marginTop: 20 }}><input type="checkbox" disabled={isReadOnly} checked={rules.exclude_unknown_pipeline} onChange={(event) => onRuleChange("exclude_unknown_pipeline", event.target.checked)} />Exclude Unknown Pipeline</label><div className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Required Tags - matches any selected tag</span><div className="card-actions">{options.tags.length ? options.tags.map((tag) => <button key={tag} type="button" disabled={isReadOnly} className={(rules.required_tags || []).includes(tag) ? "button button--primary" : "button button--ghost"} onClick={() => onTagToggle("required_tags", tag)}>{tag}</button>) : <span style={{ color: "#64748b" }}>No existing tags found.</span>}</div></div><div className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Excluded Tags - removes any selected tag</span><div className="card-actions">{options.tags.length ? options.tags.map((tag) => <button key={tag} type="button" disabled={isReadOnly} className={(rules.exclude_tags || []).includes(tag) ? "button button--primary" : "button button--ghost"} onClick={() => onTagToggle("exclude_tags", tag)}>{tag}</button>) : <span style={{ color: "#64748b" }}>No existing tags found.</span>}</div></div></div><div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 14 }}><div className="stat-card"><div className="stat-card__label">Eligible Customers</div><div className="stat-card__value">{displayedAudience.eligible_count === null ? "-" : formatNumber(displayedAudience.eligible_count)}</div></div><div className="stat-card"><div className="stat-card__label">Channel Requirement</div><div className="stat-card__value" style={{ fontSize: 22 }}>{channelRequirementLabels[campaign.channel]}</div></div><div className="stat-card"><div className="stat-card__label">Last Calculated</div><div className="stat-card__value" style={{ fontSize: 22 }}>{formatDate(displayedAudience.calculated_at)}</div></div></div><div className="notice" style={{ marginTop: 12 }}><strong>Saved Rules</strong><br />{buildRuleSummary(rules).join(" | ")}</div>{dirty || !sameRules(rules, savedAudience?.rules) ? <div className="notice" style={{ marginTop: 12 }}>Needs Recalculation. Preview again before using this count.</div> : null}{error ? <div className="notice notice--error" style={{ marginTop: 12 }}>{error}</div> : null}<div className="card-actions" style={{ marginTop: 14 }}><button type="button" className="button button--primary" disabled={isReadOnly || loading} onClick={onPreview}>{loading ? "Calculating..." : "Preview Audience"}</button>{showSave ? <button type="button" className="button button--ghost" disabled={isReadOnly || loading} onClick={onSave}>Save Audience Rules</button> : null}</div></section>;
}

function BatchSection({ batches, batchSummary, batchPreview, batchSizeMode, customBatchSize, batchLoading, batchActionId, batchError, batchConfirm, isArchived, hasSavedAudience, onSizeModeChange, onCustomSizeChange, onPreview, onGenerate, onExport, onDownload, onConfirmChange }) {
  const safeSummary = batchSummary || EMPTY_BATCH_SUMMARY;
  const preview = batchPreview || EMPTY_BATCH_PREVIEW;
  const requestedSize = getRequestedBatchSize(batchSizeMode, customBatchSize);
  const canPreview = !isArchived && hasSavedAudience && requestedSize >= 1 && requestedSize <= 5000;
  const canGenerate = canPreview && batchPreview && batchPreview.selected_count > 0 && batchConfirm;
  return <section id="campaign-batches" className="panel panel--nested" style={{ boxShadow: "none", marginTop: 16 }}><div className="panel__header"><div><h3>Campaign Batches</h3><p>Existing batches are permanent export batches. Updated audience rules apply only to future batches.</p></div>{isArchived ? <span className="status-pill">Read Only</span> : null}</div><div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}><div className="stat-card"><div className="stat-card__label">Customers Remaining</div><div className="stat-card__value">{batchPreview ? formatNumber(preview.remaining_count) : "-"}</div></div><div className="stat-card"><div className="stat-card__label">Customers Batched</div><div className="stat-card__value">{formatNumber(safeSummary.total_customers_batched)}</div></div><div className="stat-card"><div className="stat-card__label">Customers Exported</div><div className="stat-card__value">{formatNumber(safeSummary.total_customers_exported)}</div></div><div className="stat-card"><div className="stat-card__label">Batches Generated</div><div className="stat-card__value">{formatNumber(safeSummary.total_batches)}</div></div><div className="stat-card"><div className="stat-card__label">Eligible Now</div><div className="stat-card__value">{batchPreview ? formatNumber(preview.eligible_count) : "-"}</div></div></div>{!hasSavedAudience ? <div className="notice" style={{ marginTop: 12 }}>Save and preview an audience before generating campaign batches.</div> : null}{safeSummary.migration_required ? <div className="notice" style={{ marginTop: 12 }}>Campaign batch migration has not been applied yet.</div> : null}<div className="field-grid" style={{ marginTop: 14 }}><div className="field"><span className="field__label">Batch size</span><div className="card-actions">{BATCH_SIZE_PRESETS.map((size) => <button key={size} type="button" disabled={isArchived || batchLoading} className={String(batchSizeMode) === String(size) ? "button button--primary" : "button button--ghost"} onClick={() => onSizeModeChange(size)}>{formatNumber(size)}</button>)}<button type="button" disabled={isArchived || batchLoading} className={batchSizeMode === "custom" ? "button button--primary" : "button button--ghost"} onClick={() => onSizeModeChange("custom")}>Custom</button></div></div>{batchSizeMode === "custom" ? <label className="field"><span className="field__label">Custom size</span><input className="field__input" type="number" min="1" max="5000" value={customBatchSize} disabled={isArchived || batchLoading} onChange={(event) => onCustomSizeChange(event.target.value)} /></label> : null}</div>{batchPreview ? <div className="notice" style={{ marginTop: 12 }}><strong>Batch confirmation</strong><br />Eligible now: {formatNumber(preview.eligible_count)}<br />Already batched: {formatNumber(preview.already_batched)}<br />Remaining: {formatNumber(preview.remaining_count)}<br />Requested size: {formatNumber(preview.requested_size)}<br />Batch to create: {formatNumber(preview.selected_count)}<br />Next batch: {formatNumber(preview.next_batch_number)}</div> : null}<label className="toggle-row" style={{ marginTop: 12 }}><input type="checkbox" checked={batchConfirm} disabled={!batchPreview || isArchived || batchLoading} onChange={(event) => onConfirmChange(event.target.checked)} />I understand this batch is a permanent snapshot.</label>{batchError ? <div className="notice notice--error" style={{ marginTop: 12 }}>{batchError}</div> : null}<div className="card-actions" style={{ marginTop: 14 }}><button type="button" className="button button--ghost" disabled={!canPreview || batchLoading} onClick={onPreview}>{batchLoading ? "Working..." : "Preview Batch"}</button><button type="button" className="button button--primary" disabled={!canGenerate || batchLoading} onClick={onGenerate}>Generate Batch</button></div><div style={{ marginTop: 14 }}><TableShell><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>{["Batch #", "Created", "Customers", "Status", "Exported", "Export", "Download"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #dbe2ea", color: "#475569" }}>{heading}</th>)}</tr></thead><tbody>{batches.length === 0 ? <tr><td colSpan={7} style={{ padding: 18, color: "#64748b" }}>No batches yet.</td></tr> : batches.map((batch) => <tr key={batch.id}><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>#{batch.batch_number}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{formatDate(batch.created_at)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(batch.customer_count)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><TonePill tone={batchStatusTones[batch.status]}>{batch.status === "exported" ? "Exported" : "Pending"}</TonePill></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{batch.exported_at ? formatDate(batch.exported_at) : "-"}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><button type="button" className="button button--ghost" disabled={isArchived || batchActionId === batch.id} onClick={() => onExport(batch)}>{batchActionId === batch.id ? "Working..." : batch.status === "exported" ? "Export Again" : "Export CSV"}</button></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><button type="button" className="button button--ghost" disabled={batch.status !== "exported" || batchActionId === batch.id} onClick={() => onDownload(batch)}>Download</button></td></tr>)}</tbody></table></TableShell></div></section>;
}

function CampaignDashboardSection({ campaign, dashboard, batches, loading, error, batchSizeMode, customBatchSize, onSizeModeChange, onCustomSizeChange, onRefresh, onPreviewAudience, onExportBatch }) {
  const safeDashboard = { ...EMPTY_CAMPAIGN_DASHBOARD, ...(dashboard || {}) };
  const recommendation = getDashboardRecommendation(campaign, safeDashboard, batches);
  const pendingBatch = getLowestPendingBatch(batches);
  const requestedSize = getRequestedBatchSize(batchSizeMode, customBatchSize);
  const progress = Math.max(0, Math.min(100, Number(safeDashboard.progress_percent || 0)));
  const actionDisabled = loading || recommendation.action === "none" || (recommendation.action === "exportPending" && !pendingBatch);
  function handleAction() {
    if (recommendation.action === "audience") document.getElementById("campaign-audience-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (recommendation.action === "previewAudience") onPreviewAudience();
    if (recommendation.action === "batch") document.getElementById("campaign-batches")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (recommendation.action === "exportPending" && pendingBatch) onExportBatch(pendingBatch);
  }
  return <section className="panel panel--nested" style={{ boxShadow: "none", marginTop: 16 }}><div className="panel__header"><div><h3>Campaign Dashboard</h3><p>Live progress combines current audience eligibility with permanent generated batches.</p></div><button type="button" className="button button--ghost" disabled={loading || requestedSize < 1 || requestedSize > 5000} onClick={onRefresh}>{loading ? "Refreshing..." : "Refresh"}</button></div>{error ? <div className="notice notice--error" style={{ marginBottom: 12 }}>{error}</div> : null}<div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}><div className="stat-card"><div className="stat-card__label">Eligible Now</div><div className="stat-card__value">{formatNumber(safeDashboard.eligible_now)}</div></div><div className="stat-card"><div className="stat-card__label">Customers Batched</div><div className="stat-card__value">{formatNumber(safeDashboard.customers_batched)}</div></div><div className="stat-card"><div className="stat-card__label">Customers Exported</div><div className="stat-card__value">{formatNumber(safeDashboard.customers_exported)}</div></div><div className="stat-card"><div className="stat-card__label">Customers Remaining</div><div className="stat-card__value">{formatNumber(safeDashboard.customers_remaining)}</div></div><div className="stat-card"><div className="stat-card__label">Batches Generated</div><div className="stat-card__value">{formatNumber(safeDashboard.batches_generated)}</div></div><div className="stat-card"><div className="stat-card__label">Estimated Batches Left</div><div className="stat-card__value">{formatNumber(safeDashboard.estimated_batches_left)}</div></div><div className="stat-card"><div className="stat-card__label">Last Export</div><div className="stat-card__value" style={{ fontSize: 20 }}>{safeDashboard.last_exported_at ? formatDate(safeDashboard.last_exported_at) : "Never"}</div></div><div className="stat-card"><div className="stat-card__label">Progress</div><div className="stat-card__value">{progress}%</div></div></div><div style={{ marginTop: 14 }}><div style={{ height: 10, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}><div style={{ width: `${progress}%`, height: "100%", background: "#2563eb" }} /></div><p style={{ color: "#64748b", fontSize: 13, marginTop: 8 }}>Counts are live for eligibility and permanent for generated/exported batch snapshots.</p></div><div className="field-grid" style={{ marginTop: 14 }}><div className="field"><span className="field__label">Preferred batch size for estimate</span><div className="card-actions">{DASHBOARD_BATCH_SIZE_PRESETS.map((size) => <button key={size} type="button" disabled={loading} className={String(batchSizeMode) === String(size) ? "button button--primary" : "button button--ghost"} onClick={() => onSizeModeChange(size)}>{formatNumber(size)}</button>)}<button type="button" disabled={loading} className={batchSizeMode === "custom" ? "button button--primary" : "button button--ghost"} onClick={() => onSizeModeChange("custom")}>Custom</button></div></div>{batchSizeMode === "custom" ? <label className="field"><span className="field__label">Custom estimate size</span><input className="field__input" type="number" min="1" max="5000" value={customBatchSize} disabled={loading} onChange={(event) => onCustomSizeChange(event.target.value)} /></label> : null}</div><div className="panel panel--nested" style={{ boxShadow: "none", marginTop: 14 }}><div className="panel__header"><div><h3>Quick Operations</h3><p>Recommended next action: <strong>{recommendation.label}</strong></p></div><button type="button" className="button button--primary" disabled={actionDisabled} onClick={handleAction}>{recommendation.label}</button></div><div className="card-actions"><button type="button" className="button button--ghost" onClick={() => document.getElementById("campaign-batches")?.scrollIntoView({ behavior: "smooth", block: "start" })}>View Batch History</button></div></div></section>;
}

function CampaignWizard({ form, setForm, step, setStep, audienceRules, setAudienceRules, audiencePreview, setAudiencePreview, audienceDirty, setAudienceDirty, audienceLoading, audienceError, audienceOptions, opportunity, createdCampaign, creating, createError, batchSizeMode, customBatchSize, onPreviewAudience, onCreate, onCancel, onOpenCampaign }) {
  const batchSize = getRequestedBatchSize(batchSizeMode, customBatchSize);
  const estimatedBatches = audiencePreview?.eligible_count ? Math.ceil(Number(audiencePreview.eligible_count || 0) / Math.max(1, batchSize || 1)) : 0;
  const canGoNext = step === 0 ? Boolean(form.channel) : step === 1 ? Boolean(form.name.trim() && form.objective) : step === 2 ? Boolean(audiencePreview?.calculated_at && !audienceDirty) : true;
  function setRule(key, value) {
    setAudienceRules((current) => ({ ...current, [key]: value }));
    setAudienceDirty(true);
    setAudiencePreview(null);
  }
  function toggleTag(key, tag) {
    setAudienceRules((current) => {
      const values = new Set(current[key] || []);
      if (values.has(tag)) values.delete(tag);
      else values.add(tag);
      return { ...current, [key]: [...values].sort() };
    });
    setAudienceDirty(true);
    setAudiencePreview(null);
  }
  function chooseChannel(value) {
    updateFormValue(setForm, "channel", value);
    setAudienceDirty(true);
    setAudiencePreview(null);
  }
  return <div><StepIndicator currentStep={step} />{opportunity ? <div className="notice" style={{ marginBottom: 16 }}><strong>Campaign created from Marketing Opportunity</strong><br />Opportunity: {opportunity.title}<br />{formatNumber(opportunity.customer_count)} customers currently qualify.</div> : null}{step === 0 ? <div><div className="panel__header"><div><h3>Choose Channel</h3><p>Select the campaign type you want to create.</p></div></div><div className="card-grid">{Object.entries(channelLabels).map(([value, label]) => <button key={value} type="button" className={form.channel === value ? "panel panel--nested stat-card--blue" : "panel panel--nested"} style={{ textAlign: "left", boxShadow: "none" }} onClick={() => chooseChannel(value)}><h3>{label}</h3><p>{channelDescriptions[value]}</p><TonePill tone={form.channel === value ? "blue" : "default"}>{form.channel === value ? "Selected" : "Choose"}</TonePill></button>)}</div></div> : null}{step === 1 ? <div className="field-grid"><label className="field"><span className="field__label">Campaign Name</span><input className="field__input" value={form.name} onChange={(event) => updateFormValue(setForm, "name", event.target.value)} required /></label><label className="field"><span className="field__label">Objective</span><select className="field__input" value={form.objective} onChange={(event) => updateFormValue(setForm, "objective", event.target.value)} required><option value="new_stock">New Stock</option><option value="promotion">Promotion</option><option value="finance_offer">Finance Offer</option><option value="rent2buy">Rent2Buy</option><option value="re_engagement">Re-engagement</option><option value="custom">Custom</option></select></label><label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Description</span><textarea className="field__input" rows={4} value={form.description} onChange={(event) => updateFormValue(setForm, "description", event.target.value)} /></label></div> : null}{step === 2 ? <AudienceBuilderSection title="Audience" campaign={{ channel: form.channel }} rules={audienceRules} preview={audiencePreview} savedAudience={{ rules: audienceRules, eligible_count: audiencePreview?.eligible_count ?? null, calculated_at: audiencePreview?.calculated_at || null }} dirty={audienceDirty} error={audienceError} loading={audienceLoading} options={audienceOptions} isReadOnly={false} onRuleChange={setRule} onTagToggle={toggleTag} onPreview={onPreviewAudience} showSave={false} /> : null}{step === 3 ? <div className="panel panel--nested" style={{ boxShadow: "none" }}><div className="panel__header"><div><h3>Review Campaign</h3><p>Check the setup before creating the campaign.</p></div></div><div className="field-grid">{[["Campaign", form.name || "-"], ["Channel", channelLabels[form.channel]], ["Objective", objectiveLabels[form.objective]], ["Audience", audiencePreview ? `${formatNumber(audiencePreview.eligible_count)} customers` : "Not configured"], ["Batch Size", formatNumber(batchSize || 1000)], ["Estimated Batches", formatNumber(estimatedBatches)], ["Next Action", "Generate First Batch"]].map(([label, value]) => <div key={label} className="field"><span className="field__label">{label}</span><div className="field__input">{value}</div></div>)}</div><div className="notice" style={{ marginTop: 12 }}>No batch will be generated automatically. You can generate the first batch after the campaign is created.</div></div> : null}{step === 4 ? <div className="panel panel--nested" style={{ boxShadow: "none" }}><div className="panel__header"><div><h3>{createdCampaign ? "Campaign Created" : "Finish"}</h3><p>{createdCampaign ? "The campaign and audience rules have been saved." : "Create the campaign when you are ready."}</p></div></div>{!audiencePreview?.calculated_at ? <div className="notice notice--error">Configure an audience before creating this campaign.</div> : null}{createError ? <div className="notice notice--error">{createError}</div> : null}{createdCampaign ? <div className="card-actions"><button type="button" className="button button--primary" onClick={() => onOpenCampaign(createdCampaign, true)}>Generate First Batch</button><button type="button" className="button button--ghost" onClick={() => onOpenCampaign(createdCampaign, false)}>Return to Campaign</button></div> : <button type="button" className="button button--primary" disabled={creating || !audiencePreview?.calculated_at} onClick={onCreate}>{creating ? "Creating..." : "Create Campaign"}</button>}</div> : null}<div className="card-actions" style={{ marginTop: 18 }}><button type="button" className="button button--ghost" onClick={onCancel}>Cancel</button>{step > 0 && !createdCampaign ? <button type="button" className="button button--ghost" onClick={() => setStep(step - 1)}>Back</button> : null}{step < 4 ? <button type="button" className="button button--primary" disabled={!canGoNext} onClick={() => setStep(step + 1)}>Next</button> : null}</div></div>;
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
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardForm, setWizardForm] = useState(EMPTY_CAMPAIGN_FORM);
  const [wizardRules, setWizardRules] = useState(DEFAULT_AUDIENCE_RULES);
  const [wizardAudiencePreview, setWizardAudiencePreview] = useState(null);
  const [wizardAudienceDirty, setWizardAudienceDirty] = useState(false);
  const [wizardAudienceLoading, setWizardAudienceLoading] = useState(false);
  const [wizardAudienceError, setWizardAudienceError] = useState("");
  const [wizardCreateError, setWizardCreateError] = useState("");
  const [wizardCreating, setWizardCreating] = useState(false);
  const [wizardCreatedCampaign, setWizardCreatedCampaign] = useState(null);
  const [wizardOpportunity, setWizardOpportunity] = useState(null);
  const [wizardBatchSizeMode] = useState(1000);
  const [wizardCustomBatchSize] = useState(1000);
  const [campaignDashboard, setCampaignDashboard] = useState(EMPTY_CAMPAIGN_DASHBOARD);
  const [dashboardBatchSizeMode, setDashboardBatchSizeMode] = useState(1000);
  const [dashboardCustomBatchSize, setDashboardCustomBatchSize] = useState(1000);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [batches, setBatches] = useState([]);
  const [batchSummary, setBatchSummary] = useState(EMPTY_BATCH_SUMMARY);
  const [batchPreview, setBatchPreview] = useState(null);
  const [batchSizeMode, setBatchSizeMode] = useState(100);
  const [customBatchSize, setCustomBatchSize] = useState(100);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchActionId, setBatchActionId] = useState("");
  const [batchError, setBatchError] = useState("");
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [opportunities, setOpportunities] = useState([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(false);
  const [opportunitiesError, setOpportunitiesError] = useState("");

  const hasCampaigns = campaigns.length > 0;
  const sortedCampaigns = useMemo(() => [...campaigns].sort((first, second) => new Date(getCampaignLastActivity(second) || 0) - new Date(getCampaignLastActivity(first) || 0)), [campaigns]);
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

  async function loadOpportunities() {
    setOpportunitiesLoading(true);
    setOpportunitiesError("");
    try {
      setOpportunities(await getMarketingOpportunities());
    } catch (loadError) {
      setOpportunities([]);
      setOpportunitiesError(loadError.message || "Could not load marketing opportunities.");
    } finally {
      setOpportunitiesLoading(false);
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

  async function loadCampaignDashboard(campaign, size = getRequestedBatchSize(dashboardBatchSizeMode, dashboardCustomBatchSize)) {
    if (!campaign) return;
    setDashboardLoading(true);
    setDashboardError("");
    try {
      setCampaignDashboard({ ...EMPTY_CAMPAIGN_DASHBOARD, ...(await getMarketingCampaignDashboard(campaign, size)) });
    } catch (loadError) {
      setCampaignDashboard(EMPTY_CAMPAIGN_DASHBOARD);
      setDashboardError(loadError.message || "Could not load campaign progress.");
    } finally {
      setDashboardLoading(false);
    }
  }

  useEffect(() => { loadCampaigns(); }, [includeArchived]);
  useEffect(() => { loadAudienceOptions(); loadOpportunities(); }, []);

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
    setCampaignDashboard(EMPTY_CAMPAIGN_DASHBOARD);
    setDashboardBatchSizeMode(1000);
    setDashboardCustomBatchSize(1000);
    setDashboardLoading(false);
    setDashboardError("");
    setBatchLoading(false);
    setBatchActionId("");
    setBatchError("");
    setBatchConfirm(false);
  }

  function resetWizard(channel = "email", opportunity = null) {
    const nextChannel = opportunity?.recommended_channel || channel;
    const nextRules = { ...DEFAULT_AUDIENCE_RULES, ...(opportunity?.default_audience_rules || {}) };
    setWizardStep(opportunity ? 1 : 0);
    setWizardForm({
      ...EMPTY_CAMPAIGN_FORM,
      channel: nextChannel,
      objective: opportunity?.recommended_objective || "custom",
      name: opportunity?.suggested_name || "",
      description: opportunity?.description || "",
    });
    setWizardRules(nextRules);
    setWizardAudiencePreview(null);
    setWizardAudienceDirty(Boolean(opportunity));
    setWizardAudienceError("");
    setWizardCreateError("");
    setWizardCreating(false);
    setWizardCreatedCampaign(null);
    setWizardOpportunity(opportunity);
  }

  function openCreateCampaign(channel = "email") {
    resetWizard(channel);
    setSelectedCampaign(null);
    setModalMode("wizard");
  }

  function openOpportunityCampaign(opportunity) {
    resetWizard(opportunity?.recommended_channel || "email", opportunity);
    setSelectedCampaign(null);
    setModalMode("wizard");
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
    loadCampaignDashboard(campaign, 1000);
  }

  function closeModal() {
    setModalMode("");
    setSelectedCampaign(null);
    setFormError("");
    setAudienceError("");
    resetBatchState();
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

  async function handlePreviewWizardAudience() {
    setWizardAudienceLoading(true);
    setWizardAudienceError("");
    try {
      const audience = await previewMarketingCampaignDraftAudience(wizardForm.channel, wizardRules);
      setWizardAudiencePreview(audience);
      setWizardAudienceDirty(false);
    } catch (previewError) {
      setWizardAudiencePreview(null);
      setWizardAudienceError(previewError.message || "Could not preview audience.");
    } finally {
      setWizardAudienceLoading(false);
    }
  }

  async function handleCreateCampaignFromWizard() {
    if (!wizardAudiencePreview?.calculated_at) {
      setWizardCreateError("Configure an audience before creating this campaign.");
      return;
    }
    setWizardCreating(true);
    setWizardCreateError("");
    try {
      const campaign = await createMarketingCampaign(wizardForm);
      const response = await saveMarketingCampaignAudience(campaign, wizardRules);
      setWizardCreatedCampaign(response.campaign);
      await Promise.all([loadCampaigns(), loadOpportunities()]);
    } catch (createError) {
      setWizardCreateError(createError.message || "Could not create campaign.");
    } finally {
      setWizardCreating(false);
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
      await Promise.all([loadCampaigns(), loadCampaignDashboard(response.campaign)]);
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
      await Promise.all([loadBatches(selectedCampaign), loadCampaigns(), loadCampaignDashboard(selectedCampaign)]);
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
      await Promise.all([loadBatches(selectedCampaign), loadCampaigns(), loadCampaignDashboard(selectedCampaign), loadOpportunities()]);
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

  function handleOpenWizardCampaign(campaign, scrollToBatches) {
    openViewCampaign(campaign);
    if (scrollToBatches) setTimeout(() => document.getElementById("campaign-batches")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  }

  function handleDashboardSizeModeChange(value) {
    setDashboardBatchSizeMode(value);
    const nextSize = getRequestedBatchSize(value, dashboardCustomBatchSize);
    if (selectedCampaign && nextSize >= 1 && nextSize <= 5000) loadCampaignDashboard(selectedCampaign, nextSize);
  }

  function handleDashboardCustomSizeChange(value) {
    setDashboardCustomBatchSize(value);
    const nextSize = getRequestedBatchSize("custom", value);
    if (selectedCampaign && nextSize >= 1 && nextSize <= 5000) loadCampaignDashboard(selectedCampaign, nextSize);
  }

  function scrollToCampaigns() {
    document.getElementById("campaign-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return <div className="page-stack"><section className="hero-panel"><div className="panel__header" style={{ marginBottom: 0 }}><div><div className="eyebrow">Marketing Operations</div><h2>Marketing Centre</h2><p>Build audiences, manage campaigns and prepare marketing batches for email, SMS and Facebook.</p></div><div className="card-actions"><button type="button" className="button button--primary" onClick={() => openCreateCampaign()}>Create Campaign</button></div></div></section>{loading ? <div className="notice">Loading campaigns...</div> : null}{error ? <div className="notice notice--error">{error}</div> : null}<section className="stats-grid">{campaignStatCards.map(([label, key, tone]) => <StatCard key={label} label={label} value={formatNumber(campaignStats[key])} tone={tone} />)}</section><section className="stats-grid">{readinessCards.map(([label, value, tone]) => <StatCard key={label} label={label} value={value} tone={tone} />)}</section><section className="panel"><div className="panel__header"><div><h3>Campaign Channels</h3><p>Choose the marketing channel you want to prepare next.</p></div></div><div className="card-grid">{channels.map((channel) => <article key={channel.title} className="panel panel--nested" style={{ boxShadow: "none" }}><div className="panel__header"><div><h3>{channel.title}</h3><p>{channel.description}</p></div></div><div className="simple-list" style={{ marginBottom: 16 }}><div className="simple-list__item"><span>Ready Audience</span><strong>Pending</strong></div><div className="simple-list__item"><span>Last Campaign</span><strong>None</strong></div></div><button type="button" className="button button--primary" onClick={() => openCreateCampaign(channel.title.includes("SMS") ? "sms" : channel.title.includes("Facebook") ? "facebook" : "email")}>{channel.actionLabel}</button></article>)}</div></section><section id="campaign-list" className="panel"><div className="panel__header"><div><h3>Campaigns</h3><p>Campaign records are permanent. Archive campaigns instead of deleting them.</p></div><label className="toggle-row"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />Include Archived</label></div>{!hasCampaigns ? <div className="empty-state"><strong>No campaigns yet.</strong><p>Create your first campaign to start building an audience.</p><button type="button" className="button button--primary" onClick={() => openCreateCampaign()}>Create Campaign</button></div> : <TableShell><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>{["Campaign", "Channel", "Status", "Audience", "Batched", "Exported", "Progress", "Last Activity", "Actions"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #dbe2ea", color: "#475569" }}>{heading}</th>)}</tr></thead><tbody>{sortedCampaigns.map((campaign) => <tr key={campaign.id}><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>{campaign.name}<br /><small style={{ color: "#64748b" }}>{objectiveLabels[campaign.objective] || campaign.objective} - {campaign.description || "No description"}</small></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><TonePill tone={channelTones[campaign.channel]}>{channelLabels[campaign.channel] || campaign.channel}</TonePill></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><TonePill tone={statusTones[campaign.status]}>{statusLabels[campaign.status] || campaign.status}</TonePill></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{getAudienceStatus(campaign)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(campaign.batch_summary?.total_customers_batched)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(campaign.batch_summary?.total_customers_exported)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{getCampaignProgress(campaign)}%</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{formatDate(getCampaignLastActivity(campaign))}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><div className="card-actions" style={{ gap: 6 }}><button type="button" className="button button--ghost" onClick={() => openViewCampaign(campaign)}>View</button><button type="button" className="button button--ghost" onClick={() => openEditCampaign(campaign)}>Edit</button><button type="button" className="button button--danger" disabled={campaign.status === "archived"} onClick={() => handleArchiveCampaign(campaign)}>Archive</button></div></td></tr>)}</tbody></table></TableShell>}</section><section className="panel"><div className="panel__header"><div><h3>Quick Actions</h3><p>Campaign tools planned for email, SMS and Facebook audiences.</p></div></div><div className="card-grid">{quickActions.map((action) => { const onClick = action.action === "create" ? () => openCreateCampaign(action.label.includes("SMS") ? "sms" : action.label.includes("Facebook") ? "facebook" : "email") : action.action === "view" ? scrollToCampaigns : undefined; return <button key={action.label} type="button" className={action.action === "soon" ? "button button--ghost" : "button button--primary"} disabled={action.action === "soon"} onClick={onClick}>{action.action === "soon" ? `${action.label} - Coming Soon` : action.label}</button>; })}</div></section><section className="panel"><div className="panel__header"><div><h3>Marketing Opportunities</h3><p>Live, server-side opportunities from the Customer Database and campaign export history.</p></div><button type="button" className="button button--ghost" disabled={opportunitiesLoading} onClick={loadOpportunities}>{opportunitiesLoading ? "Refreshing..." : "Refresh"}</button></div>{opportunitiesError ? <div className="notice notice--error" style={{ marginBottom: 12 }}>{opportunitiesError}</div> : null}{opportunitiesLoading && !opportunities.length ? <div className="notice">Loading marketing opportunities...</div> : null}{!opportunitiesLoading && !opportunities.length && !opportunitiesError ? <div className="empty-state"><strong>No opportunities found.</strong><p>Opportunities will appear when customer groups match the live rules.</p></div> : <div className="card-grid">{opportunities.map((opportunity) => <article key={opportunity.id} className="panel panel--nested" style={{ boxShadow: "none" }}><div className="panel__header"><div><h3>{opportunity.title}</h3><p>{opportunity.description}</p></div><TonePill tone={channelTones[opportunity.recommended_channel]}>{channelLabels[opportunity.recommended_channel]}</TonePill></div><div className="stat-card" style={{ boxShadow: "none", marginBottom: 14 }}><div className="stat-card__label">Customers</div><div className="stat-card__value">{formatNumber(opportunity.customer_count)}</div></div><div className="simple-list" style={{ marginBottom: 14 }}><div className="simple-list__item"><span>Recommended Channel</span><strong>{channelLabels[opportunity.recommended_channel]}</strong></div><div className="simple-list__item"><span>Objective</span><strong>{objectiveLabels[opportunity.recommended_objective] || opportunity.recommended_objective}</strong></div></div><button type="button" className="button button--primary" onClick={() => openOpportunityCampaign(opportunity)}>Create Campaign</button></article>)}</div>}</section>{modalMode === "wizard" ? <Modal title="Campaign Creation Wizard" onClose={closeModal}><CampaignWizard form={wizardForm} setForm={setWizardForm} step={wizardStep} setStep={setWizardStep} audienceRules={wizardRules} setAudienceRules={setWizardRules} audiencePreview={wizardAudiencePreview} setAudiencePreview={setWizardAudiencePreview} audienceDirty={wizardAudienceDirty} setAudienceDirty={setWizardAudienceDirty} audienceLoading={wizardAudienceLoading} audienceError={wizardAudienceError} audienceOptions={audienceOptions} opportunity={wizardOpportunity} createdCampaign={wizardCreatedCampaign} creating={wizardCreating} createError={wizardCreateError} batchSizeMode={wizardBatchSizeMode} customBatchSize={wizardCustomBatchSize} onPreviewAudience={handlePreviewWizardAudience} onCreate={handleCreateCampaignFromWizard} onCancel={closeModal} onOpenCampaign={handleOpenWizardCampaign} /></Modal> : null}{modalMode === "edit" && selectedCampaign ? <Modal title="Edit Campaign" onClose={closeModal}><CampaignForm form={campaignForm} setForm={setCampaignForm} error={formError} onSubmit={handleUpdateCampaign} submitLabel="Save Campaign" isArchived={selectedCampaign.status === "archived"} /></Modal> : null}{modalMode === "view" && selectedCampaign ? <Modal title="Campaign Detail" onClose={closeModal}><div className="field-grid">{[["Campaign Name", selectedCampaign.name], ["Description", selectedCampaign.description || "-"], ["Channel", channelLabels[selectedCampaign.channel] || selectedCampaign.channel], ["Objective", objectiveLabels[selectedCampaign.objective] || selectedCampaign.objective], ["Status", statusLabels[selectedCampaign.status] || selectedCampaign.status], ["Audience", displayedAudience.eligible_count === null ? "Not selected" : `${formatNumber(displayedAudience.eligible_count)} eligible`], ["Batches", getBatchStatus({ ...selectedCampaign, batch_summary: batchSummary })], ["Provider", "Not selected"], ["Created", formatDate(selectedCampaign.created_at)], ["Last Updated", formatDate(selectedCampaign.updated_at)]].map(([label, value]) => <div key={label} className="field"><span className="field__label">{label}</span><div className="field__input">{value}</div></div>)}{selectedCampaign.archived_at ? <div className="field"><span className="field__label">Archived</span><div className="field__input">{formatDate(selectedCampaign.archived_at)}</div></div> : null}</div><CampaignDashboardSection campaign={selectedCampaign} dashboard={campaignDashboard} batches={batches} loading={dashboardLoading} error={dashboardError} batchSizeMode={dashboardBatchSizeMode} customBatchSize={dashboardCustomBatchSize} onSizeModeChange={handleDashboardSizeModeChange} onCustomSizeChange={handleDashboardCustomSizeChange} onRefresh={() => loadCampaignDashboard(selectedCampaign)} onPreviewAudience={handlePreviewAudience} onExportBatch={handleExportBatch} /><AudienceBuilderSection campaign={selectedCampaign} rules={audienceRules} preview={audiencePreview} savedAudience={savedAudience} dirty={audienceDirty} error={audienceError} loading={audienceLoading} options={audienceOptions} isReadOnly={selectedIsArchived} onRuleChange={setAudienceRule} onTagToggle={toggleAudienceTag} onPreview={handlePreviewAudience} onSave={handleSaveAudience} /><BatchSection batches={batches} batchSummary={batchSummary} batchPreview={batchPreview} batchSizeMode={batchSizeMode} customBatchSize={customBatchSize} batchLoading={batchLoading} batchActionId={batchActionId} batchError={batchError} batchConfirm={batchConfirm} isArchived={selectedIsArchived} hasSavedAudience={hasSavedAudience} onSizeModeChange={(value) => { setBatchSizeMode(value); setBatchPreview(null); setBatchConfirm(false); }} onCustomSizeChange={(value) => { setCustomBatchSize(value); setBatchPreview(null); setBatchConfirm(false); }} onPreview={handlePreviewBatch} onGenerate={handleGenerateBatch} onExport={handleExportBatch} onDownload={handleDownloadBatch} onConfirmChange={setBatchConfirm} /></Modal> : null}</div>;
}