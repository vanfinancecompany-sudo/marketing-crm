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

const root = new URL("../", import.meta.url);

function decision() {
  return {
    supplierStockId: "stock-123",
    registration: "HT22KJX",
  };
}

test("manual media contract keeps Van Finance and Rent2Buy destinations explicit", () => {
  assert.equal(normaliseManualMediaPurpose("van_finance_replacement")?.siteScope, "van_finance");
  assert.equal(normaliseManualMediaPurpose("rent2buy_template")?.siteScope, "rent2buy");
  assert.equal(normaliseManualMediaPurpose("anything_else"), null);

  const environment = {
    WIX_API_KEY: "secret",
    WIX_SITE_ID: "vfc-site",
    WIX_RENT2BUY_SITE_ID: "r2b-site",
  };
  assert.equal(manualMediaSiteConfiguration("van_finance_replacement", environment).siteId, "vfc-site");
  assert.equal(manualMediaSiteConfiguration("rent2buy_template", environment).siteId, "r2b-site");
});

test("manual upload accepts only the deliberately small image contract", () => {
  const valid = validateDealerKitManualMediaFile({
    fileName: "finished showroom.jpg",
    mimeType: "image/jpeg",
    sizeInBytes: 2_000_000,
  });
  assert.equal(valid.valid, true);

  const tooLarge = validateDealerKitManualMediaFile({
    fileName: "big.png",
    mimeType: "image/png",
    sizeInBytes: DEALERKIT_MANUAL_MEDIA_MAX_BYTES + 1,
  });
  assert.equal(tooLarge.valid, false);
  assert.match(tooLarge.errors.join(" "), /10 MB/i);

  const wrongType = validateDealerKitManualMediaFile({
    fileName: "animation.gif",
    mimeType: "image/gif",
    sizeInBytes: 1000,
  });
  assert.equal(wrongType.valid, false);
  assert.match(wrongType.errors.join(" "), /JPEG, PNG or WebP/i);
});

test("Wix upload naming is registration and purpose specific without trusting the local path", () => {
  assert.equal(
    buildManualMediaUploadFileName({
      registration: "HT22 KJX",
      purpose: "rent2buy_template",
      fileName: "C:\\Users\\Stu\\Desktop\\Rent2Buy Final.JPG",
    }),
    "HT22KJX-rent2buy_template.jpg",
  );
});

test("verified Wix image metadata maps READY, PENDING and FAILED states explicitly", () => {
  const baseRow = wixFileToManualMediaRow({
    decision: decision(),
    purpose: "rent2buy_template",
    siteId: "r2b-site",
    file: {
      id: "abc~mv2.jpg",
      displayName: "HT22KJX-rent2buy_template.jpg",
      url: "https://static.wixstatic.com/media/abc~mv2.jpg",
      thumbnailUrl: "https://static.wixstatic.com/media/abc~mv2.jpg",
      hash: "hash-123",
      sizeInBytes: "123456",
      mediaType: "IMAGE",
      operationStatus: "READY",
    },
  });
  assert.equal(baseRow.supplier_stock_id, "stock-123");
  assert.equal(baseRow.site_scope, "rent2buy");
  assert.equal(baseRow.operation_status, "READY");

  const ready = manualMediaRowToClient({ ...baseRow, id: "row-1" });
  assert.equal(ready.ready, true);
  assert.equal(ready.failed, false);
  assert.equal(ready.processing, false);
  assert.ok(ready.verifiedAt);

  const pending = manualMediaRowToClient({ ...baseRow, id: "row-2", operation_status: "PENDING" });
  assert.equal(pending.ready, false);
  assert.equal(pending.failed, false);
  assert.equal(pending.processing, true);

  const failed = manualMediaRowToClient({ ...baseRow, id: "row-3", operation_status: "FAILED" });
  assert.equal(failed.ready, false);
  assert.equal(failed.failed, true);
  assert.equal(failed.processing, false);
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
  assert.match(source, /WIX_MEDIA_GET_FILE_URL/);
  assert.doesNotMatch(source, /wix-data\/v2\/items\/(insert|update|remove)/i);
});

test("status refresh is an explicit Wix read plus metadata-only update", async () => {
  const source = await readFile(new URL("api/dealerkit-wix-manual-media.js", root), "utf8");
  assert.match(source, /action === "refresh_status"/);
  assert.match(source, /loadManualMediaById/);
  assert.match(source, /stored\.supplier_stock_id/);
  assert.match(source, /stored\.wix_site_id/);
  assert.match(source, /getVerifiedWixFile\(configuration, stored\.wix_file_id\)/);
  assert.match(source, /statusRefreshOnly:\s*true/);
});

test("manual media browser flow uploads bytes only to Wix and rechecks processing items", async () => {
  const source = await readFile(new URL("utils/dealerKitWixManualMedia.js", root), "utf8");
  assert.match(source, /fetch\(prepared\.uploadUrl/);
  assert.match(source, /method:\s*"PUT"/);
  assert.match(source, /body:\s*file/);
  assert.match(source, /action:\s*"refresh_status"/);
  assert.match(source, /media\.filter\(processing\)\.slice\(0, 4\)/);
  assert.match(source, /Check Wix status/);
  assert.match(source, /WIX MEDIA FAILED/);
  assert.match(source, /This uploads media only/i);
  assert.doesNotMatch(source, /supabase/i);
});
