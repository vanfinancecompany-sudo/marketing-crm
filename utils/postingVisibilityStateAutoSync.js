import {
  fetchPostingVisibilityState,
  POSTING_HIDDEN_STORAGE_KEYS,
  readPostingHiddenIds,
  savePostingHiddenIds,
  savePostingVisibilityState,
} from "./postingVisibilityStateSync.js";
import { isThisMarketingCrmTabActive } from "./activeTabLock.js";

const SYNC_INTERVAL_MS = 2500;
const INITIAL_BACKFILL_DELAYS_MS = [500, 2000, 5000, 10000];
const PAGE_KEYS = Object.keys(POSTING_HIDDEN_STORAGE_KEYS);
let lastSnapshot = "";
let syncRunning = false;

function normalizeIds(ids) {
  const seen = new Set();
  return (Array.isArray(ids) ? ids : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function currentLocalState() {
  return PAGE_KEYS.reduce((state, pageKey) => {
    state[pageKey] = normalizeIds(readPostingHiddenIds(POSTING_HIDDEN_STORAGE_KEYS[pageKey]));
    return state;
  }, {});
}

function snapshotState(state) {
  return JSON.stringify(
    PAGE_KEYS.reduce((value, pageKey) => {
      value[pageKey] = normalizeIds(state[pageKey]).sort();
      return value;
    }, {})
  );
}

async function pushState(state) {
  if (!isThisMarketingCrmTabActive()) return;
  for (const pageKey of PAGE_KEYS) {
    if (!isThisMarketingCrmTabActive()) return;
    await savePostingVisibilityState(pageKey, state[pageKey]).catch(() => {});
  }
  lastSnapshot = snapshotState(state);
}

async function hydrateOnce() {
  if (!isThisMarketingCrmTabActive()) return;
  const serverState = await fetchPostingVisibilityState();
  if (!isThisMarketingCrmTabActive()) return;

  for (const pageKey of PAGE_KEYS) {
    const storageKey = POSTING_HIDDEN_STORAGE_KEYS[pageKey];
    const localIds = normalizeIds(readPostingHiddenIds(storageKey));
    const serverIds = normalizeIds(serverState[pageKey]);
    const mergedIds = normalizeIds([...localIds, ...serverIds]);
    savePostingHiddenIds(storageKey, mergedIds);
  }

  const mergedState = currentLocalState();
  await pushState(mergedState);
}

async function forceBrowserBackfill() {
  if (syncRunning || !isThisMarketingCrmTabActive()) return;

  syncRunning = true;
  try {
    await pushState(currentLocalState());
  } finally {
    syncRunning = false;
  }
}

async function pushChangesIfNeeded() {
  if (syncRunning || !isThisMarketingCrmTabActive()) return;

  const state = currentLocalState();
  const nextSnapshot = snapshotState(state);
  if (nextSnapshot === lastSnapshot) return;

  syncRunning = true;
  try {
    await pushState(state);
  } finally {
    syncRunning = false;
  }
}

if (typeof window !== "undefined" && window.localStorage) {
  window.setTimeout(() => {
    if (!isThisMarketingCrmTabActive()) return;
    hydrateOnce().catch(() => {
      lastSnapshot = snapshotState(currentLocalState());
    });
  }, 0);

  for (const delay of INITIAL_BACKFILL_DELAYS_MS) {
    window.setTimeout(() => {
      void forceBrowserBackfill();
    }, delay);
  }

  window.setInterval(() => {
    void pushChangesIfNeeded();
  }, SYNC_INTERVAL_MS);
}
