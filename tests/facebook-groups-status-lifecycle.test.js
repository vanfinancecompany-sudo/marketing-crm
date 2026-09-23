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
  recoverFacebookGroupsFromSnapshot,
  saveFacebookGroups,
  startFacebookPostStatusCheck,
} from "../services/facebookGroupsAgent.js";

const backgroundSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/background.js", import.meta.url), "utf8");
const bridgeSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/crm-bridge.js", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/facebook-groups.js", import.meta.url), "utf8");

function makeRuntime() {
  const stored = new Map();
  const listeners = new Set();
  const crmMessages = [];
  const tabs = [];
  let workerHandler;
  let bridgeHandler;
  const crmWindow = {
    location: { origin: "https://marketing-crm-six.vercel.app", hostname: "marketing-crm-six.vercel.app" },
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
    workerHandler(message, { tab: { id: tabId } }, resolve);
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
      async create(options) { tabs.push({ id: 2, url: options.url }); return { id: 2 }; },
      async update(id, options) { tabs.push({ id, url: options.url }); return { id }; },
      async query() { return [{ id: 1 }]; },
      async sendMessage(id, message) { if (id === 1 && bridgeHandler) bridgeHandler(message); },
      async remove() {},
      onUpdated: { addListener() {} },
    },
    alarms: { create() {}, onAlarm: { addListener() {} } },
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

  return { crmWindow, crmMessages, stored, tabs, runFacebookPage, waitFor };
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
