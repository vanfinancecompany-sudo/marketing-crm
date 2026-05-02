const SOURCE_URL = "https://www.vansco.co.uk/all-stock/";
const SITEMAP_URL = "https://www.vansco.co.uk/sitemap/";
const JUNK_TITLE_PATTERN = /\b(vansco ltd|all stock|showroom|flexibuy|finance|contact|about)\b/i;
const VEHICLE_PATH_PATTERN = /\/vehicle-details\//i;

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&pound;/gi, "£")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text, SOURCE_URL);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return text.replace(/\/$/, "");
  }
}

function extractAnchorMatches(html) {
  const matches = [];
  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html))) {
    matches.push({
      href: normalizeUrl(match[2]),
      text: decodeHtml(match[3]),
    });
  }

  return matches;
}

function looksLikeVehicleTitle(title) {
  const text = decodeHtml(title);
  if (!text || text.length < 12) return false;
  if (JUNK_TITLE_PATTERN.test(text)) return false;
  if (/^(home|reviews|warranty|privacy policy|cookies|complaints|new forest|southampton airport)$/i.test(text)) {
    return false;
  }

  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

function toVehicleStub(anchor) {
  return {
    title: decodeHtml(anchor.text),
    stockUrl: normalizeUrl(anchor.href),
    imageUrl: "",
    price: "",
    registration: "",
    mileage: "",
    year: "",
    sourceStatus: "unknown",
    vehicleCategory: /car/i.test(anchor.text) ? "car" : "van",
  };
}

function dedupeVehicles(vehicles) {
  const byUrl = new Map();

  vehicles.forEach((vehicle) => {
    const key = normalizeUrl(vehicle.stockUrl);
    if (!key) return;

    if (!byUrl.has(key)) {
      byUrl.set(key, vehicle);
      return;
    }

    const existing = byUrl.get(key);
    byUrl.set(
      key,
      String(vehicle.title || "").length > String(existing.title || "").length ? vehicle : existing
    );
  });

  return Array.from(byUrl.values());
}

function parseVehicleLinksFromHtml(html) {
  const anchors = extractAnchorMatches(html);
  const candidates = anchors.filter((anchor) => VEHICLE_PATH_PATTERN.test(anchor.href));
  const vehicles = dedupeVehicles(
    candidates
      .filter((anchor) => looksLikeVehicleTitle(anchor.text))
      .map(toVehicleStub)
  );

  return {
    anchors,
    candidates,
    vehicles,
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-GB,en;q=0.9",
      referer: "https://marketing-crm-six.vercel.app/",
      pragma: "no-cache",
      "cache-control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`Vansco request failed with status ${response.status}.`);
  }

  const html = await response.text();
  return {
    url,
    html,
    htmlLength: html.length,
  };
}

function buildDiagnostics({
  endpointUsed,
  pagesFetched,
  htmlLength,
  candidateLinksFound,
  vehiclesKept,
  parserWarnings,
  sampleTitles,
}) {
  return {
    endpointUsed,
    pagesFetched,
    htmlLength,
    candidateLinksFound,
    vehicleDetailUrlsKept: vehiclesKept,
    vehiclesParsed: vehiclesKept,
    parserWarnings,
    sampleTitles,
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ message: "Method not allowed." });
    return;
  }

  try {
    const pageResults = [];
    const parserWarnings = [];

    const allStockPage = await fetchHtml(SOURCE_URL);
    pageResults.push(allStockPage);
    const allStockParsed = parseVehicleLinksFromHtml(allStockPage.html);

    let vehicles = allStockParsed.vehicles;
    let endpointUsed = SOURCE_URL;

    if (vehicles.length < 10) {
      parserWarnings.push("All-stock HTML did not expose enough real vehicle detail links.");

      const sitemapPage = await fetchHtml(SITEMAP_URL);
      pageResults.push(sitemapPage);
      const sitemapParsed = parseVehicleLinksFromHtml(sitemapPage.html);

      if (sitemapParsed.vehicles.length > vehicles.length) {
        vehicles = sitemapParsed.vehicles;
        endpointUsed = SITEMAP_URL;
      }

      if (vehicles.length < 10) {
        parserWarnings.push("No vehicles found in Vansco HTML. Site may require JS-rendered scraping or a feed.");
      }
    }

    const diagnostics = buildDiagnostics({
      endpointUsed,
      pagesFetched: pageResults.length,
      htmlLength: pageResults.reduce((total, page) => total + page.htmlLength, 0),
      candidateLinksFound: pageResults.reduce(
        (total, page) => total + parseVehicleLinksFromHtml(page.html).candidates.length,
        0
      ),
      vehiclesKept: vehicles.length,
      parserWarnings: vehicles.length < 10
        ? [...parserWarnings, "Parser warning: fewer than 10 vehicles found."]
        : parserWarnings,
      sampleTitles: vehicles.slice(0, 3).map((vehicle) => vehicle.title),
    });

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      html: pageResults[0]?.html || "",
      htmlLength: diagnostics.htmlLength,
      fetchedAt: new Date().toISOString(),
      sourceUrl: SOURCE_URL,
      endpointUsed,
      pagesFetched: diagnostics.pagesFetched,
      vehicles,
      diagnostics,
    });
  } catch (error) {
    response.status(500).json({
      message: error?.message || "Could not fetch Vansco stock source.",
    });
  }
}
