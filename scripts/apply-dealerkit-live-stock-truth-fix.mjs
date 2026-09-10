import fs from "node:fs";
import { fileURLToPath } from "node:url";

function patchFile(relativePath, patches) {
  const targetPath = fileURLToPath(new URL(relativePath, import.meta.url));
  let source = fs.readFileSync(targetPath, "utf8");

  for (const { label, before, after, already } of patches) {
    if (already && source.includes(already)) continue;
    const first = source.indexOf(before);
    if (first === -1) throw new Error(`DealerKit live-stock truth fix could not find ${relativePath}: ${label}`);
    if (source.indexOf(before, first + before.length) !== -1) {
      throw new Error(`DealerKit live-stock truth fix found duplicate anchor in ${relativePath}: ${label}`);
    }
    source = source.replace(before, after);
  }

  fs.writeFileSync(targetPath, source);
}

patchFile("../pages/VanscoStockWatchPage.jsx", [
  {
    label: "all three product lanes use Wix presence",
    already: 'if (pipeline === "finance" || pipeline === "rent2buy" || pipeline === "cars") {',
    before: 'if (pipeline === "cars" || pipeline === "rent2buy") {',
    after: 'if (pipeline === "finance" || pipeline === "rent2buy" || pipeline === "cars") {',
  },
  {
    label: "Wix registrations are authoritative rather than CRM intersection",
    already: "effectiveRegistrations = (presence.registrations || []).map(normalizeLocalStockRegistration).filter(Boolean);\n            const liveRegistrationSet = new Set(effectiveRegistrations);",
    before: "const liveRegistrationSet = new Set((presence.registrations || []).map(normalizeLocalStockRegistration).filter(Boolean));\n            effectiveRegistrations = vehicleRegistrations.filter((registration) => liveRegistrationSet.has(registration));",
    after: "effectiveRegistrations = (presence.registrations || []).map(normalizeLocalStockRegistration).filter(Boolean);\n            const liveRegistrationSet = new Set(effectiveRegistrations);",
  },
  {
    label: "partial Wix presence fails closed",
    already: "Live Wix listing presence was only partially checked. Stock Watch classification is paused for this tab",
    before: 'presenceWarning = "Live Wix listing presence was only partially checked, so Stock Watch is temporarily using the Marketing CRM stock fallback.";',
    after: 'presenceWarning = "Live Wix listing presence was only partially checked. Stock Watch classification is paused for this tab rather than falling back to CRM stock.";\n            effectiveRegistrations = [];\n            effectiveVehicles = [];',
  },
  {
    label: "failed Wix presence fails closed",
    already: "Could not confirm live Wix listing presence. Stock Watch classification is paused for this tab",
    before: 'presenceWarning = `Could not confirm live Wix listing presence, so Stock Watch is temporarily using the Marketing CRM stock fallback: ${presenceError?.message || "Wix check failed."}`;',
    after: 'presenceWarning = `Could not confirm live Wix listing presence. Stock Watch classification is paused for this tab: ${presenceError?.message || "Wix check failed."}`;\n          effectiveRegistrations = [];\n          effectiveVehicles = [];',
  },
  {
    label: "Cars never borrow Finance listing presence",
    already: "const financeRegistrationsForCars = new Set();",
    before: 'const financeRegistrationsForCars = selectedPipeline === "cars" ? localRegistrationsByPipeline.finance || new Set() : new Set();',
    after: 'const financeRegistrationsForCars = new Set();',
  },
  {
    label: "do not load Finance as Cars authority",
    already: "// Cars has its own published CARFINANCE authority; never borrow Finance presence.",
    before: '    if (selectedPipeline === "cars") loadLocalStock("finance", () => active).catch(() => null);',
    after: '    // Cars has its own published CARFINANCE authority; never borrow Finance presence.',
  },
  {
    label: "Cars gets Review vehicle",
    already: '(selectedPipeline === "finance" || selectedPipeline === "rent2buy" || selectedPipeline === "cars")',
    before: '(selectedPipeline === "finance" || selectedPipeline === "rent2buy")',
    after: '(selectedPipeline === "finance" || selectedPipeline === "rent2buy" || selectedPipeline === "cars")',
  },
  {
    label: "pause cards when Wix authority is unavailable",
    already: "const displayRecords = useMemo(() => localLoadError ? [] : [...imageReadyRecords",
    before: 'const displayRecords = useMemo(() => [...imageReadyRecords, ...activeRecords, ...localNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, imageReadyRecords, localNotVanscoRecords, priceDifferenceRecords]);',
    after: 'const displayRecords = useMemo(() => localLoadError ? [] : [...imageReadyRecords, ...activeRecords, ...localNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, imageReadyRecords, localLoadError, localNotVanscoRecords, priceDifferenceRecords]);',
  },
]);

patchFile("../api/dealerkit-stock-detail.js", [
  {
    label: "Cars can open the DealerKit detail workspace",
    already: '["finance", "rent2buy", "cars"].includes(clean(request.query?.product, 30).toLowerCase())',
    before: 'const requestedProduct = clean(request.query?.product, 30).toLowerCase() === "rent2buy" ? "rent2buy" : "finance";',
    after: 'const requestedProduct = ["finance", "rent2buy", "cars"].includes(clean(request.query?.product, 30).toLowerCase())\n      ? clean(request.query?.product, 30).toLowerCase()\n      : "finance";',
  },
]);

patchFile("../utils/dealerKitReviewWorkspace.js", [
  {
    label: "Cars review label",
    already: 'state.product === "cars" ? "Cars" : state.product === "rent2buy" ? "Rent2Buy" : "Van Finance"',
    before: 'state.product === "rent2buy" ? "Rent2Buy" : "Van Finance"',
    after: 'state.product === "cars" ? "Cars" : state.product === "rent2buy" ? "Rent2Buy" : "Van Finance"',
  },
  {
    label: "Cars have no van category selector",
    already: "Cars are reviewed against the published CARFINANCE listing lane",
    before: '  const categories = element("div", "dealerkit-review__category-block");',
    after: '  if (state.product === "cars") {\n    const carNote = element("div", "dealerkit-review__category-block");\n    carNote.appendChild(element("strong", "", "Cars listing lane"));\n    carNote.appendChild(element("p", "", "Cars are reviewed against the published CARFINANCE listing lane. Van Finance and Rent2Buy categories do not apply."));\n    section.appendChild(carNote);\n\n    const notesLabel = element("label", "dealerkit-review__field dealerkit-review__notes");\n    notesLabel.appendChild(element("span", "", "Review notes"));\n    const notes = document.createElement("textarea");\n    notes.rows = 3;\n    notes.maxLength = 2000;\n    notes.placeholder = "Optional note about this car or its images";\n    notes.value = state.notes;\n    notes.addEventListener("input", () => { state.notes = notes.value; });\n    notesLabel.appendChild(notes);\n    section.appendChild(notesLabel);\n    return section;\n  }\n\n  const categories = element("div", "dealerkit-review__category-block");',
  },
  {
    label: "Cars render as Cars product",
    already: 'const product = ["finance", "rent2buy", "cars"].includes(workspace.dataset.product) ? workspace.dataset.product : "finance";',
    before: 'const product = workspace.dataset.product === "rent2buy" ? "rent2buy" : "finance";',
    after: 'const product = ["finance", "rent2buy", "cars"].includes(workspace.dataset.product) ? workspace.dataset.product : "finance";',
  },
  {
    label: "Cars local card label",
    already: 'localCard(product === "cars" ? "Cars" : product === "rent2buy" ? "Rent2Buy" : "Van Finance", local[product])',
    before: 'localCard(product === "rent2buy" ? "Rent2Buy" : "Van Finance", local[product])',
    after: 'localCard(product === "cars" ? "Cars" : product === "rent2buy" ? "Rent2Buy" : "Van Finance", local[product])',
  },
  {
    label: "Cars save reviewed source selection",
    already: "Saved Cars review. Nothing has been published.",
    before: '  if (vehicle.attentionGrabber || vehicle.description) {',
    after: '  if (product === "cars") {\n    const carFooter = element("section", "dealerkit-review__section dealerkit-review__decision-footer");\n    const carMessage = element("div", "dealerkit-review__decision-state", state.persisted ? "Saved Cars review. Nothing has been published." : "Review the car and images, then save. Nothing publishes from this button.");\n    const carSave = element("button", "dealerkit-review__save", "Save");\n    carSave.type = "button";\n    carSave.addEventListener("click", async () => {\n      carSave.disabled = true;\n      carSave.textContent = "Saving…";\n      carMessage.textContent = "Saving Cars review…";\n      try {\n        state.reviewStatus = "reviewed";\n        state.financeEnabled = false;\n        state.rent2buyEnabled = false;\n        const payload = await saveReviewDecision(vehicle, state);\n        const saved = payload?.decision || {};\n        state.persisted = true;\n        state.reviewStatus = saved.reviewStatus || "reviewed";\n        state.reviewedSourceUpdatedAt = saved.reviewedSourceUpdatedAt || vehicle.sourceUpdatedAt || null;\n        state.updatedAt = saved.updatedAt || new Date().toISOString();\n        const savedState = body.querySelector(".dealerkit-review__decisions .dealerkit-review__decision-state");\n        if (savedState) savedState.textContent = `Saved ${formatSavedAt(state.updatedAt)}`;\n        carMessage.textContent = "Saved Cars review. Nothing has been published.";\n      } catch (error) {\n        carMessage.textContent = error?.message || "Could not save Cars review.";\n      } finally {\n        carSave.disabled = false;\n        carSave.textContent = "Save";\n      }\n    });\n    carFooter.append(carMessage, carSave);\n    body.appendChild(carFooter);\n  }\n\n  if (vehicle.attentionGrabber || vehicle.description) {',
  },
  {
    label: "Cars lane wording",
    already: 'product === "cars" ? "Cars" : product === "rent2buy" ? "Rent2Buy" : "Van Finance"',
    before: 'product === "rent2buy" ? "Rent2Buy" : "Van Finance"',
    after: 'product === "cars" ? "Cars" : product === "rent2buy" ? "Rent2Buy" : "Van Finance"',
  },
  {
    label: "Cars workspace product identity",
    already: '["finance", "rent2buy", "cars"].includes(product) ? product : "finance"',
    before: 'workspace.dataset.product = product === "rent2buy" ? "rent2buy" : "finance";',
    after: 'workspace.dataset.product = ["finance", "rent2buy", "cars"].includes(product) ? product : "finance";',
  },
]);

patchFile("../utils/dealerKitProductGalleryWorkspace.js", [
  {
    label: "Cars do not accidentally inherit Finance/Rent2Buy gallery state",
    already: 'if (workspace.dataset.product === "cars") return;',
    before: '    const body = workspace.querySelector("[data-dealerkit-review-body]");',
    after: '    if (workspace.dataset.product === "cars") return;\n    const body = workspace.querySelector("[data-dealerkit-review-body]");',
  },
]);

patchFile("../utils/dealerKitControlledPublish.js", [
  {
    label: "typed registration placeholder is visibly a prompt",
    already: 'input.placeholder = `Type ${registration} here`;',
    before: 'input.placeholder = registration;',
    after: 'input.placeholder = `Type ${registration} here`;',
  },
  {
    label: "publish summary counts writes rather than pretending detail refresh is a create",
    already: '`Records to write: ${plan.targets?.length || 0}`',
    before: '`Records to create: ${plan.targets?.length || 0}`',
    after: '`Records to write: ${plan.targets?.length || 0}`',
  },
  {
    label: "Cars do not inherit Van Finance controlled publish panel",
    already: 'if (workspace.dataset.product === "cars") return;\n  const gallery = workspace.querySelector("[data-dealerkit-product-gallery]");',
    before: '  if (!workspace || workspace.hidden) return;\n  const gallery = workspace.querySelector("[data-dealerkit-product-gallery]");',
    after: '  if (!workspace || workspace.hidden) return;\n  if (workspace.dataset.product === "cars") return;\n  const gallery = workspace.querySelector("[data-dealerkit-product-gallery]");',
  },
]);

console.log("Applied DealerKit live-stock truth fix: published master listings only, no CRM fallback, Cars review enabled, historical detail pages kept out of live-stock authority, and typed-registration UI clarified.");
