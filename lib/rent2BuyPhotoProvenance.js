import { decodeDealerKitProductImageState } from "./dealerKitProductImageState.js";
import { normalizeFinanceRegistration } from "./vanscoWixPrice.js";
import { DEALERKIT_IMPORTED_MEDIA_TABLE } from "./dealerKitWixVehicleMedia.js";
import { VAN_FINANCE_RENT2BUY_WIX_SITE_ID } from "./dealerKitRent2BuyWixPlan.js";

const REVIEW_TABLE = "dealerkit_review_decisions";
const clean = (value, limit = 3000) => String(value ?? "").trim().slice(0, limit);

function normalizedRegistrations(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeFinanceRegistration(value || ""))
      .filter(Boolean),
  ));
}

function usableImportedRow(row = {}) {
  const dealerKitImageId = clean(row.dealerkit_image_id, 300);
  const wixUrl = clean(row.wix_url, 3000);
  const status = clean(row.operation_status, 80).toUpperCase();
  return Boolean(
    dealerKitImageId &&
    wixUrl &&
    !["FAILED", "ERROR", "UNVERIFIED"].includes(status)
  );
}

export async function loadRent2BuyPhotoProvenanceMap(supabase, registrations = []) {
  const wanted = normalizedRegistrations(registrations);
  const result = new Map(wanted.map((registration) => [registration, []]));
  if (!wanted.length) return result;

  const reviews = await supabase
    .from(REVIEW_TABLE)
    .select("registration,supplier_stock_id,image_order_ids,excluded_image_ids,primary_image_id")
    .in("registration", wanted)
    .limit(Math.max(1000, wanted.length * 2));
  if (reviews.error) throw new Error(`Rent2Buy photo provenance review read failed: ${reviews.error.message || reviews.error}`);

  const uniqueReviews = new Map();
  const ambiguous = new Set();
  for (const row of reviews.data || []) {
    const registration = normalizeFinanceRegistration(row?.registration || "");
    if (!registration || !wanted.includes(registration)) continue;
    if (uniqueReviews.has(registration)) {
      ambiguous.add(registration);
      continue;
    }
    uniqueReviews.set(registration, row);
  }
  for (const registration of ambiguous) uniqueReviews.delete(registration);

  const stockIds = Array.from(new Set(
    Array.from(uniqueReviews.values())
      .map((row) => clean(row?.supplier_stock_id, 300))
      .filter(Boolean),
  ));
  if (!stockIds.length) return result;

  const imported = await supabase
    .from(DEALERKIT_IMPORTED_MEDIA_TABLE)
    .select("supplier_stock_id,dealerkit_image_id,wix_site_id,wix_url,operation_status")
    .in("supplier_stock_id", stockIds)
    .eq("wix_site_id", VAN_FINANCE_RENT2BUY_WIX_SITE_ID)
    .limit(Math.max(5000, stockIds.length * 100));
  if (imported.error) throw new Error(`Rent2Buy photo provenance media read failed: ${imported.error.message || imported.error}`);

  const rowsByStockId = new Map();
  for (const row of imported.data || []) {
    if (!usableImportedRow(row)) continue;
    const stockId = clean(row?.supplier_stock_id, 300);
    if (!rowsByStockId.has(stockId)) rowsByStockId.set(stockId, []);
    rowsByStockId.get(stockId).push(row);
  }

  for (const [registration, review] of uniqueReviews.entries()) {
    const stockId = clean(review?.supplier_stock_id, 300);
    const rows = rowsByStockId.get(stockId) || [];
    if (!stockId || !rows.length) continue;

    const sourceIds = Array.from(new Set(rows.map((row) => clean(row?.dealerkit_image_id, 300)).filter(Boolean)));
    const state = decodeDealerKitProductImageState({
      imageOrderIds: Array.isArray(review?.image_order_ids) ? review.image_order_ids : [],
      excludedImageIds: Array.isArray(review?.excluded_image_ids) ? review.excluded_image_ids : [],
      primaryImageId: clean(review?.primary_image_id, 300) || null,
    }, sourceIds);
    const selected = new Set(state.rent2buy.includedOrderIds);
    const urls = [];
    for (const row of rows) {
      if (!selected.has(clean(row?.dealerkit_image_id, 300))) continue;
      const url = clean(row?.wix_url, 3000);
      if (url && !urls.includes(url)) urls.push(url);
    }
    result.set(registration, urls);
  }

  return result;
}
