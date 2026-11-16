import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import { DEALERKIT_REVIEW_TABLE, rowToDealerKitReviewDecision } from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { ControlledPublishError, controlledWixRequest, queryControlledRegistrationItems, assertDealerKitRegistrationUnambiguous } from "./_dealerkit-controlled-publish-state.js";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { decodeDealerKitProductImageState } from "../lib/dealerKitProductImageState.js";
import { DEALERKIT_IMPORTED_MEDIA_TABLE, WIX_MEDIA_GET_FILE_URL, importedMediaRowToClient } from "../lib/dealerKitWixVehicleMedia.js";
import { DEALERKIT_MANUAL_MEDIA_TABLE, manualMediaRowToClient } from "../lib/dealerKitWixManualMedia.js";
import { buildDealerKitCarWixPlan, buildCarPublishConfirmation } from "../lib/dealerKitCarWixPlan.js";

const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

export function controlledCarWixConfiguration(environment = process.env) {
  const apiKey = clean(environment.WIX_CAR_API_KEY || environment.WIX_FINANCE_API_KEY || environment.WIX_API_KEY, 4000);
  const siteId = clean(environment.WIX_CAR_SITE_ID || environment.WIX_FINANCE_SITE_ID || environment.WIX_SITE_ID, 500);
  if (!apiKey || !siteId) throw new ControlledPublishError(500, "Cars Wix publishing is not configured.");
  return {
    apiKey,
    siteId,
    siteLabel: "VAN FINANCE Wix · Cars",
    apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com",
  };
}

async function loadDecision(supabase, registration) {
  const { data, error } = await supabase.from(DEALERKIT_REVIEW_TABLE).select("*").eq("registration", registration).limit(2);
  if (error) throw new ControlledPublishError(502, `DealerKit Cars review read failed: ${error.message || error}`);
  if (!data?.length) throw new ControlledPublishError(409, `Save the Cars review for ${registration} first.`);
  if (data.length !== 1) throw new ControlledPublishError(409, `DealerKit review identity for ${registration} is ambiguous.`);
  return rowToDealerKitReviewDecision(data[0]);
}

async function queryRegistration(configuration, collectionId, registration) {
  return queryControlledRegistrationItems(configuration, collectionId, registration);
}

async function loadImportedReadiness(supabase, configuration, vehicle) {
  const { data, error } = await supabase
    .from(DEALERKIT_IMPORTED_MEDIA_TABLE)
    .select("*")
    .eq("supplier_stock_id", vehicle.supplierStockId)
    .eq("wix_site_id", configuration.siteId);
  if (error) throw new ControlledPublishError(502, `Cars Wix media map read failed: ${error.message || error}`);

  const items = [];
  for (const row of data || []) {
    const stored = importedMediaRowToClient(row);
    try {
      const payload = await controlledWixRequest(configuration, `${WIX_MEDIA_GET_FILE_URL}?fileId=${encodeURIComponent(stored.wixFileId)}`, { method: "GET" });
      const file = payload?.file;
      const operationStatus = clean(file?.operationStatus, 80).toUpperCase() || "UNKNOWN";
      const validIdentity = Boolean(file?.id === stored.wixFileId && clean(file?.mediaType, 80).toUpperCase() === "IMAGE");
      items.push({
        ...stored,
        wixUrl: clean(file?.url, 3000) || stored.wixUrl,
        operationStatus,
        ready: validIdentity && operationStatus === "READY",
        liveVerified: validIdentity,
      });
    } catch {
      items.push({ ...stored, ready: false, liveVerified: false, operationStatus: "UNVERIFIED" });
    }
  }
  return items;
}

async function loadCarManualMedia(supabase, configuration, vehicle, registration) {
  const { data, error } = await supabase.from(DEALERKIT_MANUAL_MEDIA_TABLE).select("*")
    .eq("supplier_stock_id", vehicle.supplierStockId).eq("registration", registration)
    .eq("site_scope", "cars").eq("purpose", "cars_replacement").eq("wix_site_id", configuration.siteId)
    .order("created_at", { ascending: true });
  if (error) throw new ControlledPublishError(502, "Could not load staged Cars images.");
  return Promise.all((data || []).map(async row => {
    const stored = manualMediaRowToClient(row);
    try {
      const { file } = await controlledWixRequest(configuration, `${WIX_MEDIA_GET_FILE_URL}?fileId=${encodeURIComponent(stored.wixFileId)}`, { method: "GET" });
      const ready = file?.id === stored.wixFileId && file.mediaType === "IMAGE" && file.operationStatus === "READY"
        && (!file.siteId || file.siteId === configuration.siteId);
      return { ...stored, ready: Boolean(ready), url: ready ? clean(file.url, 3000) : null };
    } catch {
      return { ...stored, ready: false, url: null };
    }
  }));
}

export function buildCarImageSet(vehicle = {}, decision = {}, importedDealerKitMedia = [], manualMedia = []) {
  const sourceIds = (Array.isArray(vehicle.images) ? vehicle.images : []).map((image) => clean(image?.id, 300)).filter(Boolean);
  const decoded = decodeDealerKitProductImageState(decision, sourceIds);
  const selectedIds = decoded.finance.includedOrderIds;
  const primaryId = selectedIds.includes(decoded.finance.primaryId) ? decoded.finance.primaryId : selectedIds[0] || null;
  const importedById = new Map((importedDealerKitMedia || []).map((item) => [clean(item?.dealerKitImageId, 300), item]));
  const readyIds = selectedIds.filter((id) => importedById.get(id)?.ready && clean(importedById.get(id)?.wixUrl, 3000));
  const unpreparedIds = selectedIds.filter((id) => !importedById.has(id));
  const processingIds = selectedIds.filter((id) => importedById.has(id) && !importedById.get(id)?.ready);
  const sourceMain = primaryId && importedById.get(primaryId)?.ready ? clean(importedById.get(primaryId)?.wixUrl, 3000) : null;
  const selectedManual = manualMedia.filter(item => item.selected);
  const manualPrimary = selectedManual.length === 1 && selectedManual[0].ready ? selectedManual[0].url : null;
  const mainUrl = selectedManual.length ? manualPrimary : sourceMain;
  const galleryIds = sourceMain ? [primaryId, ...readyIds.filter((id) => id !== primaryId)] : readyIds;
  const galleryUrls = [...new Set([mainUrl, ...manualMedia.filter(item => item.ready).map(item => item.url),
    ...galleryIds.map(id => clean(importedById.get(id)?.wixUrl, 3000))].filter(Boolean))];

  return {
    imageSet: {
      dealerKitImageIds: selectedIds,
      mainUrl,
      mainSource: manualPrimary ? "manual_replacement" : mainUrl ? "dealerkit_primary" : null,
      listingImageUrl: mainUrl,
      galleryUrls,
      // Cars follows the same rule as the van lanes: the chosen primary/card
      // image is the hard requirement. READY secondary photos are included,
      // while processing/unprepared secondary photos are advisory only.
      ready: Boolean(mainUrl && galleryUrls.length),
    },
    media: {
      dealerKitImported: selectedIds.filter((id) => importedById.has(id)).length,
      dealerKitExpected: selectedIds.length,
      dealerKitReady: readyIds.length,
      missingDealerKitImageIds: [...unpreparedIds, ...processingIds],
      unpreparedDealerKitImageIds: unpreparedIds,
      processingDealerKitImageIds: processingIds,
      pendingManualMedia: manualMedia.filter(item => !item.ready).length,
    },
  };
}

export async function buildFreshCarControlledPublishState(registrationInput, environment = process.env) {
  const registration = normalizeFinanceRegistration(registrationInput || "");
  if (!registration) throw new ControlledPublishError(400, "A valid registration is required.");

  const supabase = getSupabaseServiceAdmin();
  const decision = await loadDecision(supabase, registration);
  const vehicle = await fetchDealerKitStockDetail(decision.supplierStockId, { specifications: true });
  if (normalizeFinanceRegistration(vehicle?.registration || "") !== registration) {
    throw new ControlledPublishError(409, "DealerKit registration changed. Re-open and save the Cars review again.");
  }

  await assertDealerKitRegistrationUnambiguous(registration);

  const configuration = controlledCarWixConfiguration(environment);
  const [importedDealerKitMedia, carListingRows, carDetailRows, manualMedia] = await Promise.all([
    loadImportedReadiness(supabase, configuration, vehicle),
    queryRegistration(configuration, "CARFINANCE", registration),
    queryRegistration(configuration, "CARPAGES", registration),
    loadCarManualMedia(supabase, configuration, vehicle, registration),
  ]);
  const { imageSet, media } = buildCarImageSet(vehicle, decision, importedDealerKitMedia, manualMedia);
  const plan = buildDealerKitCarWixPlan({ vehicle, decision, imageSet, carListingRows, carDetailRows });
  plan.confirmation = buildCarPublishConfirmation(plan);

  return {
    registration,
    supabase,
    configuration,
    decision,
    vehicle,
    importedDealerKitMedia,
    imageSet,
    media,
    carListingRows,
    carDetailRows,
    plan,
  };
}
