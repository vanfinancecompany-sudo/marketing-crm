import { createClient } from "@supabase/supabase-js";
import { DEFAULT_TAGS, SOURCE_OPTIONS } from "../utils/contactCleaning.js";

const CAMPAIGN_COLUMNS = "id,name,description,channel,objective,status,tags,metadata,created_by,created_at,updated_at,archived_at";
const API_KEY_HEADER = "x-marketing-customer-database-key";
const CHANNELS = new Set(["email", "sms", "facebook"]);
const OBJECTIVES = new Set(["new_stock", "promotion", "finance_offer", "rent2buy", "re_engagement", "custom"]);
const STATUSES = new Set(["draft", "ready", "running", "paused", "completed", "archived"]);
const ACTIVE_STATUSES = ["ready", "running", "paused"];
const PIPELINES = new Set(["all", "finance", "rent2buy", "both"]);
const LAST_SEEN_PERIODS = new Set(["all", "last30", "last90", "last180", "last365", "more_than_180"]);
const CREATED_PERIODS = new Set(["all", "today", "last7", "last30", "last90", "this_year"]);

const DEFAULT_AUDIENCE_RULES = {
  pipeline: "all",
  source: "all",
  required_tags: [],
  exclude_tags: [],
  last_seen_period: "all",
  created_period: "all",
  exclude_unknown_pipeline: false,
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
    created_by: row.created_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    archived_at: row.archived_at || "",
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

function cleanList(values) {
  const list = Array.isArray(values) ? values : [];
  return Array.from(new Set(list.map((value) => String(value || "").trim()).filter(Boolean).filter((value) => value.length <= 80 && !/[{}"\\]/.test(value)))).sort();
}

function normalizeAudienceRules(values = {}) {
  const pipeline = String(values.pipeline || "all").trim().toLowerCase();
  const source = String(values.source || "all").trim();
  const lastSeenPeriod = String(values.last_seen_period || "all").trim();
  const createdPeriod = String(values.created_period || "all").trim();

  if (!PIPELINES.has(pipeline)) throw new Error("Unsupported audience pipeline filter.");
  if (!source || source.length > 120 || /[%{}"\\]/.test(source)) throw new Error("Unsupported audience source filter.");
  if (!LAST_SEEN_PERIODS.has(lastSeenPeriod)) throw new Error("Unsupported last seen filter.");
  if (!CREATED_PERIODS.has(createdPeriod)) throw new Error("Unsupported created date filter.");

  return {
    pipeline,
    source,
    required_tags: cleanList(values.required_tags),
    exclude_tags: cleanList(values.exclude_tags),
    last_seen_period: lastSeenPeriod,
    created_period: createdPeriod,
    exclude_unknown_pipeline: Boolean(values.exclude_unknown_pipeline),
  };
}

function getAudienceMetadata(campaign) {
  const audience = campaign.metadata?.audience || {};
  return {
    rules: normalizeAudienceRules({ ...DEFAULT_AUDIENCE_RULES, ...(audience.rules || {}) }),
    eligible_count: Number.isFinite(Number(audience.eligible_count)) ? Number(audience.eligible_count) : null,
    calculated_at: audience.calculated_at || null,
  };
}

function getLondonDateParts(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getLondonOffsetMs(date) {
  const parts = getLondonDateParts(date);
  const londonAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return londonAsUtc - date.getTime();
}

function startOfLondonToday(now = new Date()) {
  const parts = getLondonDateParts(now);
  const utcApproximation = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0));
  const offset = getLondonOffsetMs(utcApproximation);
  return new Date(utcApproximation.getTime() - offset).toISOString();
}

function startOfYearIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0)).toISOString();
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function arrayLiteral(value) {
  return `{${String(value).replace(/"/g, "").replace(/\\/g, "")}}`;
}

function applyAudienceQuery(query, rules, channel) {
  if (channel === "email") query = query.eq("email_ready", true);
  else if (channel === "sms") query = query.eq("sms_ready", true);
  else if (channel === "facebook") query = query.eq("facebook_ready", true);
  else throw new Error("Unsupported campaign channel.");

  if (rules.pipeline !== "all") query = query.eq("pipeline", rules.pipeline);
  if (rules.source !== "all") query = query.eq("source", rules.source);
  if (rules.exclude_unknown_pipeline) query = query.neq("pipeline", "unknown").neq("pipeline", "");
  if (rules.required_tags.length) query = query.overlaps("tags", rules.required_tags);
  for (const tag of rules.exclude_tags) query = query.not("tags", "cs", arrayLiteral(tag));

  if (rules.last_seen_period === "last30") query = query.gte("last_seen_at", daysAgoIso(30));
  if (rules.last_seen_period === "last90") query = query.gte("last_seen_at", daysAgoIso(90));
  if (rules.last_seen_period === "last180") query = query.gte("last_seen_at", daysAgoIso(180));
  if (rules.last_seen_period === "last365") query = query.gte("last_seen_at", daysAgoIso(365));
  if (rules.last_seen_period === "more_than_180") query = query.lt("last_seen_at", daysAgoIso(180));

  if (rules.created_period === "today") query = query.gte("created_at", startOfLondonToday());
  if (rules.created_period === "last7") query = query.gte("created_at", daysAgoIso(7));
  if (rules.created_period === "last30") query = query.gte("created_at", daysAgoIso(30));
  if (rules.created_period === "last90") query = query.gte("created_at", daysAgoIso(90));
  if (rules.created_period === "this_year") query = query.gte("created_at", startOfYearIso());

  return query;
}

async function countAudience(supabase, campaign, rules) {
  const query = applyAudienceQuery(
    supabase.from("marketing_contacts").select("id", { count: "exact", head: true }),
    rules,
    campaign.channel
  );
  const { count } = assertSupabase(await query, "Could not preview campaign audience.");
  return count || 0;
}

async function loadCampaign(supabase, id) {
  if (!id) throw new Error("Campaign ID is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).single(),
    "Could not load marketing campaign."
  );
  return normalizeCampaign(data);
}

async function countCampaigns(supabase, filter = {}) {
  let query = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true });
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.statuses) query = query.in("status", filter.statuses);
  const { count } = assertSupabase(await query, "Could not count campaigns.");
  return count || 0;
}

async function getCampaignStats(supabase) {
  const [total, draft, active, completed, archived] = await Promise.all([
    countCampaigns(supabase),
    countCampaigns(supabase, { status: "draft" }),
    countCampaigns(supabase, { statuses: ACTIVE_STATUSES }),
    countCampaigns(supabase, { status: "completed" }),
    countCampaigns(supabase, { status: "archived" }),
  ]);

  return { total, draft, active, completed, archived };
}

async function listCampaigns(supabase, body) {
  const includeArchived = Boolean(body.includeArchived);
  let query = supabase
    .from("marketing_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .order("updated_at", { ascending: false });

  if (!includeArchived) query = query.neq("status", "archived");

  const { data } = assertSupabase(await query, "Could not load marketing campaigns.");
  return {
    campaigns: (data || []).map(normalizeCampaign),
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
  return {
    audience: {
      eligible_count: eligibleCount,
      calculated_at: calculatedAt,
      breakdown: { channel_ready: eligibleCount },
      rules,
    },
  };
}

async function saveAudience(supabase, body) {
  const campaign = await loadCampaign(supabase, body.campaign?.id || body.id);
  if (campaign.status === "archived") throw new Error("Archived campaigns cannot update audience rules.");
  const rules = normalizeAudienceRules(body.rules || DEFAULT_AUDIENCE_RULES);
  const eligibleCount = await countAudience(supabase, campaign, rules);
  const calculatedAt = new Date().toISOString();
  const metadata = {
    ...(campaign.metadata || {}),
    audience: {
      rules,
      eligible_count: eligibleCount,
      calculated_at: calculatedAt,
    },
  };

  const { data } = assertSupabase(
    await supabase.from("marketing_campaigns").update({ metadata }).eq("id", campaign.id).select(CAMPAIGN_COLUMNS).single(),
    "Could not save campaign audience rules."
  );

  return {
    campaign: normalizeCampaign(data),
    audience: {
      rules,
      eligible_count: eligibleCount,
      calculated_at: calculatedAt,
      breakdown: { channel_ready: eligibleCount },
    },
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
    else if (action === "update") result = await updateCampaign(supabase, body);
    else if (action === "archive") result = await archiveCampaign(supabase, body);
    else if (action === "audienceOptions") result = { options: await getAudienceOptions() };
    else if (action === "previewAudience") result = await previewAudience(supabase, body);
    else if (action === "saveAudience") result = await saveAudience(supabase, body);
    else throw new Error("Unknown Marketing Campaign API action.");

    json(response, 200, { ok: true, ...result });
  } catch (error) {
    json(response, 500, { ok: false, message: error?.message || "Marketing Campaign API error." });
  }
}
