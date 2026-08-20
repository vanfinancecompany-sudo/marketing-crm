import { list, put } from "@vercel/blob";
import {
  DEFAULT_BUFFER_AUTOMATION_CONFIG,
  normalizeBufferAutomationConfig,
} from "./bufferAutomation.js";

const CONFIG_PATH = "buffer-automation/config.json";

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export async function loadBufferAutomationConfig() {
  if (!blobAvailable()) return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
  try {
    const result = await list({ prefix: CONFIG_PATH, limit: 20 });
    const blob = (result?.blobs || []).find((item) => item.pathname === CONFIG_PATH);
    if (!blob?.url) return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
    const response = await fetch(blob.url, { cache: "no-store" });
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
  await put(CONFIG_PATH, JSON.stringify(config, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  return config;
}
