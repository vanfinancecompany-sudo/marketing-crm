import { createClient } from "@supabase/supabase-js";
import {
  CampaignValidationError,
  buildTemplateSnapshotFromTemplate,
  cleanText,
  cloneSnapshot,
  countSelectedVehicles,
  isPlainObject,
  normalizeTemplateSnapshot,
  renderCampaignPreview,
} from "../lib/marketingCampaignTemplateRenderer.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CAMPAIGN_COLUMNS = "id,name,description,channel,objective,status,tags,metadata,created_by,created_at,updated_at,archived_at,campaign_type,template_id,template_name,template_snapshot,subject_line,preview_text,audience_snapshot";
const TEMPLATE_COLUMNS = "id,name,description,category,default_subject,preview_text,header_logo,hero_heading,intro_text,main_body,cta_text,cta_url,footer,brand_colour,company_name,secondary_colour,social_links,master_layout,content_blocks,status,created_by,created_at,updated_at,archived_at";
const CAMPAIGN_TYPES = new Set(["new_stock", "finance_offer", "rent2buy", "newsletter", "custom"]);
const STATUSES = new Set(["draft", "ready", "archived"]);

function json(response, status, payload) { response.status(status).json(payload); }

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

function campaignValues(body = {}) { return body.values || body.campaign || {}; }

function normalizeCampaign(row = {}) {
  const snapshot = normalizeTemplateSnapshot(row.template_snapshot || {});
  return {
    id: row.id || "",
    name: row.name || "",
    description: row.description || "",
    channel: row.channel || "email",
    objective: row.objective || "custom",
    campaign_type: row.campaign_type || row.objective || "custom",
    status: row.status || "draft",
    template_id: row.template_id || "",
    template_name: row.template_name || "",
    template_snapshot: snapshot,
    subject_line: row.subject_line || snapshot.default_subject || "",
    preview_text: row.preview_text || snapshot.preview_text || "",
    audience_snapshot: isPlainObject(row.audience_snapshot) ? row.audience_snapshot : null,
    created_by: row.created_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    archived_at: row.archived_at || "",
    content_block_count: Array.isArray(snapshot.content_blocks) ? snapshot.content_blocks.length : 0,
    selected_vehicle_count: countSelectedVehicles(snapshot),
  };
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
    created_at: campaign.created_at,
    updated_at: campaign.updated_at,
    archived_at: campaign.archived_at,
    content_block_count: campaign.content_block_count,
    selected_vehicle_count: campaign.selected_vehicle_count,
  };
}

async function loadCampaign(supabase, id) {
  if (!id) throw new CampaignValidationError("Campaign ID is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).single(),
    "Could not load campaign."
  );
  return normalizeCampaign(data);
}

async function loadTemplate(supabase, id) {
  if (!id) throw new CampaignValidationError("Reusable template is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_email_templates").select(TEMPLATE_COLUMNS).eq("id", id).single(),
    "Could not load reusable template."
  );
  if (!data) throw new CampaignValidationError("Reusable template was not found.");
  if (data.status === "archived") throw new CampaignValidationError("Archived templates cannot be used to create campaigns.");
  return data;
}

async function listCampaigns(supabase, body = {}) {
  let query = supabase.from("marketing_campaigns").select(CAMPAIGN_COLUMNS).order("updated_at", { ascending: false });
  if (!body.includeArchived) query = query.neq("status", "archived");
  if (body.campaign_type && body.campaign_type !== "all") query = query.eq("campaign_type", normalizeCampaignType(body.campaign_type));
  if (body.status && body.status !== "all") query = query.eq("status", normalizeStatus(body.status));
  const { data } = assertSupabase(await query, "Could not load campaigns.");
  const campaigns = (data || []).map(normalizeCampaign);
  return { campaigns: campaigns.map(campaignSummary) };
}

async function getCampaign(supabase, body = {}) { return { campaign: await loadCampaign(supabase, body.id || body.campaign?.id) }; }

async function templateOptions(supabase) {
  const { data } = assertSupabase(
    await supabase
      .from("marketing_email_templates")
      .select("id,name,category,default_subject,preview_text,status,updated_at")
      .neq("status", "archived")
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
      metadata: { source: "template_campaign_foundation" },
      template_id: template.id,
      template_name: template.name || "",
      template_snapshot: snapshot,
      subject_line: subjectLine,
      preview_text: previewText,
      audience_snapshot: null,
      created_by: cleanText(body.createdBy || "Marketing CRM", 200),
    }).select(CAMPAIGN_COLUMNS).single(),
    "Could not create campaign."
  );
  return { campaign: normalizeCampaign(data) };
}

async function updateCampaign(supabase, body = {}) {
  const existing = await loadCampaign(supabase, body.id || body.campaign?.id);
  if (existing.status === "archived") throw new CampaignValidationError("Archived campaigns are read only.");
  const values = campaignValues(body);
  const next = {
    name: cleanText(values.name ?? existing.name, 200),
    campaign_type: normalizeCampaignType(values.campaign_type ?? existing.campaign_type),
    objective: normalizeCampaignType(values.campaign_type ?? existing.campaign_type),
    subject_line: cleanText(values.subject_line ?? existing.subject_line, 300),
    preview_text: cleanText(values.preview_text ?? existing.preview_text, 300),
    status: normalizeEditableStatus(values.status ?? existing.status),
    template_snapshot: values.template_snapshot ? normalizeTemplateSnapshot(values.template_snapshot) : existing.template_snapshot,
  };
  if (!next.name) throw new CampaignValidationError("Campaign name is required.");
  if (!next.subject_line) throw new CampaignValidationError("Subject line is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").update(next).eq("id", existing.id).select(CAMPAIGN_COLUMNS).single(),
    "Could not update campaign."
  );
  return { campaign: normalizeCampaign(data) };
}

async function duplicateCampaign(supabase, body = {}) {
  const existing = await loadCampaign(supabase, body.id || body.campaign?.id);
  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").insert({
      name: `${existing.name} - Copy`,
      description: "",
      channel: "email",
      objective: existing.campaign_type,
      campaign_type: existing.campaign_type,
      status: "draft",
      tags: [],
      metadata: { duplicated_from: existing.id },
      template_id: existing.template_id || null,
      template_name: existing.template_name || "",
      template_snapshot: cloneSnapshot(existing.template_snapshot),
      subject_line: existing.subject_line,
      preview_text: existing.preview_text,
      audience_snapshot: existing.audience_snapshot,
      created_by: cleanText(body.createdBy || "Marketing CRM", 200),
    }).select(CAMPAIGN_COLUMNS).single(),
    "Could not duplicate campaign."
  );
  return { campaign: normalizeCampaign(data) };
}

async function archiveCampaign(supabase, body = {}) {
  const existing = await loadCampaign(supabase, body.id || body.campaign?.id);
  if (existing.status === "archived") return { campaign: existing };
  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", existing.id).select(CAMPAIGN_COLUMNS).single(),
    "Could not archive campaign."
  );
  return { campaign: normalizeCampaign(data) };
}

async function previewCampaign(supabase, body = {}) {
  const campaign = await loadCampaign(supabase, body.id || body.campaign?.id);
  return { preview: renderCampaignPreview(campaign) };
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
    else throw new CampaignValidationError("Unknown Marketing Campaigns API action.");
    json(response, 200, { ok: true, ...result });
  } catch (error) {
    const status = error instanceof CampaignValidationError || error?.statusCode === 400 ? 400 : 500;
    json(response, status, { ok: false, message: error?.message || "Marketing Campaigns API error." });
  }
}
