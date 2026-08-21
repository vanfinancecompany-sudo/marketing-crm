import { del } from "@vercel/blob";
import { loadBufferAutomationConfig } from "../lib/bufferAutomationConfig.js";
import {
  bufferAutomationSlots,
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
  automatedReelFrameSpecs,
  buildAutomatedReelCaption,
} from "../lib/facebookAutomationContent.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";
const RUN_KEY = "rb21-6d9f42c7";
const MIN_LEAD_MS = 10 * 60 * 1000;
const QUEUE_LIMIT = 10;
const REEL_COOLDOWN_MS = 48 * 60 * 60 * 1000;

function safe(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function baseUrl(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || process.env.VERCEL_URL || "").trim();
  return `${host.includes("localhost") ? "http" : "https"}://${host}`;
}

async function readJson(response) {
  const text = await response.text();
  try { return { payload: JSON.parse(text), raw: text }; }
  catch { return { payload: {}, raw: text }; }
}

async function bufferGraphql(query, variables) {
  const token = String(process.env.BUFFER_API_KEY || "").trim();
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const read = await readJson(response);
  if (!response.ok) {
    throw new Error(readableBufferError(read.payload?.errors?.[0]?.message || read.payload || read.raw, `Buffer HTTP ${response.status}`));
  }
  return read.payload;
}

async function internalPost(req, path, body, authenticated = true) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (authenticated) {
    const key = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "").trim();
    headers[ACCESS_HEADER] = key;
  }
  const response = await fetch(`${baseUrl(req)}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const read = await readJson(response);
  if (!response.ok || read.payload?.ok === false) {
    throw new Error(safe(read.payload?.error || read.payload?.message || read.raw || `${path} HTTP ${response.status}`));
  }
  return read.payload;
}

function productKey(value) {
  return value === "rent2buy" ? "rent2buy" : "vanFinance";
}

function channelIdForProduct(key) {
  return BUFFER_FACEBOOK_CHANNELS[bufferDestinationForProduct(key)];
}

function postTime(post) {
  const timestamp = new Date(post?.sentAt || post?.dueAt || post?.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (String(req.query?.run || "") !== RUN_KEY) return res.status(404).json({ ok: false });

  const key = productKey(req.query?.product);
  let renderUrl = "";
  let bufferPostId = "";
  try {
    if (!process.env.BUFFER_API_KEY || !process.env.MARKETING_CUSTOMER_DATABASE_API_KEY) {
      throw new Error("Required server keys are not configured.");
    }

    const [automationConfig, postsPayload] = await Promise.all([
      loadBufferAutomationConfig(),
      bufferGraphql(BUFFER_AUTOMATION_POSTS_QUERY),
    ]);
    const posts = parseBufferAutomationPostsPayload(postsPayload);
    const channelId = channelIdForProduct(key);
    const channelPosts = posts.filter((post) => post?.channelId === channelId);
    const queued = channelPosts.filter(isBufferPostReserved).length;
    if (queued >= QUEUE_LIMIT) {
      return res.status(200).json({ ok: false, stage: "queue", productKey: key, queued, error: "Buffer queue is already at the safety cap." });
    }

    const now = Date.now();
    const dateKey = londonDateKeyForValue();
    const occupiedDueAt = new Set(channelPosts.map((post) => {
      const value = post?.dueAt;
      if (!value) return "";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "" : date.toISOString();
    }).filter(Boolean));
    const slot = bufferAutomationSlots(automationConfig, key, dateKey)
      .filter((item) => item.mediaKind === "video")
      .find((item) => new Date(item.dueAt).getTime() > now + MIN_LEAD_MS && !occupiedDueAt.has(item.dueAt));
    if (!slot) {
      return res.status(200).json({ ok: false, stage: "slot", productKey: key, error: "No future Reel slot is available today." });
    }

    const reserved = new Set(channelPosts
      .filter((post) => isBufferPostReserved(post) || postTime(post) > now - REEL_COOLDOWN_MS)
      .map((post) => extractBufferRegistration(post?.text))
      .filter(Boolean));

    const candidates = await internalPost(req, "/api/youtube-daily-batch", { action: "candidates" });
    const list = key === "rent2buy" ? candidates.rent2buy : candidates.finance;
    const candidate = Array.isArray(list)
      ? list.find((item) => item?.registration && !reserved.has(String(item.registration).replace(/[^A-Z0-9]/gi, "").toUpperCase()))
      : null;
    if (!candidate) {
      return res.status(200).json({ ok: false, stage: "candidate", productKey: key, error: "No eligible 10-image Reel candidate is available." });
    }
    if (!Array.isArray(candidate.images) || candidate.images.length < 10) {
      throw new Error("Selected Reel candidate does not have the required 10 images.");
    }

    const vehicle = candidate.vehicle || {};
    const rendered = await internalPost(req, "/api/youtube-mp4-render", {
      productKey: key,
      registration: candidate.registration,
      title: candidate.title,
      priceText: vehicle.price || vehicle.initialRental || "",
      monthlyText: vehicle.monthly || vehicle.salePrice || vehicle.week || "",
      imageUrls: candidate.images.slice(0, 10),
      frameSpecs: automatedReelFrameSpecs(key, 0),
      frameCount: 10,
      durationSeconds: 20,
      fps: 24,
      templateKey: "tiktokPunch",
      premiumMotion: true,
    }, false);
    renderUrl = String(rendered?.downloadUrl || "");
    if (!renderUrl || Number(rendered?.sourceImageCount || 0) < 10 || Number(rendered?.usableImageCount || 0) < 10) {
      throw new Error(`Rendered Reel failed the 10-image safeguard: source=${rendered?.sourceImageCount || 0}, usable=${rendered?.usableImageCount || 0}`);
    }

    const caption = buildAutomatedReelCaption({
      productKey: key,
      registration: candidate.registration,
      title: candidate.title,
    });
    const input = buildBufferCreatePostInput({
      destination: bufferDestinationForProduct(key),
      text: caption,
      mediaUrl: renderUrl,
      mediaKind: "video",
      draft: false,
      dueAt: slot.dueAt,
    });
    const created = parseBufferCreatePostPayload(await bufferGraphql(BUFFER_CREATE_POST_MUTATION, { input }));
    bufferPostId = String(created?.id || "");
    if (!bufferPostId) throw new Error("Buffer did not return a scheduled Reel post ID.");

    let recordError = "";
    try {
      await internalPost(req, "/api/youtube-daily-batch", {
        action: "record",
        productKey: key,
        registration: candidate.registration,
        title: candidate.title,
        filename: `${String(candidate.registration).toLowerCase()}-${key}-buffer.mp4`,
        downloadUrl: renderUrl,
        blobPathname: rendered.blobPathname,
        sizeBytes: rendered.sizeBytes,
        operationId: `manual-backfill:${dateKey}:${key}:${candidate.registration}`,
      });
    } catch (error) {
      recordError = safe(error?.message || error);
    }

    return res.status(200).json({
      ok: true,
      productKey: key,
      registration: candidate.registration,
      bufferPostId,
      dueAt: slot.dueAt,
      localTime: slot.localTime,
      sourceImageCount: rendered.sourceImageCount,
      usableImageCount: rendered.usableImageCount,
      recordOk: !recordError,
      recordError,
    });
  } catch (error) {
    if (renderUrl && !bufferPostId) await del(renderUrl).catch(() => {});
    return res.status(200).json({ ok: false, productKey: key, stage: "exception", error: safe(error?.message || error) });
  }
}
