import { buildDealerKitWixCreatePlan } from "./dealerKitWixCreatePlan.js";
import { selectedDealerKitFinanceCollections } from "./dealerKitWixPublishPreview.js";
import { buildDealerKitRent2BuyWixPlan, rent2BuyTargetForSite } from "./dealerKitRent2BuyWixPlan.js";
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

// VFC_CREATE_OR_UPDATE_RECONCILE: all DealerKit product lanes reuse exact Wix
// identities where possible. Finance and Rent2Buy both reconcile create/update/
// restore/draft operations from the fresh controlled plan.
function existingItems(entry = {}) {
  return Array.isArray(entry?.items) ? entry.items : [];
}

export function wixItemPublishStatus(item = {}) {
  return clean(item?.data?._publishStatus || item?._publishStatus || "", 80).toUpperCase();
}

function existingUpdateTarget(target, existingItem) {
  if (!target || !existingItem?.id) return target;
  const publishStatus = wixItemPublishStatus(existingItem);
  return {
    ...target,
    operation: "update",
    itemId: clean(existingItem.id, 300),
    previousData: stableValue(existingItem.data || {}),
    currentPublishStatus: publishStatus || null,
    desiredPublishStatus: "PUBLISHED",
    publishStatusOperation: publishStatus && publishStatus !== "PUBLISHED" ? "publish" : null,
  };
}

function obsoleteDraftTarget(collectionId, collection, existingItem) {
  const publishStatus = wixItemPublishStatus(existingItem);
  if (publishStatus === "DRAFT") return null;
  return {
    collectionId,
    kind: collection?.kind || "listing",
    operation: "draft",
    itemId: clean(existingItem?.id, 300),
    data: {},
    currentPublishStatus: publishStatus || "PUBLISHED",
    desiredPublishStatus: "DRAFT",
    publishStatusOperation: "draft",
  };
}

function mediaUpdateTarget(target, existingItem, data) {
  return {
    ...target,
    operation: "update",
    itemId: clean(existingItem?.id, 300),
    previousData: stableValue(existingItem?.data || {}),
    data: stableValue(data || {}),
  };
}

export function buildControlledVfcTargets({ vehicle = {}, decision = {}, imageSets = {}, wixResults = [] } = {}) {
  const blockers = [];
  const selection = selectedDealerKitFinanceCollections(decision);
  const byCollection = new Map((wixResults || []).map((entry) => [entry?.collection?.id || entry?.collectionId, entry]));
  const images = imageSets.vanFinance || {};

  if (!images.ready || !images.mainUrl || !images.galleryUrls?.length) blockers.push({ code: "vfc_media_not_ready", message: "Van Finance primary image is not READY in Wix Media." });
  if (selection.unsupportedCategories?.length) blockers.push({ code: "vfc_category_unmapped", message: `Unsupported Van Finance categories: ${selection.unsupportedCategories.join(", ")}.` });

  const selectedIds = new Set(selection.collectionIds || []);
  for (const entry of wixResults || []) {
    const existing = existingItems(entry);
    const id = entry?.collection?.id || entry?.collectionId || "Van Finance collection";
    if (existing.length > 1) blockers.push({ code: "vfc_duplicate_existing", message: `${id} contains ${existing.length} rows for this registration. Resolve the duplicate manually before publishing.` });
    if (existing.length === 1 && !existing[0]?.id) blockers.push({ code: "vfc_existing_identity_missing", message: `${id} has an existing row without a usable Wix item ID.` });
  }

  const targets = [];
  for (const collectionId of selection.collectionIds || []) {
    const id = collectionId;
    const entry = byCollection.get(collectionId) || {};
    const collection = entry.collection || { id: collectionId, kind: id === "VANFINANCEPAGES" ? "detail" : "listing" };
    const create = buildDealerKitWixCreatePlan({ collection, vehicle, decision, selectedImages: { ids: imageSets.dealerKitImageIds || [], count: imageSets.dealerKitImageIds?.length || 0 } });
    for (const item of create.blockers || []) blockers.push({ code: `vfc_${item.code}`, message: `${collectionId}: ${item.message}` });
    const data = { ...(create.proposedFields || {}) };
    if (id === "VANFINANCEPAGES") {
      data.mainImages = images.galleryUrls;
      data.descriptionLine = clean(vehicle.attentionGrabber, 1000) || clean(vehicle.title, 1000);
      data.vehicleDescriptionTextClick = vfcDescription(vehicle);
      data.imageCount = String(images.galleryUrls.length);
    } else data.picture = images.listingImageUrl;

    const existing = existingItems(entry);
    let target = {
      collectionId,
      kind: id === "VANFINANCEPAGES" ? "detail" : "listing",
      operation: "create",
      data,
      desiredPublishStatus: "PUBLISHED",
      publishStatusOperation: "publish",
    };
    if (existing.length === 1) target = existingUpdateTarget(target, existing[0]);
    targets.push(target);
  }

  for (const entry of wixResults || []) {
    const collectionId = entry?.collection?.id || entry?.collectionId || "";
    if (!collectionId || collectionId === "VANFINANCEPAGES" || selectedIds.has(collectionId)) continue;
    const existing = existingItems(entry);
    if (existing.length !== 1 || !existing[0]?.id) continue;
    const draftTarget = obsoleteDraftTarget(collectionId, entry.collection || { id: collectionId, kind: "listing" }, existing[0]);
    if (draftTarget) targets.push(draftTarget);
  }

  const writeTargets = targets.filter((target) => target.operation !== "draft");
  const hasExistingTargets = targets.some((target) => target.operation === "update" || target.operation === "draft");

  return {
    registration: normalizeFinanceRegistration(vehicle.registration || decision.registration || ""),
    targets: uniqueByCollection(targets),
    blockers,
    writeIntent: hasExistingTargets ? "update_existing_vehicle" : "create_new_vehicle",
    canPublish: blockers.length === 0 && writeTargets.some((target) => target.collectionId === "VANFINANCE-ALLVANS") && writeTargets.some((target) => target.collectionId === "VANFINANCEPAGES"),
  };
}

function controlledMode(decision, requestedMode) {
  if (requestedMode === "finance" || requestedMode === "rent2buy" || requestedMode === "both") return requestedMode;
  if (decision.financeEnabled && decision.rent2buyEnabled) return "both";
  return decision.rent2buyEnabled ? "rent2buy" : "finance";
}

function normalizedRent2BuySites(sites = []) {
  const normalized = (Array.isArray(sites) ? sites : [])
    .map((site) => ({
      siteId: clean(site?.siteId || site?.id, 500),
      siteLabel: clean(site?.siteLabel || site?.label, 200),
      siteRole: clean(site?.siteRole || site?.role, 80),
    }))
    .filter((site) => site.siteId);
  return normalized.length ? normalized : [{ siteId: "", siteLabel: "Rent2Buy Wix", siteRole: "primary" }];
}

function resultBelongsToSite(entry, site, siteCount) {
  const entrySiteId = clean(entry?.siteId, 500);
  if (entrySiteId) return entrySiteId === site.siteId;
  return siteCount === 1;
}

export function buildControlledVehiclePublishPlan({ vehicle = {}, decision = {}, imageSets = {}, vfcWixResults = [], rent2buyWixResults = [], rent2buySites = [], productMode } = {}) {
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

  const sites = normalizedRent2BuySites(rent2buySites);
  const rent2buyTargets = [];
  if (rent2buy.enabled) {
    for (const site of sites) {
      const siteLabel = site.siteLabel || site.siteId || "Rent2Buy Wix";
      const siteTargets = (rent2buy.targets || []).map((target) => rent2BuyTargetForSite(target, site, rent2buy.pricing));
      const siteResults = (rent2buyWixResults || []).filter((entry) => resultBelongsToSite(entry, site, sites.length));
      const resultByCollection = new Map(siteResults.map((entry) => [entry?.collectionId || entry?.collection?.id, entry]));
      const selectedCollectionIds = new Set(siteTargets.map((target) => clean(target.collectionId, 300)).filter(Boolean));

      for (const entry of siteResults) {
        const id = entry?.collectionId || entry?.collection?.id || "Rent2Buy collection";
        const items = existingItems(entry);
        if (items.length > 1) {
          blockers.push({ code: "rent2buy_existing_ambiguous", message: `${siteLabel} / ${id} contains ${items.length} rows for ${registration}. Resolve the duplicate before reconciliation.` });
        } else if (items.length === 1 && !items[0]?.id) {
          blockers.push({ code: "rent2buy_existing_identity_missing", message: `${siteLabel} / ${id} has an existing row without a usable Wix item ID.` });
        }
      }

      for (const plannedTarget of siteTargets) {
        const id = clean(plannedTarget.collectionId, 300);
        const entry = resultByCollection.get(id) || {};
        const items = existingItems(entry);
        let target = {
          ...plannedTarget,
          operation: "create",
          desiredPublishStatus: "PUBLISHED",
          publishStatusOperation: "publish",
        };
        if (items.length === 1) target = existingUpdateTarget(target, items[0]);
        rent2buyTargets.push(target);
      }

      for (const entry of siteResults) {
        const id = clean(entry?.collectionId || entry?.collection?.id, 300);
        if (!id || id === "VANPAGES" || selectedCollectionIds.has(id)) continue;
        const items = existingItems(entry);
        if (items.length !== 1 || !items[0]?.id) continue;
        const publishStatus = wixItemPublishStatus(items[0]);
        if (publishStatus === "DRAFT") continue;
        rent2buyTargets.push({
          collectionId: id,
          kind: entry?.collection?.kind || "listing",
          operation: "draft",
          itemId: clean(items[0].id, 300),
          data: {},
          siteId: site.siteId || null,
          siteLabel: site.siteLabel || null,
          siteRole: site.siteRole || null,
          currentPublishStatus: publishStatus || "PUBLISHED",
          desiredPublishStatus: "DRAFT",
          publishStatusOperation: "draft",
        });
      }

      const matchingSiteTargets = rent2buyTargets.filter((target) => clean(target.siteId, 500) === site.siteId || (sites.length === 1 && !site.siteId));
      if (!matchingSiteTargets.some((target) => target.collectionId === "ALLRENT2BUYVANS" && target.operation !== "draft")) {
        blockers.push({ code: "rent2buy_reconcile_master_missing", message: `${siteLabel} / ALLRENT2BUYVANS could not be safely prepared for ${registration}.` });
      }
      if (!matchingSiteTargets.some((target) => target.collectionId === "VANPAGES" && target.operation !== "draft")) {
        blockers.push({ code: "rent2buy_reconcile_detail_missing", message: `${siteLabel} / VANPAGES could not be safely prepared for ${registration}.` });
      }
    }
  }

  const targets = [
    ...vfc.targets.map((target) => ({ ...target, product: "van_finance" })),
    ...rent2buyTargets.map((target) => ({ ...target, product: "rent2buy" })),
  ];
  const everyRent2BuySiteComplete = !effectiveDecision.rent2buyEnabled || sites.every((site) => {
    const matching = rent2buyTargets.filter((target) => clean(target.siteId, 500) === site.siteId || (sites.length === 1 && !site.siteId));
    return matching.some((target) => target.collectionId === "ALLRENT2BUYVANS") && matching.some((target) => target.collectionId === "VANPAGES");
  });

  const createTargets = targets.filter((target) => target.operation === "create");
  const hasUpdateTargets = targets.some((target) => target.operation === "update");
  const hasDraftTargets = targets.some((target) => target.operation === "draft");
  const writeIntent = hasUpdateTargets || hasDraftTargets
    ? "update_existing_vehicle"
    : "create_new_vehicle";

  return {
    version: 6,
    mode,
    registration,
    supplierStockId: clean(vehicle.supplierStockId, 300),
    sourceUpdatedAt: clean(vehicle.sourceUpdatedAt, 100) || null,
    reviewUpdatedAt: clean(decision.updatedAt, 100) || null,
    readOnly: true,
    newVehicleOnly: writeIntent === "create_new_vehicle",
    writeIntent,
    vfc,
    rent2buy: { ...rent2buy, sites, targets: rent2buyTargets },
    imageSets,
    targets,
    blockers,
    canPublish: Boolean(
      (effectiveDecision.financeEnabled || effectiveDecision.rent2buyEnabled)
      && (!effectiveDecision.financeEnabled || vfc.canPublish)
      && (!effectiveDecision.rent2buyEnabled || (rent2buy.canPublish && rent2buyTargets.length >= 2 && everyRent2BuySiteComplete))
      && blockers.length === 0
    ),
  };
}

export function buildControlledPublishConfirmation(plan = {}) {
  return {
    version: plan.version || 6,
    mode: plan.mode || null,
    writeIntent: plan.writeIntent || "create_new_vehicle",
    registration: plan.registration,
    supplierStockId: plan.supplierStockId,
    sourceUpdatedAt: plan.sourceUpdatedAt,
    reviewUpdatedAt: plan.reviewUpdatedAt,
    targetPayloads: (plan.targets || [])
      .map((target) => ({
        product: clean(target.product, 80),
        siteId: clean(target.siteId, 500) || null,
        siteRole: clean(target.siteRole, 80) || null,
        collectionId: clean(target.collectionId, 300),
        kind: clean(target.kind, 80),
        operation: ["create", "update", "draft"].includes(target.operation) ? target.operation : "create",
        itemId: target.operation === "create" ? null : clean(target.itemId, 300),
        currentPublishStatus: clean(target.currentPublishStatus, 80) || null,
        desiredPublishStatus: clean(target.desiredPublishStatus, 80) || null,
        publishStatusOperation: clean(target.publishStatusOperation, 80) || null,
        data: stableValue(target.data || {}),
      }))
      .sort((left, right) => `${left.product}:${left.siteId || ""}:${left.collectionId}`.localeCompare(`${right.product}:${right.siteId || ""}:${right.collectionId}`)),
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
