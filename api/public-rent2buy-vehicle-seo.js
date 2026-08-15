import { RENT2BUY_WIX_SITE_ID } from "../lib/rent2buyMonthlyPriceSync.js";
import { buildRent2BuyVehicleSeoTitle, normalizeRent2BuyRegistration } from "../lib/rent2buyVehicleSeo.js";

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

  const registration = normalizeRent2BuyRegistration(request.query?.registration);
  if (!registration) return response.status(400).json({ ok: false, message: "A valid registration is required." });

  const apiKey = clean(process.env.WIX_API_KEY);
  const siteId = clean(process.env.WIX_RENT2BUY_SITE_ID, 500) || RENT2BUY_WIX_SITE_ID;
  const apiBaseUrl = clean(process.env.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com";
  if (!apiKey) return response.status(503).json({ ok: false, message: "Vehicle SEO lookup is temporarily unavailable." });

  try {
    const wixResponse = await fetch(`${apiBaseUrl}/wix-data/v2/items/query`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "wix-site-id": siteId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataCollectionId: "VANPAGES",
        query: {
          filter: { title: { $eq: registration } },
          paging: { limit: 2, offset: 0 },
          fields: ["title", "titleText", "year", "_publishStatus"],
        },
      }),
    });
    const payload = await wixResponse.json().catch(() => ({}));
    if (!wixResponse.ok) throw new Error(clean(payload?.message, 500) || `Wix returned ${wixResponse.status}.`);

    const matches = Array.isArray(payload.dataItems) ? payload.dataItems : [];
    if (matches.length !== 1) return response.status(matches.length ? 409 : 404).json({ ok: false, message: "A unique vehicle record was not found." });

    const item = matches[0]?.data || {};
    if (item._publishStatus && item._publishStatus !== "PUBLISHED") return response.status(404).json({ ok: false, message: "Vehicle is not published." });
    const title = buildRent2BuyVehicleSeoTitle(item);
    if (!title) return response.status(422).json({ ok: false, message: "Vehicle title data is incomplete." });

    response.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600");
    return response.status(200).json({ ok: true, registration, title });
  } catch (error) {
    console.error("PUBLIC RENT2BUY VEHICLE SEO ERROR", { registration, message: clean(error?.message, 500) });
    return response.status(502).json({ ok: false, message: "Vehicle SEO lookup is temporarily unavailable." });
  }
}
