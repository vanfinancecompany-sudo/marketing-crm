import { createClient } from "@supabase/supabase-js";
import { loadBufferAutomationConfig } from "../lib/bufferAutomationConfig.js";
import {
  bufferAutomationSlots,
  bufferPostDateKey,
  bufferPostMediaKind,
  chooseOldestFacebookCandidate,
  extractBufferRegistration,
  isBufferPostReserved,
  londonDateKeyForValue,
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
  readableBufferError,
} from "../lib/bufferPublishing.js";
import {
  bufferDeferredPayload,
  guardedBufferGraphql,
  isBufferRateLimitCooldownError,
} from "../lib/bufferRuntimeGuard.js";
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
const MIN_SCHEDULE_LEAD_MS = 10 * 60 * 1000;
const REEL_COOLDOWN_MS = 48 * 60 * 60 * 1000;
const CHANNEL_QUEUE_LIMIT = 10;
const PUBLIC_PRODUCTION_ORIGIN = "https://marketing-crm-six.vercel.app";

function errorText(value, fallback = "Automation request failed.") {
  if (value instanceof Error) {
    if (typeof value.message === "string" && value.message.trim()) {
      return value.message.trim();
    }
    if (value.message && typeof value.message === "object") {
      return readableBufferError(value.message, fallback);
    }
  }
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

async function loadBufferPosts() {
  return parseBufferAutomationPostsPayload(await bufferGraphql(BUFFER_AUTOMATION_POSTS_QUERY));
}

async function createBufferScheduledPost({ destination, text, mediaUrl, mediaKind, dueAt }) {
  const input = buildBufferCreatePostInput({
    destination,
    text,
    mediaUrl,
    mediaKind,
    draft: false,
    dueAt,
  });
  return parseBufferCreatePostPayload(
    await bufferGraphql(BUFFER_CREATE_POST_MUTATION, { input }),
  );
}

function channelForProduct(productKey) {
  return BUFFER_FACEBOOK_CHANNELS[bufferDestinationForProduct(productKey)];
}

function postsForProduct(posts, productKey) {
  const channelId = channelForProduct(productKey);
  return (posts || []).filter((post) => post?.channelId === channelId);
}

function liveOrReserved(post) {
  return String(post?.status || "").toLowerCase() !== "error";
}

function queuedCount(posts, productKey) {
  return postsForProduct(posts, productKey).filter(isBufferPostReserved).length;
}

function postDueIso(post) {
  const value = post?.dueAt || post?.sentAt || post?.createdAt;
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function nextFutureSlot({ posts, automationConfig, productKey, dateKey, mediaKind, now }) {
  const slots = bufferAutomationSlots(automationConfig, productKey, dateKey).filter(
    (slot) => slot.mediaKind === mediaKind,
  );
  const existingPosts = postsForProduct(posts, productKey).filter(
    (post) => liveOrReserved(post) && bufferPostDateKey(post) === dateKey && bufferPostMediaKind(post) === mediaKind,
  );
  const existing = existingPosts.length;
  const missed = slots.filter((slot) => new Date(slot.dueAt).getTime() <= now + MIN_SCHEDULE_LEAD_MS).length;
  if (existing >= slots.length) return { slot: null, existing, missed, target: slots.length };

  const occupiedDueAt = new Set(existingPosts.map(postDueIso).filter(Boolean));
  const slot = slots.find(
    (candidate) =>
      new Date(candidate.dueAt).getTime() > now + MIN_SCHEDULE_LEAD_MS &&
      !occupiedDueAt.has(candidate.dueAt),
  ) || null;
  return { slot, existing, missed, target: slots.length };
}

function normalizeReg(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function postTime(post) {
  const value = post?.sentAt || post?.dueAt || post?.createdAt;
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function reservedRegistrations(posts, productKey, dateKey) {
  return postsForProduct(posts, productKey)
    .filter((post) => liveOrReserved(post) && (isBufferPostReserved(post) || bufferPostDateKey(post) === dateKey))
    .map((post) => extractBufferRegistration(post?.text))
    .filter(Boolean);
}

function recentBufferReelRegistrations(posts, productKey, now = Date.now()) {
  return postsForProduct(posts, productKey)
    .filter((post) => liveOrReserved(post) && bufferPostMediaKind(post) === "video")
    .filter((post) => {
      const timestamp = postTime(post);
      return timestamp && now - timestamp < REEL_COOLDOWN_MS;
    })
    .map((post) => extractBufferRegistration(post?.text))
    .filter(Boolean);
}

function bufferHistoryRows(posts, productKey) {
  return postsForProduct(posts, productKey)
    .filter((post) => String(post?.status || "").toLowerCase() === "sent")
    .filter((post) => bufferPostMediaKind(post) === "image")
    .map((post) => ({
      registration: extractBufferRegistration(post?.text),
      occurred_at: post?.sentAt || post?.dueAt || post?.createdAt,
      metadata: { registration: extractBufferRegistration(post?.text) },
    }))
    .filter((row) => row.registration && row.occurred_at);
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
    .in("source", ["posting_desk", "buffer_publish", "buffer_automation"])
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

function findVehicleByRegistration(vehicles, registration) {
  const wanted = normalizeReg(registration);
  if (!wanted) return null;
  return (vehicles || []).find((vehicle) => normalizeReg(
    vehicle?.registration || vehicle?.reg || vehicle?.title || vehicle?.name,
  ) === wanted) || null;
}

async function createNextImagePost({ supabase, posts, automationConfig, productKey, dateKey, now }) {
  if (queuedCount(posts, productKey) >= CHANNEL_QUEUE_LIMIT) {
    return { skipped: "buffer_queue_full" };
  }
  const slotInfo = nextFutureSlot({ posts, automationConfig, productKey, dateKey, mediaKind: "image", now });
  if (!slotInfo.slot) {
    return { skipped: slotInfo.existing >= slotInfo.target ? "target_met" : "no_future_slot", ...slotInfo };
  }

  const [vehicles, historyRows] = await Promise.all([
    loadVehicles(supabase, productKey),
    loadFacebookHistory(supabase, productKey),
  ]);
  const vehicle = chooseOldestFacebookCandidate({
    vehicles,
    historyRows: [...historyRows, ...bufferHistoryRows(posts, productKey)],
    reservedRegistrations: reservedRegistrations(posts, productKey, dateKey),
  });
  if (!vehicle) return { skipped: "no_candidate", ...slotInfo };

  const destination = bufferDestinationForProduct(productKey);
  const text = buildAutomatedFacebookCaption(vehicle, productKey);
  const post = await createBufferScheduledPost({
    destination,
    text,
    mediaUrl: vehicle.image || vehicle.picture,
    mediaKind: "image",
    dueAt: slotInfo.slot.dueAt,
  });
  posts.unshift(post);
  return {
    created: true,
    mediaKind: "image",
    registration: normalizeReg(vehicle.registration || vehicle.reg),
    bufferPostId: post.id,
    dueAt: post.dueAt || slotInfo.slot.dueAt,
    localTime: slotInfo.slot.localTime,
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
  if (result.error) {
    console.error(`[buffer-facebook-automation] ${productKey} ready Reel lookup failed; falling back to fresh render`, {
      message: errorText(result.error, "Ready Reel lookup failed."),
    });
    return [];
  }
  return (result.data || [])
    .filter((row) => row?.metadata?.download_url && !row?.metadata?.deleted_at)
    .map((row) => ({
      registration: normalizeReg(row?.metadata?.registration),
      title: String(row?.metadata?.title || "Vehicle reel").trim(),
      downloadUrl: String(row?.metadata?.download_url || "").trim(),
      row,
    }));
}

function internalBaseUrl(request) {
  const configured = String(process.env.MARKETING_CRM_PUBLIC_ORIGIN || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production") return PUBLIC_PRODUCTION_ORIGIN;

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
    throw new Error(
      errorText(
        payload?.error || payload?.message || payload,
        `${path} returned HTTP ${response.status}.`,
      ),
    );
  }
  return payload;
}

async function generateOneReel(request, productKey, dateKey, packIndex, excludedRegistrations) {
  const candidates = await internalJson(request, "/api/youtube-daily-batch", {
    action: "candidates",
  });
  const list = productKey === "rent2buy" ? candidates.rent2buy : candidates.finance;
  const excluded = new Set((excludedRegistrations || []).map(normalizeReg).filter(Boolean));
  const candidate = Array.isArray(list)
    ? list.find((item) => {
        const registration = normalizeReg(item?.registration);
        return registration && !excluded.has(registration);
      })
    : null;
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

  const operationId = `buffer-auto:${dateKey}:${productKey}:${candidate.registration}`;
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
    registration: normalizeReg(candidate.registration),
    title: candidate.title,
    downloadUrl: rendered.downloadUrl,
    vehicle,
  };
}

async function createNextReel({ request, supabase, posts, automationConfig, productKey, dateKey, now }) {
  if (queuedCount(posts, productKey) >= CHANNEL_QUEUE_LIMIT) {
    return { skipped: "buffer_queue_full" };
  }
  const slotInfo = nextFutureSlot({ posts, automationConfig, productKey, dateKey, mediaKind: "video", now });
  if (!slotInfo.slot) {
    return { skipped: slotInfo.existing >= slotInfo.target ? "target_met" : "no_future_slot", ...slotInfo };
  }

  const currentDayReserved = reservedRegistrations(posts, productKey, dateKey);
  const recentReelReserved = recentBufferReelRegistrations(posts, productKey, now);
  const excluded = [...new Set([...currentDayReserved, ...recentReelReserved])];
  const excludedSet = new Set(excluded);
  const ready = (await loadReadyReels(supabase, productKey, dateKey)).find(
    (reel) => reel.registration && !excludedSet.has(reel.registration),
  );
  const reel = ready || (await generateOneReel(request, productKey, dateKey, slotInfo.existing, excluded));
  if (!reel) return { skipped: "no_candidate", ...slotInfo };

  let captionVehicle = reel.vehicle || null;
  if (!captionVehicle) {
    const vehicles = await loadVehicles(supabase, productKey);
    captionVehicle = findVehicleByRegistration(vehicles, reel.registration);
  }

  const destination = bufferDestinationForProduct(productKey);
  const text = buildAutomatedReelCaption({
    productKey,
    vehicle: captionVehicle,
    registration: reel.registration,
    title: reel.title,
  });
  const post = await createBufferScheduledPost({
    destination,
    text,
    mediaUrl: reel.downloadUrl,
    mediaKind: "video",
    dueAt: slotInfo.slot.dueAt,
  });
  posts.unshift(post);
  return {
    created: true,
    mediaKind: "video",
    registration: reel.registration,
    bufferPostId: post.id,
    dueAt: post.dueAt || slotInfo.slot.dueAt,
    localTime: slotInfo.slot.localTime,
    reusedReadyReel: Boolean(ready),
  };
}

async function safeStep(label, action) {
  try {
    return await action();
  } catch (error) {
    const message = errorText(error, `${label} failed.`);
    console.error(`[buffer-facebook-automation] ${label} failed`, { message });
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
    response.status(401).json({ ok: false, error: "Automation access not recognised." });
    return;
  }

  const startedAt = Date.now();
  try {
    const supabase = getSupabase();
    const automationConfig = await loadBufferAutomationConfig();
    const dateKey = londonDateKeyForValue();

    if (!automationConfig.enabled) {
      response.status(200).json({
        ok: true,
        enabled: false,
        date: dateKey,
        message: "Buffer automation is paused. No content was created.",
      });
      return;
    }
    if (dateKey < automationConfig.startDate) {
      response.status(200).json({
        ok: true,
        enabled: true,
        date: dateKey,
        startDate: automationConfig.startDate,
        message: "Buffer automation is armed and waiting for its start date.",
      });
      return;
    }

    const posts = await loadBufferPosts();
    const now = Date.now();
    const results = { vanFinance: {}, rent2buy: {} };

    for (const productKey of PRODUCTS) {
      results[productKey].image = await safeStep(`${productKey} image`, () =>
        createNextImagePost({
          supabase,
          posts,
          automationConfig,
          productKey,
          dateKey,
          now,
        }),
      );
      results[productKey].video = await safeStep(`${productKey} Reel`, () =>
        createNextReel({
          request,
          supabase,
          posts,
          automationConfig,
          productKey,
          dateKey,
          now,
        }),
      );
    }

    response.status(200).json({
      ok: true,
      enabled: true,
      date: dateKey,
      schedule: {
        vanFinance: bufferAutomationSlots(automationConfig, "vanFinance", dateKey).map(({ localTime, mediaKind }) => ({ localTime, mediaKind })),
        rent2buy: bufferAutomationSlots(automationConfig, "rent2buy", dateKey).map(({ localTime, mediaKind }) => ({ localTime, mediaKind })),
      },
      results,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (isBufferRateLimitCooldownError(error)) {
      console.warn("[buffer-facebook-automation] worker deferred during Buffer cooldown", {
        retryAfterMs: error.retryAfterMs,
      });
      response.status(202).json(bufferDeferredPayload(error, {
        enabled: true,
        elapsedMs: Date.now() - startedAt,
      }));
      return;
    }
    const message = errorText(error, "Buffer Facebook automation worker failed.");
    console.error("[buffer-facebook-automation] worker failed", { message });
    response.status(500).json({
      ok: false,
      error: message,
      elapsedMs: Date.now() - startedAt,
    });
  }
}
