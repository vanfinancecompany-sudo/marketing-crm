import { decodeDealerKitProductImageState } from "./dealerKitProductImageState.js";
import { DAILY_YOUTUBE_MIN_IMAGES, normalizeDailyYouTubeImageUrl, normalizeDailyYouTubeRegistration } from "./youtubeDailyBatch.js";

const VALID_PRODUCT_KEYS = new Set(["vanFinance", "rent2buy"]);
const REJECTED_MEDIA_STATUSES = new Set(["FAILED", "ERROR", "UNVERIFIED"]);
const clean = (value) => String(value ?? "").trim();

function imageUrl(value) {
  const normalized = normalizeDailyYouTubeImageUrl(value);
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

// Only reviewed, product-enabled DealerKit decisions and matching imported media
// are eligible. Never use gallery URLs scraped from another vehicle or brand.
export function buildApprovedDailyReelFallback({
  productKey,
  activeVehicles = [],
  reviews = [],
  importedMedia = [],
} = {}) {
  if (!VALID_PRODUCT_KEYS.has(productKey)) throw new Error("Unrecognised reel product.");

  const stock = new Map();
  for (const vehicle of activeVehicles) {
    const registration = normalizeDailyYouTubeRegistration(vehicle?.registration);
    const picture = imageUrl(vehicle?.picture);
    if (!registration || !picture || stock.has(registration)) continue;
    stock.set(registration, { picture });
  }

  const decisions = new Map();
  const ambiguous = new Set();
  for (const decision of reviews) {
    const registration = normalizeDailyYouTubeRegistration(decision?.registration);
    if (!stock.has(registration)) continue;
    if (decisions.has(registration)) {
      ambiguous.add(registration);
      continue;
    }
    decisions.set(registration, decision);
  }

  const mediaByStockId = new Map();
  for (const media of importedMedia) {
    const stockId = clean(media?.supplier_stock_id);
    const registration = normalizeDailyYouTubeRegistration(media?.registration);
    const id = clean(media?.dealerkit_image_id);
    const url = imageUrl(media?.wix_url);
    const status = clean(media?.operation_status).toUpperCase();
    if (!stockId || !registration || !id || !url || REJECTED_MEDIA_STATUSES.has(status)) continue;
    const key = stockId + ":" + registration;
    if (!mediaByStockId.has(key)) mediaByStockId.set(key, []);
    mediaByStockId.get(key).push({ id, url });
  }

  const result = [];
  for (const [registration, decision] of decisions) {
    if (ambiguous.has(registration) || clean(decision?.review_status) !== "reviewed") continue;
    if (productKey === "rent2buy" ? decision?.rent2buy_enabled !== true : decision?.finance_enabled !== true) continue;
    const stockId = clean(decision?.supplier_stock_id);
    if (!stockId) continue;
    const source = mediaByStockId.get(stockId + ":" + registration) || [];
    if (!source.length) continue;

    const byId = new Map();
    const conflicts = new Set();
    for (const { id, url } of source) {
      if (byId.has(id) && byId.get(id) !== url) conflicts.add(id);
      else byId.set(id, url);
    }
    for (const id of conflicts) byId.delete(id);

    const state = decodeDealerKitProductImageState({
      imageOrderIds: decision.image_order_ids,
      excludedImageIds: decision.excluded_image_ids,
      primaryImageId: decision.primary_image_id,
    }, [...byId.keys()]);
    const allowedIds = productKey === "rent2buy" ? state.rent2buy.includedOrderIds : state.finance.includedOrderIds;
    const primary = stock.get(registration).picture;
    const urls = [primary];
    for (const id of allowedIds) {
      const url = byId.get(id);
      if (url && !urls.includes(url)) urls.push(url);
      if (urls.length >= DAILY_YOUTUBE_MIN_IMAGES) break;
    }
    if (urls.length < DAILY_YOUTUBE_MIN_IMAGES) continue;
    result.push({ registration, title: registration, images: urls });
  }
  return result;
}

// A Wix outage for one brand must never suppress candidates for the other.
export async function resolveDailyReelFeed({ key, wixFeed, fallbackFeed, logger = console } = {}) {
  if (!VALID_PRODUCT_KEYS.has(key)) throw new Error("Unrecognised reel product.");
  let failure = "";
  try {
    const feed = await wixFeed(key);
    if (Array.isArray(feed) && feed.length) return { items: feed, source: "wix", error: "" };
    failure = "Wix gallery feed returned no eligible vehicles.";
  } catch (error) {
    failure = String(error?.message || error);
  }

  try {
    const fallback = await fallbackFeed(key);
    if (Array.isArray(fallback) && fallback.length) {
      logger.warn?.("[youtube-daily-batch] Wix image feed unavailable; using reviewed DealerKit-imported media", {
        productKey: key,
        reason: failure,
        candidates: fallback.length,
      });
      return { items: fallback, source: "reviewed_imported_media", error: failure };
    }
    return { items: [], source: "unavailable", error: failure + " No eligible reviewed gallery fallback." };
  } catch (error) {
    return { items: [], source: "unavailable", error: failure + " Fallback failed: " + String(error?.message || error) };
  }
}
