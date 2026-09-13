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

const statePath = fileURLToPath(new URL("../api/_dealerkit-controlled-publish-state.js", import.meta.url));
let stateSource = fs.readFileSync(statePath, "utf8");
const variantImport = 'import { registrationTitleVariants } from "../lib/wixRegistrationVariants.js";';
if (!stateSource.includes(variantImport)) {
  const importAnchor = 'import { buildControlledPublishConfirmation, buildControlledVehiclePublishPlan } from "../lib/dealerKitControlledPublishPlan.js";';
  if (!stateSource.includes(importAnchor)) throw new Error("DealerKit detail lookup import anchor changed.");
  stateSource = stateSource.replace(importAnchor, `${importAnchor}\n${variantImport}`);
}

if (!stateSource.includes('const candidates = detailCollection ? registrationTitleVariants(registration) : [registration];')) {
  const startMarker = 'async function queryRegistration(configuration, collectionId, registration, collection = null) {';
  const endMarker = '\nasync function verifyManualRow(';
  const start = stateSource.indexOf(startMarker);
  const end = stateSource.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error("DealerKit detail registration lookup function anchors changed.");
  const replacement = `async function queryRegistration(configuration, collectionId, registration, collection = null) {\n  const detailCollection = collectionId === "VANFINANCEPAGES" || collectionId === "VANPAGES";\n  const candidates = detailCollection ? registrationTitleVariants(registration) : [registration];\n  const matched = new Map();\n\n  for (const candidate of candidates) {\n    const payload = await controlledWixRequest(configuration, "/wix-data/v2/items/query", {\n      method: "POST",\n      body: { dataCollectionId: collectionId, query: { filter: { title: { $eq: candidate } }, paging: { limit: 3, offset: 0 } }, consistentRead: true },\n    });\n    for (const item of Array.isArray(payload.dataItems) ? payload.dataItems : []) {\n      if (normalizeFinanceRegistration(item?.data?.title || "") !== registration) continue;\n      const id = clean(item?.id, 300);\n      if (id) matched.set(id, item);\n    }\n    if (!detailCollection && matched.size) break;\n  }\n\n  return {\n    siteId: configuration.siteId,\n    siteLabel: configuration.siteLabel || null,\n    siteRole: configuration.siteRole || null,\n    collectionId,\n    collection: collection || { id: collectionId },\n    items: Array.from(matched.values()),\n  };\n}\n`;
  stateSource = `${stateSource.slice(0, start)}${replacement}${stateSource.slice(end)}`;
  fs.writeFileSync(statePath, stateSource);
}

const mediaTestPath = fileURLToPath(new URL("../tests/dealerkit-existing-media-refresh.test.js", import.meta.url));
let mediaTestSource = fs.readFileSync(mediaTestPath, "utf8");
const testMarker = 'test("spaced Wix detail registrations are found before the gallery refresh is allowed"';
if (!mediaTestSource.includes(testMarker)) {
  mediaTestSource += `\n\ntest("spaced Wix detail registrations are found before the gallery refresh is allowed", async () => {\n  const { registrationTitleVariants } = await import("../lib/wixRegistrationVariants.js");\n  assert.ok(registrationTitleVariants("BD21HCX").includes("BD21 HCX"));\n  const stateSource = fs.readFileSync(new URL("../api/_dealerkit-controlled-publish-state.js", import.meta.url), "utf8");\n  assert.match(stateSource, /registrationTitleVariants\\(registration\\)/);\n  assert.match(stateSource, /normalizeFinanceRegistration\\(item\\?\\.data\\?\\.title \\|\\| ""\\) !== registration/);\n});\n\ntest("existing Finance image refresh fails closed if the vehicle-page row is genuinely absent", () => {\n  const wixResults = financeResults().filter((entry) => entry.collectionId !== "VANFINANCEPAGES");\n  const plan = buildControlledVfcTargets({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), wixResults });\n  assert.equal(plan.writeIntent, "update_existing_vehicle");\n  assert.equal(plan.canPublish, false);\n  assert.ok(plan.blockers.some((blocker) => blocker.code === "vfc_refresh_detail_missing"));\n});\n`;
  fs.writeFileSync(mediaTestPath, mediaTestSource);
}

console.log("Updated controlled publish contract and spaced Wix detail lookup for complete existing-vehicle gallery refreshes.");
