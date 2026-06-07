const PRODUCT_HOSTS = {
  vanFinance: ["www.vanfinancecompany.co.uk", "vanfinancecompany.co.uk"],
  rent2buy: ["www.rent2buyvans.co.uk", "rent2buyvans.co.uk"],
};

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeRegistration(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeImageUrl(value, baseUrl) {
  const text = String(value || "").trim();
  if (!text) return "";

  const wixMatch = text.match(/wix:image:\/\/v1\/([^/#?\s]+)/i);
  if (wixMatch) return `https://static.wixstatic.com/media/${wixMatch[1]}`;

  if (/^\/\//.test(text)) return `https:${text}`;

  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractImageUrls(html, pageUrl) {
  const candidates = new Set();
  const addCandidate = (value) => {
    const normalized = normalizeImageUrl(value, pageUrl);
    if (!normalized) return;
    if (!/\.(jpe?g|png|webp)(\?|#|$)/i.test(normalized) && !/static\.wixstatic\.com\/media\//i.test(normalized)) return;
    if (/\/(logo|icon|favicon|placeholder|blank)[^/]*\.(jpe?g|png|webp)/i.test(normalized)) return;
    candidates.add(normalized);
  };

  for (const match of html.matchAll(/(?:src|data-src|href|content)=["']([^"']+)["']/gi)) {
    addCandidate(match[1]);
  }

  for (const match of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
    match[1].split(",").forEach((part) => addCandidate(part.trim().split(/\s+/)[0]));
  }

  for (const match of html.matchAll(/wix:image:\/\/v1\/[^"'\\\s<>)]+/gi)) {
    addCandidate(match[0]);
  }

  for (const match of html.matchAll(/https?:\/\/static\.wixstatic\.com\/media\/[^"'\\\s<>)]+/gi)) {
    addCandidate(match[0]);
  }

  return Array.from(candidates).slice(0, 5);
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const queryUrl = new URL(request.url, "http://localhost");
  const product = queryUrl.searchParams.get("product") || "vanFinance";
  const pageUrl = queryUrl.searchParams.get("url") || "";
  const registration = normalizeRegistration(queryUrl.searchParams.get("registration") || "");
  const title = cleanText(queryUrl.searchParams.get("title") || "");
  const allowedHosts = PRODUCT_HOSTS[product] || [];

  if (!pageUrl) {
    sendJson(response, 200, {
      images: [],
      message: "No vehicle page URL is available for this selected vehicle.",
      registration,
      title,
    });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(pageUrl);
  } catch {
    sendJson(response, 400, { error: "Selected vehicle page URL is not valid." });
    return;
  }

  if (!allowedHosts.includes(targetUrl.hostname.toLowerCase())) {
    sendJson(response, 400, { error: "Selected vehicle page URL does not match the active Reel Lab product." });
    return;
  }

  try {
    const pageResponse = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent": "Marketing CRM Reel Lab image test",
      },
    });

    if (!pageResponse.ok) {
      sendJson(response, 502, { error: `Vehicle page returned ${pageResponse.status}.` });
      return;
    }

    const html = await pageResponse.text();
    const pageText = normalizeRegistration(html);
    const matchedRegistration = registration ? pageText.includes(registration) : false;
    const images = extractImageUrls(html, targetUrl.toString());

    sendJson(response, 200, {
      images,
      registration,
      title,
      pageUrl: targetUrl.toString(),
      matchedRegistration,
      message: images.length ? `Found ${images.length} image${images.length === 1 ? "" : "s"}.` : "No van page images found.",
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Could not fetch selected vehicle page images." });
  }
}
