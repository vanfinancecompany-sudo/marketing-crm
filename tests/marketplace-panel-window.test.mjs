import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../dev/marketplace-reply-poc/edge-live/service.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function permitPanelOpener(");
const end = source.indexOf("\nconst MONITOR_ROUTES", start);
const opener = source.slice(start, end);

function harness() {
  const state = {
    mode: "auto", authorisedInstance: "locked-profile", dedicatedInstance: "locked-profile",
    tabCensus: { assistantTabId: 17 }, heartbeat: { at: new Date().toISOString(), list: "none" },
  };
  const calls = [];
  const context = vm.createContext({
    state, panelWindow: null, panelWindowHelper: "helper.exe", Date,
    accountProblem: () => null,
    permitOpenerClick: () => ({ ok: true }),
    async openPanelWindow(_binary, id) { calls.push(id); return true; },
  });
  vm.runInContext(opener + "\nthis.permit = permitPanelOpener;", context);
  return { state, calls, permit: (data) => context.permit({ monitorTabId: 17, minimized: true, ...data }) };
}

test("a minimized recovery can advance from confirmed Chats to Marketplace once", async () => {
  const x = harness();
  assert.equal((await x.permit({ stage: "messenger" })).recoveryWindow, true);
  assert.equal((await x.permit({ stage: "marketplace" })).ok, false);
  x.state.heartbeat = { list: "chats", at: new Date().toISOString() };
  assert.equal((await x.permit({ stage: "marketplace" })).recoveryWindow, true);
  assert.equal((await x.permit({ stage: "marketplace" })).ok, false);
  assert.deepEqual(x.calls, [17]);
});

test("a real safety stop and other browser tabs cannot launch the helper", async () => {
  const x = harness();
  assert.equal((await x.permit({ monitorTabId: 18, stage: "messenger" })).recoveryWindow, undefined);
  x.state.openerTrip = { reason: "A conversation opened" };
  assert.equal((await x.permit({ stage: "messenger" })).ok, false);
  assert.deepEqual(x.calls, []);
});
