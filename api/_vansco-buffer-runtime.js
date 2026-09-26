import { list, put } from "@vercel/blob";

const BUFFER_API_URL = "https://api.buffer.com";
const CONFIG_PATH = "vansco-buffer-v1/channel.json";
const HISTORY_PATH = "vansco-buffer-v1/history.json";
const STATUS_PATH = "vansco-buffer-v1/status.json";

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
          channelId
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

async function bufferGraphql(query, variables = undefined) {
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const payload = await response.json().catch(() => ({}));
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
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!/^https:\/\//i.test(value) || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, 3);
  if (!urls.length) throw new Error("Vansco Buffer post requires at least one image.");

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
