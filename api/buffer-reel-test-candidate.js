const ACCESS_HEADER = "x-marketing-customer-database-key";
const MIN_IMAGES = 10;
const MAX_BATCH = 10;
const WIX_FEEDS = {
  vanFinance: "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages",
  rent2buy: "https://www.vanfinancecompany.co.uk/_functions/marketingRent2BuyImages",
};

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const supplied = String(request.headers[ACCESS_HEADER] || "");
  const authorization = String(request.headers.authorization || "");
  return Boolean(
    expected &&
      (supplied === expected ||
        (authorization.startsWith("Bearer ") && authorization.slice(7) === expected)),
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeRegistration(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeImageUrl(value) {
  const text = clean(value);
  if (!text) return "";
  const wixMatch = text.match(/^(?:wix:)?image:\/\/v1\/([^\/#?]+)/i);
  if (wixMatch) return `https://static.wixstatic.com/media/${wixMatch[1]}`;
  if (/^\/\/static\.wixstatic\.com\//i.test(text)) return `https:${text}`;
  return text;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  if (!authorize(request)) {
    response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
    return;
  }

  try {
    const body = request.body && typeof request.body === "object"
      ? request.body
      : JSON.parse(String(request.body || "{}"));
    const productKey = body.productKey === "vanFinance" ? "vanFinance" : "rent2buy";
    const requestedLimit = Number.parseInt(body.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(MAX_BATCH, requestedLimit))
      : 1;
    const excluded = new Set(
      (Array.isArray(body.excludeRegistrations) ? body.excludeRegistrations : [])
        .map(normalizeRegistration)
        .filter(Boolean),
    );
    const feedUrl = WIX_FEEDS[productKey];

    const feedResponse = await fetch(feedUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!feedResponse.ok) {
      throw new Error(`Live Wix reel feed returned HTTP ${feedResponse.status}.`);
    }

    const payload = await feedResponse.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const seen = new Set();
    const candidates = items
      .map((item) => ({
        registration: normalizeRegistration(item?.registration),
        title: clean(item?.title) || normalizeRegistration(item?.registration) || "Vehicle reel",
        images: [...new Set(
          (Array.isArray(item?.images) ? item.images : [])
            .map(normalizeImageUrl)
            .filter((url) => /^https:\/\//i.test(url)),
        )],
      }))
      .filter((item) => {
        if (!item.registration || item.images.length < MIN_IMAGES) return false;
        if (excluded.has(item.registration) || seen.has(item.registration)) return false;
        seen.add(item.registration);
        return true;
      })
      .slice(0, limit)
      .map((item) => ({ ...item, images: item.images.slice(0, MIN_IMAGES) }));

    if (!candidates.length) {
      response.status(404).json({ ok: false, error: "No live vehicle with 10 usable images is available for the Buffer Reel test." });
      return;
    }

    const first = candidates[0];
    response.status(200).json({
      ok: true,
      productKey,
      requested: limit,
      count: candidates.length,
      candidates,
      registration: first.registration,
      title: first.title,
      images: first.images,
    });
  } catch (error) {
    response.status(500).json({ ok: false, error: error?.message || "Could not prepare Buffer Reel test candidates." });
  }
}
