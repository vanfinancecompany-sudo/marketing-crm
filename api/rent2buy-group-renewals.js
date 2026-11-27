import {withCronHealth} from "../lib/cronHealthTelemetry.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
// Rent2Buy Facebook group renewals: daily queue, reporting and controls.
// GET ?run=1 (Vercel cron, CRON_SECRET): append newly due groups to today's queue.
// GET (CRM key): reporting and queue. POST (CRM key): settings, browser status, and advert outcomes.
import { createClient } from "@supabase/supabase-js";
import {
  OUTCOMES, RUN_TABLE, SETTINGS_TABLE, DEFAULT_DAILY_LIMIT, GROUP_ACTIVITY_SOURCE, RENT2BUY_GROUP_ACTIVITY_TYPE,
  buildRenewalAdvertHistory, buildRenewalPlan, canonicalGroup, clampLimit, groupActivitySourceId, londonDay, nextRunAt, summarizeRenewalRun,
  renewalPostPermalink, renewalReviewIdentity, renewalReviewTarget, isHistoricalSubmissionHold, isExpiredAttemptHold, recentRenewalAttempt,
  renewalHoldKind,
} from "../lib/rent2buyGroupRenewals.js";
import { describeRenewalAgent, renewalHeartbeatChannel } from "../lib/rent2buyGroupRenewalMonitor.js";
import { markGroupPosted, markGroupPostStatus } from "../services/facebookGroupsAgent.js";
import { loadWorkerAdvert } from "../lib/rent2buyGroupWorkerStock.js";

const WORKER_TOKEN = /^r2b-worker-[a-f0-9]{64}$/;
const WORKER_ACTIONS = new Set(["worker-next", "worker-reserve", "worker-result", "worker-approval", "worker-heartbeat", "worker-stop", "worker-enable-check"]);
const WORKER_MANAGEMENT_ACTIONS = new Set(["worker-enroll", "worker-revoke", "worker-test-status"]);
const JOB_ID = /^[a-zA-Z0-9-]{10,80}$/;

const PAGE = 500;
const clean = (v, n = 300) => String(v ?? "").trim().slice(0, n);
const heartbeatToken = (key, environment) => createHmac("sha256", key)
  .update(`rent2buy-group-renewals:heartbeat:v1:${environment || "local"}`).digest("hex");

export function authoriseRenewalRequest(req, body, environment = process.env) {
  const bearer = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (req.method === "GET" && req.query?.run === "1") {
    return environment.CRON_SECRET && bearer === environment.CRON_SECRET ? "cron" : "";
  }
  const key = environment.MARKETING_CUSTOMER_DATABASE_API_KEY;
  if (!key) return "";
  if (req.headers?.["x-marketing-customer-database-key"] === key || bearer === key) return "crm";
  if (req.method === "POST" && WORKER_ACTIONS.has(body?.action) && WORKER_TOKEN.test(bearer)) return "background";
  if (req.method !== "POST" || body?.action !== "heartbeat" || !/^[a-f0-9]{64}$/.test(bearer)) return "";
  return timingSafeEqual(Buffer.from(bearer), Buffer.from(heartbeatToken(key, environment.VERCEL_ENV))) ? "worker" : "";
}

// Stable code for a pre-submission composer failure. The helper's wording has changed
// between versions, so every known composer wording maps to this one code; records
// saved before the code existed are still recognised by their wording.
const COMPOSER_UNVERIFIED = "composer_unverified";
const COMPOSER_FAILURE_PATTERN = /^(?:Posting permission or group composer could not be verified|Create Post opener found, but composer could not be verified before timeout|Create Post composer or opener not found before timeout|Create Post opener found; composer timeout\b|Create Post composer\/opener timeout\b)/;

function composerFailureCode(status, reason) {
  return status === "needs_attention" && COMPOSER_FAILURE_PATTERN.test(String(reason || "")) ? COMPOSER_UNVERIFIED : "";
}

// A failure before any submission was reserved may be retried the same day, once. A second
// pre-submission failure becomes a technical hold; rules and membership blockers are held at once.
function retryablePreSubmission(outcome) {
  return ["needs_attention", "failed"].includes(outcome?.status) && outcome.mode === "automatic" && Boolean(outcome.jobId) &&
    !outcome.attemptedAt && !outcome.submissionReservedAt && !outcome.duplicateRisk && !outcome.failureStage &&
    (outcome.retries || 0) < 1 && !["rules", "membership"].includes(renewalHoldKind(outcome.status, outcome.reason));
}

// Persist or clear a group's renewal hold in its existing state record (no schema change).
async function updateGroupHold(db, groupUrl, change, at) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await db.from("facebook_group_state").select("state").eq("group_key", groupUrl).eq("rent2buy", true).maybeSingle();
    if (error) throw error;
    if (!data?.state) return null;
    const next = change(data.state);
    if (!next) return data.state;
    const saved = await db.from("facebook_group_state").update({ state: next, updated_at: at })
      .eq("group_key", groupUrl).eq("state", JSON.stringify(data.state)).select("group_key").maybeSingle();
    if (saved.error) throw saved.error;
    if (saved.data) return next;
  }
  throw new Error("The group changed while saving its renewal hold. Retry shortly.");
}

async function readBackgroundSettings(db) {
  const { data, error } = await db.from(SETTINGS_TABLE).select("background_token_hash,background_test_date").eq("id", 1).single();
  if (error) throw error;
  return data;
}

export async function verifyBackgroundCredential(db, bearer) {
  if (!WORKER_TOKEN.test(bearer)) return null;
  const settings = await readBackgroundSettings(db);
  const hash = settings.background_token_hash;
  return /^[a-f0-9]{64}$/.test(hash || "") && timingSafeEqual(Buffer.from(hash, "hex"), createHash("sha256").update(bearer).digest())
    ? settings : null;
}
const recentRuns = (db) => db.from(RUN_TABLE).select("run_date,checked_at,plan,outcomes,stopped")
  .order("run_date", { ascending: false }).limit(14);

function approvalMonitorEvidence(value, now) {
  if (!value || typeof value.scheduled !== "boolean") return null;
  const timestamp = input => Number.isFinite(Date.parse(input)) && Date.parse(input) <= now.getTime() + 60_000 ? new Date(input).toISOString() : null;
  const count = input => Math.max(0, Math.min(1000, Math.floor(Number(input) || 0)));
  return { scheduled: value.scheduled, lastAlarmAt: timestamp(value.lastAlarmAt), lastCheckAt: timestamp(value.lastCheckAt),
    pendingCount: count(value.pendingCount), unresolvedCount: count(value.unresolvedCount),
    outcome: ["accepted", "pending", "declined", "unknown", "timeout", "navigation_failed"].includes(value.outcome) ? value.outcome : null };
}

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
  const rows = await getGroups(db);
  const initial = buildRenewalPlan(rows, now, settings.maxDaily);
  const inserted = await db.from(RUN_TABLE).upsert({ run_date: date, checked_at: now.toISOString(), plan: initial, outcomes: {}, revision: 0 }, { onConflict: "run_date", ignoreDuplicates: true }).select("run_date").maybeSingle();
  if (inserted.error) throw inserted.error;
  if (inserted.data) return { date, due: initial.dueCount, queued: initial.groups.length, added: initial.groups.length, needsReview: initial.reviewCount };

  for (let attempt = 0; attempt < 4; attempt++) {
    let summary;
    const result = await updateToday(db, now, (run) => {
      const previous = run.plan || {};
      if (Date.parse(previous.lastScanAt) >= now.getTime()) return { result: { ok: true } };
      const plan = buildRenewalPlan(rows, now, settings.maxDaily, previous);
      if (run.stopped) plan.groups = previous.groups || [];
      summary = { date, due: plan.dueCount, queued: plan.groups.length,
        added: plan.groups.length - (previous.groups?.length || 0), needsReview: plan.reviewCount };
      return { plan };
    }, date);
    if (result.ok) return summary || { date, alreadyChecked: true };
    if (!result.conflict) throw new Error(result.error);
  }
  throw new Error("The renewal queue changed while scheduling due groups. The next scan can retry safely.");
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
    recentRuns(db),
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
  const history = entries.map((run) => summarizeRenewalRun(run, events, groupStates, { currentQueue: run.run_date === today, now }));
  const latest = history[0] || null;
  if (queueOnly && latest?.date === today) {
    for (const group of latest.groups) {
      const target = recentRenewalAttempt(group.groupKey, groupStates[group.groupKey] || {}, entries.slice(1), now);
      if (!target) continue;
      if (group.status === "queued") {
        group.status = "needs_attention";
        group.reason = "A recent posting attempt is still unconfirmed; allow the configured interval before trying again.";
      }
      if (target.registration && entries[0].plan?.reviews?.[group.groupKey]?.target !== renewalReviewIdentity(target)) group.review = target;
    }
  }
  const summary = { today, settings, nextRunAt: settings.enabled ? nextRunAt(now) : null, latest };
  if (queueOnly) return summary;
  const heartbeat = await readRenewalHeartbeat(db, environment);
  return { ...summary, agent: describeRenewalAgent({ settings, run: entries[0], heartbeat, now }),
    history: history.map(({ groups, ...entry }) => entry), advertHistory: buildRenewalAdvertHistory(entries, events) };
}

// Record what happened to one queued group today, or stop the day safely.
async function updateToday(db, now, mutate, date = londonDay(now)) {
  const { data: run, error } = await db.from(RUN_TABLE).select("run_date,checked_at,plan,outcomes,stopped,revision").eq("run_date", date).maybeSingle();
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

async function reconcilePreviousSubmission(db, body, now) {
  const key = canonicalGroup(body.groupUrl);
  const today = londonDay(now);
  const [history, group] = await Promise.all([recentRuns(db), db.from("facebook_group_state").select("state,group_name")
    .eq("group_key", key).eq("rent2buy", true).maybeSingle()]);
  if (history.error || group.error) throw history.error || group.error;
  const run = history.data?.[0];
  const current = group.data?.state;
  if (!current || run?.run_date !== today || run.stopped || !(run.plan.groups || []).some(g => g.groupKey === key)) {
    return { ok: false, error: "This group is no longer in today's active renewal queue" };
  }
  const priorReview = run.plan.reviews?.[key];
  if (priorReview?.target === body.target) return { ok: true };
  const target = renewalReviewTarget(key, current, history.data, today);
  if (!target || body.target !== renewalReviewIdentity(target)) return { ok: true, stale: true };
  const status = body.result;
  if (!["accepted", "pending", "declined", "unknown"].includes(status)) return { ok: false, error: "Invalid reconciliation result" };
  const observed = Date.parse(body.observedAt);
  const expected = Date.parse(target.postedAt);
  const post = renewalPostPermalink(body.permalink, key);
  const known = renewalPostPermalink(target.permalink, key);
  if (status !== "unknown" && (!post || (known && post !== known) || !Number.isFinite(observed) || observed > now.getTime() + 60_000 ||
      !(known || (target.kind === "group" ? londonDay(new Date(observed)) === londonDay(new Date(expected)) : Math.abs(expected - observed) <= 5 * 60_000)))) {
    return { ok: false, error: "Facebook evidence does not identify the previous advert" };
  }
  if (status !== "unknown") {
    const postedAt = target.kind === "attempt" ? new Date(observed).toISOString() : current.lastPostedAt;
    if (target.kind === "attempt") {
      const eventDate = londonDay(new Date(postedAt));
      const sourceId = groupActivitySourceId("rent2buy", key, target.registration, eventDate);
      const sourceRun = history.data.find(r => r.run_date === target.runDate);
      if (observed < Date.parse(sourceRun.checked_at)) return { ok: false, error: "The observed advert predates the renewal run" };
      const metadata = { group_url: key, group_name: group.data.group_name, destination: "Rent2Buy Facebook Groups",
        registration: target.registration, submitted_at: postedAt, posting_mode: sourceRun.outcomes[key].mode || "automatic",
        renewal_run_date: target.runDate, renewal_job_id: target.jobId, approval_outcome: status,
        approval_checked_at: now.toISOString(), post_permalink: post, reconciled: true };
      const inserted = await db.from("marketing_daily_activity_events").insert({ activity_date: eventDate, activity_type: RENT2BUY_GROUP_ACTIVITY_TYPE,
        source: GROUP_ACTIVITY_SOURCE, source_id: sourceId, quantity: 1, occurred_at: postedAt, metadata });
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      if (inserted.error && (await readGroupActivity(db, key, target.registration, postedAt))?.metadata?.renewal_job_id !== target.jobId) {
        return { ok: false, error: "An existing post receipt requires manual identity review" };
      }
    }
    const original = { ...current, url: current.url || key };
    const [posted] = target.kind === "attempt" ? markGroupPosted([original], key, { postedAt, registration: target.registration, renewalPost: true }) : [original];
    const [updated] = markGroupPostStatus([posted], { url: key, registration: target.registration,
      checkedAt: now.toISOString(), matchedUrl: post, matchMethod: "dated-renewal-reconciliation",
      accepted: status === "accepted", pending: status === "pending", declined: status === "declined" });
    const result = await db.from("facebook_group_state").update({ state: { ...updated, ...(current.status === "Red" ? { status: "Red" } : {}),
      lastPostPermalink: post }, updated_at: now.toISOString() })
      .eq("group_key", key).eq("state", JSON.stringify(current)).select("group_key").maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return { ok: false, error: "The group changed during reconciliation; refresh before continuing" };
    if (target.kind === "group") await saveApproval(db, { approval: status, groupUrl: key, registration: target.registration, postedAt }, now);
  }
  return updateToday(db, now, (latest) => ({ plan: { ...latest.plan, reviews: { ...latest.plan.reviews, [key]: {
    target: body.target, kind: target.kind, runDate: target.runDate || null, result: status, at: now.toISOString(),
    reason: status === "unknown" ? "Facebook did not show this exact advert; duplicate hold retained." : "" } } } }));
}

async function checkRenewalClaim(db, groupKey, automatic, now) {
  const { data: current, error } = await db.from("facebook_group_state")
    .select("group_key,group_url,group_name,rent2buy,state").eq("rent2buy", true)
    .eq("group_key", groupKey).maybeSingle();
  if (error) throw error;
  const stillDue = buildRenewalPlan(current ? [current] : [], now, 1).groups.length > 0;
  const group = current?.state || {};
  let unresolved = null;
  let postedToday = false;
  if (stillDue) {
    const activity = db.from("marketing_daily_activity_events").select("id").eq("activity_date", londonDay(now))
      .eq("activity_type", RENT2BUY_GROUP_ACTIVITY_TYPE).eq("source", GROUP_ACTIVITY_SOURCE)
      .contains("metadata", { group_url: groupKey }).limit(1);
    const priorQueries = [{ status: "preparing" }, { duplicateRisk: true }].map(outcome =>
      db.from(RUN_TABLE).select("run_date,checked_at,outcomes").lt("run_date", londonDay(now))
        .contains("outcomes", { [groupKey]: outcome }).order("run_date", { ascending: false }).limit(92));
    const [receipt, ...prior] = await Promise.all([activity, ...priorQueries]);
    if (receipt.error) throw receipt.error;
    for (const result of prior) if (result.error) throw result.error;
    postedToday = Boolean(receipt.data?.length);
    unresolved = recentRenewalAttempt(groupKey, group, prior.flatMap(result => result.data || []), now);
  }
  const blocked = automatic && (group.status === "Red" || group.linksAllowed === false);
  const prepare = stillDue && !unresolved && !postedToday && !blocked;
  const reason = unresolved ? "A recent posting attempt is still unconfirmed; allow the configured interval before trying again." :
    postedToday ? "The CRM already recorded a submission for this group today." :
    blocked ? "The group's rules do not allow this advert or its link." : "The group is no longer due or eligible";
  return { prepare, reason, unresolved };
}

export async function manageBackgroundWorker(db, body, now) {
  if (body.action === "worker-enroll" || body.action === "worker-revoke") {
    if (body.action === "worker-revoke") {
      const { error } = await db.from(SETTINGS_TABLE).update({ background_token_hash: null }).eq("id", 1);
      if (error) throw error;
      return { ok: true };
    }
    if (!/^[a-f0-9]{64}$/.test(body.hash || "")) return { ok: false, error: "Invalid background worker pairing" };
    const settings = await readBackgroundSettings(db);
    if (settings.background_token_hash === body.hash) return { ok: true };
    const { data, error } = await db.from(SETTINGS_TABLE).update({ background_token_hash: body.hash })
      .eq("id", 1).is("background_token_hash", null).select("id").maybeSingle();
    if (error) throw error;
    return data ? { ok: true } : { ok: false, error: "A background helper is already paired. Revoke it before pairing another." };
  }
  const settings = await readBackgroundSettings(db);
  if (body.action === "worker-test-status") return { ok: true, paired: Boolean(settings.background_token_hash) };
  return { ok: false, error: "Unknown worker management action" };
}

async function readWorkerRun(db, date) {
  const { data, error } = await db.from(RUN_TABLE).select("run_date,checked_at,plan,outcomes,stopped")
    .eq("run_date", date).maybeSingle();
  if (error) throw error;
  return data;
}

async function nextWorkerJob(db, body, now) {
  const date = londonDay(now);
  if (!JOB_ID.test(body.jobId || "")) return { ok: false, error: "Invalid worker request ID" };
  if (!(await readSettings(db)).enabled) return { ok: true, paused: true };
  const run = await readWorkerRun(db, date);
  if (!run || run.stopped) return { ok: true, stopped: run?.stopped?.reason || "" };
  const unfinished = Object.entries(run.outcomes || {}).filter(([, entry]) => entry.mode === "automatic" && entry.status === "preparing");
  const expired = unfinished.filter(([, entry]) => now.getTime() - Date.parse(entry.at) >= 5 * 60_000);
  if (expired.length) {
    const changed = await updateToday(db, now, current => {
      const outcomes = { ...current.outcomes };
      for (const [groupUrl, entry] of expired) {
        const active = outcomes[groupUrl];
        if (active?.jobId !== entry.jobId || active.status !== "preparing") continue;
        const duplicateRisk = Boolean(active.submissionReservedAt || !active.workerJob);
        outcomes[groupUrl] = { ...active, status: "needs_attention", duplicateRisk, at: now.toISOString(),
          ...(duplicateRisk ? { attemptedAt: active.submissionReservedAt || active.at, failureStage: "publication" } : {}),
          reason: duplicateRisk ? "The interrupted worker did not report a submission outcome. Check Facebook before retrying." :
            "The worker stopped before reserving the Facebook submission" };
      }
      return { outcomes };
    });
    return changed.ok ? { ok: true, checkedGroup: true } : changed;
  }
  const existing = Object.values(run.outcomes || {}).find(entry => entry.jobId === body.jobId);
  if (existing) return { ok: true, job: existing.status === "preparing" && !existing.submissionReservedAt ? existing.workerJob : null,
    resetRotation: existing.resetRotation === true };
  if (unfinished.length) return { ok: true, busy: true };
  const { latest, nextRunAt } = await readRenewals(db, now, { queueOnly: true });
  if (latest?.date !== date || latest.stopped) return { ok: true, wakeAt: nextRunAt };
  const ready = latest.groups.filter(item => !item.review &&
    (item.status === "queued" || retryablePreSubmission(run.outcomes?.[item.groupKey])));
  const group = ready.find(item => !item.issues?.length) || ready[0];
  if (!group) {
    const held = latest.groups.find(item => item.review?.kind === "attempt" && ["needs_attention", "failed"].includes(item.status));
    const target = held?.review;
    return { ok: true, wakeAt: nextRunAt, ...(target ? { review: {
      url: held.url, name: held.name, registration: target.registration, postedAt: target.postedAt,
      reviewKind: target.kind, permalink: target.permalink, identity: renewalReviewIdentity(target),
    } } : {}) };
  }
  const eligibility = await checkRenewalClaim(db, group.groupKey, true, now);
  const vehicleIds = Array.isArray(body.usedVehicleIds) ? body.usedVehicleIds.filter(id => typeof id === "string" && id.length < 100).slice(-500) : [];
  const { job, resetRotation } = eligibility.prepare
    ? await loadWorkerAdvert(db, group, { date, jobId: body.jobId, automatic: true }, vehicleIds)
    : { job: null, resetRotation: false };
  if (eligibility.prepare && !job) return { ok: true, wakeAt: nextRunAt, noStock: true };
  const claim = await updateToday(db, now, current => {
    const previous = current.outcomes?.[group.groupKey];
    const retry = retryablePreSubmission(previous);
    if (current.stopped || !current.plan.groups?.some(item => item.groupKey === group.groupKey) ||
        Object.values(current.outcomes || {}).some(entry => entry.mode === "automatic" && entry.status === "preparing") ||
        (previous && !isHistoricalSubmissionHold(previous) && !isExpiredAttemptHold(previous, now) && !retry)) {
      return { error: "The queue changed before the worker could claim this group" };
    }
    const entry = job ? { status: "preparing", registration: job.registration, mode: "automatic", jobId: job.id,
      workerJob: job, resetRotation, at: now.toISOString(), retries: retry ? (previous.retries || 0) + 1 : 0 } :
      { status: "needs_attention", mode: "automatic", reason: eligibility.reason, at: now.toISOString(),
        ...(eligibility.unresolved ? { retryAt: eligibility.unresolved.retryAt } : {}) };
    return { outcomes: { ...current.outcomes, [group.groupKey]: entry } };
  });
  return claim.ok ? { ok: true, job, resetRotation, checkedGroup: true } : claim;
}

function workerJobIdentity(body) {
  const groupUrl = canonicalGroup(body.groupUrl);
  return groupUrl && JOB_ID.test(body.jobId || "") && /^\d{4}-\d{2}-\d{2}$/.test(body.runDate || "") ? groupUrl : "";
}

async function reserveWorkerPost(db, body, now) {
  const groupUrl = workerJobIdentity(body);
  if (!groupUrl || body.runDate !== londonDay(now) || !(await readSettings(db)).enabled) {
    return { ok: false, error: "The automatic claim is invalid, expired or paused" };
  }
  const eligibility = await checkRenewalClaim(db, groupUrl, true, now);
  if (!eligibility.prepare) return { ok: false, error: eligibility.reason };
  const reserved = await updateToday(db, now, run => {
    const entry = run.outcomes?.[groupUrl];
    if (run.stopped || !entry?.workerJob || entry.jobId !== body.jobId || entry.status !== "preparing" || entry.submissionReservedAt ||
        now.getTime() - Date.parse(entry.at) >= 120_000) {
      return { error: "The automatic claim cannot be authorised to post" };
    }
    if (Object.values(run.outcomes || {}).some(item => now.getTime() - Date.parse(item.submissionReservedAt) < 60_000)) {
      return { error: "The automatic posting interval has not elapsed" };
    }
    return { outcomes: { ...run.outcomes, [groupUrl]: { ...entry, submissionReservedAt: now.toISOString() } } };
  });
  return reserved.ok ? { ...reserved, reservedAt: now.toISOString() } : reserved;
}

async function saveWorkerSubmission(db, run, entry, groupUrl, body, now) {
  const postedAt = entry.submissionReservedAt || body.postedAt;
  const timestamp = Date.parse(postedAt);
  if ((entry.workerJob && !entry.submissionReservedAt) || !Number.isFinite(timestamp) ||
      timestamp < Date.parse(run.checked_at) || timestamp > now.getTime() + 60_000 ||
      !["accepted", "pending", "submitted"].includes(body.approvalState)) return { ok: false, error: "The claim has no valid submission evidence" };
  const group = await db.from("facebook_group_state").select("state,group_name").eq("group_key", groupUrl).eq("rent2buy", true).maybeSingle();
  if (group.error) throw group.error;
  const current = group.data?.state;
  if (!current) return { ok: false, error: "The Rent2Buy group is missing" };
  const registration = entry.registration;
  const eventDate = londonDay(new Date(postedAt));
  const permalink = renewalPostPermalink(body.permalink, groupUrl);
  const metadata = { destination: "Rent2Buy Facebook Groups", group_url: groupUrl, group_name: group.data.group_name,
    registration, submitted_at: postedAt, posting_mode: "automatic", renewal_run_date: run.run_date,
    renewal_job_id: entry.jobId, approval_outcome: body.approvalState, ...(permalink ? { post_permalink: permalink } : {}) };
  const inserted = await db.from("marketing_daily_activity_events").insert({ activity_date: eventDate, activity_type: RENT2BUY_GROUP_ACTIVITY_TYPE,
    source: GROUP_ACTIVITY_SOURCE, source_id: groupActivitySourceId("rent2buy", groupUrl, registration, eventDate),
    quantity: 1, occurred_at: postedAt, metadata });
  if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
  if (inserted.error) {
    const prior = (await readGroupActivity(db, groupUrl, registration, postedAt))?.metadata;
    if (prior?.renewal_job_id !== entry.jobId && !(prior?.posting_mode === "manual" && !prior.renewal_job_id)) {
      return { ok: false, error: "An existing receipt needs manual identity review" };
    }
    if (prior?.posting_mode === "manual") {
      return handlePost(db, { action: "submission", groupUrl, registration, postedAt, runDate: run.run_date, jobId: entry.jobId }, now);
    }
  }
  if (!(Date.parse(current.lastPostedAt) >= timestamp)) {
    const [updated] = markGroupPosted([{ ...current, url: groupUrl }], groupUrl, {
      postedAt, registration, renewalPost: true, approvalState: body.approvalState, permalink,
    });
    const saved = await db.from("facebook_group_state").update({ state: updated, updated_at: now.toISOString() })
      .eq("group_key", groupUrl).eq("state", JSON.stringify(current)).select("group_key").maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data) return { ok: false, conflict: true, error: "The group changed while saving its receipt" };
  }
  return handlePost(db, { action: "submission", groupUrl, registration, postedAt, runDate: run.run_date, jobId: entry.jobId }, now);
}

async function recordWorkerResult(db, body, now) {
  const groupUrl = workerJobIdentity(body);
  if (!groupUrl || body.runDate > londonDay(now)) return { ok: false, error: "Invalid worker outcome identity" };
  const run = await readWorkerRun(db, body.runDate);
  const entry = run?.outcomes?.[groupUrl];
  if (entry?.jobId !== body.jobId || entry.mode !== "automatic") return { ok: false, error: "No matching automatic claim" };
  if (entry.status !== "preparing") {
    if (body.status === "submitted" && entry.status !== "submitted" && entry.status !== "skipped") {
      return { ok: false, error: "An interrupted claim has late Facebook evidence that requires review" };
    }
    return { ok: true, status: entry.status };
  }
  if (body.status === "submitted") return saveWorkerSubmission(db, run, entry, groupUrl, body, now);
  const attemptedAt = entry.submissionReservedAt || body.attemptedAt;
  const duplicateRisk = Boolean(entry.submissionReservedAt || body.duplicateRisk);
  const saved = await handlePost(db, { action: body.status === "stop" ? "stop" : "outcome", status: body.status, groupUrl,
    jobId: entry.jobId, runDate: run.run_date, reason: body.reason, attemptedAt, failureStage: body.failureStage,
    duplicateRisk }, now);
  const reason = clean(body.reason, 200);
  const found = saved.ok ? renewalHoldKind(body.status, reason, duplicateRisk) : "";
  // Technical failures get one same-day retry before they are held for review.
  const kind = found === "technical" && !(entry.retries >= 1) ? "" : found;
  if (kind) {
    await updateGroupHold(db, groupUrl, state => ({ ...state,
      renewalHold: { kind, reason, at: now.toISOString(), runDate: run.run_date, jobId: entry.jobId },
      ...(kind === "membership" ? { membershipPending: true } : {}) }), now.toISOString());
  }
  return saved;
}

async function recordWorkerApproval(db, body, now) {
  if (body.target) return reconcilePreviousSubmission(db, { ...body, action: "review" }, now);
  const groupUrl = canonicalGroup(body.groupUrl);
  const receipt = await readGroupActivity(db, groupUrl, clean(body.registration, 24), body.postedAt);
  if (receipt?.metadata?.posting_mode !== "automatic" || receipt.metadata.submitted_at !== body.postedAt) {
    return { ok: false, error: "No matching automatic approval receipt" };
  }
  const result = await saveApproval(db, body, now);
  if (!result.ok) return result;
  const group = await db.from("facebook_group_state").select("state").eq("group_key", groupUrl).eq("rent2buy", true).maybeSingle();
  if (group.error) throw group.error;
  const current = group.data?.state;
  if (!current || current.lastPostedAt !== body.postedAt || Date.parse(current.lastPostCheckAt) >= Date.parse(body.checkedAt)) return { ok: true };
  const [updated] = markGroupPostStatus([{ ...current, url: groupUrl }], { groupUrl, registration: body.registration,
    checkedAt: body.checkedAt, matchedUrl: renewalPostPermalink(body.permalink, groupUrl),
    accepted: body.approval === "accepted", declined: body.approval === "declined", pending: body.approval === "pending" });
  const saved = await db.from("facebook_group_state").update({ state: updated, updated_at: now.toISOString() })
    .eq("group_key", groupUrl).eq("state", JSON.stringify(current)).select("group_key").maybeSingle();
  if (saved.error) throw saved.error;
  return saved.data ? { ok: true } : { ok: false, conflict: true, error: "The group changed while saving approval" };
}

export async function handleBackgroundWorker(db, body, now, environment) {
  switch (body.action) {
    case "worker-next": return nextWorkerJob(db, body, now);
    case "worker-reserve": return reserveWorkerPost(db, body, now);
    case "worker-result": return recordWorkerResult(db, body, now);
    case "worker-approval": return recordWorkerApproval(db, body, now);
    case "worker-heartbeat": return handlePost(db, { ...body, action: "heartbeat" }, now, environment, "worker");
    case "worker-stop": return handlePost(db, { action: "stop", reason: body.reason }, now);
    case "worker-enable-check": {
      const run = await readWorkerRun(db, londonDay(now));
      return run?.stopped ? { ok: false, error: "Today's queue is stopped for an account restriction" } : { ok: true };
    }
    default: return { ok: false, error: "Unknown background worker action" };
  }
}

export async function handlePost(db, body, now = new Date(), environment = process.env, auth = "crm") {
  const action = clean(body?.action, 20);
  if (action === "heartbeat") {
    const state = clean(body.state, 20);
    if (!["ready", "processing", "paused", "restricted"].includes(state)) return { ok: false, error: "Invalid renewal agent status" };
    const stamp = now.toISOString();
    const { error } = await db.from("conversation_channel_status").upsert({
      channel: renewalHeartbeatChannel(environment), last_heartbeat_at: stamp, updated_at: stamp,
      status: { state, reason: clean(body.reason, 200), extension: clean(body.extension, 20), approvalMonitor: approvalMonitorEvidence(body.approvalMonitor, now),
        ...(auth === "worker" ? { source: "extension-worker" } : {}) },
    }, { onConflict: "channel" });
    if (error) throw error;
    return { ok: true };
  }
  if (action === "approval") return saveApproval(db, body, now);
  if (action === "review") return reconcilePreviousSubmission(db, body, now);
  if (action === "submission") {
    const groupKey = canonicalGroup(body.groupUrl);
    const registration = clean(body.registration, 24);
    const event = await readGroupActivity(db, groupKey, registration, body.postedAt);
    const ownReceipt = event?.metadata?.renewal_job_id === body.jobId && event?.metadata?.renewal_run_date === body.runDate;
    const manualReceipt = event?.metadata?.posting_mode === "manual" && !event.metadata.renewal_job_id;
    if (!body.jobId || !(ownReceipt || manualReceipt)) return { ok: false, error: "A matching confirmed activity record is required" };
    return updateToday(db, now, (run) => {
      const existing = run.outcomes?.[groupKey];
      if (existing?.jobId !== body.jobId) return { error: "The preparation ID does not match" };
      if (existing.status === "submitted") return { result: { ok: true } };
      if (manualReceipt) {
        if (Date.parse(event.metadata.submitted_at) < Date.parse(run.checked_at) || !Number.isFinite(Date.parse(event.metadata.submitted_at))) {
          return { error: "The manual activity predates this run" };
        }
        return { outcomes: { ...run.outcomes, [groupKey]: { ...existing, status: "skipped", at: now.toISOString(),
          reason: "The CRM already recorded this advert as a manual submission." } } };
      }
      return { outcomes: { ...run.outcomes, [groupKey]: { ...existing, status: "submitted", at: now.toISOString() } } };
    }, body.runDate);
  }
  if (action === "reinstate") {
    const groupKey = canonicalGroup(body.groupUrl);
    if (!groupKey) return { ok: false, error: "Valid groupUrl required" };
    const state = await updateGroupHold(db, groupKey, current => {
      if (!current.renewalHold) return null;
      const { renewalHold, ...rest } = current;
      return { ...rest, renewalHoldHistory: [...(current.renewalHoldHistory || []), { ...renewalHold, reinstatedAt: now.toISOString() }].slice(-20),
        ...(renewalHold.kind === "membership" ? { membershipPending: false } : {}) };
    }, now.toISOString());
    return state ? { ok: true, state } : { ok: false, error: "Group not found" };
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
    const { prepare, reason, unresolved } = await checkRenewalClaim(db, groupKey, body.automatic === true, now);
    const claimed = await updateToday(db, now, (run) => {
      if (run.stopped) return { error: "Renewals have been stopped for today" };
      if (!(run.plan?.groups || []).some((group) => group.groupKey === groupKey)) return { error: "Group is not in today's queue" };
      const existing = run.outcomes?.[groupKey];
      if (existing && !isHistoricalSubmissionHold(existing) && !isExpiredAttemptHold(existing, now)) {
        if (existing.status !== "preparing" || existing.jobId !== jobId) {
          return { result: { ok: true, prepare: false, reason: "This group was already claimed or handled" } };
        }
        return { result: { ok: true, prepare, reason: prepare ? null : reason } };
      }
      const attribution = { registration: clean(body.registration, 24), mode: body.automatic === true ? "automatic" : "manual" };
      const entry = prepare
        ? { ...attribution, status: "preparing", jobId }
        : { ...attribution, registration: existing?.registration || "", status: "needs_attention", reason,
          ...(unresolved ? { retryAt: unresolved.retryAt } : {}) };
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
      const attemptedAt = Date.parse(body.attemptedAt);
      const { failureCode: _previousCode, ...earlier } = previous || {};
      const failureCode = body.jobId ? composerFailureCode(status, clean(body.reason, 200)) : "";
      return { outcomes: { ...(run.outcomes || {}), [groupKey]: { ...earlier, status, reason: clean(body.reason, 200) || "The browser did not supply an explanation; review this group before retrying.", at: now.toISOString(),
        ...(failureCode ? { failureCode } : {}),
        ...(body.jobId && Number.isFinite(attemptedAt) && attemptedAt <= now.getTime() + 60_000 ? { attemptedAt: new Date(attemptedAt).toISOString() } : {}),
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

export async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  const isRun = req.method === "GET" && req.query?.run === "1";
  try {
    const body = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}) : null;
    const auth = authoriseRenewalRequest(req, body);
    if (!auth) return res.status(401).json({ error: "Unauthorised" });
    if (isRun && process.env.VERCEL_ENV !== "production") return res.status(200).json({ disabled: true, reason: "Production only" });
    if (auth === "crm" && body?.action === "heartbeat-token") {
      return res.status(200).json({ token: heartbeatToken(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY, process.env.VERCEL_ENV) });
    }
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    if (req.method === "POST") {
      if (auth === "background") {
        const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        if (process.env.VERCEL_ENV !== "production" || !await verifyBackgroundCredential(db, bearer)) {
          return res.status(401).json({ error: "Background helper is unauthorised or revoked" });
        }
        const result = await handleBackgroundWorker(db, body, new Date(), process.env);
        return res.status(result.ok ? 200 : result.conflict ? 409 : 400).json(result);
      }
      if (auth === "crm" && WORKER_MANAGEMENT_ACTIONS.has(body?.action)) {
        if (process.env.VERCEL_ENV !== "production") return res.status(403).json({ error: "Background helper management is production only" });
        const result = await manageBackgroundWorker(db, body, new Date());
        return res.status(result.ok ? 200 : result.conflict ? 409 : 400).json(result);
      }
      if (body?.action === "claim" && body.automatic === true) {
        return res.status(409).json({ error: "Automatic posting requires the background Groups Helper" });
      }
      const result = await handlePost(db, body, new Date(), process.env, auth);
      return res.status(result.ok ? 200 : 400).json(result);
    }
    return res.status(200).json(isRun ? await runDailyRenewalCheck(db) : await readRenewals(db, new Date(), { queueOnly: req.query?.view === "queue" }));
  } catch (error) {
    console.error("Rent2Buy renewal request failed", String(error?.message || "").slice(0, 180));
    return res.status(500).json({ error: "Renewal data unavailable" });
  }
}

export default withCronHealth("/api/rent2buy-group-renewals", handler);
