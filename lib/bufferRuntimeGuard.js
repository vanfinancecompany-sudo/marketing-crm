import { list, put } from "@vercel/blob";
import { resolveBufferCredential } from "./bufferOAuth.js";

export const BUFFER_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const PERSONAL_STATE_PATH = "buffer-runtime-v1/rate-limit-state.json";
const APP_CLIENT_STATE_PATH = "buffer-runtime-v2/rate-limit-app-client.json";
const STATUS_PATH = "buffer-runtime-v1/publish-status-snapshot.json";
const MEMORY_READ_TTL_MS = 20 * 1000;
const THIRTY_DAY_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const HOUR_MS = 60 * 60 * 1000;

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

function normaliseRateLimits(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      name: String(item?.name || ""),
      remaining: Number(item?.remaining),
      resetSeconds: Number(item?.resetSeconds),
      quota: Number(item?.quota),
      windowSeconds: Number(item?.windowSeconds),
      partitionKey: String(item?.partitionKey || ""),
    }))
    .filter((item) =>
      item.name
      && Number.isFinite(item.remaining)
      && Number.isFinite(item.quota)
      && Number.isFinite(item.windowSeconds),
    );
}

function normaliseOperationTimes(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, timestamp]) => [String(key || ""), String(timestamp || "")])
      .filter(([key, timestamp]) => key && Number.isFinite(new Date(timestamp).getTime())),
  );
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
    rateLimits: normaliseRateLimits(value?.rateLimits),
    quotaUpdatedAt: value?.quotaUpdatedAt || null,
    operationLastRequestAt: normaliseOperationTimes(value?.operationLastRequestAt),
  };
}

function splitRepeatedHeader(value) {
  return String(value || "")
    .split(/,\s*(?=")/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRateLimitEntry(value) {
  const text = String(value || "").trim();
  const name = text.match(/^"([^"]+)"/)?.[1] || "";
  const fields = {};
  for (const match of text.matchAll(/;\s*([a-z]+)=([^;]+)/gi)) {
    fields[String(match[1] || "").toLowerCase()] = String(match[2] || "").trim();
  }
  return { name, fields };
}

export function parseBufferRateLimitHeaders(response) {
  const limitEntries = splitRepeatedHeader(response?.headers?.get?.("ratelimit"))
    .map(parseRateLimitEntry)
    .filter((item) => item.name);
  const policyEntries = splitRepeatedHeader(response?.headers?.get?.("ratelimit-policy"))
    .map(parseRateLimitEntry)
    .filter((item) => item.name);
  const policyByName = new Map(policyEntries.map((item) => [item.name, item]));

  return limitEntries
    .map((limit) => {
      const policy = policyByName.get(limit.name);
      const remaining = Number(limit.fields.r);
      const resetSeconds = Number(limit.fields.t);
      const quota = Number(policy?.fields?.q);
      const windowSeconds = Number(policy?.fields?.w);
      return {
        name: limit.name,
        remaining,
        resetSeconds,
        quota,
        windowSeconds,
        partitionKey: String(policy?.fields?.pk || ""),
      };
    })
    .filter((item) =>
      Number.isFinite(item.remaining)
      && Number.isFinite(item.quota)
      && Number.isFinite(item.windowSeconds),
    );
}

export function bufferThirtyDayQuota(state) {
  return normaliseRateLimits(state?.rateLimits)
    .find((item) => item.windowSeconds === THIRTY_DAY_WINDOW_SECONDS) || null;
}

function bufferOperationName(query) {
  return String(query || "").match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/)?.[1] || "anonymous";
}

function operationMinIntervalMs(operationName) {
  switch (String(operationName || "")) {
    case "GetSystemHealthBufferPosts":
      return 4 * HOUR_MS;
    case "GetFacebookSentPosts":
      return 6 * HOUR_MS;
    case "GetFacebookStoryAutomationPosts":
      return 4 * HOUR_MS;
    case "GetVanFinanceInstagramPosts":
      return 4 * HOUR_MS;
    default:
      return 0;
  }
}

function quotaReserveFractionForQuery(query) {
  const text = String(query || "");
  if (/\bmutation\b/i.test(text)) return 0;
  if (/GetSystemHealthBufferPosts|GetFacebookSentPosts|GetBufferReelHealth/i.test(text)) return 0.20;
  if (/GetVanFinanceInstagramPosts|GetFacebookStoryAutomationPosts|GetBufferChannels/i.test(text)) return 0.10;
  return 0.05;
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
  constructor(message, retryAfterMs, source = "personal_access", reason = "buffer_rate_limit_cooldown") {
    super(message);
    this.name = "BufferRateLimitCooldownError";
    this.code = "BUFFER_RATE_LIMIT_COOLDOWN";
    this.retryAfterMs = Math.max(1000, Number(retryAfterMs) || BUFFER_RATE_LIMIT_COOLDOWN_MS);
    this.credentialSource = credentialSource(source);
    this.reason = reason;
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

export async function ensureBufferRequestAllowed({
  source = "personal_access",
  min30dRemainingFraction = 0,
  operationName = "",
} = {}) {
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

  const minIntervalMs = operationMinIntervalMs(operationName);
  const lastRequestMs = new Date(state?.operationLastRequestAt?.[operationName] || 0).getTime();
  if (minIntervalMs > 0 && Number.isFinite(lastRequestMs) && lastRequestMs > 0) {
    const retryAfterMs = minIntervalMs - (Date.now() - lastRequestMs);
    if (retryAfterMs > 0) {
      throw new BufferRateLimitCooldownError(
        `Buffer ${operationName} is using the cached result to protect API quota.`,
        retryAfterMs,
        resolvedSource,
        "buffer_request_throttle",
      );
    }
  }

  const threshold = Math.max(0, Math.min(1, Number(min30dRemainingFraction) || 0));
  const quota = bufferThirtyDayQuota(state);
  if (threshold > 0 && quota?.quota > 0 && quota.remaining / quota.quota <= threshold) {
    const retryAfterMs = Math.max(
      HOUR_MS,
      (Number(quota.resetSeconds) || 60 * 60) * 1000,
    );
    throw new BufferRateLimitCooldownError(
      `Buffer 30-day quota reserve is active (${quota.remaining}/${quota.quota} requests remaining).`,
      retryAfterMs,
      resolvedSource,
      "buffer_quota_reserve",
    );
  }
  return state;
}

export async function recordBufferRateLimitTelemetry(
  response,
  { source = "personal_access", operationName = "" } = {},
) {
  const rateLimits = parseBufferRateLimitHeaders(response);
  const resolvedSource = credentialSource(source);
  const now = new Date().toISOString();
  const previous = await loadBufferRuntimeState({ source: resolvedSource });
  const operationLastRequestAt = {
    ...(previous?.operationLastRequestAt || {}),
    ...(operationName ? { [operationName]: now } : {}),
  };
  const state = normaliseState({
    ...previous,
    ...(rateLimits.length ? { rateLimits, quotaUpdatedAt: now } : {}),
    operationLastRequestAt,
    updatedAt: now,
    credentialSource: resolvedSource,
  });
  runtimeStates.set(resolvedSource, state);
  runtimeStateReadAt.set(resolvedSource, Date.now());
  await writeBlobJson(statePathForSource(resolvedSource), state);
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
    ...previous,
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
    ...state,
    blockedUntil: null,
    lastErrorAt: null,
    message: "",
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
  min30dRemainingFraction = undefined,
}) {
  const credential = await resolveBufferCredential(token);
  const operationName = bufferOperationName(query);
  const reserveFraction = min30dRemainingFraction === undefined
    ? quotaReserveFractionForQuery(query)
    : min30dRemainingFraction;
  await ensureBufferRequestAllowed({
    source: credential.source,
    min30dRemainingFraction: reserveFraction,
    operationName,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential.token}`,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const payload = await response.json().catch(() => ({}));
  await recordBufferRateLimitTelemetry(response, {
    source: credential.source,
    operationName,
  });
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
    reason: String(error?.reason || "buffer_rate_limit_cooldown"),
    credential_source: credentialSource(error?.credentialSource),
    retry_after_ms: retryAfterMs,
    retry_after_at: new Date(Date.now() + retryAfterMs).toISOString(),
    ...extra,
  };
}
