import { createClient } from "@supabase/supabase-js";
import { loadBufferAutomationConfig } from "../lib/bufferAutomationConfig.js";
import {
  bufferAutomationTarget,
  bufferPostMediaKind,
  chooseOldestFacebookCandidate,
  extractBufferRegistration,
  isBufferPostReserved,
  londonDateKeyForValue,
  postCountsTowardLondonDate,
} from "../lib/bufferAutomation.js";
import {
  BUFFER_API_URL,
  BUFFER_AUTOMATION_POSTS_QUERY,
  BUFFER_CREATE_POST_MUTATION,
  BUFFER_FACEBOOK_CHANNELS,
  bufferDestinationForProduct,
  buildBufferCreatePostInput,
  parseBufferAutomationPostsPayload,
  parseBufferCreatePostPayload,
} from "../lib/bufferPublishing.js";
import {
  automatedReelFrameSpecs,
  buildAutomatedFacebookCaption,
  buildAutomatedReelCaption,
} from "../lib/facebookAutomationContent.js";
import {
  mapFinanceVehicleRow,
  mapRentVehicleRow,
} from "../services/marketingVehicleContract.js";

export const config = { maxDuration: 300 };

const ACCESS_HEADER = "x-marketing-customer-database-key";
const PRODUCTS = ["vanFinance", "rent2buy"];
const DESTINATION_BY_CHANNEL = Object.freeze(
  Object.fromEntries(Object.entries(BUFFER_FACEBOOK_CHANNELS).map(([destination, channelId]) => [channelId, destination])),
);

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

function bufferToken() {
  const token = String(process.env.BUFFER_API_KEY || "").trim();
  if (!token) throw new Error("BUFFER_API_KEY is not configured on the server.");
  return token;
}

async function bufferGraphql(query, variables = undefined) {
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bufferToken()}`,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || `Buffer returned HTTP ${response.status}.`);
  }
  return payload;
}

async function loadBufferPosts() {
  return parseBufferAutomationPostsPayload(await bufferGraphql(BUFFER_AUTOMATION_POSTS_QUERY));
}

async function createBufferPost({ destination, text, mediaUrl, mediaKind, mode }) {
  const input = buildBufferCreatePostInput({
    destination,
    text,
    mediaUrl,
    mediaKind,
    deliveryMode: mode === "queue" ? "queue" : "draft",
  });
  return parseBufferCreatePostPayload(
    await bufferGraphql(BUFFER_CREATE_POST_MUTATION, { input }),
  );
}

function activityTypeForDestination(destination) {
  return destination === "Rent2Buy Facebook"
    ? "rent2buy_facebook_post"
    : "van_finance_facebook_post";
}

function productForDestination(destination) {
  return destination === "Rent2Buy Facebook" ? "rent2buy" : "vanFinance";
}

async function reconcileSentImagePosts(supabase, posts) {
  let recorded = 0;
  for (const post of posts || []) {
    if (String(post?.status || "").toLowerCase() !== "sent") continue;
    if (bufferPostMediaKind(post) !== "image") continue;
    const destination = DESTINATION_BY_CHANNEL[post.channelId];
    if (!destination) continue;
    const registration = extractBufferRegistration(post.text);
    if (!registration) continue;

    const activityType = activityTypeForDestination(destination);
    const sourceId = `buffer:${post.id}`;
    const existing = await supabase
      .from("marketing_daily_activity_events")
      .select("id")
      .eq("activity_type", activityType)
      .eq("source", "buffer_automation")
      .eq("source_id", sourceId)
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.id) continue;

    const occurredAt = post.dueAt || post.createdAt || new Date().toISOString();
    const inserted = await supabase.from("marketing_daily_activity_events").insert({
      activity_date: londonDateKeyForValue(occurredAt),
      activity_type: activityType,
      quantity: 1,
      source: "buffer_automation",
      source_id: sourceId,
      metadata: {
        registration,
        destination,
        product_key: productForDestination(destination),
        buffer_post_id: post.id,
        buffer_status: "sent",
        automated: true,
      },
      occurred_at: occurredAt,
    });
    if (inserted.error) throw inserted.error;
    recorded += 1;
  }
  return recorded;
}

async function loadFacebookHistory(supabase, productKey) {
  const activityType = productKey === "rent2buy"
    ? "rent2buy_facebook_post"
    : "van_finance_facebook_post";
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const result = await supabase
    .from("marketing_daily_activity_events")
    .select("id,activity_date,activity_type,source,source_id,metadata,occurred_at")
    .eq("activity_type", activityType)
    .in("source", ["posting_desk", "buffer_automation"])
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(2500);
  if (result.error) throw result.error;
  return result.data || [];
}

async function loadVehicles(supabase, productKey) {
  if (productKey === "rent2buy") {
    const result = await supabase
      .from("rent_vehicles")
      .select("id,created_at,registration,picture,monthly,week,initialRental,vanDescription,vanSpec,webLink,is_active")
      .eq("is_active", true)
      .limit(500);
    if (result.error) throw result.error;
    return (result.data || []).map(mapRentVehicleRow);
  }
  const result = await supabase
    .from("facebook_adverts")
    .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
    .eq("is_active", true)
    .limit(500);
  if (result.error) throw result.error;
  return (result.data || []).map(mapFinanceVehicleRow);
}

function postsForProduct(posts, productKey) {
  const destination = bufferDestinationForProduct(productKey);
  const channelId = BUFFER_FACEBOOK_CHANNELS[destination];
  return (posts || []).filter((post) => post.channelId === channelId);
}

function reservedRegistrations(posts, productKey) {
  return postsForProduct(posts, productKey)
    .filter(isBufferPostReserved)
    .map((post) => extractBufferRegistration(post.text))
    .filter(Boolean);
}

function countBufferItemsForDate(posts, productKey, mediaKind, dateKey) {
  return postsForProduct(posts, productKey).filter(
    (post) =>
      String(post?.status || "").toLowerCase() !== "error" &&
      bufferPostMediaKind(post) === mediaKind &&
      postCountsTowardLondonDate(post, dateKey),
  ).length;
}

async function createNextImagePost({ supabase, posts, config, productKey, dateKey }) {
  const target = bufferAutomationTarget(config, productKey, "image");
  const existing = countBufferItemsForDate(posts, productKey, "image", dateKey);
  if (target <= existing) return { skipped: "target_met", target, existing };

  const [vehicles, historyRows] = await Promise.all([
    loadVehicles(supabase, productKey),
    loadFacebookHistory(supabase, productKey),
  ]);
  const vehicle = chooseOldestFacebookCandidate({
    vehicles,
    historyRows,
    reservedRegistrations: reservedRegistrations(posts, productKey),
  });
  if (!vehicle) return { skipped: "no_candidate", target, existing };

  const destination = bufferDestinationForProduct(productKey);
  const post = await createBufferPost({
    destination,
    text: buildAutomatedFacebookCaption(vehicle, productKey, existing),
    mediaUrl: vehicle.image || vehicle.picture,
    mediaKind: "image",
    mode: config.mode,
  });
  return {
    created: true,
    target,
    existing,
    registration: String(vehicle.registration || vehicle.reg || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    bufferPostId: post.id,
    status: post.status || (config.mode === "draft" ? "draft" : "scheduled"),
  };
}

async function loadReadyReels(supabase, productKey, dateKey) {
  const activityType = productKey === "rent2buy" ? "rent2buy_reel" : "van_finance_reel";
  const result = await supabase
    .from("marketing_daily_activity_events")
    .select("id,activity_date,activity_type,source,source_id,metadata,occurred_at")
    .eq("activity_date", dateKey)
    .eq("activity_type", activityType)
    .eq("source", "youtube_daily_batch")
    .order("occurred_at", { ascending: true })
    .limit(100);
  if (result.error) throw result.error;
  return (result.data || [])
    .filter((row) => row?.metadata?.download_url && !row?.metadata?.deleted_at)
    .map((row) => ({
      registration: String(row?.metadata?.registration || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
      title: String(row?.metadata?.title || "Vehicle reel").trim(),
      downloadUrl: String(row?.metadata?.download_url || "").trim(),
      row,
    }));
}

function internalBaseUrl(request) {
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || process.env.VERCEL_URL || "").trim();
  if (!host) throw new Error("Could not resolve the Marketing CRM host for Reel automation.");
  return `${host.includes("localhost") ? "http" : "https"}://${host}`;
}

async function internalJson(request, path, body, authenticated = true) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (authenticated) {
    const key = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "").trim();
    if (!key) throw new Error("MARKETING_CUSTOMER_DATABASE_API_KEY is required for automated Reel generation.");
    headers[ACCESS_HEADER] = key;
  }
  const response = await fetch(`${internalBaseUrl(request)}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || payload?.message || `${path} returned HTTP ${response.status}.`);
  }
  return payload;
}

async function generateOneReel(request, productKey, dateKey, packIndex) {
  const candidates = await internalJson(request, "/api/youtube-daily-batch", { action: "candidates" });
  const list = productKey === "rent2buy" ? candidates.rent2buy : candidates.finance;
  const candidate = Array.isArray(list) ? list[0] : null;
  if (!candidate) return null;
  const vehicle = candidate.vehicle || {};
  const rendered = await internalJson(
    request,
    "/api/youtube-mp4-render",
    {
      productKey,
      registration: candidate.registration,
      title: candidate.title,
      priceText: vehicle.price || vehicle.initialRental || "",
      monthlyText: vehicle.monthly || vehicle.salePrice || vehicle.week || "",
      imageUrls: (candidate.images || []).slice(0, 10),
      frameSpecs: automatedReelFrameSpecs(productKey, packIndex),
      frameCount: 10,
      durationSeconds: 20,
      fps: 24,
      templateKey: "tiktokPunch",
      premiumMotion: true,
    },
    false,
  );
  const operationId = `buffer-auto:${dateKey}:${productKey}:${candidate.registration}:${Date.now()}`;
  await internalJson(request, "/api/youtube-daily-batch", {
    action: "record",
    productKey,
    registration: candidate.registration,
    title: candidate.title,
    filename: `${candidate.registration.toLowerCase()}-${productKey}-buffer.mp4`,
    downloadUrl: rendered.downloadUrl,
    blobPathname: rendered.blobPathname,
    sizeBytes: rendered.sizeBytes,
    operationId,
  });
  return {
    registration: candidate.registration,
    title: candidate.title,
    downloadUrl: rendered.downloadUrl,
  };
}

async function createNextReel({ request, supabase, posts, config, productKey, dateKey }) {
  const target = bufferAutomationTarget(config, productKey, "video");
  const existing = countBufferItemsForDate(posts, productKey, "video", dateKey);
  if (target <= existing) return { skipped: "target_met", target, existing };

  const reservations = new Set(
    reservedRegistrations(posts, productKey).map((value) => value.toUpperCase()),
  );
  const ready = (await loadReadyReels(supabase, productKey, dateKey)).find(
    (reel) => reel.registration && !reservations.has(reel.registration),
  );
  const reel = ready || (await generateOneReel(request, productKey, dateKey, existing));
  if (!reel) return { skipped: "no_candidate", target, existing };

  const destination = bufferDestinationForProduct(productKey);
  const post = await createBufferPost({
    destination,
    text: buildAutomatedReelCaption({
      productKey,
      registration: reel.registration,
      title: reel.title,
    }),
    mediaUrl: reel.downloadUrl,
    mediaKind: "video",
    mode: config.mode,
  });
  return {
    created: true,
    target,
    existing,
    registration: reel.registration,
    bufferPostId: post.id,
    status: post.status || (config.mode === "draft" ? "draft" : "scheduled"),
    reusedReadyReel: Boolean(ready),
  };
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
    const supabase = getSupabase();
    const automationConfig = await loadBufferAutomationConfig();
    const dateKey = londonDateKeyForValue();
    const posts = await loadBufferPosts();
    const reconciledImagePosts = await reconcileSentImagePosts(supabase, posts);

    if (automationConfig.mode === "off") {
      response.status(200).json({
        ok: true,
        mode: "off",
        date: dateKey,
        reconciledImagePosts,
        message: "Buffer automation is OFF. No content was created.",
      });
      return;
    }

    const results = { images: {}, reels: {} };
    for (const productKey of PRODUCTS) {
      results.images[productKey] = await createNextImagePost({
        supabase,
        posts,
        config: automationConfig,
        productKey,
        dateKey,
      });
    }
    for (const productKey of PRODUCTS) {
      results.reels[productKey] = await createNextReel({
        request,
        supabase,
        posts,
        config: automationConfig,
        productKey,
        dateKey,
      });
    }

    response.status(200).json({
      ok: true,
      mode: automationConfig.mode,
      date: dateKey,
      reconciledImagePosts,
      results,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[buffer-facebook-automation] worker failed", {
      message: error?.message || String(error),
    });
    response.status(500).json({
      ok: false,
      error: error?.message || "Buffer Facebook automation worker failed.",
      elapsedMs: Date.now() - startedAt,
    });
  }
}
