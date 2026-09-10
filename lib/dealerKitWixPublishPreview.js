import {
  VAN_FINANCE_WIX_COLLECTIONS,
  buildFinanceWixPricePatch,
  calculateFivePercentFlatMonthly,
  financeWixCurrentFields,
  normalizeFinanceRegistration,
  parseRetailPrice,
} from "./vanscoWixPrice.js";
import { buildDealerKitWixCreatePlan } from "./dealerKitWixCreatePlan.js";

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
export const DEALERKIT_WIX_CONFIRMATION_VERSION = 1;

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

function sortedStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => clean(value, 500)).filter(Boolean))).sort();
}

function stableFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields || {}).sort(([left], [right]) => left.localeCompare(right)));
}

function confirmationTarget(target = {}) {
  return {
    collectionId: clean(target.collectionId, 300),
    itemId: clean(target.itemId, 500),
    current: stableFields(target.current),
    proposed: stableFields(target.proposed),
  };
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

export function buildDealerKitWixPublishConfirmation(preview = {}) {
  return {
    version: DEALERKIT_WIX_CONFIRMATION_VERSION,
    registration: normalizeFinanceRegistration(preview.registration || ""),
    supplierStockId: clean(preview.supplierStockId, 300),
    sourceUpdatedAt: clean(preview.sourceUpdatedAt, 100),
    reviewUpdatedAt: clean(preview.reviewUpdatedAt, 100),
    retailPrice: parseRetailPrice(preview.retailPrice),
    monthlyPrice: Number.isFinite(Number(preview.monthlyPrice)) ? Number(preview.monthlyPrice) : null,
    selectedCategories: sortedStrings(preview.selectedCategories),
    primaryImageId: clean(preview.images?.primaryImageId, 300) || null,
    selectedImageIds: sortedStrings(preview.images?.ids),
    targets: (Array.isArray(preview.writeTargets) ? preview.writeTargets : [])
      .map(confirmationTarget)
      .sort((left, right) => left.collectionId.localeCompare(right.collectionId)),
  };
}

export function dealerKitWixPublishConfirmationMatches(confirmation, preview) {
  if (!confirmation || typeof confirmation !== "object") return false;
  return JSON.stringify(confirmation) === JSON.stringify(buildDealerKitWixPublishConfirmation(preview));
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
    let createPlan = null;
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
      createPlan = buildDealerKitWixCreatePlan({ collection, vehicle, decision, selectedImages: images });
      blockers.push(blocker(
        "wix_create_locked",
        `${collection?.label || collectionId} has no existing ${registration} row. Its live CMS create schema is now verified and a read-only row plan is available, but new-record creation remains locked until reviewed media is imported to Wix and the vehicle copy is approved.`,
      ));
      for (const item of createPlan.blockers || []) {
        blockers.push(blocker(`wix_create_${item.code}`, `${collection?.label || collectionId}: ${item.message}`));
      }
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
      createPlan,
    });
  }

  const writeTargets = [];
  for (const collection of VAN_FINANCE_WIX_COLLECTIONS) {
    const items = Array.isArray(resultById.get(collection.id)?.items) ? resultById.get(collection.id).items : [];
    if (items.length > 1 && !selectedIdSet.has(collection.id)) {
      blockers.push(blocker("duplicate_existing_wix_row", `${collection.label} contains duplicate existing rows for ${registration}. Controlled updating is blocked until that is reconciled.`));
      continue;
    }
    if (items.length !== 1) continue;
    const patch = retailPrice === null ? null : buildFinanceWixPricePatch(collection, items[0], retailPrice);
    if (!patch) {
      blockers.push(blocker("invalid_existing_wix_patch", `Could not build a safe existing-row Wix proposal for ${collection.label}.`));
      continue;
    }
    writeTargets.push({
      collectionId: collection.id,
      collectionLabel: collection.label,
      kind: collection.kind,
      itemId: items[0].id || null,
      selectedCategory: selectedIdSet.has(collection.id),
      current: financeWixCurrentFields(collection, items[0]),
      proposed: patch.fields,
    });
    if (!selectedIdSet.has(collection.id)) {
      warnings.push(warning("existing_unselected_category", `${registration} already exists in ${collection.label}, but that category is not selected. The first controlled update will keep that category in place while synchronising its price fields.`));
    }
  }

  if (!writeTargets.some((target) => target.collectionId === "VANFINANCE-ALLVANS")) {
    blockers.push(blocker("missing_all_vans_existing_row", `${registration} is not present in Van Finance - All Vans. Controlled existing-row updating is blocked.`));
  }
  if (!writeTargets.some((target) => target.collectionId === "VANFINANCEPAGES")) {
    blockers.push(blocker("missing_detail_existing_row", `${registration} is not present in Van Finance Pages. Controlled existing-row updating is blocked.`));
  }

  const createTargets = targets
    .filter((target) => target.status === "missing" && target.createPlan)
    .map((target) => ({
      collectionId: target.collectionId,
      collectionLabel: target.collectionLabel,
      kind: target.kind,
      mandatory: target.mandatory,
      ...target.createPlan,
    }));

  const preview = {
    readOnly: true,
    registration,
    supplierStockId: clean(vehicle.supplierStockId, 300),
    sourceStatus: vehicle.sourceStatus || vehicle.status || null,
    sourceUpdatedAt: clean(vehicle.sourceUpdatedAt, 100) || null,
    reviewUpdatedAt: clean(decision.updatedAt, 100) || null,
    retailPrice,
    monthlyPrice: retailPrice === null ? null : calculateFivePercentFlatMonthly(retailPrice),
    selectedCategories: selection.categories,
    images,
    targets,
    writeTargets,
    createTargets,
    blockers,
    warnings,
    canPublishLater: blockers.length === 0,
  };
  preview.confirmation = buildDealerKitWixPublishConfirmation(preview);
  return preview;
}
