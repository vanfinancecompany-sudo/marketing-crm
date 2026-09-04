import { extractVanscoId } from "./_vansco-cache-utils.js";

const DRAGON_IMAGE_HOST = "img.cdn.dragon2000.net";
const DRAGON_IMAGE_PATTERN = /(?:https?:)?\/\/img\.cdn\.dragon2000\.net\/[^\s"'<>\\)]+/gi;
const SIZE_SUFFIX_PATTERN = /-(?:thumb|thumbnail|small|medium|large|xlarge|original)(?=\.(?:jpe?g|png|webp)$)/i;

function normalizeEscapedHtml(value) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");
}

function normalizeCandidateUrl(value) {
  const text = String(value || "")
    .replace(/[\],};]+$/g, "")
    .trim();
  if (!text) return "";

  const withProtocol = text.startsWith("//") ? `https:${text}` : text;
  try {
    const url = new URL(withProtocol);
    if (url.hostname.toLowerCase() !== DRAGON_IMAGE_HOST) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function stockIdFromImageUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/U(\d{3,8})\//i);
    return match?.[1] ? `u${match[1]}`.toLowerCase() : "";
  } catch {
    return "";
  }
}

function canonicalImageKey(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(SIZE_SUFFIX_PATTERN, "");
    return url.toString().toLowerCase();
  } catch {
    return String(value || "").toLowerCase();
  }
}

export function extractVanscoVehicleImageUrls(html, stockUrl = "") {
  const source = normalizeEscapedHtml(html);
  const expectedStockId = extractVanscoId(stockUrl);
  const seen = new Set();
  const images = [];

  for (const rawMatch of source.match(DRAGON_IMAGE_PATTERN) || []) {
    const imageUrl = normalizeCandidateUrl(rawMatch);
    if (!imageUrl) continue;

    const imageStockId = stockIdFromImageUrl(imageUrl);
    if (expectedStockId && imageStockId && imageStockId !== expectedStockId) continue;
    if (expectedStockId && !imageStockId) continue;

    const key = canonicalImageKey(imageUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    images.push(imageUrl);
  }

  return images;
}

export function countVanscoVehicleImages(html, stockUrl = "") {
  return extractVanscoVehicleImageUrls(html, stockUrl).length;
}
