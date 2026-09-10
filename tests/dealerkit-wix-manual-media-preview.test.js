import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDealerKitWixManualMediaReadiness } from "../lib/dealerKitWixManualMediaReadiness.js";

const root = new URL("../", import.meta.url);

test("manual media readiness only marks live verified READY images as eligible", () => {
  const readiness = buildDealerKitWixManualMediaReadiness([
    {
      id: "one",
      purpose: "rent2buy_template",
      wixFileId: "ready.jpg",
      operationStatus: "READY",
      liveOperationStatus: "READY",
      liveVerified: true,
      liveVerifiedAt: "2026-09-10T17:00:00.000Z",
    },
    {
      id: "two",
      purpose: "van_finance_replacement",
      wixFileId: "pending.jpg",
      operationStatus: "READY",
      liveOperationStatus: "PENDING",
      liveVerified: true,
      liveVerifiedAt: "2026-09-10T17:00:00.000Z",
    },
    {
      id: "three",
      purpose: "van_finance_replacement",
      wixFileId: "stale.jpg",
      operationStatus: "READY",
      liveVerified: false,
      liveVerificationError: "descriptor check failed",
    },
  ]);

  assert.equal(readiness.readOnly, true);
  assert.equal(readiness.affectsPublishReadiness, false);
  assert.equal(readiness.total, 3);
  assert.equal(readiness.ready, 1);
  assert.equal(readiness.pending, 1);
  assert.equal(readiness.unverified, 1);
  assert.equal(readiness.items[0].eligibleForLaterSelection, true);
  assert.equal(readiness.items[1].eligibleForLaterSelection, false);
  assert.equal(readiness.items[2].eligibleForLaterSelection, false);
});

test("multiple READY images for one purpose require an explicit later choice", () => {
  const readiness = buildDealerKitWixManualMediaReadiness([
    { id: "one", purpose: "rent2buy_template", operationStatus: "READY", liveVerified: true },
    { id: "two", purpose: "rent2buy_template", operationStatus: "READY", liveVerified: true },
  ]);

  assert.deepEqual(readiness.purposesNeedingSelection, ["rent2buy_template"]);
  assert.equal(readiness.selectionRequired, true);
  assert.match(readiness.note, /no item is selected or attached automatically/i);
});

test("publish preview rechecks staged media live and keeps it informational", async () => {
  const source = await readFile(new URL("api/dealerkit-wix-publish-preview.js", root), "utf8");
  assert.match(source, /WIX_MEDIA_GET_FILE_URL/);
  assert.match(source, /buildManualMediaSnapshot/);
  assert.match(source, /preview\.manualMediaReadiness\s*=\s*manualMediaReadiness/);
  assert.doesNotMatch(source, /manualMediaReadiness[\s\S]{0,200}canPublishLater\s*=/);
});

test("browser loads the staged media handoff beside the existing publish preview", async () => {
  const main = await readFile(new URL("main.jsx", root), "utf8");
  const renderer = await readFile(new URL("utils/dealerKitWixManualMediaPreview.js", root), "utf8");
  assert.match(main, /dealerKitWixManualMediaPreview\.js/);
  assert.match(renderer, /Staged manual Wix media/);
  assert.match(renderer, /READ-ONLY/);
  assert.match(renderer, /CRM will not pick one automatically/i);
});
