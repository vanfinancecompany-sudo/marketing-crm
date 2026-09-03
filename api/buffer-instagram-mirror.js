import { createClient } from "@supabase/supabase-js";
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
import { mapFinanceVehicleRow } from "../services/marketingVehicleContract.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";
const CHANNEL_QUEUE_LIMIT = 10;
const MEDIA_PREFLIGHT_TIMEOUT_MS = 8000;
const REEL_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

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

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function normalizeRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
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

async function resolveOriginalImageUrl(supabase, registration) {
  const wanted = normalizeRegistration(registration);
  if (!wanted) return "";
  const result = await supabase
    .from("facebook_adverts")
    .select("id,title,picture,is_active")
    .eq("is_active", true)
    .ilike("title", `%${registration}%`)
    .limit(25);
  if (result.error) throw result.error;
  const vehicle = (result.data || [])
    .map((row, index) => mapFinanceVehicleRow(row, index))
    .find((item) => normalizeRegistration(item?.reg || item?.title) === wanted);
  return String(vehicle?.image || vehicle?.picture || "").trim();
}

async function resolveOriginalReelUrl(supabase, registration) {
  const wanted = normalizeRegistration(registration);
  if (!wanted) return "";
  const result = await supabase
    .from("marketing_daily_activity_events")
    .select("metadata,occurred_at")
    .eq("activity_type", "van_finance_reel")
    .eq("source", "youtube_daily_batch")
    .gte("occurred_at", new Date(Date.now() - REEL_LOOKBACK_MS).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(150);
  if (result.error) throw result.error;
  const row = (result.data || []).find((item) => {
    if (item?.metadata?.deleted_at) return false;
    return normalizeRegistration(item?.metadata?.registration) === wanted
      && String(item?.metadata?.download_url || "").trim();
  });
  return String(row?.metadata?.download_url || "").trim();
}

async function resolveOriginalMediaUrl(supabase, mirror) {
  return mirror.mediaKind === "video"
    ? resolveOriginalReelUrl(supabase, mirror.registration)
    : resolveOriginalImageUrl(supabase, mirror.registration);
}

async function preflightPublicMedia(url, mediaKind) {
  const value = String(url || "").trim();
  if (!/^https:\/\//i.test(value)) throw new Error("Instagram media URL must be public HTTPS.");
  const expectedPrefix = mediaKind === "video" ? "video/" : "image/";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_PREFLIGHT_TIMEOUT_MS);

  try {
    let response = await fetch(value, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    let contentType = String(response.headers.get("content-type") || "").toLowerCase();

    if (!response.ok || !contentType.startsWith(expectedPrefix)) {
      response = await fetch(value, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
      contentType = String(response.headers.get("content-type") || "").toLowerCase();
    }

    if (!response.ok) {
      throw new Error(`Media preflight returned HTTP ${response.status}.`);
    }
    if (!contentType.startsWith(expectedPrefix)) {
      throw new Error(`Media preflight returned ${contentType || "an unknown content type"}, expected ${expectedPrefix}`);
    }
    return { url: value, contentType, status: response.status };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Media preflight timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveUsableMedia(supabase, mirror) {
  const original = await resolveOriginalMediaUrl(supabase, mirror).catch((error) => {
    console.warn("[buffer-instagram-mirror] original media lookup deferred", {
      registration: mirror.registration,
      mediaKind: mirror.mediaKind,
      message: errorText(error, "Original media lookup failed."),
    });
    return "";
  });
  const candidates = [...new Set([original, mirror.mediaUrl].map((value) => String(value || "").trim()).filter(Boolean))];
  const failures = [];

  for (const candidate of candidates) {
    try {
      const checked = await preflightPublicMedia(candidate, mirror.mediaKind);
      return {
        ...checked,
        source: original && candidate === original ? "original_crm" : "buffer_asset_fallback",
      };
    } catch (error) {
      failures.push(errorText(error, "Media preflight failed."));
    }
  }

  throw new Error(`No publicly usable ${mirror.mediaKind} source passed preflight${failures.length ? `: ${failures.join("; ")}` : "."}`);
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

    const supabase = getSupabase();
    const results = [];
    for (const mirror of mirrors) {
      try {
        const media = await resolveUsableMedia(supabase, mirror);
        const post = await createInstagramPost(channelId, {
          ...mirror,
          mediaUrl: media.url,
        });
        results.push({
          created: true,
          registration: mirror.registration,
          mediaKind: mirror.mediaKind,
          mediaSource: media.source,
          mediaContentType: media.contentType,
          recovery: Boolean(mirror.recovery),
          bufferPostId: post.id,
          dueAt: post.dueAt || mirror.dueAt,
        });
      } catch (error) {
        const message = errorText(error);
        console.error("[buffer-instagram-mirror] Instagram item failed", {
          registration: mirror.registration,
          mediaKind: mirror.mediaKind,
          recovery: Boolean(mirror.recovery),
          message,
        });
        results.push({
          created: false,
          registration: mirror.registration,
          mediaKind: mirror.mediaKind,
          recovery: Boolean(mirror.recovery),
          error: message,
        });
      }
    }

    const failed = results.filter((item) => !item.created).length;
    response.status(200).json({
      ok: failed === 0,
      attention: failed > 0,
      enabled: true,
      channelId,
      candidates: mirrors.length,
      created: results.filter((item) => item.created).length,
      failed,
      recovered: results.filter((item) => item.created && item.recovery).length,
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
