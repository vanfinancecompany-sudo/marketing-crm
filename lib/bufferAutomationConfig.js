import { list, put } from "@vercel/blob";
import {
  DEFAULT_BUFFER_AUTOMATION_CONFIG,
  normalizeBufferAutomationConfig,
} from "./bufferAutomation.js";

const CONFIG_PREFIX = "buffer-automation/config-";

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

export async function loadBufferAutomationConfig() {
  if (!blobAvailable()) return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
  try {
    const result = await list({ prefix: CONFIG_PREFIX, limit: 50 });
    const blob = newestConfigBlob(result?.blobs || []);
    if (!blob?.url) return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
    const response = await fetch(`${blob.url}?v=${encodeURIComponent(blob.pathname)}`, {
      cache: "no-store",
    });
    if (!response.ok) return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
    return normalizeBufferAutomationConfig(await response.json());
  } catch (error) {
    console.warn("[buffer-automation] config load fallback", {
      message: error?.message || String(error),
    });
    return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
  }
}

export async function saveBufferAutomationConfig(value) {
  if (!blobAvailable()) {
    throw new Error("Vercel Blob is not configured for Buffer automation settings.");
  }
  const config = normalizeBufferAutomationConfig({
    ...value,
    updatedAt: new Date().toISOString(),
  });
  const stamp = Date.now();
  await put(`${CONFIG_PREFIX}${stamp}.json`, JSON.stringify(config, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
  return config;
}
