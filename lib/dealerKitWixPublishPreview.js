import {
  VAN_FINANCE_WIX_COLLECTIONS,
  buildFinanceWixPricePatch,
  calculateFivePercentFlatMonthly,
  financeWixCurrentFields,
  normalizeFinanceRegistration,
  parseRetailPrice,
} from "./vanscoWixPrice.js";

export const DEALERKIT_FINANCE_CATEGORY_COLLECTIONS = Object.freeze({
  all_vans: "VANFINANCE-ALLVANS",
  small: "VANFINANCE-SMALLVANS",
  medium_mwb: "VANFINANCE-MWB",
  lwb_large: "VANFINANCE-LWBVANS",
  crew: "FINANCE-CREWVANS",
  automatic: "AUTOMATIC",
  electric: "VANFINANCE-ELECTRIC",
  pickup_4x4: "VANFINANCE-PICKUPS",
  tipper_dropside_luton: "VANFINANCE-TIPPERSDROPSIDEL",
});

export const DEALERKIT_UNMAPPED_FINANCE_CATEGORIES = Object.freeze(["nine_seater"]);

const collectionById = new Map(VAN_FINANCE_WIX_COLLECTIONS.map((collection) => [collection.id, collection]));
const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function sameInstant(left, right) {
  if (!left || !right) return false;
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? a === b : clean(left) === clean(right);
}

function blocker(code, message) {
  return { code, message };
}

function warning(code, message) {
  return { code, message };
}

export function selectedDealerKitFinanceCollections(decision = {}) {
  const categories = new Set(Array.isArray(decision.financeCategories) ? decision.financeCategories : []);
  if (decision.financeEnabled !== false) categories.add("all_vans");

  const unsupportedCategories = Array.from(categories).filter((key) => DEALERKIT_UNMAPPED_FINANCE_CATEGORIES.includes(key));
  const selectedIds = new Set(["VANFINANCEPAGES"]);
  for (const key of categories) {
    const collectionId = DEALERKIT_FINANCE_CATEGORY_COLLECTIONS[key];
    if (collectionId) selectedIds.add(collectionId);
  }

  return {
    categories: Array.from(categories),
    unsupportedCategories,
    collectionIds: VAN_FINANCE_WIX_COLLECTIONS.map((collection) => collection.id).filter((id) => selectedIds.has(id)),
  };
}

function selectedImages(vehicle = {}, decision = {}) {
  const images = Array.isArray(vehicle.images) ? vehicle.images : [];
  const imageById = new Map(images.map((image) => [clean(image?.id, 300), image]).filter(([id]) => id));
  const excluded = new Set((Array.isArray(decision.excludedImageIds) ? decision.excludedImageIds : []).map((id) => clean(id, 300)).filter(Boolean));
  const orderedIds = [];
  for (const rawId of [...(Array.isArray(decision.imageOrderIds) ? decision.imageOrderIds : []), ...imageById.keys()]) {
    const id = clean(rawId, 300);
    if (id && imageById.has(id) && !excluded.has(id) && !orderedIds.includes(id)) orderedIds.push(id);
  }
  const primaryImageId = clean(decision.primaryImageId, 300);
  return {
    count: orderedIds.length,
    ids: orderedIds,
    primaryImageId: primaryImageId || null,
    primaryImageUrl: primaryImageId && imageById.has(primaryImageId) && !excluded.has(primaryImageId)
      ? clean(imageById.get(primaryImageId)?.url, 3000)
      : null,
  };
}

export function buildDealerKitWixPublishPreview({ vehicle = {}, decision = {}, wixResults = [] } = {}) {
  const blockers = [];
  const warnings = [];
  const registration = normalizeFinanceRegistration(vehicle.registration || decision.registration || "");
  const retailPrice = parseRetailPrice(vehicle.retailPrice);
  const sourceStatus = clean(vehicle.status || vehicle.sourceStatus, 100).toLowerCase().replace(/[\s-]+/g, "_");
  const selection = selectedDealerKitFinanceCollections(decision);
  const images = selectedImages(vehicle, decision);

  if (!vehicle?.supplierStockId) blockers.push(blocker("missing_source_id", "DealerKit stock ID is missing."));
  if (!registration) blockers.push(blocker("missing_registration", "A valid registration is required before Wix publishing can be considered."));
  if (!decision?.persisted) blockers.push(blocker("review_not_saved", "Save the DealerKit review decisions before preparing a Wix publish."));
  if (decision?.reviewStatus === "held") blockers.push(blocker("review_held", "This vehicle is on Hold in the DealerKit review workspace."));
  else if (decision?.reviewStatus !== "reviewed") blockers.push(blocker("review_not_approved", "Mark the vehicle Reviewed before it can become publishable."));
  if (decision?.financeEnabled === false) blockers.push(blocker("finance_disabled", "Van Finance is disabled for this vehicle."));
  if (vehicle?.sourceUpdatedAt && !sameInstant(decision?.reviewedSourceUpdatedAt, vehicle.sourceUpdatedAt)) {
    blockers.push(blocker("stale_review", "DealerKit has changed since the saved review. Re-save the review against the current source record."));
  }
  if (retailPrice === null || retailPrice < 1000 || retailPrice > 100000) blockers.push(blocker("invalid_retail", "DealerKit retail price is missing or outside the permitted Van Finance range."));
  if (sourceStatus && !["available", "in_stock", "due_in"].includes(sourceStatus)) blockers.push(blocker("source_status", `DealerKit status ${vehicle.sourceStatus || vehicle.status || "Unknown"} is not eligible for publishing.`));
  if (selection.unsupportedCategories.length) blockers.push(blocker("unmapped_category", `No verified Wix collection mapping exists for: ${selection.unsupportedCategories.join(", ")}.`));
  if (!images.count) blockers.push(blocker("no_images", "No reviewed DealerKit images are selected for use."));
  if (!images.primaryImageId || !images.primaryImageUrl) blockers.push(blocker("primary_image", "Choose an included DealerKit image as the primary image."));

  const resultById = new Map(wixResults.map((entry) => [entry?.collection?.id || entry?.collectionId, entry]));
  const selectedIdSet = new Set(selection.collectionIds);
  const targets = [];

  for (const collectionId of selection.collectionIds) {
    const collection = collectionById.get(collectionId);
    const entry = resultById.get(collectionId) || {};
    const items = Array.isArray(entry.items) ? entry.items : [];
    let status = "missing";
    let current = null;
    let proposed = null;
    let itemId = null;

    if (items.length > 1) {
      status = "duplicate";
      blockers.push(blocker("duplicate_wix_target", `${collection?.label || collectionId} contains duplicate records for ${registration}.`));
    } else if (items.length === 1) {
      status = "matched";
      itemId = items[0].id || null;
      current = financeWixCurrentFields(collection, items[0]);
      const patch = retailPrice === null ? null : buildFinanceWixPricePatch(collection, items[0], retailPrice);
      proposed = patch?.fields || null;
      if (!patch) blockers.push(blocker("invalid_wix_patch", `Could not build a safe Wix proposal for ${collection?.label || collectionId}.`));
    } else {
      blockers.push(blocker("wix_create_not_verified", `${collection?.label || collectionId} has no existing ${registration} row. Full vehicle creation is still locked until that CMS schema is verified.`));
    }

    targets.push({
      collectionId,
      collectionLabel: collection?.label || collectionId,
      kind: collection?.kind || "listing",
      mandatory: collectionId === "VANFINANCE-ALLVANS" || collectionId === "VANFINANCEPAGES",
      status,
      itemId,
      current,
      proposed,
    });
  }

  for (const collection of VAN_FINANCE_WIX_COLLECTIONS) {
    if (selectedIdSet.has(collection.id)) continue;
    const items = Array.isArray(resultById.get(collection.id)?.items) ? resultById.get(collection.id).items : [];
    if (items.length) warnings.push(warning("existing_unselected_category", `${registration} already exists in ${collection.label}, but that category is not selected. Preview will not remove or unpublish it.`));
  }

  return {
    readOnly: true,
    registration,
    supplierStockId: clean(vehicle.supplierStockId, 300),
    sourceStatus: vehicle.sourceStatus || vehicle.status || null,
    retailPrice,
    monthlyPrice: retailPrice === null ? null : calculateFivePercentFlatMonthly(retailPrice),
    selectedCategories: selection.categories,
    images,
    targets,
    blockers,
    warnings,
    canPublishLater: blockers.length === 0,
  };
}
