import {
  BUFFER_API_URL,
  BUFFER_FACEBOOK_CHANNELS,
  bufferDestinationForProduct,
  readableBufferError,
} from "../lib/bufferPublishing.js";
import {
  bufferDeferredPayload,
  guardedBufferGraphql,
  isBufferRateLimitCooldownError,
} from "../lib/bufferRuntimeGuard.js";
import { loadBufferAutomationConfig } from "../lib/bufferAutomationConfig.js";
import {
  FACEBOOK_STORY_TARGET_PER_DAY,
  bufferPostDateKey,
  extractBufferRegistration,
  facebookPostTargetForProduct,
  facebookStoryTargetForProduct,
  isBufferFacebookStory,
  isBufferPostReserved,
  londonDateKeyForValue,
  londonLocalMinutesToUtcIso,
} from "../lib/bufferAutomation.js";

export const config = { maxDuration: 120 };

const ACCESS_HEADER = "x-marketing-customer-database-key";
const PRODUCTS = ["vanFinance", "rent2buy"];
const CHANNEL_QUEUE_LIMIT = 10;
const STORY_LOCAL_MINUTES = [10 * 60 + 30, 14 * 60 + 30, 18 * 60 + 30];
const RENT2BUY_OFFSET_MINUTES = 10;
const MIN_SCHEDULE_LEAD_MS = 10 * 60 * 1000;
const STORY_LOOKAHEAD_MS = 5 * 60 * 60 * 1000;

const POSTS_QUERY = `
  query GetFacebookStoryAutomationPosts {
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
    }
  }
`;

const CREATE_POST_MUTATION = `
  mutation CreateFacebookStory($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post {
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
      ... on MutationError {
        message
      }
    }
  }
`;

function authorize(request) {
  const cronSecret = String(process.env.CRON_SECRET || "");
  const marketingKey = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "");
  const authorization = String(request.headers.authorization || "");
  const supplied = String(request.headers[ACCESS_HEADER] || "");
  return Boolean(
    (cronSecret && authorization === `Bearer ${cronSecret}`) ||
    (marketingKey && (supplied === marketingKey || authorization === `Bearer ${marketingKey}`)),
  );
}

function bufferToken() {
  const token = String(process.env.BUFFER_API_KEY || "").trim();
  if (!token) throw new Error("BUFFER_API_KEY is not configured on the server.");
  return token;
}

async function bufferGraphql(query, variables = undefined) {
  return guardedBufferGraphql({
    url: BUFFER_API_URL,
    token: bufferToken(),
    query,
    variables,
  });
}

function parsePosts(payload) {
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(readableBufferError(graphError));
  return (payload?.data?.posts?.edges || []).map((edge) => edge?.node).filter(Boolean);
}

function parseCreatedPost(payload) {
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(readableBufferError(graphError));
  const result = payload?.data?.createPost;
  if (result?.message) throw new Error(readableBufferError(result.message));
  if (!result?.post?.id) throw new Error("Buffer did not return a Story post ID.");
  return result.post;
}

function channelForProduct(productKey) {
  return BUFFER_FACEBOOK_CHANNELS[bufferDestinationForProduct(productKey)];
}

function postsForProduct(posts, productKey) {
  const channelId = channelForProduct(productKey);
  return (posts || []).filter((post) => post?.channelId === channelId);
}

function livePost(post) {
  return String(post?.status || "").toLowerCase() !== "error";
}

function imageSource(post) {
  const asset = (post?.assets || []).find((item) => /^image\//i.test(String(item?.mimeType || "")));
  const source = String(asset?.source || "").trim();
  return /^https:\/\//i.test(source) ? source : "";
}

function isImagePost(post) {
  return Boolean(imageSource(post));
}

function queuedCount(posts, productKey) {
  return postsForProduct(posts, productKey).filter(isBufferPostReserved).length;
}

function postTimestamp(post) {
  const value = post?.dueAt || post?.sentAt || post?.createdAt;
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function storyPostsForDay(posts, productKey, dateKey) {
  return postsForProduct(posts, productKey).filter(
    (post) => livePost(post) && isBufferFacebookStory(post) && bufferPostDateKey(post) === dateKey,
  );
}

function storySlotForRun(posts, productKey, dateKey, now, storyTarget) {
  const existingStories = storyPostsForDay(posts, productKey, dateKey);
  if (existingStories.length >= storyTarget) {
    return { slot: null, existing: existingStories.length, target: storyTarget, reason: "target_met" };
  }

  const occupied = new Set(
    existingStories
      .map((post) => {
        const value = post?.dueAt || post?.sentAt || post?.createdAt;
        const date = new Date(value || 0);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString();
      })
      .filter(Boolean),
  );
  const offset = productKey === "rent2buy" ? RENT2BUY_OFFSET_MINUTES : 0;
  const slots = STORY_LOCAL_MINUTES.slice(0, storyTarget).map((minutes, index) => {
    const dueAt = londonLocalMinutesToUtcIso(dateKey, minutes + offset);
    return {
      index,
      dueAt,
      localMinutes: minutes + offset,
      localTime: `${String(Math.floor((minutes + offset) / 60)).padStart(2, "0")}:${String((minutes + offset) % 60).padStart(2, "0")}`,
    };
  });
  const slot = slots.find((candidate) => {
    const dueMs = new Date(candidate.dueAt).getTime();
    return dueMs > now + MIN_SCHEDULE_LEAD_MS
      && dueMs <= now + STORY_LOOKAHEAD_MS
      && !occupied.has(candidate.dueAt);
  }) || null;

  return {
    slot,
    existing: existingStories.length,
    target: storyTarget,
    reason: slot ? "ready" : "no_story_slot_due_soon",
  };
}

function sourceImageCandidate(posts, productKey, dateKey, storyDueAt) {
  const storyRegistrations = new Set(
    storyPostsForDay(posts, productKey, dateKey)
      .map((post) => extractBufferRegistration(post?.text))
      .filter(Boolean),
  );
  const dueMs = new Date(storyDueAt).getTime();

  return postsForProduct(posts, productKey)
    .filter((post) => livePost(post))
    .filter((post) => isImagePost(post) && !isBufferFacebookStory(post))
    .filter((post) => bufferPostDateKey(post) === dateKey)
    .filter((post) => postTimestamp(post) <= dueMs)
    .filter((post) => {
      const registration = extractBufferRegistration(post?.text);
      return registration && !storyRegistrations.has(registration);
    })
    .sort((first, second) => postTimestamp(second) - postTimestamp(first))[0] || null;
}

async function createStory({ productKey, sourcePost, dueAt }) {
  const mediaUrl = imageSource(sourcePost);
  if (!mediaUrl) throw new Error("The selected classified image does not have a public image URL.");
  const text = String(sourcePost?.text || "").trim();
  if (!text) throw new Error("The selected classified post does not have a caption.");

  const input = {
    text,
    channelId: channelForProduct(productKey),
    schedulingType: "automatic",
    mode: "customScheduled",
    dueAt: new Date(dueAt).toISOString(),
    saveToDraft: false,
    source: "vfc-marketing-crm-story",
    assets: [{ image: { url: mediaUrl } }],
    metadata: {
      facebook: {
        type: "story",
      },
    },
  };

  return parseCreatedPost(await bufferGraphql(CREATE_POST_MUTATION, { input }));
}

async function createNextStory({ posts, productKey, dateKey, now, storyTarget }) {
  if (storyTarget <= 0) {
    return { skipped: "target_met", existing: 0, target: 0 };
  }
  if (queuedCount(posts, productKey) >= CHANNEL_QUEUE_LIMIT) {
    return { skipped: "buffer_queue_full", queued: queuedCount(posts, productKey) };
  }

  const slotInfo = storySlotForRun(posts, productKey, dateKey, now, storyTarget);
  if (!slotInfo.slot) {
    return { skipped: slotInfo.reason, existing: slotInfo.existing, target: slotInfo.target };
  }

  const sourcePost = sourceImageCandidate(posts, productKey, dateKey, slotInfo.slot.dueAt);
  if (!sourcePost) {
    return { skipped: "no_classified_image_candidate", localTime: slotInfo.slot.localTime };
  }

  const post = await createStory({
    productKey,
    sourcePost,
    dueAt: slotInfo.slot.dueAt,
  });
  posts.unshift(post);

  return {
    created: true,
    mediaKind: "story",
    registration: extractBufferRegistration(sourcePost?.text),
    sourcePostId: sourcePost.id,
    bufferPostId: post.id,
    dueAt: post.dueAt || slotInfo.slot.dueAt,
    localTime: slotInfo.slot.localTime,
    publishing: "automatic",
  };
}

async function safeStep(label, action) {
  try {
    return await action();
  } catch (error) {
    const message = readableBufferError(error?.message || error, `${label} failed.`);
    console.error(`[buffer-facebook-story-automation] ${label} failed`, { message });
    return { error: message };
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    response.status(401).json({ ok: false, error: "Story automation access not recognised." });
    return;
  }

  try {
    const dateKey = londonDateKeyForValue();
    const automationConfig = await loadBufferAutomationConfig({ dateKey });

    if (!automationConfig.enabled || dateKey < automationConfig.startDate) {
      response.status(200).json({
        ok: true,
        enabled: automationConfig.enabled,
        date: dateKey,
        message: automationConfig.enabled
          ? "Story automation is waiting for the Buffer automation start date."
          : "Buffer automation is paused. No Stories were created.",
      });
      return;
    }

    const posts = parsePosts(await bufferGraphql(POSTS_QUERY));
    const now = Date.now();
    const results = {};
    const storyTargets = {};
    const facebookTargets = {};

    for (const productKey of PRODUCTS) {
      const storyTarget = facebookStoryTargetForProduct(automationConfig, productKey);
      storyTargets[productKey] = storyTarget;
      facebookTargets[productKey] = facebookPostTargetForProduct(automationConfig, productKey);
      results[productKey] = await safeStep(productKey, () =>
        createNextStory({ posts, productKey, dateKey, now, storyTarget }),
      );
    }

    response.status(200).json({
      ok: true,
      date: dateKey,
      configuredStoryMaximumPerChannel: FACEBOOK_STORY_TARGET_PER_DAY,
      targetStoriesPerChannel: storyTargets,
      facebookTargetPerChannel: facebookTargets,
      storyTimesLondon: {
        vanFinance: STORY_LOCAL_MINUTES.map((minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`),
        rent2buy: STORY_LOCAL_MINUTES.map((minutes) => `${String(Math.floor((minutes + RENT2BUY_OFFSET_MINUTES) / 60)).padStart(2, "0")}:${String((minutes + RENT2BUY_OFFSET_MINUTES) % 60).padStart(2, "0")}`),
      },
      results,
    });
  } catch (error) {
    if (isBufferRateLimitCooldownError(error)) {
      console.warn("[buffer-facebook-story-automation] deferred during Buffer cooldown", {
        retryAfterMs: error.retryAfterMs,
      });
      response.status(202).json(bufferDeferredPayload(error));
      return;
    }
    const message = readableBufferError(error?.message || error, "Buffer Facebook Story automation failed.");
    console.error("[buffer-facebook-story-automation] failed", { message });
    response.status(500).json({ ok: false, error: message });
  }
}
