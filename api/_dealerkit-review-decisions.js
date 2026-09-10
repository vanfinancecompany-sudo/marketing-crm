import { normalizeRegistration } from "./_vansco-cache-utils.js";
import { DEALERKIT_PRODUCT_IMAGE_MARKERS } from "../lib/dealerKitProductImageState.js";

export const DEALERKIT_REVIEW_TABLE = "dealerkit_review_decisions";

export const DEALERKIT_REVIEW_STATUSES = Object.freeze([
  "needs_review",
  "reviewed",
  "held",
]);

export const DEALERKIT_FINANCE_CATEGORY_KEYS = Object.freeze([
  "all_vans",
  "small",
  "medium_mwb",
  "lwb_large",
  "crew",
  "nine_seater",
  "automatic",
  "electric",
  "pickup_4x4",
  "tipper_dropside_luton",
]);

const REVIEW_STATUS_SET = new Set(DEALERKIT_REVIEW_STATUSES);
const FINANCE_CATEGORY_SET = new Set(DEALERKIT_FINANCE_CATEGORY_KEYS);
const PRODUCT_IMAGE_MARKER_SET = new Set(Object.values(DEALERKIT_PRODUCT_IMAGE_MARKERS));

function clean(value, limit = 3000) {
  return String(value ?? "").trim().slice(0, limit);
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cleanIdArray(value, { max = 80, dedupe = true } = {}) {
  const items = (Array.isArray(value) ? value : []).map((item) => clean(item, 300)).filter(Boolean);
  return (dedupe ? Array.from(new Set(items)) : items).slice(0, max);
}

function hasProductImageMarkers(values = []) {
  return (Array.isArray(values) ? values : []).some((value) => PRODUCT_IMAGE_MARKER_SET.has(clean(value, 300)));
}

function cleanFinanceCategories(value, financeEnabled) {
  if (!financeEnabled) return [];
  const categories = Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => clean(item, 80))
    .filter((item) => FINANCE_CATEGORY_SET.has(item))));
  if (!categories.includes("all_vans")) categories.unshift("all_vans");
  return categories;
}

export function defaultDealerKitReviewDecision(vehicle = {}) {
  const imageIds = cleanIdArray((vehicle.images || []).map((image) => image?.id));
  const primaryImageId = clean(vehicle?.primaryImage?.id || vehicle?.images?.[0]?.id, 300) || null;
  return {
    persisted: false,
    supplierStockId: clean(vehicle?.supplierStockId, 300),
    registration: normalizeRegistration(vehicle?.registration || ""),
    reviewStatus: "needs_review",
    financeEnabled: true,
    financeCategories: ["all_vans"],
    rent2buyEnabled: false,
    rent2buyCategories: [],
    excludedImageIds: [],
    primaryImageId,
    imageOrderIds: imageIds,
    reviewedSourceUpdatedAt: null,
    notes: "",
    createdAt: null,
    updatedAt: null,
  };
}

export function rowToDealerKitReviewDecision(row = {}) {
  return {
    persisted: true,
    supplierStockId: clean(row.supplier_stock_id, 300),
    registration: normalizeRegistration(row.registration || ""),
    reviewStatus: REVIEW_STATUS_SET.has(row.review_status) ? row.review_status : "needs_review",
    financeEnabled: row.finance_enabled !== false,
    financeCategories: cleanFinanceCategories(row.finance_categories, row.finance_enabled !== false),
    rent2buyEnabled: Boolean(row.rent2buy_enabled),
    rent2buyCategories: cleanIdArray(row.rent2buy_categories, { max: 20 }),
    excludedImageIds: cleanIdArray(row.excluded_image_ids, { max: 200, dedupe: false }),
    primaryImageId: clean(row.primary_image_id, 300) || null,
    imageOrderIds: cleanIdArray(row.image_order_ids, { max: 200, dedupe: false }),
    reviewedSourceUpdatedAt: isoOrNull(row.reviewed_source_updated_at),
    notes: clean(row.notes, 2000),
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

export function normalizeDealerKitReviewInput(input = {}) {
  const supplierStockId = clean(input.supplierStockId, 300);
  const registration = normalizeRegistration(input.registration || "");
  if (!supplierStockId) throw new Error("DealerKit stock ID is required to save a review.");
  if (!registration) throw new Error("A valid vehicle registration is required to save a review.");

  const reviewStatus = clean(input.reviewStatus, 80) || "needs_review";
  if (!REVIEW_STATUS_SET.has(reviewStatus)) throw new Error("Review status is not allowed at this stage.");

  const financeEnabled = input.financeEnabled !== false;
  const rawExcludedImageIds = cleanIdArray(input.excludedImageIds, { max: 200, dedupe: false });
  const rawImageOrderIds = cleanIdArray(input.imageOrderIds, { max: 200, dedupe: false });
  const splitProductImageState = hasProductImageMarkers(rawExcludedImageIds) || hasProductImageMarkers(rawImageOrderIds);
  const excludedImageIds = splitProductImageState ? rawExcludedImageIds : Array.from(new Set(rawExcludedImageIds));
  const imageOrderIdsBase = splitProductImageState ? rawImageOrderIds : Array.from(new Set(rawImageOrderIds));
  const excludedSet = new Set(excludedImageIds);
  const requestedPrimary = clean(input.primaryImageId, 300);
  const primaryImageId = requestedPrimary && (splitProductImageState || !excludedSet.has(requestedPrimary)) ? requestedPrimary : null;
  const imageOrderIds = splitProductImageState
    ? imageOrderIdsBase
    : imageOrderIdsBase.filter((id) => !excludedSet.has(id));

  return {
    supplierStockId,
    registration,
    reviewStatus,
    financeEnabled,
    financeCategories: cleanFinanceCategories(input.financeCategories, financeEnabled),
    rent2buyEnabled: Boolean(input.rent2buyEnabled),
    rent2buyCategories: [],
    excludedImageIds,
    primaryImageId,
    imageOrderIds,
    reviewedSourceUpdatedAt: isoOrNull(input.reviewedSourceUpdatedAt),
    notes: clean(input.notes, 2000),
  };
}

function decisionToRow(decision) {
  return {
    supplier_stock_id: decision.supplierStockId,
    registration: decision.registration,
    review_status: decision.reviewStatus,
    finance_enabled: decision.financeEnabled,
    finance_categories: decision.financeCategories,
    rent2buy_enabled: decision.rent2buyEnabled,
    rent2buy_categories: decision.rent2buyCategories,
    excluded_image_ids: decision.excludedImageIds,
    primary_image_id: decision.primaryImageId,
    image_order_ids: decision.imageOrderIds,
    reviewed_source_updated_at: decision.reviewedSourceUpdatedAt,
    notes: decision.notes,
    updated_at: new Date().toISOString(),
  };
}

export async function loadDealerKitReviewDecision(supabase, supplierStockId) {
  const id = clean(supplierStockId, 300);
  if (!id) return null;
  const { data, error } = await supabase
    .from(DEALERKIT_REVIEW_TABLE)
    .select("*")
    .eq("supplier_stock_id", id)
    .limit(1);
  if (error) throw new Error(`DealerKit review state read failed: ${error.message || error}`);
  return data?.[0] ? rowToDealerKitReviewDecision(data[0]) : null;
}

export async function saveDealerKitReviewDecision(supabase, input) {
  const decision = normalizeDealerKitReviewInput(input);
  const { data, error } = await supabase
    .from(DEALERKIT_REVIEW_TABLE)
    .upsert(decisionToRow(decision), { onConflict: "supplier_stock_id" })
    .select("*")
    .single();
  if (error) throw new Error(`DealerKit review state save failed: ${error.message || error}`);
  return rowToDealerKitReviewDecision(data);
}
