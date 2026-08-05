import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const gate = fs.readFileSync(new URL("../components/SingleActiveTabGate.jsx", import.meta.url), "utf8");
const lock = fs.readFileSync(new URL("../utils/activeTabLock.js", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
const postingSync = fs.readFileSync(new URL("../utils/postingVisibilityStateAutoSync.js", import.meta.url), "utf8");
const intervalGuard = fs.readFileSync(new URL("../utils/overnightAutoRefreshPause.js", import.meta.url), "utf8");

test("Marketing CRM renders the application only inside the active tab gate", () => {
  assert.match(main, /<SingleActiveTabGate>/);
  assert.match(main, /<App \/>/);
  assert.match(main, /<\/SingleActiveTabGate>/);
  assert.match(gate, /Another Marketing CRM tab is active/);
  assert.match(gate, /Take over in this tab/);
});

test("tab ownership uses a heartbeat, stale recovery and cross-tab takeover", () => {
  assert.match(lock, /ACTIVE_TAB_HEARTBEAT_MS = 2000/);
  assert.match(lock, /ACTIVE_TAB_STALE_AFTER_MS = 8000/);
  assert.match(gate, /new BroadcastChannel\(ACTIVE_TAB_CHANNEL_NAME\)/);
  assert.match(gate, /claim\(true\)/);
  assert.match(gate, /window\.setTimeout\(heartbeat, ACTIVE_TAB_HEARTBEAT_MS\)/);
  assert.match(gate, /localStorage\.removeItem\(ACTIVE_TAB_LOCK_KEY\)/);
});

test("inactive tabs do not run recurring background work", () => {
  assert.match(postingSync, /isThisMarketingCrmTabActive/);
  assert.match(postingSync, /if \(!isThisMarketingCrmTabActive\(\)\) return/);
  assert.match(intervalGuard, /!isThisMarketingCrmTabActive\(\)/);
});
