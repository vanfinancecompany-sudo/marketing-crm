const DEFAULT_TEST_URL = "https://www.vansco.co.uk/vehicle-details/used-renault-kangoo-1-5-dci-energy-ml19-business-panel-van-5dr-diesel-manual-mwb-euro-6-s-s-75-ps-for-sale-vansco-new-forest-u11733/";
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 55000;

const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const FAKE_REG_PATTERNS = [/^[0-9]{2,3}PS$/i, /^[0-9]{2,3}BHP$/i, /^ULEZ$/i, /^EURO\d+$/i, /^L\dH\d$/i, /^U\d{4,6}$/i, /^SHOWROOM$/i, /^333$/i, /^0BOX$/i, /^FROMODOMETER$/i];
const BLOCKED_REG_VALUES = new Set(["VANSCO", "VANSCOLTD", "ALLSTOCK", "HOMESTOCK", "UNDEFINED", "UNKNOWN", "NULL", "N/A", "NA", "NOTFOUND", "ULEZ", "EURO6", "SHOWROOM", "FROMODOMETER"]);

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

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
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

function detectSourceStatus(text) {
  const normalized = compactWhitespace(text);
  if (/deposit taken|reserved|\bsold\b/i.test(normalized)) return "reserved";
  if (/enquire now|finance options|reserve now|available/i.test(normalized)) return "available";
  return "unknown";
}

function extractImage(html) {
  const metaImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i)?.[1]
    || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1];

  if (metaImage) return metaImage;

  const imgMatch = html.match(/<img\b[^>]*(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/i);
  return imgMatch?.[1] || "";
}

function classifyHtml(html, status) {
  const decoded = decodeHtml(html);
  const looksBlocked = /cloudflare|captcha|access denied|forbidden|blocked|enable cookies|checking your browser|attention required|bot|security check/i.test(decoded);
  const hasVehicleHints = /registration|reg\b|reserve|reserved|deposit taken|enquire now|finance options|vehicle-details|og:title|og:image/i.test(html);

  if ([401, 403, 429, 503].includes(Number(status))) return "blocked_or_rate_limited_status";
  if (looksBlocked) return "blocked_or_challenge_html";
  if (html.length < 1000) return "empty_or_tiny_html";
  if (!hasVehicleHints) return "unexpected_html_no_vehicle_hints";
  return "normal_vehicle_like_html";
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const testUrl = String(request.query?.url || DEFAULT_TEST_URL).trim();
  const requestedTimeoutMs = Number(request.query?.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(1000, requestedTimeoutMs), MAX_TIMEOUT_MS);
  const startedAt = Date.now();
  const timed = timeoutSignal(timeoutMs);

  try {
    const upstreamResponse = await fetch(testUrl, {
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

    const html = await upstreamResponse.text();
    const elapsedMs = Date.now() - startedAt;
    const title = extractTitle(html);
    const bracketResult = extractBracketRegistration(title);
    const decodedText = decodeHtml(html);
    const sourceStatus = detectSourceStatus(decodedText);
    const imageUrl = extractImage(html);
    const resultType = classifyHtml(html, upstreamResponse.status);

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: upstreamResponse.ok,
      diagnostic: resultType,
      timeout: false,
      testUrl,
      timeoutMs,
      elapsedMs,
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      contentType: upstreamResponse.headers.get("content-type") || "",
      htmlLength: html.length,
      title,
      registration: bracketResult.registration,
      bracketCandidates: bracketResult.candidates,
      sourceStatus,
      imageFound: Boolean(imageUrl),
      imageUrl,
      hasVehicleHints: /registration|reg\b|reserve|reserved|deposit taken|enquire now|finance options|vehicle-details|og:title|og:image/i.test(html),
      looksBlocked: /cloudflare|captcha|access denied|forbidden|blocked|enable cookies|checking your browser|attention required|bot|security check/i.test(decodedText),
      htmlStartSample: decodedText.slice(0, 500),
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: false,
      diagnostic: error?.name === "AbortError" ? "timeout" : "fetch_error",
      timeout: error?.name === "AbortError",
      testUrl,
      timeoutMs,
      elapsedMs,
      errorName: error?.name || "Error",
      errorMessage: error?.message || "Vansco detail fetch failed.",
    });
  } finally {
    timed.clear();
  }
}
