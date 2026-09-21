import fs from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return { path, source: fs.readFileSync(path, "utf8") };
}

function replaceSection(relativePath, startMarker, endMarker, replacement, label, alreadyMarker = "") {
  const { path, source: original } = read(relativePath);
  if (original.includes("VFC_CREATE_OR_UPDATE_RECONCILE")) return;
  if (alreadyMarker && original.includes(alreadyMarker)) return;
  const start = original.indexOf(startMarker);
  if (start === -1) throw new Error(`Existing-media refresh transform could not find ${label} start in ${relativePath}.`);
  const end = original.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`Existing-media refresh transform could not find ${label} end in ${relativePath}.`);
  const source = `${original.slice(0, start)}${replacement}${original.slice(end)}`;
  fs.writeFileSync(path, source);
}

function replaceOnce(relativePath, before, after, label, alreadyMarker = "") {
  const { path, source: original } = read(relativePath);
  if (original.includes("VFC_CREATE_OR_UPDATE_RECONCILE")) return;
  if (alreadyMarker && original.includes(alreadyMarker)) return;
  const first = original.indexOf(before);
  if (first === -1) throw new Error(`Existing-media refresh transform could not find ${label} in ${relativePath}.`);
  if (original.indexOf(before, first + before.length) !== -1) throw new Error(`Existing-media refresh transform found duplicate ${label} in ${relativePath}.`);
  fs.writeFileSync(path, original.replace(before, after));
}

const plannerPath = "../lib/dealerKitControlledPublishPlan.js";
const vfcReplacement = `// EXISTING_MEDIA_REFRESH: existing advertised vehicles update media fields only; no listing is recreated.\nfunction existingItems(entry = {}) {\n  return Array.isArray(entry?.items) ? entry.items : [];\n}\n\nfunction mediaUpdateTarget(target, existingItem, data) {\n  return {\n    ...target,\n    operation: "update",\n    itemId: clean(existingItem?.id, 300),\n    previousData: stableValue(existingItem?.data || {}),\n    data: stableValue(data || {}),\n  };\n}\n\nfunction vfcMediaFields(collectionId, images = {}) {\n  if (collectionId === "VANFINANCEPAGES") {\n    return {\n      mainImages: [...(images.galleryUrls || [])],\n      imageCount: String(images.galleryUrls?.length || 0),\n    };\n  }\n  return { picture: images.listingImageUrl };\n}\n\nexport function buildControlledVfcTargets({ vehicle = {}, decision = {}, imageSets = {}, wixResults = [] } = {}) {\n  const blockers = [];\n  const selection = selectedDealerKitFinanceCollections(decision);\n  const byCollection = new Map((wixResults || []).map((entry) => [entry?.collection?.id || entry?.collectionId, entry]));\n  const images = imageSets.vanFinance || {};\n  const masterItems = existingItems(byCollection.get("VANFINANCE-ALLVANS"));\n  const refreshExisting = masterItems.length === 1;\n\n  if (!images.ready || !images.mainUrl || !images.galleryUrls?.length) blockers.push({ code: "vfc_media_not_ready", message: "Van Finance main image and gallery must be READY in Wix Media before a controlled write." });\n  if (selection.unsupportedCategories?.length) blockers.push({ code: "vfc_category_unmapped", message: \`Unsupported Van Finance categories: \${selection.unsupportedCategories.join(", ")}.\` });\n\n  if (refreshExisting) {\n    const targets = [];\n    for (const entry of wixResults || []) {\n      const id = entry?.collection?.id || entry?.collectionId || "";\n      const items = existingItems(entry);\n      if (!id || !items.length) continue;\n      if (items.length > 1) {\n        blockers.push({ code: "vfc_existing_ambiguous", message: \`\${id} contains \${items.length} published rows for this registration. Resolve the duplicate before updating images.\` });\n        continue;\n      }\n      const collection = entry.collection || { id, kind: id === "VANFINANCEPAGES" ? "detail" : "listing" };\n      targets.push(mediaUpdateTarget({ collectionId: id, kind: collection.kind || (id === "VANFINANCEPAGES" ? "detail" : "listing") }, items[0], vfcMediaFields(id, images)));\n    }\n\n    if (!targets.some((target) => target.collectionId === "VANFINANCE-ALLVANS")) blockers.push({ code: "vfc_refresh_master_missing", message: "The existing Van Finance master listing could not be verified for this registration." });\n    if (!targets.some((target) => target.collectionId === "VANFINANCEPAGES")) blockers.push({ code: "vfc_refresh_detail_missing", message: "The existing Van Finance vehicle page could not be verified for this registration." });\n\n    return {\n      registration: normalizeFinanceRegistration(vehicle.registration || decision.registration || ""),\n      targets: uniqueByCollection(targets),\n      blockers,\n      writeIntent: "update_existing_vehicle",\n      canPublish: blockers.length === 0 && targets.some((target) => target.collectionId === "VANFINANCE-ALLVANS") && targets.some((target) => target.collectionId === "VANFINANCEPAGES"),\n    };\n  }\n\n  for (const entry of wixResults || []) {\n    const existing = existingItems(entry);\n    const id = entry?.collection?.id || entry?.collectionId || "Van Finance collection";\n    if (id === "VANFINANCEPAGES") {\n      if (existing.length > 1) blockers.push({ code: "vfc_detail_ambiguous", message: \`\${id} contains \${existing.length} published detail rows for this registration. Resolve the duplicate detail pages before publishing.\` });\n      continue;\n    }\n    if (existing.length) blockers.push({ code: existing.length > 1 ? "vfc_duplicate_existing" : "vfc_existing_anywhere", message: \`\${id} already contains \${existing.length} published listing row(s) for this registration. New-vehicle publishing is blocked.\` });\n  }\n\n  const targets = [];\n  for (const collectionId of selection.collectionIds || []) {\n    const entry = byCollection.get(collectionId) || {};\n    const collection = entry.collection || { id: collectionId, kind: collectionId === "VANFINANCEPAGES" ? "detail" : "listing" };\n    const create = buildDealerKitWixCreatePlan({ collection, vehicle, decision, selectedImages: { ids: imageSets.dealerKitImageIds || [], count: imageSets.dealerKitImageIds?.length || 0 } });\n    for (const item of create.blockers || []) blockers.push({ code: \`vfc_\${item.code}\`, message: \`\${collectionId}: \${item.message}\` });\n    const data = { ...(create.proposedFields || {}) };\n    if (collectionId === "VANFINANCEPAGES") {\n      data.mainImages = images.galleryUrls;\n      data.descriptionLine = clean(vehicle.attentionGrabber, 1000) || clean(vehicle.title, 1000);\n      data.vehicleDescriptionTextClick = vfcDescription(vehicle);\n      data.imageCount = String(images.galleryUrls.length);\n    } else data.picture = images.listingImageUrl;\n\n    let target = { collectionId, kind: collectionId === "VANFINANCEPAGES" ? "detail" : "listing", operation: "create", data };\n    if (collectionId === "VANFINANCEPAGES") {\n      const existingDetail = publishedMatch(entry);\n      if (existingDetail) target = detailUpdateTarget(target, existingDetail);\n    }\n    targets.push(target);\n  }\n\n  return {\n    registration: normalizeFinanceRegistration(vehicle.registration || decision.registration || ""),\n    targets: uniqueByCollection(targets),\n    blockers,\n    writeIntent: "create_new_vehicle",\n    canPublish: blockers.length === 0 && targets.some((target) => target.collectionId === "VANFINANCE-ALLVANS") && targets.some((target) => target.collectionId === "VANFINANCEPAGES"),\n  };\n}\n\n`;
replaceSection(
  plannerPath,
  "export function buildControlledVfcTargets(",
  "function controlledMode(",
  vfcReplacement,
  "Van Finance controlled target planner",
  "// EXISTING_MEDIA_REFRESH: existing advertised vehicles update media fields only",
);

const rentStart = "  const sites = normalizedRent2BuySites(rent2buySites);";
const rentEnd = "  const targets = [";
const rentReplacement = `  const sites = normalizedRent2BuySites(rent2buySites);\n  const rent2buyTargets = [];\n  if (rent2buy.enabled) {\n    for (const site of sites) {\n      const siteLabel = site.siteLabel || site.siteId || "Rent2Buy Wix";\n      const siteTargets = (rent2buy.targets || []).map((target) => rent2BuyTargetForSite(target, site, rent2buy.pricing));\n      const siteResults = (rent2buyWixResults || []).filter((entry) => resultBelongsToSite(entry, site, sites.length));\n      const resultByCollection = new Map(siteResults.map((entry) => [entry?.collectionId || entry?.collection?.id, entry]));\n      const masterItems = existingItems(resultByCollection.get("ALLRENT2BUYVANS"));\n      const refreshExisting = masterItems.length === 1;\n\n      if (refreshExisting) {\n        for (const entry of siteResults) {\n          const id = entry?.collectionId || entry?.collection?.id || "";\n          const items = existingItems(entry);\n          if (!id || !items.length) continue;\n          if (items.length > 1) {\n            blockers.push({ code: "rent2buy_existing_ambiguous", message: \`\${siteLabel} / \${id} contains \${items.length} published rows for \${registration}. Resolve the duplicate before updating images.\` });\n            continue;\n          }\n          const planned = siteTargets.find((target) => target.collectionId === id);\n          const kind = id === "VANPAGES" ? "detail" : "listing";\n          let data = {};\n          if (kind === "detail") {\n            data = { mediaGallery: [...(imageSets.rent2buy?.galleryUrls || [])], numberOfImages: String(imageSets.rent2buy?.galleryUrls?.length || 0) };\n          } else {\n            const desired = planned?.data || {};\n            if (Object.prototype.hasOwnProperty.call(desired, "image")) data.image = imageSets.rent2buy?.listingImageUrl || imageSets.rent2buy?.mainUrl;\n            else data.picture = imageSets.rent2buy?.listingImageUrl || imageSets.rent2buy?.mainUrl;\n          }\n          rent2buyTargets.push(mediaUpdateTarget({ collectionId: id, kind, siteId: site.siteId || null, siteLabel: site.siteLabel || null, siteRole: site.siteRole || null }, items[0], data));\n        }\n        const matchingSiteTargets = rent2buyTargets.filter((target) => clean(target.siteId, 500) === site.siteId || (sites.length === 1 && !site.siteId));\n        if (!matchingSiteTargets.some((target) => target.collectionId === "ALLRENT2BUYVANS")) blockers.push({ code: "rent2buy_refresh_master_missing", message: \`\${siteLabel} / ALLRENT2BUYVANS could not be verified for \${registration}.\` });\n        if (!matchingSiteTargets.some((target) => target.collectionId === "VANPAGES")) blockers.push({ code: "rent2buy_refresh_detail_missing", message: \`\${siteLabel} / VANPAGES could not be verified for \${registration}.\` });\n        continue;\n      }\n\n      for (const entry of siteResults) {\n        const existing = existingItems(entry);\n        const id = entry?.collectionId || entry?.collection?.id || "Rent2Buy collection";\n        if (id === "VANPAGES") {\n          if (existing.length > 1) {\n            blockers.push({ code: "rent2buy_detail_ambiguous", message: \`\${siteLabel} / \${id} contains \${existing.length} published Rent2Buy detail rows for \${registration}. Resolve the duplicate detail pages before publishing.\` });\n          } else if (existing.length === 1) {\n            const index = siteTargets.findIndex((target) => target.collectionId === "VANPAGES");\n            if (index >= 0) siteTargets[index] = detailUpdateTarget(siteTargets[index], existing[0]);\n          }\n          continue;\n        }\n        if (existing.length) blockers.push({ code: existing.length > 1 ? "rent2buy_duplicate_existing" : "rent2buy_existing_anywhere", message: \`\${siteLabel} / \${id} already contains \${existing.length} published Rent2Buy listing row(s) for \${registration}. New-vehicle publishing is blocked.\` });\n      }\n      rent2buyTargets.push(...siteTargets);\n    }\n  }\n\n`;
replaceSection(
  plannerPath,
  rentStart,
  rentEnd,
  rentReplacement,
  "Rent2Buy controlled target planner",
  "const resultByCollection = new Map(siteResults.map",
);

replaceOnce(
  plannerPath,
  `  return {\n    version: 4,`,
  `  const hasCreateTargets = targets.some((target) => target.operation !== "update");\n  const hasUpdateTargets = targets.some((target) => target.operation === "update");\n  const mixedWriteIntent = hasCreateTargets && hasUpdateTargets;\n  if (mixedWriteIntent) blockers.push({ code: "mixed_write_intent", message: "Creating a new vehicle and refreshing an existing vehicle cannot be combined in one controlled write. Run each product separately." });\n  const writeIntent = hasUpdateTargets && !hasCreateTargets ? "update_existing_vehicle" : "create_new_vehicle";\n\n  return {\n    version: 4,`,
  "controlled write intent",
  "const mixedWriteIntent = hasCreateTargets && hasUpdateTargets;",
);

replaceOnce(
  plannerPath,
  `    newVehicleOnly: true,`,
  `    newVehicleOnly: writeIntent === "create_new_vehicle",\n    writeIntent,`,
  "plan write intent output",
  `newVehicleOnly: writeIntent === "create_new_vehicle"`,
);

replaceOnce(
  plannerPath,
  `    mode: plan.mode || null,\n    registration: plan.registration,`,
  `    mode: plan.mode || null,\n    writeIntent: plan.writeIntent || "create_new_vehicle",\n    registration: plan.registration,`,
  "confirmation write intent",
  `writeIntent: plan.writeIntent || "create_new_vehicle"`,
);

const apiPath = "../api/dealerkit-controlled-publish.js";
replaceOnce(
  apiPath,
  `  const action = clean(request.body?.action, 100);\n  if (action !== "publish_new_vehicle") return response.status(400).json({ ok: false, message: "Controlled publish action is not supported." });`,
  `  const action = clean(request.body?.action, 100);\n  if (!["publish_new_vehicle", "update_existing_vehicle"].includes(action)) return response.status(400).json({ ok: false, message: "Controlled publish action is not supported." });`,
  "controlled publish accepted actions",
  `["publish_new_vehicle", "update_existing_vehicle"].includes(action)`,
);
replaceOnce(
  apiPath,
  `    state = await buildFreshControlledPublishState(registration, process.env, { productMode });\n    if (!state.plan.canPublish) throw new ControlledPublishError(409, "The fresh DealerKit/Wix state is not safe for new-vehicle publishing.", { blockers: state.plan.blockers });`,
  `    state = await buildFreshControlledPublishState(registration, process.env, { productMode });\n    const requestedIntent = action === "update_existing_vehicle" ? "update_existing_vehicle" : "create_new_vehicle";\n    if (state.plan.writeIntent !== requestedIntent) throw new ControlledPublishError(409, "The Wix write intent changed during the final recheck. Rebuild the preview before continuing.", { expected: state.plan.writeIntent, requested: requestedIntent });\n    if (!state.plan.canPublish) throw new ControlledPublishError(409, requestedIntent === "update_existing_vehicle" ? "The fresh DealerKit/Wix state is not safe for an existing-vehicle image refresh." : "The fresh DealerKit/Wix state is not safe for new-vehicle publishing.", { blockers: state.plan.blockers });`,
  "server write-intent verification",
  "const requestedIntent = action === \"update_existing_vehicle\"",
);
replaceOnce(
  apiPath,
  `      newVehicleOnly: true,\n      registration,`,
  `      newVehicleOnly: state.plan.writeIntent === "create_new_vehicle",\n      writeIntent: state.plan.writeIntent,\n      registration,`,
  "response write intent",
  `writeIntent: state.plan.writeIntent,`,
);
replaceOnce(
  apiPath,
  `      message: \`${'${registration}'} was written and verified across ${'${writes.length}'} Wix CMS row(s): ${'${created.length}'} created, ${'${updated.length}'} existing detail page(s) refreshed.\`,`,
  `      message: state.plan.writeIntent === "update_existing_vehicle"\n        ? \`${'${registration}'} images were updated and verified across ${'${updated.length}'} existing Wix CMS row(s). No vehicle details or prices were changed.\`\n        : \`${'${registration}'} was written and verified across ${'${writes.length}'} Wix CMS row(s): ${'${created.length}'} created, ${'${updated.length}'} existing detail page(s) refreshed.\`,`,
  "success message",
  "No vehicle details or prices were changed.",
);

const uiPath = "../utils/dealerKitControlledPublish.js";
replaceOnce(
  uiPath,
  `  const statusText = plan.canPublish\n    ? "READY TO PUBLISH"`,
  `  const updateExisting = plan.writeIntent === "update_existing_vehicle";\n  const heading = root.querySelector(".dealerkit-wix-preview__copy strong");\n  if (heading) heading.textContent = updateExisting ? \`Update ${'${label}'} images\` : \`Publish to ${'${label}'}\`;\n  const applyButton = root.querySelector("[data-controlled-publish-apply]");\n  if (applyButton) applyButton.textContent = updateExisting ? "Update images" : \`Publish to ${'${label}'}\`;\n\n  const statusText = plan.canPublish\n    ? (updateExisting ? "READY TO UPDATE" : "READY TO PUBLISH")`,
  "UI existing-media intent",
  "const updateExisting = plan.writeIntent === \"update_existing_vehicle\";",
);
replaceOnce(
  uiPath,
  `    const approved = window.confirm(\`PUBLISH ${'${registration}'} TO LIVE ${'${labelText.toUpperCase()}'} WIX?\\n\\nThis is the final live-write confirmation.\`);`,
  `    const updateExisting = payload.plan.writeIntent === "update_existing_vehicle";\n    const approved = window.confirm(updateExisting\n      ? \`UPDATE ${'${registration}'} IMAGES ON LIVE ${'${labelText.toUpperCase()}'} WIX?\\n\\nOnly the verified image fields on existing rows will be changed.\`\n      : \`PUBLISH ${'${registration}'} TO LIVE ${'${labelText.toUpperCase()}'} WIX?\\n\\nThis is the final live-write confirmation.\`);`,
  "UI confirmation intent",
  "Only the verified image fields on existing rows will be changed.",
);
replaceOnce(
  uiPath,
  `        : { action: "publish_new_vehicle", registration, confirmRegistration: normaliseRegistration(input.value), productMode: root.dataset.product, confirmation: payload.plan.confirmation };`,
  `        : { action: updateExisting ? "update_existing_vehicle" : "publish_new_vehicle", registration, confirmRegistration: normaliseRegistration(input.value), productMode: root.dataset.product, confirmation: payload.plan.confirmation };`,
  "UI action intent",
  `action: updateExisting ? "update_existing_vehicle" : "publish_new_vehicle"`,
);
replaceOnce(
  uiPath,
  `      setStatus(root, published.verified ? "PUBLISHED + VERIFIED" : "CHECK RESULT", published.verified ? "is-good" : "is-warning");`,
  `      setStatus(root, published.verified ? (updateExisting ? "UPDATED + VERIFIED" : "PUBLISHED + VERIFIED") : "CHECK RESULT", published.verified ? "is-good" : "is-warning");`,
  "UI verified status",
  `updateExisting ? "UPDATED + VERIFIED" : "PUBLISHED + VERIFIED"`,
);
replaceOnce(
  uiPath,
  `      publish.textContent = \`Publish to ${'${labelText}'}\`;`,
  `      publish.textContent = payload?.plan?.writeIntent === "update_existing_vehicle" ? "Update images" : \`Publish to ${'${labelText}'}\`;`,
  "UI final button label",
  `payload?.plan?.writeIntent === "update_existing_vehicle" ? "Update images"`,
);

console.log("Applied the current DealerKit existing-vehicle controlled publish contract.");
