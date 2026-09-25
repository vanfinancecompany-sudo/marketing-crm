import { extractVanscoVehicleUrl } from "../lib/vanscoFacebookAutomation.js";
import {
  loadVanscoAutomationStatus,
  loadVanscoBufferConfig,
  loadVanscoBufferState,
} from "./_vansco-buffer-runtime.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";

function clean(value) {
  return String(value ?? "").trim();
}

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  const supplied = clean(request.headers[ACCESS_HEADER]);
  const authorization = clean(request.headers.authorization);
  return Boolean(
    expected &&
    (supplied === expected || authorization === `Bearer ${expected}`),
  );
}

function londonDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function postTitle(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /^\d{4}\s+/.test(line))
    || lines.find((line) => !/^🚐|^✅|^💷|^📍|^📞|^🌐|^#/.test(line))
    || "Vansco vehicle";
}

function postBranch(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("vansco 333 showroom")) return "Vansco 333";
  if (value.includes("vansco new forest")) return "New Forest / Cadnam";
  if (value.includes("vansco southampton airport")) return "Southampton Airport";
  return "Branch not shown";
}

function queuedPostSummary(post) {
  const assets = Array.isArray(post?.assets) ? post.assets : [];
  const image = assets.find((asset) => String(asset?.mimeType || "").startsWith("image/"));
  return {
    id: String(post?.id || ""),
    title: postTitle(post?.text),
    branch: postBranch(post?.text),
    dueAt: post?.dueAt || null,
    status: String(post?.status || ""),
    vehicleUrl: extractVanscoVehicleUrl(post?.text) || "",
    imageUrl: String(image?.source || ""),
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
  }

  try {
    const enabled = String(process.env.VANSCO_FACEBOOK_AUTOMATION_ENABLED || "").toLowerCase() === "true";
    const status = await loadVanscoAutomationStatus();
    const config = await loadVanscoBufferConfig();
    const dateKey = londonDateKey();
    const bufferState = await loadVanscoBufferState(config, `${dateKey}T12:00:00.000Z`);

    return response.status(200).json({
      ok: true,
      enabled,
      state: status?.state || (enabled ? "waiting" : "disabled"),
      lastRun: status,
      buffer: {
        channelName: config.channelName,
        externalLink: config.externalLink,
        queueLimit: config.scheduledPostsLimit,
        dailyLimit: bufferState.limit?.limit ?? null,
        sentToday: bufferState.limit?.sent ?? 0,
        scheduledToday: bufferState.limit?.scheduled ?? 0,
        queueCount: bufferState.posts.length,
      },
      queue: bufferState.posts
        .slice()
        .sort((a, b) => new Date(a?.dueAt || 0).getTime() - new Date(b?.dueAt || 0).getTime())
        .slice(0, 10)
        .map(queuedPostSummary),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: String(error?.message || "Could not load Vansco Facebook status.").slice(0, 300),
    });
  }
}
