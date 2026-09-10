import { normalizeFinanceRegistration } from "./vanscoWixPrice.js";
import { decodeDealerKitProductImageState } from "./dealerKitProductImageState.js";

export const DEALERKIT_WIX_MEDIA_PLAN_VERSION = 2;
export const WIX_MEDIA_IMPORT_DOCS_URL = "https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file";
export const WIX_MEDIA_IMPORT_PUBLIC_URL = "https://www.wixapis.com/site-media/v1/files/import";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function blocker(code, message) {
  return { code, message };
}

function safeHttpUrl(value) {
  const text = clean(value, 4000);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function imageIdentityIsExplicitlyUnstable(image = {}) {
  const source = clean(image.identitySource || image.idSource, 100).toLowerCase();
  return image.identityStable === false || source === "position" || source === "missing" || source === "generated_position";
}

function orderedSourceImages(vehicle = {}, decision = {}) {
  const sourceImages = Array.isArray(vehicle.images) ? vehicle.images : [];
  const imageById = new Map();
  const duplicateIds = new Set();
  const missingIdIndexes = [];
  const unstableIds = new Set();

  sourceImages.forEach((image, index) => {
    const id = clean(image?.id, 300);
    if (!id) {
      missingIdIndexes.push(index);
      return;
    }
    if (imageIdentityIsExplicitlyUnstable(image)) unstableIds.add(id);
    if (imageById.has(id)) duplicateIds.add(id);
    else imageById.set(id, image);
  });

  const sourceIds = Array.from(imageById.keys());
  const productState = decodeDealerKitProductImageState(decision, sourceIds);
  const orderedIds = [...productState.finance.includedOrderIds];
  if (decision.rent2buyEnabled) {
    for (const id of productState.rent2buy.includedOrderIds) {
      if (!orderedIds.includes(id)) orderedIds.push(id);
    }
  }
  const excluded = new Set(sourceIds.filter((id) => !orderedIds.includes(id)));

  return {
    excluded,
    imageById,
    duplicateIds: Array.from(duplicateIds),
    missingIdIndexes,
    unstableIds: Array.from(unstableIds),
    orderedIds,
    financePrimaryId: productState.finance.primaryId,
  };
}

export function buildDealerKitWixMediaPlan({ vehicle = {}, decision = {} } = {}) {
  const blockers = [];
  const registration = normalizeFinanceRegistration(vehicle.registration || decision.registration || "");
  const supplierStockId = clean(vehicle.supplierStockId || decision.supplierStockId, 300);
  const sourceUpdatedAt = clean(vehicle.sourceUpdatedAt, 100) || null;
  const ordered = orderedSourceImages(vehicle, decision);
  const primaryImageId = clean(ordered.financePrimaryId, 300) || null;

  if (!registration) blockers.push(blocker("missing_registration", "A valid registration is required before DealerKit images can be prepared for Wix Media."));
  if (!supplierStockId) blockers.push(blocker("missing_source_id", "DealerKit stock ID is required so imported media can retain a stable source reference."));
  if (ordered.missingIdIndexes.length) {
    blockers.push(blocker(
      "missing_image_id",
      `DealerKit returned ${ordered.missingIdIndexes.length} image(s) without a stable image ID. Media import stays locked because review exclusions could not be persisted safely.`,
    ));
  }
  if (ordered.duplicateIds.length) {
    blockers.push(blocker(
      "duplicate_image_id",
      `DealerKit returned duplicate image ID(s): ${ordered.duplicateIds.join(", ")}. Media import stays locked until each source image can be identified uniquely.`,
    ));
  }
  if (ordered.unstableIds.length) {
    blockers.push(blocker(
      "unstable_image_identity",
      `DealerKit image identity is not stable for: ${ordered.unstableIds.join(", ")}. Positional or generated image IDs cannot be used for saved exclusions, ordering or Wix imports.`,
    ));
  }

  const items = ordered.orderedIds.map((id, index) => {
    const source = ordered.imageById.get(id) || {};
    const sourceUrl = safeHttpUrl(source.url);
    const stableIdentity = !imageIdentityIsExplicitlyUnstable(source);
    if (!sourceUrl) {
      blockers.push(blocker("invalid_image_url", `DealerKit image ${id} does not have a valid HTTP(S) source URL.`));
    }
    return {
      id,
      stableIdentity,
      identitySource: clean(source.identitySource || source.idSource, 100) || null,
      stableKey: supplierStockId && stableIdentity ? `${supplierStockId}:${id}` : null,
      sourceUrl,
      position: index + 1,
      isPrimary: id === primaryImageId,
      proposedBaseName: registration ? `${registration}-${String(index + 1).padStart(2, "0")}` : null,
      sourceMimeType: clean(source.mimeType || source.contentType, 100) || null,
      wixImportRequestPreview: sourceUrl && stableIdentity ? {
        url: sourceUrl,
        mediaType: "IMAGE",
        displayName: registration ? `${registration}-${String(index + 1).padStart(2, "0")}` : null,
        private: false,
        externalInfo: {
          origin: "dealerkit-vfc-stock",
          externalIds: [
            supplierStockId ? `stock:${supplierStockId}` : null,
            `image:${id}`,
          ].filter(Boolean),
        },
      } : null,
    };
  });

  if (!items.length) blockers.push(blocker("no_images", "No reviewed DealerKit images are selected for Wix Media."));
  if (!primaryImageId) blockers.push(blocker("missing_primary", "Choose an included DealerKit image as the primary image."));
  else if (!items.some((item) => item.id === primaryImageId)) {
    blockers.push(blocker("primary_not_included", "The selected primary DealerKit image is excluded or no longer exists in the current source record."));
  }

  const sourceMimeTypesComplete = items.length > 0 && items.every((item) => Boolean(item.sourceMimeType));
  const stableImageIdentitiesComplete = items.length > 0 && items.every((item) => item.stableIdentity);

  return {
    version: DEALERKIT_WIX_MEDIA_PLAN_VERSION,
    readOnly: true,
    liveImportLocked: true,
    registration,
    supplierStockId,
    sourceUpdatedAt,
    primaryImageId,
    selectedImageIds: items.map((item) => item.id),
    excludedImageIds: Array.from(ordered.excluded),
    items,
    blockers,
    canPrepareImport: blockers.length === 0,
    wixImportContract: {
      verified: true,
      docsUrl: WIX_MEDIA_IMPORT_DOCS_URL,
      publicUrl: WIX_MEDIA_IMPORT_PUBLIC_URL,
      method: "POST",
      requiredPermission: "MEDIA.SITE_MEDIA_FILES_IMPORT",
      requiredRequestField: "url",
      targetMediaType: "IMAGE",
      asynchronousProcessing: true,
      readinessStates: ["PENDING", "READY", "FAILED"],
      note: "A successful import response does not mean the file is immediately usable; Wix processes imported media asynchronously.",
    },
    sourceRequirements: {
      sourceMimeTypesComplete,
      stableImageIdentitiesComplete,
      dealerKitUrlDurabilityVerified: false,
      dealerKitHeadSupportVerified: false,
      note: "Before live import is unlocked, verify stable DealerKit image IDs, the image URL lifetime/authentication contract and either MIME metadata, filename extension or HEAD support for every source image.",
    },
    storagePolicy: {
      destination: "wix_media",
      supabaseImageStorage: false,
      temporaryStagingOnly: true,
      temporaryStagingMustExpire: true,
      sourceOfTruth: "dealerkit",
    },
  };
}
