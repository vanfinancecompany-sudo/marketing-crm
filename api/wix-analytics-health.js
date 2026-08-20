const TRAFFIC_MODEL_ID = "cad7fd34-2c8b-4dda-8296-3f9d47fb484d";
const WIX_ANALYTICS_QUERY_URL = "https://www.wixapis.com/analytics/semantic-model/v3/semantic-models/query-data";

function clean(value, limit = 10000) {
  return String(value || "").trim().slice(0, limit);
}

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });

  const apiKey = clean(process.env.WIX_API_KEY);
  const siteId = clean(process.env.WIX_SITE_ID, 500);
  if (!apiKey || !siteId) return response.status(500).json({ ok: false, message: "Wix analytics credentials are not configured." });

  try {
    const wixResponse = await fetch(WIX_ANALYTICS_QUERY_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "wix-site-id": siteId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        semanticModelId: TRAFFIC_MODEL_ID,
        interval: {
          start: "2026-08-19T23:00:00.000Z",
          end: "2026-08-20T23:00:00.000Z",
          timezone: "Europe/London",
        },
        fields: [
          "traffic.sessions_count",
          "traffic.visitors_count",
          "traffic.views_count",
        ],
        formattingEnabled: false,
        totalsIncluded: true,
      }),
    });

    const payload = await wixResponse.json().catch(() => ({}));
    if (!wixResponse.ok) {
      return response.status(wixResponse.status).json({
        ok: false,
        wix_status: wixResponse.status,
        message: clean(payload?.message || payload?.details?.applicationError?.description || "Wix analytics request failed.", 500),
      });
    }

    const fields = payload?.totals?.fields || payload?.results?.[0]?.fields || {};
    return response.status(200).json({
      ok: true,
      date: "2026-08-20",
      sessions: Number(fields?.["traffic.sessions_count"]?.numericValue || 0),
      visitors: Number(fields?.["traffic.visitors_count"]?.numericValue || 0),
      views: Number(fields?.["traffic.views_count"]?.numericValue || 0),
    });
  } catch (error) {
    return response.status(500).json({ ok: false, message: clean(error?.message || "Wix analytics request failed.", 500) });
  }
}
