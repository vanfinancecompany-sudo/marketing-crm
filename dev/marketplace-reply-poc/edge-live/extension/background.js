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
  if (status.mode === "off") return;
  const tab = await ensureTab();
  // Nudge the content script; background timers are throttled by the browser.
  chrome.tabs.sendMessage(tab.id, { type: "tick" }).catch(() => {});
  if (hb && Date.now() - Date.parse(hb.at) > STALE_HEARTBEAT_MS && !tab.status?.includes("loading")) {
    await chrome.tabs.reload(tab.id);
  }
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create("supervise", { periodInMinutes: 0.5 }); supervise(); });
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
    throw new Error("Unknown message");
  })().then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
