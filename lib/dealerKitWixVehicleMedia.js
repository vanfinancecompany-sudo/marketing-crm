import { normalizeFinanceRegistration } from "./vanscoWixPrice.js";

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

export function buildProductImageSets({
  vehicle = {},
  decision = {},
  importedDealerKitMedia = [],
  manualMediaReadiness = {},
} = {}) {
  const orderedIds = Array.isArray(decision.imageOrderIds) ? decision.imageOrderIds.map((id) => clean(id, 300)).filter(Boolean) : [];
  const excluded = new Set((Array.isArray(decision.excludedImageIds) ? decision.excludedImageIds : []).map((id) => clean(id, 300)).filter(Boolean));
  const sourceImages = Array.isArray(vehicle.images) ? vehicle.images : [];
  const sourceIds = sourceImages.map((image) => clean(image?.id, 300)).filter(Boolean);
  const effectiveOrder = [...orderedIds, ...sourceIds.filter((id) => !orderedIds.includes(id))].filter((id) => !excluded.has(id));
  const importedById = new Map(
    (Array.isArray(importedDealerKitMedia) ? importedDealerKitMedia : [])
      .filter((item) => item?.ready && clean(item.dealerKitImageId, 300) && clean(item.wixUrl, 3000))
      .map((item) => [clean(item.dealerKitImageId, 300), item]),
  );
  const normalUrls = effectiveOrder.map((id) => importedById.get(id)?.wixUrl).filter(Boolean);
  const missingDealerKitImageIds = effectiveOrder.filter((id) => !importedById.get(id)?.ready);

  const selectedManual = manualMediaReadiness?.selections || {};
  const vfcManual = selectedManual.van_finance_replacement || null;
  const rent2buyTemplate = selectedManual.rent2buy_template || null;
  const primaryDealerKitId = clean(decision.primaryImageId, 300);
  const primaryDealerKitUrl = importedById.get(primaryDealerKitId)?.wixUrl || null;
  const vfcMainUrl = vfcManual?.selectedAndReady ? clean(vfcManual.url, 3000) : primaryDealerKitUrl;
  const rent2buyMainUrl = rent2buyTemplate?.selectedAndReady ? clean(rent2buyTemplate.url, 3000) : null;

  const vfcGalleryUrls = uniqueUrls([vfcMainUrl, ...normalUrls]);
  const rent2buyGalleryUrls = uniqueUrls([rent2buyMainUrl, ...normalUrls]);

  return {
    registration: normalizeFinanceRegistration(vehicle.registration || decision.registration || ""),
    dealerKitImageIds: effectiveOrder,
    missingDealerKitImageIds,
    vanFinance: {
      mainUrl: vfcMainUrl,
      mainSource: vfcManual?.selectedAndReady ? "manual_replacement" : primaryDealerKitUrl ? "dealerkit_primary" : null,
      listingImageUrl: vfcMainUrl,
      galleryUrls: vfcGalleryUrls,
      ready: Boolean(vfcMainUrl && normalUrls.length && !missingDealerKitImageIds.length),
    },
    rent2buy: {
      enabled: Boolean(decision.rent2buyEnabled),
      mainUrl: rent2buyMainUrl,
      mainSource: rent2buyMainUrl ? "manual_template" : null,
      listingImageUrl: rent2buyMainUrl,
      galleryUrls: rent2buyGalleryUrls,
      ready: !decision.rent2buyEnabled || Boolean(rent2buyMainUrl && normalUrls.length && !missingDealerKitImageIds.length),
    },
  };
}
