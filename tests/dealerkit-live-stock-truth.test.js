import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

test("final Stock Watch uses live Wix listing presence for Finance, Rent2Buy and Cars", () => {
  const page = read("pages/VanscoStockWatchPage.jsx");

  assert.match(page, /pipeline === "finance" \|\| pipeline === "rent2buy" \|\| pipeline === "cars"/);
  assert.match(page, /effectiveRegistrations = \(presence\.registrations \|\| \[\]\)\.map\(normalizeLocalStockRegistration\)\.filter\(Boolean\)/);
  assert.doesNotMatch(page, /effectiveRegistrations = vehicleRegistrations\.filter\(\(registration\) => liveRegistrationSet\.has\(registration\)\)/);
  assert.match(page, /const financeRegistrationsForCars = new Set\(\);/);
  assert.match(page, /Cars has its own published CARFINANCE authority; never borrow Finance presence/);
  assert.match(page, /selectedPipeline === "finance" \|\| selectedPipeline === "rent2buy" \|\| selectedPipeline === "cars"/);
  assert.match(page, /const displayRecords = useMemo\(\(\) => localLoadError \? \[\] :/);
  assert.match(page, /Stock Watch classification is paused for this tab rather than falling back to CRM stock/);
});

test("Cars can open, save and use a Cars-specific controlled publish lane without inheriting van product galleries", () => {
  const detailApi = read("api/dealerkit-stock-detail.js");
  const review = read("utils/dealerKitReviewWorkspace.js");
  const productGallery = read("utils/dealerKitProductGalleryWorkspace.js");
  const controlledPublish = read("utils/dealerKitControlledPublish.js");

  assert.match(detailApi, /\["finance", "rent2buy", "cars"\]\.includes/);
  assert.match(review, /Cars are reviewed against the published CARFINANCE listing lane/);
  assert.match(review, /Saved Cars review\. Nothing has been published\./);
  assert.match(review, /\["finance", "rent2buy", "cars"\]\.includes\(product\)/);
  assert.match(productGallery, /if \(workspace\.dataset\.product === "cars"\) return;/);
  assert.match(controlledPublish, /dealerkit-car-controlled-publish-preview/);
  assert.match(controlledPublish, /dealerkit-car-controlled-publish/);
  assert.match(controlledPublish, /publish_new_car/);
  assert.doesNotMatch(controlledPublish, /if \(workspace\.dataset\.product === "cars"\) return;/);
});

test("typed registration gate is visibly empty and historical detail pages are reusable", () => {
  const ui = read("utils/dealerKitControlledPublish.js");
  const plan = read("lib/dealerKitControlledPublishPlan.js");
  const publisher = read("api/dealerkit-controlled-publish.js");

  assert.match(ui, /input\.placeholder = `Type \$\{registration\} here`/);
  assert.match(ui, /Records to write/);
  assert.match(plan, /id === "VANFINANCEPAGES"/);
  assert.match(plan, /id === "VANPAGES"/);
  assert.match(plan, /detailUpdateTarget/);
  assert.match(plan, /operation: "update"/);
  assert.match(publisher, /method: "PATCH"/);
  assert.match(publisher, /rollbackCreatedAndUpdated/);
});
