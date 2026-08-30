import {
  loadBufferAutomationConfig,
  saveBufferAutomationConfig,
} from "../lib/bufferAutomationConfig.js";
import {
  BUFFER_API_URL,
  BUFFER_AUTOMATION_POSTS_QUERY,
  BUFFER_CHANNELS_QUERY,
  BUFFER_CREATE_POST_MUTATION,
  BUFFER_FACEBOOK_CHANNELS,
  BUFFER_ORGANIZATION_ID,
  buildBufferCreatePostInput,
  parseBufferAutomationPostsPayload,
  parseBufferChannelsPayload,
  parseBufferCreatePostPayload,
  readableBufferError,
  selectVanFinanceInstagramChannel,
} from "../lib/bufferPublishing.js";
import {
  bufferDeferredPayload,
  guardedBufferGraphql,
  isBufferRateLimitCooldownError,
} from "../lib/bufferRuntimeGuard.js";
import { selectVanFinanceInstagramMirrors } from "../lib/bufferInstagramMirror.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";
const CHANNEL_QUEUE_LIMIT = 10;

function errorText(value, fallback = "Instagram mirror failed.") {
  if (value instanceof Error && String(value.message || "").trim()) return value.message.trim();
  return readableBufferError(value, fallback);
}

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

const INSTAGRAM_POSTS_QUERY = `
  query GetVanFinanceInstagramPosts($organizationId: OrganizationId!, $channelId: ChannelId!) {
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

async function resolveInstagramChannel(automationConfig) {
  const configured = String(automationConfig?.vanFinanceInstagramChannelId || "").trim();
  if (configured) return configured;

  const channels = parseBufferChannelsPayload(await bufferGraphql(
    BUFFER_CHANNELS_QUERY,
    { organizationId: BUFFER_ORGANIZATION_ID },
  ));
  const selected = selectVanFinanceInstagramChannel(channels);
  const channelId = String(selected?.id || "").trim();
  if (!channelId) throw new Error("Buffer Instagram channel ID could not be resolved.");

  try {
    await saveBufferAutomationConfig({
      ...automationConfig,
      vanFinanceInstagramChannelId: channelId,
    });
  } catch (error) {
    console.warn("[buffer-instagram-mirror] channel persistence deferred", {
      message: errorText(error, "Could not persist Instagram channel ID."),
    });
  }
  return channelId;
}

async function loadInstagramPosts(channelId) {
  return parseBufferAutomationPostsPayload(await bufferGraphql(
    INSTAGRAM_POSTS_QUERY,
    { organizationId: BUFFER_ORGANIZATION_ID, channelId },
  ));
}

async function createInstagramPost(channelId, mirror) {
  const input = buildBufferCreatePostInput({
    channelId,
    platform: "instagram",
    text: mirror.text,
    mediaUrl: mirror.mediaUrl,
    mediaKind: mirror.mediaKind,
    draft: false,
    dueAt: mirror.dueAt,
  });
  return parseBufferCreatePostPayload(
    await bufferGraphql(BUFFER_CREATE_POST_MUTATION, { input }),
  );
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    response.status(401).json({ ok: false, error: "Automation access not recognised." });
    return;
  }

  const startedAt = Date.now();
  try {
    const automationConfig = await loadBufferAutomationConfig();
    if (!automationConfig.enabled || !automationConfig.vanFinanceInstagramEnabled) {
      response.status(200).json({
        ok: true,
        enabled: false,
        message: "Van Finance Instagram mirroring is paused.",
      });
      return;
    }

    const channelId = await resolveInstagramChannel(automationConfig);
    const [facebookPosts, instagramPosts] = await Promise.all([
      bufferGraphql(BUFFER_AUTOMATION_POSTS_QUERY).then(parseBufferAutomationPostsPayload),
      loadInstagramPosts(channelId),
    ]);

    const mirrors = selectVanFinanceInstagramMirrors({
      facebookPosts,
      instagramPosts,
      facebookChannelId: BUFFER_FACEBOOK_CHANNELS["Van Finance Facebook"],
      delayMinutes: automationConfig.instagramDelayMinutes,
      now: Date.now(),
      queueLimit: CHANNEL_QUEUE_LIMIT,
    });

    const results = [];
    for (const mirror of mirrors) {
      try {
        const post = await createInstagramPost(channelId, mirror);
        results.push({
          created: true,
          registration: mirror.registration,
          mediaKind: mirror.mediaKind,
          bufferPostId: post.id,
          dueAt: post.dueAt || mirror.dueAt,
        });
      } catch (error) {
        const message = errorText(error);
        console.warn("[buffer-instagram-mirror] Instagram item skipped", {
          registration: mirror.registration,
          mediaKind: mirror.mediaKind,
          message,
        });
        results.push({
          created: false,
          registration: mirror.registration,
          mediaKind: mirror.mediaKind,
          error: message,
        });
      }
    }

    response.status(200).json({
      ok: true,
      enabled: true,
      channelId,
      candidates: mirrors.length,
      created: results.filter((item) => item.created).length,
      failed: results.filter((item) => !item.created).length,
      delayMinutes: automationConfig.instagramDelayMinutes,
      results,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (isBufferRateLimitCooldownError(error)) {
      console.warn("[buffer-instagram-mirror] deferred during Buffer cooldown", {
        retryAfterMs: error.retryAfterMs,
      });
      response.status(202).json(bufferDeferredPayload(error, {
        enabled: true,
        elapsedMs: Date.now() - startedAt,
      }));
      return;
    }
    const message = errorText(error);
    console.error("[buffer-instagram-mirror] worker failed", { message });
    response.status(500).json({
      ok: false,
      error: message,
      elapsedMs: Date.now() - startedAt,
    });
  }
}
