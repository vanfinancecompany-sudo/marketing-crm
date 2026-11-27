// Rent2Buy only: deterministic daily renewal queue for Proven/Hot Facebook
// groups. No browser, AI or publishing side effects. "Due" uses the same rules
// as the Facebook Groups page (groupPipeline + groupDueState), so the daily
// queue matches the CRM. Old membership/permission/post records never exclude a
// group; they become checks shown against it.
import { groupDueState, groupPipeline } from "../services/facebookGroupsAgent.js";

export const DEFAULT_DAILY_LIMIT = 30;
export const MAX_DAILY_LIMIT = 30;
export const RUN_TABLE = "rent2buy_group_renewal_runs";
export const SETTINGS_TABLE = "rent2buy_group_renewal_settings";
export const OUTCOMES = ["skipped", "failed", "needs_attention"];
export const RENT2BUY_GROUP_ACTIVITY_TYPE = "rent2buy_groups_post";
export const GROUP_ACTIVITY_SOURCE = "facebook_groups";
export const UNRESOLVED_POST = new Set(["pending", "awaiting", "not_found"]);
export const PREVIOUS_SUBMISSION_HOLD = "Review the previous submission before renewing this group";
export const hasGroupAcceptance = (group = {}) => group.postStatus === "accepted" || Number(group.acceptedPostCount) > 0 || Boolean(group.lastAcceptedAt);

// An unconfirmed click can itself be a submission. Give it the same interval
// as a confirmed advert before starting a new cycle.
export function recentRenewalAttempt(groupKey, group, runs, now) {
  const lastPosted = Date.parse(group.lastPostedAt) || 0;
  for (const run of runs) {
    const outcome = run.outcomes?.[groupKey];
    if (!outcome?.jobId || (!outcome.duplicateRisk && outcome.status !== "preparing")) continue;
    const postedAt = outcome.attemptedAt || outcome.at || run.checked_at;
    const attempt = Date.parse(postedAt);
    if (!Number.isFinite(attempt) || attempt <= lastPosted || groupDueState({ ...group, lastPostedAt: postedAt, pipeline: "proven" }, now).due) continue;
    return { kind: "attempt", runDate: run.run_date, jobId: outcome.jobId, registration: outcome.registration,
      postedAt, permalink: outcome.permalink || "", retryAt: new Date(attempt + Math.ceil(Math.max(1, Number(group.repeatDays || 7))) * 86_400_000).toISOString() };
  }
  return null;
}
const london = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

export function londonDay(now = new Date()) {
  const p = Object.fromEntries(london.formatToParts(now).map(({ type, value }) => [type, value]));
  return p.year + "-" + p.month + "-" + p.day;
}

export function canonicalGroup(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || !/^(?:www\.|m\.)?facebook\.com$/.test(u.hostname)) return "";
    const m = u.pathname.match(/^\/groups\/([^/]+)\/?/);
    return m ? ("https://www.facebook.com/groups/" + m[1] + "/").toLowerCase() : "";
  } catch { return ""; }
}

export function renewalPostPermalink(value, group) {
  try {
    const url = new URL(value);
    const post = url.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)\/?$/i);
    return post && canonicalGroup(value) === group ? `${group}posts/${post[2]}/` : "";
  } catch { return ""; }
}

export function renewalReviewTarget(groupKey, group, runs, today) {
  const lastPosted = Date.parse(group.lastPostedAt);
  for (const run of runs) {
    const outcome = run.outcomes?.[groupKey];
    const attemptAt = Date.parse(outcome?.attemptedAt || outcome?.at);
    if (!outcome?.jobId || !outcome.registration || !Number.isFinite(attemptAt) || attemptAt <= lastPosted) continue;
    if (!outcome.duplicateRisk && !(outcome.status === "preparing" && run.run_date < today)) continue;
    return { kind: "attempt", runDate: run.run_date, jobId: outcome.jobId, registration: outcome.registration,
      postedAt: outcome.attemptedAt || outcome.at, permalink: outcome.permalink || "" };
  }
  if (UNRESOLVED_POST.has(group.postStatus) && Number.isFinite(lastPosted) && group.pendingRegistration) {
    return { kind: "group", registration: group.pendingRegistration, postedAt: group.lastPostedAt, permalink: group.lastPostPermalink || "" };
  }
  return null;
}

export function renewalReviewIdentity(target) {
  return [target.kind, target.runDate, target.jobId, target.registration, target.postedAt].join("|");
}

export function groupActivitySourceId(productKey, groupUrl, registration, activityDate) {
  return ["facebook-group", productKey, activityDate, canonicalGroup(groupUrl),
    String(registration || "").toUpperCase().replace(/[^A-Z0-9]/g, "")].join("::");
}

export const clampLimit = (value) => Math.max(1, Math.min(MAX_DAILY_LIMIT, Math.floor(Number(value) || DEFAULT_DAILY_LIMIT)));

export const RENEWAL_SCAN_INTERVAL_MS = 60 * 60_000;

export function nextRunAt(now = new Date()) {
  return new Date((Math.floor(now.getTime() / RENEWAL_SCAN_INTERVAL_MS) + 1) * RENEWAL_SCAN_INTERVAL_MS).toISOString();
}

// Advisory checks: current eligibility is confirmed live when the group is opened.
export function renewalChecks(g = {}) {
  const checks = [];
  if (g.unavailable) checks.push("Group marked unavailable: confirm, otherwise skip");
  if (g.postStatus === "declined") checks.push("Previous post declined: check current posting permission");
  if (g.joined === false || g.membershipPending) checks.push("Membership: confirm still a member (record may be stale)");
  if (g.canPost === false) checks.push("Posting permission unclear: check current eligibility");
  if (g.status === "Red") checks.push("Group rules marked Red: check before posting");
  return checks;
}

// Group-level blockers found while posting. "rules" and "technical" holds stay until a person
// reinstates the group; a "membership" hold ends once membership is confirmed. Adverts awaiting
// admin approval are submissions, never holds, and duplicate-risk attempts keep their own hold.
const RULES_BLOCK = /group rule that prohibits|rules do not allow/i;
const MEMBERSHIP_BLOCK = /^Membership is pending/i;
const NOT_GROUP_SPECIFIC = /posting tab (?:became|stayed) hidden|Automatic submission was stopped|claim is invalid|paused/i;

export function renewalHoldKind(status, reason, duplicateRisk = false) {
  if (duplicateRisk || !["needs_attention", "failed"].includes(status)) return "";
  const text = String(reason || "");
  if (RULES_BLOCK.test(text)) return "rules";
  if (MEMBERSHIP_BLOCK.test(text)) return "membership";
  if (NOT_GROUP_SPECIFIC.test(text)) return "";
  return "technical";
}

export function activeRenewalHold(group = {}) {
  const hold = group.renewalHold;
  if (!hold?.kind) return null;
  if (hold.kind === "membership" && group.membershipPending === false) return null;
  return hold;
}

export function buildRenewalPlan(rows, now = new Date(), limit = DEFAULT_DAILY_LIMIT, existing = {}) {
  const candidates = new Map();
  for (const row of rows || []) {
    const g = { ...(row.state || {}) };
    if (row.rent2buy !== true || g.rent2buy === false || g.archived || activeRenewalHold(g)) continue;
    const url = canonicalGroup(row.group_url || g.url);
    if (!url || groupPipeline(g) !== "proven" || !hasGroupAcceptance(g) || !groupDueState({ ...g, pipeline: "proven" }, now).due) continue;
    const last = Date.parse(g.lastPostedAt);
    const entry = { groupKey: url, name: String(row.group_name || g.name || "Facebook group"), url, lastPostedAt: new Date(last).toISOString(), interval: Math.max(1, Number(g.repeatDays || 7)), issues: renewalChecks(g) };
    const existing = candidates.get(url);
    if (!existing || Date.parse(existing.lastPostedAt) < last) candidates.set(url, entry);
  }
  const due = [...candidates.values()].sort((a, b) => a.issues.length - b.issues.length || a.lastPostedAt.localeCompare(b.lastPostedAt) || a.groupKey.localeCompare(b.groupKey));
  const cap = clampLimit(limit);
  const groups = existing.groups || [];
  const queued = new Set(groups.map((group) => group.groupKey));
  const lastScanAt = now.toISOString();
  const additions = due.filter((group) => !queued.has(group.groupKey)).slice(0, Math.max(0, cap - groups.length));
  return { ...existing, dueCount: due.length, reviewCount: due.filter((g) => g.issues.length).length,
    limit: cap, lastScanAt, groups: [...groups, ...additions.map((group) => ({ ...group, queuedAt: lastScanAt }))] };
}

// Per-group status for a run. Submitted = CRM-recorded submission after the
// daily check (the helper's recorded post); accepted/awaiting come from the
// existing acceptance monitoring. Opening a composer is never counted.
export function summarizeRenewalRun(run, events = [], groupStates = {}, { currentQueue = false, now = new Date() } = {}) {
  const plan = run?.plan || {};
  const groups = Array.isArray(plan.groups) ? plan.groups : [];
  const checkedAt = Date.parse(run.checked_at);
  const submitted = new Map();
  for (const event of events) {
    const key = canonicalGroup(event.metadata?.group_url);
    const postedAt = event.metadata?.submitted_at || event.occurred_at;
    if (!key || (event.metadata?.renewal_run_date || event.activity_date) !== run.run_date || !(Date.parse(postedAt) >= checkedAt)) continue;
    const previous = submitted.get(key);
    if (!previous || Date.parse(postedAt) >= Date.parse(previous.metadata?.submitted_at || previous.occurred_at)) submitted.set(key, event);
  }
  const outcomes = run.outcomes && typeof run.outcomes === "object" ? run.outcomes : {};
  const items = groups.map((g) => {
    const state = groupStates[g.groupKey] || {};
    const postedSinceCheck = Date.parse(state.lastPostedAt) >= checkedAt;
    let status = "queued";
    const event = submitted.get(g.groupKey);
    const outcome = outcomes[g.groupKey];
    const recordedReview = plan.reviews?.[g.groupKey];
    const review = currentQueue ? null : recordedReview;
    if (event) {
      const approval = event.metadata?.approval_outcome || (postedSinceCheck ? state.postStatus : "");
      status = "submitted";
      if (approval === "accepted") status = "accepted";
      else if (["pending", "awaiting", "not_found"].includes(approval)) status = "awaiting_approval";
      else if (approval === "declined") status = "declined";
    } else if (review?.result === "pending") status = "previous_pending";
    else if (review?.result === "declined") status = "previous_declined";
    else if (review?.result === "accepted" && review.kind === "attempt") status = "previous_confirmed";
    else if (review?.result === "unknown") status = "needs_attention";
    else if (OUTCOMES.includes(outcome?.status) && !releasedPreviousSubmissionHold(outcome, review) &&
        !(currentQueue && (isHistoricalSubmissionHold(outcome) || isExpiredAttemptHold(outcome, now)))) status = outcome.status;
    else if (run.stopped) status = "stopped";
    else if (outcomes[g.groupKey]?.status === "preparing") status = "preparing";
    return { ...g, status, reason: event ? event.metadata?.approval_reason || "" : review?.reason || (status !== "queued" ? outcome?.reason : "") ||
      (status === "stopped" ? run.stopped.reason : status === "needs_attention" ? "The browser recorded an exception without a reason. Review the group before retrying." : "") };
  });
  const count = (...s) => items.filter((i) => s.includes(i.status)).length;
  return {
    date: run.run_date, checkedAt: run.checked_at, lastScanAt: plan.lastScanAt || null,
    lastScanReviewCount: plan.lastScanAt ? plan.reviewCount ?? null : null,
    due: plan.dueCount ?? 0, queued: groups.length, limit: plan.limit ?? DEFAULT_DAILY_LIMIT,
    processed: count("submitted", "accepted", "awaiting_approval", "declined", "skipped", "failed", "needs_attention", "previous_pending", "previous_declined", "previous_confirmed"),
    confirmedSubmissions: count("submitted", "accepted", "awaiting_approval", "declined"),
    accepted: count("accepted"), awaitingApproval: count("awaiting_approval"),
    previousPending: count("previous_pending"), previousDeclined: count("previous_declined"), previousConfirmed: count("previous_confirmed"),
    skippedOrFailed: count("skipped", "failed"), failures: count("failed"), needsAttention: count("needs_attention", "declined", "stopped"),
    stopped: run.stopped || null, groups: items,
  };
}

export function releasedPreviousSubmissionHold(outcome, review) {
  return isHistoricalSubmissionHold(outcome) && review?.kind === "group" && review.result === "accepted";
}

export function isHistoricalSubmissionHold(outcome) {
  return outcome?.status === "needs_attention" && !outcome.jobId && !outcome.duplicateRisk && outcome.reason === PREVIOUS_SUBMISSION_HOLD;
}

export function isExpiredAttemptHold(outcome, now) {
  return outcome?.status === "needs_attention" && !outcome.jobId && Date.parse(outcome.retryAt) <= now.getTime();
}

export function buildRenewalAdvertHistory(runs, events) {
  const submissions = events.map((event) => {
    const data = event.metadata || {};
    return {
      id: event.id,
      name: data.group_name || "Facebook group",
      url: canonicalGroup(data.group_url),
      registration: data.registration || "",
      mode: data.posting_mode === "automatic" ? "automatic" : "manual",
      postedAt: data.submitted_at || event.occurred_at,
      outcomeAt: data.approval_checked_at || data.submitted_at || event.occurred_at,
      status: data.approval_outcome === "pending" ? "awaiting_approval" : data.approval_outcome || "submitted",
      reason: data.approval_reason || "",
    };
  }).filter((event) => event.url);
  const exceptions = runs.flatMap((run) => (run.plan?.groups || []).flatMap((group) => {
    const outcome = run.outcomes?.[group.groupKey];
    if (!outcome || ![...OUTCOMES, "stopped"].includes(outcome.status)) return [];
    return [{ id: run.run_date + "||" + group.groupKey, name: group.name, url: group.url,
      registration: outcome.registration || "", mode: outcome.mode || "manual",
      postedAt: null, outcomeAt: outcome.at, status: outcome.status, reason: outcome.reason ||
        (outcome.status === "needs_attention" ? "The browser did not record an explanation. Review the group before retrying." : "") }];
  }));
  return [...submissions, ...exceptions].sort((a, b) => Date.parse(b.postedAt || b.outcomeAt) - Date.parse(a.postedAt || a.outcomeAt));
}
