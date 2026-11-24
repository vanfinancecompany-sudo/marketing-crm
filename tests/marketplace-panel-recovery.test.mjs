import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../dev/marketplace-reply-poc/edge-live/extension/background.js", import.meta.url), "utf8");
const start = script.indexOf("const PANEL_MISSING_GRACE_MS");
const end = script.indexOf("// ---- Visibility assist", start);
assert.ok(start > 0 && end > start, "safe panel recovery should be present");

function harness() {
  const clock = { now: Date.parse("2026-11-24T18:00:00Z") };
  const saved = {};
  const reloads = [];
  const events = [];
  class Clock extends Date {
    static now() { return clock.now; }
  }
  const context = vm.createContext({
    Date: Clock,
    STALE_HEARTBEAT_MS: 180_000,
    chrome: {
      storage: { local: {
        async get(keys) { return Object.fromEntries(keys.map(k => [k, saved[k]])); },
        async set(values) { Object.assign(saved, values); },
        async remove(key) { delete saved[key]; },
      } },
      tabs: { async reload(id) { reloads.push(id); } },
    },
    tabEvent(kind, body) { events.push({ kind, body }); },
  });
  vm.runInContext(script.slice(start, end) + "\nthis.recoverPanel = recoverMissingMessengerPanel;", context);
  const status = {
    dedicatedProfile: true, mode: "auto", monitoring: { ok: false },
    account: { signedIn: "623694159", authorised: "623694159", problem: null },
    safetyStop: null, openerHold: null,
  };
  const tab = { id: 12, url: "https://www.facebook.com/marketplace/you/selling" };
  const hb = () => ({ health: "healthy", list: "none", at: new Date(clock.now).toISOString() });
  return { clock, saved, reloads, events, status, tab, hb,
    recover: (s = status, t = tab, h = hb()) => context.recoverPanel(t, s, h) };
}

test("healthy dedicated profile with missing Messenger panel gets one gentle reload after five minutes", async () => {
  const x = harness();
  await x.recover();
  assert.equal(x.reloads.length, 0);
  x.clock.now += 5 * 60_000 + 1;
  await x.recover();
  assert.deepEqual(x.reloads, [12]);
  assert.equal(x.events.at(-1).kind, "assistant-panel-auto-reload");
  x.clock.now += 1_000;
  await x.recover();
  assert.equal(x.reloads.length, 1, "never rapid-loop");
});

test("wrong account, safety stop, untrusted profile, or an unhealthy page never triggers recovery", async () => {
  for (const change of [
    (x) => { x.status.account.signedIn = "someone-else"; },
    (x) => { x.status.safetyStop = { reason: "Safety" }; },
    (x) => { x.status.dedicatedProfile = false; },
    (x) => { x.status.mode = "off"; },
  ]) {
    const x = harness(); change(x);
    await x.recover();
    x.clock.now += 30 * 60_000;
    await x.recover();
    assert.equal(x.reloads.length, 0);
  }
  const x = harness();
  await x.recover(x.status, x.tab, { ...x.hb(), health: "signed-out" });
  x.clock.now += 30 * 60_000;
  await x.recover(x.status, x.tab, { ...x.hb(), health: "signed-out" });
  assert.equal(x.reloads.length, 0);
});

test("recovered Marketplace list clears the grace period and caps retries at three per hour", async () => {
  const x = harness();
  await x.recover();
  for (let attempt = 1; attempt <= 3; attempt++) {
    x.clock.now += 11 * 60_000;
    await x.recover();
    assert.equal(x.reloads.length, attempt);
  }
  x.clock.now += 11 * 60_000;
  await x.recover();
  assert.equal(x.reloads.length, 3, "fourth reload blocked");
  await x.recover(x.status, x.tab, { ...x.hb(), list: "marketplace" });
  assert.equal(x.saved.panelMissingSince, undefined);
  x.clock.now += 60_000;
  await x.recover();
  assert.equal(x.reloads.length, 3, "new outage has new grace period");
});
