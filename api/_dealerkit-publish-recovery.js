import { createHash } from "node:crypto";
import { ControlledPublishError, controlledWixRequest, queryControlledRegistrationItems } from "./_dealerkit-controlled-publish-state.js";
import { currentActiveRent2BuyManualSpecial } from "../lib/rent2BuyCurrentManualSpecial.mjs";
import { selectedDealerKitFinanceCollections } from "../lib/dealerKitWixPublishPreview.js";
import { RENT2BUY_CATEGORY_COLLECTIONS } from "../lib/dealerKitRent2BuyPlan.js";
import { wixItemPublishStatus } from "../lib/dealerKitControlledPublishPlan.js";
import { retryTemporaryPublishOperation, samePublishValue, stablePublishValue, vehicleRecordFields } from "../lib/dealerKitPublishRecovery.js";

const TABLE = "dealerkit_publish_recovery_audit";
const productLabels = { finance: "Van Finance Company", rent2buy: "Rent2Buy Vans", cars: "Cars" };
const historicPriceFields = new Set(["price", "priceVat", "salePrice", "monthlyPayment", "weeklyPayment", "initialRental2250Vat", "initialRental2385Vat"]);
const historicPhotoFields = new Set(["mainImages", "mediaGallery", "picture", "image", "imageCount", "numberOfImages", "addPicture", "additonalPicture"]);
const duplicateCodes = new Set(["vfc_duplicate_existing", "rent2buy_existing_ambiguous", "car_listing_ambiguous", "car_detail_ambiguous"]);
const hash = value => createHash("sha256").update(JSON.stringify(stablePublishValue(value))).digest("hex");

function scopedCollections(state, product) {
  if (product === "cars") return [
    { collectionId: "CARFINANCE", items: state.carListingRows },
    { collectionId: "CARPAGES", items: state.carDetailRows },
  ].map(entry => ({ ...entry, configuration: state.configuration, selected: true }));

  if (product === "finance") {
    const selected = selectedDealerKitFinanceCollections(state.decision).collectionIds;
    return state.vfcWixResults.map(entry => ({
      ...entry, configuration: state.configuration, selected: selected.includes(entry.collectionId),
    }));
  }

  const selected = ["VANPAGES", ...(state.plan.rent2buy?.categories || []).map(category => RENT2BUY_CATEGORY_COLLECTIONS[category])];
  return state.rent2buyWixResults.map(entry => ({
    ...entry, configuration: state.configurationsBySiteId[entry.siteId], selected: selected.includes(entry.collectionId),
  }));
}

function stockIsAvailable(state) {
  const vehicle = state.vehicle || {};
  const statuses = [vehicle.status || vehicle.sourceStatus, vehicle.availability].filter(Boolean)
    .map(status => String(status).trim().toLowerCase().replace(/[\s-]+/g, "_"));
  return statuses.length > 0 && statuses.every(status => ["available", "in_stock"].includes(status)) &&
    Boolean(vehicle.supplierStockId) && state.decision?.persisted && state.decision.reviewStatus === "reviewed" &&
    (!vehicle.sourceUpdatedAt || new Date(vehicle.sourceUpdatedAt).getTime() === new Date(state.decision.reviewedSourceUpdatedAt).getTime());
}

function createdAt(item) {
  const raw = item?.data?._createdDate;
  return Date.parse(raw?.$date || raw || "");
}

function recordIsProtected(item) {
  return Object.entries(item.data || {}).some(([key, value]) => {
    if (/(?:reserved|unavailable|sold|archived)/i.test(key) && (value === true || /^(?:true|yes|1)$/i.test(String(value)))) return true;
    if (/^(?:isAvailable|available|inStock)$/i.test(key) && (value === false || /^(?:false|no|0)$/i.test(String(value)))) return true;
    return /^(?:status|availability|vehicleStatus|stockStatus)$/i.test(key) &&
      value && !/^(?:available|in[ _-]?stock|published|draft)$/i.test(String(value).trim());
  });
}

function referencesId(value, id) {
  if (typeof value === "string") return value.toLowerCase().includes(id.toLowerCase());
  return Boolean(value && typeof value === "object" && Object.values(value).some(part => referencesId(part, id)));
}

export function buildDealerKitRecovery(state, product) {
  if (!productLabels[product] || !state.plan?.blockers?.some(item => duplicateCodes.has(item.code))) return null;
  const entries = scopedCollections(state, product);
  const duplicate = entries.find(entry => entry.items?.length > 1);
  if (!duplicate) return null;

  const { collectionId, items, configuration } = duplicate;
  const problem = {
    registration: state.registration,
    website: productLabels[product],
    collectionId,
    problem: collectionId + " contains " + items.length + " Wix rows for this registration.",
  };
  const escalate = explanation => ({ summary: { ...problem, explanation } });
  if (!stockIsAvailable(state)) return escalate("DealerKit must confirm this reviewed vehicle is available before any repair.");
  if (state.plan.blockers.some(item => /pricing_review_hold|stale_review|source_status|review_not_approved|fixed_legacy_special/.test(item.code))) {
    return escalate("Resolve the current stock, review or pricing hold in DealerKit before changing Wix records.");
  }
  if (!duplicate.selected || !configuration?.siteId) return escalate("This collection is outside the selected website's publishing targets.");
  if (items.length !== 2 || items.some(item => !item.id || recordIsProtected(item))) {
    return escalate("A row has an uncertain identity or protected stock status, or there are more than two matches.");
  }
  const canonical = items.find(item => wixItemPublishStatus(item) === "PUBLISHED");
  const draft = items.find(item => wixItemPublishStatus(item) === "DRAFT");
  if (!canonical || !draft || canonical.id === draft.id) {
    return escalate("There is no unique published row paired with an explicitly Draft copy. A stock administrator needs to verify which item owns the live advert.");
  }
  const canonicalFields = vehicleRecordFields(canonical);
  const draftFields = vehicleRecordFields(draft);
  const different = [...new Set([...Object.keys(canonicalFields), ...Object.keys(draftFields)])]
    .filter(key => !samePublishValue(canonicalFields[key], draftFields[key]));
  const historicDifferences = different.length && createdAt(draft) < createdAt(canonical) &&
    different.every(key => historicPriceFields.has(key) || historicPhotoFields.has(key));
  if (different.length && !historicDifferences) {
    return escalate("The rows contain different vehicle details, links or other fields that cannot safely be reconciled. A stock administrator needs to review item IDs " + canonical.id + " and " + draft.id + ".");
  }
  const distinctContent = [
    different.some(key => historicPriceFields.has(key)) ? "pricing" : "",
    different.some(key => historicPhotoFields.has(key)) ? "photographs" : "",
  ].filter(Boolean).join(" and ");
  const relatedEntries = product === "cars" ? entries : [
    ...(state.vfcWixResults || []), ...(state.rent2buyWixResults || []),
  ].filter(entry => entry.siteId === configuration.siteId || entries.includes(entry));
  if (relatedEntries.some(entry => entry.items?.some(item => item.id !== draft.id && referencesId(vehicleRecordFields(item), draft.id)))) {
    return escalate("A related CMS record references the draft item. Changing its registration title needs review by a stock administrator.");
  }

  // These are full snapshots. Timestamps, Wix IDs, source identity and scope
  // bind approval as well as the vehicle fields staff see described.
  const related = relatedEntries.map(entry => [entry.collectionId, (entry.items || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))]);
  const proposal = { registration: state.registration, product, siteId: configuration.siteId, collectionId,
    supplierStockId: state.vehicle.supplierStockId, sourceUpdatedAt: state.vehicle.sourceUpdatedAt,
    reviewUpdatedAt: state.decision.updatedAt,
    canonical, draft, related };
  const approval = hash(proposal);
  const archivedTitle = "DealerKit archived copy " + state.registration + " " + hash([configuration.siteId, collectionId, draft.id]).slice(0, 12);
  return {
    ...proposal, configuration, archivedTitle,
    summary: {
      ...problem,
      approval,
      recommendation: "Keep the published advert and archive the " + (historicDifferences ? "older draft copy." : "identical draft copy."),
      retained: "Published item " + canonical.id + " keeps its item ID, URL and existing content. Both records will be backed up.",
      modified: "Draft item " + draft.id + " keeps its item ID and content. Its title becomes “" + archivedTitle + "” so it no longer matches the registration." + (distinctContent ? " The draft’s different " + distinctContent + " will be retained on that item." : ""),
      removed: "The draft will be removed from registration matching. Both Wix items will be retained.",
    },
  };
}

export function dealerKitRecoverySummary(state, product = state.plan?.mode) {
  return buildDealerKitRecovery(state, product)?.summary || null;
}

export async function recordPublishRecovery(state, product, event, details, approval = null) {
  const { error } = await state.supabase.from(TABLE).insert({
    registration: state.registration, product, event, approval, details,
  });
  if (error?.code === "23505" && approval && event === "approved") {
    throw new ControlledPublishError(409, "This repair approval was already used. Check the vehicle again for its current Wix state.");
  }
  if (error?.code === "23505" && event === "status_started") {
    throw new ControlledPublishError(409, "A publish-status task is already waiting for Wix verification. Check the record before retrying.", {
      code: "dealerkit_status_pending", manualAttentionRequired: true,
    });
  }
  if (error) throw new ControlledPublishError(503, "DealerKit could not save the recovery audit. Check the Wix state before retrying.", {
    code: "dealerkit_recovery_audit_unavailable", manualAttentionRequired: true,
  });
}

export async function claimDealerKitPublishStatus(state, product, details) {
  const { data, error } = await state.supabase.from(TABLE).select("id,event,approval")
    .eq("registration", state.registration).eq("product", product)
    .in("event", ["status_started", "status_verified", "status_rejected"])
    .contains("details", details).order("occurred_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new ControlledPublishError(503, "DealerKit could not check the previous Wix publish-status task.", {
    code: "dealerkit_recovery_audit_unavailable", manualAttentionRequired: true,
  });
  if (data?.event === "status_started") {
    throw new ControlledPublishError(409, "A previous Wix publish-status task is still unverified. Give audit reference " + data.approval.slice(0, 12) + " to a stock administrator.", {
      code: "dealerkit_status_pending", manualAttentionRequired: true,
    });
  }
  const claim = hash(["publish_status", state.registration, product, details, data?.id || null]);
  await recordPublishRecovery(state, product, "status_started", details, claim);
  return claim;
}

async function readArchivedCopy(configuration, collectionId, id, request) {
  const payload = await request(configuration, "/wix-data/v2/items/query", {
    method: "POST", body: {
      dataCollectionId: collectionId, query: { filter: { _id: { $eq: id } }, paging: { limit: 2 } },
      consistentRead: true, publishPluginOptions: { includeDraftItems: true },
    },
  });
  return payload?.dataItems?.length === 1 ? payload.dataItems[0] : null;
}

async function verifyApprovedArchive(registration, { collectionId, canonical, draft, archivedTitle }, configuration, {
  query = queryControlledRegistrationItems, request = controlledWixRequest, wait,
} = {}) {
  await retryTemporaryPublishOperation(async () => {
    const [matches, live, archived] = await Promise.all([
      query(configuration, collectionId, registration, { request }),
      query(configuration, collectionId, registration, { request, includeDraftItems: false }),
      readArchivedCopy(configuration, collectionId, draft.id, request),
    ]);
    if (matches.length !== 1 || matches[0].id !== canonical.id || live.length !== 1 || live[0].id !== canonical.id ||
        wixItemPublishStatus(matches[0]) !== "PUBLISHED" || !samePublishValue(vehicleRecordFields(matches[0]), vehicleRecordFields(canonical)) ||
        archived?.id !== draft.id || wixItemPublishStatus(archived) !== "DRAFT" ||
        !samePublishValue(vehicleRecordFields(archived), { ...vehicleRecordFields(draft), title: archivedTitle })) {
      throw new ControlledPublishError(502, "Wix has not verified the approved draft archive and the retained live advert.");
    }
  }, { wait });
}

export async function verifyPendingDealerKitRepairs(state, product, { audit = recordPublishRecovery, ...dependencies } = {}) {
  const { data, error } = await state.supabase.from(TABLE).select("event,approval,details")
    .eq("registration", state.registration).eq("product", product)
    .in("event", ["approved", "verified", "failed"]).order("occurred_at", { ascending: false });
  if (error) throw new ControlledPublishError(503, "DealerKit could not check the approved repair history.", {
    code: "dealerkit_recovery_audit_unavailable", manualAttentionRequired: true,
  });
  const events = data || [];
  const settled = new Set(events.filter(event => event.event === "verified" ||
    (event.event === "failed" && event.details?.mutationStarted === false)).map(event => event.approval));
  for (const entry of events.filter(event => event.event === "approved" && !settled.has(event.approval))) {
    const repair = entry.details;
    const configuration = state.configuration.siteId === repair.siteId
      ? state.configuration : state.configurationsBySiteId?.[repair.siteId];
    try {
      if (!configuration) throw new Error("Wix site no longer matches");
      await verifyApprovedArchive(state.registration, repair, configuration, dependencies);
    } catch {
      throw new ControlledPublishError(409, "An approved repair is still unverified. Give audit reference " + entry.approval.slice(0, 12) + " to a stock administrator.", {
        code: "dealerkit_recovery_unverified", manualAttentionRequired: true,
      });
    }
    await audit(state, product, "verified", {
      collectionId: repair.collectionId, siteId: repair.siteId, canonicalId: repair.canonical.id, draftId: repair.draft.id, recoveredResponse: true,
    }, entry.approval);
  }
}

export async function approveDealerKitRecovery(state, product, approval, {
  refresh,
  request = controlledWixRequest,
  query = queryControlledRegistrationItems,
  audit = recordPublishRecovery,
  activeSpecial = currentActiveRent2BuyManualSpecial,
  wait,
} = {}) {
  const fix = buildDealerKitRecovery(state, product);
  if (typeof approval !== "string" || !fix?.summary?.approval || fix.summary.approval !== approval) {
    throw new ControlledPublishError(409, "The proposed Wix repair changed. Submit again to review the current records.");
  }
  const { configuration, collectionId, canonical, draft, archivedTitle } = fix;
  if (product === "rent2buy" && await activeSpecial(state.registration)) {
    throw new ControlledPublishError(409, "An active Rent2Buy special is protecting this advert. End or review the special before repairing Wix.");
  }

  await audit(state, product, "approved", {
    collectionId, siteId: configuration.siteId, supplierStockId: fix.supplierStockId,
    archivedTitle, canonical, draft, recommendation: fix.summary,
  }, approval);

  let mutationStarted = false;
  try {
    const current = buildDealerKitRecovery(await refresh(), product);
    if (current?.summary?.approval !== approval || (product === "rent2buy" && await activeSpecial(state.registration))) {
      throw new ControlledPublishError(409, "DealerKit or Wix changed after approval. Submit again to review the current records.");
    }
    const liveBefore = await query(configuration, collectionId, state.registration, { request, includeDraftItems: false });
    if (liveBefore.length !== 1 || liveBefore[0].id !== canonical.id ||
        !samePublishValue(vehicleRecordFields(liveBefore[0]), vehicleRecordFields(canonical))) {
      throw new ControlledPublishError(409, "The published Wix advert could not be independently confirmed. Ask a stock administrator to review this registration.");
    }

    mutationStarted = true;
    let patchError;
    try {
      await request(configuration, "/wix-data/v2/items/" + encodeURIComponent(draft.id), {
        method: "PATCH", body: {
          dataCollectionId: collectionId,
          patch: { dataItemId: draft.id, fieldModifications: [
            { fieldPath: "title", action: "SET_FIELD", setFieldOptions: { value: archivedTitle } },
          ] },
        },
      });
    } catch (error) {
      // The server can commit a PATCH before its response is lost. Read back
      // both records before declaring failure. Never replay this approval.
      patchError = error;
    }

    await verifyApprovedArchive(state.registration, { collectionId, canonical, draft, archivedTitle }, configuration, { query, request, wait });
    await audit(state, product, "verified", { collectionId, siteId: configuration.siteId, canonicalId: canonical.id, draftId: draft.id, recoveredResponse: Boolean(patchError) }, approval);
    return { repaired: true, verified: true, registration: state.registration, collectionId };
  } catch (error) {
    await audit(state, product, "failed", { collectionId, siteId: configuration.siteId, mutationStarted, reason: error.message }, approval);
    if (!mutationStarted) throw error;
    throw new ControlledPublishError(409, "Wix could not confirm this approved repair. Give the audit reference " + approval.slice(0, 12) + " to a stock administrator.", {
      code: "dealerkit_recovery_unverified", manualAttentionRequired: true,
    });
  }
}
