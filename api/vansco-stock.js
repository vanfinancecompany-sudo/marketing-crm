const SOURCE_URL = "https://www.vansco.co.uk/all-stock/";
const SITEMAP_URL = "https://www.vansco.co.uk/sitemap/";
const DRAGON2000_SOURCE_PAGES = {
  finance: [
    "https://vansco.dragon2000.net/used-vans/",
    "https://vansco.dragon2000.net/no-vat-vans/",
  ],
  rent2buy: [
    "https://vansco.dragon2000.net/used-vans/",
    "https://vansco.dragon2000.net/no-vat-vans/",
  ],
  cars: [
    "https://vansco.dragon2000.net/used-cars/",
  ],
};
const JUNK_TITLE_PATTERN = /\b(vansco ltd|all stock|showroom|flexibuy|finance|contact|about)\b/i;
const VEHICLE_PATH_PATTERN = /\/vehicle-details\//i;
const PRICE_PATTERN = /(?:£|&pound;)\s?[0-9][0-9,]*/gi;
const YEAR_PATTERN = /\b(20\d{2}|19\d{2})\b/;
const REGISTRATION_PATTERN =
  /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const DETAIL_FETCH_CONCURRENCY = 4;
const DETAIL_FETCH_TIMEOUT_MS = 7000;
const DETAIL_FETCH_LIMITS = {
  finance: 140,
  rent2buy: 140,
  cars: 90,
};
const DETAIL_FETCH_MODE_LIMITS = {
  fast: 50,
  standard: 100,
  full: 0,
};
const CAR_KEYWORDS = /\b(audi|bmw|jaguar|jeep|kia|lexus|mercedes-benz|mercedes|skoda|suzuki|hyundai|q2|q3|a3|a4|a5|estate|hatchback|cabriolet|suv|coupe|saloon)\b/i;
const VAN_KEYWORDS = /\b(transit|transit custom|transit connect|transit courier|tourneo|custom|tipper|dropside|luton|crew van|minibus|panel van|box van|pickup|pick-up|chassis cab|relay|dispatch|scudo|daily|doblo|partner|berlingo|sprinter|crafter|vivaro|movano)\b/i;

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

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function detectVehicleCategory(text, href = "") {
  const haystack = `${compactWhitespace(text)} ${compactWhitespace(href)}`;
  if (VAN_KEYWORDS.test(haystack)) return "van";
  if (CAR_KEYWORDS.test(haystack)) return "car";
  if (/used-cars/i.test(href)) return "car";
  if (/used-vans|no-vat-vans/i.test(href)) return "van";
  return "unknown";
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
    vehicleCategory: detectVehicleCategory(anchor.text, anchor.href),
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
    const existingScore = [existing.registration, existing.imageUrl, existing.price, existing.mileage, existing.year]
      .filter(Boolean)
      .join("|").length + String(existing.title || "").length;
    const nextScore = [vehicle.registration, vehicle.imageUrl, vehicle.price, vehicle.mileage, vehicle.year]
      .filter(Boolean)
      .join("|").length + String(vehicle.title || "").length;
    byUrl.set(key, nextScore > existingScore ? vehicle : existing);
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

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeout);
    },
  };
}

async function fetchHtml(url, timeoutMs = DETAIL_FETCH_TIMEOUT_MS) {
  const timed = timeoutSignal(timeoutMs);

  try {
    const response = await fetch(url, {
      signal: timed.signal,
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
  } finally {
    timed.clear();
  }
}

function extractMetaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }

  return "";
}

function extractHeading(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1] ? decodeHtml(match[1]) : "";
}

function extractLabelValue(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${escaped}\\s*[:|-]?\\s*<[^>]*>\\s*([^<]+)`, "i"),
    new RegExp(`${escaped}\\s*[:|-]?\\s*([^<\\n\\r]+)`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = compactWhitespace(decodeHtml(match?.[1] || ""));
    if (value) return value;
  }

  return "";
}

function extractPrice(html) {
  const metaPrice = extractMetaContent(html, "product:price:amount");
  if (metaPrice) return `£${metaPrice}`;

  const matches = Array.from(html.matchAll(PRICE_PATTERN)).map((match) => decodeHtml(match[0]));
  return matches[0] || "";
}

function isValidVehicleImage(url) {
  const value = normalizeUrl(url);
  if (!value) return false;
  if (!/^https?:\/\//i.test(value)) return false;

  const blocked = [
    "logo",
    "placeholder",
    "favicon",
    "icon",
    "facebook.com",
    "google.com",
    "whatsapp",
    "flexibuy",
  ];

  return !blocked.some((fragment) => value.toLowerCase().includes(fragment));
}

function extractImageUrl(html) {
  const ogImage = normalizeUrl(extractMetaContent(html, "og:image"));
  if (isValidVehicleImage(ogImage)) return ogImage;

  const twitterImage = normalizeUrl(extractMetaContent(html, "twitter:image"));
  if (isValidVehicleImage(twitterImage)) return twitterImage;

  const imagePattern = /<img\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(html))) {
    const candidate = normalizeUrl(match[1]);
    if (isValidVehicleImage(candidate)) return candidate;
  }

  return "";
}

function normalizeRegistration(value) {
  const text = compactWhitespace(value).toUpperCase();
  if (!text) return "";
  const blocked = new Set(["VANSCO", "VANSCOLTD", "ALLSTOCK", "HOMESTOCK", "UNDEFINED", "UNKNOWN", "NULL", "N/A"]);
  const match = text.match(REGISTRATION_PATTERN);
  const candidate = (match?.[1] || "").replace(/\s+/g, "");
  if (!candidate || blocked.has(candidate)) return "";
  return candidate;
}

function detectSourceStatus(text) {
  const normalized = compactWhitespace(text);
  if (!normalized) return "unknown";
  if (/deposit taken/i.test(normalized)) return "deposit_taken";
  if (/reserved/i.test(normalized)) return "reserved";
  if (/\bsold\b/i.test(normalized)) return "sold";
  if (/enquire now|finance options|reserve now|available/i.test(normalized)) return "available";
  return "unknown";
}

function enrichVehicleStub(stub, html) {
  const bodyText = decodeHtml(html);
  const pageTitle = extractHeading(html, "h1") || extractMetaContent(html, "og:title") || stub.title;
  const subtitle = extractHeading(html, "h2");
  const fullTitle = compactWhitespace([pageTitle, subtitle].filter(Boolean).join(" - "));
  const registration =
    normalizeRegistration(pageTitle) ||
    normalizeRegistration(bodyText.match(/\(([A-Z0-9 ]{5,10})\)/i)?.[1]) ||
    normalizeRegistration(extractLabelValue(html, "Registration"));

  return {
    ...stub,
    title: fullTitle || stub.title,
    stockUrl: normalizeUrl(stub.stockUrl),
    imageUrl: extractImageUrl(html) || stub.imageUrl,
    price: extractPrice(html) || stub.price,
    registration,
    mileage: extractLabelValue(html, "Mileage") || stub.mileage,
    year: extractLabelValue(html, "Year") || (pageTitle.match(YEAR_PATTERN)?.[1] || stub.year),
    sourceStatus: detectSourceStatus(bodyText),
    vehicleCategory: detectVehicleCategory(`${fullTitle} ${bodyText}`, stub.stockUrl) || stub.vehicleCategory,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

function filterVehiclesForPipeline(vehicles, pipeline) {
  if (pipeline === "cars") {
    return vehicles.filter((vehicle) => detectVehicleCategory(vehicle.title, vehicle.stockUrl) === "car");
  }

  return vehicles.filter((vehicle) => detectVehicleCategory(vehicle.title, vehicle.stockUrl) !== "car");
}

function buildDiagnostics({
  endpointUsed,
  sourceFamily,
  pagesFetched,
  htmlLength,
  candidateLinksFound,
  sitemapUrlsFound,
  dragonPagesFetched,
  dragonVehiclesFound,
  vehiclesKept,
  detailPagesFetched,
  detailPagesFailed,
  vehiclesWithRegistration,
  vehiclesWithImage,
  vehiclesWithSourceStatus,
  vehiclesWithValidMatchKey,
  parserWarnings,
  sampleTitles,
}) {
  return {
    endpointUsed,
    sourceFamily,
    pagesFetched,
    htmlLength,
    candidateLinksFound,
    sitemapUrlsFound,
    dragonPagesFetched,
    dragonVehiclesFound,
    vehicleDetailUrlsKept: vehiclesKept,
    vehiclesParsed: vehiclesKept,
    detailPagesFetched,
    detailPagesFailed,
    vehiclesEnrichedWithRegistration: vehiclesWithRegistration,
    vehiclesEnrichedWithImage: vehiclesWithImage,
    vehiclesWithSourceStatus,
    vehiclesWithValidMatchKey,
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
    const pipeline = String(request.query?.pipeline || "finance").toLowerCase();
    const detailFetchMode = String(request.query?.detailFetchMode || "standard").toLowerCase();
    const pageResults = [];
    const parserWarnings = [];
    const dragonSourcePages = DRAGON2000_SOURCE_PAGES[pipeline] || DRAGON2000_SOURCE_PAGES.finance;
    const dragonPageResults = [];
    let candidateLinksFound = 0;
    let dragonVehicles = [];

    for (const dragonUrl of dragonSourcePages) {
      try {
        const page = await fetchHtml(dragonUrl);
        pageResults.push(page);
        dragonPageResults.push(page);
        const parsed = parseVehicleLinksFromHtml(page.html);
        candidateLinksFound += parsed.candidates.length;
        dragonVehicles = dedupeVehicles([...dragonVehicles, ...parsed.vehicles]);
      } catch {
        parserWarnings.push(`Dragon2000 source page could not be fetched: ${dragonUrl}`);
      }
    }

    let vehicles = dragonVehicles;
    let endpointUsed = dragonSourcePages[0] || SOURCE_URL;
    let sourceFamily = "dragon2000";

    if (vehicles.length < 10) {
      parserWarnings.push("Dragon2000 stock pages did not expose enough server-rendered vehicle detail links.");

      const allStockPage = await fetchHtml(SOURCE_URL);
      pageResults.push(allStockPage);
      const allStockParsed = parseVehicleLinksFromHtml(allStockPage.html);
      candidateLinksFound += allStockParsed.candidates.length;

      if (allStockParsed.vehicles.length > vehicles.length) {
        vehicles = allStockParsed.vehicles;
        endpointUsed = SOURCE_URL;
        sourceFamily = "vansco-all-stock";
      }
    }

    if (vehicles.length < 10) {
      const sitemapPage = await fetchHtml(SITEMAP_URL);
      pageResults.push(sitemapPage);
      const sitemapParsed = parseVehicleLinksFromHtml(sitemapPage.html);
      candidateLinksFound += sitemapParsed.candidates.length;

      if (sitemapParsed.vehicles.length > vehicles.length) {
        vehicles = sitemapParsed.vehicles;
        endpointUsed = SITEMAP_URL;
        sourceFamily = "sitemap-fallback";
      }
    }

    const filteredVehicles = filterVehiclesForPipeline(vehicles, pipeline);
    const baseLimit = DETAIL_FETCH_LIMITS[pipeline] || DETAIL_FETCH_LIMITS.finance;
    const requestedLimit = DETAIL_FETCH_MODE_LIMITS[detailFetchMode] ?? DETAIL_FETCH_MODE_LIMITS.standard;
    const detailFetchLimit = requestedLimit === 0 ? filteredVehicles.length : Math.min(baseLimit, requestedLimit);
    const vehiclesToEnrich = filteredVehicles.slice(0, detailFetchLimit);
    const remainingVehicleCount = Math.max(0, filteredVehicles.length - vehiclesToEnrich.length);

    if (remainingVehicleCount > 0) {
      parserWarnings.push(
        `Detail enrichment was limited to ${detailFetchLimit} vehicles for this manual check. ${remainingVehicleCount} remaining vehicles were left as title-only stubs.`
      );
    }

    let detailPagesFetched = 0;
    let detailPagesFailed = 0;

    const enrichedVehicles = await mapWithConcurrency(
      vehiclesToEnrich,
      DETAIL_FETCH_CONCURRENCY,
      async (vehicle) => {
        try {
          const detailPage = await fetchHtml(vehicle.stockUrl);
          detailPagesFetched += 1;
          return enrichVehicleStub(vehicle, detailPage.html);
        } catch {
          detailPagesFailed += 1;
          return vehicle;
        }
      }
    );

    const finalVehicles = dedupeVehicles(enrichedVehicles);
    if (finalVehicles.length < 10) {
      parserWarnings.push("Parser warning: fewer than 10 vehicles found after detail enrichment.");
    }

    const diagnostics = buildDiagnostics({
      endpointUsed,
      sourceFamily,
      pagesFetched: pageResults.length + detailPagesFetched,
      htmlLength: pageResults.reduce((total, page) => total + page.htmlLength, 0),
      candidateLinksFound,
      sitemapUrlsFound: filteredVehicles.length,
      dragonPagesFetched: dragonPageResults.length,
      dragonVehiclesFound: dragonVehicles.length,
      vehiclesKept: finalVehicles.length,
      detailPagesFetched,
      detailPagesFailed,
      vehiclesWithRegistration: finalVehicles.filter((vehicle) => vehicle.registration).length,
      vehiclesWithImage: finalVehicles.filter((vehicle) => vehicle.imageUrl).length,
      vehiclesWithSourceStatus: finalVehicles.filter((vehicle) => vehicle.sourceStatus && vehicle.sourceStatus !== "unknown").length,
      vehiclesWithValidMatchKey: finalVehicles.filter((vehicle) => vehicle.registration || vehicle.stockUrl).length,
      detailFetchMode,
      detailFetchLimitApplied: detailFetchLimit,
      parserWarnings,
      sampleTitles: finalVehicles.slice(0, 3).map((vehicle) => vehicle.title),
    });

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      html: pageResults[0]?.html || "",
      htmlLength: diagnostics.htmlLength,
      fetchedAt: new Date().toISOString(),
      sourceUrl: SOURCE_URL,
      endpointUsed,
      pagesFetched: diagnostics.pagesFetched,
      vehicles: finalVehicles,
      diagnostics,
    });
  } catch (error) {
    response.status(500).json({
      message: error?.message || "Could not fetch Vansco stock source.",
    });
  }
}
