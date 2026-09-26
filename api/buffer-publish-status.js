import { createClient } from "@supabase/supabase-js";
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
import { loadVanscoAutomationStatus } from "./_vansco-buffer-runtime.js";
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

function trackingDescriptor(post, googleBusinessChannelId = "") {
  const destination = bufferDestinationForChannel(post?.channelId, googleBusinessChannelId);
  const productKey = bufferProductKeyForDestination(destination, post?.text);
  const sentAt = bufferSentTimestamp(post);
  if (!destination || !productKey || !sentAt || !post?.id) return null;
  const mediaKind = bufferPostMediaKind(post);
  const registration = normalizeBufferRegistration(post?.text);
  return {
    sourceId: `buffer:${post.id}`,
    bufferPostId: String(post.id),
    activityDate: londonDateKey(new Date(sentAt)),
    activityType: bufferPublishedActivityType(destination, mediaKind, productKey),
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

async function syncSentPosts(supabase, posts, googleBusinessChannelId = "") {
  const descriptors = (posts || [])
    .map((post) => trackingDescriptor(post, googleBusinessChannelId))
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
      "rent2buy_facebook_post",
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
        status_event: item.mediaKind === "video" ? "facebook_published" : "facebook_posted",
      },
      occurred_at: item.sentAt,
    });
  }

  if (inserts.length) {
    const inserted = await supabase.from("marketing_daily_activity_events").insert(inserts);
    if (inserted.error) throw inserted.error;
  }
  return { inserted: inserts.length, matchedManual, descriptors };
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

  try {
    const channels = await loadBufferChannels();
    let googleBusinessChannel = null;
    try {
      googleBusinessChannel = selectVanFinanceGoogleBusinessChannel(channels);
    } catch (error) {
      console.warn("[buffer-publish-status] Google Business channel unavailable", {
        message: error?.message || String(error),
      });
    }
    const channelIds = [
      ...Object.values(BUFFER_FACEBOOK_CHANNELS),
      ...(googleBusinessChannel?.id ? [googleBusinessChannel.id] : []),
    ];
    const posts = await loadSentBufferPosts(channelIds);
    const supabase = getSupabase();
    const googleBusinessChannelId = googleBusinessChannel?.id || "";
    const sync = await syncSentPosts(supabase, posts, googleBusinessChannelId);
    const cleanup = await cleanDeliveredReelBlobs(supabase, sync.descriptors);
    const todayKey = londonDateKey();
    const result = {
      ok: true,
      checked_at: new Date().toISOString(),
      synced: sync.inserted,
      matched_manual: sync.matchedManual,
      cleaned_reel_blobs: cleanup.cleaned,
      google_business_channel: googleBusinessChannel
        ? {
            id: googleBusinessChannel.id,
            name: googleBusinessChannel.displayName || googleBusinessChannel.name || "Van Finance Company",
            connected: true,
          }
        : { connected: false },
      today: await withVanscoToday(
        summarizeBufferPublishedToday(posts, todayKey, londonDateKey, {
          googleBusinessChannelId,
        }),
        todayKey,
      ),
      recent: bufferPublishedItems(posts, { googleBusinessChannelId }),
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
