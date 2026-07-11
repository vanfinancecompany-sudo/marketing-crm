import { createClient } from "@supabase/supabase-js";

const CAMPAIGN_COLUMNS = "id,name,description,channel,objective,status,created_by,created_at,updated_at,archived_at";
const API_KEY_HEADER = "x-marketing-customer-database-key";
const CHANNELS = new Set(["email", "sms", "facebook"]);
const OBJECTIVES = new Set(["new_stock", "promotion", "finance_offer", "rent2buy", "re_engagement", "custom"]);
const STATUSES = new Set(["draft", "ready", "running", "paused", "completed", "archived"]);
const ACTIVE_STATUSES = ["ready", "running", "paused"];

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
  if (!id) throw new Error("Campaign ID is required.");

  const existingResult = assertSupabase(
    await supabase.from("marketing_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).single(),
    "Could not load marketing campaign."
  );
  const existingCampaign = normalizeCampaign(existingResult.data);
  const payload = cleanCampaignValues(body.values || {}, existingCampaign);

  if (existingCampaign.status === "archived") {
    payload.archived_at = existingCampaign.archived_at || new Date().toISOString();
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
    else throw new Error("Unknown Marketing Campaign API action.");

    json(response, 200, { ok: true, ...result });
  } catch (error) {
    json(response, 500, { ok: false, message: error?.message || "Marketing Campaign API error." });
  }
}
