const PENDING_JOB_KEY = "vfcPendingMarketplaceJob";
const LAST_RECEIPT_KEY = "vfcLastMarketplaceReceipt";
const MARKETPLACE_LISTING_REGISTRY_KEY = "vfcMarketplaceListingRegistryV1";
const MARKETPLACE_STOCK_SNAPSHOTS_KEY = "vfcMarketplaceStockSnapshotsV1";
const PUBLISH_CONFIRM_WINDOW_MS = 10 * 60 * 1000;
const GROUP_AGENT_STATE_KEY = "vfcFacebookGroupsAgentState";
const GROUP_POST_JOB_KEY = "vfcPendingFacebookGroupPost";
const RENEWAL_STATE_KEY = "vfcRent2BuyGroupRenewal";
const RENEWAL_APPROVAL_RECEIPTS_KEY = "vfcRent2BuyRenewalApprovals";
const APPROVAL_HEALTH_KEY = "vfcFacebookGroupApprovalHealth";
const RENEWAL_HEARTBEAT_KEY = "vfcRent2BuyRenewalHeartbeat";
const RENEWAL_CREDENTIAL_KEY = "vfcRent2BuyBackgroundCredential";
const RENEWAL_ALARM = "vfcRent2BuyGroupRenewalAlarm";
const RENEWAL_WORK_ALARM = "vfcRent2BuyGroupRenewalWork";
const RENEWAL_POST_INTERVAL_MS = 60_000;
const RENEWAL_PRODUCTION_ORIGIN = "https://marketing-crm-six.vercel.app";
const RENEWAL_CRM_ORIGINS = new Set([
  "https://marketing-crm-six.vercel.app",
  "https://marketing-crm-git-codex-rent2buy-8e370c-stuart-westons-projects.vercel.app",
]);
let renewalWork = Promise.resolve();
let renewalTick;

function withRenewalLock(work) {
  const result = renewalWork.then(work);
  renewalWork = result.catch(() => {});
  return result;
}

async function readRenewal() {
  return (await chrome.storage.local.get(RENEWAL_STATE_KEY))[RENEWAL_STATE_KEY] || {};
}

function saveRenewal(value) {
  return chrome.storage.local.set({ [RENEWAL_STATE_KEY]: value });
}

function senderOrigin(sender) {
  try { return new URL(sender?.url).origin; } catch { return ""; }
}

function renewalDriverUrl(value) {
  try {
    const url = new URL(value);
    return RENEWAL_CRM_ORIGINS.has(url.origin) &&
      url.pathname.replace(/\/$/, "") === "/rent2buy-groups" ? url.origin + "/rent2buy-groups" : "";
  } catch { return ""; }
}

async function ensureRenewalAlarm() {
  if (!await chrome.alarms.get(RENEWAL_ALARM)) await chrome.alarms.create(RENEWAL_ALARM, { periodInMinutes: 5 });
}

async function readRenewalApprovals() {
  return (await chrome.storage.local.get(RENEWAL_APPROVAL_RECEIPTS_KEY))[RENEWAL_APPROVAL_RECEIPTS_KEY] || [];
}

async function backgroundCredential() {
  const stored = await chrome.storage.local.get(RENEWAL_CREDENTIAL_KEY);
  return stored[RENEWAL_CREDENTIAL_KEY];
}

async function workerRequest(credential, action, details = {}) {
  const response = await fetch(RENEWAL_PRODUCTION_ORIGIN + "/api/rent2buy-group-renewals", {
    method: "POST", cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + credential.token },
    body: JSON.stringify({ ...details, action }),
  });
  if (response.status === 401) {
    await chrome.storage.local.set({ [RENEWAL_CREDENTIAL_KEY]: { ...credential, paired: false, rejected: true } });
    return { ok: false, error: "Pair the background Groups Helper in Marketing CRM" };
  }
  return response.json();
}

async function scheduleRenewalWork(at = Date.now() + 30_000) {
  const when = Math.max(Date.now() + 30_000, at);
  await chrome.alarms.create(RENEWAL_WORK_ALARM, { when });
}

async function checkExpiredRenewal(state) {
  const pending = state.pending;
  if (!pending || !pending.job.renewal.automatic) return;
  const tab = await chrome.tabs.get(pending.tabId).catch(() => null);
  if (tab && Date.now() - pending.storedAt < 120_000 &&
      (tab.status !== "complete" || canonicalGroupUrl(tab.url) === pending.job.groupUrl || Date.now() - pending.storedAt < 15_000)) return;
  await finishRenewal(state, { status: "needs_attention", duplicateRisk: Boolean(pending.submissionStarted),
    failureStage: pending.submissionStarted ? "publication" : "",
    reason: pending.submissionStarted ? "Facebook did not confirm submission. Check before retrying." : "Facebook did not finish preparing the composer" });
}

async function persistBackgroundResult(state, credential) {
  const result = state.result;
  const saved = await workerRequest(credential, "worker-result", { ...result, runDate: result.date });
  if (!saved.ok) return false;
  if (result.status === "submitted" && result.approvalState !== "accepted") {
    await upsertApprovalMonitorItem(result);
    ensureApprovalAlarm();
  }
  const used = state.usedWorkerVehicles || [];
  const usedWorkerVehicles = result.status === "submitted" && result.vehicleId ? [...new Set([...used, result.vehicleId])].slice(-500) : used;
  await saveRenewal({ ...state, result: null, lastGroupUrl: result.groupUrl, usedWorkerVehicles,
    restrictionReportPending: result.status === "stop" ? false : state.restrictionReportPending });
  return true;
}

async function processBackgroundRenewals() {
  const credential = await backgroundCredential();
  if (!credential?.paired) return;
  let state = await readRenewal();
  if (state.origin !== RENEWAL_PRODUCTION_ORIGIN) return;
  const activeReview = await getGroupAgentState();
  if (activeReview?.mode === "auto-post-status" && Date.now() - activeReview.startedAt > 90_000) {
    await finishTimedOutApprovalCheck(activeReview);
  }
  await checkExpiredRenewal(state);
  state = await readRenewal();
  if (state.result?.automatic) {
    if (!await persistBackgroundResult(state, credential)) return;
    state = await readRenewal();
  }
  if (state.restrictionReportPending) {
    const stopped = await workerRequest(credential, "worker-stop", { reason: state.restrictionReason });
    if (!stopped.ok) return;
    state = { ...state, restrictionReportPending: false };
    await saveRenewal(state);
  }
  for (const receipt of (await readRenewalApprovals()).filter(event => event.crmOrigin === state.origin)) {
    const approval = receipt.accepted ? "accepted" : receipt.declined ? "declined" : receipt.pending ? "pending" : "";
    const saved = await workerRequest(credential, "worker-approval", {
      groupUrl: receipt.groupUrl, registration: receipt.registration, postedAt: receipt.postedAt, checkedAt: receipt.checkedAt,
      permalink: receipt.matchedUrl, ...(receipt.reviewIdentity
        ? { target: receipt.reviewIdentity, result: approval || "unknown", observedAt: receipt.observedAt } : { approval }),
    });
    if (!saved.ok) continue;
    await chrome.storage.local.set({ [RENEWAL_APPROVAL_RECEIPTS_KEY]: (await readRenewalApprovals()).filter(event => event.id !== receipt.id) });
  }
  if (!state.automation?.enabled || state.restricted || state.pending || state.result || await getGroupAgentState()) return;
  if (state.nextSubmissionAt > Date.now()) {
    await scheduleRenewalWork(state.nextSubmissionAt);
    return;
  }
  const jobId = state.nextWorkerRequest || crypto.randomUUID();
  if (!state.nextWorkerRequest) {
    state = { ...state, nextWorkerRequest: jobId };
    await saveRenewal(state);
  }
  const next = await workerRequest(credential, "worker-next", { jobId, usedVehicleIds: state.usedWorkerVehicles || [] });
  if (!next.ok) return;
  if (next.job) {
    // Keep the request ID until the tab and its claim have been saved together.
    const opened = await startRenewalJob(next.job, null, { resetRotation: next.resetRotation });
    if (opened.ok) await scheduleRenewalWork(Date.now() + 120_000);
    return;
  }
  await saveRenewal({ ...state, nextWorkerRequest: null });
  if (next.review) {
    await openApprovalCheck({ ...next.review, groupUrl: next.review.url, renewalPost: true, productKey: "rent2buy", crmOrigin: state.origin });
  } else if (next.checkedGroup) {
    await scheduleRenewalWork();
  }
}
async function reportBackgroundRenewalHeartbeat() {
  const [stored, state] = await Promise.all([chrome.storage.local.get(RENEWAL_HEARTBEAT_KEY), readRenewal()]);
  const paired = await backgroundCredential();
  if (paired?.paired && state.origin === RENEWAL_PRODUCTION_ORIGIN) {
    const [approvalMonitor, activeReview] = await Promise.all([readApprovalHealth(), getGroupAgentState()]);
    await workerRequest(paired, "worker-heartbeat", {
      extension: chrome.runtime.getManifest().version, approvalMonitor, reason: state.restrictionReason || "",
      state: state.restricted ? "restricted" : !state.automation?.enabled ? "paused" :
        state.pending || state.result || activeReview?.mode === "auto-post-status" ? "processing" : "ready",
    });
    return;
  }
  const credential = stored[RENEWAL_HEARTBEAT_KEY];
  if (!credential || !RENEWAL_CRM_ORIGINS.has(credential.origin) || credential.origin !== state.origin || !state.automation?.url) return;
  const approvalMonitor = await readApprovalHealth();
  const response = await fetch(`${credential.origin}/api/rent2buy-group-renewals`, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.token}` },
    body: JSON.stringify({ action: "heartbeat", extension: chrome.runtime.getManifest().version, approvalMonitor,
      state: state.restricted ? "restricted" : "paused",
      reason: state.restrictionReason || "" }),
  });
  if (response.status === 401) await withRenewalLock(async () => {
    const current = (await chrome.storage.local.get(RENEWAL_HEARTBEAT_KEY))[RENEWAL_HEARTBEAT_KEY];
    if (current?.origin === credential.origin && current?.token === credential.token) {
      await chrome.storage.local.remove(RENEWAL_HEARTBEAT_KEY);
    }
  });
}

function runRenewalTick(heartbeat = false) {
  if (!renewalTick) renewalTick = withRenewalLock(processBackgroundRenewals).catch(() => {})
    .then(() => heartbeat && reportBackgroundRenewalHeartbeat().catch(() => {}))
    .finally(() => { renewalTick = null; });
  return renewalTick;
}

async function finishRenewal(state, detail) {
  const { pending } = state;
  if (!pending) return;
  const { job } = pending;
  const result = {
    ...detail, jobId: job.id, date: job.renewal.date, groupUrl: job.groupUrl,
    groupName: job.groupName, productKey: "rent2buy", registration: job.registration, vehicleId: job.vehicleId, renewalPost: true,
    automatic: job.renewal.automatic === true, crmOrigin: state.origin,
    attemptedAt: pending.submissionStarted ? new Date(pending.submissionStarted).toISOString() : null,
  };
  const automation = detail.status === "stop" && state.automation ? { ...state.automation, enabled: false } : state.automation;
  const nextSubmissionAt = pending.submissionStarted ? pending.submissionStarted + RENEWAL_POST_INTERVAL_MS + Math.floor(Math.random() * 30_000) : state.nextSubmissionAt;
  await saveRenewal({ ...state, tabId: pending.tabId, result, pending: null, automation, nextSubmissionAt,
    restricted: detail.status === "stop" || state.restricted === true, restrictionReason: detail.status === "stop" ? detail.reason : state.restrictionReason,
    restrictionReportPending: detail.status === "stop" ? Boolean(state.automation) : state.restrictionReportPending });
}

async function stopRenewalForRestriction(state, reason) {
  if (state.pending) return finishRenewal(state, { status: "stop", reason });
  const automation = state.automation ? { ...state.automation, enabled: false } : state.automation;
  await saveRenewal({ ...state, automation, restricted: true, restrictionReason: reason, restrictionReportPending: Boolean(automation) });
}

// Automatic adverts run in one dedicated, unfocused Facebook window. A background
// tab is hidden: Chromium pauses animation frames and throttles timers there, so
// Facebook never finished rendering the Create Post composer or its confirmation.
// The posting tab is active only inside its own window, so the owner's focus is not
// taken. The window is kept off-screen so it never needs managing; with Edge window
// occlusion disabled an off-screen or covered (not minimised) window still renders.
const POSTING_WINDOW_BOUNDS = { left: -4000, top: -4000, width: 1280, height: 960 };
async function renewalPostingTab(state) {
  let win = state.postingWindowId ? await chrome.windows.get(state.postingWindowId, { populate: true }).catch(() => null) : null;
  if (win && win.type !== "normal") win = null;
  if (!win) {
    win = await chrome.windows.create({ url: "about:blank", focused: false, type: "normal", ...POSTING_WINDOW_BOUNDS });
    return { tab: win.tabs[0], windowId: win.id };
  }
  await chrome.windows.update(win.id, { state: "normal", ...POSTING_WINDOW_BOUNDS }).catch(() => {});
  const owned = (win.tabs || []).find(item => item.id === state.tabId);
  const tab = owned ? await chrome.tabs.update(owned.id, { active: true })
    : await chrome.tabs.create({ windowId: win.id, url: "about:blank", active: true });
  return { tab, windowId: win.id };
}

async function startRenewalJob(job, sender, worker = null) {
  const target = canonicalGroupUrl(job.groupUrl);
  if (job.productKey !== "rent2buy" || !/^\d{4}-\d{2}-\d{2}$/.test(job.renewal?.date || "") ||
      !target || !job.imageUrl || !job.registration) return { ok: false, error: "Invalid Rent2Buy renewal advert." };
  const state = await readRenewal();
  const origin = worker ? RENEWAL_PRODUCTION_ORIGIN : senderOrigin(sender);
  if (job.renewal.automatic && (!worker || origin !== state.origin || !state.automation?.enabled ||
      state.restricted || state.nextSubmissionAt > Date.now())) {
    return { ok: false, error: "Automatic posting requires the background worker" };
  }
  if (!worker && !renewalDriverUrl(sender?.url)) return { ok: false, error: "Open the approved Rent2Buy Groups page" };
  if (!worker && state.pending?.job.renewal.automatic) return { ok: false, error: "The background worker is preparing an advert" };
  if (state.pending?.job.id === job.id && state.origin === origin) return { ok: true, jobId: job.id };
  if (state.pending || state.result) return { ok: false, error: "Finish the previous renewal preparation first." };
  let tab;
  let postingWindowId = state.postingWindowId || null;
  if (job.renewal.automatic) {
    try { ({ tab, windowId: postingWindowId } = await renewalPostingTab(state)); }
    catch { return { ok: false, error: "Could not open the Facebook posting window" }; }
  } else {
    const existing = state.origin === origin && state.tabId ? await chrome.tabs.get(state.tabId).catch(() => null) : null;
    const previousGroup = existing?.url && canonicalGroupUrl(existing.url);
    const reusable = previousGroup && previousGroup === state.lastGroupUrl ? existing : null;
    tab = reusable || await chrome.tabs.create({ url: "about:blank", active: false });
  }
  const pending = { job: { ...job, groupUrl: target }, tabId: tab.id, storedAt: Date.now() };
  await saveRenewal({ ...state, origin, tabId: tab.id, postingWindowId, pending, restricted: state.restricted === true,
    ...(worker ? { nextWorkerRequest: null, usedWorkerVehicles: worker.resetRotation ? [] : state.usedWorkerVehicles || [] } : {}) });
  try {
    await chrome.tabs.update(tab.id, { url: target });
  } catch {
    await finishRenewal({ ...state, origin, pending }, { status: "failed", reason: "Could not open the group in Facebook" });
  }
  return { ok: true, jobId: job.id };
}

async function handleRenewalMessage(message, sender) {
  const state = await readRenewal();
  const senderUrl = renewalDriverUrl(sender?.url);
  const productionGroups = senderUrl === RENEWAL_PRODUCTION_ORIGIN + "/rent2buy-groups";
  if (message.type === "GET_GROUP_RENEWAL_PAIRING") {
    if (!productionGroups || (state.origin && state.origin !== RENEWAL_PRODUCTION_ORIGIN && (state.pending || state.result))) return { ok: false };
    const existing = await backgroundCredential();
    const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const token = !existing?.rejected && existing?.token || "r2b-worker-" + hex(crypto.getRandomValues(new Uint8Array(32)));
    const hash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
    if (existing?.token !== token) await chrome.storage.local.set({ [RENEWAL_CREDENTIAL_KEY]: { token, paired: false } });
    return { ok: true, hash };
  }
  if (message.type === "CLEAR_GROUP_RENEWAL_PAIRING") {
    if (!productionGroups || state.automation?.enabled) return { ok: false };
    await chrome.storage.local.remove(RENEWAL_CREDENTIAL_KEY);
    return { ok: true, paired: false };
  }
  if (message.type === "SET_GROUP_RENEWAL_AUTOMATION") {
    if (!productionGroups || (state.origin && state.origin !== RENEWAL_PRODUCTION_ORIGIN && (state.pending || state.result))) return { ok: false };
    const credential = await backgroundCredential();
    if (!credential?.token) return { ok: false, error: "Pair the background Groups Helper first" };
    const enabled = typeof message.enabled === "boolean" ? message.enabled : state.automation?.enabled === true;
    if (message.enabled === false && credential.paired) {
      await saveRenewal({ ...state, automation: { enabled: false } });
      return { ok: true, automatic: false, paired: true };
    }
    let restricted = state.restricted;
    if (message.enabled === true && restricted) {
      if (state.restrictionReportPending || state.result?.status === "stop") return { ok: false, error: "Wait for the account restriction to be recorded" };
      const allowed = await workerRequest(credential, "worker-enable-check");
      if (!allowed.ok) return allowed;
      restricted = false;
    }
    const checked = await workerRequest(credential, "worker-heartbeat", { state: restricted ? "restricted" : enabled ? "ready" : "paused",
      extension: chrome.runtime.getManifest().version, approvalMonitor: await readApprovalHealth(), reason: restricted ? state.restrictionReason : "" });
    if (!checked.ok) return checked;
    await chrome.storage.local.set({ [RENEWAL_CREDENTIAL_KEY]: { ...credential, paired: true } });
    await saveRenewal({ ...state, origin: RENEWAL_PRODUCTION_ORIGIN, automation: { enabled: enabled && !restricted },
      restricted, restrictionReason: restricted ? state.restrictionReason : "",
      usedWorkerVehicles: state.usedWorkerVehicles || (Array.isArray(message.usedVehicleIds)
        ? message.usedVehicleIds.filter(id => typeof id === "string" && id.length < 100).slice(-500) : []) });
    await scheduleRenewalWork();
    return { ok: true, automatic: enabled && !restricted, paired: true };
  }
  if (message.type === "WAKE_GROUP_RENEWAL_WORKER") {
    if (!productionGroups) return { ok: false };
    await scheduleRenewalWork();
    return { ok: true };
  }
  if (["GET_GROUP_RENEWAL_STATE", "ACK_GROUP_RENEWAL_RESULT", "OPEN_GROUP_RENEWAL_DRAFT"].includes(message.type)) {
    if (!senderUrl) return { ok: false };
    const paired = productionGroups && Boolean((await backgroundCredential())?.paired);
    const report = { ok: true, automatic: paired && state.automation?.enabled === true, paired,
      restrictionReason: productionGroups ? state.restrictionReason : "" };
    if (state.origin !== senderOrigin(sender)) return report;
    if (message.type === "OPEN_GROUP_RENEWAL_DRAFT") {
      const tab = state.pending?.job.id === message.jobId ? await chrome.tabs.get(state.pending.tabId).catch(() => null) : null;
      if (!tab || canonicalGroupUrl(tab.url) !== state.pending.job.groupUrl) {
        return { ok: false, error: "The prepared Facebook draft is no longer open." };
      }
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true };
    }
    if (message.type === "ACK_GROUP_RENEWAL_RESULT") {
      if (state.result?.jobId === message.jobId && !state.result.automatic) {
        if (state.result.status === "submitted" && state.result.approvalState !== "accepted") {
          await upsertApprovalMonitorItem(state.result);
          ensureApprovalAlarm();
        }
        await saveRenewal({ ...state, lastGroupUrl: state.result.groupUrl, result: null });
      }
      return { ok: true };
    }
    if (state.pending && !state.pending.job.renewal.automatic) {
      const tab = await chrome.tabs.get(state.pending.tabId).catch(() => null);
      if (!tab || (tab.status === "complete" && canonicalGroupUrl(tab.url) !== state.pending.job.groupUrl &&
          Date.now() - state.pending.storedAt >= 15_000)) {
        await finishRenewal(state, { status: "needs_attention", reason: "The Facebook tab closed or left the group. Check for a submission before retrying.", duplicateRisk: Boolean(state.pending.submissionStarted || (state.pending.prepared && !state.pending.job.renewal.automatic)) });
        return { ...report, result: (await readRenewal()).result };
      }
    }
    if (state.pending && !state.pending.job.renewal.automatic && !state.pending.prepared && Date.now() - state.pending.storedAt >= 120_000) {
      await finishRenewal(state, { status: "needs_attention", reason: state.pending.submissionStarted ? "Facebook did not confirm submission. Check before retrying." : "Facebook did not finish preparing the composer",
        duplicateRisk: Boolean(state.pending.submissionStarted), failureStage: state.pending.submissionStarted ? "publication" : "" });
      return { ...report, result: (await readRenewal()).result };
    }
    return { ...report, pending: state.pending && !state.pending.job.renewal.automatic ? { ...state.pending.job, prepared: Boolean(state.pending.prepared) } : null,
      result: state.result?.automatic ? null : state.result || null };
  }
  const pending = state.pending;
  if (!pending || pending.tabId !== sender?.tab?.id || pending.job.id !== message.jobId || senderOrigin(sender) !== "https://www.facebook.com" ||
      canonicalGroupUrl(sender.url) !== pending.job.groupUrl) return { ok: false };
  if (message.type === "ENSURE_GROUP_RENEWAL_VISIBLE") {
    // Something minimised the posting window or switched its tab: restore it off-screen.
    if (!pending.job.renewal.automatic) return { ok: false };
    const tab = await chrome.tabs.get(pending.tabId).catch(() => null);
    if (!tab) return { ok: false };
    await chrome.windows.update(tab.windowId, { state: "normal", ...POSTING_WINDOW_BOUNDS }).catch(() => {});
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    return { ok: true };
  }
  if (message.type === "GROUP_RENEWAL_READY") {
    await saveRenewal({ ...state, restricted: false, pending: { ...pending, prepared: true } });
  } else if (message.type === "BEGIN_GROUP_RENEWAL_SUBMISSION") {
    if (!pending.prepared || !pending.job.renewal.automatic || !state.automation?.enabled || state.restricted ||
        pending.submissionStarted) return { ok: false };
    const credential = await backgroundCredential();
    if (!credential?.paired) return { ok: false };
    const reserved = await workerRequest(credential, "worker-reserve", { groupUrl: pending.job.groupUrl,
      jobId: pending.job.id, runDate: pending.job.renewal.date });
    if (!reserved.ok) return reserved;
    await saveRenewal({ ...state, pending: { ...pending, submissionStarted: Date.parse(reserved.reservedAt) } });
  } else {
    const detail = message.result || {};
    if (detail.status === "submitted" && (!pending.prepared || (pending.job.renewal.automatic && !pending.submissionStarted) ||
        !["accepted", "pending", "submitted"].includes(detail.approvalState))) return { ok: false };
    if (!["submitted", "failed", "needs_attention", "stop"].includes(detail.status)) return { ok: false };
    await finishRenewal(state, { status: detail.status, reason: clean(detail.reason).slice(0, 200),
      duplicateRisk: detail.duplicateRisk === true || (detail.status === "stop" && Boolean(pending.submissionStarted)),
      failureStage: detail.failureStage === "publication" ? "publication" : "",
      postedAt: detail.status === "submitted" ? new Date(pending.submissionStarted || Date.now()).toISOString() : null,
      approvalState: detail.approvalState, permalink: verifiedGroupPostUrl(detail.permalink, pending.job.groupUrl) });
    if (pending.job.renewal.automatic) await scheduleRenewalWork();
  }
  return { ok: true };
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url || !/^https:\/\/www\.facebook\.com\/(?:checkpoint|login|recover|two_step_verification|accountquality)(?:\/|[?#]|$)/i.test(change.url)) return;
  withRenewalLock(async () => {
    const state = await readRenewal();
    if (state.pending?.tabId === tabId) {
      await stopRenewalForRestriction(state, "Facebook requires sign-in or account/security review");
      return;
    }
    const approval = await getGroupAgentState();
    if (approval?.tabId === tabId && approval.mode === "auto-post-status" && approval.job.groups[0]?.renewalPost) {
      await stopRenewalForRestriction(state, "Facebook requires sign-in or account/security review");
      await chrome.tabs.remove(tabId).catch(() => {});
      await clearGroupAgentState();
    }
  }).catch(() => {});
});
const LAST_GROUP_POST_EVENT_KEY = "vfcLastFacebookGroupPostEvent";
const GROUP_APPROVAL_MONITOR_KEY = "vfcFacebookGroupApprovalMonitor";
const LAST_GROUP_STATUS_EVENT_KEY = "vfcLastFacebookGroupStatusEvent";
const LAST_GROUP_STATUS_BATCH_KEY = "vfcLastFacebookGroupStatusBatch";
const GROUP_APPROVAL_ALARM = "vfcFacebookGroupApprovalMonitorAlarm";
const GROUP_APPROVAL_CHECK_MINUTES = 60;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeRegistration(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function getMarketplaceListingRegistry() {
  const stored = await chrome.storage.local.get(MARKETPLACE_LISTING_REGISTRY_KEY);
  return Array.isArray(stored[MARKETPLACE_LISTING_REGISTRY_KEY])
    ? stored[MARKETPLACE_LISTING_REGISTRY_KEY]
    : [];
}

async function saveMarketplaceListingRegistry(items) {
  const rows = Array.isArray(items) ? items.slice(-1500) : [];
  await chrome.storage.local.set({ [MARKETPLACE_LISTING_REGISTRY_KEY]: rows });
  return rows;
}

async function upsertMarketplaceListingRegistry(receipt) {
  if (!receipt?.listingUrl || !receipt?.registration) return getMarketplaceListingRegistry();
  const current = await getMarketplaceListingRegistry();
  const url = clean(receipt.listingUrl);
  const registration = normalizeRegistration(receipt.registration);
  const next = current.filter((item) => clean(item?.listingUrl) !== url);
  next.push({
    listingUrl: url,
    registration,
    vehicleId: clean(receipt.vehicleId),
    pipeline: clean(receipt.pipeline),
    postingDestination: clean(receipt.postingDestination || receipt.destination),
    publishedAt: clean(receipt.publishedAt),
  });
  return saveMarketplaceListingRegistry(next);
}

async function getMarketplaceStockSnapshots() {
  const stored = await chrome.storage.local.get(MARKETPLACE_STOCK_SNAPSHOTS_KEY);
  return stored[MARKETPLACE_STOCK_SNAPSHOTS_KEY] || {};
}

async function saveMarketplaceStockSnapshot(product, registrations, generatedAt = "") {
  const productKey = product === "finance" ? "finance" : product === "rent2buy" ? "rent2buy" : "";
  if (!productKey) throw new Error("Marketplace stock snapshot product is invalid.");
  const cleanRegistrations = [...new Set((Array.isArray(registrations) ? registrations : [])
    .map(normalizeRegistration)
    .filter(Boolean))];
  const current = await getMarketplaceStockSnapshots();
  const next = {
    ...current,
    [productKey]: {
      registrations: cleanRegistrations,
      generatedAt: clean(generatedAt) || new Date().toISOString(),
    },
  };
  await chrome.storage.local.set({ [MARKETPLACE_STOCK_SNAPSHOTS_KEY]: next });
  return next;
}

function isMarketplaceItemUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.hostname === "www.facebook.com" && /^\/marketplace\/item\/[^/]+/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function getPendingJob() {
  const stored = await chrome.storage.local.get(PENDING_JOB_KEY);
  return stored[PENDING_JOB_KEY] || null;
}

async function savePendingJob(value) {
  await chrome.storage.local.set({ [PENDING_JOB_KEY]: value });
}

async function clearPendingJob() {
  await chrome.storage.local.remove(PENDING_JOB_KEY);
}

async function broadcastToCrm(message, preferredTabId = null) {
  if (preferredTabId) {
    try {
      await chrome.tabs.sendMessage(preferredTabId, message);
      return;
    } catch {}
  }

  const tabs = await chrome.tabs.query({
    url: ["https://marketing-crm-six.vercel.app/*", "https://*.vercel.app/*"],
  });
  await Promise.allSettled(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message)));
}

function canonicalGroupUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const match = url.pathname.match(/^\/groups\/([^/?#]+)/i);
    if (!match) return "";
    return `https://www.facebook.com/groups/${match[1]}/`;
  } catch {
    return "";
  }
}

function groupSearchUrl(query) {
  return `https://www.facebook.com/search/groups/?q=${encodeURIComponent(String(query || ""))}`;
}

function groupAboutUrl(value) {
  const base = canonicalGroupUrl(value);
  return base ? `${base}about/` : String(value || "");
}

function groupPostSearchUrl(value, registration) {
  const base = canonicalGroupUrl(value);
  return base ? `${base}search/?q=${encodeURIComponent(String(registration || ""))}` : String(value || "");
}

async function getGroupAgentState() {
  const stored = await chrome.storage.local.get(GROUP_AGENT_STATE_KEY);
  return stored[GROUP_AGENT_STATE_KEY] || null;
}

async function saveGroupAgentState(state) {
  await chrome.storage.local.set({ [GROUP_AGENT_STATE_KEY]: state });
}

async function clearGroupAgentState() {
  await chrome.storage.local.remove(GROUP_AGENT_STATE_KEY);
}

async function getPendingGroupPost() {
  const stored = await chrome.storage.local.get(GROUP_POST_JOB_KEY);
  return stored[GROUP_POST_JOB_KEY] || null;
}

async function getApprovalMonitorItems() {
  const stored = await chrome.storage.local.get(GROUP_APPROVAL_MONITOR_KEY);
  return Array.isArray(stored[GROUP_APPROVAL_MONITOR_KEY])
    ? stored[GROUP_APPROVAL_MONITOR_KEY]
    : [];
}

async function saveApprovalMonitorItems(items) {
  await chrome.storage.local.set({ [GROUP_APPROVAL_MONITOR_KEY]: items || [] });
  await refreshApprovalBadge(items || []);
}

async function refreshApprovalBadge(items = null) {
  const current = items || await getApprovalMonitorItems();
  const count = current.length;
  try {
    await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 99)) : "" });
    await chrome.action.setTitle({
      title: count
        ? `${count} Facebook group post${count === 1 ? "" : "s"} awaiting approval/visibility`
        : "VFC Facebook Helper",
    });
  } catch {}
}

async function upsertApprovalMonitorItem(item) {
  const current = await getApprovalMonitorItems();
  const key = `${canonicalGroupUrl(item.groupUrl)}|${clean(item.registration).toUpperCase()}`;
  const next = current.filter((entry) => {
    const entryKey = `${canonicalGroupUrl(entry.groupUrl)}|${clean(entry.registration).toUpperCase()}`;
    return entryKey !== key;
  });
  next.push({
    ...item,
    groupUrl: canonicalGroupUrl(item.groupUrl),
    lastCheckedAt: item.lastCheckedAt || "",
    checkCount: Number(item.checkCount || 0),
  });
  await saveApprovalMonitorItems(next);
}

async function removeApprovalMonitorItem(groupUrl, registration) {
  const key = `${canonicalGroupUrl(groupUrl)}|${clean(registration).toUpperCase()}`;
  const current = await getApprovalMonitorItems();
  const next = current.filter((entry) => {
    const entryKey = `${canonicalGroupUrl(entry.groupUrl)}|${clean(entry.registration).toUpperCase()}`;
    return entryKey !== key;
  });
  await saveApprovalMonitorItems(next);
  return next;
}

async function saveGroupStatusEvent(event) {
  await chrome.storage.local.set({ [LAST_GROUP_STATUS_EVENT_KEY]: event });
  await broadcastToCrm({ type: "GROUP_POST_STATUS_EVENT", event });
}

function verifiedGroupPostUrl(value, group) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/groups\/[^/]+\/(?:posts|permalink)\/(\d+)\/?$/i);
    return url.origin === "https://www.facebook.com" && match && canonicalGroupUrl(url.href) === canonicalGroupUrl(group)
      ? `${canonicalGroupUrl(group)}posts/${match[1]}/` : "";
  } catch { return ""; }
}

async function recordApprovalHealth(patch) {
  const stored = await chrome.storage.local.get(APPROVAL_HEALTH_KEY);
  await chrome.storage.local.set({ [APPROVAL_HEALTH_KEY]: { ...stored[APPROVAL_HEALTH_KEY], ...patch } });
}

async function readApprovalHealth() {
  const [stored, alarm, items] = await Promise.all([chrome.storage.local.get(APPROVAL_HEALTH_KEY),
    chrome.alarms.get(GROUP_APPROVAL_ALARM), getApprovalMonitorItems()]);
  return { ...stored[APPROVAL_HEALTH_KEY], scheduled: Boolean(alarm), pendingCount: items.length,
    unresolvedCount: items.filter(item => item.lastResult === "not_found" && item.checkCount >= 3).length };
}

async function finishTimedOutApprovalCheck(state) {
  const target = state.job.groups[0];
  const checkedAt = new Date().toISOString();
  if (target?.identity) {
    await chrome.storage.local.set({ [RENEWAL_APPROVAL_RECEIPTS_KEY]: [...(await readRenewalApprovals()), {
      id: state.job.id, reviewIdentity: target.identity, groupUrl: target.url, crmOrigin: target.crmOrigin, checkedAt,
    }] });
  }
  await recordApprovalHealth({ lastCheckAt: checkedAt, outcome: "timeout" });
  if (state.tabId) await chrome.tabs.remove(state.tabId).catch(() => {});
  await clearGroupAgentState();
}

async function startAutomaticApprovalCheck() {
  const activeState = await getGroupAgentState();
  if (activeState) {
    if (activeState.mode === "auto-post-status" && Date.now() - activeState.startedAt > 90_000) await finishTimedOutApprovalCheck(activeState);
    return;
  }

  const items = await getApprovalMonitorItems();
  if (!items.length) {
    await refreshApprovalBadge([]);
    return;
  }

  const now = Date.now();
  const { restricted, pending } = await readRenewal();
  if (pending) return;
  const due = [...items]
    .sort((a, b) => new Date(a.lastCheckedAt || a.postedAt || 0) - new Date(b.lastCheckedAt || b.postedAt || 0))
    .find((item) => {
      if (item.renewalPost && (restricted || Number(item.checkCount || 0) >= 3)) return false;
      if (!item.lastCheckedAt) return true;
      const checkedAt = new Date(item.lastCheckedAt).getTime();
      return !Number.isFinite(checkedAt) || now - checkedAt >= GROUP_APPROVAL_CHECK_MINUTES * 60 * 1000;
    });
  if (!due) return;

  await openApprovalCheck(due);
}

async function openApprovalCheck(due) {
  const state = {
    mode: "auto-post-status",
    job: {
      id: `auto-group-post-status-${Date.now().toString(36)}`,
      productKey: due.productKey || "",
      groups: [due],
    },
    groupIndex: 0,
    results: [],
    crmTabId: null,
    tabId: null,
    startedAt: Date.now(),
  };

  try {
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    state.tabId = tab.id || null;
    await saveGroupAgentState(state);
    await chrome.tabs.update(tab.id, { url: verifiedGroupPostUrl(due.permalink, due.groupUrl) || groupPostSearchUrl(due.groupUrl, due.registration) });
    return true;
  } catch (error) {
    if (state.tabId) await chrome.tabs.remove(state.tabId).catch(() => {});
    await clearGroupAgentState();
    await recordApprovalHealth({ lastCheckAt: new Date().toISOString(), outcome: "navigation_failed" });
    return false;
  }
}

async function ensureApprovalAlarm() {
  try {
    if (!await chrome.alarms.get(GROUP_APPROVAL_ALARM)) await chrome.alarms.create(GROUP_APPROVAL_ALARM, { periodInMinutes: GROUP_APPROVAL_CHECK_MINUTES });
  } catch {}
}

async function broadcastReceipt(receipt, crmTabId) {
  if (crmTabId) {
    try {
      await chrome.tabs.sendMessage(crmTabId, { type: "MARKETPLACE_PUBLISHED", receipt });
      return;
    } catch {}
  }

  const tabs = await chrome.tabs.query({ url: "https://marketing-crm-six.vercel.app/*" });
  await Promise.allSettled(
    tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "MARKETPLACE_PUBLISHED", receipt })),
  );
}

async function createPublishReceipt(pending, listingUrl) {
  const receipt = {
    id: `marketplace-receipt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    jobId: pending.job.id,
    registration: pending.job.registration,
    vehicleId: pending.job.vehicleId || "",
    destination: pending.job.postingDestination || "Rent2Buy Marketplace",
    postingDestination: pending.job.postingDestination || "",
    pipeline: pending.job.pipeline || "",
    location: pending.job.location || "",
    listingUrl,
    publishedAt: new Date().toISOString(),
    imageCount: Number(pending.job.imageCount || pending.job.images?.length || 0),
  };

  await chrome.storage.local.set({ [LAST_RECEIPT_KEY]: receipt });
  await upsertMarketplaceListingRegistry(receipt);
  await clearPendingJob();
  await broadcastReceipt(receipt, pending.crmTabId);
  return receipt;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "GET_FACEBOOK_HELPER_STATUS") {
      const manifest = chrome.runtime.getManifest();
      sendResponse({
        ok: true,
        version: manifest?.version || "",
        capabilities: [
          "marketplace",
          "marketplace-renew-manager",
          "groups-discovery",
          "groups-inspection",
          "groups-post-prep",
          "groups-renewals", "groups-automatic-renewals",
          "groups-renewal-reconciliation",
          "groups-renewal-background-heartbeat",
          "groups-renewal-independent-worker",
          "groups-post-status",
          "groups-auto-approval-monitor",
          "groups-state-recovery",
          "groups-inspection-progress",
          "groups-agent-cancel",
        ],
        approvalMonitor: await readApprovalHealth().catch(() => null),
      });
      return;
    }

    if (message?.type === "GET_MARKETPLACE_MANAGER_CONTEXT") {
      sendResponse({
        ok: true,
        registry: await getMarketplaceListingRegistry(),
        stock: await getMarketplaceStockSnapshots(),
      });
      return;
    }

    if (message?.type === "STORE_MARKETPLACE_STOCK_SNAPSHOT") {
      try {
        const stock = await saveMarketplaceStockSnapshot(
          message.product,
          message.registrations,
          message.generatedAt,
        );
        sendResponse({ ok: true, stock });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
      return;
    }

    if (message?.type === "STORE_MARKETPLACE_JOB") {
      const job = message.job;
      if (!job?.id || !job?.registration || !Array.isArray(job?.images) || !job.images.length) {
        sendResponse({ ok: false, error: "Invalid Marketplace job." });
        return;
      }
      await savePendingJob({
        job,
        crmTabId: sender?.tab?.id || null,
        storedAt: Date.now(),
        facebookTabId: null,
        fillCompletedAt: 0,
        publishClickedAt: 0,
      });
      sendResponse({ ok: true, jobId: job.id });
      return;
    }

    if (message?.type === "GET_PENDING_MARKETPLACE_JOB") {
      sendResponse({ ok: true, pending: await getPendingJob() });
      return;
    }

    if (message?.type === "MARKETPLACE_JOB_STARTED") {
      const pending = await getPendingJob();
      if (!pending || pending.job?.id !== message.jobId) {
        sendResponse({ ok: false });
        return;
      }
      pending.facebookTabId = sender?.tab?.id || pending.facebookTabId;
      pending.startedAt = Date.now();
      await savePendingJob(pending);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "MARKETPLACE_FILL_COMPLETED") {
      const pending = await getPendingJob();
      if (!pending || pending.job?.id !== message.jobId) {
        sendResponse({ ok: false });
        return;
      }
      pending.facebookTabId = sender?.tab?.id || pending.facebookTabId;
      pending.fillCompletedAt = Date.now();
      pending.fillReport = message.report || null;
      await savePendingJob(pending);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "MARKETPLACE_PUBLISH_CLICKED") {
      const pending = await getPendingJob();
      if (!pending || pending.job?.id !== message.jobId || !pending.fillCompletedAt) {
        sendResponse({ ok: false });
        return;
      }
      pending.facebookTabId = sender?.tab?.id || pending.facebookTabId;
      pending.publishClickedAt = Date.now();
      await savePendingJob(pending);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "FETCH_MARKETPLACE_IMAGE") {
      const url = clean(message.url);
      if (!url || !/^https:\/\/static\.wixstatic\.com\//i.test(url)) {
        sendResponse({ ok: false, error: "Image URL is not an approved Wix media URL." });
        return;
      }
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`Image returned HTTP ${response.status}`);
        const blob = await response.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        sendResponse({
          ok: true,
          dataUrl: `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`,
          mime: blob.type || "image/jpeg",
        });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
      return;
    }

    if (message?.type === "GET_LAST_MARKETPLACE_RECEIPT") {
      const stored = await chrome.storage.local.get(LAST_RECEIPT_KEY);
      sendResponse({ ok: true, receipt: stored[LAST_RECEIPT_KEY] || null });
      return;
    }

    if (message?.type === "ACK_MARKETPLACE_RECEIPT") {
      const stored = await chrome.storage.local.get(LAST_RECEIPT_KEY);
      if (!message.receiptId || stored[LAST_RECEIPT_KEY]?.id === message.receiptId) {
        await chrome.storage.local.remove(LAST_RECEIPT_KEY);
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "STORE_GROUP_DISCOVERY_JOB") {
      const job = message.job;
      if (!job?.id || !Array.isArray(job?.queries) || !job.queries.length) {
        sendResponse({ ok: false, error: "Invalid Facebook group discovery job." });
        return;
      }
      const state = {
        mode: "discovery",
        job,
        queryIndex: 0,
        candidates: [],
        crmTabId: sender?.tab?.id || null,
        tabId: null,
        startedAt: Date.now(),
      };
      await saveGroupAgentState(state);
      const tab = await chrome.tabs.create({ url: groupSearchUrl(job.queries[0]?.query || job.queries[0]), active: true });
      state.tabId = tab.id || null;
      await saveGroupAgentState(state);
      sendResponse({ ok: true, jobId: job.id, tabId: state.tabId });
      return;
    }

    if (message?.type === "STORE_GROUP_INSPECTION_JOB") {
      const job = message.job;
      if (!job?.id || !Array.isArray(job?.groups) || !job.groups.length) {
        sendResponse({ ok: false, error: "Invalid Facebook group inspection job." });
        return;
      }
      const state = {
        mode: "inspection",
        job,
        groupIndex: 0,
        inspections: [],
        crmTabId: sender?.tab?.id || null,
        tabId: null,
        startedAt: Date.now(),
      };
      await saveGroupAgentState(state);
      const tab = await chrome.tabs.create({ url: groupAboutUrl(job.groups[0]?.url), active: true });
      state.tabId = tab.id || null;
      await saveGroupAgentState(state);
      sendResponse({ ok: true, jobId: job.id, tabId: state.tabId });
      return;
    }

    if (message?.type === "STORE_GROUP_POST_STATUS_JOB") {
      const job = message.job;
      if (!job?.id || !Array.isArray(job?.groups) || !job.groups.length) {
        sendResponse({ ok: false, error: "Invalid Facebook group post-status job." });
        return;
      }
      const state = {
        mode: "post-status",
        job,
        groupIndex: 0,
        results: [],
        crmTabId: sender?.tab?.id || null,
        tabId: null,
        startedAt: Date.now(),
      };
      await saveGroupAgentState(state);
      const first = job.groups[0];
      const tab = await chrome.tabs.create({
        url: groupPostSearchUrl(first?.url, first?.registration),
        active: true,
      });
      state.tabId = tab.id || null;
      await saveGroupAgentState(state);
      sendResponse({ ok: true, jobId: job.id, tabId: state.tabId });
      return;
    }

    if (message?.type === "CANCEL_GROUP_AGENT_JOB") {
      const state = await getGroupAgentState();
      if (!state || !["inspection", "post-status"].includes(state.mode) || state.job?.id !== message.jobId) {
        sendResponse({ ok: false, error: "That check is no longer running." });
        return;
      }
      await clearGroupAgentState();
      if (state.tabId) await chrome.tabs.remove(state.tabId).catch(() => {});
      await broadcastToCrm(state.mode === "inspection"
        ? { type: "GROUP_INSPECTION_COMPLETE", jobId: state.job.id, productKey: state.job.productKey, inspections: state.inspections || [], cancelled: true }
        : { type: "GROUP_POST_STATUS_COMPLETE", jobId: state.job.id, productKey: state.job.productKey, results: state.results || [], cancelled: true },
      state.crmTabId);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "GET_GROUP_AGENT_STATE") {
      const state = await getGroupAgentState();
      if (state?.tabId && sender?.tab?.id && state.tabId !== sender.tab.id) {
        sendResponse({ ok: true, state: null });
        return;
      }
      sendResponse({ ok: true, state });
      return;
    }

    if (message?.type === "GROUP_DISCOVERY_PAGE_RESULTS") {
      const state = await getGroupAgentState();
      if (!state || state.mode !== "discovery" || state.job?.id !== message.jobId) {
        sendResponse({ ok: false });
        return;
      }
      if (Number(message.queryIndex) !== Number(state.queryIndex)) {
        sendResponse({ ok: false, error: "Discovery result is from an old query." });
        return;
      }

      const map = new Map(
        (state.candidates || []).map((item) => [canonicalGroupUrl(item.url) || item.url, item]),
      );
      for (const candidate of message.candidates || []) {
        const key = canonicalGroupUrl(candidate.url);
        if (!key) continue;
        map.set(key, { ...(map.get(key) || {}), ...candidate, url: key });
        if (map.size >= Number(state.job.maxGroups || 60)) break;
      }
      state.candidates = [...map.values()];
      state.queryIndex += 1;

      const nextQuery = state.job.queries?.[state.queryIndex];
      if (nextQuery && state.candidates.length < Number(state.job.maxGroups || 60)) {
        await saveGroupAgentState(state);
        if (state.tabId) {
          await chrome.tabs.update(state.tabId, { url: groupSearchUrl(nextQuery.query || nextQuery), active: true });
        }
      } else {
        await broadcastToCrm({
          type: "GROUP_DISCOVERY_COMPLETE",
          jobId: state.job.id,
          productKey: state.job.productKey,
          candidates: state.candidates,
          queryCount: state.queryIndex,
        }, state.crmTabId);
        await clearGroupAgentState();
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "GROUP_INSPECTION_PAGE_RESULT") {
      const state = await getGroupAgentState();
      if (!state || state.mode !== "inspection" || state.job?.id !== message.jobId) {
        sendResponse({ ok: false });
        return;
      }
      if (Number(message.groupIndex) !== Number(state.groupIndex)) {
        sendResponse({ ok: false, error: "Inspection result is from an old group." });
        return;
      }

      state.inspections = [...(state.inspections || []), message.inspection || {}];
      state.groupIndex += 1;
      await broadcastToCrm({
        type: "GROUP_INSPECTION_PROGRESS",
        jobId: state.job.id,
        productKey: state.job.productKey,
        inspection: message.inspection || {},
        index: state.groupIndex,
        total: state.job.groups?.length || 0,
      }, state.crmTabId);
      const nextGroup = state.job.groups?.[state.groupIndex];

      if (nextGroup) {
        await saveGroupAgentState(state);
        if (state.tabId) {
          await chrome.tabs.update(state.tabId, { url: groupAboutUrl(nextGroup.url), active: true });
        }
      } else {
        await broadcastToCrm({
          type: "GROUP_INSPECTION_COMPLETE",
          jobId: state.job.id,
          productKey: state.job.productKey,
          inspections: state.inspections,
        }, state.crmTabId);
        await clearGroupAgentState();
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "GROUP_POST_STATUS_PAGE_RESULT") {
      const state = await getGroupAgentState();
      if (
        !state ||
        !["post-status", "auto-post-status"].includes(state.mode) ||
        state.job?.id !== message.jobId
      ) {
        sendResponse({ ok: false });
        return;
      }
      if (Number(message.groupIndex) !== Number(state.groupIndex)) {
        sendResponse({ ok: false, error: "Post-status result is from an old group." });
        return;
      }

      if (state.mode === "auto-post-status") {
        const result = message.result || {};
        const target = state.job.groups?.[0] || {};
        if (state.tabId !== sender?.tab?.id || senderOrigin(sender) !== "https://www.facebook.com") {
          sendResponse({ ok: false });
          return;
        }
        if (target.renewalPost && result.restricted && state.tabId === sender?.tab?.id) {
          await withRenewalLock(async () => stopRenewalForRestriction(await readRenewal(), "Facebook reported a security check during renewal verification"));
          await chrome.tabs.remove(state.tabId).catch(() => {});
          await clearGroupAgentState();
          sendResponse({ ok: true });
          return;
        }
        const checkedAt = result.checkedAt || new Date().toISOString();
        await recordApprovalHealth({ lastCheckAt: checkedAt, outcome: result.accepted ? "accepted" : result.declined ? "declined" : result.pending ? "pending" : "unknown" });
        const event = {
          id: `group-status-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          productKey: target.productKey || state.job.productKey || "",
          groupUrl: canonicalGroupUrl(result.url || target.url || target.groupUrl),
          groupName: target.name || target.groupName || "",
          registration: result.registration || target.registration || "",
          accepted: Boolean(result.accepted),
          pending: Boolean(result.pending),
          declined: Boolean(result.declined),
          unavailable: Boolean(result.unavailable),
          matchedUrl: result.matchedUrl || "",
          matchMethod: result.matchMethod || "",
          checkedAt, postedAt: target.postedAt || "", automatic: target.automatic === true, crmOrigin: target.crmOrigin || "",
          observedAt: result.observedAt || "", reviewIdentity: target.identity || "",
        };

        if (target.identity) {
          await withRenewalLock(async () => chrome.storage.local.set({ [RENEWAL_APPROVAL_RECEIPTS_KEY]: [...(await readRenewalApprovals()), event] }));
          await chrome.tabs.remove(state.tabId).catch(() => {});
          await clearGroupAgentState();
          sendResponse({ ok: true });
          return;
        }

        if (event.accepted || event.declined || event.unavailable) {
          await removeApprovalMonitorItem(event.groupUrl, event.registration);
        } else {
          const current = await getApprovalMonitorItems();
          const next = current.map((item) => {
            const sameGroup = canonicalGroupUrl(item.groupUrl) === event.groupUrl;
            const sameReg = clean(item.registration).toUpperCase() === clean(event.registration).toUpperCase();
            return sameGroup && sameReg
              ? {
                  ...item,
                  lastCheckedAt: checkedAt,
                  checkCount: Number(item.checkCount || 0) + 1,
                  lastResult: event.pending ? "pending" : "not_found",
                }
              : item;
          });
          await saveApprovalMonitorItems(next);
        }

        if (event.automatic && event.postedAt && (event.accepted || event.declined || event.pending)) {
          await withRenewalLock(async () => chrome.storage.local.set({
            [RENEWAL_APPROVAL_RECEIPTS_KEY]: [...(await readRenewalApprovals()), event],
          }));
        }
        await saveGroupStatusEvent(event);
        if (event.accepted || event.declined) {
          try {
            await chrome.action.setBadgeText({ text: event.accepted ? "✓" : "×" });
            await chrome.action.setTitle({
              title: event.accepted
                ? `${event.groupName || "Facebook group"} accepted ${event.registration || "your advert"}`
                : `${event.groupName || "Facebook group"} declined ${event.registration || "your advert"}`,
            });
          } catch {}
        }

        if (state.tabId) {
          try { await chrome.tabs.remove(state.tabId); } catch {}
        }
        await clearGroupAgentState();
        sendResponse({ ok: true });
        return;
      }

      state.results = [...(state.results || []), message.result || {}];
      // Persist and deliver each result before opening the next Facebook page. A later
      // page can fail to load, so the CRM must not depend on the final page completing.
      await saveGroupAgentState(state);
      await broadcastToCrm({
        type: "GROUP_POST_STATUS_PROGRESS",
        jobId: state.job.id,
        productKey: state.job.productKey,
        result: message.result || {},
      }, state.crmTabId);
      state.groupIndex += 1;
      const nextGroup = state.job.groups?.[state.groupIndex];

      if (nextGroup) {
        await saveGroupAgentState(state);
        if (state.tabId) {
          await chrome.tabs.update(
            state.tabId,
            { url: groupPostSearchUrl(nextGroup.url, nextGroup.registration), active: true },
          );
        }
      } else {
        await chrome.storage.local.set({
          [LAST_GROUP_STATUS_BATCH_KEY]: {
            jobId: state.job.id,
            productKey: state.job.productKey,
            results: state.results,
          },
        });
        await broadcastToCrm({
          type: "GROUP_POST_STATUS_COMPLETE",
          jobId: state.job.id,
          productKey: state.job.productKey,
          results: state.results,
        }, state.crmTabId);
        await clearGroupAgentState();
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "STORE_GROUP_POST_JOB") {
      const job = message.job;
      if (!job?.id || !job?.groupUrl || !job?.caption) {
        sendResponse({ ok: false, error: "Invalid Facebook group post job." });
        return;
      }
      if (job.renewal) {
        sendResponse(await withRenewalLock(() => startRenewalJob(job, sender)));
        return;
      }
      const pending = {
        job,
        crmTabId: sender?.tab?.id || null,
        storedAt: Date.now(),
        tabId: null,
      };
      await chrome.storage.local.set({ [GROUP_POST_JOB_KEY]: pending });
      const tab = await chrome.tabs.create({ url: job.groupUrl, active: true });
      pending.tabId = tab.id || null;
      await chrome.storage.local.set({ [GROUP_POST_JOB_KEY]: pending });
      sendResponse({ ok: true, jobId: job.id, tabId: pending.tabId });
      return;
    }

    if (message?.type === "GET_PENDING_GROUP_POST_JOB") {
      const renewal = await withRenewalLock(async () => {
        const state = await readRenewal();
        const current = state.pending;
        if (!current || current.tabId !== sender?.tab?.id ||
            canonicalGroupUrl(sender.url) !== current.job.groupUrl) return null;
        if (current.prepared) {
          await finishRenewal(state, { status: "needs_attention", reason: "The prepared browser draft was interrupted. Check Facebook before retrying.",
            duplicateRisk: Boolean(current.submissionStarted || !current.job.renewal.automatic) });
          return null;
        }
        return current.job;
      });
      if (renewal) { sendResponse({ ok: true, job: renewal }); return; }
      const pending = await getPendingGroupPost();
      if (pending?.tabId && sender?.tab?.id && pending.tabId !== sender.tab.id) {
        sendResponse({ ok: true, job: null });
        return;
      }
      sendResponse({ ok: true, job: pending?.job || null });
      return;
    }

    if (["GET_GROUP_RENEWAL_STATE", "ACK_GROUP_RENEWAL_RESULT", "OPEN_GROUP_RENEWAL_DRAFT", "SET_GROUP_RENEWAL_AUTOMATION",
        "GET_GROUP_RENEWAL_PAIRING", "CLEAR_GROUP_RENEWAL_PAIRING", "WAKE_GROUP_RENEWAL_WORKER",
        "GROUP_RENEWAL_READY", "BEGIN_GROUP_RENEWAL_SUBMISSION", "GROUP_RENEWAL_OUTCOME", "ENSURE_GROUP_RENEWAL_VISIBLE"].includes(message?.type)) {
      sendResponse(await withRenewalLock(() => handleRenewalMessage(message, sender)));
      return;
    }

    if (message?.type === "GROUP_POST_FILL_COMPLETED") {
      const pending = await getPendingGroupPost();
      if (pending?.job?.id === message.jobId) {
        pending.fillCompletedAt = Date.now();
        pending.fillReport = message.results || [];
        await chrome.storage.local.set({ [GROUP_POST_JOB_KEY]: pending });

        if (message.membershipPending) {
          await broadcastToCrm({
            type: "GROUP_INSPECTION_COMPLETE",
            jobId: pending.job.id,
            productKey: pending.job.productKey || "",
            inspections: [{
              name: pending.job.groupName || "",
              url: canonicalGroupUrl(pending.job.groupUrl),
              joined: false,
              membershipPending: true,
              canPost: false,
              pageText: "Your membership is pending",
            }],
          }, pending.crmTabId);
          await chrome.storage.local.remove(GROUP_POST_JOB_KEY);
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "GROUP_POST_SUBMITTED") {
      const pending = await getPendingGroupPost();
      if (!pending || pending.job?.id !== message.jobId) {
        sendResponse({ ok: false, error: "No matching prepared Facebook group post was found." });
        return;
      }

      const event = {
        id: `group-post-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        jobId: pending.job.id,
        productKey: pending.job.productKey || "",
        groupUrl: canonicalGroupUrl(message.groupUrl || pending.job.groupUrl),
        groupName: pending.job.groupName || "",
        registration: message.registration || pending.job.registration || "",
        postedAt: message.postedAt || new Date().toISOString(),
        approvalState: message.approvalState || "submitted",
      };

      await chrome.storage.local.set({ [LAST_GROUP_POST_EVENT_KEY]: event });
      await broadcastToCrm({ type: "GROUP_POST_SUBMITTED", event }, pending.crmTabId);

      if (event.approvalState !== "accepted") {
        await upsertApprovalMonitorItem({
          productKey: event.productKey,
          groupUrl: event.groupUrl,
          groupName: event.groupName,
          registration: event.registration,
          postedAt: event.postedAt,
          approvalState: event.approvalState,
        });
        ensureApprovalAlarm();
      }

      await chrome.storage.local.remove(GROUP_POST_JOB_KEY);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "GET_LAST_GROUP_POST_EVENT") {
      const stored = await chrome.storage.local.get(LAST_GROUP_POST_EVENT_KEY);
      sendResponse({ ok: true, event: stored[LAST_GROUP_POST_EVENT_KEY] || null });
      return;
    }

    if (message?.type === "ACK_GROUP_POST_EVENT") {
      const stored = await chrome.storage.local.get(LAST_GROUP_POST_EVENT_KEY);
      if (!message.eventId || stored[LAST_GROUP_POST_EVENT_KEY]?.id === message.eventId) {
        await chrome.storage.local.remove(LAST_GROUP_POST_EVENT_KEY);
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "GET_LAST_GROUP_STATUS_EVENT") {
      const stored = await chrome.storage.local.get(LAST_GROUP_STATUS_EVENT_KEY);
      sendResponse({ ok: true, event: stored[LAST_GROUP_STATUS_EVENT_KEY] || null });
      return;
    }

    if (message?.type === "GET_GROUP_RECOVERY_SNAPSHOT") {
      const stored = await chrome.storage.local.get([
        LAST_GROUP_POST_EVENT_KEY,
        LAST_GROUP_STATUS_EVENT_KEY,
        LAST_GROUP_STATUS_BATCH_KEY,
        GROUP_AGENT_STATE_KEY,
        GROUP_POST_JOB_KEY,
      ]);
      sendResponse({
        ok: true,
        snapshot: {
          approvalItems: await getApprovalMonitorItems(),
          lastPostEvent: stored[LAST_GROUP_POST_EVENT_KEY] || null,
          lastStatusEvent: stored[LAST_GROUP_STATUS_EVENT_KEY] || null,
          lastStatusBatch: stored[LAST_GROUP_STATUS_BATCH_KEY] || null,
          agentState: stored[GROUP_AGENT_STATE_KEY] || null,
          pendingGroupPost: stored[GROUP_POST_JOB_KEY]?.job || null,
        },
      });
      return;
    }

    if (message?.type === "ACK_GROUP_STATUS_EVENT") {
      const stored = await chrome.storage.local.get(LAST_GROUP_STATUS_EVENT_KEY);
      if (!message.eventId || stored[LAST_GROUP_STATUS_EVENT_KEY]?.id === message.eventId) {
        await chrome.storage.local.remove(LAST_GROUP_STATUS_EVENT_KEY);
        await refreshApprovalBadge();
      }
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown Marketplace helper message." });
  })().catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureRenewalAlarm().catch(() => {});
  void runRenewalTick(true);
  ensureApprovalAlarm();
  refreshApprovalBadge().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  void ensureRenewalAlarm().catch(() => {});
  void runRenewalTick(true);
  ensureApprovalAlarm();
  refreshApprovalBadge().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === RENEWAL_ALARM) {
    void runRenewalTick(true);
    return;
  }
  if (alarm?.name === RENEWAL_WORK_ALARM) {
    void runRenewalTick();
    return;
  }
  if (alarm?.name !== GROUP_APPROVAL_ALARM) return;
  withRenewalLock(async () => {
    await recordApprovalHealth({ lastAlarmAt: new Date().toISOString() });
    await startAutomaticApprovalCheck();
  }).catch(() => {});
});

void ensureRenewalAlarm().catch(() => {});
void chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch(() => {});
ensureApprovalAlarm();
refreshApprovalBadge().catch(() => {});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || "";
  if (!isMarketplaceItemUrl(url)) return;

  const pending = await getPendingJob();
  if (!pending || pending.facebookTabId !== tabId || !pending.publishClickedAt) return;
  if (Date.now() - Number(pending.publishClickedAt) > PUBLISH_CONFIRM_WINDOW_MS) return;
  if (!pending.fillCompletedAt || pending.publishClickedAt < pending.fillCompletedAt) return;

  await createPublishReceipt(pending, url);
});
