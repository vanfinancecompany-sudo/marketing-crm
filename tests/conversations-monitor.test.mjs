import test from "node:test";
import assert from "node:assert/strict";
import { redactExcerpt, normaliseReport, buildMonitorIssues, summariseAskMeSessions, countEvents, withoutFacebookSessions, isMonitorTestEvent, marketplaceOutstanding, marketplaceProductCounts } from "../lib/conversationsMonitor.js";
import { handleConversationsReport } from "../api/conversations-report.js";
import { runConversationsMonitor } from "../api/conversations-monitor.js";
import { describeRenewalAgent, RENEWAL_MONITOR_CHANNEL } from "../lib/rent2buyGroupRenewalMonitor.js";
import { buildActivityEntries, getConversationsActivity } from "../api/conversations-activity.js";

const now = new Date("2026-11-24T16:00:00Z");
const ago = (min) => new Date(now.getTime() - min * 60_000).toISOString();

test("excerpts drop contact details and long numbers", () => {
  const out = redactExcerpt("Call me on 07700 900123 or jo@example.com, SO15 1AA, card 4111111111111111");
  assert.doesNotMatch(out, /07700|example\.com|SO15|4111/);
  assert.match(out, /\[phone\].*\[email\].*\[postcode\].*\[number\]/);
});

test("reports are validated; bad events are dropped", () => {
  const { status, events } = normaliseReport({
    heartbeat: { monitoring: true, mode: "auto", tabReportedAt: ago(1), accountLocked: true, extra: "x" },
    events: [{ id: "a", kind: "answered", at: ago(2), question: "Ring 07700900123", reply: "Yes" }, { id: "b", kind: "bogus", at: ago(1) }, { kind: "answered", at: ago(1) }],
  });
  assert.equal(status.monitoring, true);
  assert.equal(status.extra, undefined);
  assert.equal(events.length, 1);
  assert.match(events[0].question_excerpt, /\[phone\]/);
});

test("monitor rules: stale heartbeat, silent browser, not monitoring, failures, needs a person", () => {
  const healthy = { last_heartbeat_at: ago(1), status: { monitoring: true, mode: "auto", tabReportedAt: ago(1) } };
  assert.deepEqual(buildMonitorIssues({ facebook: healthy, now }), []);
  assert.equal(buildMonitorIssues({ facebook: null, now })[0].fingerprint, "facebook:no-heartbeat");
  assert.equal(buildMonitorIssues({ facebook: { ...healthy, last_heartbeat_at: ago(30) }, now })[0].fingerprint, "facebook:heartbeat-stale");
  assert.equal(buildMonitorIssues({ facebook: { ...healthy, status: { ...healthy.status, tabReportedAt: ago(20) } }, now })[0].fingerprint, "facebook:browser-silent");
  assert.equal(buildMonitorIssues({ facebook: { ...healthy, status: { ...healthy.status, monitoring: false, reasons: ["List closed"] } }, now })[0].fingerprint, "facebook:not-monitoring");
  const events = [
    { channel: "facebook_marketplace", kind: "send_failed", occurred_at: ago(5), reason: "No message appeared" },
    { channel: "facebook_marketplace", kind: "needs_human", occurred_at: ago(5), reason: "Ask Me unavailable: Ask Me returned HTTP 503" },
    { channel: "ask_me", kind: "ai_failed", occurred_at: ago(5), reason: "429 rate limit" },
    { channel: "ask_me", kind: "ai_failed", occurred_at: ago(300), reason: "old" },
  ];
  const fps = buildMonitorIssues({ facebook: healthy, events, now }).map((i) => i.fingerprint).sort();
  assert.deepEqual(fps, ["ask_me:ai-failed", "conversations:needs-human", "facebook:send-failed", "facebook_marketplace:ai-failed"]);
  assert.equal(countEvents(events).ask_me.ai_failed, 2);
});

test("Ask Me summary uses retained session history only", () => {
  const s = summariseAskMeSessions([{ product_lock: "rent2buy", last_activity_at: ago(3), conversation_history: [{ role: "user", content: "Do I need a deposit? my email a@b.co" }, { role: "assistant", content: "Yes, £200." }] }]);
  assert.equal(s.questions, 1);
  assert.equal(s.answers, 1);
  assert.equal(s.byProduct.rent2buy, 1);
  assert.match(s.recent[0].question, /\[email\]/);
});

function fakeDb(state) {
  return {
    from(table) {
      const rows = (state[table] ||= []);
      const filters = [];
      let patch = null;
      const run = () => {
        const matching = rows.filter((r) => filters.every(([key, value]) => value === null ? r[key] == null : r[key] === value));
        if (patch) matching.forEach((row) => Object.assign(row, patch));
        return matching.map((row) => ({ ...row }));
      };
      const q = { select() { return q; }, gte() { return q; }, order() { return q; }, limit() { return q; }, range(start,end) { return Promise.resolve({data:run().slice(start,end+1),error:null}); },
        eq(k, v) { filters.push([k, v]); return q; }, is(k, v) { filters.push([k, v]); return q; },
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        then(resolve) { resolve({ data: run(), error: null }); },
        upsert: async (row, opts) => { const list = Array.isArray(row) ? row : [row]; for (const r of list) { const key = opts?.onConflict; const i = rows.findIndex((x) => x[key] === r[key]); if (i >= 0) { if (!opts.ignoreDuplicates) rows[i] = { ...rows[i], ...r }; } else rows.push({ ...r }); } return { error: null }; },
        update(value) { patch = value; return q; },
      };
      return q;
    },
  };
}
const res = () => { const r = { code: 0, body: null, setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

test("report endpoint: token required, idempotent events", async () => {
  const state = {};
  const env = { CONVERSATIONS_REPORT_TOKEN: "x".repeat(32) };
  const body = { heartbeat: { monitoring: true, mode: "auto" }, events: [{ id: "e1", kind: "answered", at: ago(1) }] };
  let r = res(); await handleConversationsReport({ method: "POST", headers: { authorization: "Bearer wrong" }, body }, r, { environment: env, supabase: fakeDb(state) });
  assert.equal(r.code, 401);
  for (let i = 0; i < 2; i++) { r = res(); await handleConversationsReport({ method: "POST", headers: { authorization: "Bearer " + "x".repeat(32) }, body }, r, { environment: env, supabase: fakeDb(state) }); assert.equal(r.code, 200); }
  assert.equal(state.conversation_events.length, 1);
  assert.equal(state.conversation_channel_status[0].status.mode, "auto");
});

test("monitor: one alert per problem, email once after it persists, recovery email once", async () => {
  const state = { conversation_channel_status: [{ channel: "facebook_marketplace", last_heartbeat_at: ago(30), status: {} }], conversation_events: [], conversation_monitor_alerts: [] };
  const sent = [];
  const sendEmail = async (env, subject) => { sent.push(subject); return true; };
  await runConversationsMonitor(fakeDb(state), { now, sendEmail });
  assert.equal(sent.length, 0, "not emailed on first sight");
  await runConversationsMonitor(fakeDb(state), { now: new Date(now.getTime() + 600_000), sendEmail });
  await runConversationsMonitor(fakeDb(state), { now: new Date(now.getTime() + 1_200_000), sendEmail });
  assert.equal(sent.filter((s) => s.startsWith("Problem")).length, 1, "emailed once");
  assert.equal(state.conversation_monitor_alerts.length, 1);
  state.conversation_channel_status[0] = { channel: "facebook_marketplace", last_heartbeat_at: new Date(now.getTime() + 1_790_000).toISOString(), status: { monitoring: true, mode: "auto", tabReportedAt: new Date(now.getTime() + 1_790_000).toISOString() } };
  await runConversationsMonitor(fakeDb(state), { now: new Date(now.getTime() + 1_800_000), sendEmail });
  await runConversationsMonitor(fakeDb(state), { now: new Date(now.getTime() + 1_800_000), sendEmail });
  assert.equal(sent.filter((s) => s.startsWith("Recovered")).length, 0, "recovery resolves silently by default");
  assert.equal(state.conversation_monitor_alerts[0].status, "resolved");
});

test("renewal monitoring checks schedules, stale browser, stalled work, publication failures and restrictions", () => {
  const settings = { enabled: true, updatedAt: ago(24 * 60) };
  const heartbeat = { last_heartbeat_at: ago(2), status: { state: "ready" } };
  const run = { run_date: "2026-11-24", checked_at: ago(35), plan: { groups: [] }, outcomes: {} };
  const check = (inputs = {}) => describeRenewalAgent({ settings, run, heartbeat, now, ...inputs });
  assert.equal(check().health, "idle");
  assert.equal(check({ run: { ...run, plan: { groups: [{ groupKey: "one" }] }, outcomes: { one: { status: "submitted", at: ago(2) } } } }).health, "healthy");
  assert.deepEqual(check({ run: null }).issues.map((item) => item.fingerprint), ["rent2buy-renewal:missed-run"]);
  const tomorrowGrace = new Date("2026-11-25T07:15:00Z");
  assert.ok(check({ run: null, now: tomorrowGrace }).issues.some((item) => item.fingerprint === "rent2buy-renewal:missed-run"),
    "an unresolved missed run stays open during the next morning’s grace period");
  assert.equal(check({ heartbeat: { ...heartbeat, last_heartbeat_at: ago(30) } }).health, "disconnected");
  assert.equal(check({ run: { ...run, plan: { groups: [{ groupKey: "one" }] } } }).health, "stalled");
  assert.equal(check({ heartbeat: { last_heartbeat_at: ago(50), status: { state: "paused" } } }).issues.length, 0);
  assert.equal(check({ heartbeat: { ...heartbeat, status: { state: "restricted", reason: "Facebook checkpoint" } } }).health, "restricted");
  const failures = (stage) => Object.fromEntries(["one", "two", "three"].map((group) =>
    [group, { status: "failed", failureStage: stage, at: ago(2) }]));
  assert.equal(check({ run: { ...run, outcomes: failures("publication") } }).health, "publication_failures");
  assert.equal(check({ run: { ...run, outcomes: failures("preparation") } }).health, "outcomes_need_attention");
  assert.equal(check({ run: { ...run, outcomes: { one: { status: "needs_attention", failureStage: "publication", duplicateRisk: true, at: ago(90) } } } }).health,
    "outcomes_need_attention", "an unresolved publication remains visible after the rapid-alert window");
  assert.equal(check({ settings: { enabled: false, updatedAt: ago(3) }, run: null }).issues.length, 0);
  assert.equal(check({ settings: { enabled: true, updatedAt: ago(2) }, run: null }).issues.length, 0);
});

test("retired group renewal incidents close silently and never reopen", async () => {
  const state = {
    conversation_channel_status: [
      { channel: "facebook_marketplace", last_heartbeat_at: ago(1), status: { mode: "auto", monitoring: true, tabReportedAt: ago(1) } },
      { channel: RENEWAL_MONITOR_CHANNEL, last_heartbeat_at: ago(25), status: { state: "ready" } },
    ],
    conversation_monitor_alerts: [{ fingerprint: "rent2buy-renewal:browser-disconnected", channel: RENEWAL_MONITOR_CHANNEL, status: "open", severity: "critical", first_seen_at: ago(20), emailed_at: ago(10) }],
    rent2buy_group_renewal_settings: [{ id: 1, enabled: true, updated_at: ago(24 * 60) }],
    rent2buy_group_renewal_runs: [{ run_date: "2026-11-24", checked_at: ago(35), plan: {} }],
  };
  const db = fakeDb(state);
  const sent = [];
  const run = date => runConversationsMonitor(db, { now: date, environment: { CONVERSATIONS_RECOVERY_EMAILS: "true" },
    sendEmail: async (_, subject) => { sent.push(subject); return true; } });
  await run(now);
  assert.equal(state.conversation_monitor_alerts[0].status, "resolved");
  const second = new Date(now.getTime() + 6 * 60_000);
  await Promise.all([run(second), run(second), run(second)]);
  assert.equal(sent.length, 0);
  assert.equal(state.conversation_monitor_alerts.length, 1);
  assert.equal(state.conversation_monitor_alerts[0].status, "resolved");
});

test("Ask Me sessions created by the Facebook assistant are not counted as website conversations", () => {
  const sessions = [
    { last_activity_at: ago(30), conversation_history: [{ role: "user", content: "Do I need a deposit?" }] },
    { last_activity_at: ago(30), conversation_history: [{ role: "user", content: "Different website question" }] },
    { last_activity_at: ago(300), conversation_history: [{ role: "user", content: "Do I need a deposit?" }] },
  ];
  const kept = withoutFacebookSessions(sessions, [{ question_excerpt: "Do I need a deposit?", occurred_at: ago(31) }]);
  assert.equal(kept.length, 2, "only the matching session in the 10-minute window is excluded");
});


test("test telemetry never triggers alerts or appears in customer metrics", () => {
  const testEvent = { source_id: "TEST-monitor-askme-failure-20261124", channel: "facebook_marketplace", kind: "needs_human", occurred_at: ago(1), reason: "TEST (monitor check, not a customer): Ask Me unavailable: Ask Me returned HTTP 503" };
  assert.equal(isMonitorTestEvent(testEvent), true);
  const healthy = { last_heartbeat_at: ago(1), status: { monitoring: true, mode: "auto", tabReportedAt: ago(1) } };
  assert.deepEqual(buildMonitorIssues({ facebook: healthy, events: [testEvent], now }), []);
  assert.deepEqual(countEvents([testEvent]), {});
  assert.deepEqual(buildActivityEntries([], [testEvent]), []);
});

test("one genuine AI error stays dashboard-only; repeated recent errors are critical", () => {
  const healthy = { last_heartbeat_at: ago(1), status: { monitoring: true, mode: "auto", tabReportedAt: ago(1) } };
  const failure = (minutes) => ({ source_id: `error-${minutes}`, channel: "facebook_marketplace", kind: "ai_failed", occurred_at: ago(minutes), reason: "Ask Me returned HTTP 503" });
  const once = buildMonitorIssues({ facebook: healthy, events: [failure(3)], now });
  assert.equal(once.length, 1);
  assert.equal(once[0].severity, "warning", "single AI failure must not email");
  const repeated = buildMonitorIssues({ facebook: healthy, events: [failure(1), failure(2), failure(3)], now });
  assert.equal(repeated[0].severity, "critical", "three failures in fifteen minutes qualify");
  const old = buildMonitorIssues({ facebook: healthy, events: [failure(20), failure(30), failure(40)], now });
  assert.equal(old[0].severity, "warning", "old failures do not meet the fresh burst threshold");
});

test("no emails are sent for recovered incidents unless explicitly opted in", async () => {
  const state = { conversation_channel_status: [{ channel: "facebook_marketplace", last_heartbeat_at: ago(30), status: {} }], conversation_events: [], conversation_monitor_alerts: [] };
  const sent = [];
  const sendEmail = async (_, title) => { sent.push(title); return true; };
  await runConversationsMonitor(fakeDb(state), { now, sendEmail });
  await runConversationsMonitor(fakeDb(state), { now: new Date(now.getTime() + 600_000), sendEmail });
  const recoveredAt = new Date(now.getTime() + 660_000);
  state.conversation_channel_status[0] = { channel: "facebook_marketplace", last_heartbeat_at: recoveredAt.toISOString(), status: { monitoring: true, mode: "auto", tabReportedAt: recoveredAt.toISOString() } };
  await runConversationsMonitor(fakeDb(state), { now: recoveredAt, sendEmail });
  assert.equal(sent.filter((title) => title.startsWith("Problem")).length, 1);
  assert.equal(sent.filter((title) => title.startsWith("Recovered")).length, 0);
  assert.equal(state.conversation_monitor_alerts[0].status, "resolved");
});

test("on-demand history search includes all retained sessions, with 20 items per page", async () => {
  const sessions = Array.from({ length: 45 }, (_, i) => ({
    product_lock: "rent2buy", last_activity_at: ago(i + 1),
    conversation_history: [{ role: "user", content: i === 42 ? "Where is the purple pickup?" : `Question ${i}` },
      { role: "assistant", content: i === 42 ? "The purple pickup is being prepared." : `Reply ${i}` }],
  }));
  const store = { ai_customer_sessions: sessions, conversation_events: [
    { source_id: "facebook-1", channel: "facebook_marketplace", kind: "answered", occurred_at: ago(1), question_excerpt: "How much?", reply_excerpt: "£595 plus VAT" },
    { source_id: "TEST-monitor-x", channel: "facebook_marketplace", kind: "needs_human", occurred_at: ago(1), reason: "TEST (monitor check, not a customer)" },
  ] };
  const db = { from(name) {
    const rows = store[name] || [];
    let minDate = ""; let column = "";
    return { select() { return this; }, gte(key, date) { minDate = date; column = key; return this; },
      order() { return this; }, range(start, end) {
        return Promise.resolve({ data: rows.filter((r) => !minDate || r[column] >= minDate)
          .slice(start, end + 1), error: null });
      },
    };
  } };
  const one = await getConversationsActivity(db, { days: 7, now });
  assert.equal(one.total, 46, "all 45 Ask Me sessions and one Facebook reply; no test event");
  assert.equal(one.entries.length, 20);
  const last = await getConversationsActivity(db, { days: 7, page: 3, now });
  assert.equal(last.entries.length, 6);
  const match = await getConversationsActivity(db, { days: 7, search: "purple pickup", now });
  assert.equal(match.total, 1);
  assert.match(match.entries[0].reply_excerpt, /purple pickup/);
  const fb = await getConversationsActivity(db, { days: 7, channel: "facebook_marketplace", now });
  assert.equal(fb.total, 1);
});

test("Marketplace outstanding stays open after the hour and clears only on later recorded reply", () => {
  const event=(id,kind,minutes,product="rent2buy")=>({channel:"facebook_marketplace",source_id:"fbm:"+kind+":"+ago(minutes)+":"+id,kind,occurred_at:ago(minutes),product,conversation_ref:id.slice(-6)});
  const rows=[event("123456789","received",180),event("123456789","needs_human",175),event("223456789","received",160,"finance"),event("223456789","answered",150,"finance")];
  const pending=marketplaceOutstanding(rows);
  assert.equal(pending.length,1);
  assert.equal(marketplaceProductCounts(rows,pending).rent2buy.outstanding,1);
  assert.ok(buildMonitorIssues({events:rows,outstanding:pending,now}).some(i=>i.fingerprint==="facebook:outstanding:rent2buy"));
  assert.equal(marketplaceOutstanding([...rows,event("123456789","manual_answered",2)]).length,0);
  assert.equal(marketplaceOutstanding([...rows,event("123456789","manual_answered",200)]).length,1);
});

test("manual reply observations are not counted as AI deliveries", () => {
 const e={source_id:"fbm:manual-reply:"+ago(1)+":123456789",channel:"facebook_marketplace",kind:"answered",occurred_at:ago(1),product:"finance"};
 const counts=marketplaceProductCounts([e]);
 assert.equal(counts.finance.answered,0);
 assert.equal(counts.finance.manual_answered,1);
 assert.equal(countEvents([e]).facebook_marketplace.answered,0);
 assert.equal(buildActivityEntries([], [e])[0].kind,"manual_answered");
});
