import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../dev/marketplace-reply-poc/edge-live/extension/background.js", import.meta.url), "utf8");
const home = "https://www.facebook.com/marketplace/you/selling";
const key = "original-monitor";
const tagged = home + "#r2b-monitor=" + key;
const normal = { id: 1, type: "normal", focused: true };
const app = { id: 2, type: "app" };
const tab = (id, options = {}) => ({ id, windowId: normal.id, url: home, pinned: true, status: "complete", ...options });

function storage(values) {
  return {
    async get(keys) {
      return Object.fromEntries([keys].flat().filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]));
    },
    async set(updates) { Object.assign(values, structuredClone(updates)); },
    async remove(keys) { for (const key of [keys].flat()) delete values[key]; },
  };
}

function browser({ tabs = [], windows = [normal, app], session = {}, local = {}, overrides = {} } = {}) {
  const byId = new Map(tabs.map((item) => [item.id, { ...item }]));
  const byWindow = new Map(windows.map((item) => [item.id, { ...item }]));
  const settings = { instanceId: "authorized-edge", home, ...local };
  const status = {
    authorisedInstance: "authorized-edge", dedicatedProfile: true, mode: "auto",
    monitoring: { ok: true }, heartbeat: { health: "healthy", at: new Date().toISOString(), list: "marketplace" },
    assistantHome: home, extension: { expected: "0.3.27" }, ...overrides,
  };
  const changes = { created: [], windows: [], removed: [], reloads: [], updated: [] };
  const listens = {};
  const listener = (key) => ({ addListener(fn) { listens[key] = fn; } });
  function addTab(props) {
    const id = 100 + changes.created.length;
    const item = tab(id, { ...props, title: "" });
    byId.set(id, item);
    changes.created.push(id);
    return { ...item };
  }
  const context = vm.createContext({
    URL, console, crypto: { randomUUID: () => "new-monitor" },
    setTimeout: queueMicrotask,
    async fetch(url) {
      return { ok: true, async json() { return url.endsWith("/status") ? status : {}; } };
    },
    chrome: {
      storage: { local: storage(settings), session: storage(session) },
      runtime: {
        getManifest: () => ({ version: "0.3.27" }), onInstalled: listener("install"),
        onStartup: listener("startup"), onMessage: listener("message"),
      },
      tabs: {
        async query(filter) {
          return [...byId.values()].filter((item) =>
            (!filter.windowType || byWindow.get(item.windowId)?.type === filter.windowType) &&
            (filter.windowId == null || filter.windowId === item.windowId) &&
            (filter.pinned == null || filter.pinned === item.pinned)).map((item) => ({ ...item }));
        },
        async get(id) {
          if (!byId.has(id)) throw new Error("Tab missing");
          return { ...byId.get(id) };
        },
        async create(props) { return addTab(props); },
        async update(id, props) { Object.assign(byId.get(id), props); changes.updated.push(id); },
        async reload(id) { changes.reloads.push(id); },
        async remove(id) { byId.delete(id); changes.removed.push(id); },
        async sendMessage(id, message) {
          if (message.type === "marker") return { marked: Boolean(byId.get(id)?.legacyMarker) };
        },
        onCreated: listener("created"), onUpdated: listener("updated"),
        onRemoved: listener("removed"), onReplaced: listener("replaced"),
      },
      windows: {
        async get(id) { return { ...byWindow.get(id) }; },
        async getAll({ windowTypes }) { return [...byWindow.values()].filter((win) => windowTypes.includes(win.type)); },
        async create(props) {
          const win = { id: 10, type: props.type };
          byWindow.set(win.id, win);
          changes.windows.push(win.id);
          return { ...win, tabs: [addTab({ windowId: win.id, url: props.url, pinned: false })] };
        },
        onCreated: listener("window"),
      },
      alarms: { create() {}, onAlarm: listener("alarm") },
      commands: { onCommand: listener("command") },
      action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    },
  });
  vm.runInContext(source + "\nthis.run = supervise;", context);
  return { run: context.run, listens, changes, session, settings, byId };
}

test("overlapping startup, alarm and requests share a single monitoring-tab creation", async () => {
  const edge = browser({ tabs: [tab(5), tab(8, { windowId: app.id })] });
  edge.listens.startup();
  edge.listens.alarm({ name: "supervise" });
  const first = edge.run();
  assert.equal(first, edge.run());
  await first;
  await edge.run();
  assert.deepEqual(edge.changes.created, [100]);
  assert.equal(edge.session.tabId, 100);
  assert.equal(edge.byId.get(100).windowId, normal.id);
  assert.match(edge.byId.get(100).url, /#r2b-monitor=new-monitor$/);
  assert.deepEqual(edge.changes.removed, []);
});

test("restart reuses a tagged discarded monitor, even before the page script can answer", async () => {
  const edge = browser({
    local: { monitorTabKey: key },
    tabs: [tab(40, { url: tagged, discarded: true }), tab(41), tab(42, { url: tagged, windowId: app.id })],
  });
  await edge.run();
  assert.equal(edge.session.tabId, 40);
  assert.deepEqual(edge.changes.created, []);
  assert.deepEqual(edge.changes.reloads, [40]);
  assert.deepEqual(edge.changes.removed, []);
});

test("cleanup closes only recorded assistant duplicates in normal windows", async () => {
  const elsewhere = "https://www.facebook.com/";
  const edge = browser({
    local: { monitorTabKey: key },
    session: { tabId: 1, createdMonitorTabIds: [1, 2, 3, 6, 7, 8], replyTabId: 6, replyTabAt: Date.now() },
    tabs: [
      tab(1, { url: tagged }), tab(2, { url: tagged }), tab(3, { windowId: app.id }),
      tab(4), tab(5, { url: tagged, legacyMarker: true }), tab(6), tab(7, { url: elsewhere }),
      tab(8, { pendingUrl: elsewhere }),
    ],
  });
  await edge.run();
  assert.deepEqual(edge.changes.removed, [2]);
  assert.ok(edge.changes.updated.every((id) => id === 1));
  assert.equal(edge.session.tabId, 1);
  assert.deepEqual(edge.session.createdMonitorTabIds, [1, 6, 7, 8]);
  assert.equal(edge.byId.size, 7);
});

test("a closed monitor is not replaced by a manual copy of its URL in the same session", async () => {
  const edge = browser({
    local: { monitorTabKey: key },
    session: { tabId: 11, createdMonitorTabIds: [11] },
    tabs: [tab(12, { url: tagged, legacyMarker: true })],
  });
  await edge.run();
  assert.equal(edge.session.tabId, 100);
  assert.match(edge.byId.get(100).url, /#r2b-monitor=new-monitor$/);
  assert.deepEqual(edge.changes.removed, []);
  assert.ok(!edge.changes.updated.includes(12));
});

test("an app-only session gets one normal monitoring window and leaves the app alone", async () => {
  const edge = browser({ tabs: [tab(8, { windowId: app.id })], windows: [app] });
  await edge.run();
  assert.deepEqual(edge.changes.windows, [10]);
  assert.equal(edge.session.tabId, 100);
  assert.equal(edge.byId.get(100).windowId, 10);
  assert.equal(edge.byId.get(100).pinned, true);
  assert.deepEqual(edge.changes.removed, []);
  assert.ok(!edge.changes.updated.includes(8));
});

test("the installed update reuses its marked legacy tab, then records the restore marker", async () => {
  const edge = browser({
    local: { reloadTabAfterUpdate: 9, lastSelfUpdate: { at: Date.now(), version: "0.3.27" } },
    tabs: [tab(9, { title: "[Assistant] Facebook" })],
  });
  await edge.run();
  assert.equal(edge.session.tabId, 9);
  assert.match(edge.byId.get(9).url, /#r2b-monitor=new-monitor$/);
  assert.deepEqual(edge.changes.reloads, [9]);
  assert.deepEqual(edge.changes.created, []);
});

test("another Edge profile does not create or close a tab", async () => {
  const edge = browser({
    overrides: { authorisedInstance: "another-instance" },
    session: { tabId: 1, createdMonitorTabIds: [1, 2] },
    tabs: [tab(1), tab(2)],
  });
  await edge.run();
  assert.deepEqual(edge.changes.created, []);
  assert.deepEqual(edge.changes.removed, []);
  assert.deepEqual(edge.changes.updated, []);
});
