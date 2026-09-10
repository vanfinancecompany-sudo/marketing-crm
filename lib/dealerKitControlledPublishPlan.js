import { buildDealerKitWixCreatePlan } from "./dealerKitWixCreatePlan.js";
import { selectedDealerKitFinanceCollections } from "./dealerKitWixPublishPreview.js";
import { buildDealerKitRent2BuyWixPlan } from "./dealerKitRent2BuyWixPlan.js";
import { normalizeFinanceRegistration } from "./vanscoWixPrice.js";

const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

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

export function buildControlledVfcTargets({ vehicle = {}, decision = {}, imageSets = {}, wixResults = [] } = {}) {
  const blockers = [];
  const selection = selectedDealerKitFinanceCollections(decision);
  const byCollection = new Map((wixResults || []).map((entry) => [entry?.collection?.id || entry?.collectionId, entry]));
  const images = imageSets.vanFinance || {};

  if (!images.ready || !images.mainUrl || !images.galleryUrls?.length) {
    blockers.push({ code: "vfc_media_not_ready", message: "Van Finance main image and gallery must be READY in Wix Media before creation." });
  }
  if (selection.unsupportedCategories?.length) {
    blockers.push({ code: "vfc_category_unmapped", message: `Unsupported Van Finance categories: ${selection.unsupportedCategories.join(", ")}.` });
  }

  const targets = [];
  for (const collectionId of selection.collectionIds || []) {
    const entry = byCollection.get(collectionId) || {};
    const existing = Array.isArray(entry.items) ? entry.items : [];
    if (existing.length) {
      blockers.push({
        code: existing.length > 1 ? "vfc_duplicate_existing" : "vfc_partial_existing",
        message: `${collectionId} already contains ${existing.length} row(s) for this registration. New-vehicle publishing is blocked rather than overwriting a partial live set.`,
      });
      continue;
    }

    const collection = entry.collection || { id: collectionId, kind: collectionId === "VANFINANCEPAGES" ? "detail" : "listing" };
    const create = buildDealerKitWixCreatePlan({
      collection,
      vehicle,
      decision,
      selectedImages: { ids: imageSets.dealerKitImageIds || [], count: imageSets.dealerKitImageIds?.length || 0 },
    });
    for (const item of create.blockers || []) blockers.push({ code: `vfc_${item.code}`, message: `${collectionId}: ${item.message}` });
    const data = { ...(create.proposedFields || {}) };
    if (collectionId === "VANFINANCEPAGES") {
      data.mainImages = images.galleryUrls;
      data.descriptionLine = clean(vehicle.attentionGrabber, 1000) || clean(vehicle.title, 1000);
      data.vehicleDescriptionTextClick = vfcDescription(vehicle);
      data.imageCount = String(images.galleryUrls.length);
    } else {
      data.picture = images.listingImageUrl;
    }
    targets.push({ collectionId, kind: collectionId === "VANFINANCEPAGES" ? "detail" : "listing", data });
  }

  return {
    registration: normalizeFinanceRegistration(vehicle.registration || decision.registration || ""),
    targets: uniqueByCollection(targets),
    blockers,
    canPublish: blockers.length === 0 && targets.some((target) => target.collectionId === "VANFINANCE-ALLVANS") && targets.some((target) => target.collectionId === "VANFINANCEPAGES"),
  };
}

export function buildControlledVehiclePublishPlan({
  vehicle = {},
  decision = {},
  imageSets = {},
  vfcWixResults = [],
  rent2buyWixResults = [],
} = {}) {
  const registration = normalizeFinanceRegistration(vehicle.registration || decision.registration || "");
  const blockers = [];
  const vfc = buildControlledVfcTargets({ vehicle, decision, imageSets, wixResults: vfcWixResults });
  blockers.push(...vfc.blockers);

  const rent2buy = buildDealerKitRent2BuyWixPlan({ vehicle, decision, imageSets });
  if (rent2buy.enabled) {
    blockers.push(...rent2buy.blockers);
    const byCollection = new Map((rent2buyWixResults || []).map((entry) => [entry?.collectionId || entry?.collection?.id, entry]));
    for (const target of rent2buy.targets || []) {
      const existing = Array.isArray(byCollection.get(target.collectionId)?.items) ? byCollection.get(target.collectionId).items : [];
      if (existing.length) {
        blockers.push({
          code: existing.length > 1 ? "rent2buy_duplicate_existing" : "rent2buy_partial_existing",
          message: `${target.collectionId} already contains ${existing.length} Rent2Buy row(s) for ${registration}. New-vehicle publishing is blocked.`,
        });
      }
    }
  }

  const targets = [
    ...vfc.targets.map((target) => ({ ...target, product: "van_finance" })),
    ...(rent2buy.enabled ? rent2buy.targets.map((target) => ({ ...target, product: "rent2buy" })) : []),
  ];

  return {
    version: 1,
    registration,
    supplierStockId: clean(vehicle.supplierStockId, 300),
    sourceUpdatedAt: clean(vehicle.sourceUpdatedAt, 100) || null,
    reviewUpdatedAt: clean(decision.updatedAt, 100) || null,
    readOnly: true,
    newVehicleOnly: true,
    vfc,
    rent2buy,
    imageSets,
    targets,
    blockers,
    canPublish: Boolean(vfc.canPublish && (!rent2buy.enabled || rent2buy.canPublish) && blockers.length === 0),
  };
}

export function buildControlledPublishConfirmation(plan = {}) {
  return {
    version: plan.version || 1,
    registration: plan.registration,
    supplierStockId: plan.supplierStockId,
    sourceUpdatedAt: plan.sourceUpdatedAt,
    reviewUpdatedAt: plan.reviewUpdatedAt,
    targetCollections: (plan.targets || []).map((target) => `${target.product}:${target.collectionId}`).sort(),
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
