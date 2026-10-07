import { normalizeFinanceRegistration } from "./vanscoWixPrice.js";
import { decodeDealerKitProductImageState } from "./dealerKitProductImageState.js";

export const DEALERKIT_IMPORTED_MEDIA_TABLE = "dealerkit_wix_imported_media";
export const WIX_MEDIA_IMPORT_URL = "/site-media/v1/files/import";
export const WIX_MEDIA_GET_FILE_URL = "/site-media/v1/files/get-file-by-id";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

export function importedMediaRowToClient(row = {}) {
  const operationStatus = clean(row.operation_status, 80).toUpperCase() || "PENDING";
  return {
    id: clean(row.id, 100),
    supplierStockId: clean(row.supplier_stock_id, 300),
    registration: normalizeFinanceRegistration(row.registration || ""),
    dealerKitImageId: clean(row.dealerkit_image_id, 300),
    wixSiteId: clean(row.wix_site_id, 500),
    wixFileId: clean(row.wix_file_id, 500),
    wixUrl: clean(row.wix_url, 3000),
    sourceUrl: clean(row.source_url, 3000),
    operationStatus,
    ready: operationStatus === "READY",
    sourceUpdatedAt: row.source_updated_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function buildImportedMediaRow({ vehicle = {}, sourceImage = {}, wixFile = {}, wixSiteId } = {}) {
  const supplierStockId = clean(vehicle.supplierStockId, 300);
  const registration = normalizeFinanceRegistration(vehicle.registration || "");
  const dealerKitImageId = clean(sourceImage.id, 300);
  const wixFileId = clean(wixFile.id, 500);
  const wixUrl = clean(wixFile.url, 3000);
  const sourceUrl = clean(sourceImage.sourceUrl || sourceImage.url, 3000);
  if (!supplierStockId || !registration || !dealerKitImageId || !wixSiteId || !wixFileId || !wixUrl || !sourceUrl) {
    throw new Error("A complete DealerKit/Wix media identity is required.");
  }
  return {
    supplier_stock_id: supplierStockId,
    registration,
    dealerkit_image_id: dealerKitImageId,
    wix_site_id: clean(wixSiteId, 500),
    wix_file_id: wixFileId,
    wix_url: wixUrl,
    source_url: sourceUrl,
    operation_status: clean(wixFile.operationStatus, 80).toUpperCase() || "PENDING",
    source_updated_at: vehicle.sourceUpdatedAt || null,
    updated_at: new Date().toISOString(),
  };
}

function uniqueUrls(values = []) {
  const result = [];
  for (const raw of values) {
    const value = clean(raw, 3000);
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}

function uniqueIds(values = []) {
  const result = [];
  for (const raw of values) {
    const value = clean(raw, 300);
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}

function readyManualUrls(manualMediaReadiness, purpose, primaryUrl = null) {
  const urls = (Array.isArray(manualMediaReadiness?.items) ? manualMediaReadiness.items : [])
    .filter((item) => item?.purpose === purpose && item?.eligibleForLaterSelection && clean(item?.url, 3000))
    .map((item) => clean(item.url, 3000));
  return uniqueUrls([primaryUrl, ...urls]);
}

export function buildProductImageSets({
  vehicle = {},
  decision = {},
  importedDealerKitMedia = [],
  manualMediaReadiness = {},
} = {}) {
  const sourceImages = Array.isArray(vehicle.images) ? vehicle.images : [];
  const sourceIds = sourceImages.map((image) => clean(image?.id, 300)).filter(Boolean);
  const productState = decodeDealerKitProductImageState(decision, sourceIds);
  const importedRows = Array.isArray(importedDealerKitMedia) ? importedDealerKitMedia : [];
  const preparedById = new Map(
    importedRows
      .filter((item) => {
        const id = clean(item?.dealerKitImageId, 300);
        const url = clean(item?.wixUrl, 3000);
        const status = clean(item?.operationStatus, 80).toUpperCase();
        return Boolean(
          id &&
          url &&
          item?.liveVerified !== false &&
          !["FAILED", "ERROR", "UNVERIFIED"].includes(status)
        );
      })
      .map((item) => [clean(item.dealerKitImageId, 300), item]),
  );
  const readyById = new Map(
    importedRows
      .filter((item) => item?.ready && clean(item.dealerKitImageId, 300) && clean(item.wixUrl, 3000))
      .map((item) => [clean(item.dealerKitImageId, 300), item]),
  );

  const financeIds = productState.finance.includedOrderIds;
  const rent2buyIds = productState.rent2buy.includedOrderIds;
  const financeUrls = financeIds.map((id) => readyById.get(id)?.wixUrl).filter(Boolean);
  const rent2buyUrls = rent2buyIds.map((id) => readyById.get(id)?.wixUrl).filter(Boolean);
  const financeUnpreparedIds = financeIds.filter((id) => !preparedById.has(id));
  const rent2buyUnpreparedIds = rent2buyIds.filter((id) => !preparedById.has(id));
  const financeProcessingIds = financeIds.filter((id) => preparedById.has(id) && !readyById.get(id)?.ready);
  const rent2buyProcessingIds = rent2buyIds.filter((id) => preparedById.has(id) && !readyById.get(id)?.ready);
  const financeMissingIds = uniqueIds([...financeUnpreparedIds, ...financeProcessingIds]);
  const rent2buyMissingIds = uniqueIds([...rent2buyUnpreparedIds, ...rent2buyProcessingIds]);
  const combinedIds = uniqueIds([...financeIds, ...(decision.rent2buyEnabled ? rent2buyIds : [])]);
  const combinedMissingIds = uniqueIds([...financeMissingIds, ...(decision.rent2buyEnabled ? rent2buyMissingIds : [])]);
  const combinedUnpreparedIds = uniqueIds([...financeUnpreparedIds, ...(decision.rent2buyEnabled ? rent2buyUnpreparedIds : [])]);

  const selectedManual = manualMediaReadiness?.selections || {};
  const vfcManual = selectedManual.van_finance_replacement || null;
  const rent2buyTemplate = selectedManual.rent2buy_template || null;
  const vfcManualReady = Boolean(vfcManual?.selectedAndReady && clean(vfcManual.url, 3000));
  const rent2buyManualReady = Boolean(rent2buyTemplate?.selectedAndReady && clean(rent2buyTemplate.url, 3000));
  const financePrimaryDealerKitUrl = readyById.get(productState.finance.primaryId)?.wixUrl || null;
  const vfcMainUrl = vfcManualReady ? clean(vfcManual.url, 3000) : financePrimaryDealerKitUrl;
  const rent2buyMainUrl = rent2buyManualReady ? clean(rent2buyTemplate.url, 3000) : null;

  // Branded/manual artwork is the product-specific lead image, not a replacement
  // for a selected DealerKit vehicle photo. Every selected READY DealerKit photo
  // remains in the gallery after the branded lead.
  const financeManualUrls = readyManualUrls(manualMediaReadiness, "van_finance_replacement", vfcManualReady ? vfcMainUrl : null);
  const rent2buyManualUrls = readyManualUrls(manualMediaReadiness, "rent2buy_template", rent2buyManualReady ? rent2buyMainUrl : null);
  const financeGalleryUrls = financeIds
    .map((id) => readyById.get(id)?.wixUrl)
    .filter(Boolean);
  const rent2buyGalleryDealerKitUrls = rent2buyIds
    .map((id) => readyById.get(id)?.wixUrl)
    .filter(Boolean);

  const vfcGalleryUrls = uniqueUrls([vfcMainUrl, ...financeManualUrls, ...financeGalleryUrls]);
  const rent2buyGalleryUrls = uniqueUrls([rent2buyMainUrl, ...rent2buyManualUrls, ...rent2buyGalleryDealerKitUrls]);

  return {
    registration: normalizeFinanceRegistration(vehicle.registration || decision.registration || ""),
    dealerKitImageIds: combinedIds,
    missingDealerKitImageIds: combinedMissingIds,
    unpreparedDealerKitImageIds: combinedUnpreparedIds,
    vanFinance: {
      mainUrl: vfcMainUrl,
      mainSource: vfcManualReady ? "manual_replacement" : financePrimaryDealerKitUrl ? "dealerkit_primary" : null,
      listingImageUrl: vfcMainUrl,
      dealerKitImageIds: financeIds,
      missingDealerKitImageIds: financeMissingIds,
      unpreparedDealerKitImageIds: financeUnpreparedIds,
      processingDealerKitImageIds: financeProcessingIds,
      galleryUrls: vfcGalleryUrls,
      galleryComplete: financeIds.length > 0 && financeMissingIds.length === 0,
      // Missing import mappings are a hard gate. Once every selected source
      // photo has a persisted Wix mapping, READY photos may publish
      // incrementally while the remaining mapped files finish processing.
      ready: Boolean(vfcMainUrl && vfcGalleryUrls.length && financeUnpreparedIds.length === 0),
    },
    rent2buy: {
      enabled: Boolean(decision.rent2buyEnabled),
      mainUrl: rent2buyMainUrl,
      mainSource: rent2buyMainUrl ? "manual_template" : null,
      listingImageUrl: rent2buyMainUrl,
      dealerKitImageIds: rent2buyIds,
      missingDealerKitImageIds: rent2buyMissingIds,
      unpreparedDealerKitImageIds: rent2buyUnpreparedIds,
      processingDealerKitImageIds: rent2buyProcessingIds,
      galleryUrls: rent2buyGalleryUrls,
      galleryComplete: !decision.rent2buyEnabled || (rent2buyIds.length > 0 && rent2buyMissingIds.length === 0),
      // Rent2Buy requires its branded lead plus persisted mappings for every
      // selected DealerKit photo. Mapped files may still finish processing
      // incrementally without reopening the missing-import hole.
      ready: !decision.rent2buyEnabled || Boolean(rent2buyMainUrl && rent2buyGalleryUrls.length && rent2buyUnpreparedIds.length === 0),
    },
  };
}
