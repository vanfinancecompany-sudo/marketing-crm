import { del } from "@vercel/blob";
import { automatedReelFrameSpecs } from "../lib/facebookAutomationContent.js";
import {
  BUFFER_API_URL,
  BUFFER_CREATE_POST_MUTATION,
  buildBufferCreatePostInput,
} from "../lib/bufferPublishing.js";

const DELETE_POST_MUTATION = `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) { __typename }
  }
`;

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
    body: JSON.stringify({ query, variables }),
  });
  const read = await readJson(response);
  return { response, ...read };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  let renderUrl = "";
  let createdPostId = "";
  try {
    const key = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "").trim();
    const bufferKey = String(process.env.BUFFER_API_KEY || "").trim();
    if (!key || !bufferKey) return res.status(200).json({ ok: false, stage: "config", error: "required server key missing" });

    const candidatesResponse = await fetch(`${baseUrl(req)}/api/youtube-daily-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-marketing-customer-database-key": key,
      },
      body: JSON.stringify({ action: "candidates" }),
    });
    const candidatesRead = await readJson(candidatesResponse);
    const candidates = candidatesRead.payload;
    if (!candidatesResponse.ok || candidates?.ok === false) {
      return res.status(200).json({ ok: false, stage: "candidates", status: candidatesResponse.status, error: safe(candidates?.error || candidates?.message || candidatesRead.raw) });
    }

    const candidate = Array.isArray(candidates?.finance) ? candidates.finance[0] : null;
    if (!candidate) return res.status(200).json({ ok: false, stage: "candidate-selection", error: "No Finance Reel candidate available" });

    const vehicle = candidate.vehicle || {};
    const renderResponse = await fetch(`${baseUrl(req)}/api/youtube-mp4-render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        productKey: "vanFinance",
        registration: candidate.registration,
        title: candidate.title,
        priceText: vehicle.price || vehicle.initialRental || "",
        monthlyText: vehicle.monthly || vehicle.salePrice || vehicle.week || "",
        imageUrls: (candidate.images || []).slice(0, 10),
        frameSpecs: automatedReelFrameSpecs("vanFinance", 0),
        frameCount: 10,
        durationSeconds: 20,
        fps: 24,
        templateKey: "tiktokPunch",
        premiumMotion: true,
      }),
    });
    const renderRead = await readJson(renderResponse);
    const render = renderRead.payload;
    renderUrl = String(render?.downloadUrl || "");
    if (!renderResponse.ok || render?.ok === false || !renderUrl) {
      return res.status(200).json({ ok: false, stage: "render", status: renderResponse.status, error: safe(render?.error || render?.message || renderRead.raw) });
    }

    const dueAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    const input = buildBufferCreatePostInput({
      destination: "Van Finance Facebook",
      text: `DIAGNOSTIC SCHEDULED REEL - ${candidate.registration}`,
      mediaUrl: renderUrl,
      mediaKind: "video",
      draft: false,
      dueAt,
    });
    const create = await bufferGraphql(BUFFER_CREATE_POST_MUTATION, { input });
    createdPostId = String(create?.payload?.data?.createPost?.post?.id || "");

    let deleteResult = null;
    if (createdPostId) {
      const deleted = await bufferGraphql(DELETE_POST_MUTATION, { input: { id: createdPostId } });
      deleteResult = {
        status: deleted.response.status,
        payload: deleted.payload,
      };
    }

    return res.status(200).json({
      ok: Boolean(createdPostId),
      stage: "buffer-create-scheduled",
      registration: candidate.registration,
      dueAt,
      sourceImageCount: render?.sourceImageCount ?? null,
      usableImageCount: render?.usableImageCount ?? null,
      renderTimeMs: render?.renderTimeMs ?? null,
      bufferHttpStatus: create.response.status,
      bufferPayload: create.payload,
      createdPostId: createdPostId || null,
      deletedScheduledPost: Boolean(createdPostId && deleteResult),
      deleteResult,
    });
  } catch (error) {
    return res.status(200).json({ ok: false, stage: "exception", error: safe(error?.message || error) });
  } finally {
    if (renderUrl) await del(renderUrl).catch(() => {});
  }
}
