import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import { DEALERKIT_REVIEW_TABLE, rowToDealerKitReviewDecision } from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { ControlledPublishError, controlledWixRequest } from "./_dealerkit-controlled-publish-state.js";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { decodeDealerKitProductImageState } from "../lib/dealerKitProductImageState.js";
import { DEALERKIT_IMPORTED_MEDIA_TABLE, WIX_MEDIA_GET_FILE_URL, importedMediaRowToClient } from "../lib/dealerKitWixVehicleMedia.js";
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
  const payload = await controlledWixRequest(configuration, "/wix-data/v2/items/query", {
    method: "POST",
    body: {
      dataCollectionId: collectionId,
      query: { filter: { title: { $eq: registration } }, paging: { limit: 3, offset: 0 } },
      consistentRead: true,
    },
  });
  return Array.isArray(payload.dataItems) ? payload.dataItems : [];
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

function buildCarImageSet(vehicle = {}, decision = {}, importedDealerKitMedia = []) {
  const sourceIds = (Array.isArray(vehicle.images) ? vehicle.images : []).map((image) => clean(image?.id, 300)).filter(Boolean);
  const decoded = decodeDealerKitProductImageState(decision, sourceIds);
  const selectedIds = decoded.finance.includedOrderIds;
  const primaryId = selectedIds.includes(decoded.finance.primaryId) ? decoded.finance.primaryId : selectedIds[0] || null;
  const importedById = new Map((importedDealerKitMedia || []).map((item) => [clean(item?.dealerKitImageId, 300), item]));
  const readyIds = selectedIds.filter((id) => importedById.get(id)?.ready && clean(importedById.get(id)?.wixUrl, 3000));
  const unpreparedIds = selectedIds.filter((id) => !importedById.has(id));
  const processingIds = selectedIds.filter((id) => importedById.has(id) && !importedById.get(id)?.ready);
  const mainUrl = primaryId && importedById.get(primaryId)?.ready ? clean(importedById.get(primaryId)?.wixUrl, 3000) : null;
  const galleryUrls = readyIds.map((id) => clean(importedById.get(id)?.wixUrl, 3000)).filter(Boolean);

  return {
    imageSet: {
      dealerKitImageIds: selectedIds,
      mainUrl,
      mainSource: mainUrl ? "dealerkit_primary" : null,
      listingImageUrl: mainUrl,
      galleryUrls,
      ready: Boolean(selectedIds.length && mainUrl && readyIds.length === selectedIds.length),
    },
    media: {
      dealerKitImported: selectedIds.filter((id) => importedById.has(id)).length,
      dealerKitExpected: selectedIds.length,
      dealerKitReady: readyIds.length,
      missingDealerKitImageIds: [...unpreparedIds, ...processingIds],
      unpreparedDealerKitImageIds: unpreparedIds,
      processingDealerKitImageIds: processingIds,
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

  const configuration = controlledCarWixConfiguration(environment);
  const [importedDealerKitMedia, carListingRows, carDetailRows] = await Promise.all([
    loadImportedReadiness(supabase, configuration, vehicle),
    queryRegistration(configuration, "CARFINANCE", registration),
    queryRegistration(configuration, "CARPAGES", registration),
  ]);
  const { imageSet, media } = buildCarImageSet(vehicle, decision, importedDealerKitMedia);
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
