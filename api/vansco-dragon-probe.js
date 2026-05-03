const DRAGON_BASE = "https://vansco.dragon2000.net";
const VANSCO_BASE = "https://www.vansco.co.uk";
const DEFAULT_TIMEOUT_MS = 20000;

const ROUTES_TO_TEST = [
  { label: "Dragon used vans category", url: `${DRAGON_BASE}/all-stock/?websiteCategories=Used+Vans` },
  { label: "Dragon no VAT vans category", url: `${DRAGON_BASE}/all-stock/?websiteCategories=No+Vat+Vans` },
  { label: "Dragon used cars category", url: `${DRAGON_BASE}/all-stock/?websiteCategories=Used+Cars` },
  { label: "Vansco used vans category", url: `${VANSCO_BASE}/all-stock/?websiteCategories=Used+Vans` },
  { label: "Vansco no VAT vans category", url: `${VANSCO_BASE}/all-stock/?websiteCategories=No+Vat+Vans` },
  { label: "Vansco used cars category", url: `${VANSCO_BASE}/all-stock/?websiteCategories=Used+Cars` },
  { label: "Dragon all stock", url: `${DRAGON_BASE}/all-stock/` },
  { label: "Dragon sitemap", url: `${DRAGON_BASE}/sitemap/` },
  { label: "Dragon sitemap xml", url: `${DRAGON_BASE}/sitemap.xml` },
  { label: "Dragon stock xml guess", url: `${DRAGON_BASE}/stock.xml` },
  { label: "Dragon feed xml guess", url: `${DRAGON_BASE}/feed.xml` },
  { label: "Dragon vehicles xml guess", url: `${DRAGON_BASE}/vehicles.xml` },
  { label: "Dragon stock json guess", url: `${DRAGON_BASE}/stock.json` },
  { label: "Dragon api stock guess", url: `${DRAGON_BASE}/api/stock` },
  { label: "Dragon api vehicles guess", url: `${DRAGON_BASE}/api/vehicles` },
];

const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const VEHICLE_PATH_PATTERN = /\/vehicle-details\//i;

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
  const text = compactWhitespace(value);
  if (!text) return "";
  try {
    const url = new URL(text, VANSCO_BASE);
    url.hash = "";
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

async function fetchRoute(url, timeoutMs) {
  const startedAt = Date.now();
  const timed = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: timed.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9",
        referer: VANSCO_BASE,
        pragma: "no-cache",
        "cache-control": "no-cache",
      },
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      redirected: normalizeUrl(response.url) !== normalizeUrl(url),
      contentType: response.headers.get("content-type") || "",
      body,
      bodyLength: body.length,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    timed.clear();
  }
}

function extractVehicleUrls(body) {
  const urls = new Set();
  const directPattern = /https?:\/\/(?:www\.vansco\.co\.uk|vansco\.dragon2000\.net)\/vehicle-details\/[^\s"'<>]+/gi;
  let match;
  while ((match = directPattern.exec(String(body || "")))) urls.add(normalizeUrl(match[0]));

  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>/gi;
  while ((match = anchorPattern.exec(String(body || "")))) {
    const href = normalizeUrl(match[2]);
    if (VEHICLE_PATH_PATTERN.test(href)) urls.add(href);
  }

  return Array.from(urls).filter(Boolean);
}

function extractTitle(body) {
  return decodeHtml(
    body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    ""
  ).slice(0, 180);
}

function countBracketRegistrationCandidates(body) {
  const decoded = decodeHtml(body);
  const bracketPattern = /\(([^)]+)\)/g;
  let match;
  let count = 0;
  const samples = [];
  while ((match = bracketPattern.exec(decoded))) {
    const candidate = compactWhitespace(match[1]).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (REGISTRATION_PATTERN.test(candidate)) {
      count += 1;
      if (samples.length < 10) samples.push(candidate);
    }
  }
  return { count, samples };
}

function classifyBody(body, status) {
  const decoded = decodeHtml(body);
  if ([401, 403, 429, 503].includes(Number(status))) return "blocked_or_rate_limited_status";
  if (/cloudflare|captcha|access denied|forbidden|enable cookies|checking your browser|attention required|bot|security check/i.test(decoded)) return "blocked_or_challenge_html";
  if (/gateway time-out|504 gateway/i.test(decoded)) return "gateway_timeout_html";
  if (body.length < 500) return "empty_or_tiny_body";
  if (/vehicle-details|Vehicles For Sale|all-stock|websiteCategories|reserved|deposit taken|enquire now/i.test(body)) return "stock_like_body";
  return "other_body";
}

async function probe(label, url, timeoutMs) {
  try {
    const result = await fetchRoute(url, timeoutMs);
    const vehicleUrls = extractVehicleUrls(result.body);
    const brackets = countBracketRegistrationCandidates(result.body);
    return {
      label,
      requestedUrl: url,
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      finalUrl: result.finalUrl,
      redirected: result.redirected,
      elapsedMs: result.elapsedMs,
      contentType: result.contentType,
      bodyLength: result.bodyLength,
      diagnostic: classifyBody(result.body, result.status),
      title: extractTitle(result.body),
      vehicleLinksFound: vehicleUrls.length,
      sampleVehicleLinks: vehicleUrls.slice(0, 10),
      bracketRegistrationCandidatesFound: brackets.count,
      sampleBracketRegistrationCandidates: brackets.samples,
      bodySample: decodeHtml(result.body).slice(0, 260),
    };
  } catch (error) {
    return {
      label,
      requestedUrl: url,
      ok: false,
      timeout: error?.name === "AbortError",
      diagnostic: error?.name === "AbortError" ? "timeout" : "fetch_error",
      errorName: error?.name || "Error",
      errorMessage: error?.message || "Fetch failed",
      elapsedMs: timeoutMs,
    };
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const timeoutMs = Math.min(Math.max(Number(request.query?.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 1000), 55000);
  const limit = Math.min(Math.max(Number(request.query?.limit || ROUTES_TO_TEST.length) || ROUTES_TO_TEST.length, 1), ROUTES_TO_TEST.length);
  const routes = ROUTES_TO_TEST.slice(0, limit);
  const results = [];

  for (const route of routes) {
    results.push(await probe(route.label, route.url, timeoutMs));
  }

  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.status(200).json({
    ok: true,
    timeoutMs,
    routesTested: results.length,
    summary: {
      usableStockLikeRoutes: results.filter((item) => item.ok && item.diagnostic === "stock_like_body").length,
      routesWithVehicleLinks: results.filter((item) => item.vehicleLinksFound > 0).length,
      routesWithBracketRegs: results.filter((item) => item.bracketRegistrationCandidatesFound > 0).length,
      timeouts: results.filter((item) => item.timeout).length,
    },
    results,
  });
}
