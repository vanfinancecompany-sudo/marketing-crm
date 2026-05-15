import { getSupabaseAdmin, isMissingOptionalTableError, optionalTableReason } from "./_vansco-cache-utils.js";

const LIVE_SESSIONS_TABLE = "site_live_sessions";
const STALE_SESSION_MS = 10 * 60 * 1000;

const BOT_USER_AGENT_PATTERN =
  /bot|crawler|spider|preview|facebookexternalhit|slurp|bingpreview|headless|phantom|curl|wget|python-requests|httpclient|monitoring|uptime/i;

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

function normalizeSessionId(value) {
  const sessionId = String(value || "").trim();
  if (!sessionId || sessionId.length > 160) return "";
  return sessionId;
}

function normalizeSource(value) {
  const source = String(value || "").trim();
  return source ? source.slice(0, 120) : null;
}

function getHeader(request, name) {
  const value = request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value.join(" ") : String(value || "");
}

function isObviousBotRequest(request) {
  const userAgent = getHeader(request, "user-agent");
  const purpose = getHeader(request, "purpose") || getHeader(request, "sec-purpose");
  const fetchMode = getHeader(request, "sec-fetch-mode");

  return BOT_USER_AGENT_PATTERN.test(userAgent) || /prefetch|preview/i.test(purpose) || /navigate/i.test(fetchMode) && /bot|crawler|spider/i.test(userAgent);
}

async function cleanupStaleSessions(supabase) {
  const staleBefore = new Date(Date.now() - STALE_SESSION_MS).toISOString();
  const result = await supabase.from(LIVE_SESSIONS_TABLE).delete().lt("last_seen_at", staleBefore);
  if (result.error && !isMissingOptionalTableError(result.error)) throw result.error;
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
    const sessionId = normalizeSessionId(body.sessionId);

    if (!sessionId) {
      sendJson(response, 400, { ok: false, message: "A valid sessionId is required." });
      return;
    }

    const now = new Date().toISOString();
    const supabase = getSupabaseAdmin();
    await cleanupStaleSessions(supabase);

    if (isObviousBotRequest(request)) {
      sendJson(response, 200, { ok: true, ignored: true });
      return;
    }

    const result = await supabase
      .from(LIVE_SESSIONS_TABLE)
      .upsert(
        {
          session_id: sessionId,
          source: normalizeSource(body.source),
          last_seen_at: now,
        },
        { onConflict: "session_id" }
      )
      .select("session_id, source, first_seen_at, last_seen_at")
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
        message: result.error.message || "Could not track live visitor.",
      });
      return;
    }

    sendJson(response, 200, { ok: true, session: result.data });
  } catch (error) {
    sendJson(response, 200, {
      ok: false,
      skipped: true,
      reason: optionalTableReason(error),
      message: error?.message || "Live visitor tracking failed.",
    });
  }
}
