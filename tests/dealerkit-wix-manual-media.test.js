import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEALERKIT_MANUAL_MEDIA_MAX_BYTES,
  DEALERKIT_MANUAL_MEDIA_TABLE,
  WIX_MEDIA_GENERATE_UPLOAD_URL,
  WIX_MEDIA_GET_FILE_URL,
  buildManualMediaUploadFileName,
  manualMediaRowToClient,
  manualMediaSiteConfiguration,
  normaliseManualMediaPurpose,
  validateDealerKitManualMediaFile,
  wixFileToManualMediaRow,
} from "../lib/dealerKitWixManualMedia.js";
import { buildProductImageSets } from "../lib/dealerKitWixVehicleMedia.js";
import { RENT2BUY_WIX_SITE_ID } from "../lib/rent2buyMonthlyPriceSync.js";

const root = new URL("../", import.meta.url);

function decision() {
  return {
    supplierStockId: "stock-123",
    registration: "HT22KJX",
  };
}

function importedMedia(id, url) {
  return {
    dealerKitImageId: id,
    wixUrl: url,
    ready: true,
  };
}

test("manual media contract keeps Van Finance and Rent2Buy destinations explicit", () => {
  assert.equal(normaliseManualMediaPurpose("van_finance_replacement")?.siteScope, "van_finance");
  assert.equal(normaliseManualMediaPurpose("rent2buy_template")?.siteScope, "rent2buy");
  assert.equal(normaliseManualMediaPurpose("anything_else"), null);

  const environment = {
    WIX_API_KEY: "secret",
    WIX_SITE_ID: "vfc-site",
    WIX_RENT2BUY_SITE_ID: "legacy-r2b-site",
  };
  assert.equal(manualMediaSiteConfiguration("van_finance_replacement", environment).siteId, "vfc-site");
  assert.equal(manualMediaSiteConfiguration("rent2buy_template", environment).siteId, RENT2BUY_WIX_SITE_ID);
  assert.equal(manualMediaSiteConfiguration("rent2buy_template", environment).siteIdSource, "authoritative_van_finance_cms");
});

test("authoritative Rent2Buy CMS stays bound to the current Van Finance Wix site", () => {
  assert.equal(RENT2BUY_WIX_SITE_ID, "85f11c52-ee54-495d-aaec-a351831709b5");
});

test("manual upload accepts only the deliberately small image contract", () => {
  const valid = validateDealerKitManualMediaFile({ fileName: "finished showroom.jpg", mimeType: "image/jpeg", sizeInBytes: 2_000_000 });
  assert.equal(valid.valid, true);
  const tooLarge = validateDealerKitManualMediaFile({ fileName: "big.png", mimeType: "image/png", sizeInBytes: DEALERKIT_MANUAL_MEDIA_MAX_BYTES + 1 });
  assert.equal(tooLarge.valid, false);
  assert.match(tooLarge.errors.join(" "), /10 MB/i);
  const wrongType = validateDealerKitManualMediaFile({ fileName: "animation.gif", mimeType: "image/gif", sizeInBytes: 1000 });
  assert.equal(wrongType.valid, false);
  assert.match(wrongType.errors.join(" "), /JPEG, PNG or WebP/i);
});

test("Wix upload naming is registration and purpose specific without trusting the local path", () => {
  assert.equal(buildManualMediaUploadFileName({ registration: "HT22 KJX", purpose: "rent2buy_template", fileName: "C:\\Users\\Stu\\Desktop\\Rent2Buy Final.JPG" }), "HT22KJX-rent2buy_template.jpg");
});

test("verified Wix image metadata maps processing and selected state explicitly", () => {
  const baseRow = wixFileToManualMediaRow({
    decision: decision(),
    purpose: "rent2buy_template",
    siteId: "r2b-site",
    file: {
      id: "abc~mv2.jpg", displayName: "HT22KJX-rent2buy_template.jpg",
      url: "https://static.wixstatic.com/media/abc~mv2.jpg", thumbnailUrl: "https://static.wixstatic.com/media/abc~mv2.jpg",
      hash: "hash-123", sizeInBytes: "123456", mediaType: "IMAGE", operationStatus: "READY",
    },
  });
  const ready = manualMediaRowToClient({ ...baseRow, id: "row-1", selected_at: "2026-09-10T18:00:00.000Z" });
  assert.equal(ready.ready, true);
  assert.equal(ready.selected, true);
  assert.equal(ready.selectedAt, "2026-09-10T18:00:00.000Z");
  const pending = manualMediaRowToClient({ ...baseRow, id: "row-2", operation_status: "PENDING" });
  assert.equal(pending.processing, true);
  assert.equal(pending.selected, false);
  const failed = manualMediaRowToClient({ ...baseRow, id: "row-3", operation_status: "FAILED" });
  assert.equal(failed.failed, true);
});

test("selected Van Finance manual main replaces the DealerKit primary instead of prepending it", () => {
  const sets = buildProductImageSets({
    vehicle: {
      registration: "HT22KJX",
      images: [{ id: "image-1" }, { id: "image-2" }, { id: "image-3" }],
    },
    decision: {
      registration: "HT22KJX",
      primaryImageId: "image-1",
      imageOrderIds: ["image-1", "image-2", "image-3"],
      excludedImageIds: [],
      rent2buyEnabled: false,
    },
    importedDealerKitMedia: [
      importedMedia("image-1", "https://static.wixstatic.com/media/dealerkit-primary.jpg"),
      importedMedia("image-2", "https://static.wixstatic.com/media/dealerkit-two.jpg"),
      importedMedia("image-3", "https://static.wixstatic.com/media/dealerkit-three.jpg"),
    ],
    manualMediaReadiness: {
      selections: {
        van_finance_replacement: {
          selectedAndReady: true,
          url: "https://static.wixstatic.com/media/manual-main.jpg",
        },
      },
    },
  });

  assert.equal(sets.vanFinance.mainSource, "manual_replacement");
  assert.equal(sets.vanFinance.mainUrl, "https://static.wixstatic.com/media/manual-main.jpg");
  assert.deepEqual(sets.vanFinance.galleryUrls, [
    "https://static.wixstatic.com/media/manual-main.jpg",
    "https://static.wixstatic.com/media/dealerkit-two.jpg",
    "https://static.wixstatic.com/media/dealerkit-three.jpg",
  ]);
  assert.equal(sets.vanFinance.galleryUrls.includes("https://static.wixstatic.com/media/dealerkit-primary.jpg"), false);
});

test("selected Rent2Buy template replaces its DealerKit primary without changing Finance gallery state", () => {
  const sets = buildProductImageSets({
    vehicle: {
      registration: "HT22KJX",
      images: [{ id: "image-1" }, { id: "image-2" }],
    },
    decision: {
      registration: "HT22KJX",
      primaryImageId: "image-1",
      imageOrderIds: ["image-1", "image-2"],
      excludedImageIds: [],
      rent2buyEnabled: true,
    },
    importedDealerKitMedia: [
      importedMedia("image-1", "https://static.wixstatic.com/media/dealerkit-primary.jpg"),
      importedMedia("image-2", "https://static.wixstatic.com/media/dealerkit-two.jpg"),
    ],
    manualMediaReadiness: {
      selections: {
        rent2buy_template: {
          selectedAndReady: true,
          url: "https://static.wixstatic.com/media/r2b-template.jpg",
        },
      },
    },
  });

  assert.deepEqual(sets.vanFinance.galleryUrls, [
    "https://static.wixstatic.com/media/dealerkit-primary.jpg",
    "https://static.wixstatic.com/media/dealerkit-two.jpg",
  ]);
  assert.deepEqual(sets.rent2buy.galleryUrls, [
    "https://static.wixstatic.com/media/r2b-template.jpg",
    "https://static.wixstatic.com/media/dealerkit-two.jpg",
  ]);
  assert.equal(sets.rent2buy.galleryUrls.includes("https://static.wixstatic.com/media/dealerkit-primary.jpg"), false);
});

test("manual media constants stay bound to the verified Wix Media endpoints", () => {
  assert.equal(DEALERKIT_MANUAL_MEDIA_TABLE, "dealerkit_review_manual_media");
  assert.equal(WIX_MEDIA_GENERATE_UPLOAD_URL, "/site-media/v1/files/generate-upload-url");
  assert.equal(WIX_MEDIA_GET_FILE_URL, "/site-media/v1/files/get-file-by-id");
});

test("manual media API preserves the access-first and media-only boundary", async () => {
  const source = await readFile(new URL("api/dealerkit-wix-manual-media.js", root), "utf8");
  assert.match(source, /if \(!authorised\(request\)\)[\s\S]*response\.status\(401\)/);
  assert.match(source, /vehicleWritesAttempted:\s*false/);
  assert.match(source, /cmsWritesAttempted:\s*false/);
  assert.match(source, /categoryWritesAttempted:\s*false/);
  assert.match(source, /fetchDealerKitStockDetail/);
  assert.doesNotMatch(source, /wix-data\/v2\/items\/(insert|update|remove)/i);
});

test("selection rechecks DealerKit identity, site identity and Wix READY before saving", async () => {
  const source = await readFile(new URL("api/dealerkit-wix-manual-media.js", root), "utf8");
  assert.match(source, /action === "select_media"/);
  assert.match(source, /getVerifiedWixFile\(configuration, stored\.wix_file_id\)/);
  assert.match(source, /operationStatus !== "READY"/);
  assert.match(source, /stored\.supplier_stock_id/);
  assert.match(source, /stored\.wix_site_id/);
  assert.match(source, /selected_at:\s*null/);
  assert.match(source, /selected_at:\s*selectedAt/);
  assert.match(source, /selectionOnly:\s*true/);
});

test("manual media browser flow uploads bytes only to Wix and offers explicit main-image selection", async () => {
  const source = await readFile(new URL("utils/dealerKitWixManualMedia.js", root), "utf8");
  assert.match(source, /fetch\(prepared\.uploadUrl/);
  assert.match(source, /method:\s*"PUT"/);
  assert.match(source, /body:\s*file/);
  assert.match(source, /action:\s*"refresh_status"/);
  assert.match(source, /action:\s*"select_media"/);
  assert.match(source, /Use this image/);
  assert.match(source, /SELECTED AS MAIN|Chosen for publish/);
  assert.match(source, /This saves the media choice only/i);
  assert.doesNotMatch(source, /supabase/i);
});
