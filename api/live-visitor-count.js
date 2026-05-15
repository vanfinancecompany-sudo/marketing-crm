import { getSupabaseAdmin, isMissingOptionalTableError, optionalTableReason } from "./_vansco-cache-utils.js";

const LIVE_SESSIONS_TABLE = "site_live_sessions";
const LIVE_VISITOR_SOURCE = "wix-vehicle-page";
const ACTIVE_WINDOW_MS = 90 * 1000;
const STALE_SESSION_MS = 10 * 60 * 1000;
const DISPLAY_CAP = 50;

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.end(JSON.stringify(payload));
}

async function cleanupStaleSessions(supabase) {
  const staleBefore = new Date(Date.now() - STALE_SESSION_MS).toISOString();
  const result = await supabase.from(LIVE_SESSIONS_TABLE).delete().lt("last_seen_at", staleBefore);
  if (result.error && !isMissingOptionalTableError(result.error)) throw result.error;
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
    await cleanupStaleSessions(supabase);

    const result = await supabase
      .from(LIVE_SESSIONS_TABLE)
      .select("session_id", { count: "exact", head: true })
      .eq("source", LIVE_VISITOR_SOURCE)
      .gte("last_seen_at", since);

    if (result.error) {
      if (isMissingOptionalTableError(result.error)) {
        sendJson(response, 200, {
          ok: true,
          activeCount: 0,
          rawActiveCount: 0,
          capped: false,
          skipped: true,
          reason: optionalTableReason(result.error),
        });
        return;
      }

      sendJson(response, 200, {
        ok: false,
        activeCount: 0,
        rawActiveCount: 0,
        capped: false,
        message: result.error.message || "Could not load live visitor count.",
      });
      return;
    }

    const rawActiveCount = result.count || 0;
    const activeCount = Math.min(rawActiveCount, DISPLAY_CAP);

    sendJson(response, 200, {
      ok: true,
      activeCount,
      rawActiveCount,
      capped: rawActiveCount > DISPLAY_CAP,
    });
  } catch (error) {
    sendJson(response, 200, {
      ok: false,
      activeCount: 0,
      rawActiveCount: 0,
      capped: false,
      skipped: true,
      reason: optionalTableReason(error),
      message: error?.message || "Live visitor count API failed.",
    });
  }
}
