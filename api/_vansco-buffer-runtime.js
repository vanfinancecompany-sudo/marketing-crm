import { list, put } from "@vercel/blob";
import {
  bufferStatusPollIntervalMs,
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
const QUOTA_STATE_PATH = "vansco-buffer-v1/api-quota-state.json";
const VANSCO_QUERY_MAX_24H_REQUESTS = 165;
const VANSCO_MUTATION_MAX_24H_REQUESTS = 190;
const TWENTY_FOUR_HOUR_SECONDS = 24 * 60 * 60;

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
  }
`;

const ALL_CHANNEL_STATUS_QUERY = `
  query VanscoAllChannelStatus(
    $organizationId: OrganizationId!,
    $channelIds: [ChannelId!]!,
    $date: DateTime!
  ) {
    dailyPostingLimits(input: { channelIds: $channelIds, date: $date }) {
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
        sort: [{ field: createdAt, direction: desc }]
        filter: {
          status: [draft, scheduled, sending, sent, error]
          channelIds: $channelIds
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
  }
`;

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
  vanscoQuotaState = await readBlobJson(QUOTA_STATE_PATH) || vanscoQuotaState || {};
  vanscoQuotaReadAt = Date.now();
  return vanscoQuotaState;
}

function vanscoTwentyFourHourQuota(state) {
  return (Array.isArray(state?.rateLimits) ? state.rateLimits : [])
    .find((item) => Number(item?.windowSeconds) === TWENTY_FOUR_HOUR_SECONDS) || null;
}

function vanscoQuotaUsed(quota) {
  const total = Number(quota?.quota);
  const remaining = Number(quota?.remaining);
  return Number.isFinite(total) && Number.isFinite(remaining)
    ? Math.max(0, total - remaining)
    : 0;
}

async function ensureVanscoBufferBudget(query) {
  const state = await loadVanscoQuotaState();
  const dailyQuota = vanscoTwentyFourHourQuota(state);
  const updatedMs = new Date(state?.updatedAt || 0).getTime();
  const fresh = Number.isFinite(updatedMs)
    && updatedMs > 0
    && Date.now() - updatedMs < 20 * 60 * 1000;
  const isMutation = /\bmutation\b/i.test(String(query || ""));
  const maxUsed = isMutation
    ? VANSCO_MUTATION_MAX_24H_REQUESTS
    : VANSCO_QUERY_MAX_24H_REQUESTS;
  const used = vanscoQuotaUsed(dailyQuota);

  if (fresh && dailyQuota?.quota > 0 && used >= maxUsed) {
    const error = new Error(
      `Buffer 24-hour safety reserve is active (${used}/${dailyQuota.quota} requests used).`,
    );
    error.code = "BUFFER_RATE_LIMIT";
    error.reason = "buffer_daily_quota_reserve";
    error.retryAfter = "1200";
    throw error;
  }
}

async function recordVanscoQuotaTelemetry(response) {
  const rateLimits = parseBufferRateLimitHeaders(response);
  if (!rateLimits.length) return;
  vanscoQuotaState = {
    rateLimits,
    updatedAt: new Date().toISOString(),
  };
  vanscoQuotaReadAt = Date.now();
  await writeBlobJson(QUOTA_STATE_PATH, vanscoQuotaState).catch(() => {});
}

async function bufferGraphql(query, variables = undefined) {
  await ensureVanscoBufferBudget(query);
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
  if (response.status === 429) {
    const retryAfter = String(response.headers.get("retry-after") || "").trim();
    const error = new Error(readableError(payload, "Buffer rate limit reached."));
    error.code = "BUFFER_RATE_LIMIT";
    error.retryAfter = retryAfter;
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

export async function inspectVanscoBufferAccount() {
  const accountPayload = await bufferGraphql(ACCOUNT_QUERY);
  const organizations = accountPayload?.data?.account?.organizations || [];
  const result = [];

  for (const organization of organizations) {
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
      date: `${dateKey}T12:00:00.000Z`,
    });
    const limits = Array.isArray(payload?.data?.dailyPostingLimits)
      ? payload.data.dailyPostingLimits
      : [];
    const posts = (payload?.data?.posts?.edges || [])
      .map((edge) => edge?.node)
      .filter(Boolean);
    const limitByChannel = Object.fromEntries(
      limits.map((item) => [String(item?.channelId || ""), item]),
    );
    const postsByChannel = Object.fromEntries(
      channelIds.map((channelId) => [
        channelId,
        posts.filter((post) => String(post?.channelId || "") === channelId),
      ]),
    );

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
      hasNextPage: Boolean(payload?.data?.posts?.pageInfo?.hasNextPage),
    };
    await writeBlobJson(LIVE_STATUS_SNAPSHOT_PATH, snapshot);
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

export async function loadVanscoFacebookActivity(config) {
  const payload = await bufferGraphql(FACEBOOK_ACTIVITY_QUERY, {
    organizationId: config.organizationId,
    channelId: config.channelId,
  });
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(String(graphError));
  return {
    posts: (payload?.data?.posts?.edges || []).map((edge) => edge?.node).filter(Boolean),
    hasNextPage: Boolean(payload?.data?.posts?.pageInfo?.hasNextPage),
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

export async function createVanscoBufferPost({ config, text, imageUrl, imageUrls = [], dueAt }) {
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

  const payload = await bufferGraphql(CREATE_POST_MUTATION, {
    input: {
      text: String(text || "").trim(),
      channelId: config.channelId,
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: new Date(dueAt).toISOString(),
      saveToDraft: false,
      source: "vansco-marketing-crm",
      assets: urls.map((url) => ({ image: { url } })),
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
}) {
  const compatibleImage = vanscoBufferCompatibleImageUrl(imageUrl);
  if (!compatibleImage) {
    throw new Error("Vansco Facebook Story requires a compatible JPEG/PNG image.");
  }

  const payload = await bufferGraphql(CREATE_POST_MUTATION, {
    input: {
      text: String(text || "").trim(),
      channelId: config.channelId,
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: new Date(dueAt).toISOString(),
      saveToDraft: false,
      source: "vansco-marketing-crm-story",
      assets: [{ image: { url: compatibleImage } }],
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
}) {
  const compatibleImage = vanscoBufferCompatibleImageUrl(imageUrl);
  if (!compatibleImage) {
    throw new Error("Vansco Google Business post requires a compatible JPEG/PNG image.");
  }
  const link = String(linkUrl || "").trim();
  if (!/^https:\/\//i.test(link)) {
    throw new Error("Vansco Google Business post requires a public Learn more URL.");
  }

  const payload = await bufferGraphql(CREATE_POST_MUTATION, {
    input: {
      text: String(text || "").trim(),
      channelId: config.channelId,
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: new Date(dueAt).toISOString(),
      saveToDraft: false,
      source: "vansco-marketing-crm",
      assets: [{ image: { url: compatibleImage } }],
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
