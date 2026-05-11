import {
  fetchPostingVisibilityState,
  POSTING_HIDDEN_STORAGE_KEYS,
  readPostingHiddenIds,
  savePostingHiddenIds,
  savePostingVisibilityState,
} from "./postingVisibilityStateSync.js";

const SYNC_INTERVAL_MS = 2500;
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

async function hydrateOnce() {
  const serverState = await fetchPostingVisibilityState();

  for (const pageKey of PAGE_KEYS) {
    const storageKey = POSTING_HIDDEN_STORAGE_KEYS[pageKey];
    const localIds = normalizeIds(readPostingHiddenIds(storageKey));
    const serverIds = normalizeIds(serverState[pageKey]);
    const mergedIds = normalizeIds([...localIds, ...serverIds]);
    savePostingHiddenIds(storageKey, mergedIds);

    if (snapshotState({ [pageKey]: mergedIds }) !== snapshotState({ [pageKey]: serverIds })) {
      await savePostingVisibilityState(pageKey, mergedIds).catch(() => {});
    }
  }

  lastSnapshot = snapshotState(currentLocalState());
}

async function pushChangesIfNeeded() {
  if (syncRunning) return;

  const state = currentLocalState();
  const nextSnapshot = snapshotState(state);
  if (nextSnapshot === lastSnapshot) return;

  syncRunning = true;
  try {
    for (const pageKey of PAGE_KEYS) {
      await savePostingVisibilityState(pageKey, state[pageKey]).catch(() => {});
    }
    lastSnapshot = nextSnapshot;
  } finally {
    syncRunning = false;
  }
}

if (typeof window !== "undefined" && window.localStorage) {
  hydrateOnce().catch(() => {
    lastSnapshot = snapshotState(currentLocalState());
  });

  window.setInterval(() => {
    void pushChangesIfNeeded();
  }, SYNC_INTERVAL_MS);
}
