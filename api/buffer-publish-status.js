import { createClient } from "@supabase/supabase-js";
import { BUFFER_API_URL } from "../lib/bufferPublishing.js";
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

const ACCESS_HEADER = "x-marketing-customer-database-key";

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

async function loadSentBufferPosts() {
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bufferToken()}`,
    },
    body: JSON.stringify({ query: BUFFER_SENT_POSTS_QUERY }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || `Buffer returned HTTP ${response.status}.`);
  }
  return parseBufferSentPostsPayload(payload);
}

function trackingDescriptor(post) {
  const destination = bufferDestinationForChannel(post?.channelId);
  const productKey = bufferProductKeyForDestination(destination);
  const sentAt = bufferSentTimestamp(post);
  if (!destination || !productKey || !sentAt || !post?.id) return null;
  const mediaKind = bufferPostMediaKind(post);
  const registration = normalizeBufferRegistration(post?.text);
  return {
    sourceId: `buffer:${post.id}`,
    bufferPostId: String(post.id),
    activityDate: londonDateKey(new Date(sentAt)),
    activityType: bufferPublishedActivityType(destination, mediaKind),
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

async function syncSentPosts(supabase, posts) {
  const descriptors = (posts || []).map(trackingDescriptor).filter(Boolean);
  if (!descriptors.length) return { inserted: 0, matchedManual: 0 };

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
        facebook_live: true,
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
  return { inserted: inserts.length, matchedManual };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
    return;
  }

  try {
    const posts = await loadSentBufferPosts();
    const supabase = getSupabase();
    const sync = await syncSentPosts(supabase, posts);
    const todayKey = londonDateKey();
    response.status(200).json({
      ok: true,
      checked_at: new Date().toISOString(),
      synced: sync.inserted,
      matched_manual: sync.matchedManual,
      today: summarizeBufferPublishedToday(posts, todayKey, londonDateKey),
      recent: bufferPublishedItems(posts),
    });
  } catch (error) {
    console.error("[buffer-publish-status] sync failed", {
      message: error?.message || String(error),
    });
    response.status(500).json({
      ok: false,
      error: error?.message || "Could not confirm Buffer publishing status.",
    });
  }
}
