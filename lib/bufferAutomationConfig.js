import { list, put } from "@vercel/blob";
import {
  DEFAULT_BUFFER_AUTOMATION_CONFIG,
  normalizeBufferAutomationConfig,
} from "./bufferAutomation.js";

const CONFIG_PREFIX = "buffer-automation-v3/config-";
const LEGACY_CONFIG_PREFIX = "buffer-automation-v2/config-";

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function newestConfigBlob(blobs = []) {
  return [...blobs].sort((first, second) => {
    const firstTime = new Date(first?.uploadedAt || 0).getTime();
    const secondTime = new Date(second?.uploadedAt || 0).getTime();
    if (firstTime !== secondTime) return secondTime - firstTime;
    return String(second?.pathname || "").localeCompare(String(first?.pathname || ""));
  })[0] || null;
}

async function readConfigBlob(blob) {
  if (!blob?.url) return null;
  const response = await fetch(`${blob.url}?v=${encodeURIComponent(blob.pathname)}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

export async function loadBufferAutomationConfig() {
  if (!blobAvailable()) return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
  try {
    const currentResult = await list({ prefix: CONFIG_PREFIX, limit: 50 });
    const currentBlob = newestConfigBlob(currentResult?.blobs || []);
    const currentConfig = await readConfigBlob(currentBlob);
    if (currentConfig) return normalizeBufferAutomationConfig(currentConfig);

    const legacyResult = await list({ prefix: LEGACY_CONFIG_PREFIX, limit: 50 });
    const legacyBlob = newestConfigBlob(legacyResult?.blobs || []);
    const legacyConfig = await readConfigBlob(legacyBlob);
    if (legacyConfig) {
      return normalizeBufferAutomationConfig({
        ...DEFAULT_BUFFER_AUTOMATION_CONFIG,
        enabled: legacyConfig.enabled === undefined
          ? DEFAULT_BUFFER_AUTOMATION_CONFIG.enabled
          : Boolean(legacyConfig.enabled),
      });
    }

    return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
  } catch (error) {
    console.warn("[buffer-automation] config load fallback", {
      message: error?.message || String(error),
    });
    return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
  }
}

export async function saveBufferAutomationConfig(value) {
  if (!blobAvailable()) throw new Error("Vercel Blob is not configured for Buffer automation settings.");
  const config = normalizeBufferAutomationConfig({
    ...value,
    updatedAt: new Date().toISOString(),
  });
  await put(`${CONFIG_PREFIX}${Date.now()}.json`, JSON.stringify(config, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
  return config;
}
