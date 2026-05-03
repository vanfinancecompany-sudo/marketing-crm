const VANSCO_BASE = "https://www.vansco.co.uk";
const DRAGON_BASE = "https://vansco.dragon2000.net";
const SITEMAP_URL = "https://www.vansco.co.uk/sitemap/";
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

const KNOWN_TEST_URLS = [
  "https://www.vansco.co.uk/vehicle-details/used-renault-kangoo-1-5-dci-energy-ml19-business-panel-van-5dr-diesel-manual-mwb-euro-6-s-s-75-ps-for-sale-vansco-new-forest-u11733",
  "https://www.vansco.co.uk/vehicle-details/used-iveco-daily-box-van-3-0-automatic-diesel-for-sale-vansco-southampton-airport-u9696",
];

const VEHICLE_PATH_PATTERN = /\/vehicle-details\//i;
const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const FAKE_REG_PATTERNS = [/^[0-9]{2,3}PS$/i, /^[0-9]{2,3}BHP$/i, /^ULEZ$/i, /^EURO\d+$/i, /^L\dH\d$/i, /^U\d{4,6}$/i, /^SHOWROOM$/i, /^333$/i, /^0BOX$/i, /^FROMODOMETER$/i, /^360DEG$/i, /^504PX$/i];
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

function toDragonUrl(url) {
  try {
    const parsed = new URL(url, VANSCO_BASE);
    return `${DRAGON_BASE}${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchText(url, timeoutMs) {
  const startedAt = Date.now();
  const timed = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: timed.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
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
      contentType: response.headers.get("content-type") || "",
      body,
      bodyLength: body.length,
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
  while ((match = directPattern.exec(String(html || "")))) urls.add(normalizeUrl(match[0]));

  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>/gi;
  while ((match = anchorPattern.exec(String(html || "")))) {
    const href = normalizeUrl(match[2]);
    if (VEHICLE_PATH_PATTERN.test(href)) urls.add(href);
  }

  return Array.from(urls).filter(Boolean);
}

function normalizeRegistration(value) {
  const cleaned = compactWhitespace(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned || cleaned.length < 5 || cleaned.length > 8) return "";
  if (!/[A-Z]/.test(cleaned) || !/[0-9]/.test(cleaned)) return "";
  if (BLOCKED_REG_VALUES.has(cleaned) || FAKE_REG_PATTERNS.some((pattern) => pattern.test(cleaned))) return "";
  const match = cleaned.match(REGISTRATION_PATTERN);
  const candidate = (match?.[1] || cleaned).replace(/[^A-Z0-9]/g, "");
  if (!candidate || candidate.length < 5 || candidate.length > 8) return "";
  if (BLOCKED_REG_VALUES.has(candidate) || FAKE_REG_PATTERNS.some((pattern) => pattern.test(candidate))) return "";
  return candidate;
}

function extractTitle(html) {
  return decodeHtml(
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i)?.[1] ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    ""
  ).slice(0, 220);
}

function extractBracketRegistration(title) {
  const candidates = [];
  const pattern = /\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(title || ""))) {
    const raw = compactWhitespace(match[1]);
    const normalized = normalizeRegistration(raw);
    candidates.push({ raw, normalized, accepted: Boolean(normalized) });
    if (normalized) return { registration: normalized, candidates };
  }
  return { registration: "", candidates };
}

function detectStatus(text) {
  const normalized = compactWhitespace(text);
  if (/deposit taken/i.test(normalized)) return "deposit_taken";
  if (/reserved/i.test(normalized)) return "reserved";
  if (/\bsold\b/i.test(normalized)) return "sold";
  if (/enquire now|finance options|reserve now|available/i.test(normalized)) return "available";
  return "unknown";
}

function classify(body, status) {
  const decoded = decodeHtml(body);
  if ([401, 403, 429, 503].includes(Number(status))) return "blocked_or_rate_limited_status";
  if (/cloudflare|captcha|access denied|forbidden|enable cookies|checking your browser|attention required|bot|security check/i.test(decoded)) return "blocked_or_challenge_html";
  if (/gateway time-out|504 gateway/i.test(decoded)) return "gateway_timeout_html";
  if (body.length < 1000) return "empty_or_tiny_body";
  if (/vehicle-details|og:title|og:image|reserved|deposit taken|enquire now|finance options/i.test(body)) return "vehicle_like_body";
  return "other_body";
}

async function discoverUrls(timeoutMs) {
  const page = await fetchText(SITEMAP_URL, timeoutMs);
  return extractVehicleUrls(page.body);
}

async function probeOne(url, timeoutMs) {
  const vanscoUrl = normalizeUrl(url);
  const dragonUrl = toDragonUrl(vanscoUrl);
  const attempts = [];

  for (const [host, requestedUrl] of [["vansco", vanscoUrl], ["dragon", dragonUrl]]) {
    try {
      const page = await fetchText(requestedUrl, timeoutMs);
      const title = extractTitle(page.body);
      const bracket = extractBracketRegistration(title);
      attempts.push({
        host,
        requestedUrl,
        ok: page.ok,
        status: page.status,
        statusText: page.statusText,
        finalUrl: page.finalUrl,
        redirected: normalizeUrl(page.finalUrl) !== normalizeUrl(requestedUrl),
        elapsedMs: page.elapsedMs,
        contentType: page.contentType,
        bodyLength: page.bodyLength,
        diagnostic: classify(page.body, page.status),
        title,
        registration: bracket.registration,
        bracketCandidates: bracket.candidates,
        sourceStatus: detectStatus(decodeHtml(page.body)),
        bodySample: decodeHtml(page.body).slice(0, 220),
      });
    } catch (error) {
      attempts.push({
        host,
        requestedUrl,
        ok: false,
        timeout: error?.name === "AbortError",
        diagnostic: error?.name === "AbortError" ? "timeout" : "fetch_error",
        errorName: error?.name || "Error",
        errorMessage: error?.message || "Fetch failed",
        elapsedMs: timeoutMs,
      });
    }
  }

  return {
    sourceUrl: vanscoUrl,
    dragonUrl,
    vanscoRegistration: attempts.find((item) => item.host === "vansco")?.registration || "",
    dragonRegistration: attempts.find((item) => item.host === "dragon")?.registration || "",
    attempts,
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const timeoutMs = Math.min(Math.max(Number(request.query?.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 1000), 55000);
  const limit = Math.min(Math.max(Number(request.query?.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(request.query?.offset || 0) || 0, 0);

  try {
    const sitemapUrls = await discoverUrls(10000);
    const urls = [...KNOWN_TEST_URLS, ...sitemapUrls.slice(offset, offset + limit)].filter(Boolean);
    const uniqueUrls = Array.from(new Set(urls)).slice(0, limit + KNOWN_TEST_URLS.length);
    const results = [];

    for (const url of uniqueUrls) {
      results.push(await probeOne(url, timeoutMs));
    }

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      timeoutMs,
      offset,
      sitemapUrlsFound: sitemapUrls.length,
      urlsTested: results.length,
      summary: {
        vanscoSuccesses: results.filter((item) => item.attempts.some((attempt) => attempt.host === "vansco" && attempt.registration)).length,
        dragonSuccesses: results.filter((item) => item.attempts.some((attempt) => attempt.host === "dragon" && attempt.registration)).length,
        dragonTimeouts: results.filter((item) => item.attempts.some((attempt) => attempt.host === "dragon" && attempt.timeout)).length,
        dragonVehicleLikeBodies: results.filter((item) => item.attempts.some((attempt) => attempt.host === "dragon" && attempt.diagnostic === "vehicle_like_body")).length,
      },
      results,
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Dragon detail probe failed." });
  }
}
