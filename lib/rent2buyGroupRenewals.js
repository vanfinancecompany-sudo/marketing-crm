// Rent2Buy only: daily immutable review plan. No browser or publishing side effects.
export const DAILY_LIMIT = 30;
export const RUN_TABLE = "rent2buy_group_renewal_runs";
const DAY = 86_400_000;
const london = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
export function londonDay(now = new Date()) {
  const p = Object.fromEntries(london.formatToParts(now).map(({type,value}) => [type,value]));
  return p.year + "-" + p.month + "-" + p.day;
}
export function canonicalGroup(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== "www.facebook.com") return "";
    const m = u.pathname.match(/^\/groups\/([^/]+)\/?$/);
    return m ? ("https://www.facebook.com/groups/" + m[1] + "/").toLowerCase() : "";
  } catch { return ""; }
}
export function buildRenewalPlan(rows, now = new Date(), limit = DAILY_LIMIT) {
  const candidates = new Map();
  for (const row of rows || []) {
    const g = row.state || {};
    if (row.rent2buy !== true || g.rent2buy === false || g.archived || g.unavailable || g.status === "Red") continue;
    if (g.pipeline !== "proven" || !(Number(g.acceptedPostCount) > 0 || g.lastAcceptedAt || g.postStatus === "accepted")) continue;
    const last = Date.parse(g.lastPostedAt || "");
    const interval = Math.max(7, Number(g.repeatDays || 7));
    if (!Number.isFinite(last) || !Number.isFinite(interval) || now.getTime() - last < interval * DAY) continue;
    const url = canonicalGroup(row.group_url || g.url);
    if (!url) continue;
    const issues = [];
    if (g.postStatus !== "accepted") issues.push("Previous post not confirmed accepted");
    if (g.joined !== true) issues.push("Membership needs confirmation");
    if (g.canPost !== true) issues.push("Posting permission needs confirmation");
    if (g.membershipPending) issues.push("Membership pending");
    if (g.status !== "Green") issues.push("Group rules need review");
    const entry = { groupKey: url, name: String(row.group_name || g.name || "Facebook group"), url, lastPostedAt: new Date(last).toISOString(), interval, issues };
    const existing = candidates.get(url);
    if (!existing || Date.parse(existing.lastPostedAt) < last) candidates.set(url, entry);
  }
  const due = [...candidates.values()].sort((a,b) => a.issues.length - b.issues.length || a.lastPostedAt.localeCompare(b.lastPostedAt) || a.groupKey.localeCompare(b.groupKey));
  const cap = Math.max(0, Math.min(DAILY_LIMIT, Math.floor(Number(limit) || 0)));
  return { dueCount: due.length, reviewCount: due.filter(g => g.issues.length).length, groups: due.slice(0, cap) };
}
// Match only same-day CRM activity recorded after the daily check, for groups
// included in that immutable plan. This is NOT independent Facebook verification.
export function summarizeRenewalRun(run, events = []) {
  const plan = run?.plan || {};
  const groups = Array.isArray(plan.groups) ? plan.groups : [];
  const recorded = new Set(events.filter(e => e.activity_date === run.run_date && Date.parse(e.occurred_at) >= Date.parse(run.checked_at)).map(e => canonicalGroup(e.metadata?.group_url)).filter(Boolean));
  const items = groups.map(g => ({ ...g, recorded: recorded.has(g.groupKey) }));
  return { date: run.run_date, checkedAt: run.checked_at, due: plan.dueCount ?? 0, needsReview: plan.reviewCount ?? 0, queued: groups.length, recorded: items.filter(g => g.recorded).length, groups: items };
}
