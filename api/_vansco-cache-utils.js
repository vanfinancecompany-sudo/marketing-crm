import { createClient } from "@supabase/supabase-js";

export const SITEMAP_URLS = ["https://www.vansco.co.uk/sitemap/", "https://www.vansco.co.uk/sitemap.xml"];
export const VANSCO_SOURCE_URL = "https://www.vansco.co.uk/all-stock/";
export const CACHE_TABLE = "vansco_vehicle_cache";
export const WATCH_TABLE = "vansco_stock_watch";

const VEHICLE_PATH_PATTERN = /\/vehicle-details\//i;
const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const MODERN_UK_REG_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/;
const LEGACY_REG_PATTERN = /^(?:[A-Z][0-9]{1,3}[A-Z]{3}|[A-Z]{3}[0-9]{1,3}[A-Z]|[0-9]{1,4}[A-Z]{1,3})$/i;
const FAKE_REG_PATTERNS = [/^[0-9]{2,3}PS$/i, /^[0-9]{2,3}BHP$/i, /^ULEZ$/i, /^EURO\d+$/i, /^L\dH\d$/i, /^U\d{4,6}$/i, /^SHOWROOM$/i, /^333$/i, /^0BOX$/i, /^FROMODOMETER$/i, /^360DEG$/i];
const BLOCKED_REG_VALUES = new Set(["VANSCO", "VANSCOLTD", "ALLSTOCK", "HOMESTOCK", "UNKNOWN", "NULL", "UNDEFINED", "NA", "N/A", "NOTFOUND", "ULEZ", "EURO6", "SHOWROOM", "FROMODOMETER", "SCHEMA", "JSON"]);
const CAR_KEYWORDS = /\b(audi|bmw|jaguar|jeep|kia|lexus|mercedes-benz|mercedes|skoda|suzuki|hyundai|q2|q3|a3|a4|a5|estate|hatchback|cabriolet|suv|coupe|saloon)\b/i;
const VAN_KEYWORDS = /\b(transit|custom|tipper|dropside|luton|crew van|minibus|panel van|box van|pickup|pick-up|chassis cab|relay|dispatch|scudo|daily|doblo|partner|berlingo|sprinter|crafter|vivaro|movano|box-van|kangoo|traffic|master|ducato|talento|expert|transporter|bailey|pegasus|winnebago|motorhome|caravan|camper)\b/i;

export function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables for Vansco cache API.");
  }

  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

export function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function decodeHtml(value) {
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

export function normalizeUrl(value) {
  const text = compactWhitespace(value);
  if (!text) return "";

  try {
    const url = new URL(text, VANSCO_SOURCE_URL);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return text.replace(/\/$/, "");
  }
}

export function normalizeRegistration(value) {
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
  if (MODERN_UK_REG_PATTERN.test(candidate)) return candidate;
  if (LEGACY_REG_PATTERN.test(candidate)) return candidate;
  return "";
}

export function extractVanscoId(stockUrl) {
  const match = normalizeUrl(stockUrl).match(/[-/]u(\d{3,8})(?:\/)?$/i);
  return match?.[1] ? `u${match[1]}`.toLowerCase() : "";
}

export function detectVehicleCategory(text = "", href = "") {
  const haystack = `${compactWhitespace(text)} ${compactWhitespace(href)}`;
  if (/used-cars/i.test(href) || CAR_KEYWORDS.test(haystack)) return "car";
  if (/used-vans|no-vat-vans/i.test(href) || VAN_KEYWORDS.test(haystack)) return "van";
  return "unknown";
}

export function vehicleTitleFromUrl(url) {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).pop() || "vansco-vehicle";
    return slug.replace(/^used-/i, "").replace(/-for-sale.*$/i, "").replace(/-u\d+$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Vansco vehicle";
  } catch {
    return "Vansco vehicle";
  }
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export async function fetchHtml(url, timeoutMs = 25000) {
  const startedAt = Date.now();
  const timed = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      signal: timed.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9",
        referer: VANSCO_SOURCE_URL,
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

export function extractVehicleUrls(html) {
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

export async function discoverVanscoUrls() {
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

function extractTitle(html, fallbackTitle = "") {
  return extractHeading(html, "h1") || extractMetaContent(html, "og:title") || extractMetaContent(html, "twitter:title") || decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || fallbackTitle;
}

function extractBracketRegistration(title) {
  const pattern = /\(([^)]+)\)/g;
  let match;
  const rejected = [];
  while ((match = pattern.exec(title || ""))) {
    const raw = compactWhitespace(match[1]);
    const normalized = normalizeRegistration(raw);
    if (normalized) return { registration: normalized, rejected };
    if (raw) rejected.push(raw);
  }
  return { registration: "", rejected };
}

function detectSourceStatus(text) {
  const normalized = compactWhitespace(text);
  if (/deposit taken/i.test(normalized)) return "deposit_taken";
  if (/reserved/i.test(normalized)) return "reserved";
  if (/\bsold\b/i.test(normalized)) return "sold";
  if (/enquire now|finance options|reserve now|available/i.test(normalized)) return "available";
  return "unknown";
}

function extractImage(html) {
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

export function parseDetailHtml(stockUrl, html, fallbackTitle = "") {
  const bodyText = decodeHtml(html);
  const pageTitle = extractTitle(html, fallbackTitle);
  const subtitle = extractHeading(html, "h2");
  const title = compactWhitespace([pageTitle, subtitle].filter(Boolean).join(" - "));
  const bracket = extractBracketRegistration(title || pageTitle || fallbackTitle);

  return {
    stock_url: normalizeUrl(stockUrl),
    vansco_id: extractVanscoId(stockUrl),
    registration: bracket.registration,
    title: title || pageTitle || fallbackTitle || vehicleTitleFromUrl(stockUrl),
    image_url: extractImage(html),
    source_status: detectSourceStatus(bodyText),
    vehicle_type: detectVehicleCategory(`${title} ${bodyText}`, stockUrl),
    rejected_registration_candidates: bracket.rejected,
  };
}

export function normalizeCacheRow(row, actionRecord = null) {
  const workflowStatus = actionRecord?.workflow_status || "new";
  return {
    id: actionRecord?.id || `cache-${row.id || row.vansco_id || row.stock_url}`,
    cacheId: row.id,
    watchRecordId: actionRecord?.id || "",
    pipeline: actionRecord?.pipeline || "",
    vehicleKey: actionRecord?.vehicle_key || `vansco:${row.stock_url}`,
    title: row.title || vehicleTitleFromUrl(row.stock_url),
    registration: row.registration || "",
    imageUrl: row.image_url || "",
    stockUrl: row.stock_url || "",
    price: actionRecord?.price || "",
    mileage: actionRecord?.mileage || "",
    year: actionRecord?.year || "",
    vehicleCategory: row.vehicle_type || actionRecord?.vehicle_category || "unknown",
    sourceStatus: row.source_status || actionRecord?.source_status || "unknown",
    matchStatus: actionRecord?.match_status || "missing",
    workflowStatus,
    notes: actionRecord?.notes || "",
    firstSeenAt: row.first_seen_at || actionRecord?.first_seen_at || "",
    lastSeenAt: row.last_seen_in_url_list_at || actionRecord?.last_seen_at || "",
    lastCheckedAt: row.last_successfully_checked_at || row.last_attempted_at || actionRecord?.last_checked_at || row.updated_at || "",
    lastSuccessfullyCheckedAt: row.last_successfully_checked_at || "",
    lastAttemptedAt: row.last_attempted_at || "",
    lastError: row.last_error || "",
    failCount: row.fail_count || 0,
    attemptCount: row.attempt_count || 0,
    isCurrentlyOnVansco: row.is_currently_on_vansco !== false,
  };
}

export function normalizeActionRecord(row) {
  return {
    id: row.id,
    watchRecordId: row.id,
    pipeline: row.pipeline,
    vehicleKey: row.vehicle_key,
    title: row.title || "",
    registration: row.registration || "",
    imageUrl: row.image_url || "",
    stockUrl: row.stock_url || "",
    price: row.price || "",
    mileage: row.mileage || "",
    year: row.year || "",
    vehicleCategory: row.vehicle_category || "unknown",
    sourceStatus: row.source_status || "unknown",
    matchStatus: row.match_status || "missing",
    workflowStatus: row.workflow_status || "new",
    notes: row.notes || "",
    firstSeenAt: row.first_seen_at || "",
    lastSeenAt: row.last_seen_at || "",
    lastCheckedAt: row.last_checked_at || row.updated_at || "",
  };
}

export function cacheRowToActionPayload(pipeline, record, workflowStatus, notes) {
  const now = new Date().toISOString();
  const registration = normalizeRegistration(record.registration);
  const stockUrl = normalizeUrl(record.stockUrl || record.stock_url);
  return {
    pipeline,
    vehicle_key: registration ? `reg:${registration}` : `url:${stockUrl || record.cacheId || record.id}`,
    title: compactWhitespace(record.title) || vehicleTitleFromUrl(stockUrl),
    registration: registration || null,
    image_url: compactWhitespace(record.imageUrl || record.image_url) || null,
    stock_url: stockUrl || VANSCO_SOURCE_URL,
    price: compactWhitespace(record.price) || null,
    mileage: compactWhitespace(record.mileage) || null,
    year: compactWhitespace(record.year) || null,
    vehicle_category: compactWhitespace(record.vehicleCategory || record.vehicle_category || record.vehicle_type) || "unknown",
    source_status: compactWhitespace(record.sourceStatus || record.source_status) || "unknown",
    match_status: compactWhitespace(record.matchStatus || record.match_status) || "missing",
    workflow_status: workflowStatus || "new",
    notes: compactWhitespace(notes),
    first_seen_at: record.firstSeenAt || now,
    last_seen_at: now,
    last_checked_at: record.lastCheckedAt || record.last_successfully_checked_at || now,
    updated_at: now,
  };
}
