import { getSupabaseAdmin, isMissingOptionalTableError, normalizeRegistration, optionalTableReason } from "./_vansco-cache-utils.js";

const VEHICLE_VIEWS_TABLE = "vehicle_views";

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function normalizeSource(value) {
  const source = String(value || "").trim();
  return source ? source.slice(0, 160) : null;
}

export default async function handler(request, response) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    sendJson(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const registration = normalizeRegistration(body.registration);

    if (!registration) {
      sendJson(response, 400, { ok: false, message: "A valid registration is required." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const result = await supabase
      .from(VEHICLE_VIEWS_TABLE)
      .insert({
        registration,
        source: normalizeSource(body.source),
      })
      .select("id, registration, source, viewed_at")
      .single();

    if (result.error) {
      if (isMissingOptionalTableError(result.error)) {
        sendJson(response, 200, {
          ok: false,
          skipped: true,
          reason: optionalTableReason(result.error),
        });
        return;
      }

      sendJson(response, 200, {
        ok: false,
        skipped: true,
        message: result.error.message || "Could not track vehicle view.",
      });
      return;
    }

    sendJson(response, 200, { ok: true, view: result.data });
  } catch (error) {
    sendJson(response, 200, {
      ok: false,
      skipped: true,
      reason: optionalTableReason(error),
      message: error?.message || "Vehicle view tracking failed.",
    });
  }
}
