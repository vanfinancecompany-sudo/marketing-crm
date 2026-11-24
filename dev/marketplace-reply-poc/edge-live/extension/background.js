// Owns the single dedicated assistant tab and relays content-script calls to the
// local service. Facebook pages cannot reach 127.0.0.1 directly (Private Network
// Access), so every service call goes through this worker.
const SERVICE = "http://127.0.0.1:4618";
const DEFAULT_HOME = "https://www.facebook.com/marketplace/inbox/";
const STALE_HEARTBEAT_MS = 180_000;

// The tab ID lives in session storage: Edge reuses tab IDs after a restart, so a
// persisted ID could point at an unrelated tab.
async function settings() {
  const { home } = await chrome.storage.local.get("home");
  const { tabId } = await chrome.storage.session.get("tabId");
  return { home: home || DEFAULT_HOME, tabId: tabId ?? null };
}

// Profile lock: each Edge profile's copy of the extension has its own ID. The
// service accepts monitoring and sending from the one authorised profile only.
let instanceIdCache = null;
async function instanceId() {
  if (instanceIdCache) return instanceIdCache;
  let { instanceId: id } = await chrome.storage.local.get("instanceId");
  if (!id) { id = crypto.randomUUID(); await chrome.storage.local.set({ instanceId: id }); }
  return (instanceIdCache = id);
}
let authorisedHere = null; // false when the service has authorised another profile

async function api(path, body) {
  const response = await fetch(SERVICE + path, body === undefined ? { cache: "no-store" } : {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-r2b-assistant": "1", "x-r2b-instance": await instanceId() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Service HTTP " + response.status);
  return response.json();
}

async function isMarked(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: "marker" });
    return reply?.marked === true;
  } catch {
    return false;
  }
}

// After an Edge restart tab IDs change. Adopt the restored assistant tab (it
// carries a session marker) instead of opening a duplicate.
// A tab the assistant created or adopted earlier in this Edge session is
// re-adopted even if its page does not answer (busy or reloading). The marker
// check is retried, and at most one new tab is created per 10 minutes.
const CREATE_GAP_MS = 600_000;
async function ensureTab(status = {}) {
  const { home, tabId } = await settings();
  let tab = tabId === null ? null : await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    const { ourTabs = [] } = await chrome.storage.session.get("ourTabs");
    for (const id of ourTabs.slice().reverse()) {
      tab = await chrome.tabs.get(id).catch(() => null);
      if (tab) { tabEvent("assistant-tab-adopted", { tabId: tab.id, previousTabId: tabId, how: "tab the assistant created or adopted earlier" }); break; }
    }
  }
  if (!tab) {
    const candidates = await chrome.tabs.query({ pinned: true, url: ["https://www.facebook.com/*", "http://127.0.0.1:4618/__fb/*"] });
    for (let attempt = 0; attempt < 3 && !tab; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1_500));
      for (const candidate of candidates) {
        if (candidate.discarded) continue;
        if (await isMarked(candidate.id)) { tab = candidate; break; }
      }
    }
    if (tab) tabEvent("assistant-tab-adopted", { tabId: tab.id, previousTabId: tabId, how: "pinned tab carrying the assistant marker", candidates: candidates.length });
  }
  if (!tab) {
    const { lastTabCreatedAt = 0 } = await chrome.storage.local.get("lastTabCreatedAt");
    if (Date.now() - lastTabCreatedAt < (status.tabCreateGapMs ?? CREATE_GAP_MS)) {
      tabEvent("assistant-tab-not-created", { previousTabId: tabId, why: "a tab was created less than 10 minutes ago" });
      return null;
    }
    await chrome.storage.local.set({ lastTabCreatedAt: Date.now() });
    // The only place the assistant ever creates a tab.
    const reason = tabId === null ? "no assistant tab recorded in this Edge session" : "recorded assistant tab " + tabId + " no longer exists";
    creatingTab = { reason, at: Date.now() };
    // In the dedicated assistant profile the tab is the active one in its window.
    tab = await chrome.tabs.create({ url: home, pinned: true, active: status.dedicatedProfile === true });
    tabEvent("assistant-tab-created", { tabId: tab.id, reason });
  }
  await chrome.storage.session.set({ tabId: tab.id });
  const { ourTabs = [] } = await chrome.storage.session.get("ourTabs");
  if (!ourTabs.includes(tab.id)) await chrome.storage.session.set({ ourTabs: [...ourTabs, tab.id].slice(-10) });
  if (tab.discarded) await chrome.tabs.reload(tab.id);
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  return tab;
}

async function badge(mode, healthy) {
  const text = { off: "OFF", observe: "OBS", draft: "DRF", send: "ON" }[mode] ?? "!";
  await chrome.action.setBadgeText({ text: healthy ? text : "!" });
  await chrome.action.setBadgeBackgroundColor({ color: !healthy ? "#c62828" : mode === "send" ? "#2e7d32" : mode === "off" ? "#757575" : "#1b74e4" });
}

async function supervise() {
  let status;
  try {
    status = await api("/status");
  } catch {
    await badge(null, false);
    return;
  }
  // Another Edge profile runs the assistant: this one stays idle (no tabs, no
  // monitoring). It reports only its presence, so the owner can switch back.
  authorisedHere = !status.authorisedInstance || status.authorisedInstance === await instanceId();
  if (!authorisedHere) {
    await chrome.action.setBadgeText({ text: "IDLE" });
    await chrome.action.setBadgeBackgroundColor({ color: "#757575" });
    api("/instance-ping", { ext: chrome.runtime.getManifest().version }).catch(() => {});
    return;
  }
  api("/tab-census", await tabCensus()).catch(() => {});
  const { replyTabId, replyTabAt = 0 } = await chrome.storage.session.get(["replyTabId", "replyTabAt"]);
  if (replyTabId != null && Date.now() - replyTabAt > REPLY_TAB_MAX_MS) await closeReplyTab("time limit");
  const hb = status.heartbeat;
  await badge(status.mode, status.mode === "off" || (hb?.health === "healthy" && Date.now() - Date.parse(hb.at) < STALE_HEARTBEAT_MS));
  if (status.fixtureHome) await chrome.storage.local.set({ home: status.fixtureHome });
  if (await selfUpdateIfNeeded(status.extension?.expected)) return;
  if (status.mode === "off") return;
  const tab = await ensureTab(status);
  if (!tab) return;
  // Dedicated assistant profile (nothing else lives there): keep the assistant
  // tab the active tab of its window, so Facebook keeps drawing the Marketplace
  // list without anyone bringing it forward. A minimised window is restored,
  // without taking focus, only when the PC has been idle for 2 minutes.
  if (status.dedicatedProfile === true) {
    if (!tab.active) {
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      tabEvent("assistant-tab-activated", { tabId: tab.id, why: "dedicated profile: keep the assistant tab active in its window" });
    }
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    if (win?.state === "minimized" && (await chrome.idle.queryState(120)) !== "active") {
      await chrome.windows.update(tab.windowId, { state: "normal", focused: false }).catch(() => {});
      tabEvent("assistant-window-restored", { tabId: tab.id, why: "dedicated profile window was minimised; PC idle" });
    }
  }
  // Nudge the content script; background timers are throttled by the browser.
  chrome.tabs.sendMessage(tab.id, { type: "tick" }).catch(() => {});
  // Silent tab (no report for 3 minutes). Live (24 Nov 13:38): after a Facebook
  // sign-out and sign-in in the assistant tab, its page script stopped and the
  // tab was never revived. Now: a tab that left Facebook goes back to the
  // Marketplace page; otherwise it is reloaded, even if Edge still reports it as
  // loading once it has been silent for 6 minutes. At most once every 90 s.
  const silentMs = hb ? Date.now() - Date.parse(hb.at) : 0;
  if (silentMs > STALE_HEARTBEAT_MS) {
    const { lastRecoverAt = 0 } = await chrome.storage.session.get("lastRecoverAt");
    if (Date.now() - lastRecoverAt > 90_000) {
      const { home } = await settings();
      const onFacebook = /^https:\/\/www\.facebook\.com\/|^http:\/\/127\.0\.0\.1:\d+\/__fb\//.test(tab.url || tab.pendingUrl || "");
      if (!onFacebook) {
        await chrome.storage.session.set({ lastRecoverAt: Date.now() });
        await chrome.tabs.update(tab.id, { url: home });
        tabEvent("assistant-tab-recovered", { tabId: tab.id, how: "returned to the Marketplace page", url: urlPattern(tab.url || tab.pendingUrl || "") });
      } else if (!tab.status?.includes("loading") || silentMs > 2 * STALE_HEARTBEAT_MS) {
        await chrome.storage.session.set({ lastRecoverAt: Date.now() });
        await chrome.tabs.reload(tab.id);
        tabEvent("assistant-tab-recovered", { tabId: tab.id, how: "reloaded", status: tab.status || "", url: urlPattern(tab.url || "") });
      }
    }
  }
}

// ---- Visibility assist (idle only) ----
// Live (23 Nov 2026, 20:27-20:31): with the assistant tab hidden, every way of
// clicking the Marketplace entry left the Chats view in place, although the same
// click worked at 19:31 when the tab had just been brought to the front. When the
// click has failed repeatedly AND the PC has had no keyboard or mouse input for
// 2 minutes, bring the assistant tab to the front for at most 12 seconds, then
// return to the tab that was active. Never while the owner is using the PC; at
// most once every 10 minutes.
const ASSIST_IDLE_SECONDS = 120;
const ASSIST_MAX_MS = 12_000;
const ASSIST_GAP_MS = 600_000;
let assistRunning = false;
async function visibilityAssist(tab) {
  const { tabId } = await chrome.storage.session.get("tabId");
  if (!tab || tab.id !== tabId) return { ok: false, why: "not the assistant tab" };
  const { lastAssistAt = 0 } = await chrome.storage.local.get("lastAssistAt");
  if (assistRunning || Date.now() - lastAssistAt < ASSIST_GAP_MS) return { ok: false, why: "waiting" };
  const idle = await chrome.idle.queryState(ASSIST_IDLE_SECONDS);
  if (idle !== "idle") return { ok: false, why: "the PC is " + idle };
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!win || win.state === "minimized") return { ok: false, why: "the Edge window is minimised" };
  assistRunning = true;
  await chrome.storage.local.set({ lastAssistAt: Date.now() });
  const [previous] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  let opened = false;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    const end = Date.now() + ASSIST_MAX_MS;
    while (Date.now() < end && !opened) {
      await new Promise((r) => setTimeout(r, 700));
      opened = (await api("/status").catch(() => null))?.heartbeat?.list === "marketplace";
    }
  } finally {
    if (previous && previous.id !== tab.id) await chrome.tabs.update(previous.id, { active: true }).catch(() => {});
    assistRunning = false;
  }
  await api("/assist", { opened, ms: ASSIST_MAX_MS }).catch(() => {});
  return { ok: opened };
}

// ---- Reply tab ----
// Conversations are opened in a separate, unpinned, background tab so the
// monitoring tab never leaves the Marketplace list. One reply tab at a time; it
// closes itself when done and is closed after 3 minutes at the latest.
const REPLY_TAB_MAX_MS = 180_000;
// Service paths only the monitoring tab may use (the reply tab reads one
// conversation through /thread, /go and /sent, nothing else).
const MONITOR_ONLY = /^\/(?:heartbeat|inbox|opener\/permit|opener-note|pilot\/verify|find\/result|diagnostics)(?:[/?]|$)/;
async function openReplyTab(monitorTab, url) {
  const { tabId } = await chrome.storage.session.get("tabId");
  if (!monitorTab || monitorTab.id !== tabId) return { ok: false };
  if (!/^https:\/\/www\.facebook\.com\/messages\/t\/\d+\/?$|^http:\/\/127\.0\.0\.1:\d+\/__fb\/messages\/t\/\d+\/?$/.test(String(url))) return { ok: false };
  const { replyTabId, replyTabAt = 0 } = await chrome.storage.session.get(["replyTabId", "replyTabAt"]);
  const existing = replyTabId == null ? null : await chrome.tabs.get(replyTabId).catch(() => null);
  if (existing) return { ok: true, already: true };
  creatingReplyTab = true;
  const tab = await chrome.tabs.create({ url, active: false, pinned: false, windowId: monitorTab.windowId, index: monitorTab.index + 1 });
  await chrome.storage.session.set({ replyTabId: tab.id, replyTabAt: Date.now() });
  tabEvent("reply-tab-opened", { tabId: tab.id, url: urlPattern(url) });
  return { ok: true };
}
let creatingReplyTab = false;
async function closeReplyTab(why) {
  const { replyTabId } = await chrome.storage.session.get("replyTabId");
  if (replyTabId == null) return;
  await chrome.storage.session.remove(["replyTabId", "replyTabAt"]);
  await chrome.tabs.remove(replyTabId).catch(() => {});
  tabEvent("reply-tab-closed", { tabId: replyTabId, why });
}
chrome.tabs.onRemoved.addListener(async (id) => {
  const { replyTabId } = await chrome.storage.session.get("replyTabId");
  if (id === replyTabId) await chrome.storage.session.remove(["replyTabId", "replyTabAt"]);
});

// ---- Tab diagnostics ----
// Every new tab is recorded with who created it: the assistant's own tab
// recovery (ensureTab, with its reason), a page in the assistant tab (Edge's
// openerTabId), another tab, or nothing (Edge, Windows or a notification).
// Only URL patterns are recorded: host and path, digits masked, no query.
let creatingTab = null;
const urlPattern = (url) => {
  try { const u = new URL(url); return u.host + u.pathname.replace(/\d{3,}/g, "#"); } catch { return url ? "(unparsed)" : "(none yet)"; }
};
function tabEvent(kind, detail) { api("/tab-event", { kind, ...detail }).catch(() => {}); }
chrome.tabs.onCreated.addListener(async (tab) => {
  const { tabId: assistantTabId } = await chrome.storage.session.get("tabId");
  const byAssistant = creatingReplyTab ? "assistant reply tab for one conversation"
    : creatingTab && Date.now() - creatingTab.at < 5_000 ? creatingTab.reason : null;
  creatingReplyTab = false;
  if (byAssistant) creatingTab = null;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  tabEvent("tab-created", {
    tabId: tab.id,
    createdBy: byAssistant ? "assistant tab recovery: " + byAssistant
      : tab.openerTabId != null && tab.openerTabId === assistantTabId ? "a page in the assistant tab (opener " + tab.openerTabId + ")"
      : tab.openerTabId != null ? "another tab (opener " + tab.openerTabId + ")"
      : "no opener tab (Edge, Windows, a notification or the owner)",
    openerTabId: tab.openerTabId ?? null,
    assistantTabId: assistantTabId ?? null,
    url: urlPattern(tab.pendingUrl || tab.url),
    active: tab.active, pinned: tab.pinned, windowType: win?.type || null, windowFocused: win?.focused ?? null,
  });
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  // The first real URL of a tab created in the last 30 s (new tabs often start blank).
  if (change.url && recentTabs.has(id)) { recentTabs.delete(id); tabEvent("tab-url", { tabId: id, url: urlPattern(change.url), openerTabId: tab.openerTabId ?? null }); }
});
const recentTabs = new Set();
chrome.tabs.onCreated.addListener((tab) => { recentTabs.add(tab.id); setTimeout(() => recentTabs.delete(tab.id), 30_000); });
chrome.tabs.onRemoved.addListener(async (id) => {
  const { tabId } = await chrome.storage.session.get("tabId");
  if (id === tabId) tabEvent("assistant-tab-removed", { tabId: id });
});
chrome.tabs.onReplaced.addListener(async (added, removed) => {
  const { tabId } = await chrome.storage.session.get("tabId");
  if (removed === tabId) { await chrome.storage.session.set({ tabId: added }); tabEvent("assistant-tab-replaced", { tabId: added, previousTabId: removed }); }
});
chrome.windows.onCreated.addListener((win) => tabEvent("window-created", { windowId: win.id, windowType: win.type }));
async function tabCensus() {
  const tabs = await chrome.tabs.query({});
  const facebook = tabs.filter((t) => /^https:\/\/(www\.)?facebook\.com\//.test(t.url || t.pendingUrl || ""));
  const { tabId } = await chrome.storage.session.get("tabId");
  const assistant = tabs.find((t) => t.id === tabId);
  return { tabs: tabs.length, facebookTabs: facebook.length, pinnedFacebookTabs: facebook.filter((t) => t.pinned).length, assistantTabId: tabId ?? null,
    assistantTitleMarked: assistant ? (assistant.title || "").startsWith("[Assistant]") : null,
    assistantUrl: assistant ? urlPattern(assistant.url || assistant.pendingUrl || "") : null, assistantStatus: assistant?.status || null };
}

// ---- Owner-requested: show the assistant tab for a few seconds ----
// Facebook draws list rows and the Marketplace view only while the tab is on
// screen. On the owner's request (control page / service), bring the assistant
// tab to the front for N seconds (max 20), then return to the previous tab.
let showing = false;
async function showAssistantTab(tab, seconds) {
  const { tabId } = await chrome.storage.session.get("tabId");
  if (!tab || tab.id !== tabId || showing) return { ok: false };
  showing = true;
  const [previous] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  // A tab in a minimised window is never drawn (live, 23:22): restore the window
  // for these seconds, then minimise it again.
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  const wasMinimized = win?.state === "minimized";
  // Live (08:01): the window was not minimised but behind other windows, so the
  // tab stayed hidden. Always bring the window to the front for these seconds.
  const wasFocused = win?.focused === true;
  const ms = Math.min(Math.max(Number(seconds) || 10, 3), 20) * 1000;
  tabEvent("assistant-tab-shown", { tabId: tab.id, seconds: ms / 1000, previousTabId: previous?.id ?? null, windowWasMinimised: wasMinimized });
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (wasMinimized) await chrome.windows.update(tab.windowId, { state: "normal", focused: true }).catch(() => {});
    // Windows will not let a background app take focus (live, 08:04: Claude stayed
    // in front). Restoring from minimised is allowed and brings the window up.
    else if (!wasFocused) {
      await chrome.windows.update(tab.windowId, { state: "minimized" }).catch(() => {});
      await chrome.windows.update(tab.windowId, { state: "normal", focused: true }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, ms));
  } finally {
    if (previous && previous.id !== tab.id) await chrome.tabs.update(previous.id, { active: true }).catch(() => {});
    if (wasMinimized) await chrome.windows.update(tab.windowId, { state: "minimized" }).catch(() => {});
    else if (!wasFocused) await chrome.windows.update(tab.windowId, { focused: false }).catch(() => {});
    showing = false;
  }
  return { ok: true };
}

// ---- Self-update ----
// The service reports the extension version on disk in this install. When it is
// newer than the running one (after a git pull), the extension reloads itself,
// then reloads the assistant tab so the new content script runs. At most one
// attempt per version every 10 minutes, so a mismatch can never loop.
const newer = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};
async function selfUpdateIfNeeded(expected) {
  if (!expected || !newer(expected, chrome.runtime.getManifest().version)) return false;
  const { lastSelfUpdate } = await chrome.storage.local.get("lastSelfUpdate");
  if (lastSelfUpdate?.version === expected && Date.now() - lastSelfUpdate.at < 600_000) return false;
  const { tabId } = await chrome.storage.session.get("tabId");
  await chrome.storage.local.set({ lastSelfUpdate: { version: expected, at: Date.now() }, reloadTabAfterUpdate: tabId ?? null });
  chrome.runtime.reload();
  return true;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.alarms.create("supervise", { periodInMinutes: 0.5 });
  if (details.reason === "update") {
    const { reloadTabAfterUpdate } = await chrome.storage.local.get("reloadTabAfterUpdate");
    await chrome.storage.local.remove("reloadTabAfterUpdate");
    const tab = reloadTabAfterUpdate == null ? null : await chrome.tabs.get(reloadTabAfterUpdate).catch(() => null);
    if (tab) {
      await chrome.storage.session.set({ tabId: tab.id });
      await chrome.tabs.reload(tab.id);
    }
  }
  supervise();
});
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create("supervise", { periodInMinutes: 0.5 }); supervise(); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "supervise") supervise(); });
chrome.commands.onCommand.addListener((command) => {
  if (command === "emergency-stop") api("/stop", {}).then((s) => badge(s.mode, true)).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "whoami") {
      const { home, tabId } = await settings();
      const { replyTabId } = await chrome.storage.session.get("replyTabId");
      const isReply = sender.tab?.id != null && sender.tab.id === replyTabId;
      return { assistant: authorisedHere !== false && (sender.tab?.id === tabId || isReply), role: isReply ? "worker" : "monitor", home };
    }
    if (message.type === "open-conversation") return openReplyTab(sender.tab, message.url);
    if (message.type === "close-reply-tab") {
      const { replyTabId } = await chrome.storage.session.get("replyTabId");
      if (sender.tab?.id === replyTabId) await closeReplyTab("finished");
      return { ok: true };
    }
    if (message.type === "api" && typeof message.path === "string" && message.path.startsWith("/")) {
      // Only the assistant tab and the popup may talk to the service.
      const { tabId } = await settings();
      const { replyTabId } = await chrome.storage.session.get("replyTabId");
      if (sender.tab && sender.tab.id !== tabId && sender.tab.id !== replyTabId) throw new Error("Not the assistant tab");
      // Monitoring reports come from the monitoring tab only, never the reply tab.
      if (sender.tab && sender.tab.id === replyTabId && MONITOR_ONLY.test(message.path)) throw new Error("Monitoring report from the reply tab");
      return api(message.path, message.body);
    }
    if (message.type === "supervise") { await supervise(); return { ok: true }; }
    if (message.type === "need-visibility") return visibilityAssist(sender.tab);
    if (message.type === "show-assistant-tab") return showAssistantTab(sender.tab, message.seconds);
    // Popup only: read-only structural snapshot of the Facebook tab you are looking at.
    if (message.type === "diagnose-active" && !sender.tab) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab || !/^https:\/\/www\.facebook\.com\/|^http:\/\/127\.0\.0\.1:4618\/__fb\//.test(tab.url || "")) throw new Error("Open a Facebook tab first");
      const reply = await chrome.tabs.sendMessage(tab.id, { type: "diagnose" });
      if (!reply?.snapshot) throw new Error(reply?.error || "No snapshot from the page; reload the Facebook tab");
      await api("/diagnostics", { source: "your-tab", snapshot: reply.snapshot });
      const s = reply.snapshot;
      return { rows: s.rows.length, unread: s.rows.filter((r) => r.unread).length, path: s.path };
    }
    throw new Error("Unknown message");
  })().then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
