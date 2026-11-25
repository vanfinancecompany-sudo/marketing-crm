import {withCronHealth} from "../lib/cronHealthTelemetry.js";
// Rent2Buy Facebook group renewals: daily queue, reporting and controls.
// GET ?run=1 (Vercel cron, CRON_SECRET): build today's queue once.
// GET (CRM key): reporting and queue. POST (CRM key): settings, browser status, and advert outcomes.
import { createClient } from "@supabase/supabase-js";
import {
  OUTCOMES, RUN_TABLE, SETTINGS_TABLE, DEFAULT_DAILY_LIMIT, GROUP_ACTIVITY_SOURCE, RENT2BUY_GROUP_ACTIVITY_TYPE,
  buildRenewalAdvertHistory, buildRenewalPlan, canonicalGroup, clampLimit, groupActivitySourceId, londonDay, nextRunAt, summarizeRenewalRun,
} from "../lib/rent2buyGroupRenewals.js";
import { describeRenewalAgent, renewalHeartbeatChannel } from "../lib/rent2buyGroupRenewalMonitor.js";

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
  const saved = await db.from(RUN_TABLE).upsert({ run_date: date, checked_at: now.toISOString(), plan, outcomes: {}, revision: 0 }, { onConflict: "run_date", ignoreDuplicates: true });
  if (saved.error) throw saved.error;
  return { date, due: plan.dueCount, queued: plan.groups.length, needsReview: plan.reviewCount };
}

async function readRenewalHeartbeat(db, environment) {
  const { data, error } = await db.from("conversation_channel_status").select("last_heartbeat_at,status")
    .eq("channel", renewalHeartbeatChannel(environment)).maybeSingle();
  if (error) throw error;
  return data;
}

export async function readRenewalMonitoring(db, now = new Date(), environment = process.env) {
  const settings = await readSettings(db);
  const [{ data, error }, heartbeat] = await Promise.all([
    db.from(RUN_TABLE).select("run_date,checked_at,plan,outcomes,stopped").order("run_date", { ascending: false }).limit(1).maybeSingle(),
    readRenewalHeartbeat(db, environment),
  ]);
  if (error) throw error;
  return describeRenewalAgent({ settings, run: data, heartbeat, now });
}

async function readGroupActivity(db, groupUrl, registration, postedAt) {
  if (!groupUrl || !registration || !Number.isFinite(Date.parse(postedAt))) return null;
  const id = groupActivitySourceId("rent2buy", groupUrl, registration, londonDay(new Date(postedAt)));
  const { data, error } = await db.from("marketing_daily_activity_events").select("id,metadata")
    .eq("activity_type", RENT2BUY_GROUP_ACTIVITY_TYPE).eq("source", GROUP_ACTIVITY_SOURCE).eq("source_id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveApproval(db, body, now) {
  if (!["accepted", "pending", "declined"].includes(body.approval)) return { ok: false, error: "Invalid approval result" };
  const event = await readGroupActivity(db, canonicalGroup(body.groupUrl), clean(body.registration, 24), body.postedAt);
  if (!event) return { ok: true, recorded: false };
  const metadata = event.metadata || {};
  const observed = body.checkedAt ? Date.parse(body.checkedAt) : now.getTime();
  if (!Number.isFinite(observed) || observed > now.getTime() + 60_000 || observed < Date.parse(body.postedAt)) {
    return { ok: false, error: "Invalid approval observation time" };
  }
  if (observed <= Date.parse(metadata.approval_checked_at) ||
      (metadata.approval_outcome === "accepted" && body.approval === "pending")) return { ok: true };
  const updated = { ...metadata, approval_outcome: body.approval, approval_checked_at: new Date(observed).toISOString(),
    approval_reason: body.approval === "declined" ? clean(body.reason || "Facebook group declined the advert", 200) : "" };
  const { data, error } = await db.from("marketing_daily_activity_events").update({ metadata: updated })
    .eq("id", event.id).eq("metadata", JSON.stringify(metadata)).select("id").maybeSingle();
  if (error) throw error;
  return data ? { ok: true } : { ok: false, error: "Approval changed while saving" };
}

export async function readRenewals(db, now = new Date(), { queueOnly = false, environment = process.env } = {}) {
  const [{ data: runs, error }, settings] = await Promise.all([
    db.from(RUN_TABLE).select("run_date,checked_at,plan,outcomes,stopped").order("run_date", { ascending: false }).limit(queueOnly ? 1 : 14),
    readSettings(db),
  ]);
  if (error) throw error;
  const entries = runs || [];
  const events = [];
  let groupStates = {};
  const today = londonDay(now);
  const cutoff = queueOnly ? entries[0]?.run_date : londonDay(new Date(now.getTime() - 13 * 86_400_000));
  if (cutoff) {
    for (let start = 0; ; start += PAGE) {
      const result = await db.from("marketing_daily_activity_events").select("id,activity_date,occurred_at,metadata").eq("activity_type", RENT2BUY_GROUP_ACTIVITY_TYPE).eq("source", GROUP_ACTIVITY_SOURCE).gte("activity_date", cutoff).order("id").range(start, start + PAGE - 1);
      if (result.error) throw result.error;
      events.push(...(result.data || []));
      if (!result.data || result.data.length < PAGE) break;
    }
    if (entries.length) groupStates = Object.fromEntries((await getGroups(db)).map((row) => [canonicalGroup(row.group_url || row.state?.url), row.state || {}]));
  }
  const history = entries.map((run) => summarizeRenewalRun(run, events, groupStates));
  const latest = history[0] || null;
  const summary = { today, settings, nextRunAt: settings.enabled ? nextRunAt(now) : null, latest };
  if (queueOnly) return summary;
  const heartbeat = await readRenewalHeartbeat(db, environment);
  return { ...summary, agent: describeRenewalAgent({ settings, run: entries[0], heartbeat, now }),
    history: history.map(({ groups, ...entry }) => entry), advertHistory: buildRenewalAdvertHistory(entries, events) };
}

// Record what happened to one queued group today, or stop the day safely.
async function updateToday(db, now, mutate, date = londonDay(now)) {
  const { data: run, error } = await db.from(RUN_TABLE).select("run_date,plan,outcomes,stopped,revision").eq("run_date", date).maybeSingle();
  if (error) throw error;
  if (!run) return { ok: false, error: "No renewal run today" };
  const patch = mutate(run);
  if (patch.error) return { ok: false, error: patch.error };
  if (patch.result) return patch.result;
  // Compare a compact revision so a full queue never goes into the PostgREST URL.
  const saved = await db.from(RUN_TABLE).update({ ...patch, revision: run.revision + 1 })
    .eq("run_date", date).eq("revision", run.revision).select("run_date").maybeSingle();
  if (saved.error) throw saved.error;
  if (!saved.data) return { ok: false, conflict: true, error: "The queue changed. Refresh it before continuing." };
  return { ok: true };
}

export async function handlePost(db, body, now = new Date(), environment = process.env) {
  const action = clean(body?.action, 20);
  if (action === "heartbeat") {
    const state = clean(body.state, 20);
    if (!["ready", "processing", "paused", "restricted"].includes(state)) return { ok: false, error: "Invalid renewal agent status" };
    const stamp = now.toISOString();
    const { error } = await db.from("conversation_channel_status").upsert({
      channel: renewalHeartbeatChannel(environment), last_heartbeat_at: stamp, updated_at: stamp,
      status: { state, reason: clean(body.reason, 200), extension: clean(body.extension, 20) },
    }, { onConflict: "channel" });
    if (error) throw error;
    return { ok: true };
  }
  if (action === "approval") return saveApproval(db, body, now);
  if (action === "submission") {
    const groupKey = canonicalGroup(body.groupUrl);
    const registration = clean(body.registration, 24);
    const event = await readGroupActivity(db, groupKey, registration, body.postedAt);
    if (!event || !body.jobId || event.metadata?.renewal_job_id !== body.jobId ||
        event.metadata?.renewal_run_date !== body.runDate) return { ok: false, error: "A matching confirmed activity record is required" };
    return updateToday(db, now, (run) => {
      const existing = run.outcomes?.[groupKey];
      if (existing?.jobId !== body.jobId) return { error: "The preparation ID does not match" };
      if (existing.status === "submitted") return { result: { ok: true } };
      return { outcomes: { ...run.outcomes, [groupKey]: { ...existing, status: "submitted", at: now.toISOString() } } };
    }, body.runDate);
  }
  if (action === "settings") {
    const row = { id: 1, updated_at: now.toISOString() };
    if (typeof body.enabled === "boolean") row.enabled = body.enabled;
    if (body.maxDaily !== undefined) row.max_daily = clampLimit(body.maxDaily);
    const { error } = await db.from(SETTINGS_TABLE).upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true, settings: await readSettings(db) };
  }
  if (action === "claim") {
    const groupKey = canonicalGroup(body.groupUrl);
    const jobId = clean(body.jobId, 80);
    if (!groupKey || !/^[a-zA-Z0-9-]{10,80}$/.test(jobId)) return { ok: false, error: "A queued group and preparation ID are required" };
    if (!(await readSettings(db)).enabled) return { ok: false, error: "The daily renewal queue is disabled" };
    const { data: current, error } = await db.from("facebook_group_state")
      .select("group_key,group_url,group_name,rent2buy,state").eq("rent2buy", true)
      .eq("group_key", groupKey).maybeSingle();
    if (error) throw error;
    const stillDue = buildRenewalPlan(current ? [current] : [], now, 1).groups.length > 0;
    let unresolved = ["pending", "awaiting", "not_found"].includes(current?.state?.postStatus);
    if (stillDue && !unresolved) {
      // Keep the duplicate check across daily runs until group state records a newer post.
      const prior = await Promise.all([{ status: "preparing" }, { duplicateRisk: true }].map((outcome) =>
        db.from(RUN_TABLE).select("run_date").lt("run_date", londonDay(now))
          .gt("checked_at", new Date(current.state.lastPostedAt).toISOString())
          .contains("outcomes", { [groupKey]: outcome }).limit(1)));
      for (const result of prior) if (result.error) throw result.error;
      unresolved = prior.some((result) => result.data?.length);
    }
    const group = current?.state || {};
    const approved = group.postStatus === "accepted" || Number(group.acceptedPostCount) > 0 || Boolean(group.lastAcceptedAt);
    const rulesBlockAdvert = group.status === "Red" || group.linksAllowed === false;
    const autoBlocked = body.automatic === true && (!approved || rulesBlockAdvert);
    const prepare = stillDue && !unresolved && !autoBlocked;
    const reason = unresolved ? "Review the previous submission before renewing this group" :
      autoBlocked ? "A previously accepted advert and compatible group rules are required for an automatic renewal" :
        "The group is no longer due or eligible";
    const claimed = await updateToday(db, now, (run) => {
      if (run.stopped) return { error: "Renewals have been stopped for today" };
      if (!(run.plan?.groups || []).some((group) => group.groupKey === groupKey)) return { error: "Group is not in today's queue" };
      const existing = run.outcomes?.[groupKey];
      if (existing) {
        if (existing.status !== "preparing" || existing.jobId !== jobId) {
          return { result: { ok: true, prepare: false, reason: "This group was already claimed or handled" } };
        }
        if (prepare) return { result: { ok: true, prepare: true, reason: null } };
      }
      const attribution = { registration: clean(body.registration, 24), mode: body.automatic === true ? "automatic" : "manual" };
      const entry = prepare
        ? { ...attribution, status: "preparing", jobId }
        : { ...attribution, registration: existing?.registration || "", status: "needs_attention", reason };
      return { outcomes: { ...(run.outcomes || {}), [groupKey]: { ...entry, at: now.toISOString() } } };
    });
    return claimed.ok && claimed.prepare === undefined ? { ...claimed, prepare, reason: prepare ? null : reason } : claimed;
  }
  if (action === "outcome") {
    const groupKey = canonicalGroup(body.groupUrl);
    const status = OUTCOMES.includes(body.status) ? body.status : "";
    if (!groupKey || !status) return { ok: false, error: "Valid groupUrl and status (skipped, failed, needs_attention) required" };
    const date = body.jobId && /^\d{4}-\d{2}-\d{2}$/.test(body.runDate || "") && body.runDate <= londonDay(now) ? body.runDate : londonDay(now);
    return updateToday(db, now, (run) => {
      if (!(run.plan?.groups || []).some((g) => g.groupKey === groupKey)) return { error: "Group is not in today's queue" };
      const previous = run.outcomes?.[groupKey];
      if (body.jobId && previous?.jobId !== body.jobId) return { error: "The preparation ID does not match" };
      if (["submitted", "stopped"].includes(previous?.status)) return { error: "The renewal is already recorded" };
      if (previous?.status === "preparing" && previous.jobId !== body.jobId) return { error: "Review the active browser draft before changing this group" };
      if (body.jobId && previous.status === status) return { outcomes: run.outcomes };
      return { outcomes: { ...(run.outcomes || {}), [groupKey]: { ...previous, status, reason: clean(body.reason, 200) || null, at: now.toISOString(),
        ...(body.jobId && body.failureStage === "publication" ? { failureStage: "publication" } : {}),
        ...(body.duplicateRisk === true ? { duplicateRisk: true } : {}) } } };
    }, date);
  }
  if (action === "stop") {
    // Account restriction or security challenge: no further renewals today.
    return updateToday(db, now, (run) => {
      const stopped = run.stopped || { at: now.toISOString(), reason: clean(body.reason) || "Stopped" };
      const key = canonicalGroup(body.groupUrl);
      const previous = run.outcomes?.[key];
      if (!body.jobId || previous?.jobId !== body.jobId || body.runDate !== run.run_date || previous.status !== "preparing") return { stopped };
      return { stopped, outcomes: { ...run.outcomes, [key]: { ...previous, status: "stopped", ...stopped,
        ...(body.duplicateRisk ? { duplicateRisk: true } : {}) } } };
    });
  }
  return { ok: false, error: "Unknown action" };
}

async function handler(req, res) {
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
    return res.status(200).json(isRun ? await runDailyRenewalCheck(db) : await readRenewals(db, new Date(), { queueOnly: req.query?.view === "queue" }));
  } catch (error) {
    console.error("Rent2Buy renewal request failed", String(error?.message || "").slice(0, 180));
    return res.status(500).json({ error: "Renewal data unavailable" });
  }
}

export default withCronHealth("/api/rent2buy-group-renewals", handler);
