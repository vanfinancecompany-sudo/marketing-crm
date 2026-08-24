import { list, put } from "@vercel/blob";

const STATUS_PATH = "carslink-sync-v1/status.json";

export const DEFAULT_CARSLINK_SYNC_STATUS = {
  automaticEnabled: true,
  checkIntervalMinutes: 60,
  forceRefreshHours: 12,
  state: "waiting",
  lastAction: "waiting",
  lastTrigger: "",
  lastCheckedAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  syncId: "",
  sourceCount: 0,
  eligibleCount: 0,
  queuedCount: 0,
  skippedCount: 0,
  fingerprint: "",
  lastError: "",
  skipped: [],
  storageConfigured: false,
};

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function normalizeStatus(value = {}) {
  return {
    ...DEFAULT_CARSLINK_SYNC_STATUS,
    ...value,
    automaticEnabled: value.automaticEnabled === undefined ? true : Boolean(value.automaticEnabled),
    sourceCount: Number(value.sourceCount || 0),
    eligibleCount: Number(value.eligibleCount || 0),
    queuedCount: Number(value.queuedCount || 0),
    skippedCount: Number(value.skippedCount || 0),
    skipped: Array.isArray(value.skipped) ? value.skipped.slice(0, 100) : [],
    storageConfigured: blobAvailable(),
  };
}

export async function loadCarslinkSyncStatus() {
  if (!blobAvailable()) return normalizeStatus();

  try {
    const result = await list({ prefix: STATUS_PATH, limit: 5 });
    const blob = (result?.blobs || []).find((item) => item?.pathname === STATUS_PATH) || result?.blobs?.[0];
    if (!blob?.url) return normalizeStatus();

    const response = await fetch(`${blob.url}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return normalizeStatus();
    return normalizeStatus(await response.json());
  } catch (error) {
    console.warn("[carslink-sync] status load fallback", error?.message || error);
    return normalizeStatus({ lastError: "CarsLink status storage could not be read." });
  }
}

export async function saveCarslinkSyncStatus(value = {}) {
  const status = normalizeStatus({ ...value, updatedAt: new Date().toISOString() });
  if (!blobAvailable()) return status;

  try {
    await put(STATUS_PATH, JSON.stringify(status, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    return { ...status, storageConfigured: true };
  } catch (error) {
    console.warn("[carslink-sync] status save fallback", error?.message || error);
    return {
      ...status,
      storageConfigured: false,
      statusStorageError: error?.message || "CarsLink status storage could not be written.",
    };
  }
}
