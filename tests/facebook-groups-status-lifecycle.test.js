import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

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
  const requests = [];
  const responses = new Map();
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
    alarms: { create() {}, async get() { return { scheduledTime: Date.now() + 60000 }; }, onAlarm: { addListener(listener) { alarmHandler = listener; } } },
    action: { async setBadgeText() {}, async setTitle() {} },
  };
  const worker = vm.runInNewContext(backgroundSource + "\n;({ wait: () => renewalTick })", {
    chrome: chromeWorker, URL, Date, console, setTimeout, AbortSignal, TextEncoder, crypto: webcrypto,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body, auth: init.headers.Authorization });
      const reply = responses.get(body.action)?.shift() || { ok: true };
      return { status: reply.httpStatus || 200, json: async () => reply };
    },
  }, { filename: "background.js" });
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

  return { crmWindow, crmMessages, stored, tabs, deliveries, sendToWorker, runFacebookPage, waitFor, requests, responses,
    wakeRenewals: async () => {
      alarmHandler({ name: "vfcRent2BuyGroupRenewalAlarm" });
      await worker.wait();
    } };
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

async function pairWorker(runtime, enabled = true) {
  const pairing = await runtime.sendToWorker({ type: "GET_GROUP_RENEWAL_PAIRING" }, 1);
  assert.match(pairing.hash, /^[a-f0-9]{64}$/);
  assert.equal(pairing.token, undefined);
  return runtime.sendToWorker({ type: "SET_GROUP_RENEWAL_AUTOMATION", enabled, usedVehicleIds: ["earlier-stock"] }, 1);
}

test("background renewal owns the Post grant and records restrictions without a CRM tab", async () => {
  const runtime = makeRuntime();
  const [group] = loadFacebookGroups().slice(2, 3);
  const job = { id: "one-automatic-renewal", groupUrl: group.url, groupName: group.name, productKey: "rent2buy",
    registration: "AB12CDE", vehicleId: "stock-42", imageUrl: "https://static.wixstatic.com/media/stock.jpg",
    caption: "REGISTRATION: AB12CDE", renewal: { date: "2026-11-25", automatic: true } };
  const send = (type, result) => runtime.sendToWorker({ type, jobId: job.id, result }, 2);
  await runtime.wakeRenewals();
  assert.equal(runtime.tabs.length, 0);
  assert.equal((await pairWorker(runtime)).automatic, true);
  const direct = await runtime.sendToWorker({ type: "STORE_GROUP_POST_JOB", job }, 1);
  assert.equal(direct.ok, false, "a CRM page cannot start an automatic job");
  runtime.responses.set("worker-next", [{ ok: true, job }]);
  await runtime.wakeRenewals();
  assert.equal(runtime.tabs.find(tab => tab.created).active, false);
  assert.equal(runtime.tabs.at(-1).url, job.groupUrl);
  assert.equal(runtime.deliveries.some(item => item.type === "GROUP_RENEWAL_WAKE"), false);
  assert.deepEqual(runtime.requests.find(item => item.body.action === "worker-next").body.usedVehicleIds, ["earlier-stock"]);
  assert.equal((await send("GROUP_RENEWAL_READY")).ok, true);
  assert.equal((await send("GROUP_RENEWAL_OUTCOME", { status: "submitted", approvalState: "pending" })).ok, false);
  runtime.responses.set("worker-reserve", [{ ok: true, reservedAt: new Date().toISOString() }]);
  const grants = await Promise.all([send("BEGIN_GROUP_RENEWAL_SUBMISSION"), send("BEGIN_GROUP_RENEWAL_SUBMISSION")]);
  assert.equal(grants.filter(grant => grant.ok).length, 1);
  assert.equal(runtime.requests.filter(item => item.body.action === "worker-reserve").length, 1);
  await send("GROUP_RENEWAL_OUTCOME", { status: "stop", reason: "Security challenge" });
  assert.equal((await runtime.sendToWorker({ type: "GET_GROUP_RENEWAL_STATE" }, 1)).automatic, false);
  await runtime.wakeRenewals();
  const stop = runtime.requests.find(item => item.body.action === "worker-result");
  assert.equal(stop.body.status, "stop");
  assert.equal(stop.body.duplicateRisk, true);
  assert.match(stop.auth, /^Bearer r2b-worker-/);
  assert.equal(runtime.stored.get("vfcRent2BuyGroupRenewal").result, null);
});

test("the background worker only sends approval receipts for its own CRM origin", async () => {
  const runtime = makeRuntime();
  assert.equal((await pairWorker(runtime)).ok, true);
  const production = { id: "own", crmOrigin: runtime.crmWindow.location.origin, accepted: true, groupUrl: "https://www.facebook.com/groups/example/" };
  const preview = { id: "other", crmOrigin: "https://preview.example", accepted: true };
  runtime.stored.set("vfcRent2BuyRenewalApprovals", [production, preview]);
  runtime.responses.set("worker-approval", [{ ok: false }, { ok: true }]);
  await runtime.wakeRenewals();
  assert.equal(runtime.stored.get("vfcRent2BuyRenewalApprovals").length, 2, "failed delivery is retained");
  await runtime.wakeRenewals();
  assert.equal(runtime.requests.filter(item => item.body.action === "worker-approval").length, 2);
  assert.deepEqual(Array.from(runtime.stored.get("vfcRent2BuyRenewalApprovals"), entry => entry.id), ["other"]);
});

test("a historical renewal check uses a read-only tab and durably sends the exact approval result", async () => {
  const runtime = makeRuntime();
  const groupUrl = "https://www.facebook.com/groups/example/";
  const identity = "attempt|2026-11-26|renewal-id|BW72VFG|2026-11-26T07:01:00Z";
  await pairWorker(runtime);
  const review = { url: groupUrl, name: "Group", registration: "BW72VFG", postedAt: "2026-11-26T07:01:00Z", reviewKind: "attempt", identity };
  runtime.responses.set("worker-next", [{ ok: true, review }]);
  await runtime.wakeRenewals();
  assert.equal(runtime.tabs.at(-1).url, groupUrl + "search/?q=BW72VFG");
  assert.equal(runtime.stored.get("vfcRent2BuyGroupRenewal").pending, undefined);
  const active = runtime.stored.get("vfcFacebookGroupsAgentState");
  const checkedAt = new Date().toISOString();
  assert.equal((await runtime.sendToWorker({ type: "GROUP_POST_STATUS_PAGE_RESULT", jobId: active.job.id, groupIndex: 0,
    result: { url: groupUrl, registration: "BW72VFG", pending: true, matchedUrl: groupUrl + "posts/85/", checkedAt,
      observedAt: review.postedAt } }, 2)).ok, true);
  await runtime.wakeRenewals();
  const saved = runtime.requests.find(item => item.body.action === "worker-approval").body;
  assert.equal(saved.target, identity);
  assert.equal(saved.result, "pending");
  assert.equal(saved.checkedAt, checkedAt);
  assert.equal(runtime.stored.get("vfcRent2BuyRenewalApprovals").length, 0);
});

test("pairing is limited to the production Rent2Buy Groups origin", async () => {
  for (const origin of ["https://marketing-crm-lookalike.vercel.app", "https://marketing-crm-git-codex-rent2buy-8e370c-stuart-westons-projects.vercel.app"]) {
    const runtime = makeRuntime(origin);
    assert.equal((await runtime.sendToWorker({ type: "GET_GROUP_RENEWAL_PAIRING" }, 1)).ok, false);
    assert.equal((await runtime.sendToWorker({ type: "SET_GROUP_RENEWAL_AUTOMATION", enabled: true }, 1)).ok, false);
    assert.equal(runtime.requests.length, 0);
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
