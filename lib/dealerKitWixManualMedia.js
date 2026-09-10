import { RENT2BUY_WIX_SITE_ID } from "./rent2buyMonthlyPriceSync.js";

export const DEALERKIT_MANUAL_MEDIA_TABLE = "dealerkit_review_manual_media";
export const WIX_MEDIA_GENERATE_UPLOAD_URL = "/site-media/v1/files/generate-upload-url";
export const WIX_MEDIA_GET_FILE_URL = "/site-media/v1/files/get-file-by-id";
export const DEALERKIT_MANUAL_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

export const DEALERKIT_MANUAL_MEDIA_PURPOSES = Object.freeze({
  van_finance_replacement: Object.freeze({
    key: "van_finance_replacement",
    label: "Van Finance replacement image",
    siteScope: "van_finance",
  }),
  rent2buy_template: Object.freeze({
    key: "rent2buy_template",
    label: "Rent2Buy template / replacement image",
    siteScope: "rent2buy",
  }),
});

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function clean(value, limit = 1000) {
  return String(value ?? "").trim().slice(0, limit);
}

export function normaliseManualMediaPurpose(value) {
  const key = clean(value, 80);
  return DEALERKIT_MANUAL_MEDIA_PURPOSES[key] || null;
}

export function normaliseManualMediaFileName(value) {
  const original = clean(value, 240).replace(/[\\/]+/g, "-");
  const safe = original
    .replace(/[^A-Za-z0-9._() -]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim();
  return safe || null;
}

export function validateDealerKitManualMediaFile(input = {}) {
  const fileName = normaliseManualMediaFileName(input.fileName);
  const mimeType = clean(input.mimeType, 120).toLowerCase();
  const sizeInBytes = Number(input.sizeInBytes);
  const errors = [];

  if (!fileName) errors.push("A file name is required.");
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    errors.push("Upload a JPEG, PNG or WebP image.");
  }
  if (!Number.isSafeInteger(sizeInBytes) || sizeInBytes <= 0) {
    errors.push("The image size is invalid.");
  } else if (sizeInBytes > DEALERKIT_MANUAL_MEDIA_MAX_BYTES) {
    errors.push("Manual image uploads are limited to 10 MB at this stage.");
  }

  return {
    valid: errors.length === 0,
    fileName,
    mimeType,
    sizeInBytes: Number.isSafeInteger(sizeInBytes) ? sizeInBytes : null,
    errors,
  };
}

export function manualMediaSiteConfiguration(purposeValue, environment = process.env) {
  const purpose = normaliseManualMediaPurpose(purposeValue);
  if (!purpose) return null;

  const apiKey = clean(environment.WIX_API_KEY, 4000);
  const apiBaseUrl = clean(environment.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com";
  const siteId = purpose.siteScope === "rent2buy"
    ? RENT2BUY_WIX_SITE_ID
    : clean(environment.WIX_SITE_ID, 500);

  return {
    purpose,
    apiKey,
    apiBaseUrl,
    siteId,
    siteIdSource: purpose.siteScope === "rent2buy"
      ? "authoritative_van_finance_cms"
      : "environment",
    configured: Boolean(apiKey && siteId),
    missing: [
      !apiKey && "WIX_API_KEY",
      !siteId && "WIX_SITE_ID",
    ].filter(Boolean),
  };
}

export function buildManualMediaUploadFileName({ registration, purpose, fileName }) {
  const reg = clean(registration, 20).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const safeFileName = normaliseManualMediaFileName(fileName) || "image.jpg";
  const extensionMatch = safeFileName.match(/(\.[A-Za-z0-9]{2,5})$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "";
  const purposeKey = normaliseManualMediaPurpose(purpose)?.key || "manual";
  return `${reg}-${purposeKey}${extension}`.slice(0, 240);
}

export function wixFileToManualMediaRow({ file, decision, purpose, siteId }) {
  const mappedPurpose = normaliseManualMediaPurpose(purpose);
  if (!mappedPurpose) throw new Error("Manual media purpose is not supported.");
  const wixFileId = clean(file?.id, 500);
  if (!wixFileId) throw new Error("Wix did not return a file ID.");
  if (clean(file?.mediaType, 80).toUpperCase() !== "IMAGE") {
    throw new Error("The Wix Media item is not an image.");
  }

  const status = clean(file?.operationStatus, 80).toUpperCase() || "PENDING";
  return {
    supplier_stock_id: clean(decision?.supplierStockId, 300),
    registration: clean(decision?.registration, 20).replace(/[^A-Z0-9]/gi, "").toUpperCase(),
    site_scope: mappedPurpose.siteScope,
    purpose: mappedPurpose.key,
    wix_site_id: clean(siteId, 500),
    wix_file_id: wixFileId,
    wix_url: clean(file?.url, 3000),
    display_name: clean(file?.displayName, 500),
    size_in_bytes: Number.isFinite(Number(file?.sizeInBytes)) ? Number(file.sizeInBytes) : null,
    operation_status: status,
    wix_hash: clean(file?.hash, 500) || null,
    thumbnail_url: clean(file?.thumbnailUrl, 3000) || null,
    updated_at: new Date().toISOString(),
  };
}

export function manualMediaRowToClient(row = {}) {
  const purpose = normaliseManualMediaPurpose(row.purpose);
  const operationStatus = clean(row.operation_status, 80).toUpperCase() || "PENDING";
  const selectedAt = row.selected_at || null;
  return {
    id: clean(row.id, 100),
    supplierStockId: clean(row.supplier_stock_id, 300),
    registration: clean(row.registration, 20),
    siteScope: clean(row.site_scope, 80),
    purpose: clean(row.purpose, 80),
    purposeLabel: purpose?.label || clean(row.purpose, 80),
    wixSiteId: clean(row.wix_site_id, 500),
    wixFileId: clean(row.wix_file_id, 500),
    url: clean(row.wix_url, 3000) || null,
    thumbnailUrl: clean(row.thumbnail_url, 3000) || null,
    displayName: clean(row.display_name, 500),
    sizeInBytes: Number.isFinite(Number(row.size_in_bytes)) ? Number(row.size_in_bytes) : null,
    operationStatus,
    ready: operationStatus === "READY",
    failed: operationStatus === "FAILED",
    processing: !["READY", "FAILED"].includes(operationStatus),
    selected: Boolean(selectedAt),
    selectedAt,
    createdAt: row.created_at || null,
    verifiedAt: row.updated_at || null,
    updatedAt: row.updated_at || null,
  };
}
