import { decodeDealerKitProductImageState } from "./dealerKitProductImageState.js";
import { VAN_FINANCE_RENT2BUY_WIX_SITE_ID } from "./dealerKitRent2BuyWixPlan.js";
import { normalizeDailyYouTubeImageUrl, normalizeDailyYouTubeRegistration } from "./youtubeDailyBatch.js";

const clean = (value) => String(value ?? "").trim();
const invalidStatuses = new Set(["FAILED", "ERROR", "UNVERIFIED"]);

function approvedHttpsImage(value) {
  const normalized = normalizeDailyYouTubeImageUrl(value);
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

// Read-only fallback, for standard Facebook IMAGE posts only.
// The stock advert's original branded primary is always supplied separately.
// Never infer an image from a different registration, product or Wix site.
export function reviewedFacebookSecondaryImages({
  productKey, registration, reviews = [], importedMedia = [],
} = {}) {
  if (!["vanFinance", "rent2buy"].includes(productKey)) return [];
  const wanted = normalizeDailyYouTubeRegistration(registration);
  if (!wanted) return [];
  const matches = reviews.filter((review) => normalizeDailyYouTubeRegistration(review?.registration) === wanted);
  if (matches.length !== 1) return [];
  const review = matches[0];
  if (clean(review.review_status).toLowerCase() !== "reviewed") return [];
  if (productKey === "rent2buy" ? review.rent2buy_enabled !== true : review.finance_enabled !== true) return [];
  const stockId = clean(review.supplier_stock_id);
  if (!stockId) return [];

  const byId = new Map();
  const conflictedIds = new Set();
  for (const image of importedMedia) {
    if (clean(image?.supplier_stock_id) !== stockId ||
      normalizeDailyYouTubeRegistration(image?.registration) !== wanted ||
      clean(image?.wix_site_id) !== VAN_FINANCE_RENT2BUY_WIX_SITE_ID ||
      invalidStatuses.has(clean(image?.operation_status).toUpperCase())) continue;
    const id = clean(image?.dealerkit_image_id);
    const url = approvedHttpsImage(image?.wix_url);
    if (!id || !url) continue;
    if (byId.has(id) && byId.get(id) !== url) conflictedIds.add(id);
    else byId.set(id, url);
  }
  for (const id of conflictedIds) byId.delete(id);
  if (!byId.size) return [];

  const state = decodeDealerKitProductImageState({
    imageOrderIds: review.image_order_ids,
    excludedImageIds: review.excluded_image_ids,
    primaryImageId: review.primary_image_id,
  }, [...byId.keys()]);
  const order = productKey === "rent2buy" ? state.rent2buy.includedOrderIds : state.finance.includedOrderIds;
  const chosen = [];
  for (const id of order) {
    const url = byId.get(id);
    if (url && !chosen.includes(url)) chosen.push(url);
    if (chosen.length >= 3) break;
  }
  return chosen;
}

export async function loadReviewedFacebookSecondaryImages(supabase, productKey, registration) {
  const wanted = normalizeDailyYouTubeRegistration(registration);
  if (!wanted || !["vanFinance", "rent2buy"].includes(productKey)) return [];
  const reviews = await supabase.from("dealerkit_review_decisions")
    .select("registration,supplier_stock_id,review_status,finance_enabled,rent2buy_enabled,image_order_ids,excluded_image_ids,primary_image_id")
    .eq("registration", wanted)
    .limit(3);
  if (reviews.error) throw new Error("Reviewed Facebook image decisions unavailable: " + reviews.error.message);
  if ((reviews.data || []).length !== 1) return [];
  const review = reviews.data[0];
  if (clean(review.review_status).toLowerCase() !== "reviewed") return [];
  if (productKey === "rent2buy" ? review.rent2buy_enabled !== true : review.finance_enabled !== true) return [];
  const stockId = clean(review.supplier_stock_id);
  if (!stockId) return [];

  const media = await supabase.from("dealerkit_wix_imported_media")
    .select("supplier_stock_id,registration,wix_site_id,dealerkit_image_id,wix_url,operation_status")
    .eq("supplier_stock_id", stockId)
    .eq("wix_site_id", VAN_FINANCE_RENT2BUY_WIX_SITE_ID)
    .limit(500);
  if (media.error) throw new Error("Imported Facebook gallery unavailable: " + media.error.message);
  return reviewedFacebookSecondaryImages({
    productKey, registration: wanted, reviews: reviews.data, importedMedia: media.data || [],
  });
}
