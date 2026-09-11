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
  const importedById = new Map(
    (Array.isArray(importedDealerKitMedia) ? importedDealerKitMedia : [])
      .filter((item) => item?.ready && clean(item.dealerKitImageId, 300) && clean(item.wixUrl, 3000))
      .map((item) => [clean(item.dealerKitImageId, 300), item]),
  );

  const financeIds = productState.finance.includedOrderIds;
  const rent2buyIds = productState.rent2buy.includedOrderIds;
  const financeUrls = financeIds.map((id) => importedById.get(id)?.wixUrl).filter(Boolean);
  const rent2buyUrls = rent2buyIds.map((id) => importedById.get(id)?.wixUrl).filter(Boolean);
  const financeMissingIds = financeIds.filter((id) => !importedById.get(id)?.ready);
  const rent2buyMissingIds = rent2buyIds.filter((id) => !importedById.get(id)?.ready);
  const combinedIds = uniqueIds([...financeIds, ...(decision.rent2buyEnabled ? rent2buyIds : [])]);
  const combinedMissingIds = uniqueIds([...financeMissingIds, ...(decision.rent2buyEnabled ? rent2buyMissingIds : [])]);

  const selectedManual = manualMediaReadiness?.selections || {};
  const vfcManual = selectedManual.van_finance_replacement || null;
  const rent2buyTemplate = selectedManual.rent2buy_template || null;
  const vfcManualReady = Boolean(vfcManual?.selectedAndReady && clean(vfcManual.url, 3000));
  const rent2buyManualReady = Boolean(rent2buyTemplate?.selectedAndReady && clean(rent2buyTemplate.url, 3000));
  const financePrimaryDealerKitUrl = importedById.get(productState.finance.primaryId)?.wixUrl || null;
  const vfcMainUrl = vfcManualReady ? clean(vfcManual.url, 3000) : financePrimaryDealerKitUrl;
  const rent2buyMainUrl = rent2buyManualReady ? clean(rent2buyTemplate.url, 3000) : null;

  // A selected manual main image is a replacement, not an extra first photo.
  // All other READY manual images for that product remain valid gallery images.
  // Reviewed DealerKit images are appended only when they are still selected.
  const financeManualUrls = readyManualUrls(manualMediaReadiness, "van_finance_replacement", vfcManualReady ? vfcMainUrl : null);
  const rent2buyManualUrls = readyManualUrls(manualMediaReadiness, "rent2buy_template", rent2buyManualReady ? rent2buyMainUrl : null);
  const financeGalleryUrls = financeIds
    .filter((id) => !(vfcManualReady && id === productState.finance.primaryId))
    .map((id) => importedById.get(id)?.wixUrl)
    .filter(Boolean);
  const rent2buyGalleryDealerKitUrls = rent2buyIds
    .filter((id) => !(rent2buyManualReady && id === productState.rent2buy.primaryId))
    .map((id) => importedById.get(id)?.wixUrl)
    .filter(Boolean);

  const vfcGalleryUrls = uniqueUrls([vfcMainUrl, ...financeManualUrls, ...financeGalleryUrls]);
  const rent2buyGalleryUrls = uniqueUrls([rent2buyMainUrl, ...rent2buyManualUrls, ...rent2buyGalleryDealerKitUrls]);

  return {
    registration: normalizeFinanceRegistration(vehicle.registration || decision.registration || ""),
    dealerKitImageIds: combinedIds,
    missingDealerKitImageIds: combinedMissingIds,
    vanFinance: {
      mainUrl: vfcMainUrl,
      mainSource: vfcManualReady ? "manual_replacement" : financePrimaryDealerKitUrl ? "dealerkit_primary" : null,
      listingImageUrl: vfcMainUrl,
      dealerKitImageIds: financeIds,
      missingDealerKitImageIds: financeMissingIds,
      galleryUrls: vfcGalleryUrls,
      ready: Boolean(vfcMainUrl && vfcGalleryUrls.length && !financeMissingIds.length),
    },
    rent2buy: {
      enabled: Boolean(decision.rent2buyEnabled),
      mainUrl: rent2buyMainUrl,
      mainSource: rent2buyMainUrl ? "manual_template" : null,
      listingImageUrl: rent2buyMainUrl,
      dealerKitImageIds: rent2buyIds,
      missingDealerKitImageIds: rent2buyMissingIds,
      galleryUrls: rent2buyGalleryUrls,
      ready: !decision.rent2buyEnabled || Boolean(rent2buyMainUrl && rent2buyGalleryUrls.length && !rent2buyMissingIds.length),
    },
  };
}
