import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDealerKitWixManualMediaReadiness } from "../lib/dealerKitWixManualMediaReadiness.js";
import "./dealerkit-controlled-publish.test.js";

const root = new URL("../", import.meta.url);

test("manual media readiness only marks live verified READY images as eligible", () => {
  const readiness = buildDealerKitWixManualMediaReadiness([
    { id: "one", purpose: "rent2buy_template", wixFileId: "ready.jpg", operationStatus: "READY", liveOperationStatus: "READY", liveVerified: true, selected: true, selectedAt: "2026-09-10T18:00:00.000Z", liveVerifiedAt: "2026-09-10T18:01:00.000Z" },
    { id: "two", purpose: "van_finance_replacement", wixFileId: "pending.jpg", operationStatus: "READY", liveOperationStatus: "PENDING", liveVerified: true },
    { id: "three", purpose: "van_finance_replacement", wixFileId: "stale.jpg", operationStatus: "READY", liveVerified: false, liveVerificationError: "descriptor check failed" },
  ]);
  assert.equal(readiness.readOnly, true);
  assert.equal(readiness.total, 3);
  assert.equal(readiness.ready, 1);
  assert.equal(readiness.pending, 1);
  assert.equal(readiness.unverified, 1);
  assert.equal(readiness.selectedReady, 1);
  assert.equal(readiness.items[0].selectedAndReady, true);
  assert.equal(readiness.selections.rent2buy_template.id, "one");
});

test("a READY image remains a blocker until one main image is explicitly selected", () => {
  const readiness = buildDealerKitWixManualMediaReadiness([
    { id: "one", purpose: "rent2buy_template", operationStatus: "READY", liveVerified: true },
    { id: "two", purpose: "rent2buy_template", operationStatus: "READY", liveVerified: true },
  ]);
  assert.deepEqual(readiness.purposesNeedingSelection, ["rent2buy_template"]);
  assert.equal(readiness.selectionRequired, true);
  assert.equal(readiness.selectedReady, 0);
  assert.match(readiness.note, /select the intended image/i);
});

test("one selected READY image resolves that purpose deterministically", () => {
  const readiness = buildDealerKitWixManualMediaReadiness([
    { id: "one", purpose: "rent2buy_template", operationStatus: "READY", liveVerified: true, selected: true },
    { id: "two", purpose: "rent2buy_template", operationStatus: "READY", liveVerified: true },
  ]);
  assert.deepEqual(readiness.purposesNeedingSelection, []);
  assert.equal(readiness.selectionRequired, false);
  assert.equal(readiness.selectedReady, 1);
  assert.equal(readiness.selections.rent2buy_template.id, "one");
});

test("selected media that is no longer live READY is never treated as publishable", () => {
  const readiness = buildDealerKitWixManualMediaReadiness([
    { id: "one", purpose: "van_finance_replacement", operationStatus: "READY", liveOperationStatus: "FAILED", liveVerified: true, selected: true },
  ]);
  assert.equal(readiness.selectedInvalid, 1);
  assert.equal(readiness.selectedReady, 0);
  assert.equal(readiness.selections.van_finance_replacement, undefined);
});

test("publish preview rechecks staged media live and keeps it informational", async () => {
  const source = await readFile(new URL("api/dealerkit-wix-publish-preview.js", root), "utf8");
  assert.match(source, /WIX_MEDIA_GET_FILE_URL/);
  assert.match(source, /buildManualMediaSnapshot/);
  assert.match(source, /preview\.manualMediaReadiness\s*=\s*manualMediaReadiness/);
});

test("product gallery shows uploaded media in-place and labels the selected primary", async () => {
  const main = await readFile(new URL("main.jsx", root), "utf8");
  const renderer = await readFile(new URL("utils/dealerKitProductGalleryWorkspace.js", root), "utf8");
  assert.match(main, /dealerKitProductGalleryWorkspace\.js/);
  assert.match(renderer, /PRODUCT PRIMARY/);
  assert.match(renderer, /Set as primary/);
  assert.match(renderer, /manualHost\.appendChild\(manualCard/);
  assert.match(renderer, /Other product galleries are not changed/);
});
