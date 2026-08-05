export const ACTIVE_TAB_LOCK_KEY = "marketing-crm-active-tab";
export const ACTIVE_TAB_CHANNEL_NAME = "marketing-crm-active-tab";
export const ACTIVE_TAB_ID_KEY = "marketing-crm-tab-id";
export const ACTIVE_TAB_HEARTBEAT_MS = 2000;
export const ACTIVE_TAB_STALE_AFTER_MS = 8000;

export function getTabId() {
  try {
    let tabId = sessionStorage.getItem(ACTIVE_TAB_ID_KEY);
    if (!tabId) {
      tabId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(ACTIVE_TAB_ID_KEY, tabId);
    }
    return tabId;
  } catch {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export function readActiveTabLock() {
  try {
    const value = localStorage.getItem(ACTIVE_TAB_LOCK_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed?.tabId || !Number.isFinite(parsed?.updatedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isActiveTabLockFresh(lock, now = Date.now()) {
  return Boolean(lock && now - lock.updatedAt < ACTIVE_TAB_STALE_AFTER_MS);
}

export function writeActiveTabLock(tabId) {
  const lock = { tabId, updatedAt: Date.now() };
  localStorage.setItem(ACTIVE_TAB_LOCK_KEY, JSON.stringify(lock));
  return lock;
}

export function isThisMarketingCrmTabActive() {
  if (typeof window === "undefined") return true;
  const lock = readActiveTabLock();
  return Boolean(lock && lock.tabId === getTabId() && isActiveTabLockFresh(lock));
}
