export const BUFFER_API_URL = "https://api.buffer.com";
export const BUFFER_ORGANIZATION_ID = "6a8720b714b19791c13";

export const BUFFER_FACEBOOK_CHANNELS = Object.freeze({
  "Van Finance Facebook": "6a8721fbccaf649a67e227a3",
  "Rent2Buy Facebook": "6a8722ffccaf649a67e22bc6",
});

export const BUFFER_CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post {
          id
          text
          status
          createdAt
          dueAt
          sentAt
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

export const BUFFER_CHANNELS_QUERY = `
  query GetBufferChannels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      displayName
      service
      externalLink
      isDisconnected
      isLocked
    }
  }
`;

export const BUFFER_AUTOMATION_POSTS_QUERY = `
  query GetAutomationPosts {
    posts(
      first: 100
      input: {
        organizationId: "6a8720b714b19791c7f51e13"
        sort: [{ field: createdAt, direction: desc }]
        filter: {
          status: [draft, scheduled, sending, sent, error]
          channelIds: ["6a8721fbccaf649a67e227a3", "6a8722ffccaf649a67e22bc6"]
        }
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
          assets {
            id
            mimeType
            source
          }
        }
      }
    }
  }
`;

function clean(value) {
  return String(value ?? "").trim();
}

export function readableBufferError(value, fallback = "Buffer request failed.") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const nested = value.message || value.description || value.error || value.detail;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
    try {
      const serialised = JSON.stringify(value);
      if (serialised && serialised !== "{}") return serialised;
    } catch {
      // Ignore non-serialisable provider payloads.
    }
  }
  return fallback;
}

function assertHttpUrl(value, label) {
  const url = clean(value);
  if (!/^https:\/\//i.test(url)) {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
  return url;
}

export function bufferDestinationForProduct(productKey) {
  if (productKey === "vanFinance") return "Van Finance Facebook";
  if (productKey === "rent2buy") return "Rent2Buy Facebook";
  throw new Error("Unsupported Buffer product key.");
}

export function bufferChannelForDestination(destination) {
  const channelId = BUFFER_FACEBOOK_CHANNELS[destination];
  if (!channelId) throw new Error("Unsupported Facebook destination.");
  return channelId;
}

export function buildBufferCreatePostInput({
  destination,
  channelId,
  platform = "facebook",
  text,
  mediaUrl,
  mediaKind = "image",
  draft = true,
  dueAt = "",
} = {}) {
  const service = clean(platform).toLowerCase() || "facebook";
  if (!["facebook", "instagram"].includes(service)) {
    throw new Error("Unsupported Buffer publishing platform.");
  }

  const resolvedChannelId = clean(channelId) || bufferChannelForDestination(destination);
  if (!resolvedChannelId) throw new Error("Buffer channel is required.");

  const cleanText = clean(text);
  if (!cleanText) throw new Error("Social caption is required.");

  const url = assertHttpUrl(mediaUrl, mediaKind === "video" ? "Video URL" : "Image URL");
  const isVideo = mediaKind === "video";
  const scheduledAt = clean(dueAt);
  if (scheduledAt && Number.isNaN(new Date(scheduledAt).getTime())) {
    throw new Error("Buffer scheduled time must be a valid ISO date.");
  }

  const metadata = service === "instagram"
    ? {
        instagram: {
          type: isVideo ? "reel" : "post",
          shouldShareToFeed: true,
          isAiGenerated: false,
        },
      }
    : {
        facebook: {
          type: isVideo ? "reel" : "post",
        },
      };

  return {
    text: cleanText,
    channelId: resolvedChannelId,
    schedulingType: "automatic",
    mode: scheduledAt ? "customScheduled" : "addToQueue",
    ...(scheduledAt ? { dueAt: new Date(scheduledAt).toISOString() } : {}),
    saveToDraft: scheduledAt ? false : Boolean(draft),
    source: "vfc-marketing-crm",
    assets: [isVideo ? { video: { url } } : { image: { url } }],
    metadata,
  };
}

export function parseBufferCreatePostPayload(payload) {
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(readableBufferError(graphError));

  const result = payload?.data?.createPost;
  if (result?.message) throw new Error(readableBufferError(result.message));
  if (!result?.post?.id) throw new Error("Buffer did not return a post ID.");

  return result.post;
}

export function parseBufferAutomationPostsPayload(payload) {
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(readableBufferError(graphError));
  return (payload?.data?.posts?.edges || []).map((edge) => edge?.node).filter(Boolean);
}

export function parseBufferChannelsPayload(payload) {
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(readableBufferError(graphError));
  return Array.isArray(payload?.data?.channels) ? payload.data.channels : [];
}

export function selectVanFinanceInstagramChannel(channels = []) {
  const available = (Array.isArray(channels) ? channels : []).filter((channel) =>
    clean(channel?.service).toLowerCase() === "instagram"
      && channel?.isDisconnected !== true
      && channel?.isLocked !== true,
  );
  if (!available.length) throw new Error("No connected Buffer Instagram channel is available.");

  const preferred = available.filter((channel) => {
    const identity = `${clean(channel?.name)} ${clean(channel?.displayName)} ${clean(channel?.externalLink)}`.toLowerCase();
    return identity.includes("vanfinancecompany") || identity.includes("van finance company");
  });
  if (preferred.length === 1) return preferred[0];
  if (available.length === 1) return available[0];
  throw new Error("More than one Buffer Instagram channel is connected; Van Finance Instagram could not be selected safely.");
}

// Buffer publishing route created after the direct Meta route was blocked.
