import fs from "node:fs";
import { fileURLToPath } from "node:url";

const statePath = fileURLToPath(new URL("../api/_dealerkit-controlled-publish-state.js", import.meta.url));
let source = fs.readFileSync(statePath, "utf8");

if (!source.includes('import { registrationTitleVariants } from "../lib/wixRegistrationVariants.js";')) {
  const anchor = 'import { buildControlledPublishConfirmation, buildControlledVehiclePublishPlan } from "../lib/dealerKitControlledPublishPlan.js";';
  if (!source.includes(anchor)) throw new Error("DealerKit detail lookup import anchor changed.");
  source = source.replace(anchor, `${anchor}\nimport { registrationTitleVariants } from "../lib/wixRegistrationVariants.js";`);
}

const start = source.indexOf('async function queryRegistration(configuration, collectionId, registration, collection = null) {');
const end = source.indexOf('\nasync function verifyManualRow(', start);
if (start === -1 || end === -1) throw new Error("DealerKit detail registration lookup function anchors changed.");

const replacement = `async function queryRegistration(configuration, collectionId, registration, collection = null) {\n  const detailCollection = collectionId === "VANFINANCEPAGES" || collectionId === "VANPAGES";\n  const candidates = detailCollection ? registrationTitleVariants(registration) : [registration];\n  const matched = new Map();\n\n  for (const candidate of candidates) {\n    const payload = await controlledWixRequest(configuration, "/wix-data/v2/items/query", {\n      method: "POST",\n      body: { dataCollectionId: collectionId, query: { filter: { title: { $eq: candidate } }, paging: { limit: 3, offset: 0 } }, consistentRead: true },\n    });\n    for (const item of Array.isArray(payload.dataItems) ? payload.dataItems : []) {\n      if (normalizeFinanceRegistration(item?.data?.title || "") !== registration) continue;\n      const id = clean(item?.id, 300);\n      if (id) matched.set(id, item);\n    }\n    if (!detailCollection && matched.size) break;\n  }\n\n  return {\n    siteId: configuration.siteId,\n    siteLabel: configuration.siteLabel || null,\n    siteRole: configuration.siteRole || null,\n    collectionId,\n    collection: collection || { id: collectionId },\n    items: Array.from(matched.values()),\n  };\n}\n`;

source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
fs.writeFileSync(statePath, source);
console.log("Applied registration-variant lookup for DealerKit detail rows so spaced Wix titles resolve to the exact vehicle.");
