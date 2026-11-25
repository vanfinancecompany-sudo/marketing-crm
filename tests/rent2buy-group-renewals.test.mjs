import test from "node:test";
import assert from "node:assert/strict";
import { buildRenewalPlan, summarizeRenewalRun, londonDay, nextRunAt } from "../lib/rent2buyGroupRenewals.js";
import { groupDueState, groupPipeline } from "../services/facebookGroupsAgent.js";
import { runDailyRenewalCheck, handlePost, readRenewals } from "../api/rent2buy-group-renewals.js";

const now = new Date("2026-11-25T07:00:00Z");
const url = (id) => "https://www.facebook.com/groups/" + id + "/";
const fixture = (id, state = {}, r2b = true) => ({ group_key: id, group_url: url(id), group_name: id, rent2buy: r2b,
  state: { pipeline: "proven", acceptedPostCount: 1, lastPostedAt: "2026-11-18T06:00:00Z", repeatDays: 7, postStatus: "accepted", joined: true, canPost: true, status: "Green", ...state } });

test("queue matches the CRM's own Proven/Hot due rules; Rent2Buy only", () => {
  const rows = [fixture("ok"), fixture("finance", {}, false), fixture("archived", { archived: true }), fixture("new", { pipeline: "new", acceptedPostCount: 0 }),
    fixture("recent", { lastPostedAt: "2026-11-20T06:00:00Z" }), fixture("long", { repeatDays: 14 }), fixture("hot-by-count", { pipeline: undefined, acceptedPostCount: 2 })];
  const plan = buildRenewalPlan(rows, now);
  assert.deepEqual(plan.groups.map((g) => g.name).sort(), ["hot-by-count", "ok"]);
  for (const row of rows.filter((r) => r.rent2buy && !r.state.archived)) {
    const crmDue = groupPipeline(row.state) === "proven" && groupDueState({ ...row.state, pipeline: "proven" }, now).due;
    assert.equal(plan.groups.some((g) => g.name === row.group_name), crmDue, row.group_name + " agrees with the Facebook Groups page");
  }
});

test("stale or conflicting records never exclude a proven group; they become checks; cap respected", () => {
  const stale = [fixture("unresolved", { postStatus: "pending" }), fixture("conflict", { joined: false, canPost: false }), fixture("gone", { unavailable: true }), fixture("red", { status: "Red" })];
  const plan = buildRenewalPlan([...stale, ...Array.from({ length: 30 }, (_, i) => fixture("g" + i))], now, 30);
  assert.equal(plan.dueCount, 34);
  assert.equal(plan.reviewCount, 4);
  assert.equal(plan.groups.length, 30, "daily maximum");
  assert.ok(plan.groups.every((g) => !g.issues.length), "clean groups first");
  const all = buildRenewalPlan(stale, now, 30);
  assert.equal(all.groups.length, 4, "all four still queued");
  assert.match(all.groups.find((g) => g.name === "unresolved").issues[0], /pending approval or a duplicate/);
  assert.match(all.groups.find((g) => g.name === "conflict").issues.join(" "), /Membership.*Posting permission/);
  assert.equal(buildRenewalPlan(stale, now, 2).groups.length, 2, "custom maximum");
});

test("statuses: confirmed submission, acceptance, awaiting, skipped, stopped; composer opening never counts", () => {
  const plan = buildRenewalPlan(["a", "b", "c", "d", "e"].map((id) => fixture(id)), now);
  const run = { run_date: "2026-11-25", checked_at: now.toISOString(), plan, outcomes: { [url("d")]: { status: "skipped", reason: "Membership required" } } };
  const ev = (id, at = "2026-11-25T08:00:00Z") => ({ activity_date: "2026-11-25", occurred_at: at, metadata: { group_url: url(id) } });
  const states = { [url("a")]: { postStatus: "accepted", lastPostedAt: "2026-11-25T08:00:00Z" }, [url("b")]: { postStatus: "pending", lastPostedAt: "2026-11-25T08:00:00Z" }, [url("c")]: { postStatus: "accepted", lastPostedAt: "2026-11-18T06:00:00Z" } };
  const s = summarizeRenewalRun(run, [ev("a"), ev("b"), ev("c"), ev("e", "2026-11-25T06:00:00Z")], states);
  assert.deepEqual(s.groups.map((g) => g.status), ["accepted", "awaiting_approval", "submitted", "skipped", "queued"]);
  assert.deepEqual([s.confirmedSubmissions, s.accepted, s.awaitingApproval, s.skippedOrFailed, s.processed], [3, 1, 1, 1, 4]);
  const stopped = summarizeRenewalRun({ ...run, stopped: { at: now.toISOString(), reason: "Security check" } }, [], {});
  assert.equal(stopped.groups.filter((g) => g.status === "stopped").length, 4, "remaining groups stop; recorded outcome kept");
  assert.equal(stopped.needsAttention, 4);
});

// Minimal Supabase double for the run/settings tables.
function fakeDb({ enabled = true, maxDaily = 30, groups = [] } = {}) {
  const t = { rent2buy_group_renewal_settings: [{ id: 1, enabled, max_daily: maxDaily }], rent2buy_group_renewal_runs: [], facebook_group_state: groups, marketing_daily_activity_events: [] };
  return { t, from(name) {
    let filters = [], extraFilters = [], op = "select", payload = null, opts = {};
    const rows = () => (t[name] || []).filter((r) => filters.every(([k, v]) => v === null ? r[k] == null :
      String(typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k]) === String(v)) && extraFilters.every((match) => match(r)));
    const run = () => {
      if (op === "upsert") {
        const key = name === "rent2buy_group_renewal_runs" ? "run_date" : "id";
        const hit = t[name].find((r) => r[key] === payload[key]);
        if (hit) { if (!opts.ignoreDuplicates) Object.assign(hit, payload); } else t[name].push({ ...payload });
        return { error: null };
      }
      if (op === "update") { const matched = rows(); matched.forEach((r) => Object.assign(r, payload)); return { data: matched, error: null }; }
      return { data: rows(), error: null };
    };
    const b = { select() { return b; }, eq(k, v) { filters.push([k, v]); return b; }, is(k, v) { filters.push([k, v]); return b; }, gte() { return b; }, lt(k, v) { extraFilters.push((r) => r[k] < v); return b; }, gt(k, v) { extraFilters.push((r) => r[k] > v); return b; },
      contains(k, value) { const [key, fields] = Object.entries(value)[0]; extraFilters.push((r) => Object.entries(fields).every(([field, expected]) => r[k]?.[key]?.[field] === expected)); return b; }, order() { return b; }, limit() { return b; }, range() { return b; },
      upsert(p, o) { op = "upsert"; payload = p; opts = o || {}; return b; }, update(p) { op = "update"; payload = p; return b; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] || null, error: null }); }, then(res, rej) { return Promise.resolve(run()).then(res, rej); } };
    return b;
  } };
}

test("one run per day (repeat or concurrent cron calls are harmless); disabled means no run", async () => {
  const db = fakeDb({ groups: [fixture("ok"), fixture("two")] });
  const first = await runDailyRenewalCheck(db, now);
  assert.equal(first.queued, 2);
  assert.equal((await runDailyRenewalCheck(db, new Date("2026-11-25T09:00:00Z"))).alreadyChecked, true);
  assert.equal(db.t.rent2buy_group_renewal_runs.length, 1);
  const off = fakeDb({ enabled: false, groups: [fixture("ok")] });
  assert.equal((await runDailyRenewalCheck(off, now)).disabled, true);
  assert.equal(off.t.rent2buy_group_renewal_runs.length, 0);
  const capped = fakeDb({ maxDaily: 1, groups: [fixture("ok"), fixture("two")] });
  assert.equal((await runDailyRenewalCheck(capped, now)).queued, 1, "uses the CRM maximum setting");
});

test("outcomes, stop and settings controls", async () => {
  const db = fakeDb({ groups: [fixture("ok"), fixture("two")] });
  await runDailyRenewalCheck(db, now);
  assert.equal((await handlePost(db, { action: "outcome", groupUrl: url("ok"), status: "needs_attention", reason: "Publication not confirmed" }, now)).ok, true);
  assert.equal((await handlePost(db, { action: "outcome", groupUrl: url("elsewhere"), status: "skipped" }, now)).ok, false, "only queued groups");
  assert.equal((await handlePost(db, { action: "outcome", groupUrl: url("two"), status: "posted" }, now)).ok, false, "no fake success status");
  assert.equal((await handlePost(db, { action: "stop", reason: "Security challenge" }, now)).ok, true);
  const report = await readRenewals(db, now);
  assert.deepEqual(report.latest.groups.map((g) => g.status), ["needs_attention", "stopped"]);
  assert.equal(report.nextRunAt, "2026-11-26T07:00:00.000Z");
  const s = await handlePost(db, { action: "settings", enabled: false, maxDaily: 500 }, now);
  assert.deepEqual([s.settings.enabled, s.settings.maxDaily], [false, 30]);
});

test("a renewal can be claimed once, unresolved posts are flagged, and the stopped queue rejects new claims", async () => {
  const rows = [fixture("one"), fixture("pending", { postStatus: "pending" }), fixture("three")].map((row) => ({ ...row, group_key: row.group_url }));
  const db = fakeDb({ groups: rows });
  await runDailyRenewalCheck(db, now);
  const claim = (id, jobId) => handlePost(db, { action: "claim", groupUrl: url(id), jobId }, now);
  const competitors = await Promise.all([claim("one", "job-alpha-123"), claim("one", "job-beta-1234")]);
  assert.equal(competitors.filter((entry) => entry.prepare).length, 1);
  const blocked = await claim("pending", "job-alpha-456");
  assert.equal(blocked.prepare, false);
  assert.match(blocked.reason, /previous submission/);
  await handlePost(db, { action: "stop", reason: "Security challenge" }, now);
  assert.equal((await claim("three", "job-alpha-789")).ok, false);
});

test("an interrupted or unconfirmed Facebook post cannot be prepared again on the next day", async () => {
  const groups = ["interrupted", "unconfirmed", "failed"].map((id) => ({ ...fixture(id), group_key: url(id) }));
  const db = fakeDb({ groups });
  await runDailyRenewalCheck(db, now);
  for (const { group_name: name } of groups) {
    const jobId = "preparation-" + name;
    assert.equal((await handlePost(db, { action: "claim", groupUrl: url(name), jobId }, now)).prepare, true);
    if (name !== "interrupted") {
      assert.equal((await handlePost(db, { action: "outcome", groupUrl: url(name), jobId,
        status: name === "failed" ? "failed" : "needs_attention", duplicateRisk: name === "unconfirmed" }, now)).ok, true);
    }
  }
  const next = new Date("2026-11-26T07:00:00Z");
  await runDailyRenewalCheck(db, next);
  for (const { group_name: name } of groups) {
    const result = await handlePost(db, { action: "claim", groupUrl: url(name), jobId: "next-preparation-" + name }, next);
    assert.equal(result.prepare, name === "failed", name);
  }
});

test("London day and next run time", () => {
  assert.equal(londonDay(new Date("2026-07-01T23:30:00Z")), "2026-07-02");
  assert.equal(nextRunAt(new Date("2026-11-25T06:59:00Z")), "2026-11-25T07:00:00.000Z");
});
