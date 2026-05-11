const POSTING_VISIBILITY_API = "/api/posting-visibility-state";

export const POSTING_HIDDEN_STORAGE_KEYS = {
  vanFinanceFacebook: "marketingHiddenVanFinanceFacebookVehicles",
  rent2BuyFacebook: "marketingHiddenRent2BuyFacebookVehicles",
  marketplace: "marketingHiddenMarketplaceVehicles",
};

function normalizeHiddenIds(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

export function readPostingHiddenIds(storageKey) {
  if (typeof window === "undefined") return [];

  try {
    return normalizeHiddenIds(JSON.parse(window.localStorage.getItem(storageKey) || "[]"));
  } catch {
    return [];
  }
}

export function savePostingHiddenIds(storageKey, ids) {
  if (typeof window === "undefined") return;

  const normalized = normalizeHiddenIds(ids);
  if (normalized.length) {
    window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  } else {
    window.localStorage.removeItem(storageKey);
  }
}

export async function fetchPostingVisibilityState() {
  const response = await fetch(`${POSTING_VISIBILITY_API}?t=${Date.now()}`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || "Could not load posting visibility state.");
  }

  return payload.state || {};
}

export async function savePostingVisibilityState(pageKey, hiddenIds) {
  const response = await fetch(POSTING_VISIBILITY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ pageKey, hiddenIds: normalizeHiddenIds(hiddenIds) }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || "Could not save posting visibility state.");
  }

  return payload.state;
}

export async function hydratePostingHiddenIdsFromServer() {
  if (typeof window === "undefined") return null;

  const serverState = await fetchPostingVisibilityState();
  const mergedState = {};

  for (const [pageKey, storageKey] of Object.entries(POSTING_HIDDEN_STORAGE_KEYS)) {
    const localIds = readPostingHiddenIds(storageKey);
    const serverIds = normalizeHiddenIds(serverState[pageKey]);
    const mergedIds = normalizeHiddenIds([...localIds, ...serverIds]);
    savePostingHiddenIds(storageKey, mergedIds);
    mergedState[pageKey] = mergedIds;

    if (mergedIds.length !== serverIds.length) {
      await savePostingVisibilityState(pageKey, mergedIds).catch(() => {});
    }
  }

  return mergedState;
}
