import { BUFFER_FACEBOOK_CHANNELS } from "./bufferPublishing.js";

export const BUFFER_ORGANIZATION_ID = "6a8720b714b19791c7f51e13";

export const BUFFER_SENT_POSTS_QUERY = `
  query GetFacebookSentPosts {
    posts(
      first: 100
      input: {
        organizationId: "6a8720b714b19791c7f51e13"
        filter: {
          status: [sent]
          channelIds: ["6a8721fbccaf649a67e227a3", "6a8722ffccaf649a67e22bc6"]
        }
        sort: [{ field: createdAt, direction: desc }]
      }
    ) {
      edges {
        node {
          id
          text
          status
          createdAt
          sentAt
          dueAt
          externalLink
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

const DESTINATION_BY_CHANNEL = Object.freeze(
  Object.fromEntries(
    Object.entries(BUFFER_FACEBOOK_CHANNELS).map(([destination, channelId]) => [channelId, destination]),
  ),
);

export function parseBufferSentPostsPayload(payload) {
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(graphError);
  return (payload?.data?.posts?.edges || []).map((edge) => edge?.node).filter(Boolean);
}

export function bufferDestinationForChannel(channelId) {
  return DESTINATION_BY_CHANNEL[String(channelId || "")] || "";
}

export function bufferProductKeyForDestination(destination) {
  if (destination === "Van Finance Facebook") return "vanFinance";
  if (destination === "Rent2Buy Facebook") return "rent2buy";
  return "";
}

export function bufferPostMediaKind(post) {
  const assets = Array.isArray(post?.assets) ? post.assets : [];
  return assets.some((asset) => /^video\//i.test(String(asset?.mimeType || ""))) ? "video" : "image";
}

export function normalizeBufferRegistration(value) {
  const text = String(value || "").toUpperCase();
  const labelled = text.match(/REGISTRATION\s*:\s*([A-Z0-9 ]{5,10})/i)?.[1] || "";
  const candidate = labelled || text;
  const match = candidate.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/,
  );
  return String(match?.[1] || "").replace(/[^A-Z0-9]/g, "");
}

export function bufferSentTimestamp(post) {
  return String(post?.sentAt || post?.dueAt || post?.createdAt || "").trim();
}

export function bufferPublishedActivityType(destination, mediaKind) {
  if (mediaKind === "video") {
    return destination === "Rent2Buy Facebook" ? "rent2buy_reel" : "van_finance_reel";
  }
  return destination === "Rent2Buy Facebook"
    ? "rent2buy_facebook_post"
    : "van_finance_facebook_post";
}

export function summarizeBufferPublishedToday(posts, dateKey, londonDateKey) {
  const items = (posts || [])
    .map((post) => {
      const destination = bufferDestinationForChannel(post?.channelId);
      const sentAt = bufferSentTimestamp(post);
      const productKey = bufferProductKeyForDestination(destination);
      if (!destination || !productKey || !sentAt) return null;
      const mediaKind = bufferPostMediaKind(post);
      return {
        id: String(post?.id || ""),
        destination,
        productKey,
        mediaKind,
        registration: normalizeBufferRegistration(post?.text),
        sentAt,
        externalLink: String(post?.externalLink || ""),
        text: String(post?.text || ""),
      };
    })
    .filter(Boolean)
    .filter((item) => londonDateKey(new Date(item.sentAt)) === dateKey)
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

  const empty = () => ({ posts: 0, reels: 0, total: 0 });
  const summary = {
    date: dateKey,
    vanFinance: empty(),
    rent2buy: empty(),
    items,
  };

  for (const item of items) {
    const group = summary[item.productKey];
    if (!group) continue;
    if (item.mediaKind === "video") group.reels += 1;
    else group.posts += 1;
    group.total += 1;
  }
  return summary;
}
