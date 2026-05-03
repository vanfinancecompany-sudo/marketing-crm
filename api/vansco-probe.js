const SITEMAP_URLS = ["https://www.vansco.co.uk/sitemap/", "https://www.vansco.co.uk/sitemap.xml"];
const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 25000;
const MAX_LIMIT = 25;
const VEHICLE_PATH_PATTERN = /\/vehicle-details\//i;
const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const FAKE_REG_PATTERNS = [/^[0-9]{2,3}PS$/i, /^[0-9]{2,3}BHP$/i, /^ULEZ$/i, /^EURO\d+$/i, /^L\dH\d$/i, /^U\d{4,6}$/i, /^SHOWROOM$/i, /^333$/i, /^0BOX$/i, /^FROMODOMETER$/i];
const BLOCKED_REG_VALUES = new Set(["VANSCO", "VANSCOLTD", "ALLSTOCK", "HOMESTOCK", "UNKNOWN", "NULL", "UNDEFINED", "NA", "N/A", "NOTFOUND", "ULEZ", "EURO6", "SHOWROOM", "FROMODOMETER"]);

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
    const url = new URL(text, "https://www.vansco.co.uk/all-stock/");
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

async function fetchHtml(url, timeoutMs) {
  const startedAt = Date.now();
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

function extractVehicleUrls(html) {
  const urls = new Set();
  const directPattern = /https?:\/\/www\.vansco\.co\.uk\/vehicle-details\/[^\s"'<>]+/gi;
  let match;
  while ((match = directPattern.exec(String(html || "")))) {
    urls.add(normalizeUrl(match[0]));
  }

  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>/gi;
  while ((match = anchorPattern.exec(String(html || "")))) {
    const href = normalizeUrl(match[2]);
    if (VEHICLE_PATH_PATTERN.test(href)) urls.add(href);
  }

  return Array.from(urls).filter(Boolean);
}

async function discoverUrls() {
  const attempts = [];
  for (const sitemapUrl of SITEMAP_URLS) {
    try {
      const page = await fetchHtml(sitemapUrl, 10000);
      const urls = extractVehicleUrls(page.html);
      attempts.push({ sitemapUrl, ok: page.ok, status: page.status, elapsedMs: page.elapsedMs, htmlLength: page.htmlLength, urlsFound: urls.length });
      if (urls.length) return { sitemapUrl, attempts, urls };
    } catch (error) {
      attempts.push({ sitemapUrl, ok: false, errorName: error?.name || "Error", errorMessage: error?.message || "Fetch failed", timeout: error?.name === "AbortError" });
    }
  }
  return { sitemapUrl: "", attempts, urls: [] };
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

function extractTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i)?.[1];
  const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return decodeHtml(h1 || ogTitle || pageTitle || "");
}

function extractBracketRegistration(title) {
  const pattern = /\(([^)]+)\)/g;
  let match;
  const candidates = [];
  while ((match = pattern.exec(title || ""))) {
    const raw = compactWhitespace(match[1]);
    const normalized = normalizeRegistration(raw);
    candidates.push({ raw, normalized, accepted: Boolean(normalized) });
    if (normalized) return { registration: normalized, candidates };
  }
  return { registration: "", candidates };
}

function detectSourceStatus(text) {
  const normalized = compactWhitespace(text);
  if (/deposit taken|reserved|\bsold\b/i.test(normalized)) return "reserved";
  if (/enquire now|finance options|reserve now|available/i.test(normalized)) return "available";
  return "unknown";
}

function extractImage(html) {
  return html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i)?.[1]
    || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    || html.match(/<img\b[^>]*(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/i)?.[1]
    || "";
}

function classifyHtml(html, status) {
  const decoded = decodeHtml(html);
  const looksBlocked = /cloudflare|captcha|access denied|forbidden|enable cookies|checking your browser|attention required|bot|security check/i.test(decoded);
  const hasVehicleHints = /registration|reg\b|reserve|reserved|deposit taken|enquire now|finance options|vehicle-details|og:title|og:image/i.test(html);
  if ([401, 403, 429, 503].includes(Number(status))) return "blocked_or_rate_limited_status";
  if (looksBlocked) return "blocked_or_challenge_html";
  if (html.length < 1000) return "empty_or_tiny_html";
  if (!hasVehicleHints) return "unexpected_html_no_vehicle_hints";
  return "normal_vehicle_like_html";
}

async function probeUrl(url, timeoutMs, index) {
  try {
    const page = await fetchHtml(url, timeoutMs);
    const title = extractTitle(page.html);
    const bracket = extractBracketRegistration(title);
    const decoded = decodeHtml(page.html);
    return {
      index,
      url,
      ok: page.ok,
      timeout: false,
      diagnostic: classifyHtml(page.html, page.status),
      elapsedMs: page.elapsedMs,
      status: page.status,
      statusText: page.statusText,
      htmlLength: page.htmlLength,
      title,
      registration: bracket.registration,
      bracketCandidates: bracket.candidates,
      sourceStatus: detectSourceStatus(decoded),
      imageFound: Boolean(extractImage(page.html)),
      hasVehicleHints: /registration|reg\b|reserve|reserved|deposit taken|enquire now|finance options|vehicle-details|og:title|og:image/i.test(page.html),
    };
  } catch (error) {
    return {
      index,
      url,
      ok: false,
      timeout: error?.name === "AbortError",
      diagnostic: error?.name === "AbortError" ? "timeout" : "fetch_error",
      elapsedMs: timeoutMs,
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

  const limit = Math.min(Math.max(Number(request.query?.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const timeoutMs = Math.min(Math.max(Number(request.query?.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 1000), 55000);

  try {
    const discovery = await discoverUrls();
    const urls = discovery.urls.slice(0, limit);
    const results = [];

    for (let index = 0; index < urls.length; index += 1) {
      results.push(await probeUrl(urls[index], timeoutMs, index + 1));
    }

    const successfulFetches = results.filter((item) => item.ok).length;
    const registrationsFound = results.filter((item) => item.registration).length;
    const timeouts = results.filter((item) => item.timeout).length;

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      sitemapUrl: discovery.sitemapUrl,
      discoveryAttempts: discovery.attempts,
      totalUrlsFound: discovery.urls.length,
      probedCount: results.length,
      timeoutMs,
      successfulFetches,
      registrationsFound,
      timeouts,
      results,
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Probe failed." });
  }
}
