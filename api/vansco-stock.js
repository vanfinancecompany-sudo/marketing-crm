const SOURCE_URL = "https://www.vansco.co.uk/all-stock/";
const SITEMAP_URL = "https://www.vansco.co.uk/sitemap/";
const VANSCO_CATEGORY_PAGES = {
  finance: [
    { url: "https://www.vansco.co.uk/used-vans/", sourceCategory: "used_vans" },
    { url: "https://www.vansco.co.uk/no-vat-vans/", sourceCategory: "no_vat_vans" },
  ],
  rent2buy: [
    { url: "https://www.vansco.co.uk/used-vans/", sourceCategory: "used_vans" },
    { url: "https://www.vansco.co.uk/no-vat-vans/", sourceCategory: "no_vat_vans" },
  ],
  cars: [
    { url: "https://www.vansco.co.uk/used-cars/", sourceCategory: "used_cars" },
  ],
};

const JUNK_TITLE_PATTERN = /\b(vansco ltd|all stock|showroom|flexibuy|finance|contact|about)\b/i;
const VEHICLE_PATH_PATTERN = /\/vehicle-details\//i;
const MODERN_UK_REG_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/;
const LEGACY_REG_PATTERN = /^(?:[A-Z][0-9]{1,3}[A-Z]{3}|[A-Z]{3}[0-9]{1,3}[A-Z]|[0-9]{1,4}[A-Z]{1,3})$/i;
const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const FAKE_REG_PATTERNS = [
  /^[0-9]{2,3}PS$/i,
  /^[0-9]{2,3}BHP$/i,
  /^ULEZ$/i,
  /^EURO\d+$/i,
  /^L\dH\d$/i,
  /^U\d{4,6}$/i,
  /^SHOWROOM$/i,
  /^333$/i,
  /^0BOX$/i,
  /^FROMODOMETER$/i,
];
const BLOCKED_REG_VALUES = new Set([
  "VANSCO",
  "VANSCOLTD",
  "ALLSTOCK",
  "HOMESTOCK",
  "UNDEFINED",
  "UNKNOWN",
  "NULL",
  "N/A",
  "NA",
  "NOTFOUND",
  "ULEZ",
  "EURO6",
  "SHOWROOM",
  "FROMODOMETER",
]);

const DETAIL_FETCH_CONCURRENCY = 4;
const DETAIL_FETCH_TIMEOUT_MS = 5500;
const CATEGORY_FETCH_TIMEOUT_MS = 6000;
const MAX_CATEGORY_PAGES_PER_SOURCE = 12;
const MAX_DETAIL_URLS = 800;
const FULL_SCAN_BATCH_SIZE = 10;
const DETAIL_FETCH_MODE_LIMITS = {
  fast: 100,
  standard: 100,
  full: 0,
};
const CAR_KEYWORDS = /\b(audi|bmw|jaguar|jeep|kia|lexus|mercedes-benz|mercedes|skoda|suzuki|hyundai|q2|q3|a3|a4|a5|estate|hatchback|cabriolet|suv|coupe|saloon)\b/i;
const VAN_KEYWORDS = /\b(transit|transit custom|transit connect|transit courier|tourneo|custom|tipper|dropside|luton|crew van|minibus|panel van|box van|pickup|pick-up|chassis cab|relay|dispatch|scudo|daily|doblo|partner|berlingo|sprinter|crafter|vivaro|movano|box-van)\b/i;

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
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) =>
      url.searchParams.delete(key)
    );
    return url.toString().replace(/\/$/, "");
  } catch {
    return text.replace(/\/$/, "");
  }
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
    return { url: normalizeUrl(url), html, htmlLength: html.length };
  } finally {
    timed.clear();
  }
}

function extractAnchorMatches(html) {
  const matches = [];
  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html || ""))) {
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
  if (/used-cars/i.test(href)) return "car";
  if (/used-vans|no-vat-vans/i.test(href)) return "van";
  if (VAN_KEYWORDS.test(haystack)) return "van";
  if (CAR_KEYWORDS.test(haystack)) return "car";
  return "unknown";
}

function toVehicleStub(anchor, sourceCategory = "") {
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
    sourceCategory,
  };
}

function vehicleScore(vehicle) {
  return [
    vehicle.registration ? 5 : 0,
    vehicle.imageUrl ? 3 : 0,
    vehicle.sourceStatus && vehicle.sourceStatus !== "unknown" ? 2 : 0,
    vehicle.stockUrl ? 2 : 0,
    compactWhitespace(vehicle.title).length,
  ].reduce((total, value) => total + value, 0);
}

function dedupeVehicles(vehicles) {
  const byUrl = new Map();

  vehicles.forEach((vehicle) => {
    const key = normalizeUrl(vehicle.stockUrl);
    if (!key) return;

    if (!byUrl.has(key) || vehicleScore(vehicle) > vehicleScore(byUrl.get(key))) {
      byUrl.set(key, vehicle);
    }
  });

  return Array.from(byUrl.values());
}

function parseVehicleLinksFromHtml(html, sourceCategory = "") {
  const anchors = extractAnchorMatches(html);
  const candidates = anchors.filter((anchor) => VEHICLE_PATH_PATTERN.test(anchor.href));
  const vehicles = candidates
    .filter((anchor) => looksLikeVehicleTitle(anchor.text) || VEHICLE_PATH_PATTERN.test(anchor.href))
    .map((anchor) => toVehicleStub(anchor, sourceCategory));

  return { anchors, candidates, vehicles: dedupeVehicles(vehicles) };
}

function isLikelyCategoryPageUrl(url, baseUrl) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;

  try {
    const candidate = new URL(normalized);
    const base = new URL(baseUrl);
    if (candidate.hostname !== base.hostname) return false;
    if (!candidate.pathname.startsWith(base.pathname.replace(/\/$/, ""))) return false;
    if (VEHICLE_PATH_PATTERN.test(candidate.pathname)) return false;
    if (/\/page\/\d+\/?$/i.test(candidate.pathname)) return true;
    return candidate.pathname.replace(/\/$/, "") === base.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function buildLikelyPaginationUrls(baseUrl) {
  const urls = [];
  const normalized = normalizeUrl(baseUrl);
  const withSlash = `${normalized.replace(/\/$/, "")}/`;

  for (let page = 2; page <= MAX_CATEGORY_PAGES_PER_SOURCE; page += 1) {
    urls.push(`${withSlash}page/${page}/`);
  }

  return urls;
}

async function fetchCategoryPages(pageConfig, parserWarnings) {
  const pages = [];
  const seen = new Set();
  const seenVehicleUrls = new Set();
  const queue = [normalizeUrl(pageConfig.url), ...buildLikelyPaginationUrls(pageConfig.url)];
  let consecutivePagesWithoutNewVehicles = 0;

  while (queue.length && pages.length < MAX_CATEGORY_PAGES_PER_SOURCE) {
    const nextUrl = normalizeUrl(queue.shift());
    if (!nextUrl || seen.has(nextUrl) || !isLikelyCategoryPageUrl(nextUrl, pageConfig.url)) continue;
    seen.add(nextUrl);

    try {
      const page = await fetchHtml(nextUrl, CATEGORY_FETCH_TIMEOUT_MS);
      const parsed = parseVehicleLinksFromHtml(page.html, pageConfig.sourceCategory);
      const newVehicles = parsed.vehicles.filter((vehicle) => {
        const key = normalizeUrl(vehicle.stockUrl);
        return key && !seenVehicleUrls.has(key);
      });

      newVehicles.forEach((vehicle) => seenVehicleUrls.add(normalizeUrl(vehicle.stockUrl)));

      if (!newVehicles.length && nextUrl !== normalizeUrl(pageConfig.url)) {
        consecutivePagesWithoutNewVehicles += 1;
        if (consecutivePagesWithoutNewVehicles >= 2) break;
        continue;
      }

      consecutivePagesWithoutNewVehicles = 0;
      pages.push({ ...page, parsed: { ...parsed, vehicles: newVehicles }, sourceCategory: pageConfig.sourceCategory });

      parsed.anchors.forEach((anchor) => {
        const href = normalizeUrl(anchor.href);
        if (href && !seen.has(href) && isLikelyCategoryPageUrl(href, pageConfig.url)) {
          queue.push(href);
        }
      });
    } catch (error) {
      if (nextUrl === normalizeUrl(pageConfig.url)) {
        parserWarnings.push(`Category page could not be fetched: ${pageConfig.url}`);
      }
    }
  }

  return pages;
}

function filterVehiclesForPipeline(vehicles, pipeline) {
  if (pipeline === "cars") {
    return vehicles.filter((vehicle) => detectVehicleCategory(vehicle.title, vehicle.stockUrl) === "car");
  }

  return vehicles.filter((vehicle) => detectVehicleCategory(vehicle.title, vehicle.stockUrl) !== "car");
}

function extractMetaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, "i"),
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

function isValidVehicleImage(url) {
  const value = normalizeUrl(url);
  if (!value || !/^https?:\/\//i.test(value)) return false;

  const blocked = ["logo", "placeholder", "favicon", "icon", "facebook.com", "google.com", "whatsapp", "flexibuy"];
  return !blocked.some((fragment) => value.toLowerCase().includes(fragment));
}

function extractImageUrl(html) {
  const ogImage = normalizeUrl(extractMetaContent(html, "og:image"));
  if (isValidVehicleImage(ogImage)) return ogImage;

  const twitterImage = normalizeUrl(extractMetaContent(html, "twitter:image"));
  if (isValidVehicleImage(twitterImage)) return twitterImage;

  const imagePattern = /<img\b[^>]*(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
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
  const cleaned = text.replace(/[^A-Z0-9]/g, "");
  if (!cleaned || cleaned.length < 5 || cleaned.length > 8) return "";
  if (!/[A-Z]/.test(cleaned) || !/[0-9]/.test(cleaned)) return "";
  if (BLOCKED_REG_VALUES.has(cleaned)) return "";
  if (FAKE_REG_PATTERNS.some((pattern) => pattern.test(cleaned))) return "";

  const match = cleaned.match(REGISTRATION_PATTERN);
  const candidate = (match?.[1] || cleaned).replace(/[^A-Z0-9]/g, "");
  if (!candidate || candidate.length < 5 || candidate.length > 8) return "";
  if (!/[A-Z]/.test(candidate) || !/[0-9]/.test(candidate)) return "";
  if (BLOCKED_REG_VALUES.has(candidate)) return "";
  if (FAKE_REG_PATTERNS.some((pattern) => pattern.test(candidate))) return "";
  return candidate;
}

function isStrictUkRegistration(value) {
  const cleaned = normalizeRegistration(value);
  if (!cleaned) return false;
  if (MODERN_UK_REG_PATTERN.test(cleaned)) return true;
  if (!LEGACY_REG_PATTERN.test(cleaned)) return false;
  if (FAKE_REG_PATTERNS.some((pattern) => pattern.test(cleaned))) return false;
  return cleaned.length >= 5 && cleaned.length <= 8;
}

function collectBracketedCandidates(text) {
  const matches = [];
  const pattern = /\(([^)]+)\)/g;
  let match;

  while ((match = pattern.exec(text || ""))) {
    const candidate = compactWhitespace(match[1]);
    if (candidate) matches.push(candidate);
  }

  return matches;
}

function extractRegistrationFromTitle(title, rejectedCandidates) {
  const candidates = collectBracketedCandidates(title);
  for (const candidate of candidates) {
    const normalized = normalizeRegistration(candidate);
    if (isStrictUkRegistration(normalized)) return normalized;
    if (candidate) rejectedCandidates.push(candidate);
  }
  return "";
}

function extractStrictRegistrationCandidate(rawValue, rejectedCandidates) {
  const value = compactWhitespace(rawValue);
  if (!value) return "";

  const normalized = normalizeRegistration(value);
  if (isStrictUkRegistration(normalized)) return normalized;

  rejectedCandidates.push(value);
  return "";
}

function detectSourceStatus(text) {
  const normalized = compactWhitespace(text);
  if (!normalized) return "unknown";
  if (/deposit taken/i.test(normalized)) return "reserved";
  if (/reserved/i.test(normalized)) return "reserved";
  if (/\bsold\b/i.test(normalized)) return "reserved";
  if (/enquire now|finance options|reserve now|available/i.test(normalized)) return "available";
  return "unknown";
}

function enrichVehicleStub(stub, html, diagnostics) {
  const bodyText = decodeHtml(html);
  const pageTitle = extractHeading(html, "h1") || extractMetaContent(html, "og:title") || stub.title;
  const subtitle = extractHeading(html, "h2");
  const fullTitle = compactWhitespace([pageTitle, subtitle].filter(Boolean).join(" - "));
  const rejectedCandidates = diagnostics.rejectedRegistrationCandidates;
  const titleCandidates = [
    pageTitle,
    extractMetaContent(html, "og:title"),
    extractMetaContent(html, "twitter:title"),
    stub.title,
    fullTitle,
  ].filter(Boolean);
  let bracketRegistration = "";

  for (const titleCandidate of titleCandidates) {
    const extracted = extractRegistrationFromTitle(titleCandidate, rejectedCandidates);
    if (extracted) {
      bracketRegistration = extracted;
      diagnostics.registrationsExtractedFromTitleBrackets += 1;
      break;
    }
  }

  const registration =
    bracketRegistration ||
    extractStrictRegistrationCandidate(extractLabelValue(html, "Registration"), rejectedCandidates) ||
    extractStrictRegistrationCandidate(extractLabelValue(html, "Reg"), rejectedCandidates);

  return {
    ...stub,
    title: fullTitle || pageTitle || stub.title,
    stockUrl: normalizeUrl(stub.stockUrl),
    imageUrl: extractImageUrl(html) || stub.imageUrl,
    price: "",
    registration,
    mileage: "",
    year: "",
    sourceStatus: detectSourceStatus(bodyText),
    vehicleCategory: detectVehicleCategory(`${fullTitle} ${bodyText}`, stub.stockUrl) || stub.vehicleCategory,
    sourceCategory: stub.sourceCategory || "",
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

function buildDiagnostics({
  endpointUsed,
  sourceFamily,
  pageResults,
  candidateLinksFound,
  categoryPageFailures,
  vehiclesParsedByCategory,
  filteredVehicleCount,
  detailPagesFetched,
  detailPagesFailed,
  finalVehicles,
  detailFetchMode,
  detailFetchLimitApplied,
  partialScan,
  totalVehicleUrlsFound,
  registrationsExtractedFromTitleBrackets,
  rejectedRegistrationCandidates,
  parserWarnings,
  detailOffset,
  remainingVehicleCount,
}) {
  return {
    endpointUsed,
    sourceFamily,
    pagesFetched: pageResults.length + detailPagesFetched,
    htmlLength: pageResults.reduce((total, page) => total + page.htmlLength, 0),
    candidateLinksFound,
    sitemapUrlsFound: filteredVehicleCount,
    categoryPagesFetched: pageResults.length,
    categoryPageFailures,
    vehiclesParsedByCategory,
    vehicleDetailUrlsKept: finalVehicles.length,
    vehiclesParsed: finalVehicles.length,
    detailPagesFetched,
    detailPagesFailed,
    vehiclesEnrichedWithRegistration: finalVehicles.filter((vehicle) => vehicle.registration).length,
    vehiclesEnrichedWithImage: finalVehicles.filter((vehicle) => vehicle.imageUrl).length,
    vehiclesWithSourceStatus: finalVehicles.filter((vehicle) => vehicle.sourceStatus && vehicle.sourceStatus !== "unknown").length,
    vehiclesWithValidMatchKey: finalVehicles.filter((vehicle) => vehicle.registration || vehicle.stockUrl).length,
    detailFetchMode,
    detailFetchLimitApplied,
    partialScan,
    totalVehicleUrlsFound,
    detailOffset,
    remainingVehicleCount,
    currentBatchStart: detailOffset,
    currentBatchEnd: detailOffset + finalVehicles.length,
    vehiclesProcessedThisBatch: finalVehicles.length,
    registrationsExtractedFromTitleBrackets,
    rejectedFakeRegistrationsCount: rejectedRegistrationCandidates.length,
    sampleRejectedFakeRegistrations: rejectedRegistrationCandidates.slice(0, 20),
    parserWarnings,
    sampleTitles: finalVehicles.slice(0, 3).map((vehicle) => vehicle.title),
    sampleRegistrations: finalVehicles.map((vehicle) => vehicle.registration).filter(Boolean).slice(0, 20),
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
    const detailOffset = Math.max(0, Number(request.query?.detailOffset || 0) || 0);
    const requestedBatchSize = Math.max(0, Number(request.query?.detailBatchSize || 0) || 0);
    const parserWarnings = [];
    const categorySourcePages = VANSCO_CATEGORY_PAGES[pipeline] || VANSCO_CATEGORY_PAGES.finance;
    const categoryPageFailures = [];
    const vehiclesParsedByCategory = {};
    let pageResults = [];
    let candidateLinksFound = 0;
    let categoryVehicles = [];

    for (const pageConfig of categorySourcePages) {
      const pages = await fetchCategoryPages(pageConfig, parserWarnings);
      if (!pages.length) categoryPageFailures.push(pageConfig.sourceCategory);

      pages.forEach((page) => {
        pageResults.push(page);
        candidateLinksFound += page.parsed.candidates.length;
        const currentCount = vehiclesParsedByCategory[pageConfig.sourceCategory] || 0;
        vehiclesParsedByCategory[pageConfig.sourceCategory] = currentCount + page.parsed.vehicles.length;
        categoryVehicles = dedupeVehicles([...categoryVehicles, ...page.parsed.vehicles]);
      });
    }

    let vehicles = categoryVehicles;
    let endpointUsed = categorySourcePages.map((page) => page.url).join(", ");
    let sourceFamily = "vansco-category-pagination";

    if (vehicles.length < 10) {
      const sitemapPage = await fetchHtml(SITEMAP_URL, CATEGORY_FETCH_TIMEOUT_MS);
      const sitemapParsed = parseVehicleLinksFromHtml(sitemapPage.html, "sitemap_fallback");
      pageResults.push({ ...sitemapPage, parsed: sitemapParsed });
      candidateLinksFound += sitemapParsed.candidates.length;

      if (sitemapParsed.vehicles.length > vehicles.length) {
        vehicles = sitemapParsed.vehicles;
        endpointUsed = SITEMAP_URL;
        sourceFamily = "sitemap-fallback";
        parserWarnings.push("Sitemap fallback was used. Confidence is low and comparisons should be treated as needs review.");
      }
    }

    const filteredVehicles = filterVehiclesForPipeline(vehicles, pipeline).slice(0, MAX_DETAIL_URLS);
    const totalVehicleUrlsFound = filteredVehicles.length;
    const requestedLimit = DETAIL_FETCH_MODE_LIMITS[detailFetchMode] ?? DETAIL_FETCH_MODE_LIMITS.standard;
    const batchSize = requestedBatchSize > 0
      ? Math.min(requestedBatchSize, FULL_SCAN_BATCH_SIZE)
      : detailFetchMode === "full"
        ? FULL_SCAN_BATCH_SIZE
        : requestedLimit || filteredVehicles.length;
    const detailFetchLimit = requestedLimit === 0
      ? Math.min(Math.max(0, totalVehicleUrlsFound - detailOffset), batchSize)
      : Math.min(requestedLimit, batchSize, Math.max(0, totalVehicleUrlsFound - detailOffset));
    const vehiclesToEnrich = filteredVehicles.slice(detailOffset, detailOffset + detailFetchLimit);
    const remainingVehicleCount = Math.max(0, totalVehicleUrlsFound - (detailOffset + vehiclesToEnrich.length));
    const hasMore = remainingVehicleCount > 0;

    if (hasMore) {
      parserWarnings.push(
        `Batch ${Math.floor(detailOffset / Math.max(1, detailFetchLimit || batchSize)) + 1} processed ${vehiclesToEnrich.length} vehicles. ${remainingVehicleCount} remaining vehicles are queued for automatic batches.`
      );
    }

    let detailPagesFetched = 0;
    let detailPagesFailed = 0;
    const enrichmentDiagnostics = {
      registrationsExtractedFromTitleBrackets: 0,
      rejectedRegistrationCandidates: [],
    };

    const enrichedVehicles = await mapWithConcurrency(
      vehiclesToEnrich,
      DETAIL_FETCH_CONCURRENCY,
      async (vehicle) => {
        try {
          const detailPage = await fetchHtml(vehicle.stockUrl);
          detailPagesFetched += 1;
          return enrichVehicleStub(vehicle, detailPage.html, enrichmentDiagnostics);
        } catch {
          detailPagesFailed += 1;
          return vehicle;
        }
      }
    );

    const finalVehicles = dedupeVehicles(enrichedVehicles);
    const partialScan = hasMore || detailPagesFailed > 0 || sourceFamily === "sitemap-fallback";

    if (finalVehicles.length < vehiclesToEnrich.length) {
      parserWarnings.push("Some duplicate detail URLs were collapsed in this batch.");
    }

    const diagnostics = buildDiagnostics({
      endpointUsed,
      sourceFamily,
      pageResults,
      candidateLinksFound,
      categoryPageFailures,
      vehiclesParsedByCategory,
      filteredVehicleCount: filteredVehicles.length,
      detailPagesFetched,
      detailPagesFailed,
      finalVehicles,
      detailFetchMode,
      detailFetchLimitApplied: vehiclesToEnrich.length,
      partialScan,
      totalVehicleUrlsFound,
      registrationsExtractedFromTitleBrackets: enrichmentDiagnostics.registrationsExtractedFromTitleBrackets,
      rejectedRegistrationCandidates: enrichmentDiagnostics.rejectedRegistrationCandidates,
      parserWarnings,
      detailOffset,
      remainingVehicleCount,
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
      detailOffset,
      hasMore,
      nextDetailOffset: detailOffset + vehiclesToEnrich.length,
      diagnostics,
    });
  } catch (error) {
    response.status(500).json({
      message: error?.message || "Could not fetch Vansco stock source.",
    });
  }
}
