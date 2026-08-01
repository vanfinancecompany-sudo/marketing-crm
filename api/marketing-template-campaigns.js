import { createClient } from "@supabase/supabase-js";
import {
  CampaignValidationError,
  buildTemplateSnapshotFromTemplate,
  cleanText,
  cloneSnapshot,
  countSelectedVehicles,
  isPlainObject,
  normalizeTemplateSnapshot,
  renderRecipientCampaignPreview,
} from "../lib/marketingEmailTemplateRenderer.js";
import {
  createCurrentSendEligibilityState,
  evaluateCurrentSendEligibility,
  loadCurrentSendProcessedIdentities,
  loadPermanentCurrentSendSuppressions,
} from "../lib/marketingCurrentSendEligibility.js";
import {
  loadCampaignContactExclusions,
  matchesCampaignContactExclusion,
  normalizeCampaignContactControls,
} from "../lib/marketingCampaignContactControls.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_CAMPAIGN_SOURCE = "template_campaign_foundation";
const CAMPAIGN_COLUMNS = "id,name,description,channel,objective,status,tags,metadata,created_by,created_at,updated_at,archived_at,campaign_type,template_id,template_name,template_snapshot,subject_line,preview_text,audience_snapshot";
const TEMPLATE_COLUMNS = "id,name,description,category,default_subject,preview_text,header_logo,hero_heading,intro_text,main_body,cta_text,cta_url,footer,brand_colour,company_name,secondary_colour,social_links,master_layout,content_blocks,status,created_by,created_at,updated_at,archived_at";
const CAMPAIGN_TYPES = new Set(["new_stock", "finance_offer", "rent2buy", "newsletter", "custom"]);
const STATUSES = new Set(["draft", "ready", "archived"]);
const PIPELINES = new Set(["all", "finance", "rent2buy", "both"]);
const AUDIENCE_MODES = new Set(["standard", "never_emailed", "recently_imported", "manual_customer_ids", "custom_search"]);
const PAGE_SIZE = 1000;

class CampaignNotFoundError extends Error {
  constructor() {
    super("Template campaign was not found.");
    this.name = "CampaignNotFoundError";
    this.statusCode = 404;
  }
}

function json(response, status, payload) { response.status(status).json(payload); }
function campaignValues(body = {}) { return body.values || body.campaign || {}; }

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables.");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function authorize(request) {
  const expectedSecret = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  if (!expectedSecret) return false;
  const headerSecret = request.headers[API_KEY_HEADER] || "";
  const authHeader = request.headers.authorization || "";
  const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return headerSecret === expectedSecret || bearerSecret === expectedSecret;
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function assertSupabase(result, fallbackMessage) {
  if (result.error) throw new Error(result.error.message || fallbackMessage);
  return result;
}

function isMissingSendInfrastructure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("marketing_email_sends")
    || message.includes("marketing_email_send_recipients")
    || message.includes("does not exist")
    || message.includes("schema cache");
}

function normalizeCampaignType(value) {
  const type = cleanText(value || "custom", 60);
  if (!CAMPAIGN_TYPES.has(type)) throw new CampaignValidationError("Unsupported campaign type.");
  return type;
}

function normalizeStatus(value) {
  const status = cleanText(value || "draft", 60);
  if (!STATUSES.has(status)) throw new CampaignValidationError("Unsupported campaign status.");
  return status;
}

function normalizeEditableStatus(value) {
  const status = normalizeStatus(value || "draft");
  if (status === "archived") throw new CampaignValidationError("Use the Archive action to archive campaigns.");
  return status;
}

function normalizeCustomerId(value) {
  return cleanText(value, 80).toUpperCase();
}

function ownedTemplateCampaignQuery(supabase) {
  return supabase
    .from("marketing_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("metadata->>source", TEMPLATE_CAMPAIGN_SOURCE);
}

function normalizeAudienceRules(values = {}) {
  if (!isPlainObject(values)) throw new CampaignValidationError("Audience rules must be an object.");
  const pipeline = cleanText(values.pipeline || "all", 40).toLowerCase();
  const mode = cleanText(values.mode || "standard", 60).toLowerCase();
  const search = cleanText(values.search || "", 120);
  const manualCustomerIds = Array.isArray(values.manual_customer_ids)
    ? values.manual_customer_ids.map(normalizeCustomerId).filter(Boolean)
    : String(values.manual_customer_ids || "").split(/[\s,;]+/).map(normalizeCustomerId).filter(Boolean);

  if (!PIPELINES.has(pipeline)) throw new CampaignValidationError("Unsupported audience pipeline.");
  if (!AUDIENCE_MODES.has(mode)) throw new CampaignValidationError("Unsupported audience option.");
  if (search && /[%{}"\\]/.test(search)) throw new CampaignValidationError("Search contains unsupported characters.");
  if (manualCustomerIds.length > 500) throw new CampaignValidationError("Manual customer ID audiences can contain a maximum of 500 IDs.");
  if (new Set(manualCustomerIds).size !== manualCustomerIds.length) throw new CampaignValidationError("Manual customer IDs must be unique.");
  for (const id of manualCustomerIds) {
    if (!/^[A-Z0-9_-]{3,80}$/.test(id)) throw new CampaignValidationError("Manual customer IDs contain an unsupported value.");
  }
  if (mode === "manual_customer_ids" && !manualCustomerIds.length) throw new CampaignValidationError("Enter at least one manual customer ID.");
  if (mode === "custom_search" && !search) throw new CampaignValidationError("Enter a custom search term.");

  const contactControls = normalizeCampaignContactControls(values, (message) => new CampaignValidationError(message));
  return { pipeline, mode, manual_customer_ids: manualCustomerIds, search, ...contactControls };
}

function normalizeAudienceSnapshot(value = null) {
  if (!value) return null;
  if (!isPlainObject(value)) throw new CampaignValidationError("Audience snapshot must be an object.");
  const rules = normalizeAudienceRules(value.rules || {});
  const counts = value.counts || value;
  const totalMatching = Number(counts.total_matching_customers ?? counts.total_matching ?? 0);
  const suppressed = Number(counts.suppressed_customers ?? counts.suppressed ?? 0);
  const skippedDuplicate = Number(counts.skipped_duplicate_customers ?? counts.skipped_duplicate ?? 0);
  const historyExcluded = Number(counts.history_excluded_customers ?? 0);
  const deliverable = Number(counts.deliverable_customers ?? counts.final_send_count ?? counts.deliverable ?? 0);
  const finalSendCount = Number(counts.final_send_count ?? deliverable);
  const calculatedAt = cleanText(value.calculated_at || "", 80);
  if (![totalMatching, suppressed, skippedDuplicate, historyExcluded, deliverable, finalSendCount].every((number) => Number.isInteger(number) && number >= 0)) {
    throw new CampaignValidationError("Audience counts must be non-negative whole numbers.");
  }
  if (totalMatching !== suppressed + skippedDuplicate + historyExcluded + deliverable || finalSendCount !== deliverable) {
    throw new CampaignValidationError("Audience counts are inconsistent. Preview the audience again.");
  }
  if (!calculatedAt) throw new CampaignValidationError("Preview the audience before saving it.");
  return {
    rules,
    total_matching_customers: totalMatching,
    suppressed_customers: suppressed,
    skipped_duplicate_customers: skippedDuplicate,
    history_excluded_customers: historyExcluded,
    deliverable_customers: deliverable,
    final_send_count: deliverable,
    calculated_at: calculatedAt,
  };
}

function hasUsefulSnapshot(snapshot = {}) {
  return Boolean(snapshot && snapshot.name && snapshot.default_subject && Array.isArray(snapshot.content_blocks));
}

function campaignRequiresVehicle(campaign = {}) {
  return ["new_stock", "finance_offer", "rent2buy"].includes(campaign.campaign_type || campaign.objective);
}

function readinessForCampaign(campaign = {}) {
  const audience = normalizeAudienceSnapshot(campaign.audience_snapshot || null);
  const selectedVehicleCount = Number(campaign.selected_vehicle_count ?? countSelectedVehicles(campaign.template_snapshot || {}));
  const requiresVehicle = campaignRequiresVehicle(campaign);
  const substantiveChecks = [
    { id: "active_template", label: "Valid frozen template snapshot", passed: hasUsefulSnapshot(campaign.template_snapshot || {}) },
    { id: "subject", label: "Subject entered", passed: Boolean(cleanText(campaign.subject_line, 300)) },
    { id: "preview_text", label: "Preview text entered", passed: Boolean(cleanText(campaign.preview_text, 300)) },
    { id: "vehicles", label: "Vehicle selection", passed: !requiresVehicle || selectedVehicleCount > 0, required: requiresVehicle },
    { id: "audience", label: "Audience selected", passed: Boolean(audience?.calculated_at) },
    { id: "deliverable", label: "Deliverable audience greater than zero", passed: Number(audience?.final_send_count || 0) > 0 },
  ];
  const statusCheck = {
    id: "status",
    label: campaign.status === "ready"
      ? "Campaign Ready"
      : campaign.status === "archived"
        ? "Campaign Archived"
        : "Campaign still Draft",
    passed: campaign.status === "ready",
  };
  const transitionReady = substantiveChecks.every((check) => check.passed);
  return {
    ready_to_send: transitionReady && statusCheck.passed,
    transition_ready: transitionReady,
    checks: [...substantiveChecks, statusCheck],
    requires_vehicle: requiresVehicle,
    selected_vehicle_count: selectedVehicleCount,
    estimated_recipients: Number(audience?.final_send_count || 0),
    suppressed_recipients: Number(audience?.suppressed_customers || 0),
  };
}

function normalizeCampaign(row = {}) {
  const snapshot = normalizeTemplateSnapshot(row.template_snapshot || {});
  const campaign = {
    id: row.id || "",
    name: row.name || "",
    description: row.description || "",
    channel: row.channel || "email",
    objective: row.objective || "custom",
    campaign_type: row.campaign_type || "custom",
    status: row.status || "draft",
    template_id: row.template_id || "",
    template_name: row.template_name || "",
    template_snapshot: snapshot,
    subject_line: row.subject_line || snapshot.default_subject || "",
    preview_text: row.preview_text || snapshot.preview_text || "",
    audience_snapshot: normalizeAudienceSnapshot(row.audience_snapshot || null),
    created_by: row.created_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    archived_at: row.archived_at || "",
    content_block_count: Array.isArray(snapshot.content_blocks) ? snapshot.content_blocks.length : 0,
    selected_vehicle_count: countSelectedVehicles(snapshot),
  };
  campaign.readiness = readinessForCampaign(campaign);
  return campaign;
}

function campaignSummary(campaign) {
  return {
    id: campaign.id,
    name: campaign.name,
    campaign_type: campaign.campaign_type,
    status: campaign.status,
    template_id: campaign.template_id,
    template_name: campaign.template_name,
    subject_line: campaign.subject_line,
    preview_text: campaign.preview_text,
    audience_snapshot: campaign.audience_snapshot,
    readiness: campaign.readiness,
    created_at: campaign.created_at,
    updated_at: campaign.updated_at,
    archived_at: campaign.archived_at,
    content_block_count: campaign.content_block_count,
    selected_vehicle_count: campaign.selected_vehicle_count,
  };
}

async function loadOwnedTemplateCampaign(supabase, id) {
  if (!id) throw new CampaignValidationError("Campaign ID is required.");
  const result = await ownedTemplateCampaignQuery(supabase).eq("id", id).maybeSingle();
  assertSupabase(result, "Could not load template campaign.");
  if (!result.data) throw new CampaignNotFoundError();
  return normalizeCampaign(result.data);
}

async function loadTemplate(supabase, id) {
  if (!id) throw new CampaignValidationError("Reusable template is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_email_templates").select(TEMPLATE_COLUMNS).eq("id", id).single(),
    "Could not load reusable template."
  );
  if (!data) throw new CampaignValidationError("Reusable template was not found.");
  if (data.status !== "active") throw new CampaignValidationError("Only active templates can create campaigns.");
  return data;
}

function recentlyImportedIso() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function applyAudienceFilters(query, rules) {
  if (rules.pipeline !== "all") query = query.eq("pipeline", rules.pipeline);
  if (rules.mode === "recently_imported") query = query.gte("created_at", recentlyImportedIso());
  if (rules.mode === "manual_customer_ids") query = query.in("customer_id", rules.manual_customer_ids);
  if (rules.mode === "custom_search") {
    const term = rules.search.replace(/[%,]/g, "");
    query = query.or(`customer_id.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,postcode.ilike.%${term}%`);
  }
  return query;
}

async function loadExportedEmailContactIds(supabase) {
  const campaignResult = await supabase.from("marketing_campaigns").select("id").eq("channel", "email");
  assertSupabase(campaignResult, "Could not inspect exported email campaigns.");
  const campaignIds = (campaignResult.data || []).map((row) => row.id).filter(Boolean);
  if (!campaignIds.length) return new Set();

  const batchIds = [];
  for (let index = 0; index < campaignIds.length; index += 100) {
    const result = await supabase
      .from("marketing_campaign_batches")
      .select("id")
      .in("campaign_id", campaignIds.slice(index, index + 100))
      .eq("status", "exported");
    if (result.error) {
      const message = String(result.error.message || "").toLowerCase();
      if (message.includes("marketing_campaign_batches") || message.includes("does not exist")) return new Set();
      throw new Error(result.error.message || "Could not inspect exported email batches.");
    }
    batchIds.push(...(result.data || []).map((row) => row.id).filter(Boolean));
  }
  if (!batchIds.length) return new Set();

  const contactIds = new Set();
  for (let index = 0; index < batchIds.length; index += 100) {
    let from = 0;
    while (true) {
      const result = await supabase
        .from("marketing_campaign_batch_customers")
        .select("customer_id")
        .in("batch_id", batchIds.slice(index, index + 100))
        .range(from, from + PAGE_SIZE - 1);
      if (result.error) {
        const message = String(result.error.message || "").toLowerCase();
        if (message.includes("marketing_campaign_batch_customers") || message.includes("does not exist")) return new Set();
        throw new Error(result.error.message || "Could not inspect exported email customers.");
      }
      (result.data || []).forEach((row) => {
        const customerId = normalizeCustomerId(row.customer_id);
        if (customerId) contactIds.add(customerId);
      });
      if (!result.data || result.data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return contactIds;
}

async function countAudienceByScan(supabase, campaignId, rules, exportedEmailIds = new Set()) {
  let from = 0;
  let totalMatching = 0;
  let deliverable = 0;
  let suppressed = 0;
  let skippedDuplicate = 0;
  let invalidEmail = 0;
  let historyExcluded = 0;
  const processed = await loadCurrentSendProcessedIdentities(supabase, campaignId, assertSupabase);
  const contactExclusions = await loadCampaignContactExclusions(supabase, rules, campaignId, assertSupabase);
  const eligibilityState = createCurrentSendEligibilityState(processed);
  while (true) {
    const result = await applyAudienceFilters(
      supabase.from("marketing_contacts").select("id,customer_id,email,email_normalized,email_ready,marketing_status,lifecycle_status,suppression"),
      rules
    ).range(from, from + PAGE_SIZE - 1);
    assertSupabase(result, "Could not count campaign audience.");
    const rows = result.data || [];
    const permanentlySuppressed = await loadPermanentCurrentSendSuppressions(supabase, rows.map((row) => row.email_normalized || row.email), assertSupabase);
    rows.forEach((row) => {
      if (rules.mode === "never_emailed" && exportedEmailIds.has(normalizeCustomerId(row.customer_id))) return;
      totalMatching += 1;
      if (matchesCampaignContactExclusion(row, contactExclusions)) {
        historyExcluded += 1;
        return;
      }
      const decision = evaluateCurrentSendEligibility(row, { state: eligibilityState, permanentlySuppressedEmails: permanentlySuppressed });
      if (decision.eligible) deliverable += 1;
      else if (["previously_processed", "duplicate"].includes(decision.reason)) skippedDuplicate += 1;
      else {
        suppressed += 1;
        if (decision.reason === "invalid_email") invalidEmail += 1;
      }
    });
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return {
    total_matching_customers: totalMatching,
    suppressed_customers: suppressed,
    skipped_duplicate_customers: skippedDuplicate,
    history_excluded_customers: historyExcluded,
    invalid_email_customers: invalidEmail,
    deliverable_customers: deliverable,
    final_send_count: deliverable,
  };
}

async function buildAudienceSnapshot(supabase, campaignId, rulesInput = {}) {
  const rules = normalizeAudienceRules(rulesInput);
  const exportedEmailIds = rules.mode === "never_emailed" ? await loadExportedEmailContactIds(supabase) : new Set();
  const counts = await countAudienceByScan(supabase, campaignId, rules, exportedEmailIds);
  return normalizeAudienceSnapshot({ rules, ...counts, calculated_at: new Date().toISOString() });
}

async function campaignHasProductionSendLock(supabase, campaignId) {
  try {
    const recipients = await supabase
      .from("marketing_email_send_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("send_type", "production");
    if (recipients.error) {
      if (isMissingSendInfrastructure(recipients.error)) return false;
      throw new Error(recipients.error.message || "Could not inspect campaign send recipients.");
    }
    if ((recipients.count || 0) > 0) return true;

    const sends = await supabase
      .from("marketing_email_sends")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("send_type", "production")
      .in("status", ["sending", "completed", "partially_failed", "failed"]);
    if (sends.error) {
      if (isMissingSendInfrastructure(sends.error)) return false;
      throw new Error(sends.error.message || "Could not inspect campaign send history.");
    }
    return (sends.count || 0) > 0;
  } catch (error) {
    if (isMissingSendInfrastructure(error)) return false;
    throw error;
  }
}

function getAudienceRulesForReady(values, existing) {
  if (values.audience_snapshot?.rules) return values.audience_snapshot.rules;
  if (existing.audience_snapshot?.rules) return existing.audience_snapshot.rules;
  throw new CampaignValidationError("Preview and save an audience before marking the campaign Ready.");
}

async function resolveAudienceForUpdate(supabase, values, existing, nextStatus) {
  if (nextStatus === "ready") return buildAudienceSnapshot(supabase, existing.id, getAudienceRulesForReady(values, existing));
  if (values.audience_snapshot === undefined) return existing.audience_snapshot;
  return buildAudienceSnapshot(supabase, existing.id, values.audience_snapshot?.rules || values.audience_snapshot || {});
}

async function listCampaigns(supabase, body = {}) {
  let query = ownedTemplateCampaignQuery(supabase).order("updated_at", { ascending: false });
  if (!body.includeArchived) query = query.neq("status", "archived");
  if (body.campaign_type && body.campaign_type !== "all") query = query.eq("campaign_type", normalizeCampaignType(body.campaign_type));
  if (body.status && body.status !== "all") query = query.eq("status", normalizeStatus(body.status));
  const { data } = assertSupabase(await query, "Could not load template campaigns.");
  const campaigns = (data || []).map(normalizeCampaign);
  return { campaigns: campaigns.map(campaignSummary) };
}

async function getCampaign(supabase, body = {}) { return { campaign: await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id) }; }

async function templateOptions(supabase) {
  const { data } = assertSupabase(
    await supabase
      .from("marketing_email_templates")
      .select("id,name,category,default_subject,preview_text,status,updated_at")
      .eq("status", "active")
      .order("updated_at", { ascending: false }),
    "Could not load reusable templates."
  );
  return { templates: data || [] };
}

async function createCampaign(supabase, body = {}) {
  const values = campaignValues(body);
  const name = cleanText(values.name, 200);
  if (!name) throw new CampaignValidationError("Campaign name is required.");
  const campaignType = normalizeCampaignType(values.campaign_type);
  const template = await loadTemplate(supabase, values.template_id);
  const snapshot = buildTemplateSnapshotFromTemplate(template);
  const subjectLine = cleanText(values.subject_line || snapshot.default_subject, 300);
  if (!subjectLine) throw new CampaignValidationError("Subject line is required.");
  const previewText = cleanText(values.preview_text || snapshot.preview_text, 300);
  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").insert({
      name,
      description: "",
      channel: "email",
      objective: campaignType,
      campaign_type: campaignType,
      status: "draft",
      tags: [],
      metadata: { source: TEMPLATE_CAMPAIGN_SOURCE },
      template_id: template.id,
      template_name: template.name || "",
      template_snapshot: snapshot,
      subject_line: subjectLine,
      preview_text: previewText,
      audience_snapshot: null,
      created_by: cleanText(body.createdBy || "Marketing CRM", 200),
    }).select(CAMPAIGN_COLUMNS).single(),
    "Could not create template campaign."
  );
  return { campaign: normalizeCampaign(data) };
}

async function updateCampaign(supabase, body = {}) {
  const existing = await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id);
  if (existing.status === "archived") throw new CampaignValidationError("Archived campaigns are read only.");
  const values = campaignValues(body);
  const nextStatus = normalizeEditableStatus(values.status ?? existing.status);
  const sendLocked = await campaignHasProductionSendLock(supabase, existing.id);
  const nextCampaignType = normalizeCampaignType(values.campaign_type ?? existing.campaign_type);
  const nextSubjectLine = cleanText(values.subject_line ?? existing.subject_line, 300);
  const nextPreviewText = cleanText(values.preview_text ?? existing.preview_text, 300);
  if (sendLocked) {
    const lockedChange = nextCampaignType !== existing.campaign_type
      || nextSubjectLine !== existing.subject_line
      || nextPreviewText !== existing.preview_text
      || nextStatus !== existing.status
      || values.audience_snapshot !== undefined;
    if (lockedChange) {
      throw new CampaignValidationError("Production sending has started for this campaign. Frozen content, status and audience can no longer be changed.");
    }
  }
  const nextAudience = sendLocked ? existing.audience_snapshot : await resolveAudienceForUpdate(supabase, values, existing, nextStatus);
  const next = {
    name: cleanText(values.name ?? existing.name, 200),
    campaign_type: nextCampaignType,
    objective: nextCampaignType,
    subject_line: nextSubjectLine,
    preview_text: nextPreviewText,
    status: nextStatus,
    audience_snapshot: nextAudience,
  };
  if (!next.name) throw new CampaignValidationError("Campaign name is required.");
  if (!next.subject_line) throw new CampaignValidationError("Subject line is required.");
  const candidate = { ...existing, ...next, template_snapshot: existing.template_snapshot, selected_vehicle_count: existing.selected_vehicle_count };
  candidate.readiness = readinessForCampaign(candidate);
  if (next.status === "ready" && !candidate.readiness.transition_ready) {
    throw new CampaignValidationError("Campaign cannot be marked Ready until every substantive readiness check passes.");
  }
  const { data } = assertSupabase(
    await supabase
      .from("marketing_campaigns")
      .update(next)
      .eq("id", existing.id)
      .eq("metadata->>source", TEMPLATE_CAMPAIGN_SOURCE)
      .select(CAMPAIGN_COLUMNS)
      .single(),
    "Could not update template campaign."
  );
  return { campaign: normalizeCampaign(data) };
}

async function duplicateCampaign(supabase, body = {}) {
  const existing = await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id);
  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").insert({
      name: `${existing.name} - Copy`,
      description: "",
      channel: "email",
      objective: existing.campaign_type,
      campaign_type: existing.campaign_type,
      status: "draft",
      tags: [],
      metadata: { source: TEMPLATE_CAMPAIGN_SOURCE, duplicated_from: existing.id },
      template_id: existing.template_id || null,
      template_name: existing.template_name || "",
      template_snapshot: cloneSnapshot(existing.template_snapshot),
      subject_line: existing.subject_line,
      preview_text: existing.preview_text,
      audience_snapshot: null,
      created_by: cleanText(body.createdBy || "Marketing CRM", 200),
    }).select(CAMPAIGN_COLUMNS).single(),
    "Could not duplicate template campaign."
  );
  return { campaign: normalizeCampaign(data) };
}

async function archiveCampaign(supabase, body = {}) {
  const existing = await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id);
  if (existing.status === "archived") return { campaign: existing };
  const { data } = assertSupabase(
    await supabase
      .from("marketing_campaigns")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("metadata->>source", TEMPLATE_CAMPAIGN_SOURCE)
      .select(CAMPAIGN_COLUMNS)
      .single(),
    "Could not archive template campaign."
  );
  return { campaign: normalizeCampaign(data) };
}

export function renderDesignerCampaignPreview(campaign = {}) {
  return renderRecipientCampaignPreview(campaign, {}, { mode: "designer_preview" });
}

async function previewCampaign(supabase, body = {}) {
  const campaign = await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id);
  return { preview: renderDesignerCampaignPreview(campaign) };
}

async function previewAudience(supabase, body = {}) {
  const campaign = await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id);
  const audience = await buildAudienceSnapshot(supabase, campaign.id, body.rules || body.audience || {});
  return { audience };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Marketing Campaigns API access denied." });
    return;
  }
  try {
    const supabase = getSupabase();
    const body = parseBody(request);
    const action = body.action || "list";
    let result;
    if (action === "validateAccess") result = {};
    else if (action === "templateOptions") result = await templateOptions(supabase, body);
    else if (action === "list") result = await listCampaigns(supabase, body);
    else if (action === "get") result = await getCampaign(supabase, body);
    else if (action === "create") result = await createCampaign(supabase, body);
    else if (action === "update") result = await updateCampaign(supabase, body);
    else if (action === "duplicate") result = await duplicateCampaign(supabase, body);
    else if (action === "archive") result = await archiveCampaign(supabase, body);
    else if (action === "preview") result = await previewCampaign(supabase, body);
    else if (action === "audiencePreview") result = await previewAudience(supabase, body);
    else throw new CampaignValidationError("Unknown Marketing Campaigns API action.");
    json(response, 200, { ok: true, ...result });
  } catch (error) {
    const status = error?.statusCode || (error instanceof CampaignValidationError ? 400 : 500);
    json(response, status, { ok: false, message: error?.message || "Marketing Campaigns API error." });
  }
}
