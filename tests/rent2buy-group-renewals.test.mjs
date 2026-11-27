import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { buildRenewalPlan, groupActivitySourceId, summarizeRenewalRun, londonDay, nextRunAt, renewalReviewIdentity } from "../lib/rent2buyGroupRenewals.js";
import { groupDueState, groupPipeline } from "../services/facebookGroupsAgent.js";
import { runDailyRenewalCheck, handlePost, readRenewals, authoriseRenewalRequest } from "../api/rent2buy-group-renewals.js";

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
  assert.equal(plan.reviewCount, 3);
  assert.equal(plan.groups.length, 30, "daily maximum");
  assert.ok(plan.groups.every((g) => !g.issues.length), "clean groups first");
  const all = buildRenewalPlan(stale, now, 30);
  assert.equal(all.groups.length, 4, "all four still queued");
  assert.deepEqual(all.groups.find((g) => g.name === "unresolved").issues, []);
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
  const t = { rent2buy_group_renewal_settings: [{ id: 1, enabled, max_daily: maxDaily }], rent2buy_group_renewal_runs: [], facebook_group_state: groups, marketing_daily_activity_events: [], conversation_channel_status: [] };
  return { t, from(name) {
    let filters = [], extraFilters = [], op = "select", payload = null, opts = {}, order, count;
    const rows = () => (t[name] || []).filter((r) => filters.every(([k, v]) => v === null ? r[k] == null :
      String(typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k]) === String(v)) && extraFilters.every((match) => match(r)));
    const run = () => {
      if (op === "upsert") {
        const key = name === "rent2buy_group_renewal_runs" ? "run_date" : name === "conversation_channel_status" ? "channel" : "id";
        const hit = t[name].find((r) => r[key] === payload[key]);
        if (hit) { if (!opts.ignoreDuplicates) Object.assign(hit, payload); } else t[name].push({ ...payload });
        return { data: hit && opts.ignoreDuplicates ? [] : [hit || payload], error: null };
      }
      if (op === "insert") {
        if (t[name].some(r => r.source_id === payload.source_id)) return { error: { code: "23505" } };
        t[name].push({ id: t[name].length + 1, ...payload });
        return { error: null };
      }
      if (op === "update") { const matched = rows(); matched.forEach((r) => Object.assign(r, payload)); return { data: matched, error: null }; }
      const found = rows();
      if (order) found.sort((a,b) => String(a[order[0]]).localeCompare(String(b[order[0]])) * (order[1] ? 1 : -1));
      return { data: found.slice(0, count), error: null };
    };
    const b = { select() { return b; }, eq(k, v) { filters.push([k, v]); return b; }, is(k, v) { filters.push([k, v]); return b; }, gte() { return b; }, lt(k, v) { extraFilters.push((r) => r[k] < v); return b; }, gt(k, v) { extraFilters.push((r) => r[k] > v); return b; },
      contains(k, value) { extraFilters.push(r => Object.entries(value).every(([key, expected]) => typeof expected === "object"
        ? Object.entries(expected).every(([field, inner]) => r[k]?.[key]?.[field] === inner) : r[k]?.[key] === expected)); return b; }, order(k, o = {}) { order = [k, o.ascending !== false]; return b; }, limit(n) { count = n; return b; }, range() { return b; },
      upsert(p, o) { op = "upsert"; payload = p; opts = o || {}; return b; }, update(p) { op = "update"; payload = p; return b; }, insert(p) { op = "insert"; payload = p; return b; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] || null, error: null }); }, then(res, rej) { return Promise.resolve(run()).then(res, rej); } };
    return b;
  } };
}

test("hourly scans append newly due groups while preserving the daily cap, outcomes and review holds", async () => {
  const db = fakeDb({ maxDaily: 2, groups: [fixture("ok"), fixture("later", { lastPostedAt: "2026-11-18T08:00:00Z" }),
    fixture("after-cap", { lastPostedAt: "2026-11-18T09:00:00Z" })] });
  const first = await runDailyRenewalCheck(db, now);
  assert.equal(first.queued, 1);
  const run = db.t.rent2buy_group_renewal_runs[0];
  run.outcomes[url("ok")] = { status: "needs_attention", duplicateRisk: true };
  run.plan.reviews = { [url("ok")]: { result: "unknown" } };
  const later = new Date("2026-11-25T08:01:00Z");
  assert.equal((await runDailyRenewalCheck(db, later)).added, 1);
  assert.equal((await runDailyRenewalCheck(db, later)).alreadyChecked, true);
  assert.equal((await runDailyRenewalCheck(db, new Date("2026-11-25T09:00:00Z"))).added, 0);
  assert.deepEqual(run.plan.groups.map((group) => group.name), ["ok", "later"]);
  assert.equal(run.plan.groups[1].queuedAt, later.toISOString());
  assert.equal(run.plan.reviews[url("ok")].result, "unknown");
  assert.equal(run.outcomes[url("ok")].duplicateRisk, true);
  assert.equal(run.checked_at, now.toISOString());
  assert.equal(db.t.rent2buy_group_renewal_runs.length, 1);
  const off = fakeDb({ enabled: false, groups: [fixture("ok")] });
  assert.equal((await runDailyRenewalCheck(off, now)).disabled, true);
  assert.equal(off.t.rent2buy_group_renewal_runs.length, 0);
  const capped = fakeDb({ maxDaily: 1, groups: [fixture("ok"), fixture("two")] });
  assert.equal((await runDailyRenewalCheck(capped, now)).queued, 1, "uses the CRM maximum setting");
});

test("a worker token can report a heartbeat only, in the environment where it was issued", () => {
  const environment = { MARKETING_CUSTOMER_DATABASE_API_KEY: "test-only-key", VERCEL_ENV: "production" };
  const token = createHmac("sha256", environment.MARKETING_CUSTOMER_DATABASE_API_KEY)
    .update("rent2buy-group-renewals:heartbeat:v1:production").digest("hex");
  const request = { method: "POST", headers: { authorization: `Bearer ${token}` } };
  assert.equal(authoriseRenewalRequest(request, { action: "heartbeat" }, environment), "worker");
  for (const action of ["heartbeat-token", "settings", "claim", "submission", "review", "outcome"]) {
    assert.equal(authoriseRenewalRequest(request, { action }, environment), "");
  }
  assert.equal(authoriseRenewalRequest({ ...request, method: "GET" }, null, environment), "");
  assert.equal(authoriseRenewalRequest(request, { action: "heartbeat" }, { ...environment, VERCEL_ENV: "preview" }), "");
});

test("background alarms report while idle, survive a worker restart, and recover the elected tab when due", async () => {
  const origin = "https://marketing-crm-six.vercel.app";
  const stateKey = "vfcRent2BuyGroupRenewal";
  const renewalAlarm = "vfcRent2BuyGroupRenewalAlarm";
  const approvalAlarm = "vfcFacebookGroupApprovalMonitorAlarm";
  const storage = {
    [stateKey]: { origin, automation: { enabled: true, url: `${origin}/rent2buy-groups`, tabId: 5, scheduleVersion: 2, wakeAt: now.getTime() + 3_600_000 } },
    vfcRent2BuyRenewalHeartbeat: { origin, token: "f".repeat(64) },
  };
  const alarms = new Map();
  const heartbeats = [];
  const reloaded = [];
  const wakes = [];
  let clock = now.getTime();
  let discarded = false;
  let acknowledge = true;
  const source = readFileSync(new URL("../browser-extension/marketplace-helper/background.js", import.meta.url), "utf8");
  function startWorker() {
    const listeners = {};
    const ignoredEvent = { addListener() {} };
    const worker = runInNewContext(`${source}\n;({ wait: () => Promise.all([renewalWork, renewalTick]) })`, {
      Date: class extends Date {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      },
      URL, AbortSignal, setTimeout, clearTimeout,
      fetch: async (url, init) => { heartbeats.push({ url, ...JSON.parse(init.body) }); return { status: 200 }; },
      chrome: {
        storage: { local: { get: async () => ({ ...storage }), set: async (patch) => Object.assign(storage, patch) } },
        alarms: { get: async (key) => alarms.get(key), create: async (key, value) => alarms.set(key, value),
          onAlarm: { addListener: (listener) => { listeners.alarm = listener; } } },
        tabs: { get: async (id) => ({ id, url: `${origin}/rent2buy-groups`, discarded }), onUpdated: ignoredEvent,
          reload: async (id) => { reloaded.push(id); },
          sendMessage: async (id, message) => { wakes.push(id); return { ok: acknowledge && message.recoverOwnership }; } },
        runtime: { getManifest: () => ({ version: "1.2.33" }), onInstalled: ignoredEvent, onStartup: ignoredEvent, onMessage: ignoredEvent },
      },
    });
    return async (name) => { listeners.alarm({ name }); await worker.wait(); };
  }

  let alarm = startWorker();
  await alarm(renewalAlarm);
  const firstSchedule = alarms.get(renewalAlarm);
  assert.equal(firstSchedule.periodInMinutes, 5);
  assert.equal(alarms.get(approvalAlarm).periodInMinutes, 60);
  assert.equal(heartbeats[0].state, "ready");
  assert.equal(wakes.length, 0, "idle heartbeats don't depend on a CRM tab");
  clock += 300_000;
  alarm = startWorker();
  await alarm(renewalAlarm);
  assert.equal(heartbeats.length, 2);
  assert.equal(alarms.get(renewalAlarm), firstSchedule, "a worker restart doesn't postpone the alarm");
  clock = storage[stateKey].automation.wakeAt;
  await alarm(approvalAlarm);
  discarded = true;
  await alarm(renewalAlarm);
  assert.equal(heartbeats[2].approvalMonitor.lastAlarmAt, new Date(clock).toISOString());
  assert.deepEqual(reloaded, [5]);
  discarded = false;
  acknowledge = false;
  await alarm(renewalAlarm);
  assert.deepEqual(reloaded, [5, 5], "a missed wake also reloads the elected driver");
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
  assert.equal(report.nextRunAt, "2026-11-25T08:00:00.000Z");
  const s = await handlePost(db, { action: "settings", enabled: false, maxDaily: 500 }, now);
  assert.deepEqual([s.settings.enabled, s.settings.maxDaily], [false, 30]);
});

test("a due advert can be claimed once and the stopped queue rejects new claims", async () => {
  const rows = [fixture("one"), fixture("pending", { postStatus: "pending" }), fixture("three")].map((row) => ({ ...row, group_key: row.group_url }));
  const db = fakeDb({ groups: rows });
  await runDailyRenewalCheck(db, now);
  const claim = (id, jobId) => handlePost(db, { action: "claim", groupUrl: url(id), jobId }, now);
  const competitors = await Promise.all([claim("one", "job-alpha-123"), claim("one", "job-beta-1234")]);
  assert.equal(competitors.filter((entry) => entry.prepare).length, 1);
  const claimedId = db.t.rent2buy_group_renewal_runs[0].outcomes[url("one")].jobId;
  assert.equal((await claim("one", claimedId)).prepare, true, "the same reserved job can recover its handoff");
  assert.equal((await claim("pending", "job-alpha-456")).prepare, true, "old approval state does not block a new cycle");
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

test("automatic posting requires recorded acceptance and compatible group rules", async () => {
  const group = (id, state) => ({ ...fixture(id, state), group_key: url(id) });
  const db = fakeDb({ groups: [
    group("membership-only", { postStatus: "", acceptedPostCount: 0 }),
    group("no-links", { linksAllowed: false }),
    group("approved", {}),
  ] });
  await runDailyRenewalCheck(db, now);
  for (const [name, allowed] of [["membership-only", false], ["no-links", false], ["approved", true]]) {
    const claim = await handlePost(db, { action: "claim", groupUrl: url(name), jobId: "auto-preparation-" + name, automatic: true }, now);
    assert.equal(claim.prepare === true, allowed, name);
  }
});

test("the CRM shows separate heartbeat and retains confirmed and failed advert history", async () => {
  const groups = ["auto", "broken"].map((id) => ({ ...fixture(id), group_key: url(id) }));
  const db = fakeDb({ groups });
  await runDailyRenewalCheck(db, now);
  const runDate = "2026-11-25";
  const postedAt = "2026-11-25T07:05:00.000Z";
  for (const [group, registration] of [["auto", "AB12CDE"], ["broken", "XY34ZZZ"]]) {
    assert.equal((await handlePost(db, { action: "claim", groupUrl: url(group), automatic: true, registration,
      jobId: "renewal-job-" + group }, now)).prepare, true);
  }
  const receipt = { action: "submission", groupUrl: url("auto"), registration: "AB12CDE", postedAt, runDate, jobId: "renewal-job-auto" };
  assert.equal((await handlePost(db, receipt, new Date(postedAt))).ok, false, "drafts do not produce a submission");
  db.t.marketing_daily_activity_events.push(
    { id: "auto", activity_date: runDate, activity_type: "rent2buy_groups_post", source: "facebook_groups", occurred_at: postedAt,
      source_id: groupActivitySourceId("rent2buy", url("auto"), "AB12CDE", runDate),
      metadata: { group_name: "Auto", group_url: url("auto"), registration: "AB12CDE", posting_mode: "automatic",
        submitted_at: postedAt, renewal_run_date: runDate, renewal_job_id: "renewal-job-auto", approval_outcome: "pending" } },
    { id: "manual", activity_date: runDate, activity_type: "rent2buy_groups_post", source: "facebook_groups", occurred_at: postedAt,
      metadata: { group_name: "Manual", group_url: url("manual"), registration: "JK22AAA", posting_mode: "manual" } },
  );
  assert.equal((await handlePost(db, receipt, new Date(postedAt))).ok, true);
  assert.equal((await handlePost(db, receipt, new Date(postedAt))).ok, true, "receipt replay is idempotent");
  await handlePost(db, { action: "outcome", groupUrl: url("broken"), jobId: "renewal-job-broken", runDate,
    status: "failed", failureStage: "publication", reason: "Facebook reported that the post failed" }, new Date(postedAt));
  const checkedAt = "2026-11-25T07:10:00.000Z";
  for (const [state, environment] of [["ready", {}], ["restricted", { VERCEL_ENV: "preview" }]]) {
    assert.equal((await handlePost(db, { action: "heartbeat", state }, new Date(checkedAt), environment)).ok, true);
  }
  const pending = await readRenewals(db, new Date(checkedAt), { environment: {} });
  assert.deepEqual([pending.latest.confirmedSubmissions, pending.latest.awaitingApproval, pending.latest.failures], [1, 1, 1]);
  await handlePost(db, { action: "approval", approval: "accepted", groupUrl: url("auto"), registration: "AB12CDE", postedAt,
    checkedAt }, new Date(checkedAt));
  const report = await readRenewals(db, new Date(checkedAt), { environment: {} });
  const previewReport = await readRenewals(db, new Date(checkedAt), { environment: { VERCEL_ENV: "preview" } });
  assert.equal(previewReport.agent.health, "restricted", "preview restriction stays in the preview channel");
  assert.equal(report.latest.accepted, 1);
  assert.equal(report.agent.health, "outcomes_need_attention");
  assert.equal(report.agent.lastHeartbeatAt, checkedAt);
  const history = new Map(report.advertHistory.map((event) => [event.name.toLowerCase(), event]));
  assert.equal(history.get("auto").status, "accepted");
  assert.equal(history.get("auto").postedAt, postedAt);
  assert.equal(history.get("manual").mode, "manual");
  assert.equal(history.get("auto").mode, "automatic");
  assert.equal(history.get("broken").registration, "XY34ZZZ");
  assert.equal(history.get("broken").postedAt, null);
  assert.match(history.get("broken").reason, /post failed/);
});

test("London day and next run time", () => {
  assert.equal(londonDay(new Date("2026-07-01T23:30:00Z")), "2026-07-02");
  assert.equal(nextRunAt(new Date("2026-11-25T06:59:00Z")), "2026-11-25T07:00:00.000Z");
});

test("historical review rows do not gate new adverts, while explicit rejection still archives the group", async () => {
  const rows = ["accepted", "pending", "declined", "unknown"].map(id => ({ ...fixture(id, {
    postStatus: "not_found", pendingRegistration: "BT74HLM", url: url(id),
  }), group_key: url(id) }));
  const db = fakeDb({ groups: rows });
  await runDailyRenewalCheck(db, now);
  const first = await readRenewals(db, now, { queueOnly: true });
  assert.equal(first.latest.groups.filter(group => group.review).length, 0);
  for (const group of first.latest.groups) {
    const target = renewalReviewIdentity({ kind: "group", registration: "BT74HLM", postedAt: rows[0].state.lastPostedAt });
    const action = { action: "review", groupUrl: group.url, target, result: group.name,
      observedAt: "2026-11-18T06:03:00Z", permalink: group.url + "posts/41/" };
    if (group.name === "accepted") {
      assert.equal((await handlePost(db, { ...action, permalink: url("wrong") + "posts/41/" }, now)).ok, false);
      assert.equal((await handlePost(db, { ...action, observedAt: "2026-11-17T06:03:00Z" }, now)).ok, false);
    }
    assert.equal((await handlePost(db, action, now)).ok, true);
    assert.equal((await handlePost(db, action, now)).ok, true, "receipt replay is idempotent");
  }
  assert.deepEqual(rows.map(row => row.state.postStatus), ["accepted", "pending", "declined", "not_found"]);
  assert.equal(rows[2].state.archived, true);
  const reconciled = (await readRenewals(db, now, { queueOnly: true })).latest;
  assert.equal(reconciled.groups.filter(group => group.review).length, 0);
  assert.equal(reconciled.groups.find(group => group.name === "accepted").status, "queued");
  assert.equal(db.t.marketing_daily_activity_events.length, 0, "checking historic posts does not invent new daily activity");
  for (const row of rows) assert.equal((await handlePost(db, { action: "claim", groupUrl: row.group_url,
    jobId: `renewal-claim-${row.group_name}`, automatic: true, registration: "BW72VFG" }, now)).prepare, row.group_name !== "declined");
});

test("old holds are released, but an unconfirmed click starts the configured interval", async () => {
  const key = url("group");
  const row = { ...fixture("group", { postStatus: "awaiting", repeatDays: 10 }), group_key: key };
  const db = fakeDb({ groups: [row] });
  const claim = (at,id) => handlePost(db, { action:"claim", groupUrl:key, jobId:id, automatic:true, registration:"BW72VFG" }, at);
  const first = new Date("2026-11-29T07:00:00Z");
  await runDailyRenewalCheck(db, first);
  const run = db.t.rent2buy_group_renewal_runs[0];
  run.outcomes[key] = {status:"needs_attention",reason:"Review the previous submission before renewing this group"};
  run.plan.reviews = {[key]:{kind:"group",result:"unknown"}};
  assert.equal((await readRenewals(db, first, {queueOnly:true})).latest.groups[0].status,"queued");
  assert.equal((await claim(first,"original-claim")).prepare,true);
  await handlePost(db, {action:"outcome",groupUrl:key,jobId:"original-claim",status:"needs_attention",duplicateRisk:true},first);
  const early = new Date("2026-12-08T07:00:00Z");
  await runDailyRenewalCheck(db, early);
  assert.equal((await claim(early,"too-early-claim")).prepare,false);
  const due = new Date("2026-12-09T07:00:00Z");
  await runDailyRenewalCheck(db, due);
  assert.equal((await claim(due,"now-due-claim")).prepare,true);
});

test("manual activity blocks an automatic claim even before group state catches up", async () => {
  const key = url("manual");
  const db = fakeDb({groups:[{...fixture("manual"),group_key:key}]});
  await runDailyRenewalCheck(db, now);
  db.t.marketing_daily_activity_events.push({id:1,activity_date:londonDay(now),activity_type:"rent2buy_groups_post",source:"facebook_groups",
    metadata:{group_url:key,registration:"YR22YRG",posting_mode:"manual",submitted_at:now.toISOString()}});
  const result = await handlePost(db,{action:"claim",groupUrl:key,jobId:"automatic-claim",automatic:true,registration:"BW72VFG"},now);
  assert.equal(result.prepare,false);
  assert.match(result.reason,/recorded a submission/);
});

test("an already recorded manual receipt closes a matching automatic job without a second activity row", async () => {
  const key = url("overlap"), registration = "YR22YRG", runDate = londonDay(now);
  const db = fakeDb({groups:[{...fixture("overlap"),group_key:key}]});
  await runDailyRenewalCheck(db, now);
  const jobId = "automatic-overlap";
  assert.equal((await handlePost(db,{action:"claim",groupUrl:key,jobId,automatic:true,registration},now)).prepare,true);
  const event = {id:1,activity_date:runDate,activity_type:"rent2buy_groups_post",source:"facebook_groups",
    source_id:groupActivitySourceId("rent2buy",key,registration,runDate),
    metadata:{group_url:key,registration,posting_mode:"manual",submitted_at:now.toISOString()}};
  db.t.marketing_daily_activity_events.push(event);
  const confirmation = {action:"submission",groupUrl:key,jobId,runDate,registration,postedAt:now.toISOString()};
  assert.equal((await handlePost(db,confirmation,now)).ok,true);
  assert.equal((await handlePost(db,confirmation,now)).ok,true);
  assert.equal(db.t.marketing_daily_activity_events.length,1);
  assert.equal(event.metadata.posting_mode,"manual");
  assert.equal(db.t.rent2buy_group_renewal_runs[0].outcomes[key].status,"skipped");
});

test("a verified BW72VFG attempt recovers one receipt, resets the interval and cannot be submitted again", async () => {
  const row = { ...fixture("bw", { url: url("bw") }), group_key: url("bw") };
  const db = fakeDb({ groups: [row] });
  const checked = new Date("2026-11-25T07:04:00Z");
  await runDailyRenewalCheck(db, now);
  const claim = { action: "claim", groupUrl: row.group_url, jobId: "renewal-job-bw72vfg", automatic: true, registration: "BW72VFG" };
  assert.equal((await handlePost(db, claim, now)).prepare, true);
  await handlePost(db, { ...claim, action: "outcome", runDate: londonDay(now), status: "needs_attention", duplicateRisk: true,
    failureStage: "publication", attemptedAt: "2026-11-25T07:03:00Z", reason: "Facebook did not confirm submission" }, checked);
  const next = new Date("2026-11-26T07:00:00Z");
  await runDailyRenewalCheck(db, next);
  const group = (await readRenewals(db, next, { queueOnly: true })).latest.groups[0];
  assert.equal(group.review.registration, "BW72VFG");
  const action = { action: "review", groupUrl: group.url, target: renewalReviewIdentity(group.review), result: "accepted",
    observedAt: "2026-11-25T07:03:08Z", permalink: group.url + "permalink/72/" };
  assert.equal((await handlePost(db, action, next)).ok, true);
  assert.equal((await handlePost(db, action, next)).ok, true);
  assert.equal(db.t.marketing_daily_activity_events.length, 1);
  assert.equal(db.t.marketing_daily_activity_events[0].metadata.renewal_job_id, claim.jobId);
  assert.equal(row.state.lastPostedAt, "2026-11-25T07:03:08.000Z");
  assert.equal((await handlePost(db, { ...claim, jobId: "renewal-job-tomorrow" }, next)).prepare, false);
});
