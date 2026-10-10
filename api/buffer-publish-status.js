import { createClient } from "@supabase/supabase-js";
import {
  bufferDormantPayload,
  isBufferApiActiveWindow,
} from "../lib/bufferActiveWindow.js";
import { del } from "@vercel/blob";
import {
  BUFFER_API_URL,
  BUFFER_CHANNELS_QUERY,
  BUFFER_FACEBOOK_CHANNELS,
  BUFFER_ORGANIZATION_ID,
  parseBufferChannelsPayload,
  selectVanFinanceGoogleBusinessChannel,
} from "../lib/bufferPublishing.js";
import {
  BUFFER_SENT_POSTS_QUERY,
  bufferDestinationForChannel,
  bufferPostMediaKind,
  bufferProductKeyForDestination,
  bufferPublishedActivityType,
  bufferPublishedItems,
  bufferSentTimestamp,
  normalizeBufferRegistration,
  parseBufferSentPostsPayload,
  summarizeBufferPublishedToday,
} from "../lib/bufferPublishStatus.js";
import { londonDateKey } from "../lib/marketingDailyOperations.js";
import { loadBufferAutomationConfig } from "../lib/bufferAutomationConfig.js";
import {
  isVanscoFacebookStory,
  loadVanscoAutomationStatus,
  loadVanscoCombinedStatusSnapshot,
} from "./_vansco-buffer-runtime.js";
import {
  bufferDeferredPayload,
  guardedBufferGraphql,
  isBufferRateLimitCooldownError,
  loadBufferStatusSnapshot,
  saveBufferStatusSnapshot,
} from "../lib/bufferRuntimeGuard.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";
const REEL_BLOB_MIN_SENT_AGE_MS = 72 * 60 * 60 * 1000;

function authorize(request) {
  const marketingKey = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "");
  const cronSecret = String(process.env.CRON_SECRET || "");
  const supplied = String(request.headers[ACCESS_HEADER] || "");
  const authorization = String(request.headers.authorization || "");
  return Boolean(
    (marketingKey && (supplied === marketingKey || authorization === `Bearer ${marketingKey}`)) ||
    (cronSecret && authorization === `Bearer ${cronSecret}`),
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

function bufferToken() {
  const token = String(process.env.BUFFER_API_KEY || "").trim();
  if (!token) throw new Error("BUFFER_API_KEY is not configured on the server.");
  return token;
}

async function loadBufferChannels() {
  const payload = await guardedBufferGraphql({
    url: BUFFER_API_URL,
    token: bufferToken(),
    query: BUFFER_CHANNELS_QUERY,
    variables: { organizationId: BUFFER_ORGANIZATION_ID },
  });
  return parseBufferChannelsPayload(payload);
}

async function loadSentBufferPosts(channelIds) {
  const payload = await guardedBufferGraphql({
    url: BUFFER_API_URL,
    token: bufferToken(),
    query: BUFFER_SENT_POSTS_QUERY,
    variables: { channelIds },
  });
  return parseBufferSentPostsPayload(payload);
}

async function resolveGoogleBusinessChannelForStatus() {
  const snapshot = await loadBufferStatusSnapshot();
  const cached = snapshot?.google_business_channel;
  if (cached?.connected && cached?.id) {
    return {
      id: String(cached.id),
      name: String(cached.name || "Van Finance Company"),
      displayName: String(cached.name || "Van Finance Company"),
      service: "googlebusiness",
      isDisconnected: false,
      isLocked: false,
    };
  }

  const channels = await loadBufferChannels();
  return selectVanFinanceGoogleBusinessChannel(channels);
}

async function resolveInstagramChannelForStatus() {
  try {
    const config = await loadBufferAutomationConfig({ useDailyTargets: false });
    const id = String(config?.vanFinanceInstagramChannelId || "").trim();
    return id
      ? { id, name: "Van Finance Instagram", connected: true }
      : { id: "", name: "Van Finance Instagram", connected: false };
  } catch (error) {
    console.warn("[buffer-publish-status] Instagram channel unavailable", {
      message: error?.message || String(error),
    });
    return { id: "", name: "Van Finance Instagram", connected: false };
  }
}

async function vanscoPublishedToday(todayKey) {
  try {
    const status = await loadVanscoAutomationStatus();
    const statusDate = String(status?.date || "");
    const confirmedAt = String(
      status?.lastSuccessAt || status?.attemptedAt || status?.updatedAt || "",
    ).trim();
    const sameDay = statusDate === todayKey;
    const healthy = sameDay && status?.ok !== false && String(status?.state || "").toLowerCase() !== "failed";
    const posts = healthy
      ? Math.max(0, Number(status?.buffer?.providerSent) || 0)
      : 0;
    return {
      posts,
      reels: 0,
      total: posts,
      confirmed: healthy,
      confirmedAt: sameDay ? confirmedAt : "",
      state: sameDay ? String(status?.state || "") : "waiting",
      error: sameDay && !healthy,
    };
  } catch (error) {
    console.warn("[buffer-publish-status] Vansco heartbeat unavailable", {
      message: error?.message || String(error),
    });
    return {
      posts: 0,
      reels: 0,
      total: 0,
      confirmed: false,
      confirmedAt: "",
      state: "unavailable",
      error: true,
    };
  }
}

async function withVanscoToday(today, todayKey) {
  if (!today) return today;
  return {
    ...today,
    vansco: await vanscoPublishedToday(todayKey),
  };
}

function trackingDescriptor(post, googleBusinessChannelId = "", instagramChannelId = "") {
  const destination = bufferDestinationForChannel(
    post?.channelId,
    googleBusinessChannelId,
    instagramChannelId,
  );
  const productKey = bufferProductKeyForDestination(destination, post?.text);
  const sentAt = bufferSentTimestamp(post);
  if (!destination || !productKey || !sentAt || !post?.id) return null;
  const mediaKind = bufferPostMediaKind(post);
  const activityType = bufferPublishedActivityType(destination, mediaKind, productKey);
  if (!activityType) return null;
  const registration = normalizeBufferRegistration(post?.text);
  return {
    sourceId: `buffer:${post.id}`,
    bufferPostId: String(post.id),
    activityDate: londonDateKey(new Date(sentAt)),
    activityType,
    destination,
    productKey,
    mediaKind,
    registration,
    sentAt,
    externalLink: String(post?.externalLink || ""),
  };
}

function registrationKey(row) {
  return String(row?.metadata?.registration || row?.metadata?.reg || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

// Parallel status refreshes can race after their read of existing source IDs.
// Treat the uniqueness constraint as an idempotency guard, not a failed sync.
// The slower row-by-row fallback runs only if a conflicting batch is detected.
export async function insertBufferActivityIdempotently(supabase, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const batch = await supabase.from("marketing_daily_activity_events").insert(rows);
  if (!batch.error) return rows.length;
  if (String(batch.error.code || "") !== "23505") throw batch.error;

  let inserted = 0;
  for (const row of rows) {
    const single = await supabase.from("marketing_daily_activity_events").insert([row]);
    if (!single.error) inserted += 1;
    else if (String(single.error.code || "") !== "23505") throw single.error;
  }
  return inserted;
}

async function syncSentPosts(
  supabase,
  posts,
  googleBusinessChannelId = "",
  instagramChannelId = "",
) {
  const descriptors = (posts || [])
    .map((post) => trackingDescriptor(post, googleBusinessChannelId, instagramChannelId))
    .filter(Boolean);
  if (!descriptors.length) return { inserted: 0, matchedManual: 0, descriptors: [] };

  const dates = descriptors.map((item) => item.activityDate).sort();
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  const existing = await supabase
    .from("marketing_daily_activity_events")
    .select("id,activity_date,activity_type,source,source_id,metadata,occurred_at")
    .gte("activity_date", startDate)
    .lte("activity_date", endDate)
    .in("activity_type", [
      "van_finance_facebook_post",
      "van_finance_facebook_story",
      "van_finance_instagram_post",
      "van_finance_instagram_story",
      "van_finance_instagram_reel",
      "rent2buy_facebook_post",
      "rent2buy_facebook_story",
      "van_finance_reel",
      "rent2buy_reel",
      "van_finance_google_business_post",
      "rent2buy_google_business_post",
    ])
    .limit(5000);
  if (existing.error) throw existing.error;

  const rows = existing.data || [];
  const existingSourceIds = new Set(rows.map((row) => String(row.source_id || "")).filter(Boolean));
  const manualImageKeys = new Set(
    rows
      .filter((row) => row.source === "posting_desk")
      .map((row) => `${row.activity_date}|${row.activity_type}|${registrationKey(row)}`),
  );

  const inserts = [];
  let matchedManual = 0;
  for (const item of descriptors) {
    if (existingSourceIds.has(item.sourceId)) continue;
    const duplicateManualKey = `${item.activityDate}|${item.activityType}|${item.registration}`;
    if (item.mediaKind === "image" && item.registration && manualImageKeys.has(duplicateManualKey)) {
      matchedManual += 1;
      continue;
    }
    inserts.push({
      activity_date: item.activityDate,
      activity_type: item.activityType,
      quantity: 1,
      source: "buffer_publish",
      source_id: item.sourceId,
      metadata: {
        registration: item.registration,
        destination: item.destination,
        product_key: item.productKey,
        media_kind: item.mediaKind,
        buffer_post_id: item.bufferPostId,
        buffer_status: "sent",
        facebook_live: item.destination !== "Van Finance Google Business",
        google_business_live: item.destination === "Van Finance Google Business",
        external_link: item.externalLink,
        sent_at: item.sentAt,
        status_event: item.destination === "Van Finance Google Business"
          ? "google_business_posted"
          : item.mediaKind === "video"
            ? "facebook_published"
            : "facebook_posted",
      },
      occurred_at: item.sentAt,
    });
  }

  const inserted = await insertBufferActivityIdempotently(supabase, inserts);
  return { inserted, matchedManual, descriptors };
}

const VANSCO_GOOGLE_ACTIVITY_TYPES = Object.freeze({
  vansco333: "vansco_333_google_business_post",
  southamptonAirport: "vansco_airport_google_business_post",
  newForest: "vansco_new_forest_google_business_post",
});

function vanscoSentDescriptors(snapshot) {
  const items = [];
  const add = (post, activityType, branchKey = "") => {
    if (String(post?.status || "").toLowerCase() !== "sent" || !post?.id) return;
    const sentAt = String(post?.sentAt || post?.dueAt || post?.createdAt || "").trim();
    if (!sentAt) return;
    items.push({
      sourceId: `vansco-buffer:${post.id}`,
      activityDate: londonDateKey(new Date(sentAt)),
      activityType,
      sentAt,
      bufferPostId: String(post.id),
      branchKey,
    });
  };

  for (const post of snapshot?.facebook?.posts || []) {
    add(
      post,
      isVanscoFacebookStory(post)
        ? "vansco_facebook_story"
        : "vansco_facebook_post",
    );
  }
  for (const [branchKey, branch] of Object.entries(snapshot?.googleBusiness?.branches || {})) {
    const activityType = VANSCO_GOOGLE_ACTIVITY_TYPES[branchKey];
    if (!activityType) continue;
    for (const post of branch?.posts || []) add(post, activityType, branchKey);
  }
  return items;
}

async function syncVanscoSentPosts(supabase, snapshot) {
  const descriptors = vanscoSentDescriptors(snapshot);
  if (!descriptors.length) return { inserted: 0, descriptors: [] };

  const dates = descriptors.map((item) => item.activityDate).sort();
  const existing = await supabase
    .from("marketing_daily_activity_events")
    .select("source_id")
    .gte("activity_date", dates[0])
    .lte("activity_date", dates[dates.length - 1])
    .in("activity_type", [
      "vansco_facebook_post",
      "vansco_facebook_story",
      "vansco_333_google_business_post",
      "vansco_airport_google_business_post",
      "vansco_new_forest_google_business_post",
    ])
    .limit(5000);
  if (existing.error) throw existing.error;

  const seen = new Set((existing.data || []).map((row) => String(row.source_id || "")).filter(Boolean));
  const inserts = descriptors
    .filter((item) => !seen.has(item.sourceId))
    .map((item) => ({
      activity_date: item.activityDate,
      activity_type: item.activityType,
      quantity: 1,
      source: "buffer_publish",
      source_id: item.sourceId,
      metadata: {
        buffer_post_id: item.bufferPostId,
        buffer_status: "sent",
        branch_key: item.branchKey || null,
        sent_at: item.sentAt,
        status_event: "buffer_published",
      },
      occurred_at: item.sentAt,
    }));

  const inserted = await insertBufferActivityIdempotently(supabase, inserts);
  return { inserted, descriptors };
}

async function cleanDeliveredReelBlobs(supabase, descriptors) {
  const sentReels = (descriptors || []).filter(
    (item) => item.mediaKind === "video" && item.registration && item.sentAt,
  );
  if (!sentReels.length) return { cleaned: 0 };

  const since = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const result = await supabase
    .from("marketing_daily_activity_events")
    .select("id,source,metadata,occurred_at")
    .eq("source", "youtube_daily_batch")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (result.error) throw result.error;

  const rows = result.data || [];
  let cleaned = 0;
  const alreadyHandled = new Set();
  for (const item of sentReels) {
    const sentAtMs = new Date(item.sentAt || 0).getTime();
    if (!Number.isFinite(sentAtMs) || Date.now() - sentAtMs < REEL_BLOB_MIN_SENT_AGE_MS) continue;

    const row = rows.find((candidate) => {
      if (alreadyHandled.has(candidate.id)) return false;
      if (candidate?.metadata?.deleted_at) return false;
      return registrationKey(candidate) === item.registration && candidate?.metadata?.download_url;
    });
    if (!row) continue;

    const url = String(row.metadata.download_url || "").trim();
    if (!url) continue;
    try {
      await del(url);
      const updated = await supabase
        .from("marketing_daily_activity_events")
        .update({
          metadata: {
            ...(row.metadata || {}),
            deleted_at: new Date().toISOString(),
            buffer_post_id: item.bufferPostId,
            facebook_live: true,
          },
        })
        .eq("id", row.id);
      if (updated.error) throw updated.error;
      alreadyHandled.add(row.id);
      cleaned += 1;
    } catch (error) {
      console.warn("[buffer-publish-status] Reel blob cleanup deferred", {
        registration: item.registration,
        message: error?.message || String(error),
      });
    }
  }
  return { cleaned };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
    return;
  }

  if (!isBufferApiActiveWindow()) {
    const cached = await loadBufferStatusSnapshot();
    if (cached) {
      response.status(200).json({
        ...cached,
        ...bufferDormantPayload({
          stale: true,
          checked_at: new Date().toISOString(),
          last_success_at: cached.checked_at || cached.cached_at || null,
          message: "Buffer live confirmation is paused overnight; cached daytime counts are being shown.",
        }),
      });
      return;
    }
    response.status(200).json(bufferDormantPayload({
      stale: true,
      checked_at: new Date().toISOString(),
      last_success_at: null,
      today: null,
      recent: [],
      message: "Buffer live confirmation is paused overnight.",
    }));
    return;
  }

  try {
    let googleBusinessChannel = null;
    try {
      googleBusinessChannel = await resolveGoogleBusinessChannelForStatus();
    } catch (error) {
      console.warn("[buffer-publish-status] Google Business channel unavailable", {
        message: error?.message || String(error),
      });
    }
    const instagramChannel = await resolveInstagramChannelForStatus();
    const channelIds = [
      ...Object.values(BUFFER_FACEBOOK_CHANNELS),
      ...(googleBusinessChannel?.id ? [googleBusinessChannel.id] : []),
      ...(instagramChannel?.id ? [instagramChannel.id] : []),
    ];
    const posts = await loadSentBufferPosts(channelIds);
    const supabase = getSupabase();
    const googleBusinessChannelId = googleBusinessChannel?.id || "";
    const instagramChannelId = instagramChannel?.id || "";
    const sync = await syncSentPosts(
      supabase,
      posts,
      googleBusinessChannelId,
      instagramChannelId,
    );
    const cleanup = await cleanDeliveredReelBlobs(supabase, sync.descriptors);
    const vanscoSnapshot = await loadVanscoCombinedStatusSnapshot().catch((error) => {
      console.warn("[buffer-publish-status] Vansco placement history sync deferred", {
        message: error?.message || String(error),
      });
      return null;
    });
    const vanscoSync = vanscoSnapshot
      ? await syncVanscoSentPosts(supabase, vanscoSnapshot)
      : { inserted: 0, descriptors: [] };
    const todayKey = londonDateKey();
    const result = {
      ok: true,
      checked_at: new Date().toISOString(),
      synced: sync.inserted + vanscoSync.inserted,
      synced_vansco: vanscoSync.inserted,
      matched_manual: sync.matchedManual,
      cleaned_reel_blobs: cleanup.cleaned,
      google_business_channel: googleBusinessChannel
        ? {
            id: googleBusinessChannel.id,
            name: googleBusinessChannel.displayName || googleBusinessChannel.name || "Van Finance Company",
            connected: true,
          }
        : { connected: false },
      instagram_channel: instagramChannel,
      today: await withVanscoToday(
        summarizeBufferPublishedToday(posts, todayKey, londonDateKey, {
          googleBusinessChannelId,
          instagramChannelId,
        }),
        todayKey,
      ),
      recent: bufferPublishedItems(posts, {
        googleBusinessChannelId,
        instagramChannelId,
      }),
    };
    await saveBufferStatusSnapshot(result);
    response.status(200).json(result);
  } catch (error) {
    if (isBufferRateLimitCooldownError(error)) {
      const cached = await loadBufferStatusSnapshot();
      console.warn("[buffer-publish-status] serving cached status during cooldown", {
        retryAfterMs: error.retryAfterMs,
        cached: Boolean(cached),
      });
      if (cached) {
        const todayKey = londonDateKey();
        response.status(200).json({
          ...cached,
          ...bufferDeferredPayload(error),
          stale: true,
          checked_at: new Date().toISOString(),
          last_success_at: cached.checked_at || cached.cached_at || null,
          today: await withVanscoToday(cached.today, todayKey),
        });
      } else {
        response.status(200).json(bufferDeferredPayload(error, {
          stale: true,
          checked_at: new Date().toISOString(),
          last_success_at: null,
          today: null,
          recent: [],
        }));
      }
      return;
    }
    console.error("[buffer-publish-status] sync failed", {
      message: error?.message || String(error),
    });
    response.status(500).json({
      ok: false,
      error: error?.message || "Could not confirm Buffer publishing status.",
    });
  }
}
