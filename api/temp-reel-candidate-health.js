import { del } from "@vercel/blob";
import { automatedReelFrameSpecs } from "../lib/facebookAutomationContent.js";

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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const key = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "").trim();
    if (!key) return res.status(200).json({ ok: false, stage: "config", error: "marketing key missing" });

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
      return res.status(200).json({
        ok: false,
        stage: "candidates",
        status: candidatesResponse.status,
        error: safe(candidates?.error || candidates?.message || candidatesRead.raw),
      });
    }

    const candidate = Array.isArray(candidates?.finance) ? candidates.finance[0] : null;
    if (!candidate) {
      return res.status(200).json({
        ok: false,
        stage: "candidate-selection",
        error: "No Finance Reel candidate available",
        financeCount: Array.isArray(candidates?.finance) ? candidates.finance.length : null,
        rent2buyCount: Array.isArray(candidates?.rent2buy) ? candidates.rent2buy.length : null,
      });
    }

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

    if (render?.downloadUrl) {
      await del(render.downloadUrl).catch(() => {});
    }

    return res.status(200).json({
      ok: renderResponse.ok && render?.ok !== false,
      stage: "render",
      status: renderResponse.status,
      error: safe(render?.error || render?.message || (!renderResponse.ok ? renderRead.raw : "")),
      registration: candidate.registration,
      candidateImages: Array.isArray(candidate.images) ? candidate.images.length : null,
      sourceImageCount: render?.sourceImageCount ?? null,
      usableImageCount: render?.usableImageCount ?? null,
      renderTimeMs: render?.renderTimeMs ?? null,
      totalTimeMs: render?.totalTimeMs ?? null,
      cleanedUp: Boolean(render?.downloadUrl),
    });
  } catch (error) {
    return res.status(200).json({ ok: false, stage: "exception", error: safe(error?.message || error) });
  }
}
