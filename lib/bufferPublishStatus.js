import { isBufferFacebookStory } from "./bufferAutomation.js";
import { BUFFER_FACEBOOK_CHANNELS } from "./bufferPublishing.js";

export const BUFFER_ORGANIZATION_ID = "6a8720b714b19791c7f51e13";

export const BUFFER_SENT_POSTS_QUERY = `
  query GetBufferSentPosts($channelIds: [ChannelId!]!) {
    posts(
      first: 100
      input: {
        organizationId: "6a8720b714b19791c7f51e13"
        filter: {
          status: [sent]
          channelIds: $channelIds
        }
        sort: [{ field: createdAt, direction: desc }]
      }
    ) {
      edges {
        node {
          id
          text
          status
          schedulingType
          createdAt
          sentAt
          dueAt
          externalLink
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

export function bufferDestinationForChannel(channelId, googleBusinessChannelId = "") {
  const key = String(channelId || "");
  if (googleBusinessChannelId && key === String(googleBusinessChannelId)) {
    return "Van Finance Google Business";
  }
  return DESTINATION_BY_CHANNEL[key] || "";
}

export function bufferProductKeyForDestination(destination, text = "") {
  if (destination === "Van Finance Facebook") return "vanFinance";
  if (destination === "Rent2Buy Facebook") return "rent2buy";
  if (destination === "Van Finance Google Business") {
    const marker = String(text || "").toUpperCase();
    if (marker.includes("RENT2BUY VAN AVAILABLE")) return "rent2buy";
    if (marker.includes("VAN FINANCE COMPANY STOCK")) return "vanFinance";
    return "";
  }
  return "";
}

export function bufferPostMediaKind(post) {
  const assets = Array.isArray(post?.assets) ? post.assets : [];
  if (assets.some((asset) => /^video\//i.test(String(asset?.mimeType || "")))) return "video";
  if (isBufferFacebookStory(post)) return "story";
  return "image";
}

export function normalizeBufferRegistration(value) {
  const text = String(value || "").toUpperCase();
  const labelled = text.match(/REGISTRATION\s*:\s*([A-Z0-9 ]{5,10})/i)?.[1] || "";
  const labelledRegistration = labelled.replace(/[^A-Z0-9]/g, "");
  if (labelledRegistration.length >= 5 && labelledRegistration.length <= 8) {
    return labelledRegistration;
  }
  const match = text.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/,
  );
  return String(match?.[1] || "").replace(/[^A-Z0-9]/g, "");
}

export function bufferSentTimestamp(post) {
  return String(post?.sentAt || post?.dueAt || post?.createdAt || "").trim();
}

export function bufferPublishedActivityType(destination, mediaKind, productKey = "") {
  if (destination === "Van Finance Google Business") {
    return productKey === "rent2buy"
      ? "rent2buy_google_business_post"
      : "van_finance_google_business_post";
  }
  if (mediaKind === "video") {
    return destination === "Rent2Buy Facebook" ? "rent2buy_reel" : "van_finance_reel";
  }
  return destination === "Rent2Buy Facebook"
    ? "rent2buy_facebook_post"
    : "van_finance_facebook_post";
}

export function bufferPublishedItems(posts, options = {}) {
  const googleBusinessChannelId = String(options?.googleBusinessChannelId || "");
  return (posts || [])
    .map((post) => {
      const destination = bufferDestinationForChannel(post?.channelId, googleBusinessChannelId);
      const sentAt = bufferSentTimestamp(post);
      const productKey = bufferProductKeyForDestination(destination, post?.text);
      if (!destination || !productKey || !sentAt) return null;
      return {
        id: String(post?.id || ""),
        destination,
        productKey,
        platform: destination === "Van Finance Google Business" ? "googlebusiness" : "facebook",
        mediaKind: bufferPostMediaKind(post),
        registration: normalizeBufferRegistration(post?.text),
        sentAt,
        externalLink: String(post?.externalLink || ""),
        text: String(post?.text || ""),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
}

export function summarizeBufferPublishedToday(posts, dateKey, londonDateKey, options = {}) {
  const items = bufferPublishedItems(posts, options).filter(
    (item) => londonDateKey(new Date(item.sentAt)) === dateKey,
  );

  const empty = () => ({ posts: 0, reels: 0, total: 0 });
  const summary = {
    date: dateKey,
    vanFinance: empty(),
    rent2buy: empty(),
    googleBusiness: {
      vanFinance: 0,
      rent2buy: 0,
      total: 0,
    },
    items,
  };

  for (const item of items) {
    if (item.platform === "googlebusiness") {
      summary.googleBusiness[item.productKey] += 1;
      summary.googleBusiness.total += 1;
      continue;
    }
    const group = summary[item.productKey];
    if (!group) continue;
    if (item.mediaKind === "video") group.reels += 1;
    else group.posts += 1;
    group.total += 1;
  }
  return summary;
}
