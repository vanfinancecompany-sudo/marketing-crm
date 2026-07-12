import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CHANNELS = new Set(["email", "sms", "facebook"]);
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

async function countAudience(supabase, channel, rules) {
  const query = applyAudienceQuery(
    supabase.from("marketing_contacts").select("id", { count: "exact", head: true }),
    rules,
    channel
  );
  const { count } = assertSupabase(await query, "Could not preview campaign audience.");
  return count || 0;
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
    const body = parseBody(request);
    const channel = String(body.channel || "email").trim().toLowerCase();
    if (!CHANNELS.has(channel)) throw new Error("Unsupported campaign channel.");

    const supabase = getSupabase();
    const rules = normalizeAudienceRules({ ...DEFAULT_AUDIENCE_RULES, ...(body.rules || {}) });
    const eligibleCount = await countAudience(supabase, channel, rules);
    const calculatedAt = new Date().toISOString();

    json(response, 200, {
      ok: true,
      audience: {
        eligible_count: eligibleCount,
        calculated_at: calculatedAt,
        breakdown: { channel_ready: eligibleCount },
        rules,
      },
    });
  } catch (error) {
    json(response, 500, { ok: false, message: error?.message || "Marketing Campaign audience preview error." });
  }
}
