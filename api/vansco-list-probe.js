const LIST_PAGES = [
  "https://www.vansco.co.uk/all-stock/",
  "https://www.vansco.co.uk/used-vans/",
  "https://www.vansco.co.uk/no-vat-vans/",
  "https://www.vansco.co.uk/used-cars/",
];

const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const BRACKET_PATTERN = /\(([A-Z0-9\s]{5,10})\)/gi;
const VEHICLE_PATH_PATTERN = /\/vehicle-details\//i;
const TIMEOUT_MS = 25000;

const FAKE_REG_PATTERNS = [
  /^[0-9]{2,3}PS$/i,
  /^[0-9]{2,3}BHP$/i,
  /^ULEZ$/i,
  /^EURO\d+$/i,
  /^L\dH\d$/i,
  /^U\d{4,6}$/i,
  /^SHOWROOM$/i,
  /^FROMODOMETER$/i,
  /^0BOX$/i,
];

const BLOCKED_REG_VALUES = new Set([
  "VANSCO",
  "VANSCOLTD",
  "ALLSTOCK",
  "HOMESTOCK",
  "UNKNOWN",
  "NULL",
  "UNDEFINED",
  "NA",
  "N/A",
  "NOTFOUND",
  "ULEZ",
  "EURO6",
  "SHOWROOM",
  "FROMODOMETER",
]);

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
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
    const url = new URL(text, "https://www.vansco.co.uk/all-stock/");
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return text.replace(/\/$/, "");
  }
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

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchHtml(url) {
  const startedAt = Date.now();
  const timed = timeoutSignal(TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: timed.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9",
        pragma: "no-cache",
        "cache-control": "no-cache",
      },
    });
    const html = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") || "",
      html,
      htmlLength: html.length,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    timed.clear();
  }
}

function extractVehicleLinks(html) {
  const links = new Set();
  const directPattern = /https?:\/\/www\.vansco\.co\.uk\/vehicle-details\/[^\s"'<>]+/gi;
  let match;

  while ((match = directPattern.exec(String(html || "")))) {
    links.add(normalizeUrl(match[0]));
  }

  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = anchorPattern.exec(String(html || "")))) {
    const href = normalizeUrl(match[2]);
    if (VEHICLE_PATH_PATTERN.test(href)) links.add(href);
  }

  return Array.from(links);
}

function extractBracketRegistrations(text) {
  const registrations = [];
  let match;

  while ((match = BRACKET_PATTERN.exec(String(text || "")))) {
    const raw = compactWhitespace(match[1]);
    const normalized = normalizeRegistration(raw);
    if (normalized) {
      registrations.push({ raw, normalized });
    }
  }

  const unique = new Map();
  registrations.forEach((registration) => unique.set(registration.normalized, registration));
  return Array.from(unique.values());
}

function extractImages(html) {
  const images = new Set();
  const imagePattern = /<img\b[^>]*(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(String(html || "")))) {
    const url = normalizeUrl(match[1]);
    if (/^https?:\/\//i.test(url) && !/logo|placeholder|favicon|icon|facebook|google|whatsapp|flexibuy/i.test(url)) {
      images.add(url);
    }
  }

  return Array.from(images);
}

function sampleVehicleTitles(html) {
  const decoded = decodeHtml(html);
  const lines = decoded
    .split(/(?=\b(?:FORD|MERCEDES|MERCEDES-BENZ|RENAULT|VOLKSWAGEN|IVECO|PEUGEOT|CITROEN|VAUXHALL|NISSAN|AUDI|BMW|BAILEY|FIAT|TOYOTA|ISUZU|MITSUBISHI)\b)/i)
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length > 20 && /\b(?:van|car|diesel|manual|automatic|euro|ulez|ps|tdi|dci|hdi|cdi)\b/i.test(line))
    .slice(0, 20);

  return lines;
}

function detectStatusCounts(text) {
  const value = String(text || "");
  return {
    reserved: (value.match(/reserved/gi) || []).length,
    sold: (value.match(/\bsold\b/gi) || []).length,
    depositTaken: (value.match(/deposit taken/gi) || []).length,
    available: (value.match(/available/gi) || []).length,
  };
}

function classifyHtml(html, status) {
  const decoded = decodeHtml(html);
  const looksBlocked = /cloudflare|captcha|access denied|forbidden|enable cookies|checking your browser|attention required|bot|security check/i.test(decoded);
  const hasVehicleHints = /vehicle-details|reserved|deposit taken|available|og:image|stock|enquire now|finance/i.test(html);
  if ([401, 403, 429, 503].includes(Number(status))) return "blocked_or_rate_limited_status";
  if (looksBlocked) return "blocked_or_challenge_html";
  if (html.length < 1000) return "empty_or_tiny_html";
  if (!hasVehicleHints) return "unexpected_html_no_vehicle_hints";
  return "normal_stock_like_html";
}

async function probePage(url) {
  try {
    const page = await fetchHtml(url);
    const decoded = decodeHtml(page.html);
    const vehicleLinks = extractVehicleLinks(page.html);
    const bracketRegistrations = extractBracketRegistrations(decoded);
    const images = extractImages(page.html);
    const titles = sampleVehicleTitles(page.html);

    return {
      url,
      ok: page.ok,
      diagnostic: classifyHtml(page.html, page.status),
      timeout: false,
      elapsedMs: page.elapsedMs,
      status: page.status,
      statusText: page.statusText,
      contentType: page.contentType,
      htmlLength: page.htmlLength,
      vehicleLinksFound: vehicleLinks.length,
      sampleVehicleLinks: vehicleLinks.slice(0, 15),
      bracketRegistrationsFound: bracketRegistrations.length,
      sampleBracketRegistrations: bracketRegistrations.slice(0, 20),
      imagesFound: images.length,
      sampleImages: images.slice(0, 10),
      statusCounts: detectStatusCounts(decoded),
      sampleVehicleTitles: titles,
      htmlStartSample: decoded.slice(0, 350),
    };
  } catch (error) {
    return {
      url,
      ok: false,
      diagnostic: error?.name === "AbortError" ? "timeout" : "fetch_error",
      timeout: error?.name === "AbortError",
      elapsedMs: TIMEOUT_MS,
      errorName: error?.name || "Error",
      errorMessage: error?.message || "Fetch failed",
    };
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const requestedUrl = compactWhitespace(request.query?.url || "");
  const pagesToProbe = requestedUrl ? [requestedUrl] : LIST_PAGES;
  const results = [];

  for (const url of pagesToProbe) {
    results.push(await probePage(url));
  }

  const totals = results.reduce(
    (total, result) => ({
      pagesFetched: total.pagesFetched + (result.ok ? 1 : 0),
      vehicleLinksFound: total.vehicleLinksFound + (result.vehicleLinksFound || 0),
      bracketRegistrationsFound: total.bracketRegistrationsFound + (result.bracketRegistrationsFound || 0),
      imagesFound: total.imagesFound + (result.imagesFound || 0),
      timeouts: total.timeouts + (result.timeout ? 1 : 0),
    }),
    { pagesFetched: 0, vehicleLinksFound: 0, bracketRegistrationsFound: 0, imagesFound: 0, timeouts: 0 }
  );

  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.status(200).json({
    ok: true,
    testedAt: new Date().toISOString(),
    pagesTested: results.length,
    totals,
    results,
  });
}
