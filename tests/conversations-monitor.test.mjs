import test from "node:test";
import assert from "node:assert/strict";
import { redactExcerpt, normaliseReport, buildMonitorIssues, summariseAskMeSessions, countEvents } from "../lib/conversationsMonitor.js";
import { handleConversationsReport } from "../api/conversations-report.js";
import { runConversationsMonitor } from "../api/conversations-monitor.js";

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
      const q = {
        _filters: [], select() { return q; }, gte() { return q; }, order() { return q; }, limit() { return q; },
        eq(k, v) { q._filters.push([k, v]); return q; },
        maybeSingle: async () => ({ data: rows.find((r) => q._filters.every(([k, v]) => r[k] === v)) || null, error: null }),
        then(resolve) { resolve({ data: rows.filter((r) => q._filters.every(([k, v]) => r[k] === v)), error: null }); },
        upsert: async (row, opts) => { const list = Array.isArray(row) ? row : [row]; for (const r of list) { const key = opts?.onConflict; const i = rows.findIndex((x) => x[key] === r[key]); if (i >= 0) { if (!opts.ignoreDuplicates) rows[i] = { ...rows[i], ...r }; } else rows.push({ ...r }); } return { error: null }; },
        update: (patch) => ({ eq: async (k, v) => { rows.filter((r) => r[k] === v).forEach((r) => Object.assign(r, patch)); return { error: null }; } }),
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
  assert.equal(sent.filter((s) => s.startsWith("Recovered")).length, 1, "recovery emailed once");
  assert.equal(state.conversation_monitor_alerts[0].status, "resolved");
});
