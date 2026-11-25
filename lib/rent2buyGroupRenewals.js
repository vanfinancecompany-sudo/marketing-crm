// Rent2Buy only: deterministic daily renewal queue for Proven/Hot Facebook
// groups. No browser, AI or publishing side effects. "Due" uses the same rules
// as the Facebook Groups page (groupPipeline + groupDueState), so the daily
// queue matches the CRM. Old membership/permission/post records never exclude a
// group; they become checks shown against it.
import { groupDueState, groupPipeline } from "../services/facebookGroupsAgent.js";

export const DEFAULT_DAILY_LIMIT = 30;
export const MAX_DAILY_LIMIT = 100;
export const RUN_TABLE = "rent2buy_group_renewal_runs";
export const SETTINGS_TABLE = "rent2buy_group_renewal_settings";
export const OUTCOMES = ["skipped", "failed", "needs_attention"];
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

export const clampLimit = (value) => Math.max(1, Math.min(MAX_DAILY_LIMIT, Math.floor(Number(value) || DEFAULT_DAILY_LIMIT)));

// Next 07:00 UTC (the Vercel cron time: 07:00 GMT, 08:00 BST).
export function nextRunAt(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

// Advisory checks: current eligibility is confirmed live when the group is opened.
export function renewalChecks(g = {}) {
  const checks = [];
  if (g.unavailable) checks.push("Group marked unavailable: confirm, otherwise skip");
  if (["pending", "awaiting", "not_found"].includes(g.postStatus)) checks.push("Previous post unresolved: check for pending approval or a duplicate first");
  if (g.postStatus === "declined") checks.push("Previous post declined: check current posting permission");
  if (g.joined === false || g.membershipPending) checks.push("Membership: confirm still a member (record may be stale)");
  if (g.canPost === false) checks.push("Posting permission unclear: check current eligibility");
  if (g.status === "Red") checks.push("Group rules marked Red: check before posting");
  return checks;
}

export function buildRenewalPlan(rows, now = new Date(), limit = DEFAULT_DAILY_LIMIT) {
  const candidates = new Map();
  for (const row of rows || []) {
    const g = { ...(row.state || {}) };
    if (row.rent2buy !== true || g.rent2buy === false || g.archived) continue;
    const url = canonicalGroup(row.group_url || g.url);
    if (!url || groupPipeline(g) !== "proven" || !groupDueState({ ...g, pipeline: "proven" }, now).due) continue;
    const last = Date.parse(g.lastPostedAt);
    const entry = { groupKey: url, name: String(row.group_name || g.name || "Facebook group"), url, lastPostedAt: new Date(last).toISOString(), interval: Math.max(1, Number(g.repeatDays || 7)), issues: renewalChecks(g) };
    const existing = candidates.get(url);
    if (!existing || Date.parse(existing.lastPostedAt) < last) candidates.set(url, entry);
  }
  const due = [...candidates.values()].sort((a, b) => a.issues.length - b.issues.length || a.lastPostedAt.localeCompare(b.lastPostedAt) || a.groupKey.localeCompare(b.groupKey));
  const cap = clampLimit(limit);
  return { dueCount: due.length, reviewCount: due.filter((g) => g.issues.length).length, limit: cap, groups: due.slice(0, cap) };
}

// Per-group status for a run. Submitted = CRM-recorded submission after the
// daily check (the helper's recorded post); accepted/awaiting come from the
// existing acceptance monitoring. Opening a composer is never counted.
export function summarizeRenewalRun(run, events = [], groupStates = {}) {
  const plan = run?.plan || {};
  const groups = Array.isArray(plan.groups) ? plan.groups : [];
  const checkedAt = Date.parse(run.checked_at);
  const submitted = new Set(events.filter((e) => e.activity_date === run.run_date && Date.parse(e.occurred_at) >= checkedAt)
    .map((e) => canonicalGroup(e.metadata?.group_url)).filter(Boolean));
  const outcomes = run.outcomes && typeof run.outcomes === "object" ? run.outcomes : {};
  const items = groups.map((g) => {
    const state = groupStates[g.groupKey] || {};
    const postedSinceCheck = Date.parse(state.lastPostedAt) >= checkedAt;
    let status = "queued";
    if (submitted.has(g.groupKey)) {
      status = "submitted";
      if (postedSinceCheck && state.postStatus === "accepted") status = "accepted";
      else if (postedSinceCheck && ["pending", "awaiting", "not_found"].includes(state.postStatus)) status = "awaiting_approval";
      else if (postedSinceCheck && state.postStatus === "declined") status = "declined";
    } else if (OUTCOMES.includes(outcomes[g.groupKey]?.status)) status = outcomes[g.groupKey].status;
    else if (run.stopped) status = "stopped";
    return { ...g, status, reason: outcomes[g.groupKey]?.reason || (status === "stopped" ? run.stopped.reason : "") };
  });
  const count = (...s) => items.filter((i) => s.includes(i.status)).length;
  return {
    date: run.run_date, checkedAt: run.checked_at, due: plan.dueCount ?? 0, queued: groups.length, limit: plan.limit ?? DEFAULT_DAILY_LIMIT,
    processed: count("submitted", "accepted", "awaiting_approval", "declined", "skipped", "failed", "needs_attention"),
    confirmedSubmissions: count("submitted", "accepted", "awaiting_approval", "declined"),
    accepted: count("accepted"), awaitingApproval: count("awaiting_approval"),
    skippedOrFailed: count("skipped", "failed"), needsAttention: count("needs_attention", "declined", "stopped"),
    stopped: run.stopped || null, groups: items,
  };
}
