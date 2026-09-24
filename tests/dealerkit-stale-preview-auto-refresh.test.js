import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  describeConfirmationChanges,
  isRefreshableFinalCheckError,
} from "../utils/dealerKitControlledPublish.js";

test("final-check stale/write-intent responses are refreshable but real publish failures are not", () => {
  const stale = new Error("The publish preview is stale. Rebuild the final preview before publishing.");
  stale.type = "preview_stale";
  assert.equal(isRefreshableFinalCheckError(stale), true);

  const cars = new Error("The Cars publish preview is stale. Rebuild the final preview before publishing.");
  assert.equal(isRefreshableFinalCheckError(cars), true);

  const intent = new Error("The Wix write intent changed during the final recheck. Rebuild the preview before continuing.");
  intent.type = "write_intent_changed";
  assert.equal(isRefreshableFinalCheckError(intent), true);

  assert.equal(isRefreshableFinalCheckError(new Error("Wix reconciliation failed and rollback needs attention.")), false);
});

test("automatic refresh explains meaningful snapshot changes without inventing changes", () => {
  const before = {
    writeIntent: "update_existing_vehicle",
    sourceUpdatedAt: "2026-09-24T13:30:00.000Z",
    reviewUpdatedAt: "2026-09-24T13:31:00.000Z",
    dealerKitImageIds: ["1", "2"],
    vfcMainImage: "wix:image://old",
    targetPayloads: [{ collectionId: "VANFINANCE-ALLVANS", data: { price: "£20,000" } }],
  };
  assert.deepEqual(describeConfirmationChanges(before, structuredClone(before)), []);

  const after = structuredClone(before);
  after.sourceUpdatedAt = "2026-09-24T13:32:00.000Z";
  after.dealerKitImageIds = ["1", "2", "3"];
  after.vfcMainImage = "wix:image://new";
  after.targetPayloads[0].data.price = "£20,500";

  assert.deepEqual(
    describeConfirmationChanges(before, after),
    ["DealerKit source", "selected images", "primary image", "Wix rows/fields"],
  );
});

test("Van Finance, Rent2Buy and Cars share automatic stale-preview recovery while keeping the final human click", async () => {
  const root = new URL("../", import.meta.url);
  const [ui, vans, cars] = await Promise.all([
    readFile(new URL("utils/dealerKitControlledPublish.js", root), "utf8"),
    readFile(new URL("api/dealerkit-controlled-publish.js", root), "utf8"),
    readFile(new URL("api/dealerkit-car-controlled-publish.js", root), "utf8"),
  ]);

  assert.match(ui, /\["finance", "rent2buy", "cars"\]/);
  assert.match(ui, /if \(isRefreshableFinalCheckError\(error\)\)/);
  assert.match(ui, /await loadPreview\(root, \{ force: true \}\)/);
  assert.match(ui, /Nothing was published\. Review the fresh plan and press the publish\/reconcile button again/);
  assert.doesNotMatch(ui, /isRefreshableFinalCheckError\(error\)[\s\S]{0,1000}fetch\(endpoint/);

  assert.match(vans, /code: "preview_stale"/);
  assert.match(vans, /code: "write_intent_changed"/);
  assert.match(vans, /error_type: clean\(error\?\.details\?\.code, 100\)/);

  assert.match(cars, /code: "preview_stale"/);
  assert.match(cars, /code: "write_intent_changed"/);
  assert.match(cars, /error_type: clean\(error\?\.details\?\.code, 100\)/);
});
