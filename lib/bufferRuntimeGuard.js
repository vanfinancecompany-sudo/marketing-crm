import { list, put } from "@vercel/blob";
import { resolveBufferCredential } from "./bufferOAuth.js";

export const BUFFER_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const PERSONAL_STATE_PATH = "buffer-runtime-v1/rate-limit-state.json";
const APP_CLIENT_STATE_PATH = "buffer-runtime-v2/rate-limit-app-client.json";
const STATUS_PATH = "buffer-runtime-v1/publish-status-snapshot.json";
const MEMORY_READ_TTL_MS = 20 * 1000;

const runtimeStates = new Map();
const runtimeStateReadAt = new Map();
let statusSnapshot = null;
let statusSnapshotReadAt = 0;

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function credentialSource(value) {
  return value === "app_client_oauth" ? "app_client_oauth" : "personal_access";
}

function statePathForSource(source) {
  return credentialSource(source) === "app_client_oauth"
    ? APP_CLIENT_STATE_PATH
    : PERSONAL_STATE_PATH;
}

async function readBlobJson(pathname) {
  if (!blobAvailable()) return null;
  try {
    const result = await list({ prefix: pathname, limit: 10 });
    const blob = (result?.blobs || []).find((item) => item?.pathname === pathname)
      || (result?.blobs || [])[0];
    if (!blob?.url) return null;
    const response = await fetch(`${blob.url}?runtime=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.warn("[buffer-runtime] shared state read deferred", {
      pathname,
      message: error?.message || String(error),
    });
    return null;
  }
}

async function writeBlobJson(pathname, value) {
  if (!blobAvailable()) return false;
  try {
    await put(pathname, JSON.stringify(value), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 1,
    });
    return true;
  } catch (error) {
    console.warn("[buffer-runtime] shared state write deferred", {
      pathname,
      message: error?.message || String(error),
    });
    return false;
  }
}

function normaliseState(value = {}) {
  const blockedUntilMs = new Date(value?.blockedUntil || 0).getTime();
  return {
    blockedUntil: Number.isFinite(blockedUntilMs) && blockedUntilMs > 0
      ? new Date(blockedUntilMs).toISOString()
      : null,
    lastErrorAt: value?.lastErrorAt || null,
    message: String(value?.message || ""),
    updatedAt: value?.updatedAt || null,
    credentialSource: credentialSource(value?.credentialSource),
  };
}

export function isBufferRateLimitMessage(value) {
  return /too many requests|rate.?limit|http\s*429/i.test(String(value || ""));
}

export function bufferCooldownRemainingMs(state, now = Date.now()) {
  const blockedUntilMs = new Date(state?.blockedUntil || 0).getTime();
  return Number.isFinite(blockedUntilMs) ? Math.max(0, blockedUntilMs - Number(now || 0)) : 0;
}

export function bufferRetryAfterMs(response, now = Date.now()) {
  const value = String(response?.headers?.get?.("retry-after") || "").trim();
  if (!value) return BUFFER_RATE_LIMIT_COOLDOWN_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    ? Math.max(1000, timestamp - Number(now || 0))
    : BUFFER_RATE_LIMIT_COOLDOWN_MS;
}

export class BufferRateLimitCooldownError extends Error {
  constructor(message, retryAfterMs, source = "personal_access") {
    super(message);
    this.name = "BufferRateLimitCooldownError";
    this.code = "BUFFER_RATE_LIMIT_COOLDOWN";
    this.retryAfterMs = Math.max(1000, Number(retryAfterMs) || BUFFER_RATE_LIMIT_COOLDOWN_MS);
    this.credentialSource = credentialSource(source);
  }
}

export function isBufferRateLimitCooldownError(error) {
  return error?.code === "BUFFER_RATE_LIMIT_COOLDOWN"
    || error instanceof BufferRateLimitCooldownError;
}

export async function loadBufferRuntimeState({
  force = false,
  source = "personal_access",
} = {}) {
  const resolvedSource = credentialSource(source);
  const cached = runtimeStates.get(resolvedSource);
  const cachedAt = runtimeStateReadAt.get(resolvedSource) || 0;
  if (!force && cached && Date.now() - cachedAt < MEMORY_READ_TTL_MS) {
    return cached;
  }
  const stored = await readBlobJson(statePathForSource(resolvedSource));
  const state = normaliseState(stored || cached || { credentialSource: resolvedSource });
  state.credentialSource = resolvedSource;
  runtimeStates.set(resolvedSource, state);
  runtimeStateReadAt.set(resolvedSource, Date.now());
  return state;
}

export async function ensureBufferRequestAllowed({ source = "personal_access" } = {}) {
  const resolvedSource = credentialSource(source);
  const state = await loadBufferRuntimeState({ source: resolvedSource });
  const remaining = bufferCooldownRemainingMs(state);
  if (remaining > 0) {
    throw new BufferRateLimitCooldownError(
      "Buffer is temporarily cooling down after a rate limit.",
      remaining,
      resolvedSource,
    );
  }
  return state;
}

export async function recordBufferRateLimit({
  message,
  retryAfterMs,
  source = "personal_access",
} = {}) {
  const resolvedSource = credentialSource(source);
  const now = Date.now();
  const previous = await loadBufferRuntimeState({ source: resolvedSource });
  const existingUntil = new Date(previous?.blockedUntil || 0).getTime();
  const requestedUntil = now + Math.max(
    BUFFER_RATE_LIMIT_COOLDOWN_MS,
    Number(retryAfterMs) || 0,
  );
  const state = normaliseState({
    blockedUntil: new Date(Math.max(
      Number.isFinite(existingUntil) ? existingUntil : 0,
      requestedUntil,
    )).toISOString(),
    lastErrorAt: new Date(now).toISOString(),
    message: String(message || "Buffer rate limit reached."),
    updatedAt: new Date(now).toISOString(),
    credentialSource: resolvedSource,
  });
  state.credentialSource = resolvedSource;
  runtimeStates.set(resolvedSource, state);
  runtimeStateReadAt.set(resolvedSource, now);
  await writeBlobJson(statePathForSource(resolvedSource), state);
  return state;
}

export async function clearBufferRateLimit({ source = "personal_access" } = {}) {
  const resolvedSource = credentialSource(source);
  const state = await loadBufferRuntimeState({ source: resolvedSource });
  if (!state?.blockedUntil && !state?.lastErrorAt) return state;
  const cleared = normaliseState({
    updatedAt: new Date().toISOString(),
    credentialSource: resolvedSource,
  });
  cleared.credentialSource = resolvedSource;
  runtimeStates.set(resolvedSource, cleared);
  runtimeStateReadAt.set(resolvedSource, Date.now());
  await writeBlobJson(statePathForSource(resolvedSource), cleared);
  return cleared;
}

export async function guardedBufferGraphql({
  url,
  token,
  query,
  variables = undefined,
}) {
  const credential = await resolveBufferCredential(token);
  await ensureBufferRequestAllowed({ source: credential.source });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential.token}`,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const payload = await response.json().catch(() => ({}));
  const graphMessage = String(payload?.errors?.[0]?.message || "");
  const rateLimited = response.status === 429 || isBufferRateLimitMessage(graphMessage);

  if (rateLimited) {
    const retryAfterMs = bufferRetryAfterMs(response);
    const message = graphMessage || `Buffer returned HTTP ${response.status}.`;
    await recordBufferRateLimit({
      message,
      retryAfterMs,
      source: credential.source,
    });
    throw new BufferRateLimitCooldownError(message, retryAfterMs, credential.source);
  }

  if (!response.ok) {
    throw new Error(graphMessage || `Buffer returned HTTP ${response.status}.`);
  }

  await clearBufferRateLimit({ source: credential.source });
  return payload;
}

export async function loadBufferStatusSnapshot({ force = false } = {}) {
  if (!force && statusSnapshot && Date.now() - statusSnapshotReadAt < MEMORY_READ_TTL_MS) {
    return statusSnapshot;
  }
  statusSnapshot = await readBlobJson(STATUS_PATH) || statusSnapshot;
  statusSnapshotReadAt = Date.now();
  return statusSnapshot;
}

export async function saveBufferStatusSnapshot(value) {
  statusSnapshot = {
    ...value,
    cached_at: new Date().toISOString(),
  };
  statusSnapshotReadAt = Date.now();
  await writeBlobJson(STATUS_PATH, statusSnapshot);
  return statusSnapshot;
}

export function bufferDeferredPayload(error, extra = {}) {
  const retryAfterMs = Math.max(
    1000,
    Number(error?.retryAfterMs) || BUFFER_RATE_LIMIT_COOLDOWN_MS,
  );
  return {
    ok: true,
    deferred: true,
    degraded: true,
    reason: "buffer_rate_limit_cooldown",
    credential_source: credentialSource(error?.credentialSource),
    retry_after_ms: retryAfterMs,
    retry_after_at: new Date(Date.now() + retryAfterMs).toISOString(),
    ...extra,
  };
}
