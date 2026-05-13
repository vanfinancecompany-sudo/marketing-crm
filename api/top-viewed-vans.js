import { getSupabaseAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";

const VEHICLE_VIEWS_TABLE = "vehicle_views";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.end(JSON.stringify(payload));
}

function formatRegistration(registration) {
  const compact = normalizeRegistration(registration);
  return compact.replace(/^([A-Z]{2})(\d{2})([A-Z]{3})$/, "$1$2 $3") || compact;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const supabase = getSupabaseAdmin();
    const result = await supabase
      .from(VEHICLE_VIEWS_TABLE)
      .select("registration")
      .gte("viewed_at", since)
      .limit(10000);

    if (result.error) {
      sendJson(response, 500, {
        ok: false,
        message: result.error.message || "Could not load top viewed vans.",
      });
      return;
    }

    const counts = new Map();

    for (const row of result.data || []) {
      const registration = normalizeRegistration(row.registration);
      if (!registration) continue;
      counts.set(registration, (counts.get(registration) || 0) + 1);
    }

    const vans = [...counts.entries()]
      .map(([registration, views]) => ({
        registration: formatRegistration(registration),
        views,
      }))
      .sort((left, right) => right.views - left.views || left.registration.localeCompare(right.registration))
      .slice(0, 10);

    sendJson(response, 200, { ok: true, vans });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "Top viewed vans API failed.",
    });
  }
}
