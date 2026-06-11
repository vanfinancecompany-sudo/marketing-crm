import { del, list } from "@vercel/blob";

export const config = {
  maxDuration: 60,
};

const POC_PREFIX = "temp-youtube-renders/";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const body = parseBody(req);
  if (body.confirmPoc !== true) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing confirmPoc safety flag.",
      expectedBody: { confirmPoc: true },
    });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    sendJson(res, 500, {
      ok: false,
      error: "Vercel Blob is not configured. Missing Blob credentials.",
    });
    return;
  }

  try {
    const blobs = await list({ prefix: POC_PREFIX, limit: 1000 });
    const urls = (blobs.blobs || []).map((blob) => blob.url).filter(Boolean);

    if (urls.length) {
      await del(urls);
    }

    console.log("[youtube-mp4-poc-cleanup] deleted temporary blobs", { count: urls.length });
    sendJson(res, 200, {
      ok: true,
      deletedCount: urls.length,
      prefix: POC_PREFIX,
      message: "Temporary YouTube MP4 POC blobs deleted.",
    });
  } catch (error) {
    const message = String(error?.message || "Could not clean up YouTube MP4 POC blobs.").slice(0, 1000);
    console.error("[youtube-mp4-poc-cleanup] failed", { error: message });
    sendJson(res, 500, {
      ok: false,
      error: message,
    });
  }
}
