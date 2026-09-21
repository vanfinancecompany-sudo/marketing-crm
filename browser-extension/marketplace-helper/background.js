const PENDING_JOB_KEY = "vfcPendingMarketplaceJob";
const LAST_RECEIPT_KEY = "vfcLastMarketplaceReceipt";
const PUBLISH_CONFIRM_WINDOW_MS = 10 * 60 * 1000;
const GROUP_AGENT_STATE_KEY = "vfcFacebookGroupsAgentState";
const GROUP_POST_JOB_KEY = "vfcPendingFacebookGroupPost";

function clean(value) {
  return String(value ?? "").trim();
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
  await clearPendingJob();
  await broadcastReceipt(receipt, pending.crmTabId);
  return receipt;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
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
      const tab = await chrome.tabs.create({ url: groupAboutUrl(job.groups[0]?.url), active: true });
      state.tabId = tab.id || null;
      await saveGroupAgentState(state);
      sendResponse({ ok: true, jobId: job.id, tabId: state.tabId });
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

    if (message?.type === "STORE_GROUP_POST_JOB") {
      const job = message.job;
      if (!job?.id || !job?.groupUrl || !job?.caption) {
        sendResponse({ ok: false, error: "Invalid Facebook group post job." });
        return;
      }
      const pending = {
        job,
        crmTabId: sender?.tab?.id || null,
        storedAt: Date.now(),
        tabId: null,
      };
      const tab = await chrome.tabs.create({ url: job.groupUrl, active: true });
      pending.tabId = tab.id || null;
      await chrome.storage.local.set({ [GROUP_POST_JOB_KEY]: pending });
      sendResponse({ ok: true, jobId: job.id, tabId: pending.tabId });
      return;
    }

    if (message?.type === "GET_PENDING_GROUP_POST_JOB") {
      const pending = await getPendingGroupPost();
      if (pending?.tabId && sender?.tab?.id && pending.tabId !== sender.tab.id) {
        sendResponse({ ok: true, job: null });
        return;
      }
      sendResponse({ ok: true, job: pending?.job || null });
      return;
    }

    if (message?.type === "GROUP_POST_FILL_COMPLETED") {
      const pending = await getPendingGroupPost();
      if (pending?.job?.id === message.jobId) {
        await chrome.storage.local.remove(GROUP_POST_JOB_KEY);
      }
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown Marketplace helper message." });
  })().catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || "";
  if (!isMarketplaceItemUrl(url)) return;

  const pending = await getPendingJob();
  if (!pending || pending.facebookTabId !== tabId || !pending.publishClickedAt) return;
  if (Date.now() - Number(pending.publishClickedAt) > PUBLISH_CONFIRM_WINDOW_MS) return;
  if (!pending.fillCompletedAt || pending.publishClickedAt < pending.fillCompletedAt) return;

  await createPublishReceipt(pending, url);
});
