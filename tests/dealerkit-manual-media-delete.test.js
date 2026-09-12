import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);

function read(path) {
  return fs.readFileSync(new URL(path, root), "utf8");
}

test("manual media API removes only the exact reviewed vehicle workspace record", () => {
  const api = read("api/dealerkit-wix-manual-media.js");
  assert.match(api, /async function removeUpload\(\{ request, supabase, registration \}\)/);
  assert.match(api, /action === "remove_media"/);
  assert.match(api, /loadManualMediaById\(supabase, registration, request\.body\?\.mediaId\)/);
  assert.match(api, /stored\.supplier_stock_id[\s\S]{0,220}decision\.supplierStockId/);
  assert.match(api, /stored\.wix_site_id[\s\S]{0,220}configuration\.siteId/);
  assert.match(api, /\.delete\(\)[\s\S]{0,500}\.eq\("id", stored\.id\)[\s\S]{0,500}\.eq\("registration", registration\)[\s\S]{0,500}\.eq\("supplier_stock_id", decision\.supplierStockId\)[\s\S]{0,500}\.eq\("purpose", purpose\.key\)/);
});

test("manual media removal deliberately leaves the underlying Wix Media asset untouched", () => {
  const api = read("api/dealerkit-wix-manual-media.js");
  assert.match(api, /workspaceOnly:\s*true/);
  assert.match(api, /wixFileDeleted:\s*false/);
  assert.doesNotMatch(api, /site-media\/v1\/files\/(?:remove|delete|trash)/i);
  assert.match(api, /vehicleWritesAttempted:\s*false/);
  assert.match(api, /cmsWritesAttempted:\s*false/);
});

test("uploaded product image cards offer deletion including the current PRODUCT PRIMARY", () => {
  const ui = read("utils/dealerKitProductGalleryWorkspace.js");
  assert.match(ui, /is-delete-action", "Delete image"/);
  assert.match(ui, /action:\s*"remove_media",\s*mediaId:\s*item\.id/);
  assert.match(ui, /This is currently PRODUCT PRIMARY/);
  assert.match(ui, /DealerKit source primary will take over automatically/);
  assert.match(ui, /state\.manualMedia = state\.manualMedia\.filter\(\(value\) => value\?\.id !== item\.id\)/);
  assert.match(ui, /The Wix Media file itself is left untouched/);
});

test("DealerKit source photo cards remain selection controls rather than destructive delete controls", () => {
  const ui = read("utils/dealerKitProductGalleryWorkspace.js");
  const sourceStart = ui.indexOf("function sourceCard(");
  const sourceEnd = ui.indexOf("async function refreshOneManual", sourceStart);
  assert.ok(sourceStart >= 0 && sourceEnd > sourceStart);
  const sourceCard = ui.slice(sourceStart, sourceEnd);
  assert.match(sourceCard, /Use image/);
  assert.match(sourceCard, /Set source primary/);
  assert.doesNotMatch(sourceCard, /Delete image|remove_media/);
});

test("delete control is visibly destructive without changing the primary action styling", () => {
  const css = read("styles/dealerkit-product-gallery-workspace.css");
  assert.match(css, /\.dealerkit-product-gallery__mini-button\.is-delete-action/);
  assert.match(css, /color:\s*#b91c1c/);
  assert.match(css, /\.dealerkit-product-gallery__mini-button\.is-primary-action/);
});
