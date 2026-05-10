const POSTING_STATE_URL = "/api/posting-state";
const PAGE_KEYS = ["vanFinanceFacebook", "rent2BuyFacebook", "marketplace"];
const STORAGE_KEYS = {
  vanFinanceFacebook: "marketingHiddenVanFinanceFacebookVehicles",
  rent2BuyFacebook: "marketingHiddenRent2BuyFacebookVehicles",
  marketplace: "marketingHiddenMarketplaceVehicles",
};

function normalizeId(value) {
  return String(value ?? "").trim();
}

function safeParseIds(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeId).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveLocal(pageKey, ids) {
  const storageKey = STORAGE_KEYS[pageKey];
  if (!storageKey) return;
  const unique = Array.from(new Set((ids || []).map(normalizeId).filter(Boolean)));
  if (unique.length) localStorage.setItem(storageKey, JSON.stringify(unique));
  else localStorage.removeItem(storageKey);
}

function readLocal(pageKey) {
  const storageKey = STORAGE_KEYS[pageKey];
  return storageKey ? safeParseIds(localStorage.getItem(storageKey)) : [];
}

async function fetchRemoteState() {
  const response = await fetch(`${POSTING_STATE_URL}?t=${Date.now()}`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not load posting state.");
  return Array.isArray(payload.states) ? payload.states : [];
}

async function pushRemoteState(pageKey, ids) {
  const response = await fetch(POSTING_STATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ pageKey, hiddenVehicleIds: ids }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not save posting state.");
}

export async function hydratePostingHiddenState() {
  if (typeof window === "undefined") return;

  try {
    const rows = await fetchRemoteState();
    const grouped = Object.fromEntries(PAGE_KEYS.map((key) => [key, []]));

    rows.forEach((row) => {
      const pageKey = row?.page_key;
      const vehicleId = normalizeId(row?.vehicle_id);
      if (PAGE_KEYS.includes(pageKey) && vehicleId) grouped[pageKey].push(vehicleId);
    });

    PAGE_KEYS.forEach((pageKey) => {
      const localIds = readLocal(pageKey);
      const remoteIds = grouped[pageKey] || [];
      const merged = Array.from(new Set([...remoteIds, ...localIds]));
      saveLocal(pageKey, merged);
      if (merged.length !== remoteIds.length || merged.some((id) => !remoteIds.includes(id))) {
        void pushRemoteState(pageKey, merged).catch(() => {});
      }
    });
  } catch {
    // Local storage remains the fallback if the API/table is not ready.
  }
}

export function syncPostingHiddenState(pageKey, ids) {
  if (!PAGE_KEYS.includes(pageKey)) return;
  void pushRemoteState(pageKey, ids).catch(() => {});
}

export function installPostingStateLocalStorageSync() {
  if (typeof window === "undefined" || window.__postingStateSyncInstalled) return;
  window.__postingStateSyncInstalled = true;

  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = (key, value) => {
    originalSetItem(key, value);
    const pageKey = PAGE_KEYS.find((candidate) => STORAGE_KEYS[candidate] === key);
    if (pageKey) syncPostingHiddenState(pageKey, safeParseIds(value));
  };

  localStorage.removeItem = (key) => {
    originalRemoveItem(key);
    const pageKey = PAGE_KEYS.find((candidate) => STORAGE_KEYS[candidate] === key);
    if (pageKey) syncPostingHiddenState(pageKey, []);
  };
}
