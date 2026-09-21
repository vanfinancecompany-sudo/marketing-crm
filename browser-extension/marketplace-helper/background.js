const PENDING_JOB_KEY = "vfcPendingMarketplaceJob";
const LAST_RECEIPT_KEY = "vfcLastMarketplaceReceipt";
const PUBLISH_CONFIRM_WINDOW_MS = 10 * 60 * 1000;
const GROUP_AGENT_STATE_KEY = "vfcFacebookGroupsAgentState";
const GROUP_POST_JOB_KEY = "vfcPendingFacebookGroupPost";
const LAST_GROUP_POST_EVENT_KEY = "vfcLastFacebookGroupPostEvent";
const GROUP_APPROVAL_MONITOR_KEY = "vfcFacebookGroupApprovalMonitor";
const LAST_GROUP_STATUS_EVENT_KEY = "vfcLastFacebookGroupStatusEvent";
const GROUP_APPROVAL_ALARM = "vfcFacebookGroupApprovalMonitorAlarm";
const GROUP_APPROVAL_CHECK_MINUTES = 60;

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

async function startAutomaticApprovalCheck() {
  const activeState = await getGroupAgentState();
  if (activeState) return;

  const items = await getApprovalMonitorItems();
  if (!items.length) {
    await refreshApprovalBadge([]);
    return;
  }

  const now = Date.now();
  const due = [...items]
    .sort((a, b) => new Date(a.lastCheckedAt || a.postedAt || 0) - new Date(b.lastCheckedAt || b.postedAt || 0))
    .find((item) => {
      if (!item.lastCheckedAt) return true;
      const checkedAt = new Date(item.lastCheckedAt).getTime();
      return !Number.isFinite(checkedAt) || now - checkedAt >= GROUP_APPROVAL_CHECK_MINUTES * 60 * 1000;
    });
  if (!due) return;

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

  await saveGroupAgentState(state);
  try {
    const tab = await chrome.tabs.create({
      url: groupPostSearchUrl(due.groupUrl, due.registration),
      active: false,
    });
    state.tabId = tab.id || null;
    await saveGroupAgentState(state);
  } catch (error) {
    await clearGroupAgentState();
  }
}

function ensureApprovalAlarm() {
  try {
    chrome.alarms.create(GROUP_APPROVAL_ALARM, { periodInMinutes: GROUP_APPROVAL_CHECK_MINUTES });
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
          "groups-discovery",
          "groups-inspection",
          "groups-post-prep",
          "groups-post-status",
          "groups-auto-approval-monitor",
        ],
      });
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
        const checkedAt = result.checkedAt || new Date().toISOString();
        const event = {
          id: `group-status-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          productKey: target.productKey || state.job.productKey || "",
          groupUrl: canonicalGroupUrl(result.url || target.url || target.groupUrl),
          groupName: target.name || target.groupName || "",
          registration: result.registration || target.registration || "",
          accepted: Boolean(result.accepted),
          pending: Boolean(result.pending),
          unavailable: Boolean(result.unavailable),
          matchedUrl: result.matchedUrl || "",
          checkedAt,
        };

        if (event.accepted || event.unavailable) {
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

        await saveGroupStatusEvent(event);
        if (event.accepted) {
          try {
            await chrome.action.setBadgeText({ text: "✓" });
            await chrome.action.setTitle({ title: `${event.groupName || "Facebook group"} accepted ${event.registration || "your advert"}` });
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
        pending.fillCompletedAt = Date.now();
        pending.fillReport = message.results || [];
        await chrome.storage.local.set({ [GROUP_POST_JOB_KEY]: pending });
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
  ensureApprovalAlarm();
  refreshApprovalBadge().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureApprovalAlarm();
  refreshApprovalBadge().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== GROUP_APPROVAL_ALARM) return;
  startAutomaticApprovalCheck().catch(() => {});
});

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
