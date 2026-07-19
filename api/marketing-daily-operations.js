import { createClient } from "@supabase/supabase-js";
import {
  DAILY_ACTIVITY_TYPES,
  DEFAULT_DAILY_TARGETS,
  SOCIAL_ACTIVITY_TYPES,
  aggregatePeriod,
  londonDateKey,
  londonDateRange,
  londonWeekday,
  normalizeTargets,
  resolveTargetsForDate,
  summarizeDailyActivity,
} from "../lib/marketingDailyOperations.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers[API_KEY_HEADER] || "";
  const auth = request.headers.authorization || "";
  return Boolean(expected && (header === expected || (auth.startsWith("Bearer ") && auth.slice(7) === expected)));
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing server Supabase environment variables.");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function assertDateKey(value, fallback = londonDateKey()) {
  const dateKey = String(value || fallback);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new ApiError(400, "Invalid UK activity date.");
  return dateKey;
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount, 12, 0, 0));
  return value.toISOString().slice(0, 10);
}

function enumerateDateKeys(start, end, maxDays = 366) {
  const values = [];
  let current = start;
  while (current <= end && values.length < maxDays) {
    values.push(current);
    current = addDays(current, 1);
  }
  if (!values.length || current <= end) throw new ApiError(400, `Date range must be ${maxDays} days or fewer.`);
  return values;
}

async function loadConfiguration(supabase, startDate, endDate) {
  const [schedules, overrides] = await Promise.all([
    supabase.from("marketing_daily_target_schedules").select("*").lte("effective_from", endDate).order("effective_from", { ascending: false }),
    supabase.from("marketing_daily_target_overrides").select("*").gte("activity_date", startDate).lte("activity_date", endDate),
  ]);
  if (schedules.error) throw schedules.error;
  if (overrides.error) throw overrides.error;
  return { schedules: schedules.data || [], overrides: overrides.data || [] };
}

async function fetchPagedRows(makeQuery, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await makeQuery().range(offset, offset + pageSize - 1);
    if (page.error) throw page.error;
    rows.push(...(page.data || []));
    if ((page.data || []).length < pageSize) return rows;
  }
}

async function loadActivity(supabase, startDate, endDate) {
  const startRange = londonDateRange(startDate);
  const endRange = londonDateRange(endDate);
  const [events, recipients, reels] = await Promise.all([
    fetchPagedRows(() => supabase.from("marketing_daily_activity_events").select("*").gte("activity_date", startDate).lte("activity_date", endDate).order("occurred_at", { ascending: false })),
    fetchPagedRows(() => supabase.from("marketing_email_send_recipients")
      .select("id,send_id,email,send_type,status,provider_message_id,first_sent_at,created_at")
      .eq("send_type", "production")
      .gte("first_sent_at", startRange.start)
      .lt("first_sent_at", endRange.end)
      .order("first_sent_at", { ascending: true })),
    fetchPagedRows(() => supabase.from("marketing_creatives")
      .select("id,pipeline,registration,created_at")
      .gte("created_at", startRange.start)
      .lt("created_at", endRange.end)
      .order("created_at", { ascending: true })),
  ]);
  return { events, recipients, reels };
}

function recipientActivityDate(row) {
  return londonDateKey(new Date(row.first_sent_at));
}

function reelActivityDate(row) {
  return londonDateKey(new Date(row.created_at));
}

async function buildDays(supabase, startDate, endDate) {
  const dateKeys = enumerateDateKeys(startDate, endDate);
  const [{ schedules, overrides }, { events, recipients, reels }] = await Promise.all([
    loadConfiguration(supabase, startDate, endDate),
    loadActivity(supabase, startDate, endDate),
  ]);
  return dateKeys.map((dateKey) => {
    const noon = new Date(`${dateKey}T12:00:00Z`);
    const targets = resolveTargetsForDate({ dateKey, weekday: londonWeekday(noon), schedules, overrides });
    const summary = summarizeDailyActivity({
      targets,
      events: events.filter((event) => event.activity_date === dateKey),
      emailRecipients: recipients.filter((row) => recipientActivityDate(row) === dateKey),
      generatedReels: reels.filter((row) => reelActivityDate(row) === dateKey),
    });
    return { date: dateKey, target_source: targets.source, ...summary };
  });
}

function currentScheduleRows(schedules, dateKey) {
  return Array.from({ length: 7 }, (_, weekday) => {
    const row = schedules.filter((item) => Number(item.weekday) === weekday && item.effective_from <= dateKey)
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
    return { weekday, ...normalizeTargets(row || DEFAULT_DAILY_TARGETS), effective_from: row?.effective_from || null };
  });
}

async function overview(supabase, dateKey) {
  const [day] = await buildDays(supabase, dateKey, dateKey);
  const configuration = await loadConfiguration(supabase, dateKey, dateKey);
  return { day, schedule: currentScheduleRows(configuration.schedules, dateKey), override: configuration.overrides.find((row) => row.activity_date === dateKey) || null };
}

async function saveSchedule(supabase, body) {
  const effectiveFrom = assertDateKey(body.effective_from);
  if (!Array.isArray(body.schedule) || body.schedule.length !== 7) throw new ApiError(400, "Provide targets for all seven weekdays.");
  const rows = body.schedule.map((targets, weekday) => ({ effective_from: effectiveFrom, weekday, ...normalizeTargets(targets) }));
  const result = await supabase.from("marketing_daily_target_schedules").upsert(rows, { onConflict: "effective_from,weekday" });
  if (result.error) throw result.error;
  return overview(supabase, effectiveFrom);
}

async function saveOverride(supabase, body) {
  const activityDate = assertDateKey(body.activity_date);
  const result = await supabase.from("marketing_daily_target_overrides").upsert({ activity_date: activityDate, ...normalizeTargets(body.targets), note: String(body.note || "").slice(0, 240) }, { onConflict: "activity_date" });
  if (result.error) throw result.error;
  return overview(supabase, activityDate);
}

async function recordActivity(supabase, body) {
  const activityType = String(body.activity_type || "");
  if (!SOCIAL_ACTIVITY_TYPES.includes(activityType)) throw new ApiError(400, "Unsupported daily activity type.");
  const activityDate = assertDateKey(body.activity_date);
  const sourceId = String(body.source_id || "").trim() || null;
  const payload = {
    activity_date: activityDate,
    activity_type: activityType,
    quantity: Math.max(1, Math.min(100, Number(body.quantity || 1))),
    source: String(body.source || "manual").slice(0, 80),
    source_id: sourceId,
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
  };
  let result;
  if (sourceId) {
    const existing = await supabase.from("marketing_daily_activity_events").select("id")
      .eq("activity_type", payload.activity_type).eq("source", payload.source).eq("source_id", sourceId).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    result = existing.data ? { error: null } : await supabase.from("marketing_daily_activity_events").insert(payload);
  } else {
    result = await supabase.from("marketing_daily_activity_events").insert(payload);
  }
  if (result.error) throw result.error;
  return overview(supabase, activityDate);
}

async function undoManualActivity(supabase, body) {
  const activityType = String(body.activity_type || "");
  if (!SOCIAL_ACTIVITY_TYPES.includes(activityType)) throw new ApiError(400, "Unsupported daily activity type.");
  const activityDate = assertDateKey(body.activity_date);
  const latest = await supabase.from("marketing_daily_activity_events").select("id")
    .eq("activity_date", activityDate).eq("activity_type", activityType).eq("source", "command_centre")
    .order("occurred_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw latest.error;
  if (latest.data?.id) {
    const deleted = await supabase.from("marketing_daily_activity_events").delete().eq("id", latest.data.id);
    if (deleted.error) throw deleted.error;
  }
  return overview(supabase, activityDate);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Marketing access key not recognised." });
  try {
    const body = parseBody(request);
    const action = String(body.action || "overview");
    const supabase = getSupabase();
    if (action === "validateAccess") return response.status(200).json({ ok: true });
    if (action === "overview") return response.status(200).json({ ok: true, ...(await overview(supabase, assertDateKey(body.activity_date))) });
    if (action === "totals") {
      const startDate = assertDateKey(body.start_date);
      const endDate = assertDateKey(body.end_date, startDate);
      if (startDate > endDate) throw new ApiError(400, "Start date must be before end date.");
      const days = await buildDays(supabase, startDate, endDate);
      return response.status(200).json({ ok: true, start_date: startDate, end_date: endDate, days, totals: aggregatePeriod(days) });
    }
    if (action === "saveSchedule") return response.status(200).json({ ok: true, ...(await saveSchedule(supabase, body)) });
    if (action === "resetDefaults") return response.status(200).json({ ok: true, ...(await saveSchedule(supabase, { effective_from: body.effective_from, schedule: Array.from({ length: 7 }, () => DEFAULT_DAILY_TARGETS) })) });
    if (action === "saveOverride") return response.status(200).json({ ok: true, ...(await saveOverride(supabase, body)) });
    if (action === "recordActivity") return response.status(200).json({ ok: true, ...(await recordActivity(supabase, body)) });
    if (action === "undoManualActivity") return response.status(200).json({ ok: true, ...(await undoManualActivity(supabase, body)) });
    throw new ApiError(400, "Unknown daily operations action.");
  } catch (error) {
    response.status(error.status || 500).json({ ok: false, message: error.message || "Daily operations request failed." });
  }
}
