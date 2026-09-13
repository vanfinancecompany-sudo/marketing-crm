import fs from "node:fs";
import { fileURLToPath } from "node:url";

const controlledTestPath = fileURLToPath(new URL("../tests/dealerkit-controlled-publish.test.js", import.meta.url));
let controlledTestSource = fs.readFileSync(controlledTestPath, "utf8");

if (!controlledTestSource.includes('["publish_new_vehicle", "update_existing_vehicle"].includes(action)')) {
  const beforeTitle = 'test("final publisher requires confirmation, inserts only new rows, verifies and rolls back", async () => {';
  const afterTitle = 'test("final publisher requires confirmation, supports safe create or image-only update, verifies and rolls back", async () => {';
  const beforeAssertion = '  assert.match(source, /action !== "publish_new_vehicle"/);';
  const afterAssertion = '  assert.match(source, /\\["publish_new_vehicle", "update_existing_vehicle"\\]\\.includes\\(action\\)/);';
  if (!controlledTestSource.includes(beforeTitle) || !controlledTestSource.includes(beforeAssertion)) throw new Error("Controlled publish test contract anchors changed.");
  controlledTestSource = controlledTestSource.replace(beforeTitle, afterTitle).replace(beforeAssertion, afterAssertion);
  fs.writeFileSync(controlledTestPath, controlledTestSource);
}

const plannerPath = fileURLToPath(new URL("../lib/dealerKitControlledPublishPlan.js", import.meta.url));
let plannerSource = fs.readFileSync(plannerPath, "utf8");
const detailBlocker = '    if (!targets.some((target) => target.collectionId === "VANFINANCEPAGES")) blockers.push({ code: "vfc_refresh_detail_missing", message: "The existing Van Finance vehicle page could not be verified for this registration." });';
const updateCanPublish = '      canPublish: blockers.length === 0 && targets.some((target) => target.collectionId === "VANFINANCE-ALLVANS") && targets.some((target) => target.collectionId === "VANFINANCEPAGES"),';
const cardOnlyCanPublish = '      canPublish: blockers.length === 0 && targets.some((target) => target.collectionId === "VANFINANCE-ALLVANS"),';

if (plannerSource.includes(detailBlocker)) {
  plannerSource = plannerSource.replace(detailBlocker, '    // Existing legacy detail rows are optional for an image-only refresh. Verified listing rows can still be updated safely.');
}
if (plannerSource.includes(updateCanPublish)) {
  plannerSource = plannerSource.replace(updateCanPublish, cardOnlyCanPublish);
}
if (!plannerSource.includes(cardOnlyCanPublish)) throw new Error("Existing-media refresh could not relax the legacy Van Finance detail-row requirement.");
fs.writeFileSync(plannerPath, plannerSource);

const mediaTestPath = fileURLToPath(new URL("../tests/dealerkit-existing-media-refresh.test.js", import.meta.url));
let mediaTestSource = fs.readFileSync(mediaTestPath, "utf8");
const optionalDetailTestTitle = 'test("existing Finance card image refresh does not require a legacy detail row"';
if (!mediaTestSource.includes(optionalDetailTestTitle)) {
  mediaTestSource += `\n\ntest("existing Finance card image refresh does not require a legacy detail row", () => {\n  const wixResults = financeResults().filter((entry) => entry.collectionId !== "VANFINANCEPAGES");\n  const plan = buildControlledVfcTargets({\n    vehicle: vehicle(),\n    decision: decision(),\n    imageSets: imageSets(),\n    wixResults,\n  });\n\n  assert.equal(plan.writeIntent, "update_existing_vehicle");\n  assert.equal(plan.canPublish, true);\n  assert.ok(!plan.blockers.some((blocker) => blocker.code === "vfc_refresh_detail_missing"));\n  assert.deepEqual(plan.targets.map((target) => target.collectionId).sort(), ["VANFINANCE-ALLVANS", "VANFINANCE-TIPPERSDROPSIDEL"].sort());\n  assert.ok(plan.targets.every((target) => target.operation === "update"));\n});\n`;
  fs.writeFileSync(mediaTestPath, mediaTestSource);
}

console.log("Updated controlled publish contract: existing Van Finance card images can refresh safely even when no legacy detail row is present.");
