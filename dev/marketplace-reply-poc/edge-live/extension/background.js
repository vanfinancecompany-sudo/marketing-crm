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

async function api(path, body) {
  const response = await fetch(SERVICE + path, body === undefined ? { cache: "no-store" } : {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-r2b-assistant": "1" },
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
async function ensureTab() {
  const { home, tabId } = await settings();
  let tab = tabId === null ? null : await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    const candidates = await chrome.tabs.query({ pinned: true, url: ["https://www.facebook.com/*", "http://127.0.0.1:4618/__fb/*"] });
    for (const candidate of candidates) {
      if (candidate.discarded) continue;
      if (await isMarked(candidate.id)) { tab = candidate; break; }
    }
  }
  if (!tab) tab = await chrome.tabs.create({ url: home, pinned: true, active: false });
  await chrome.storage.session.set({ tabId: tab.id });
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
  const hb = status.heartbeat;
  await badge(status.mode, status.mode === "off" || (hb?.health === "healthy" && Date.now() - Date.parse(hb.at) < STALE_HEARTBEAT_MS));
  if (status.fixtureHome) await chrome.storage.local.set({ home: status.fixtureHome });
  if (await selfUpdateIfNeeded(status.extension?.expected)) return;
  if (status.mode === "off") return;
  const tab = await ensureTab();
  // Nudge the content script; background timers are throttled by the browser.
  chrome.tabs.sendMessage(tab.id, { type: "tick" }).catch(() => {});
  if (hb && Date.now() - Date.parse(hb.at) > STALE_HEARTBEAT_MS && !tab.status?.includes("loading")) {
    await chrome.tabs.reload(tab.id);
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
      return { assistant: sender.tab?.id === tabId, home };
    }
    if (message.type === "api" && typeof message.path === "string" && message.path.startsWith("/")) {
      // Only the assistant tab and the popup may talk to the service.
      const { tabId } = await settings();
      if (sender.tab && sender.tab.id !== tabId) throw new Error("Not the assistant tab");
      return api(message.path, message.body);
    }
    if (message.type === "supervise") { await supervise(); return { ok: true }; }
    if (message.type === "need-visibility") return visibilityAssist(sender.tab);
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
