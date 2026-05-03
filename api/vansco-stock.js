const SOURCE_URL = "https://www.vansco.co.uk/all-stock/";
const SITEMAP_URL = "https://www.vansco.co.uk/sitemap/";

const VEHICLE_PATH_PATTERN = /\/vehicle-details\//i;
const MODERN_UK_REG_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/;
const LEGACY_REG_PATTERN = /^(?:[A-Z][0-9]{1,3}[A-Z]{3}|[A-Z]{3}[0-9]{1,3}[A-Z]|[0-9]{1,4}[A-Z]{1,3})$/i;
const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const FAKE_REG_PATTERNS = [/^[0-9]{2,3}PS$/i, /^[0-9]{2,3}BHP$/i, /^ULEZ$/i, /^EURO\d+$/i, /^L\dH\d$/i, /^U\d{4,6}$/i, /^SHOWROOM$/i, /^333$/i, /^0BOX$/i, /^FROMODOMETER$/i];
const BLOCKED_REG_VALUES = new Set(["VANSCO", "VANSCOLTD", "ALLSTOCK", "HOMESTOCK", "UNDEFINED", "UNKNOWN", "NULL", "N/A", "NA", "NOTFOUND", "ULEZ", "EURO6", "SHOWROOM", "FROMODOMETER"]);

const DETAIL_FETCH_CONCURRENCY = 2;
const DETAIL_FETCH_TIMEOUT_MS = 9000;
const EMERGENCY_DETAIL_FETCH_TIMEOUT_MS = 25000;
const DISCOVERY_FETCH_TIMEOUT_MS = 10000;
const FULL_SCAN_BATCH_SIZE = 5;
const MAX_DETAIL_URLS = 800;
const DETAIL_DIAGNOSTIC_SAMPLE_LIMIT = 5;
const DETAIL_FETCH_MODE_LIMITS = { fast: 100, standard: 100, full: 0 };
const CAR_KEYWORDS = /\b(audi|bmw|jaguar|jeep|kia|lexus|mercedes-benz|mercedes|skoda|suzuki|hyundai|q2|q3|a3|a4|a5|estate|hatchback|cabriolet|suv|coupe|saloon)\b/i;
const VAN_KEYWORDS = /\b(transit|custom|tipper|dropside|luton|crew van|minibus|panel van|box van|pickup|pick-up|chassis cab|relay|dispatch|scudo|daily|doblo|partner|berlingo|sprinter|crafter|vivaro|movano|box-van|kangoo|traffic|master|ducato|talento|expert|transporter)\b/i;
const NON_VAN_STOCK_KEYWORDS = /\b(bailey|pegasus|winnebago|motorhome|motorhomes|caravan|campervan|camper|autotrail|auto-trail|swift|elddis|roller team)\b/i;

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

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
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return text.replace(/\/$/, "");
  }
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchHtml(url, timeoutMs = DETAIL_FETCH_TIMEOUT_MS) {
  const timed = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      signal: timed.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9",
        referer: "https://www.vansco.co.uk/all-stock/",
        pragma: "no-cache",
        "cache-control": "no-cache",
      },
    });
    const html = await response.text();
    if (!response.ok) {
      const error = new Error(`Vansco request failed with status ${response.status}.`);
      error.status = response.status;
      error.htmlLength = html.length;
      error.htmlSample = decodeHtml(html).slice(0, 220);
      throw error;
    }
    return {
      url: normalizeUrl(url),
      html,
      htmlLength: html.length,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
    };
  } finally {
    timed.clear();
  }
}

function analyseDetailHtml(url, page) {
  const html = page?.html || "";
  const decoded = decodeHtml(html);
  const lower = decoded.toLowerCase();
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 140);
  const looksBlocked = /cloudflare|captcha|access denied|forbidden|blocked|enable cookies|checking your browser|attention required|bot|security check/i.test(decoded);
  const hasVehicleHints = /registration|reg\b|reserve|reserved|deposit taken|enquire now|finance options|vehicle-details|og:title|og:image/i.test(html);

  return {
    url: normalizeUrl(url),
    status: page?.status || 0,
    contentType: page?.contentType || "",
    htmlLength: html.length,
    title,
    looksBlocked,
    hasVehicleHints,
    sample: lower.slice(0, 240),
  };
}

function classifyDetailFailure(diagnostics) {
  const failures = diagnostics?.failureSamples || [];
  const samples = diagnostics?.htmlSamples || [];

  if (failures.some((failure) => failure.timeout)) return "timeout";
  if (failures.some((failure) => [401, 403, 429, 503].includes(Number(failure.status)))) return "blocked_or_rate_limited";
  if (samples.some((sample) => sample.looksBlocked)) return "blocked_or_challenge_page";
  if (samples.length && samples.every((sample) => sample.htmlLength < 1000)) return "empty_or_tiny_html";
  if (samples.length && samples.every((sample) => !sample.hasVehicleHints)) return "unexpected_html";
  if (failures.length) return "detail_fetch_failed";
  return "unknown";
}

function extractAnchorMatches(html) {
  const matches = [];
  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html || ""))) {
    matches.push({ href: normalizeUrl(match[2]), text: decodeHtml(match[3]) });
  }
  return matches;
}

function extractVehicleUrls(html) {
  const urls = new Set();
  const directPattern = /https?:\/\/www\.vansco\.co\.uk\/vehicle-details\/[^\s"'<>]+/gi;
  let match;
  while ((match = directPattern.exec(String(html || "")))) urls.add(normalizeUrl(match[0]));
  extractAnchorMatches(html).forEach((anchor) => {
    if (VEHICLE_PATH_PATTERN.test(anchor.href)) urls.add(normalizeUrl(anchor.href));
  });
  return Array.from(urls).filter(Boolean);
}

function isExcludedNonVanStock(text, href = "") {
  return NON_VAN_STOCK_KEYWORDS.test(`${compactWhitespace(text)} ${compactWhitespace(href)}`);
}

function detectVehicleCategory(text, href = "") {
  const haystack = `${compactWhitespace(text)} ${compactWhitespace(href)}`;
  if (/used-cars/i.test(href)) return "car";
  if (isExcludedNonVanStock(haystack, href)) return "excluded_non_van";
  if (/used-vans|no-vat-vans/i.test(href)) return "van";
  if (VAN_KEYWORDS.test(haystack)) return "van";
  if (CAR_KEYWORDS.test(haystack)) return "car";
  return "unknown";
}

function vehicleTitleFromUrl(url) {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).pop() || "vansco-vehicle";
    return slug.replace(/^used-/i, "").replace(/-for-sale.*$/i, "").replace(/-u\d+$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Vansco vehicle";
  } catch {
    return "Vansco vehicle";
  }
}

function toVehicleStub(url, sourceCategory = "sitemap") {
  const title = vehicleTitleFromUrl(url);
  return { title, stockUrl: normalizeUrl(url), imageUrl: "", price: "", registration: "", mileage: "", year: "", sourceStatus: "unknown", vehicleCategory: detectVehicleCategory(title, url), sourceCategory };
}

function dedupeVehicles(vehicles) {
  const byUrl = new Map();
  vehicles.forEach((vehicle) => {
    const key = normalizeUrl(vehicle.stockUrl);
    if (!key || byUrl.has(key)) return;
    byUrl.set(key, vehicle);
  });
  return Array.from(byUrl.values());
}

async function discoverVehicles(parserWarnings) {
  const endpoints = [SITEMAP_URL, "https://www.vansco.co.uk/sitemap.xml"];
  for (const endpoint of endpoints) {
    try {
      const page = await fetchHtml(endpoint, DISCOVERY_FETCH_TIMEOUT_MS);
      const urls = extractVehicleUrls(page.html);
      if (urls.length) {
        const vehicles = dedupeVehicles(urls.map((url) => toVehicleStub(url, "sitemap")));
        return { pageResults: [{ ...page, parsed: { candidates: urls, vehicles } }], vehicles, candidateLinksFound: urls.length, sourceFamily: "vansco-sitemap-url-list", endpointUsed: endpoint };
      }
    } catch {
      parserWarnings.push(`Sitemap discovery failed for ${endpoint}.`);
    }
  }

  parserWarnings.push("Sitemap discovery found no vehicle URLs. Fallback is limited to first category pages only.");
  const fallbackUrls = ["https://www.vansco.co.uk/used-vans/", "https://www.vansco.co.uk/no-vat-vans/", "https://www.vansco.co.uk/used-cars/"];
  const pageResults = [];
  let vehicles = [];
  let candidateLinksFound = 0;
  for (const endpoint of fallbackUrls) {
    try {
      const page = await fetchHtml(endpoint, DISCOVERY_FETCH_TIMEOUT_MS);
      const urls = extractVehicleUrls(page.html);
      const stubs = urls.map((url) => toVehicleStub(url, "category_fallback"));
      pageResults.push({ ...page, parsed: { candidates: urls, vehicles: stubs } });
      candidateLinksFound += urls.length;
      vehicles = dedupeVehicles([...vehicles, ...stubs]);
    } catch {
      parserWarnings.push(`Category fallback failed for ${endpoint}.`);
    }
  }
  return { pageResults, vehicles, candidateLinksFound, sourceFamily: "vansco-category-fallback", endpointUsed: fallbackUrls.join(", ") };
}

function filterVehiclesForPipeline(vehicles, pipeline) {
  if (pipeline === "cars") return vehicles.filter((vehicle) => detectVehicleCategory(vehicle.title, vehicle.stockUrl) === "car");
  return vehicles.filter((vehicle) => {
    const category = detectVehicleCategory(vehicle.title, vehicle.stockUrl);
    return category !== "car" && category !== "excluded_non_van";
  });
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
  const patterns = [new RegExp(`${escaped}\\s*[:|-]?\\s*<[^>]*>\\s*([^<]+)`, "i"), new RegExp(`${escaped}\\s*[:|-]?\\s*([^<\\n\\r]+)`, "i")];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = compactWhitespace(decodeHtml(match?.[1] || ""));
    if (value) return value;
  }
  return "";
}

function normalizeRegistration(value) {
  const text = compactWhitespace(value).toUpperCase();
  if (!text) return "";
  const cleaned = text.replace(/[^A-Z0-9]/g, "");
  if (!cleaned || cleaned.length < 5 || cleaned.length > 8) return "";
  if (!/[A-Z]/.test(cleaned) || !/[0-9]/.test(cleaned)) return "";
  if (BLOCKED_REG_VALUES.has(cleaned) || FAKE_REG_PATTERNS.some((pattern) => pattern.test(cleaned))) return "";
  const match = cleaned.match(REGISTRATION_PATTERN);
  const candidate = (match?.[1] || cleaned).replace(/[^A-Z0-9]/g, "");
  if (!candidate || candidate.length < 5 || candidate.length > 8) return "";
  if (!/[A-Z]/.test(candidate) || !/[0-9]/.test(candidate)) return "";
  if (BLOCKED_REG_VALUES.has(candidate) || FAKE_REG_PATTERNS.some((pattern) => pattern.test(candidate))) return "";
  return candidate;
}

function isStrictUkRegistration(value) {
  const cleaned = normalizeRegistration(value);
  if (!cleaned) return false;
  if (MODERN_UK_REG_PATTERN.test(cleaned)) return true;
  if (!LEGACY_REG_PATTERN.test(cleaned)) return false;
  return cleaned.length >= 5 && cleaned.length <= 8;
}

function extractRegistrationFromTitle(title, rejectedCandidates) {
  const pattern = /\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(title || ""))) {
    const candidate = compactWhitespace(match[1]);
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
  if (/deposit taken|reserved|\bsold\b/i.test(normalized)) return "reserved";
  if (/enquire now|finance options|reserve now|available/i.test(normalized)) return "available";
  return "unknown";
}

function extractImageUrl(html) {
  const metaImage = normalizeUrl(extractMetaContent(html, "og:image") || extractMetaContent(html, "twitter:image"));
  if (/^https?:\/\//i.test(metaImage) && !/logo|placeholder|favicon|icon|facebook|google|whatsapp|flexibuy/i.test(metaImage)) return metaImage;
  const imagePattern = /<img\b[^>]*(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imagePattern.exec(html))) {
    const candidate = normalizeUrl(match[1]);
    if (/^https?:\/\//i.test(candidate) && !/logo|placeholder|favicon|icon|facebook|google|whatsapp|flexibuy/i.test(candidate)) return candidate;
  }
  return "";
}

function hasEnrichedDetail(vehicle) {
  return Boolean(vehicle.registration || vehicle.imageUrl || (vehicle.sourceStatus && vehicle.sourceStatus !== "unknown"));
}

function enrichVehicleStub(stub, html, diagnostics) {
  const bodyText = decodeHtml(html);
  const pageTitle = extractHeading(html, "h1") || extractMetaContent(html, "og:title") || stub.title;
  const subtitle = extractHeading(html, "h2");
  const fullTitle = compactWhitespace([pageTitle, subtitle].filter(Boolean).join(" - "));
  const rejectedCandidates = diagnostics.rejectedRegistrationCandidates;
  const titleCandidates = [pageTitle, extractMetaContent(html, "og:title"), extractMetaContent(html, "twitter:title"), stub.title, fullTitle].filter(Boolean);
  let registration = "";
  for (const titleCandidate of titleCandidates) {
    registration = extractRegistrationFromTitle(titleCandidate, rejectedCandidates);
    if (registration) {
      diagnostics.registrationsExtractedFromTitleBrackets += 1;
      break;
    }
  }
  registration = registration || extractStrictRegistrationCandidate(extractLabelValue(html, "Registration"), rejectedCandidates) || extractStrictRegistrationCandidate(extractLabelValue(html, "Reg"), rejectedCandidates);
  return { ...stub, title: fullTitle || pageTitle || stub.title, stockUrl: normalizeUrl(stub.stockUrl), imageUrl: extractImageUrl(html) || stub.imageUrl, price: "", registration, mileage: "", year: "", sourceStatus: detectSourceStatus(bodyText), vehicleCategory: detectVehicleCategory(`${fullTitle} ${bodyText}`, stub.stockUrl) || stub.vehicleCategory, sourceCategory: stub.sourceCategory || "" };
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

function buildDiagnostics({ discovery, filteredVehicleCount, excludedNonVanCount, detailPagesFetched, detailPagesFailed, finalVehicles, detailFetchMode, detailFetchLimitApplied, detailTimeoutMs, partialScan, totalVehicleUrlsFound, enrichmentDiagnostics, detailDiagnostics, parserWarnings, detailOffset, remainingVehicleCount }) {
  return {
    endpointUsed: discovery.endpointUsed,
    sourceFamily: discovery.sourceFamily,
    pagesFetched: discovery.pageResults.length + detailPagesFetched,
    htmlLength: discovery.pageResults.reduce((total, page) => total + page.htmlLength, 0),
    candidateLinksFound: discovery.candidateLinksFound,
    sitemapUrlsFound: filteredVehicleCount,
    excludedNonVanCount,
    categoryPagesFetched: 0,
    categoryPageFailures: [],
    vehiclesParsedByCategory: {},
    vehicleDetailUrlsKept: finalVehicles.length,
    vehiclesParsed: finalVehicles.length,
    detailPagesFetched,
    detailPagesFailed,
    detailFailureReason: classifyDetailFailure(detailDiagnostics),
    detailFailureSamples: detailDiagnostics.failureSamples,
    detailHtmlSamples: detailDiagnostics.htmlSamples,
    vehiclesEnrichedWithRegistration: finalVehicles.filter((vehicle) => vehicle.registration).length,
    vehiclesEnrichedWithImage: finalVehicles.filter((vehicle) => vehicle.imageUrl).length,
    vehiclesWithSourceStatus: finalVehicles.filter((vehicle) => vehicle.sourceStatus && vehicle.sourceStatus !== "unknown").length,
    vehiclesWithValidMatchKey: finalVehicles.filter((vehicle) => vehicle.registration || vehicle.stockUrl).length,
    detailFetchMode,
    detailFetchLimitApplied,
    detailTimeoutMs,
    partialScan,
    totalVehicleUrlsFound,
    detailOffset,
    remainingVehicleCount,
    currentBatchStart: detailOffset,
    currentBatchEnd: detailOffset + finalVehicles.length,
    vehiclesProcessedThisBatch: finalVehicles.length,
    registrationsExtractedFromTitleBrackets: enrichmentDiagnostics.registrationsExtractedFromTitleBrackets,
    rejectedFakeRegistrationsCount: enrichmentDiagnostics.rejectedRegistrationCandidates.length,
    sampleRejectedFakeRegistrations: enrichmentDiagnostics.rejectedRegistrationCandidates.slice(0, 20),
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
    const emergencySlowMode = requestedBatchSize === 1;
    const detailTimeoutMs = emergencySlowMode ? EMERGENCY_DETAIL_FETCH_TIMEOUT_MS : DETAIL_FETCH_TIMEOUT_MS;
    const parserWarnings = [];
    const discovery = await discoverVehicles(parserWarnings);
    const pipelineVehicles = filterVehiclesForPipeline(discovery.vehicles, pipeline).slice(0, MAX_DETAIL_URLS);
    const excludedNonVanCount = pipeline === "cars" ? 0 : discovery.vehicles.filter((vehicle) => detectVehicleCategory(vehicle.title, vehicle.stockUrl) === "excluded_non_van").length;
    const filteredVehicles = pipelineVehicles;
    const totalVehicleUrlsFound = filteredVehicles.length;
    const requestedLimit = DETAIL_FETCH_MODE_LIMITS[detailFetchMode] ?? DETAIL_FETCH_MODE_LIMITS.standard;
    const batchSize = requestedBatchSize > 0 ? Math.min(requestedBatchSize, FULL_SCAN_BATCH_SIZE) : detailFetchMode === "full" ? FULL_SCAN_BATCH_SIZE : requestedLimit || filteredVehicles.length;
    const detailFetchLimit = requestedLimit === 0 ? Math.min(Math.max(0, totalVehicleUrlsFound - detailOffset), batchSize) : Math.min(requestedLimit, batchSize, Math.max(0, totalVehicleUrlsFound - detailOffset));
    const vehiclesToEnrich = filteredVehicles.slice(detailOffset, detailOffset + detailFetchLimit);
    const remainingVehicleCount = Math.max(0, totalVehicleUrlsFound - (detailOffset + vehiclesToEnrich.length));
    const hasMore = remainingVehicleCount > 0;
    if (hasMore) parserWarnings.push(`Batch ${Math.floor(detailOffset / Math.max(1, detailFetchLimit || batchSize)) + 1} processed ${vehiclesToEnrich.length} vehicles. ${remainingVehicleCount} remaining vehicles are queued for automatic batches.`);
    if (emergencySlowMode) parserWarnings.push(`Emergency slow mode active. Detail timeout is ${detailTimeoutMs / 1000}s per vehicle.`);
    if (excludedNonVanCount) parserWarnings.push(`${excludedNonVanCount} caravan/motorhome-style Vansco URLs were excluded from van checks.`);

    let detailPagesFetched = 0;
    let detailPagesFailed = 0;
    const enrichmentDiagnostics = { registrationsExtractedFromTitleBrackets: 0, rejectedRegistrationCandidates: [] };
    const detailDiagnostics = { failureSamples: [], htmlSamples: [] };
    const enrichedVehicles = await mapWithConcurrency(vehiclesToEnrich, DETAIL_FETCH_CONCURRENCY, async (vehicle) => {
      try {
        const detailPage = await fetchHtml(vehicle.stockUrl, detailTimeoutMs);
        detailPagesFetched += 1;
        if (detailDiagnostics.htmlSamples.length < DETAIL_DIAGNOSTIC_SAMPLE_LIMIT) {
          detailDiagnostics.htmlSamples.push(analyseDetailHtml(vehicle.stockUrl, detailPage));
        }
        return enrichVehicleStub(vehicle, detailPage.html, enrichmentDiagnostics);
      } catch (error) {
        detailPagesFailed += 1;
        if (detailDiagnostics.failureSamples.length < DETAIL_DIAGNOSTIC_SAMPLE_LIMIT) {
          detailDiagnostics.failureSamples.push({
            url: normalizeUrl(vehicle.stockUrl),
            message: error?.message || "Detail fetch failed",
            status: error?.status || 0,
            timeout: error?.name === "AbortError",
            htmlLength: error?.htmlLength || 0,
            sample: error?.htmlSample || "",
          });
        }
        return null;
      }
    });
    const finalVehicles = dedupeVehicles(enrichedVehicles.filter(Boolean));
    const partialScan = hasMore || detailPagesFailed > 0 || discovery.sourceFamily === "vansco-category-fallback";
    const diagnostics = buildDiagnostics({ discovery, filteredVehicleCount: filteredVehicles.length, excludedNonVanCount, detailPagesFetched, detailPagesFailed, finalVehicles, detailFetchMode, detailFetchLimitApplied: vehiclesToEnrich.length, detailTimeoutMs, partialScan, totalVehicleUrlsFound, enrichmentDiagnostics, detailDiagnostics, parserWarnings, detailOffset, remainingVehicleCount });

    if (vehiclesToEnrich.length && !finalVehicles.some(hasEnrichedDetail)) {
      response.setHeader("Cache-Control", "no-store, max-age=0");

      if (hasMore) {
        response.status(200).json({
          html: discovery.pageResults[0]?.html || "",
          htmlLength: diagnostics.htmlLength,
          fetchedAt: new Date().toISOString(),
          sourceUrl: SOURCE_URL,
          endpointUsed: discovery.endpointUsed,
          pagesFetched: diagnostics.pagesFetched,
          vehicles: [],
          detailOffset,
          hasMore,
          nextDetailOffset: detailOffset + vehiclesToEnrich.length,
          diagnostics,
        });
        return;
      }

      response.status(502).json({
        message: `Vansco detail pages did not return usable registrations, images, or statuses. Reason: ${diagnostics.detailFailureReason}. The scan was stopped so blank rows are not saved.`,
        diagnostics,
      });
      return;
    }

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({ html: discovery.pageResults[0]?.html || "", htmlLength: diagnostics.htmlLength, fetchedAt: new Date().toISOString(), sourceUrl: SOURCE_URL, endpointUsed: discovery.endpointUsed, pagesFetched: diagnostics.pagesFetched, vehicles: finalVehicles, detailOffset, hasMore, nextDetailOffset: detailOffset + vehiclesToEnrich.length, diagnostics });
  } catch (error) {
    response.status(500).json({ message: error?.message || "Could not fetch Vansco stock source." });
  }
}
