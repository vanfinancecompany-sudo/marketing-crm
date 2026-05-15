import { getSupabaseAdmin, isMissingOptionalTableError } from "./_vansco-cache-utils.js";

const LIVE_SESSIONS_TABLE = "site_live_sessions";
const ACTIVE_WINDOW_MS = 3 * 60 * 1000;

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.end(JSON.stringify(payload));
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const since = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
    const supabase = getSupabaseAdmin();
    const result = await supabase
      .from(LIVE_SESSIONS_TABLE)
      .select("session_id", { count: "exact", head: true })
      .gte("last_seen_at", since);

    if (result.error) {
      if (isMissingOptionalTableError(result.error)) {
        sendJson(response, 200, {
          ok: true,
          activeCount: 0,
          skipped: true,
          reason: "table missing",
        });
        return;
      }

      sendJson(response, 500, {
        ok: false,
        message: result.error.message || "Could not load live visitor count.",
      });
      return;
    }

    sendJson(response, 200, { ok: true, activeCount: result.count || 0 });
  } catch (error) {
    if (isMissingOptionalTableError(error)) {
      sendJson(response, 200, {
        ok: true,
        activeCount: 0,
        skipped: true,
        reason: "table missing",
      });
      return;
    }

    sendJson(response, 500, {
      ok: false,
      message: error?.message || "Live visitor count API failed.",
    });
  }
}
