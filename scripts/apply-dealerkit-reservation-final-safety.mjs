import fs from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return { path, source: fs.readFileSync(path, "utf8") };
}

function replaceOnce(source, before, after, label, relativePath) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Final reservation safety transform could not find ${label} in ${relativePath}.`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Final reservation safety transform found duplicate ${label} in ${relativePath}.`);
  }
  return source.replace(before, after);
}

function replaceRegexOnce(source, pattern, after, label, relativePath) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  if (!matches || matches.length !== 1) {
    throw new Error(`Final reservation safety transform expected one ${label} in ${relativePath}, found ${matches?.length || 0}.`);
  }
  return source.replace(pattern, after);
}

const endpointConfigs = [
  {
    path: "../api/finance-reserved-wix-stock.js",
    name: "Finance",
    functionName: "unpublishReservedFinanceWixStock",
    previewFunction: "previewFinanceWixStock",
    mutationFunction: "setDraftMatch",
    noMatchesMessage: "This registration is not live in any approved Van Finance Wix stock collection.",
    successMessage: (count) => `Moved ${count} matching Van Finance Wix record(s) to draft.`,
    failureMessage: (count) => `${count} collection action(s) failed. Successful collections remain in draft; review the results before retrying.`,
    extraNoMatches: "      protectedCollection: preview.protectedCollection,",
    extraResult: "    protectedCollection: preview.protectedCollection,",
  },
  {
    path: "../api/car-reserved-wix-stock.js",
    name: "Car",
    functionName: "unpublishReservedCarWixStock",
    previewFunction: "previewCarWixStock",
    mutationFunction: "setDraftMatch",
    noMatchesMessage: "This registration is not live in CAR FINANCE. CAR PAGES remains protected and unchanged.",
    successMessage: (count) => `Moved ${count} matching CAR FINANCE record(s) to draft. CAR PAGES remained live and protected.`,
    failureMessage: (count) => `${count} CAR FINANCE action(s) failed. CAR PAGES remained protected and unchanged.`,
    extraNoMatches: "      protectedCollection: preview.protectedCollection,\n      safety: preview.safety,",
    extraResult: "    protectedCollection: preview.protectedCollection,\n    safety: preview.safety,",
  },
  {
    path: "../api/rent2buy-reserved-wix-stock.js",
    name: "Rent2Buy",
    functionName: "unpublishReservedRent2BuyWixStock",
    previewFunction: "previewRent2BuyWixStock",
    mutationFunction: "unpublishMatch",
    noMatchesMessage: "This registration is not live in any approved Rent2Buy listing/category collection in the authoritative VAN FINANCE Wix CMS.",
    successMessage: (count) => `Moved ${count} matching Rent2Buy listing/category record(s) to Draft in the authoritative VAN FINANCE Wix CMS. VAN PAGES remained live and protected.`,
    failureMessage: (count) => `${count} Rent2Buy collection action(s) failed in the authoritative CMS. Successful listing records remain in Draft; VAN PAGES remained protected.`,
    extraNoMatches: "      authority: \"VAN FINANCE Wix Rent2Buy CMS only\",\n      protectedCollection: preview.protectedCollection,",
    extraResult: "    authority: \"VAN FINANCE Wix Rent2Buy CMS only\",\n    protectedCollection: preview.protectedCollection,",
  },
];

for (const config of endpointConfigs) {
  const { path, source: original } = read(config.path);
  if (original.includes("FINAL_DEALERKIT_RESERVATION_SAFETY")) continue;
  let source = original;

  const verificationImport = 'import { verifyDealerKitReservedRegistration } from "./_dealerkit-reservation-verification.js";';
  source = replaceOnce(
    source,
    verificationImport,
    `${verificationImport}\nimport { finalDealerKitVerificationError, prepareDealerKitReservedWixMutation } from "./_dealerkit-reservation-mutation-safety.js";`,
    "DealerKit verification import",
    config.path,
  );

  source = replaceRegexOnce(
    source,
    /  const payload = await response\.json\(\);\n  return Array\.isArray\(payload\?\.dataItems\) \? payload\.dataItems : \[\];/,
    `  const payload = await response.json();\n  if (!Array.isArray(payload?.dataItems)) {\n    throw new Error(\`Could not safely read the Wix collection because Wix returned an invalid data response.\`);\n  }\n  return payload.dataItems;`,
    "Wix query response validation",
    config.path,
  );

  source = replaceOnce(
    source,
    "    if (page.length < PAGE_SIZE) break;",
    "    if (page.length < PAGE_SIZE) break;\n    if (offset + PAGE_SIZE >= MAX_ROWS_PER_COLLECTION) {\n      throw new Error(`Could not fully read ${collectionId}: the Wix collection exceeded the safe Stock Watch row limit.`);\n    }",
    "Wix query completeness limit",
    config.path,
  );

  const functionBody = `export async function ${config.functionName}(registrationValue, { supplierStockId = "", verifyDealerKit, loadPreview, mutateMatch } = {}) {
  const prepared = await prepareDealerKitReservedWixMutation({
    registrationValue,
    supplierStockId,
    verifyDealerKit,
    loadPreview: loadPreview || ${config.previewFunction},
  });
  const { registration, supplierStockId: stockId, dealerKit: vansco, preview, verifyDealerKit: verifyReservation } = prepared;
  const mutate = mutateMatch || ${config.mutationFunction};

  if (!preview.matches.length) {
    return {
      ok: true,
      registration,
      vansco,
      changed: 0,
      results: [],
      message: ${JSON.stringify(config.noMatchesMessage)},
${config.extraNoMatches}
    };
  }

  const results = [];
  let verificationStopped = false;
  for (const match of preview.matches) {
    let finalDealerKit;
    try {
      finalDealerKit = await verifyReservation(registration, { supplierStockId: stockId });
    } catch (error) {
      verificationStopped = true;
      results.push({ ok: false, safetyStop: true, ...match, error: finalDealerKitVerificationError(error) });
      break;
    }

    try {
      results.push({ ok: true, ...(await mutate(match)), finalDealerKit });
    } catch (error) {
      results.push({ ok: false, ...match, error: clean(error?.message || error || "Could not move the Wix item to draft.") });
    }
  }

  const failures = results.filter((result) => !result.ok);
  const lastFailure = failures[failures.length - 1];
  return {
    ok: failures.length === 0,
    registration,
    vansco,
    changed: results.filter((result) => result.ok).length,
    results,
    failures: failures.length,
${config.extraResult}
    message: verificationStopped
      ? \`Safety stop: DealerKit could not be verified immediately before the next Wix change. No further Wix records were changed. \${lastFailure?.error || ""}\`.trim()
      : failures.length
        ? \`${config.failureMessage("${failures.length}")}\`
        : \`${config.successMessage("${results.length}")}\`,
  };
}`;

  source = replaceRegexOnce(
    source,
    new RegExp(`export async function ${config.functionName}\\(registrationValue\\) \\{[\\s\\S]*?\\n\\}\\n\\nfunction isMarketingStockWatchAuthorized`),
    `${functionBody}\n\nfunction isMarketingStockWatchAuthorized`,
    `${config.name} reservation mutation function`,
    config.path,
  );

  source = replaceOnce(
    source,
    "  const registration = request.body?.registration;",
    "  const registration = request.body?.registration;\n  const supplierStockId = clean(request.body?.supplier_stock_id || request.body?.supplierStockId); // FINAL_DEALERKIT_RESERVATION_SAFETY",
    `${config.name} request identity`,
    config.path,
  );
  source = replaceOnce(
    source,
    `await ${config.functionName}(registration)`,
    `await ${config.functionName}(registration, { supplierStockId })`,
    `${config.name} handler mutation call`,
    config.path,
  );

  fs.writeFileSync(path, source);
}

{
  const relativePath = "../pages/VanscoStockWatchPage.jsx";
  const { path, source: original } = read(relativePath);
  if (!original.includes("FINAL_DEALERKIT_RESERVATION_UI_SAFETY")) {
    let source = original;
    source = replaceOnce(
      source,
      "function WatchCard({ record, selectedPipeline, onRecordSaved }) {",
      "// FINAL_DEALERKIT_RESERVATION_UI_SAFETY: destructive actions retain the exact current DealerKit stock identity.\nfunction WatchCard({ record, selectedPipeline, onRecordSaved }) {",
      "Stock Watch card",
      relativePath,
    );
    for (const name of ["Finance", "Car", "Rent2Buy"]) {
      const preview = `previewReserved${name}WixStock(record.registration)`;
      const unpublish = `unpublishReserved${name}WixStock(record.registration)`;
      const previewCount = source.split(preview).length - 1;
      if (previewCount !== 2) throw new Error(`Final reservation safety transform expected two ${name} preview calls, found ${previewCount}.`);
      source = source.split(preview).join(`previewReserved${name}WixStock(record.registration, record.supplierStockId)`);
      source = replaceOnce(
        source,
        unpublish,
        `unpublishReserved${name}WixStock(record.registration, record.supplierStockId)`,
        `${name} unpublish call`,
        relativePath,
      );
    }
    source = source.replace(
      /const show(Finance|Car|Rent2Buy)ReservedWix = ([^;]+) && Boolean\(normalizeWatchRegistration\(record\.registration\)\);/g,
      "const show$1ReservedWix = $2 && Boolean(normalizeWatchRegistration(record.registration) && record.supplierStockId);",
    );
    fs.writeFileSync(path, source);
  }
}

console.log("Applied final DealerKit reservation safety: complete Wix reads, exact stock identity and per-write DealerKit rechecks.");
