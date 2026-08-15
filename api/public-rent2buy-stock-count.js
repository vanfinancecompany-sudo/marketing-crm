import { RENT2BUY_ALL_VANS_COLLECTION_ID, RENT2BUY_WIX_SITE_ID } from "../lib/rent2buyMonthlyPriceSync.js";

const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);
const ALLOWED_ORIGINS = new Set(["https://rent2buyvans.co.uk", "https://www.rent2buyvans.co.uk"]);

function setCors(request, response) {
  const origin = clean(request.headers?.origin || request.headers?.Origin, 500);
  if (ALLOWED_ORIGINS.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
}

export default async function handler(request, response) {
  setCors(request, response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });

  const apiKey = clean(process.env.WIX_API_KEY);
  const siteId = clean(process.env.WIX_RENT2BUY_SITE_ID, 500) || RENT2BUY_WIX_SITE_ID;
  const apiBaseUrl = clean(process.env.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com";
  if (!apiKey) return response.status(503).json({ ok: false, message: "Stock count is temporarily unavailable." });

  try {
    const wixResponse = await fetch(`${apiBaseUrl}/wix-data/v2/items/query`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "wix-site-id": siteId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataCollectionId: RENT2BUY_ALL_VANS_COLLECTION_ID,
        query: {
          filter: { _publishStatus: { $eq: "PUBLISHED" } },
          paging: { limit: 1, offset: 0 },
          fields: ["title"],
        },
        returnTotalCount: true,
      }),
    });
    const payload = await wixResponse.json().catch(() => ({}));
    if (!wixResponse.ok) throw new Error(clean(payload?.message, 500) || `Wix returned ${wixResponse.status}.`);

    const count = Number(payload?.pagingMetadata?.total);
    if (!Number.isFinite(count) || count < 0) throw new Error("Wix did not return a valid stock count.");

    response.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return response.status(200).json({ ok: true, count });
  } catch (error) {
    console.error("PUBLIC RENT2BUY STOCK COUNT ERROR", { message: clean(error?.message, 500) });
    return response.status(502).json({ ok: false, message: "Stock count is temporarily unavailable." });
  }
}
