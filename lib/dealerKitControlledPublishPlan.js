import { buildDealerKitWixCreatePlan } from "./dealerKitWixCreatePlan.js";
import { selectedDealerKitFinanceCollections } from "./dealerKitWixPublishPreview.js";
import { buildDealerKitRent2BuyWixPlan } from "./dealerKitRent2BuyWixPlan.js";
import { normalizeFinanceRegistration, parseRetailPrice } from "./vanscoWixPrice.js";

const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

function sameInstant(left, right) {
  if (!left || !right) return false;
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? a === b : clean(left) === clean(right);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function uniqueByCollection(targets = []) {
  const seen = new Set();
  return targets.filter((target) => {
    const id = clean(target.collectionId, 300);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function vfcDescription(vehicle = {}) {
  return clean(vehicle.description, 10000) || clean(vehicle.attentionGrabber, 1000) || clean(vehicle.title, 1000);
}

function baseSafetyBlockers(vehicle = {}, decision = {}) {
  const blockers = [];
  const registration = normalizeFinanceRegistration(vehicle.registration || decision.registration || "");
  const retail = parseRetailPrice(vehicle.retailPrice);
  const status = clean(vehicle.status || vehicle.sourceStatus, 100).toLowerCase().replace(/[\s-]+/g, "_");
  if (!vehicle.supplierStockId) blockers.push({ code: "missing_source_id", message: "DealerKit stock ID is missing." });
  if (!registration) blockers.push({ code: "missing_registration", message: "A valid registration is required." });
  if (!decision.persisted || decision.reviewStatus !== "reviewed") blockers.push({ code: "review_not_approved", message: "Save the vehicle as Reviewed before publishing." });
  if (!decision.financeEnabled && !decision.rent2buyEnabled) blockers.push({ code: "no_product_selected", message: "Choose Van Finance or Rent2Buy before publishing." });
  if (vehicle.sourceUpdatedAt && !sameInstant(decision.reviewedSourceUpdatedAt, vehicle.sourceUpdatedAt)) blockers.push({ code: "stale_review", message: "DealerKit changed after the saved review. Re-save the review first." });
  if (retail === null || retail < 1000 || retail > 100000) blockers.push({ code: "invalid_retail", message: "DealerKit retail price is missing or outside the safe publishing range." });
  if (status && !["available", "in_stock", "due_in"].includes(status)) blockers.push({ code: "source_status", message: `DealerKit status ${vehicle.sourceStatus || vehicle.status || "Unknown"} is not eligible for publishing.` });
  return blockers;
}

function publishedMatch(entry = {}) {
  const existing = Array.isArray(entry?.items) ? entry.items : [];
  return existing.length === 1 ? existing[0] : null;
}

function detailUpdateTarget(target, existingItem) {
  if (!target || !existingItem?.id) return target;
  return {
    ...target,
    operation: "update",
    itemId: clean(existingItem.id, 300),
    previousData: stableValue(existingItem.data || {}),
  };
}

export function buildControlledVfcTargets({ vehicle = {}, decision = {}, imageSets = {}, wixResults = [] } = {}) {
  const blockers = [];
  const selection = selectedDealerKitFinanceCollections(decision);
  const byCollection = new Map((wixResults || []).map((entry) => [entry?.collection?.id || entry?.collectionId, entry]));
  const images = imageSets.vanFinance || {};

  if (!images.ready || !images.mainUrl || !images.galleryUrls?.length) blockers.push({ code: "vfc_media_not_ready", message: "Van Finance main image and gallery must be READY in Wix Media before creation." });
  if (selection.unsupportedCategories?.length) blockers.push({ code: "vfc_category_unmapped", message: `Unsupported Van Finance categories: ${selection.unsupportedCategories.join(", ")}.` });

  for (const entry of wixResults || []) {
    const existing = Array.isArray(entry?.items) ? entry.items : [];
    const id = entry?.collection?.id || entry?.collectionId || "Van Finance collection";
    if (id === "VANFINANCEPAGES") {
      if (existing.length > 1) blockers.push({ code: "vfc_detail_ambiguous", message: `${id} contains ${existing.length} published detail rows for this registration. Resolve the duplicate detail pages before publishing.` });
      continue;
    }
    if (existing.length) {
      blockers.push({ code: existing.length > 1 ? "vfc_duplicate_existing" : "vfc_existing_anywhere", message: `${id} already contains ${existing.length} published listing row(s) for this registration. New-vehicle publishing is blocked.` });
    }
  }

  const targets = [];
  for (const collectionId of selection.collectionIds || []) {
    const entry = byCollection.get(collectionId) || {};
    const collection = entry.collection || { id: collectionId, kind: collectionId === "VANFINANCEPAGES" ? "detail" : "listing" };
    const create = buildDealerKitWixCreatePlan({ collection, vehicle, decision, selectedImages: { ids: imageSets.dealerKitImageIds || [], count: imageSets.dealerKitImageIds?.length || 0 } });
    for (const item of create.blockers || []) blockers.push({ code: `vfc_${item.code}`, message: `${collectionId}: ${item.message}` });
    const data = { ...(create.proposedFields || {}) };
    if (collectionId === "VANFINANCEPAGES") {
      data.mainImages = images.galleryUrls;
      data.descriptionLine = clean(vehicle.attentionGrabber, 1000) || clean(vehicle.title, 1000);
      data.vehicleDescriptionTextClick = vfcDescription(vehicle);
      data.imageCount = String(images.galleryUrls.length);
    } else data.picture = images.listingImageUrl;

    let target = { collectionId, kind: collectionId === "VANFINANCEPAGES" ? "detail" : "listing", operation: "create", data };
    if (collectionId === "VANFINANCEPAGES") {
      const existingDetail = publishedMatch(entry);
      if (existingDetail) target = detailUpdateTarget(target, existingDetail);
    }
    targets.push(target);
  }

  return {
    registration: normalizeFinanceRegistration(vehicle.registration || decision.registration || ""),
    targets: uniqueByCollection(targets),
    blockers,
    canPublish: blockers.length === 0 && targets.some((target) => target.collectionId === "VANFINANCE-ALLVANS") && targets.some((target) => target.collectionId === "VANFINANCEPAGES"),
  };
}

function controlledMode(decision, requestedMode) {
  if (requestedMode === "finance" || requestedMode === "rent2buy" || requestedMode === "both") return requestedMode;
  if (decision.financeEnabled && decision.rent2buyEnabled) return "both";
  return decision.rent2buyEnabled ? "rent2buy" : "finance";
}

export function buildControlledVehiclePublishPlan({ vehicle = {}, decision = {}, imageSets = {}, vfcWixResults = [], rent2buyWixResults = [], productMode } = {}) {
  const mode = controlledMode(decision, productMode);
  const effectiveDecision = {
    ...decision,
    financeEnabled: mode === "finance" || mode === "both",
    rent2buyEnabled: mode === "rent2buy" || mode === "both",
  };
  const registration = normalizeFinanceRegistration(vehicle.registration || decision.registration || "");
  const blockers = [...baseSafetyBlockers(vehicle, effectiveDecision)];
  const vfc = effectiveDecision.financeEnabled
    ? buildControlledVfcTargets({ vehicle, decision: effectiveDecision, imageSets, wixResults: vfcWixResults })
    : { enabled: false, registration, targets: [], blockers: [], canPublish: false };
  if (effectiveDecision.financeEnabled) blockers.push(...vfc.blockers);

  const rent2buy = buildDealerKitRent2BuyWixPlan({ vehicle, decision: effectiveDecision, imageSets });
  if (rent2buy.enabled) blockers.push(...rent2buy.blockers);

  const rent2buyTargets = (rent2buy.enabled ? rent2buy.targets : []).map((target) => ({ ...target }));
  for (const entry of effectiveDecision.rent2buyEnabled ? rent2buyWixResults || [] : []) {
    const existing = Array.isArray(entry?.items) ? entry.items : [];
    const id = entry?.collectionId || entry?.collection?.id || "Rent2Buy collection";
    if (id === "VANPAGES") {
      if (existing.length > 1) {
        blockers.push({ code: "rent2buy_detail_ambiguous", message: `${id} contains ${existing.length} published Rent2Buy detail rows for ${registration}. Resolve the duplicate detail pages before publishing.` });
      } else if (existing.length === 1) {
        const index = rent2buyTargets.findIndex((target) => target.collectionId === "VANPAGES");
        if (index >= 0) rent2buyTargets[index] = detailUpdateTarget(rent2buyTargets[index], existing[0]);
      }
      continue;
    }
    if (existing.length) {
      blockers.push({ code: existing.length > 1 ? "rent2buy_duplicate_existing" : "rent2buy_existing_anywhere", message: `${id} already contains ${existing.length} published Rent2Buy listing row(s) for ${registration}. New-vehicle publishing is blocked.` });
    }
  }

  const targets = [
    ...vfc.targets.map((target) => ({ ...target, product: "van_finance" })),
    ...rent2buyTargets.map((target) => ({ ...target, product: "rent2buy" })),
  ];

  return {
    version: 3,
    mode,
    registration,
    supplierStockId: clean(vehicle.supplierStockId, 300),
    sourceUpdatedAt: clean(vehicle.sourceUpdatedAt, 100) || null,
    reviewUpdatedAt: clean(decision.updatedAt, 100) || null,
    readOnly: true,
    newVehicleOnly: true,
    vfc,
    rent2buy: { ...rent2buy, targets: rent2buyTargets },
    imageSets,
    targets,
    blockers,
    canPublish: Boolean(
      (effectiveDecision.financeEnabled || effectiveDecision.rent2buyEnabled)
      && (!effectiveDecision.financeEnabled || vfc.canPublish)
      && (!effectiveDecision.rent2buyEnabled || (rent2buy.canPublish && rent2buyTargets.length >= 2))
      && blockers.length === 0
    ),
  };
}

export function buildControlledPublishConfirmation(plan = {}) {
  return {
    version: plan.version || 3,
    mode: plan.mode || null,
    registration: plan.registration,
    supplierStockId: plan.supplierStockId,
    sourceUpdatedAt: plan.sourceUpdatedAt,
    reviewUpdatedAt: plan.reviewUpdatedAt,
    targetPayloads: (plan.targets || [])
      .map((target) => ({
        product: clean(target.product, 80),
        collectionId: clean(target.collectionId, 300),
        kind: clean(target.kind, 80),
        operation: target.operation === "update" ? "update" : "create",
        itemId: target.operation === "update" ? clean(target.itemId, 300) : null,
        data: stableValue(target.data || {}),
      }))
      .sort((left, right) => `${left.product}:${left.collectionId}`.localeCompare(`${right.product}:${right.collectionId}`)),
    vfcMainImage: clean(plan.imageSets?.vanFinance?.mainUrl, 3000) || null,
    rent2buyMainImage: clean(plan.imageSets?.rent2buy?.mainUrl, 3000) || null,
    dealerKitImageIds: [...(plan.imageSets?.dealerKitImageIds || [])].sort(),
    rent2buyTerm: plan.rent2buy?.pricing?.termMonths || null,
    rent2buyMonthly: plan.rent2buy?.pricing?.monthly || null,
    rent2buyUpfront: plan.rent2buy?.pricing?.upfront || null,
  };
}

export function controlledPublishConfirmationMatches(confirmation, plan) {
  return Boolean(confirmation && JSON.stringify(confirmation) === JSON.stringify(buildControlledPublishConfirmation(plan)));
}
