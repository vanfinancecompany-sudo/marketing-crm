import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_AUDIENCE_RULES,
  buildAudienceMetadata,
  buildAudienceResponse,
  countAudience,
  getAudienceMetadata,
  normalizeAudienceRules,
} from "../lib/marketingCampaignAudience.js";
import { DEFAULT_TAGS, SOURCE_OPTIONS } from "../utils/contactCleaning.js";

const CAMPAIGN_COLUMNS = "id,name,description,channel,objective,status,tags,metadata,created_by,created_at,updated_at,archived_at";
const BATCH_COLUMNS = "id,campaign_id,batch_number,status,requested_size,customer_count,audience_rules,audience_calculated_at,created_by,created_at,updated_at,exported_at,exported_by,export_filename,export_count,sent_at,cancelled_at,metadata";
const PRIVATE_BATCH_COLUMNS = `${BATCH_COLUMNS},export_csv`;
const API_KEY_HEADER = "x-marketing-customer-database-key";
const CHANNELS = new Set(["email", "sms", "facebook"]);
const OBJECTIVES = new Set(["new_stock", "promotion", "finance_offer", "rent2buy", "re_engagement", "custom"]);
const STATUSES = new Set(["draft", "ready", "running", "paused", "completed", "archived"]);
const ACTIVE_STATUSES = ["ready", "running", "paused"];
const MAX_BATCH_SIZE = 5000;

const EMPTY_BATCH_SUMMARY = {
  total_batches: 0,
  total_customers_batched: 0,
  total_customers_exported: 0,
  pending_batches: 0,
  last_batch_created_at: "",
  last_exported_at: "",
  last_activity_at: "",
};

function json(response, status, payload) {
  response.status(status).json(payload);
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing server Supabase environment variables.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
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
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body;
}

function assertSupabase(result, fallbackMessage) {
  if (result.error) {
    throw new Error(result.error.message || fallbackMessage);
  }
  return result;
}

function isMissingBatchInfrastructure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("marketing_campaign_batches")
    || message.includes("marketing_campaign_batch_customers")
    || message.includes("marketing_preview_next_campaign_batch")
    || message.includes("marketing_generate_campaign_batch")
    || message.includes("export_filename")
    || message.includes("export_count")
    || message.includes("export_csv")
    || message.includes("exported_by")
    || message.includes("could not find the function")
    || message.includes("does not exist");
}

function latestIso(...values) {
  return values.filter(Boolean).sort((first, second) => new Date(second).getTime() - new Date(first).getTime())[0] || "";
}

function calculateProgress(customersBatched, customersRemaining) {
  const batched = Number(customersBatched || 0);
  const remaining = Number(customersRemaining || 0);
  const denominator = batched + remaining;
  if (!denominator) return 0;
  return Math.round((batched / denominator) * 1000) / 10;
}

function normalizeCampaign(row = {}) {
  return {
    id: row.id || "",
    name: row.name || "",
    description: row.description || "",
    channel: row.channel || "email",
    objective: row.objective || "custom",
    status: row.status || "draft",
    tags: Array.isArray(row.tags) ? row.tags : [],
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    batch_summary: row.batch_summary || EMPTY_BATCH_SUMMARY,
    created_by: row.created_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    archived_at: row.archived_at || "",
  };
}

function normalizeBatch(row = {}) {
  return {
    id: row.id || "",
    campaign_id: row.campaign_id || "",
    batch_number: Number(row.batch_number || 0),
    status: row.status || "pending",
    requested_size: Number(row.requested_size || 0),
    customer_count: Number(row.customer_count || 0),
    audience_rules: row.audience_rules && typeof row.audience_rules === "object" ? row.audience_rules : {},
    audience_calculated_at: row.audience_calculated_at || "",
    created_by: row.created_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    exported_at: row.exported_at || "",
    exported_by: row.exported_by || "",
    export_filename: row.export_filename || "",
    export_count: Number(row.export_count || 0),
    sent_at: row.sent_at || "",
    cancelled_at: row.cancelled_at || "",
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}

function normalizePrivateBatch(row = {}) {
  return {
    ...normalizeBatch(row),
    export_csv: row.export_csv || "",
  };
}

function normalizeBatchPreview(row = {}) {
  return {
    eligible_count: Number(row.eligible_count || 0),
    already_batched: Number(row.already_batched || 0),
    remaining_count: Number(row.remaining_count || 0),
    requested_size: Number(row.requested_size || 0),
    selected_count: Number(row.selected_count || 0),
    next_batch_number: Number(row.next_batch_number || 1),
    total_batches: Number(row.total_batches || 0),
    total_customers_batched: Number(row.total_customers_batched || 0),
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanCampaignValues(values = {}, existingCampaign = null) {
  const name = cleanText(values.name);
  const channel = cleanText(values.channel || existingCampaign?.channel || "email").toLowerCase();
  const objective = cleanText(values.objective || existingCampaign?.objective || "custom").toLowerCase();
  const requestedStatus = cleanText(values.status || existingCampaign?.status || "draft").toLowerCase();
  const status = existingCampaign?.status === "archived" ? "archived" : requestedStatus;

  if (!name) throw new Error("Campaign name is required.");
  if (!CHANNELS.has(channel)) throw new Error("Unsupported campaign channel.");
  if (!OBJECTIVES.has(objective)) throw new Error("Unsupported campaign objective.");
  if (!STATUSES.has(status)) throw new Error("Unsupported campaign status.");
  if (existingCampaign?.status !== "archived" && requestedStatus === "archived") {
    throw new Error("Use the dedicated Archive action to archive campaigns.");
  }

  return {
    name,
    description: String(values.description || "").trim(),
    channel,
    objective,
    status,
  };
}

function validateBatchSize(value) {
  const size = Number(value || 0);
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH_SIZE) {
    throw new Error("Batch size must be between 1 and 5000.");
  }
  return size;
}

function neutralizeCsvFormula(value) {
  const text = String(value ?? "");
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

function escapeCsvValue(value) {
  const text = neutralizeCsvFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildBatchExportFilename(campaign, batch) {
  const safeName = String(campaign?.name || "campaign").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "campaign";
  return `${safeName}-batch-${batch.batch_number}.csv`;
}

function buildBatchCsv(rows) {
  const headers = ["customer_id", "name", "email", "phone", "postcode", "pipeline", "source"];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(","));
  });
  return lines.join("\n");
}

async function loadCampaign(supabase, id) {
  if (!id) throw new Error("Campaign ID is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).single(),
    "Could not load marketing campaign."
  );
  return normalizeCampaign(data);
}

async function loadBatch(supabase, id) {
  if (!id) throw new Error("Batch ID is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_campaign_batches").select(BATCH_COLUMNS).eq("id", id).single(),
    "Could not load campaign batch."
  );
  return normalizeBatch(data);
}

async function loadPrivateBatch(supabase, id) {
  if (!id) throw new Error("Batch ID is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_campaign_batches").select(PRIVATE_BATCH_COLUMNS).eq("id", id).single(),
    "Could not load campaign batch."
  );
  return normalizePrivateBatch(data);
}

async function countCampaigns(supabase, filter = {}) {
  let query = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true });
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.statuses) query = query.in("status", filter.statuses);
  const { count } = assertSupabase(await query, "Could not count campaigns.");
  return count || 0;
}

async function getCampaignStats(supabase) {
  const [total, draft, active, completed, archived, allBatches] = await Promise.all([
    countCampaigns(supabase),
    countCampaigns(supabase, { status: "draft" }),
    countCampaigns(supabase, { statuses: ACTIVE_STATUSES }),
    countCampaigns(supabase, { status: "completed" }),
    countCampaigns(supabase, { status: "archived" }),
    supabase.from("marketing_campaign_batches").select("status,customer_count,export_count"),
  ]);

  const batchRows = allBatches.error && isMissingBatchInfrastructure(allBatches.error) ? [] : assertSupabase(allBatches, "Could not count campaign batches.").data || [];
  return {
    total,
    draft,
    active,
    completed,
    archived,
    total_customers_batched: batchRows.reduce((sum, row) => sum + Number(row.customer_count || 0), 0),
    total_customers_exported: batchRows.reduce((sum, row) => sum + (row.status === "exported" ? Number(row.export_count || row.customer_count || 0) : 0), 0),
    pending_batches: batchRows.filter((row) => row.status === "pending").length,
  };
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function buildOpportunityRules(overrides = {}) {
  return normalizeAudienceRules({ ...DEFAULT_AUDIENCE_RULES, ...overrides });
}

function buildOpportunityName(channel, title) {
  const month = new Date().toLocaleString("en-GB", { month: "short", year: "numeric" });
  const channelLabel = channel === "sms" ? "SMS" : channel === "facebook" ? "Facebook" : "Email";
  return `${channelLabel} - ${title} - ${month}`;
}

function buildOpportunity({ id, title, description, customerCount, channel, objective, rules, campaignCreationSupported = false, unsupportedReason = "Audience filter not yet available" }) {
  const supported = Boolean(campaignCreationSupported);
  return {
    id,
    title,
    description,
    customer_count: Number(customerCount || 0),
    recommended_channel: channel,
    recommended_objective: objective,
    default_audience_rules: supported ? buildOpportunityRules(rules) : null,
    suggested_name: supported ? buildOpportunityName(channel, title) : "",
    campaign_creation_supported: supported,
    unsupported_reason: supported ? "" : unsupportedReason,
  };
}

async function countContacts(supabase, applyQuery) {
  let query = supabase.from("marketing_contacts").select("id", { count: "exact", head: true });
  if (applyQuery) query = applyQuery(query);
  const { count } = assertSupabase(await query, "Could not count marketing opportunity customers.");
  return count || 0;
}

async function getExportedCustomerIdsByChannel(supabase) {
  const exportedByChannel = { email: new Set(), sms: new Set(), facebook: new Set() };

  try {
    const { data: campaigns } = assertSupabase(
      await supabase.from("marketing_campaigns").select("id,channel").in("channel", ["email", "sms", "facebook"]),
      "Could not load exported campaign channels."
    );
    const channelByCampaignId = new Map((campaigns || []).filter((campaign) => CHANNELS.has(campaign.channel)).map((campaign) => [campaign.id, campaign.channel]));
    const campaignIds = [...channelByCampaignId.keys()];
    if (!campaignIds.length) return exportedByChannel;

    const batches = [];
    for (let index = 0; index < campaignIds.length; index += 100) {
      const campaignChunk = campaignIds.slice(index, index + 100);
      const { data } = assertSupabase(
        await supabase.from("marketing_campaign_batches").select("id,campaign_id").in("campaign_id", campaignChunk).eq("status", "exported"),
        "Could not load exported campaign batches."
      );
      batches.push(...(data || []));
    }

    const channelByBatchId = new Map(batches.map((batch) => [batch.id, channelByCampaignId.get(batch.campaign_id)]).filter(([, channel]) => Boolean(channel)));
    const batchIds = [...channelByBatchId.keys()];
    if (!batchIds.length) return exportedByChannel;

    for (let index = 0; index < batchIds.length; index += 100) {
      const batchChunk = batchIds.slice(index, index + 100);
      const { data } = assertSupabase(
        await supabase.from("marketing_campaign_batch_customers").select("batch_id,customer_id").in("batch_id", batchChunk),
        "Could not load exported marketing customer membership."
      );
      (data || []).forEach((row) => {
        const channel = channelByBatchId.get(row.batch_id);
        if (channel && row.customer_id) exportedByChannel[channel].add(row.customer_id);
      });
    }
  } catch (error) {
    if (!isMissingBatchInfrastructure(error)) throw error;
  }

  return exportedByChannel;
}

async function countReadyExportedCustomers(supabase, exportedByChannel) {
  const readyColumns = { email: "email_ready", sms: "sms_ready", facebook: "facebook_ready" };
  const counts = { email: 0, sms: 0, facebook: 0 };

  for (const [channel, idsSet] of Object.entries(exportedByChannel)) {
    const ids = [...idsSet];
    const readyColumn = readyColumns[channel];
    if (!ids.length || !readyColumn) continue;

    for (let index = 0; index < ids.length; index += 500) {
      const idChunk = ids.slice(index, index + 500);
      const { count } = assertSupabase(
        await supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).in("id", idChunk).eq(readyColumn, true),
        "Could not count exported ready marketing customers."
      );
      counts[channel] += count || 0;
    }
  }

  return counts;
}

async function countUntaggedContacts(supabase) {
  try {
    return await countContacts(supabase, (query) => query.or("tags.is.null,tags.eq.{}"));
  } catch {
    return countContacts(supabase, (query) => query.is("tags", null));
  }
}

async function countMultipleApplications(supabase) {
  try {
    return await countContacts(supabase, (query) => query.gt("application_count", 1));
  } catch {
    return null;
  }
}

async function getMarketingOpportunities(supabase) {
  const [readyCounts, exportedByChannel, dormant, recentImports, untagged, multipleApplications] = await Promise.all([
    Promise.all([
      countContacts(supabase, (query) => query.eq("email_ready", true)),
      countContacts(supabase, (query) => query.eq("sms_ready", true)),
      countContacts(supabase, (query) => query.eq("facebook_ready", true)),
    ]),
    getExportedCustomerIdsByChannel(supabase),
    countContacts(supabase, (query) => query.lt("last_seen_at", daysAgoIso(180))),
    countContacts(supabase, (query) => query.gte("created_at", daysAgoIso(7))),
    countUntaggedContacts(supabase),
    countMultipleApplications(supabase),
  ]);
  const exportedReadyCounts = await countReadyExportedCustomers(supabase, exportedByChannel);
  const [emailReady, smsReadyTotal, facebookReadyTotal] = readyCounts;

  const opportunities = [
    buildOpportunity({
      id: "never_marketed_email",
      title: "Never Marketed",
      description: "Email-ready customers who have never been exported in an Email campaign.",
      customerCount: Math.max(0, emailReady - exportedReadyCounts.email),
      channel: "email",
      objective: "re_engagement",
      rules: {},
      unsupportedReason: "Audience filter not yet available",
    }),
    buildOpportunity({
      id: "sms_ready_never_exported",
      title: "SMS Ready",
      description: "SMS-ready customers who have never been exported in an SMS campaign.",
      customerCount: Math.max(0, smsReadyTotal - exportedReadyCounts.sms),
      channel: "sms",
      objective: "promotion",
      rules: {},
      unsupportedReason: "Audience filter not yet available",
    }),
    buildOpportunity({
      id: "facebook_ready_never_exported",
      title: "Facebook Ready",
      description: "Facebook-ready customers who have never been exported in a Facebook campaign.",
      customerCount: Math.max(0, facebookReadyTotal - exportedReadyCounts.facebook),
      channel: "facebook",
      objective: "promotion",
      rules: {},
      unsupportedReason: "Audience filter not yet available",
    }),
    buildOpportunity({
      id: "dormant_customers",
      title: "Dormant Customers",
      description: "Customers with no recorded activity for more than 180 days.",
      customerCount: dormant,
      channel: "email",
      objective: "re_engagement",
      rules: { last_seen_period: "more_than_180" },
      campaignCreationSupported: true,
    }),
    buildOpportunity({
      id: "recent_imports",
      title: "Recent Imports",
      description: "Customers created in the last 7 days.",
      customerCount: recentImports,
      channel: "email",
      objective: "new_stock",
      rules: { created_period: "last7" },
      campaignCreationSupported: true,
    }),
    buildOpportunity({
      id: "untagged_customers",
      title: "Untagged Customers",
      description: "Customers with no tags, ready for future segmentation cleanup.",
      customerCount: untagged,
      channel: "email",
      objective: "custom",
      rules: {},
      unsupportedReason: "Audience filter not yet available",
    }),
  ];

  if (multipleApplications !== null) {
    opportunities.push(buildOpportunity({
      id: "multiple_applications",
      title: "Multiple Applications",
      description: "Customers with more than one recorded application.",
      customerCount: multipleApplications,
      channel: "email",
      objective: "finance_offer",
      rules: {},
      unsupportedReason: "Audience filter not yet available",
    }));
  }

  return { opportunities };
}

async function getBatchSummaryMap(supabase, campaignIds = []) {
  const ids = campaignIds.filter(Boolean);
  const summaries = new Map(ids.map((id) => [id, { ...EMPTY_BATCH_SUMMARY }]));
  if (!ids.length) return summaries;

  try {
    const { data } = assertSupabase(
      await supabase.from("marketing_campaign_batches").select("campaign_id,customer_count,status,export_count,created_at,exported_at").in("campaign_id", ids),
      "Could not load campaign batch summaries."
    );
    (data || []).forEach((row) => {
      const current = summaries.get(row.campaign_id) || { ...EMPTY_BATCH_SUMMARY };
      current.total_batches += 1;
      current.total_customers_batched += Number(row.customer_count || 0);
      if (row.status === "pending") current.pending_batches += 1;
      if (row.status === "exported") current.total_customers_exported += Number(row.export_count || row.customer_count || 0);
      current.last_batch_created_at = latestIso(current.last_batch_created_at, row.created_at);
      current.last_exported_at = latestIso(current.last_exported_at, row.exported_at);
      current.last_activity_at = latestIso(current.last_activity_at, row.created_at, row.exported_at);
      summaries.set(row.campaign_id, current);
    });
  } catch (error) {
    if (!isMissingBatchInfrastructure(error)) throw error;
  }

  return summaries;
}

async function listCampaigns(supabase, body) {
  const includeArchived = Boolean(body.includeArchived);
  let query = supabase
    .from("marketing_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .order("updated_at", { ascending: false });

  if (!includeArchived) query = query.neq("status", "archived");

  const { data } = assertSupabase(await query, "Could not load marketing campaigns.");
  const rows = data || [];
  const batchSummaries = await getBatchSummaryMap(supabase, rows.map((campaign) => campaign.id));
  return {
    campaigns: rows.map((campaign) => {
      const batchSummary = batchSummaries.get(campaign.id) || EMPTY_BATCH_SUMMARY;
      return normalizeCampaign({
        ...campaign,
        batch_summary: {
          ...batchSummary,
          last_activity_at: latestIso(campaign.updated_at, batchSummary.last_activity_at),
        },
      });
    }),
    stats: await getCampaignStats(supabase),
  };
}

async function createCampaign(supabase, body) {
  const payload = cleanCampaignValues({ ...(body.values || {}), status: "draft" });
  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").insert(payload).select(CAMPAIGN_COLUMNS).single(),
    "Could not create marketing campaign."
  );
  return { campaign: normalizeCampaign(data), stats: await getCampaignStats(supabase) };
}

async function createCampaignWithAudience(supabase, body) {
  const payload = cleanCampaignValues({ ...(body.values || {}), status: "draft" });
  const rules = normalizeAudienceRules({ ...DEFAULT_AUDIENCE_RULES, ...(body.rules || {}) });
  const calculatedAt = new Date().toISOString();
  const eligibleCount = await countAudience(supabase, { channel: payload.channel }, rules);
  payload.metadata = {
    ...(body.values?.metadata && typeof body.values.metadata === "object" ? body.values.metadata : {}),
    audience: buildAudienceMetadata(rules, eligibleCount, calculatedAt),
  };

  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").insert(payload).select(CAMPAIGN_COLUMNS).single(),
    "Could not create marketing campaign with audience."
  );

  return {
    campaign: normalizeCampaign(data),
    audience: buildAudienceResponse(rules, eligibleCount, calculatedAt),
    stats: await getCampaignStats(supabase),
  };
}

async function updateCampaign(supabase, body) {
  const id = body.campaign?.id || body.id;
  const existingCampaign = await loadCampaign(supabase, id);
  const payload = cleanCampaignValues(body.values || {}, existingCampaign);

  if (existingCampaign.status === "archived") {
    payload.archived_at = existingCampaign.archived_at || new Date().toISOString();
  }

  if (payload.channel !== existingCampaign.channel && existingCampaign.metadata?.audience) {
    payload.metadata = {
      ...existingCampaign.metadata,
      audience: {
        ...existingCampaign.metadata.audience,
        eligible_count: null,
        calculated_at: null,
      },
    };
  }

  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").update(payload).eq("id", id).select(CAMPAIGN_COLUMNS).single(),
    "Could not update marketing campaign."
  );
  return { campaign: normalizeCampaign(data), stats: await getCampaignStats(supabase) };
}

async function archiveCampaign(supabase, body) {
  const id = body.campaign?.id || body.id;
  if (!id) throw new Error("Campaign ID is required.");

  const { data } = assertSupabase(
    await supabase
      .from("marketing_campaigns")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", id)
      .select(CAMPAIGN_COLUMNS)
      .single(),
    "Could not archive marketing campaign."
  );
  return { campaign: normalizeCampaign(data), stats: await getCampaignStats(supabase) };
}

async function getAudienceOptions() {
  return {
    sources: Array.from(new Set(SOURCE_OPTIONS.map((source) => String(source || "").trim()).filter(Boolean))).sort(),
    tags: Array.from(new Set(DEFAULT_TAGS.map((tag) => String(tag || "").trim()).filter(Boolean))).sort(),
  };
}

async function previewAudience(supabase, body) {
  const campaign = await loadCampaign(supabase, body.campaign?.id || body.id);
  if (campaign.status === "archived") throw new Error("Archived campaigns cannot preview audiences.");
  const rules = normalizeAudienceRules(body.rules || DEFAULT_AUDIENCE_RULES);
  const eligibleCount = await countAudience(supabase, campaign, rules);
  const calculatedAt = new Date().toISOString();
  return { audience: buildAudienceResponse(rules, eligibleCount, calculatedAt) };
}

async function saveAudience(supabase, body) {
  const campaign = await loadCampaign(supabase, body.campaign?.id || body.id);
  if (campaign.status === "archived") throw new Error("Archived campaigns cannot update audience rules.");
  const rules = normalizeAudienceRules(body.rules || DEFAULT_AUDIENCE_RULES);
  const eligibleCount = await countAudience(supabase, campaign, rules);
  const calculatedAt = new Date().toISOString();
  const metadata = {
    ...(campaign.metadata || {}),
    audience: buildAudienceMetadata(rules, eligibleCount, calculatedAt),
  };

  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").update({ metadata }).eq("id", campaign.id).select(CAMPAIGN_COLUMNS).single(),
    "Could not save campaign audience rules."
  );

  return {
    campaign: normalizeCampaign(data),
    audience: buildAudienceResponse(rules, eligibleCount, calculatedAt),
  };
}

function summarizeBatches(batches = []) {
  return {
    total_batches: batches.length,
    total_customers_batched: batches.reduce((total, batch) => total + Number(batch.customer_count || 0), 0),
    total_customers_exported: batches.reduce((total, batch) => total + (batch.status === "exported" ? Number(batch.export_count || batch.customer_count || 0) : 0), 0),
    pending_batches: batches.filter((batch) => batch.status === "pending").length,
    last_batch_created_at: batches.reduce((latest, batch) => latestIso(latest, batch.created_at), ""),
    last_exported_at: batches.reduce((latest, batch) => latestIso(latest, batch.exported_at), ""),
    last_activity_at: batches.reduce((latest, batch) => latestIso(latest, batch.created_at, batch.exported_at), ""),
  };
}

async function listBatches(supabase, body) {
  const campaign = await loadCampaign(supabase, body.campaign?.id || body.id);
  try {
    const { data } = assertSupabase(
      await supabase.from("marketing_campaign_batches").select(BATCH_COLUMNS).eq("campaign_id", campaign.id).order("batch_number", { ascending: false }),
      "Could not load campaign batches."
    );
    const batches = (data || []).map(normalizeBatch);
    return {
      batches,
      summary: summarizeBatches(batches),
    };
  } catch (error) {
    if (isMissingBatchInfrastructure(error)) return { batches: [], summary: { ...EMPTY_BATCH_SUMMARY, migration_required: true } };
    throw error;
  }
}

async function previewNextBatch(supabase, body) {
  const campaign = await loadCampaign(supabase, body.campaign?.id || body.id);
  const requestedSize = validateBatchSize(body.requestedSize || body.requested_size);
  try {
    const { data } = assertSupabase(
      await supabase.rpc("marketing_preview_next_campaign_batch", { p_campaign_id: campaign.id, p_requested_size: requestedSize }),
      "Could not preview the next campaign batch."
    );
    return { preview: normalizeBatchPreview((data || [])[0]) };
  } catch (error) {
    if (isMissingBatchInfrastructure(error)) throw new Error("Campaign batch migration has not been applied yet.");
    throw error;
  }
}

async function generateBatch(supabase, body) {
  const campaign = await loadCampaign(supabase, body.campaign?.id || body.id);
  const requestedSize = validateBatchSize(body.requestedSize || body.requested_size);
  try {
    const { data } = assertSupabase(
      await supabase.rpc("marketing_generate_campaign_batch", { p_campaign_id: campaign.id, p_requested_size: requestedSize, p_created_by: body.createdBy || null }),
      "Could not generate campaign batch."
    );
    const row = (data || [])[0];
    if (!row) throw new Error("No batch was generated.");
    return {
      batch: normalizeBatch(row),
      summary: {
        total_batches: Number(row.total_batches || 0),
        total_customers_batched: Number(row.total_customers_batched || 0),
        total_customers_exported: 0,
      },
    };
  } catch (error) {
    if (isMissingBatchInfrastructure(error)) throw new Error("Campaign batch migration has not been applied yet.");
    throw error;
  }
}

async function getCampaignDashboard(supabase, body) {
  const campaign = await loadCampaign(supabase, body.campaign?.id || body.id);
  const preferredBatchSize = validateBatchSize(body.preferredBatchSize || body.requestedSize || 1000);
  const batchResult = await listBatches(supabase, { campaign });
  let preview = null;

  if (campaign.status !== "archived" && getAudienceMetadata(campaign).calculated_at) {
    try {
      preview = (await previewNextBatch(supabase, { campaign, requestedSize: preferredBatchSize })).preview;
    } catch (error) {
      if (!isMissingBatchInfrastructure(error)) throw error;
    }
  }

  const remaining = Number(preview?.remaining_count ?? 0);
  const batched = Number(batchResult.summary.total_customers_batched || 0);
  const progressPercent = calculateProgress(batched, remaining);
  return {
    dashboard: {
      eligible_now: Number(preview?.eligible_count ?? 0),
      customers_batched: batched,
      customers_exported: Number(batchResult.summary.total_customers_exported || 0),
      customers_remaining: remaining,
      batches_generated: Number(batchResult.summary.total_batches || 0),
      pending_batches: Number(batchResult.summary.pending_batches || 0),
      estimated_batches_left: remaining > 0 ? Math.ceil(remaining / preferredBatchSize) : 0,
      preferred_batch_size: preferredBatchSize,
      last_exported_at: batchResult.summary.last_exported_at || "",
      last_activity_at: latestIso(campaign.updated_at, batchResult.summary.last_activity_at),
      progress_percent: progressPercent,
      preview,
    },
  };
}

async function loadBatchCsvRows(supabase, batch) {
  const { data } = assertSupabase(
    await supabase
      .from("marketing_campaign_batch_customers")
      .select("customer_id,marketing_contacts!inner(id,name,email,phone,postcode,pipeline,source)")
      .eq("batch_id", batch.id)
      .order("added_at", { ascending: true }),
    "Could not load batch customers for export."
  );

  const rows = [];
  const seen = new Set();
  (data || []).forEach((row) => {
    const customer = Array.isArray(row.marketing_contacts) ? row.marketing_contacts[0] : row.marketing_contacts;
    const customerId = row.customer_id || customer?.id;
    if (!customerId || seen.has(customerId)) return;
    seen.add(customerId);
    rows.push({
      customer_id: customerId,
      name: customer?.name || "",
      email: customer?.email || "",
      phone: customer?.phone || "",
      postcode: customer?.postcode || "",
      pipeline: customer?.pipeline || "",
      source: customer?.source || "",
    });
  });
  return rows;
}

async function buildFirstBatchExport(supabase, batch) {
  const campaign = await loadCampaign(supabase, batch.campaign_id);
  const rows = await loadBatchCsvRows(supabase, batch);
  const filename = buildBatchExportFilename(campaign, batch);
  return { campaign, rows, filename, csv: buildBatchCsv(rows) };
}

async function listBatchHistory(supabase, body) {
  return listBatches(supabase, body);
}

async function returnStoredExport(supabase, batch) {
  if (!batch.export_csv) throw new Error("This batch does not have a stored export snapshot.");
  return {
    batch: normalizeBatch(batch),
    csv: { filename: batch.export_filename, content: batch.export_csv, count: batch.export_count },
    summary: await getBatchSummaryMap(supabase, [batch.campaign_id]).then((map) => map.get(batch.campaign_id) || EMPTY_BATCH_SUMMARY),
  };
}

async function exportBatch(supabase, body) {
  const batch = await loadPrivateBatch(supabase, body.batch?.id || body.batchId || body.id);
  if (batch.status === "exported") {
    if (!body.confirmExport) throw new Error("This batch has already been exported. Confirm before exporting it again.");
    return returnStoredExport(supabase, batch);
  }
  if (batch.status !== "pending") throw new Error(`Only pending batches can be exported. Current status: ${batch.status || "unknown"}.`);
  if (batch.export_csv) throw new Error("This batch already has a stored export snapshot.");

  const { rows, filename, csv } = await buildFirstBatchExport(supabase, batch);
  const exportedAt = new Date().toISOString();
  const updateResult = assertSupabase(
    await supabase
      .from("marketing_campaign_batches")
      .update({
        status: "exported",
        exported_at: exportedAt,
        exported_by: cleanText(body.exportedBy || body.createdBy || ""),
        export_filename: filename,
        export_count: rows.length,
        export_csv: csv,
      })
      .eq("id", batch.id)
      .eq("status", "pending")
      .is("export_csv", null)
      .select(PRIVATE_BATCH_COLUMNS),
    "Could not mark campaign batch as exported."
  );
  const updatedBatch = normalizePrivateBatch((updateResult.data || [])[0]);

  if (!updatedBatch.id) {
    const currentBatch = await loadPrivateBatch(supabase, batch.id);
    if (currentBatch.status === "exported") {
      if (!body.confirmExport) throw new Error("This batch has already been exported. Confirm before exporting it again.");
      return returnStoredExport(supabase, currentBatch);
    }
    throw new Error(`Only pending batches can be exported. Current status: ${currentBatch.status || "unknown"}.`);
  }

  return {
    batch: normalizeBatch(updatedBatch),
    csv: { filename: updatedBatch.export_filename, content: updatedBatch.export_csv, count: updatedBatch.export_count },
    summary: await getBatchSummaryMap(supabase, [updatedBatch.campaign_id]).then((map) => map.get(updatedBatch.campaign_id) || EMPTY_BATCH_SUMMARY),
  };
}

async function downloadBatchCsv(supabase, body) {
  const batch = await loadPrivateBatch(supabase, body.batch?.id || body.batchId || body.id);
  if (batch.status !== "exported") throw new Error("Export this batch before downloading the CSV.");
  return {
    batch: normalizeBatch(batch),
    csv: { filename: batch.export_filename, content: batch.export_csv, count: batch.export_count },
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Marketing Campaign API access denied." });
    return;
  }

  try {
    const supabase = getSupabase();
    const body = parseBody(request);
    const action = body.action || "list";
    let result;

    if (action === "list") result = await listCampaigns(supabase, body);
    else if (action === "create") result = await createCampaign(supabase, body);
    else if (action === "createWithAudience") result = await createCampaignWithAudience(supabase, body);
    else if (action === "update") result = await updateCampaign(supabase, body);
    else if (action === "archive") result = await archiveCampaign(supabase, body);
    else if (action === "audienceOptions") result = { options: await getAudienceOptions() };
    else if (action === "marketingOpportunities") result = await getMarketingOpportunities(supabase);
    else if (action === "previewAudience") result = await previewAudience(supabase, body);
    else if (action === "saveAudience") result = await saveAudience(supabase, body);
    else if (action === "listBatches") result = await listBatches(supabase, body);
    else if (action === "listBatchHistory") result = await listBatchHistory(supabase, body);
    else if (action === "campaignDashboard") result = await getCampaignDashboard(supabase, body);
    else if (action === "previewNextBatch") result = await previewNextBatch(supabase, body);
    else if (action === "generateBatch") result = await generateBatch(supabase, body);
    else if (action === "exportBatch") result = await exportBatch(supabase, body);
    else if (action === "downloadBatchCsv") result = await downloadBatchCsv(supabase, body);
    else throw new Error("Unknown Marketing Campaign API action.");

    json(response, 200, { ok: true, ...result });
  } catch (error) {
    json(response, 500, { ok: false, message: error?.message || "Marketing Campaign API error." });
  }
}
