const PIPELINES = new Set(["all", "finance", "rent2buy", "both"]);
const LAST_SEEN_PERIODS = new Set(["all", "last30", "last90", "last180", "last365", "more_than_180"]);
const CREATED_PERIODS = new Set(["all", "today", "last7", "last30", "last90", "this_year"]);

const CHANNEL_SUPPRESSION_TYPES = {
  email: ["email_unsubscribed", "email_bounced", "manual_suppression", "global_do_not_contact"],
  sms: ["sms_opt_out", "manual_suppression", "global_do_not_contact"],
  facebook: ["facebook_excluded", "manual_suppression", "global_do_not_contact"],
};

export const DEFAULT_AUDIENCE_RULES = {
  pipeline: "all",
  source: "all",
  required_tags: [],
  exclude_tags: [],
  last_seen_period: "all",
  created_period: "all",
  exclude_unknown_pipeline: false,
};

function cleanList(values) {
  const list = Array.isArray(values) ? values : [];
  return Array.from(new Set(list.map((value) => String(value || "").trim()).filter(Boolean).filter((value) => value.length <= 80 && !/[{}"\\]/.test(value)))).sort();
}

export function normalizeAudienceRules(values = {}) {
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

export function getAudienceMetadata(campaign) {
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

function jsonContainsSuppressionType(type) {
  return JSON.stringify({ [type]: {} });
}

export function applySuppressionQuery(query, channel) {
  query = query.eq("marketing_status", "active");

  const suppressionTypes = CHANNEL_SUPPRESSION_TYPES[channel];
  if (!suppressionTypes) throw new Error("Unsupported campaign channel.");

  for (const type of suppressionTypes) {
    query = query.not("suppression", "cs", jsonContainsSuppressionType(type));
  }

  return query;
}

export function applyAudienceQuery(query, rules, channel) {
  query = applySuppressionQuery(query, channel);

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

export function assertSupabase(result, fallbackMessage) {
  if (result.error) {
    throw new Error(result.error.message || fallbackMessage);
  }
  return result;
}

export async function countAudience(supabase, campaign, rules) {
  const query = applyAudienceQuery(
    supabase.from("marketing_contacts").select("id", { count: "exact", head: true }),
    rules,
    campaign.channel
  );
  const { count } = assertSupabase(await query, "Could not preview campaign audience.");
  return count || 0;
}

export function buildAudienceMetadata(rules, eligibleCount, calculatedAt = new Date().toISOString()) {
  return {
    rules,
    eligible_count: eligibleCount,
    calculated_at: calculatedAt,
  };
}

export function buildAudienceResponse(rules, eligibleCount, calculatedAt = new Date().toISOString()) {
  return {
    rules,
    eligible_count: eligibleCount,
    calculated_at: calculatedAt,
    breakdown: { channel_ready: eligibleCount },
  };
}
