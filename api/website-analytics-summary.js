import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import {
  ANALYTICS_CUTOVER_DATE,
  combineSummaries,
  loadFirstPartyPeriod,
  sourceForSegments,
  splitAnalyticsRange,
} from "./_first-party-analytics.js";

const TRAFFIC_MODEL_ID = "cad7fd34-2c8b-4dda-8296-3f9d47fb484d";
const WIX_ANALYTICS_QUERY_URL = "https://www.wixapis.com/analytics/semantic-model/v3/semantic-models/query-data";
const TIME_ZONE = "Europe/London";
const SUMMARY_FIELDS = [
  "traffic.sessions_count",
  "traffic.visitors_count",
  "traffic.views_count",
  "traffic.site_bounce_ratio",
  "traffic.site_time_seconds_avg",
  "traffic.pages_per_session_avg",
];

function clean(value, limit = 10000) {
  return String(value || "").trim().slice(0, limit);
}

function londonDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

function londonMidnightUtcIso(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const zonePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    timeZoneName: "longOffset",
  }).formatToParts(probe).find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = zonePart.match(/GMT(?:(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))?/);
  const sign = match?.groups?.sign === "-" ? -1 : 1;
  const offsetMinutes = match?.groups?.hours
    ? sign * (Number(match.groups.hours) * 60 + Number(match.groups.minutes || 0))
    : 0;
  return new Date(Date.UTC(year, month - 1, day, 0) - offsetMinutes * 60_000).toISOString();
}

function summaryFrom(payload = {}) {
  const fields = payload?.totals?.fields || payload?.results?.[0]?.fields || {};
  return Object.fromEntries(SUMMARY_FIELDS.map((name) => [name, Number(fields?.[name]?.numericValue || 0)]));
}

async function querySummary({ apiKey, siteId, startDate, endDate }) {
  const wixResponse = await fetch(WIX_ANALYTICS_QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "wix-site-id": siteId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      semanticModelId: TRAFFIC_MODEL_ID,
      interval: {
        start: londonMidnightUtcIso(startDate),
        end: londonMidnightUtcIso(endDate),
        timezone: TIME_ZONE,
      },
      fields: SUMMARY_FIELDS,
      formattingEnabled: false,
      totalsIncluded: true,
    }),
  });

  const payload = await wixResponse.json().catch(() => ({}));
  if (!wixResponse.ok) {
    const message = clean(payload?.message || payload?.details?.applicationError?.description || "Wix analytics request failed.", 500);
    const error = new Error(message);
    error.status = wixResponse.status;
    throw error;
  }
  return summaryFrom(payload);
}

async function loadSummaryRange({ apiKey, siteId, startDate, endExclusive }) {
  const segments = splitAnalyticsRange(startDate, endExclusive);
  const needsWix = segments.some((segment) => segment.source === "wix");
  const needsFirstParty = segments.some((segment) => segment.source === "first_party");
  if (needsWix && (!apiKey || !siteId)) throw new Error("Wix analytics credentials are required for the historical portion of this date range.");
  const supabase = needsFirstParty ? getSupabaseServiceAdmin() : null;
  const parts = await Promise.all(segments.map(async (segment) => {
    if (segment.source === "wix") {
      return querySummary({ apiKey, siteId, startDate: segment.startDate, endDate: segment.endExclusive });
    }
    return (await loadFirstPartyPeriod({ supabase, startDate: segment.startDate, endExclusive: segment.endExclusive })).summary;
  }));
  return { summary: combineSummaries(parts), segments, source: sourceForSegments(segments) };
}

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });

  const apiKey = clean(process.env.WIX_API_KEY);
  const siteId = clean(process.env.WIX_SITE_ID, 500);

  const today = londonDateKey();
  const settledThrough = addDays(today, -1);
  const currentStart = addDays(settledThrough, -6);
  const previousStart = addDays(currentStart, -7);

  try {
    const [currentPeriod, previousPeriod] = await Promise.all([
      loadSummaryRange({ apiKey, siteId, startDate: currentStart, endExclusive: today }),
      loadSummaryRange({ apiKey, siteId, startDate: previousStart, endExclusive: currentStart }),
    ]);
    const dashboardSource = sourceForSegments([...currentPeriod.segments, ...previousPeriod.segments]);

    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({
      ok: true,
      settledThrough,
      cutoverDate: ANALYTICS_CUTOVER_DATE,
      source: dashboardSource,
      current: { startDate: currentStart, endDate: settledThrough, summary: currentPeriod.summary, source: currentPeriod.source, segments: currentPeriod.segments },
      previous: { startDate: previousStart, endDate: addDays(currentStart, -1), summary: previousPeriod.summary, source: previousPeriod.source, segments: previousPeriod.segments },
      notes: dashboardSource === "mixed"
        ? ["Visitor totals across the cutover are additive approximations because Wix and first-party visitor identifiers cannot be reconciled."]
        : [],
    });
  } catch (error) {
    return response.status(error.status || 500).json({ ok: false, message: clean(error?.message || "Website analytics request failed.", 500) });
  }
}

export { addDays, loadSummaryRange, londonDateKey, londonMidnightUtcIso, querySummary, summaryFrom };
