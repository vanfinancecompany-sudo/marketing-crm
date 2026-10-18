import { list, put } from "@vercel/blob";
import { prepareVanscoBufferImages } from "../lib/vanscoSocialMediaHandoff.js";
import { isBufferApiActiveWindow } from "../lib/bufferActiveWindow.js";
import {
  BUFFER_MONITORING_MAX_24H_REQUESTS,
  bufferQuotaUsed,
  bufferRetryAfterMs,
  isBufferRateLimitMessage,
  bufferStatusPollIntervalMs,
  bufferTwentyFourHourQuota,
  parseBufferRateLimitHeaders,
} from "../lib/bufferRuntimeGuard.js";

const BUFFER_API_URL = "https://api.buffer.com";
const CONFIG_PATH = "vansco-buffer-v1/channel.json";
const HISTORY_PATH = "vansco-buffer-v1/history.json";
const STATUS_PATH = "vansco-buffer-v1/status.json";
const GOOGLE_CONFIG_PATH = "vansco-buffer-v1/google-business-channels.json";
const GOOGLE_HISTORY_PATH = "vansco-buffer-v1/google-business-history.json";
const GOOGLE_STATUS_PATH = "vansco-buffer-v1/google-business-status.json";
const STORY_HISTORY_PATH = "vansco-buffer-v1/facebook-story-history.json";
const STORY_STATUS_PATH = "vansco-buffer-v1/facebook-story-status.json";
const LIVE_STATUS_SNAPSHOT_PATH = "vansco-buffer-v1/live-status-snapshot.json";
const API_QUOTA_STATE_PATH = "vansco-buffer-v1/api-quota-state.json";
const FACEBOOK_FAILED_MEDIA_PATH = "vansco-buffer-v1/facebook-failed-media-quarantine.json";
const GOOGLE_FAILED_MEDIA_PATH = "vansco-buffer-v1/google-business-failed-media-quarantine.json";

const ACCOUNT_QUERY = `
  query VanscoBufferAccount {
    account {
      organizations {
        id
        name
        limits {
          scheduledPosts
        }
      }
    }
  }
`;

const CHANNELS_QUERY = `
  query VanscoBufferChannels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      displayName
      service
      externalLink
      isDisconnected
      isLocked
      organizationId
    }
  }
`;

const STATE_QUERY = `
  query VanscoBufferState($organizationId: OrganizationId!, $channelId: ChannelId!, $date: DateTime!) {
    dailyPostingLimits(input: { channelIds: [$channelId], date: $date }) {
      channelId
      sent
      scheduled
      limit
      isAtLimit
    }
    posts(
      first: 100
      input: {
        organizationId: $organizationId
        sort: [{ field: dueAt, direction: asc }, { field: createdAt, direction: desc }]
        filter: { status: [scheduled, sending], channelIds: [$channelId] }
      }
    ) {
      edges {
        node {
          id
          text
          status
          createdAt
          dueAt
          sentAt
          channelId
          metadata {
            ... on FacebookPostMetadata {
              type
            }
          }
          assets {
            id
            mimeType
            source
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const FACEBOOK_ACTIVITY_QUERY = `
  query VanscoFacebookActivity($organizationId: OrganizationId!, $channelId: ChannelId!) {
    posts(
      first: 100
      input: {
        organizationId: $organizationId
        sort: [{ field: createdAt, direction: desc }]
        filter: {
          status: [draft, scheduled, sending, sent, error]
          channelIds: [$channelId]
        }
      }
    ) {
      edges {
        node {
          id
          text
          status
          schedulingType
          createdAt
          dueAt
          sentAt
          channelId
          metadata {
            ... on FacebookPostMetadata {
              type
            }
          }
          assets {
            id
            mimeType
            source
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    failedMediaPosts: posts(
      first: 100
      input: {
        organizationId: $organizationId
        sort: [{ field: createdAt, direction: desc }]
        filter: { status: [error], channelIds: [$channelId] }
      }
    ) {
      edges { node {
        id
        text
        status
        channelId
        createdAt
        dueAt
        error { message }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Sent records are fetched per channel, not as a single shared 100-post list.
// A shared list is crowded by tomorrow's scheduled posts and high-volume
// Facebook output, making live Vansco 333 and Story posts appear as zero.
const ALL_CHANNEL_STATUS_QUERY = `
  query VanscoAllChannelStatus(
    $organizationId: OrganizationId!
    $channelIds: [ChannelId!]!
    $facebookIds: [ChannelId!]!
    $vansco333Ids: [ChannelId!]!
    $airportIds: [ChannelId!]!
    $newForestIds: [ChannelId!]!
    $date: DateTime!
  ) {
    dailyPostingLimits(input: { channelIds: $channelIds, date: $date }) {
      channelId
      sent
      scheduled
      limit
      isAtLimit
    }
    facebookSent: posts(
      first: 100
      input: {
        organizationId: $organizationId
        sort: [{ field: createdAt, direction: desc }]
        filter: {
          status: [sent, error]
          channelIds: $facebookIds
        }
      }
    ) {
      edges {
        node {
          id
          text
          status
          schedulingType
          createdAt
          dueAt
          sentAt
          channelId
          error { message supportUrl }
          metadata {
            ... on FacebookPostMetadata {
              type
            }
          }
          assets {
            id
            mimeType
            source
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
    vansco333Sent: posts(
      first: 100
      input: {
        organizationId: $organizationId
        sort: [{ field: createdAt, direction: desc }]
        filter: {
          status: [sent, error]
          channelIds: $vansco333Ids
        }
      }
    ) {
      edges {
        node {
          id
          text
          status
          schedulingType
          createdAt
          dueAt
          sentAt
          channelId
          error { message supportUrl }
          metadata {
            ... on FacebookPostMetadata {
              type
            }
          }
          assets {
            id
            mimeType
            source
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
    airportSent: posts(
      first: 100
      input: {
        organizationId: $organizationId
        sort: [{ field: createdAt, direction: desc }]
        filter: {
          status: [sent, error]
          channelIds: $airportIds
        }
      }
    ) {
      edges {
        node {
          id
          text
          status
          schedulingType
          createdAt
          dueAt
          sentAt
          channelId
          error { message supportUrl }
          metadata {
            ... on FacebookPostMetadata {
              type
            }
          }
          assets {
            id
            mimeType
            source
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
    newForestSent: posts(
      first: 100
      input: {
        organizationId: $organizationId
        sort: [{ field: createdAt, direction: desc }]
        filter: {
          status: [sent, error]
          channelIds: $newForestIds
        }
      }
    ) {
      edges {
        node {
          id
          text
          status
          schedulingType
          createdAt
          dueAt
          sentAt
          channelId
          error { message supportUrl }
          metadata {
            ... on FacebookPostMetadata {
              type
            }
          }
          assets {
            id
            mimeType
            source
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export function vanscoSentPostsByChannel(payload = {}, facebookChannelId = "", googleBranches = {}) {
  const source = payload?.data || {};
  const sent = (alias, channelId) => {
    if (!channelId) return [];
    return (source?.[alias]?.edges || [])
      .map((edge) => edge?.node)
      .filter((post) => post && String(post.channelId || "") === String(channelId)
        && String(post.status || "").toLowerCase() === "sent");
  };
  return {
    facebook: sent("facebookSent", facebookChannelId),
    googleBusiness: {
      vansco333: sent("vansco333Sent", googleBranches.vansco333?.channelId),
      southamptonAirport: sent("airportSent", googleBranches.southamptonAirport?.channelId),
      newForest: sent("newForestSent", googleBranches.newForest?.channelId),
    },
    hasNextPage: ["facebookSent", "vansco333Sent", "airportSent", "newForestSent"]
      .some((alias) => Boolean(source?.[alias]?.pageInfo?.hasNextPage)),
  };
}

// A failed Buffer post is not the same thing as a failed CRM/API worker.
// Extract the platform's own error message from the same four channel-specific
// GraphQL aliases already used by the status snapshot. No extra Buffer request.
export function vanscoFailedPostsByChannel(payload = {}, facebookChannelId = "", googleBranches = {}, dateKey = "") {
  const aliases = {
    facebook: ["facebookSent", facebookChannelId],
    vansco333: ["vansco333Sent", googleBranches.vansco333?.channelId],
    southamptonAirport: ["airportSent", googleBranches.southamptonAirport?.channelId],
    newForest: ["newForestSent", googleBranches.newForest?.channelId],
  };
  const relevantFailures = ([alias, channelId]) => {
    if (!channelId) return [];
    return (payload?.data?.[alias]?.edges || [])
      .map((edge) => edge?.node)
      .filter((post) =>
        String(post?.channelId || "") === String(channelId)
        && String(post?.status || "").toLowerCase() === "error")
      .filter((post) => {
        if (!dateKey) return true;
        const date = new Date(post?.dueAt || post?.createdAt || 0);
        return !Number.isNaN(date.getTime()) && londonDateKey(date) === dateKey;
      })
      .map((post) => ({
        postId: String(post.id || ""),
        dueAt: post.dueAt || null,
        message: String(post.error?.message || "Buffer did not provide a publishing reason.").slice(0, 350),
        // Only stock posts generated by the Vansco GBP automations qualify
        // for later image-specific quarantine. Do not match manual posts.
        stockRegistration: /^\s*VANSCO\s+(?:333|SOUTHAMPTON AIRPORT|NEW FOREST)\s+STOCK\b/i
          .test(String(post.text || ""))
          ? (String(post.text || "").match(/\bREGISTRATION:\s*([A-Z]{2}\s?\d{2}\s?[A-Z]{3})\b/i)?.[1] || "")
              .toUpperCase().replace(/[^A-Z0-9]/g, "")
          : "",
        supportUrl: /^https:\/\//i.test(String(post.error?.supportUrl || ""))
          ? String(post.error.supportUrl).slice(0, 1000) : null,
      }))
      .slice(0, 35);
  };
  return {
    facebook: relevantFailures(aliases.facebook),
    googleBusiness: {
      vansco333: relevantFailures(aliases.vansco333),
      southamptonAirport: relevantFailures(aliases.southamptonAirport),
      newForest: relevantFailures(aliases.newForest),
    },
  };
}

const CREATE_POST_MUTATION = `
  mutation VanscoCreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post {
          id
          text
          status
          createdAt
          dueAt
          channelId
          assets {
            id
            mimeType
            source
          }
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

const DELETE_POST_MUTATION = `
  mutation VanscoDeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      ... on DeletePostSuccess {
        id
      }
      ... on MutationError {
        message
      }
    }
  }
`;

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

async function readBlobJson(pathname) {
  if (!blobAvailable()) return null;
  const result = await list({ prefix: pathname, limit: 10 });
  const blob = (result?.blobs || []).find((item) => item?.pathname === pathname)
    || (result?.blobs || [])[0];
  if (!blob?.url) return null;
  const response = await fetch(`${blob.url}?v=${Date.now()}`, { cache: "no-store" });
  return response.ok ? response.json() : null;
}

async function writeBlobJson(pathname, value) {
  if (!blobAvailable()) throw new Error("Vercel Blob is required for Vansco Buffer automation.");
  await put(pathname, JSON.stringify(value, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 1,
  });
  return value;
}

function apiKey() {
  const dedicated = String(process.env.VANSCO_BUFFER_API_KEY || "").trim();
  const existing = String(process.env.BUFFER_API_KEY || "").trim();
  const key = dedicated || existing;
  if (!key) throw new Error("No Buffer API key is configured for Vansco.");
  return key;
}

function readableError(payload, fallback) {
  const graph = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graph) return String(graph);
  return fallback;
}

export function vanscoBufferCompatibleImageUrl(value) {
  const url = String(value || "").trim();
  if (!/^https:\/\//i.test(url)) return "";

  try {
    const parsed = new URL(url);
    const pathname = String(parsed.pathname || "").toLowerCase();
    const needsTranscode = pathname.endsWith(".avif") || pathname.endsWith(".webp");
    if (!needsTranscode) return url;

    const wixHosted = parsed.hostname.toLowerCase() === "static.wixstatic.com"
      && pathname.startsWith("/media/");
    if (!wixHosted) return "";

    parsed.search = "";
    parsed.hash = "";
    const source = parsed.toString().replace(/\/$/, "");
    return `${source}/v1/fit/w_1600,h_1600/file.jpg`;
  } catch {
    return "";
  }
}

let vanscoQuotaState = null;
let vanscoQuotaReadAt = 0;

async function loadVanscoQuotaState() {
  if (vanscoQuotaState && Date.now() - vanscoQuotaReadAt < 20 * 1000) {
    return vanscoQuotaState;
  }
  vanscoQuotaState = await readBlobJson(API_QUOTA_STATE_PATH) || vanscoQuotaState || {};
  vanscoQuotaReadAt = Date.now();
  return vanscoQuotaState;
}

async function recordVanscoQuotaTelemetry(response) {
  const rateLimits = parseBufferRateLimitHeaders(response);
  if (!rateLimits.length) return;
  const previous = await loadVanscoQuotaState();
  vanscoQuotaState = {
    ...previous,
    rateLimits,
    quotaUpdatedAt: new Date().toISOString(),
  };
  vanscoQuotaReadAt = Date.now();
  await writeBlobJson(API_QUOTA_STATE_PATH, vanscoQuotaState).catch(() => {});
}

// Share real Buffer provider cooldowns across Vansco Facebook, Stories and
// all three Google Business workers. This does not affect their posting
// targets or scheduled slots, and never retries a rejected mutation blindly.
export function vanscoBufferCooldownRemainingMs(state, now = Date.now()) {
  const until = new Date(state?.blockedUntil || 0).getTime();
  return Number.isFinite(until) ? Math.max(0, until - now) : 0;
}

async function ensureVanscoBufferNotCoolingDown() {
  const state = await loadVanscoQuotaState();
  const remaining = vanscoBufferCooldownRemainingMs(state);
  if (remaining <= 0) return;
  const error = new Error("Vansco Buffer API cooldown is active. No new publishing request was sent.");
  error.code = "BUFFER_RATE_LIMIT";
  error.reason = "buffer_provider_cooldown";
  error.retryAfterMs = remaining;
  error.retryAfter = String(Math.ceil(remaining / 1000));
  throw error;
}

async function recordVanscoBufferRateLimit(response) {
  const now = Date.now();
  const previous = await loadVanscoQuotaState();
  const oldUntil = new Date(previous?.blockedUntil || 0).getTime();
  const retryAfterMs = Math.max(15 * 60 * 1000, bufferRetryAfterMs(response));
  const blockedUntil = new Date(Math.max(Number.isFinite(oldUntil) ? oldUntil : 0, now + retryAfterMs)).toISOString();
  vanscoQuotaState = {
    ...previous,
    blockedUntil,
    lastErrorAt: new Date(now).toISOString(),
  };
  vanscoQuotaReadAt = now;
  await writeBlobJson(API_QUOTA_STATE_PATH, vanscoQuotaState).catch((error) => {
    console.warn("[vansco-buffer] could not persist provider cooldown", {
      message: String(error?.message || error).slice(0, 120),
    });
  });
  return retryAfterMs;
}

async function vanscoMonitoringReserveActive() {
  const state = await loadVanscoQuotaState();
  const quota = bufferTwentyFourHourQuota(state);
  const updatedMs = new Date(state?.quotaUpdatedAt || 0).getTime();
  const fresh = Number.isFinite(updatedMs)
    && updatedMs > 0
    && Date.now() - updatedMs < 30 * 60 * 1000;
  return Boolean(
    fresh
    && quota?.quota > 0
    && bufferQuotaUsed(quota) >= BUFFER_MONITORING_MAX_24H_REQUESTS,
  );
}

async function bufferGraphql(query, variables = undefined) {
  await ensureVanscoBufferNotCoolingDown();
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const payload = await response.json().catch(() => ({}));
  await recordVanscoQuotaTelemetry(response);
  if (response.status === 429 || isBufferRateLimitMessage(readableError(payload, ""))) {
    const retryAfterMs = await recordVanscoBufferRateLimit(response);
    const error = new Error(readableError(payload, "Buffer rate limit reached."));
    error.code = "BUFFER_RATE_LIMIT";
    error.reason = "buffer_provider_rate_limit";
    error.retryAfterMs = retryAfterMs;
    error.retryAfter = String(Math.ceil(retryAfterMs / 1000));
    throw error;
  }
  if (!response.ok || payload?.errors?.length) {
    throw new Error(readableError(payload, `Buffer returned HTTP ${response.status}.`));
  }
  return payload;
}

function channelIdentity(channel) {
  return `${channel?.name || ""} ${channel?.displayName || ""} ${channel?.externalLink || ""}`.toLowerCase();
}

export async function inspectVanscoBufferAccount({ onStage } = {}) {
  onStage?.("read_buffer_account");
  const accountPayload = await bufferGraphql(ACCOUNT_QUERY);
  const organizations = accountPayload?.data?.account?.organizations || [];
  const result = [];

  for (const organization of organizations) {
    onStage?.("read_buffer_channels");
    const channelsPayload = await bufferGraphql(CHANNELS_QUERY, {
      organizationId: organization.id,
    });
    result.push({
      organizationId: String(organization?.id || ""),
      organizationName: String(organization?.name || ""),
      scheduledPostsLimit: Number(organization?.limits?.scheduledPosts) || null,
      channels: (channelsPayload?.data?.channels || []).map((channel) => ({
        id: String(channel?.id || ""),
        name: String(channel?.name || ""),
        displayName: String(channel?.displayName || ""),
        service: String(channel?.service || ""),
        externalLink: String(channel?.externalLink || ""),
        isDisconnected: Boolean(channel?.isDisconnected),
        isLocked: Boolean(channel?.isLocked),
      })),
    });
  }

  return result;
}

export async function discoverVanscoBufferConfig() {
  const organizations = await inspectVanscoBufferAccount();
  const candidates = [];

  for (const organization of organizations) {
    for (const channel of organization.channels || []) {
      const identity = channelIdentity(channel);
      if (
        String(channel?.service || "").toLowerCase() === "facebook"
        && identity.includes("vansco")
        && channel?.isDisconnected !== true
        && channel?.isLocked !== true
      ) {
        candidates.push({ organization, channel });
      }
    }
  }

  if (candidates.length !== 1) {
    throw new Error(
      candidates.length
        ? "More than one active Vansco Facebook channel was found in Buffer."
        : "No active Vansco Facebook channel was found in Buffer.",
    );
  }

  const selected = candidates[0];
  const config = {
    organizationId: String(selected.organization.organizationId || ""),
    organizationName: String(selected.organization.organizationName || ""),
    scheduledPostsLimit: Number(selected.organization?.scheduledPostsLimit) || 10,
    channelId: String(selected.channel.id),
    channelName: String(selected.channel.displayName || selected.channel.name || "Vansco Limited"),
    externalLink: String(selected.channel.externalLink || ""),
    verifiedAt: new Date().toISOString(),
  };
  await writeBlobJson(CONFIG_PATH, config);
  return config;
}

export async function loadVanscoBufferConfig({ forceDiscovery = false } = {}) {
  if (!forceDiscovery) {
    const stored = await readBlobJson(CONFIG_PATH);
    if (stored?.organizationId && stored?.channelId) return stored;
  }
  return discoverVanscoBufferConfig();
}

export function vanscoGoogleBusinessBranchKey(channel = {}) {
  if (String(channel?.service || "").toLowerCase() !== "googlebusiness") return "";
  const identity = channelIdentity(channel);
  if (!identity.includes("vansco")) return "";
  if (/vansco\s*333/.test(identity)) return "vansco333";
  if (/new\s*forest|cadnam/.test(identity)) return "newForest";
  if (/southampton\s*airport/.test(identity)) return "southamptonAirport";
  return "";
}

export async function discoverVanscoGoogleBusinessConfig() {
  const organizations = await inspectVanscoBufferAccount();
  const branchMatches = {
    vansco333: [],
    newForest: [],
    southamptonAirport: [],
  };

  for (const organization of organizations) {
    for (const channel of organization.channels || []) {
      if (channel?.isDisconnected === true || channel?.isLocked === true) continue;
      const branchKey = vanscoGoogleBusinessBranchKey(channel);
      if (!branchKey) continue;
      branchMatches[branchKey].push({ organization, channel });
    }
  }

  for (const [branchKey, matches] of Object.entries(branchMatches)) {
    if (matches.length !== 1) {
      throw new Error(
        matches.length
          ? `More than one active Vansco Google Business channel matched ${branchKey}.`
          : `No active Vansco Google Business channel matched ${branchKey}.`,
      );
    }
  }

  const branches = Object.fromEntries(
    Object.entries(branchMatches).map(([branchKey, matches]) => {
      const selected = matches[0];
      return [branchKey, {
        branchKey,
        organizationId: String(selected.organization.organizationId || ""),
        organizationName: String(selected.organization.organizationName || ""),
        scheduledPostsLimit: Number(selected.organization?.scheduledPostsLimit) || 10,
        channelId: String(selected.channel.id || ""),
        channelName: String(selected.channel.displayName || selected.channel.name || branchKey),
        externalLink: String(selected.channel.externalLink || ""),
      }];
    }),
  );

  const config = {
    branches,
    verifiedAt: new Date().toISOString(),
  };
  await writeBlobJson(GOOGLE_CONFIG_PATH, config);
  return config;
}

export async function loadVanscoGoogleBusinessConfig({ forceDiscovery = false } = {}) {
  if (!forceDiscovery) {
    const stored = await readBlobJson(GOOGLE_CONFIG_PATH);
    const branches = stored?.branches || {};
    if (
      branches?.vansco333?.channelId
      && branches?.newForest?.channelId
      && branches?.southamptonAirport?.channelId
    ) {
      return stored;
    }
  }
  return discoverVanscoGoogleBusinessConfig();
}

function londonDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function snapshotAgeMs(snapshot) {
  const timestamp = new Date(snapshot?.checkedAt || snapshot?.cachedAt || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.max(0, Date.now() - timestamp) : Infinity;
}

let vanscoStatusRefreshPromise = null;

export async function loadVanscoCombinedStatusSnapshot({ force = false } = {}) {
  const cached = await readBlobJson(LIVE_STATUS_SNAPSHOT_PATH);

  if (!isBufferApiActiveWindow()) {
    if (cached) {
      return {
        ...cached,
        cached: true,
        dormant: true,
      };
    }
    return {
      ok: true,
      checkedAt: null,
      cached: true,
      dormant: true,
      facebook: { config: {}, limit: null, posts: [] },
      googleBusiness: { branches: {} },
    };
  }

  if (!force && await vanscoMonitoringReserveActive()) {
    if (cached) {
      return {
        ...cached,
        cached: true,
        stale: true,
        monitoringReserve: true,
      };
    }
  }

  const maxAgeMs = bufferStatusPollIntervalMs();
  if (!force && cached && snapshotAgeMs(cached) < maxAgeMs) {
    return { ...cached, cached: true };
  }

  if (vanscoStatusRefreshPromise) return vanscoStatusRefreshPromise;

  vanscoStatusRefreshPromise = (async () => {
    const [facebookConfig, googleConfig] = await Promise.all([
      loadVanscoBufferConfig(),
      loadVanscoGoogleBusinessConfig(),
    ]);
    const branchEntries = Object.entries(googleConfig?.branches || {});
    const organizationIds = new Set([
      String(facebookConfig?.organizationId || ""),
      ...branchEntries.map(([, config]) => String(config?.organizationId || "")),
    ].filter(Boolean));
    if (organizationIds.size !== 1) {
      throw new Error("Vansco Buffer channels are not in one shared organization.");
    }

    const channelIds = [
      String(facebookConfig.channelId || ""),
      ...branchEntries.map(([, config]) => String(config?.channelId || "")),
    ].filter(Boolean);
    const dateKey = londonDateKey();
    const payload = await bufferGraphql(ALL_CHANNEL_STATUS_QUERY, {
      organizationId: [...organizationIds][0],
      channelIds,
      facebookIds: facebookConfig.channelId ? [String(facebookConfig.channelId)] : [],
      vansco333Ids: googleConfig.branches?.vansco333?.channelId
        ? [String(googleConfig.branches.vansco333.channelId)] : [],
      airportIds: googleConfig.branches?.southamptonAirport?.channelId
        ? [String(googleConfig.branches.southamptonAirport.channelId)] : [],
      newForestIds: googleConfig.branches?.newForest?.channelId
        ? [String(googleConfig.branches.newForest.channelId)] : [],
      date: `${dateKey}T12:00:00.000Z`,
    });
    const limits = Array.isArray(payload?.data?.dailyPostingLimits)
      ? payload.data.dailyPostingLimits
      : [];
    const posts = vanscoSentPostsByChannel(payload, facebookConfig.channelId, googleConfig.branches);
    const failedPosts = vanscoFailedPostsByChannel(payload, facebookConfig.channelId, googleConfig.branches, dateKey);
    const failedPostCounts = {
      facebook: failedPosts.facebook.length,
      ...Object.fromEntries(Object.entries(failedPosts.googleBusiness)
        .map(([branch, items]) => [branch, items.length])),
    };
    const limitByChannel = Object.fromEntries(
      limits.map((item) => [String(item?.channelId || ""), item]),
    );
    const postsByChannel = {
      [String(facebookConfig.channelId || "")]: posts.facebook,
      ...Object.fromEntries(branchEntries.map(([branchKey, config]) => [
        String(config.channelId || ""),
        posts.googleBusiness[branchKey] || [],
      ])),
    };

    const snapshot = {
      ok: true,
      checkedAt: new Date().toISOString(),
      date: dateKey,
      organizationId: [...organizationIds][0],
      facebook: {
        config: facebookConfig,
        limit: limitByChannel[String(facebookConfig.channelId || "")] || null,
        posts: postsByChannel[String(facebookConfig.channelId || "")] || [],
      },
      googleBusiness: {
        branches: Object.fromEntries(
          branchEntries.map(([branchKey, config]) => [
            branchKey,
            {
              config,
              limit: limitByChannel[String(config?.channelId || "")] || null,
              posts: postsByChannel[String(config?.channelId || "")] || [],
            },
          ]),
        ),
      },
      hasNextPage: posts.hasNextPage,
      // Read-only diagnostic data. Existing 'sent' lists remain filtered,
      // so publishing totals are never inflated by error-state posts.
      failedPosts,
      failedPostCounts,
      failedPostCountsComplete: !posts.hasNextPage,
    };
    await writeBlobJson(LIVE_STATUS_SNAPSHOT_PATH, snapshot);
    if (Object.values(failedPostCounts).some((count) => count > 0)) {
      const examples = [
        ...failedPosts.facebook.map((post) => ({ ...post, channel: "facebook" })),
        ...Object.entries(failedPosts.googleBusiness).flatMap(([branch, entries]) =>
          entries.map((post) => ({ ...post, channel: branch }))),
      ].slice(0, 12).map(({ channel, message, postId }) => ({
        channel,
        postId,
        // Error messages are intended for display. Strip incidental URLs/email addresses.
        reason: message.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted]").slice(0, 180),
      }));
      console.warn("[vansco-buffer] failed published posts detected", {
        date: dateKey,
        counts: failedPostCounts,
        examples,
        incomplete: posts.hasNextPage,
        // No captions, image links, number plates or API credentials logged.
      });
    }
    return snapshot;
  })();

  try {
    return await vanscoStatusRefreshPromise;
  } catch (error) {
    if (cached) {
      return {
        ...cached,
        cached: true,
        stale: true,
        refreshError: String(error?.message || error).slice(0, 300),
      };
    }
    throw error;
  } finally {
    vanscoStatusRefreshPromise = null;
  }
}

export function isVanscoFacebookStory(post) {
  const assets = Array.isArray(post?.assets) ? post.assets : [];
  const hasImage = assets.some((asset) => /^image\//i.test(String(asset?.mimeType || "")));
  const metadataType = String(post?.metadata?.type || post?.metadata?.facebook?.type || "").toLowerCase();
  const legacyNotification = String(post?.schedulingType || "").toLowerCase() === "notification";
  return hasImage && (metadataType === "story" || legacyNotification);
}

export async function loadVanscoFacebookMediaQuarantine() {
  const value = await readBlobJson(FACEBOOK_FAILED_MEDIA_PATH);
  return value && typeof value === "object" ? value : {};
}

export async function saveVanscoFacebookMediaQuarantine(entries) {
  return writeBlobJson(FACEBOOK_FAILED_MEDIA_PATH, entries);
}

// Read only the combined status snapshot already maintained for the dashboard.
// This must never trigger another Buffer API request during a refill.
export async function loadVanscoCachedFailedGoogleBusinessPosts() {
  const snapshot = await readBlobJson(LIVE_STATUS_SNAPSHOT_PATH);
  if (snapshot?.date !== londonDateKey()) return {};
  const captured = new Date(snapshot?.checkedAt || 0).getTime();
  if (!Number.isFinite(captured) || Date.now() - captured > 6 * 60 * 60 * 1000) return {};
  return snapshot?.failedPosts?.googleBusiness || {};
}

export async function loadVanscoGoogleBusinessMediaQuarantine() {
  const value = await readBlobJson(GOOGLE_FAILED_MEDIA_PATH);
  return value && typeof value === "object" ? value : {};
}

export async function saveVanscoGoogleBusinessMediaQuarantine(entries) {
  return writeBlobJson(GOOGLE_FAILED_MEDIA_PATH, entries);
}

export async function loadVanscoFacebookActivity(config) {
  const payload = await bufferGraphql(FACEBOOK_ACTIVITY_QUERY, {
    organizationId: config.organizationId,
    channelId: config.channelId,
  });
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(String(graphError));
  return {
    posts: (payload?.data?.posts?.edges || []).map((edge) => edge?.node).filter(Boolean),
    failedPosts: (payload?.data?.failedMediaPosts?.edges || []).map((edge) => edge?.node).filter(Boolean),
    hasNextPage: Boolean(payload?.data?.posts?.pageInfo?.hasNextPage),
    failedPostsHasNextPage: Boolean(payload?.data?.failedMediaPosts?.pageInfo?.hasNextPage),
  };
}

export async function loadVanscoBufferState(config, dateIso) {
  const payload = await bufferGraphql(STATE_QUERY, {
    organizationId: config.organizationId,
    channelId: config.channelId,
    date: dateIso,
  });
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(String(graphError));
  const limit = (payload?.data?.dailyPostingLimits || []).find(
    (item) => String(item?.channelId) === String(config.channelId),
  ) || null;
  const posts = (payload?.data?.posts?.edges || []).map((edge) => edge?.node).filter(Boolean);
  return {
    limit,
    posts,
    hasNextPage: Boolean(payload?.data?.posts?.pageInfo?.hasNextPage),
  };
}

export async function createVanscoBufferPost({ config, text, imageUrl, imageUrls = [], dueAt, vehicleId }) {
  const candidates = [
    ...(Array.isArray(imageUrls) ? imageUrls : []),
    imageUrl,
  ];
  const seen = new Set();
  const urls = candidates
    .map(vanscoBufferCompatibleImageUrl)
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, 3);
  if (!urls.length) {
    throw new Error("Vansco Buffer post requires at least one compatible JPEG/PNG image.");
  }

  const hostedUrls = await prepareVanscoBufferImages(urls, { vehicleId, dueAt });
  const payload = await bufferGraphql(CREATE_POST_MUTATION, {
    input: {
      text: String(text || "").trim(),
      channelId: config.channelId,
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: new Date(dueAt).toISOString(),
      saveToDraft: false,
      source: "vansco-marketing-crm",
      assets: hostedUrls.map((url) => ({ image: { url } })),
      metadata: { facebook: { type: "post" } },
    },
  });
  const result = payload?.data?.createPost;
  if (result?.message) throw new Error(String(result.message));
  if (!result?.post?.id) throw new Error("Buffer did not return a Vansco post ID.");
  return result.post;
}

export async function createVanscoFacebookStory({
  config,
  text,
  imageUrl,
  dueAt,
  vehicleId,
}) {
  const compatibleImage = vanscoBufferCompatibleImageUrl(imageUrl);
  if (!compatibleImage) {
    throw new Error("Vansco Facebook Story requires a compatible JPEG/PNG image.");
  }

  const [hostedImage] = await prepareVanscoBufferImages([compatibleImage], { vehicleId, dueAt });
  const payload = await bufferGraphql(CREATE_POST_MUTATION, {
    input: {
      text: String(text || "").trim(),
      channelId: config.channelId,
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: new Date(dueAt).toISOString(),
      saveToDraft: false,
      source: "vansco-marketing-crm-story",
      assets: [{ image: { url: hostedImage } }],
      metadata: { facebook: { type: "story" } },
    },
  });
  const result = payload?.data?.createPost;
  if (result?.message) throw new Error(String(result.message));
  if (!result?.post?.id) throw new Error("Buffer did not return a Vansco Story post ID.");
  return result.post;
}

export async function createVanscoGoogleBusinessPost({
  config,
  text,
  imageUrl,
  dueAt,
  linkUrl,
  vehicleId,
}) {
  const compatibleImage = vanscoBufferCompatibleImageUrl(imageUrl);
  if (!compatibleImage) {
    throw new Error("Vansco Google Business post requires a compatible JPEG/PNG image.");
  }
  const link = String(linkUrl || "").trim();
  if (!/^https:\/\//i.test(link)) {
    throw new Error("Vansco Google Business post requires a public Learn more URL.");
  }

  const [hostedImage] = await prepareVanscoBufferImages([compatibleImage], { vehicleId, dueAt });
  const payload = await bufferGraphql(CREATE_POST_MUTATION, {
    input: {
      text: String(text || "").trim(),
      channelId: config.channelId,
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: new Date(dueAt).toISOString(),
      saveToDraft: false,
      source: "vansco-marketing-crm",
      assets: [{ image: { url: hostedImage } }],
      metadata: {
        google: {
          type: "whats_new",
          detailsWhatsNew: {
            button: "learn_more",
            link,
          },
        },
      },
    },
  });
  const result = payload?.data?.createPost;
  if (result?.message) throw new Error(String(result.message));
  if (!result?.post?.id) throw new Error("Buffer did not return a Vansco Google Business post ID.");
  return result.post;
}

export async function deleteVanscoBufferPost(postId) {
  const payload = await bufferGraphql(DELETE_POST_MUTATION, {
    input: { id: String(postId || "").trim() },
  });
  const result = payload?.data?.deletePost;
  if (result?.message) throw new Error(String(result.message));
  return String(result?.id || postId || "");
}

export async function loadVanscoPostingHistory() {
  const stored = await readBlobJson(HISTORY_PATH);
  return stored && typeof stored === "object"
    ? { lastPostedByKey: stored.lastPostedByKey || {}, updatedAt: stored.updatedAt || null }
    : { lastPostedByKey: {}, updatedAt: null };
}

export async function saveVanscoPostingHistory(lastPostedByKey) {
  return writeBlobJson(HISTORY_PATH, {
    lastPostedByKey,
    updatedAt: new Date().toISOString(),
  });
}


export async function loadVanscoFacebookStoryHistory() {
  const stored = await readBlobJson(STORY_HISTORY_PATH);
  return stored && typeof stored === "object"
    ? { lastPostedByKey: stored.lastPostedByKey || {}, updatedAt: stored.updatedAt || null }
    : { lastPostedByKey: {}, updatedAt: null };
}

export async function saveVanscoFacebookStoryHistory(lastPostedByKey) {
  return writeBlobJson(STORY_HISTORY_PATH, {
    lastPostedByKey,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadVanscoFacebookStoryStatus() {
  const stored = await readBlobJson(STORY_STATUS_PATH);
  return stored && typeof stored === "object" ? stored : null;
}

export async function saveVanscoFacebookStoryStatus(status) {
  return writeBlobJson(STORY_STATUS_PATH, {
    ...(status && typeof status === "object" ? status : {}),
    updatedAt: new Date().toISOString(),
  });
}

export async function loadVanscoGoogleBusinessHistory() {
  const stored = await readBlobJson(GOOGLE_HISTORY_PATH);
  return stored && typeof stored === "object"
    ? {
        lastPostedByBranch: stored.lastPostedByBranch || {},
        updatedAt: stored.updatedAt || null,
      }
    : { lastPostedByBranch: {}, updatedAt: null };
}

export async function saveVanscoGoogleBusinessHistory(lastPostedByBranch) {
  return writeBlobJson(GOOGLE_HISTORY_PATH, {
    lastPostedByBranch,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadVanscoGoogleBusinessAutomationStatus() {
  const stored = await readBlobJson(GOOGLE_STATUS_PATH);
  return stored && typeof stored === "object" ? stored : null;
}

export async function saveVanscoGoogleBusinessAutomationStatus(status) {
  return writeBlobJson(GOOGLE_STATUS_PATH, {
    ...(status && typeof status === "object" ? status : {}),
    updatedAt: new Date().toISOString(),
  });
}

export async function loadVanscoAutomationStatus() {
  const stored = await readBlobJson(STATUS_PATH);
  return stored && typeof stored === "object" ? stored : null;
}

export async function saveVanscoAutomationStatus(status) {
  return writeBlobJson(STATUS_PATH, {
    ...(status && typeof status === "object" ? status : {}),
    updatedAt: new Date().toISOString(),
  });
}
