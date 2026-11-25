import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  GROUP_POST_STATUS_COMPLETE,
  GROUP_POST_STATUS_PROGRESS,
  groupPipeline,
  loadFacebookGroups,
  markGroupPostStatus,
  markGroupPosted,
  mergeFacebookGroupsByRecentPostState,
  prepareFacebookGroupPost,
  requestGroupRenewalHelper,
  recoverFacebookGroupsFromSnapshot,
  saveFacebookGroups,
  startFacebookPostStatusCheck,
} from "../services/facebookGroupsAgent.js";

const backgroundSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/background.js", import.meta.url), "utf8");
const bridgeSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/crm-bridge.js", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/facebook-groups.js", import.meta.url), "utf8");

function makeRuntime(origin = "https://marketing-crm-six.vercel.app") {
  const stored = new Map();
  const listeners = new Set();
  const crmMessages = [];
  const tabs = [];
  let workerHandler;
  let bridgeHandler;
  let alarmHandler;
  const deliveries = [];
  const crmWindow = {
    location: { origin, hostname: new URL(origin).hostname },
    localStorage: {
      getItem: (key) => stored.get(`local:${key}`) ?? null,
      setItem: (key, value) => stored.set(`local:${key}`, value),
    },
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); },
    postMessage(data) {
      crmMessages.push(data);
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener({ source: crmWindow, origin: crmWindow.location.origin, data });
      });
    },
  };
  const storage = {
    async get(keys) {
      const result = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = stored.get(key);
      return result;
    },
    async set(values) { for (const [key, value] of Object.entries(values)) stored.set(key, value); },
    async remove(key) { stored.delete(key); },
  };
  const sendToWorker = (message, tabId) => new Promise((resolve) => {
    const url = tabId === 1 ? crmWindow.location.origin + "/rent2buy-groups" : tabs.findLast((tab) => tab.id === tabId)?.url;
    workerHandler(message, { tab: { id: tabId }, url }, resolve);
  });
  const chromeWorker = {
    storage: { local: storage },
    runtime: {
      onMessage: { addListener(listener) { workerHandler = listener; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getManifest: () => ({ version: "1.2.19" }),
    },
    tabs: {
      async get(id) { return { ...tabs.findLast((tab) => tab.id === id), status: "complete" }; },
      async create(options) { tabs.push({ id: 2, url: options.url, created: true, active: options.active }); return { id: 2 }; },
      async update(id, options) { tabs.push({ id, url: options.url }); return { id }; },
      async query() { return [{ id: 1 }]; },
      async sendMessage(id, message) { deliveries.push({ id, type: message.type }); if (id === 1 && bridgeHandler) bridgeHandler(message); },
      async remove() {},
      onUpdated: { addListener() {} },
    },
    alarms: { create() {}, onAlarm: { addListener(listener) { alarmHandler = listener; } } },
    action: { async setBadgeText() {}, async setTitle() {} },
  };
  vm.runInNewContext(backgroundSource, { chrome: chromeWorker, URL, Date, console, setTimeout }, { filename: "background.js" });
  const chromeBridge = {
    runtime: {
      onMessage: { addListener(listener) { bridgeHandler = listener; } },
      sendMessage: (message) => sendToWorker(message, 1),
      getManifest: () => ({ version: "1.2.19" }),
    },
  };
  vm.runInNewContext(bridgeSource, { window: crmWindow, chrome: chromeBridge, console }, { filename: "crm-bridge.js" });

  function runFacebookPage({ text, registration, card = false }) {
    const cardNode = {
      innerText: text,
      getBoundingClientRect: () => ({ width: 500, height: 240 }),
      querySelector: (selector) => card && selector.includes("img") ? { tagName: "IMG" } : null,
      querySelectorAll: () => [],
    };
    const document = {
      body: { innerText: `Search results for ${registration}\n${text}` },
      getElementById: () => null,
      querySelectorAll(selector) {
        if (selector.includes('[role="article"]')) return [cardNode];
        return [];
      },
    };
    class FastDate extends Date {
      static now() { FastDate.tick += 1000; return FastDate.tick; }
    }
    FastDate.tick = 0;
    const pageWindow = { setTimeout: (callback) => { queueMicrotask(callback); return 1; } };
    const sandbox = {
      window: pageWindow,
      chrome: { runtime: { sendMessage: (message) => sendToWorker(message, 2) } },
      document,
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      location: { href: tabs.at(-1).url, origin: "https://www.facebook.com", pathname: new URL(tabs.at(-1).url).pathname },
      URL,
      Date: FastDate,
      console,
      setTimeout: pageWindow.setTimeout,
    };
    pageWindow.window = pageWindow;
    vm.runInNewContext(pageSource, sandbox, { filename: "facebook-groups.js" });
  }

  async function waitFor(predicate) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail("Expected extension message was not delivered");
  }

  return { crmWindow, crmMessages, stored, tabs, deliveries, sendToWorker, runFacebookPage, waitFor,
    wakeRenewals: () => alarmHandler({ name: "vfcRent2BuyGroupRenewalAlarm" }) };
}

test("stored worker results recover after CRM delivery fails, without replaying onto a newer advert", () => {
  const base = loadFacebookGroups()[2];
  const awaiting = markGroupPosted([base], base.url, {
    registration: "AB12 CDE",
    postedAt: "2026-09-21T10:00:00.000Z",
  });
  const result = {
    url: `${base.url}search/?q=AB12+CDE`,
    registration: "AB12CDE",
    accepted: true,
    matchMethod: "visible-result-card",
    checkedAt: "2026-09-21T11:00:00.000Z",
  };
  const recovered = recoverFacebookGroupsFromSnapshot(awaiting, {
    lastStatusBatch: { results: [result] },
  });
  assert.equal(recovered[0].postStatus, "accepted");
  assert.equal(groupPipeline(recovered[0]), "proven");
  assert.equal(recoverFacebookGroupsFromSnapshot(recovered, { lastStatusBatch: { results: [result] } })[0].acceptedPostCount, 1);

  const newer = markGroupPosted(recovered, base.url, {
    registration: "XY34 ZTT",
    postedAt: "2026-09-22T10:00:00.000Z",
  });
  assert.equal(recoverFacebookGroupsFromSnapshot(newer, { lastStatusBatch: { results: [result] } })[0].postStatus, "awaiting");
  const staleRemote = mergeFacebookGroupsByRecentPostState(newer, awaiting);
  assert.equal(staleRemote[0].pendingRegistration, "XY34 ZTT");
  assert.equal(staleRemote[0].postStatus, "awaiting");
});

test("renewal recovery keeps one tab and preserves a receipt until the CRM acknowledges it", async () => {
  const previousWindow = globalThis.window;
  const runtime = makeRuntime();
  globalThis.window = runtime.crmWindow;
  try {
    const [first, second] = loadFacebookGroups().slice(2, 4);
    const vehicle = { id: "stock-42", registration: "AB12CDE", imageUrl: "https://static.wixstatic.com/media/stock.jpg" };
    const start = (group, jobId) => prepareFacebookGroupPost({ group, vehicle, productKey: "rent2buy",
      caption: "REGISTRATION: AB12CDE", renewal: { date: "2026-11-25", jobId } });
    const state = () => requestGroupRenewalHelper("GET_GROUP_RENEWAL_STATE");
    const send = (type, jobId, result, tabId = 2) => runtime.sendToWorker({ type, jobId, result }, tabId);
    await start(first, "first-renewal");
    assert.equal((await state()).pending.prepared, false);
    assert.equal((await send("GROUP_RENEWAL_READY", "first-renewal", undefined, 1)).ok, false);
    assert.equal((await send("GROUP_RENEWAL_READY", "first-renewal")).ok, true);
    assert.equal((await state()).pending.prepared, true);
    const result = { status: "submitted", approvalState: "pending" };
    assert.equal((await send("GROUP_RENEWAL_OUTCOME", "first-renewal", result)).ok, true);
    assert.equal((await state()).result.approvalState, "pending");
    await assert.rejects(start(second, "second-renewal"), /previous renewal/);
    assert.equal((await state()).result.jobId, "first-renewal");
    await requestGroupRenewalHelper("ACK_GROUP_RENEWAL_RESULT", "first-renewal");
    await start(second, "second-renewal");
    assert.equal((await state()).pending.id, "second-renewal");
    assert.equal(runtime.tabs.filter((tab) => tab.created).length, 1);
    assert.equal(runtime.tabs.find((tab) => tab.created).active, false);
    assert.equal(runtime.tabs.at(-1).id, 2);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("automatic renewal is opt-in, claims the Post action once and disarms on a restriction", async () => {
  const previousWindow = globalThis.window;
  const runtime = makeRuntime();
  globalThis.window = runtime.crmWindow;
  try {
    const [group] = loadFacebookGroups().slice(2, 3);
    const jobId = "one-automatic-renewal";
    const vehicle = { id: "stock-42", registration: "AB12CDE", imageUrl: "https://static.wixstatic.com/media/stock.jpg" };
    const start = () => prepareFacebookGroupPost({ group, vehicle, productKey: "rent2buy", caption: "REGISTRATION: AB12CDE",
      renewal: { date: "2026-11-25", jobId, automatic: true } });
    const send = (type, result) => runtime.sendToWorker({ type, jobId, result }, 2);
    await assert.rejects(start(), /disabled/);
    await requestGroupRenewalHelper("SET_GROUP_RENEWAL_AUTOMATION", undefined, { enabled: true });
    await start();
    assert.equal((await send("GROUP_RENEWAL_READY")).ok, true);
    assert.equal((await send("GROUP_RENEWAL_OUTCOME", { status: "submitted", approvalState: "pending" })).ok, false);
    const grants = await Promise.all([send("BEGIN_GROUP_RENEWAL_SUBMISSION"), send("BEGIN_GROUP_RENEWAL_SUBMISSION")]);
    assert.equal(grants.filter((grant) => grant.ok).length, 1);
    await send("GROUP_RENEWAL_OUTCOME", { status: "stop", reason: "Security challenge" });
    const stopped = await requestGroupRenewalHelper("GET_GROUP_RENEWAL_STATE");
    assert.equal(stopped.automatic, false);
    assert.equal(stopped.result.status, "stop");
    assert.equal(stopped.result.automatic, true);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("the alarm reopens the configured renewal driver in the background and reuses it", async () => {
  const previousWindow = globalThis.window;
  const runtime = makeRuntime();
  globalThis.window = runtime.crmWindow;
  try {
    await requestGroupRenewalHelper("SET_GROUP_RENEWAL_AUTOMATION", undefined, { enabled: true });
    runtime.wakeRenewals();
    const countWakes = () => runtime.deliveries.filter((item) => item.type === "GROUP_RENEWAL_WAKE").length;
    await runtime.waitFor(() => countWakes() === 1);
    assert.equal(runtime.tabs[0].url, runtime.crmWindow.location.origin + "/rent2buy-groups");
    assert.equal(runtime.tabs[0].active, false);
    runtime.wakeRenewals();
    await runtime.waitFor(() => countWakes() === 2);
    assert.equal(runtime.tabs.filter((tab) => tab.created).length, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("the renewal driver only reads and acknowledges approval receipts for its CRM origin", async () => {
  const previousWindow = globalThis.window;
  const runtime = makeRuntime();
  globalThis.window = runtime.crmWindow;
  try {
    await requestGroupRenewalHelper("SET_GROUP_RENEWAL_AUTOMATION", undefined, { enabled: true });
    const production = { id: "own", crmOrigin: runtime.crmWindow.location.origin, accepted: true };
    const preview = { id: "other", crmOrigin: "https://preview.example", accepted: true };
    runtime.stored.set("vfcRent2BuyRenewalApprovals", [production, preview]);
    const get = () => requestGroupRenewalHelper("GET_GROUP_RENEWAL_STATE");
    assert.deepEqual(Array.from((await get()).approvalReceipts, (entry) => entry.id), ["own"]);
    await requestGroupRenewalHelper("ACK_GROUP_RENEWAL_APPROVAL", "other");
    await requestGroupRenewalHelper("ACK_GROUP_RENEWAL_APPROVAL", "own");
    assert.equal((await get()).approvalReceipts.length, 0);
    assert.deepEqual(Array.from(runtime.stored.get("vfcRent2BuyRenewalApprovals"), (entry) => entry.id), ["other"]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("automatic posting rejects a lookalike CRM origin and allows the verified branch alias", async () => {
  const previousWindow = globalThis.window;
  const enable = () => requestGroupRenewalHelper("SET_GROUP_RENEWAL_AUTOMATION", undefined, { enabled: true });
  try {
    globalThis.window = makeRuntime("https://marketing-crm-lookalike.vercel.app").crmWindow;
    await assert.rejects(enable(), /approved Marketing CRM address/);
    globalThis.window = makeRuntime("https://marketing-crm-git-codex-rent2buy-8e370c-stuart-westons-projects.vercel.app").crmWindow;
    assert.equal((await enable()).automatic, true);
  } finally {
    globalThis.window = previousWindow;
  }
});

for (const productKey of ["rent2buy", "finance"]) {
  test(`${productKey} status check delivers each Facebook result through worker and bridge to persisted Proven/Hot`, async () => {
    const previousWindow = globalThis.window;
    const runtime = makeRuntime();
    globalThis.window = runtime.crmWindow;
    try {
      let groups = loadFacebookGroups().slice(2, 5).map((group, index) => markGroupPosted([group], group.url, {
        registration: ["AB12 CDE", "XY34 ZTT", "LM56 NOP"][index],
        postedAt: "2026-09-21T10:00:00.000Z",
      })[0]);
      const excludedBase = productKey === "rent2buy"
        ? loadFacebookGroups()[0]
        : { ...loadFacebookGroups()[2], id: "rent-only", url: "https://www.facebook.com/groups/southampton-rent-only/", finance: false, rent2buy: true };
      groups.push(markGroupPosted([excludedBase], excludedBase.url, {
        registration: "ZZ99 ZZZ",
        postedAt: "2026-09-20T10:00:00.000Z",
      })[0]);
      saveFacebookGroups(groups);
      runtime.crmWindow.addEventListener("message", (event) => {
        const payload = event.data;
        if (payload.source !== "vfc-facebook-helper" || ![GROUP_POST_STATUS_PROGRESS, GROUP_POST_STATUS_COMPLETE].includes(payload.type)) return;
        if (payload.productKey !== productKey) return;
        const results = payload.type === GROUP_POST_STATUS_PROGRESS ? [payload.result] : payload.results;
        groups = results.reduce((current, result) => markGroupPostStatus(current, result), groups);
        saveFacebookGroups(groups);
      });

      await startFacebookPostStatusCheck(groups, productKey, 3);
      assert.equal(runtime.tabs.length, 1);
      const job = runtime.stored.get("vfcFacebookGroupsAgentState").job;
      assert.equal(job.groups.length, 3);
      assert.equal(job.groups.some((group) => group.url === excludedBase.url), false);
      runtime.runFacebookPage({
        registration: "AB12 CDE",
        text: "Rent2Buy advert\nREGISTRATION: AB12 CDE\nRent it, drive it, own it",
        card: true,
      });
      await runtime.waitFor(() => runtime.crmMessages.some((item) => item.type === GROUP_POST_STATUS_PROGRESS));
      assert.equal(groups[0].postStatus, "accepted");
      assert.equal(groupPipeline(groups[0]), "proven");
      assert.equal(groups[0].lastPostMatchMethod, "visible-result-card");
      assert.equal(runtime.crmMessages.some((item) => item.type === GROUP_POST_STATUS_COMPLETE), false);

      runtime.runFacebookPage({ registration: "XY34 ZTT", text: "Search results for XY34 ZTT\nPending approval", card: true });
      await runtime.waitFor(() => groups[1].postStatus === "pending");
      runtime.runFacebookPage({ registration: "LM56 NOP", text: "Your post was declined by an admin", card: false });
      await runtime.waitFor(() => runtime.crmMessages.some((item) => item.type === GROUP_POST_STATUS_COMPLETE));

      const persisted = loadFacebookGroups();
      const checked = groups.map((group) => persisted.find((item) => item.url === group.url));
      assert.deepEqual(checked.map((group) => group.postStatus), ["accepted", "pending", "declined", "awaiting"]);
      assert.equal(groupPipeline(checked[0]), "proven");
      assert.equal(groupPipeline(checked[1]), "testing");
      assert.equal(groupPipeline(checked[2]), "archived");
      assert.equal(checked[0].acceptedPostCount, 1);
      assert.equal(checked[3].postStatus, "awaiting");
      assert.equal(runtime.crmMessages.filter((item) => item.type === GROUP_POST_STATUS_PROGRESS).length, 3);
      assert.equal(runtime.crmMessages.find((item) => item.type === GROUP_POST_STATUS_COMPLETE).results.length, 3);
    } finally {
      globalThis.window = previousWindow;
    }
  });
}
