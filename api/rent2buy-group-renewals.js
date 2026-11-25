// Rent2Buy Facebook group renewals: daily queue, reporting and controls.
// GET ?run=1 (Vercel cron, CRON_SECRET): build today's queue once.
// GET (CRM key): reporting. POST (CRM key): { action: "settings" | "outcome" | "stop" }.
import { createClient } from "@supabase/supabase-js";
import {
  OUTCOMES, RUN_TABLE, SETTINGS_TABLE, DEFAULT_DAILY_LIMIT, buildRenewalPlan, canonicalGroup, clampLimit, londonDay, nextRunAt, summarizeRenewalRun,
} from "../lib/rent2buyGroupRenewals.js";

const PAGE = 500;
const clean = (v, n = 300) => String(v ?? "").trim().slice(0, n);

async function getGroups(db) {
  const rows = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await db.from("facebook_group_state").select("group_key,group_url,group_name,rent2buy,state").eq("rent2buy", true).order("group_key").range(start, start + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function readSettings(db) {
  const { data, error } = await db.from(SETTINGS_TABLE).select("enabled,max_daily,updated_at").eq("id", 1).maybeSingle();
  if (error) throw error;
  return { enabled: data?.enabled === true, maxDaily: clampLimit(data?.max_daily ?? DEFAULT_DAILY_LIMIT), updatedAt: data?.updated_at || null };
}

// Once per London day: the run_date primary key makes repeated or concurrent
// cron calls harmless (the first plan is kept, nothing is posted).
export async function runDailyRenewalCheck(db, now = new Date()) {
  const settings = await readSettings(db);
  if (!settings.enabled) return { disabled: true };
  const date = londonDay(now);
  const previous = await db.from(RUN_TABLE).select("run_date").eq("run_date", date).maybeSingle();
  if (previous.error) throw previous.error;
  if (previous.data) return { alreadyChecked: true, date };
  const plan = buildRenewalPlan(await getGroups(db), now, settings.maxDaily);
  const saved = await db.from(RUN_TABLE).upsert({ run_date: date, checked_at: now.toISOString(), plan, outcomes: {} }, { onConflict: "run_date", ignoreDuplicates: true });
  if (saved.error) throw saved.error;
  return { date, due: plan.dueCount, queued: plan.groups.length, needsReview: plan.reviewCount };
}

export async function readRenewals(db, now = new Date()) {
  const [{ data: runs, error }, settings] = await Promise.all([
    db.from(RUN_TABLE).select("run_date,checked_at,plan,outcomes,stopped").order("run_date", { ascending: false }).limit(14),
    readSettings(db),
  ]);
  if (error) throw error;
  const entries = runs || [];
  const events = [];
  let groupStates = {};
  if (entries.length) {
    for (let start = 0; ; start += PAGE) {
      const result = await db.from("marketing_daily_activity_events").select("id,activity_date,occurred_at,metadata").eq("activity_type", "rent2buy_groups_post").eq("source", "facebook_groups").gte("activity_date", entries.at(-1).run_date).order("id").range(start, start + PAGE - 1);
      if (result.error) throw result.error;
      events.push(...(result.data || []));
      if (!result.data || result.data.length < PAGE) break;
    }
    groupStates = Object.fromEntries((await getGroups(db)).map((row) => [canonicalGroup(row.group_url || row.state?.url), row.state || {}]));
  }
  const history = entries.map((run) => summarizeRenewalRun(run, events, groupStates));
  const latest = history[0] || null;
  return {
    today: londonDay(now), settings, nextRunAt: settings.enabled ? nextRunAt(now) : null,
    latest, history: history.map(({ groups, ...summary }) => summary),
  };
}

// Record what happened to one queued group today, or stop the day safely.
async function updateToday(db, now, mutate) {
  const date = londonDay(now);
  const { data: run, error } = await db.from(RUN_TABLE).select("run_date,plan,outcomes,stopped").eq("run_date", date).maybeSingle();
  if (error) throw error;
  if (!run) return { ok: false, error: "No renewal run today" };
  const patch = mutate(run);
  if (patch.error) return { ok: false, error: patch.error };
  const saved = await db.from(RUN_TABLE).update(patch).eq("run_date", date);
  if (saved.error) throw saved.error;
  return { ok: true };
}

export async function handlePost(db, body, now = new Date()) {
  const action = clean(body?.action, 20);
  if (action === "settings") {
    const row = { id: 1, updated_at: now.toISOString() };
    if (typeof body.enabled === "boolean") row.enabled = body.enabled;
    if (body.maxDaily !== undefined) row.max_daily = clampLimit(body.maxDaily);
    const { error } = await db.from(SETTINGS_TABLE).upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true, settings: await readSettings(db) };
  }
  if (action === "outcome") {
    const groupKey = canonicalGroup(body.groupUrl);
    const status = OUTCOMES.includes(body.status) ? body.status : "";
    if (!groupKey || !status) return { ok: false, error: "Valid groupUrl and status (skipped, failed, needs_attention) required" };
    return updateToday(db, now, (run) => {
      if (!(run.plan?.groups || []).some((g) => g.groupKey === groupKey)) return { error: "Group is not in today's queue" };
      return { outcomes: { ...(run.outcomes || {}), [groupKey]: { status, reason: clean(body.reason) || null, at: now.toISOString() } } };
    });
  }
  if (action === "stop") {
    // Account restriction or security challenge: no further renewals today.
    return updateToday(db, now, (run) => (run.stopped ? { stopped: run.stopped } : { stopped: { at: now.toISOString(), reason: clean(body.reason) || "Stopped" } }));
  }
  return { ok: false, error: "Unknown action" };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  const bearer = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const isRun = req.method === "GET" && req.query?.run === "1";
  const key = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const cron = process.env.CRON_SECRET;
  if (isRun ? !(cron && bearer === cron) : !(key && (req.headers?.["x-marketing-customer-database-key"] === key || bearer === key))) return res.status(401).json({ error: "Unauthorised" });
  if (isRun && process.env.VERCEL_ENV !== "production") return res.status(200).json({ disabled: true, reason: "Production only" });
  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const result = await handlePost(db, body);
      return res.status(result.ok ? 200 : 400).json(result);
    }
    return res.status(200).json(isRun ? await runDailyRenewalCheck(db) : await readRenewals(db));
  } catch (error) {
    console.error("Rent2Buy renewal request failed", String(error?.message || "").slice(0, 180));
    return res.status(500).json({ error: "Renewal data unavailable" });
  }
}
