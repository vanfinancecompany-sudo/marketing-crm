import fs from "node:fs";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url));
const financeWixPath = fileURLToPath(new URL("../api/finance-reserved-wix-stock.js", import.meta.url));

function replaceOnceIn(source, before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`DealerKit Finance Wix truth fix could not find ${label}.`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`DealerKit Finance Wix truth fix found duplicate ${label}.`);
  }
  return source.replace(before, after);
}

// Finance Wix stock rows can store the registration in vehicleRegistration.
// Keep the per-card nine-collection checker aligned with the authoritative Wix
// listing-presence reader. Without this field the UI can falsely say Not live
// for every collection and correctly, but unnecessarily, withhold the Draft action.
let financeWixSource = fs.readFileSync(financeWixPath, "utf8");
const registrationTruthMarker = "FINANCE_WIX_VEHICLE_REGISTRATION_TRUTH";
if (!financeWixSource.includes(registrationTruthMarker)) {
  financeWixSource = replaceOnceIn(
    financeWixSource,
    `function itemRegistration(item) {\n  const data = item?.data || {};\n  return normalizeRegistration(data.title || data.registration || data.reg || "");\n}`,
    `function itemRegistration(item) {\n  const data = item?.data || {};\n  // ${registrationTruthMarker}: mirror the authoritative listing-presence reader.\n  return normalizeRegistration(data.title || data.registration || data.reg || data.vehicleRegistration || "");\n}`,
    "Finance Wix registration reader",
  );
  fs.writeFileSync(financeWixPath, financeWixSource);
}

let source = fs.readFileSync(pagePath, "utf8");
const hideMarker = "DEALERKIT_MISSING_WIX_HIDE_SUPPRESSION";
if (!source.includes(hideMarker)) {
  source = replaceOnceIn(
    source,
    `  const displayRecords = useMemo(() => localLoadError ? [] : [...imageReadyRecords, ...activeRecords, ...localNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, imageReadyRecords, localLoadError, localNotVanscoRecords, priceDifferenceRecords]);`,
    `  // ${hideMarker}: once a reverse-check card is deliberately hidden, keep it out of the working reverse-stock lane.\n  const hiddenReverseRegistrationSet = useMemo(() => new Set(currentRawRecords.filter((record) => isTemporaryHiddenStatus(workflowStatusOf(record))).map((record) => normalizeWatchRegistration(record.registration)).filter(Boolean)), [currentRawRecords]);\n  const visibleLocalNotVanscoRecords = useMemo(() => localNotVanscoRecords.filter((record) => !hiddenReverseRegistrationSet.has(normalizeWatchRegistration(record.registration))), [hiddenReverseRegistrationSet, localNotVanscoRecords]);\n  const displayRecords = useMemo(() => localLoadError ? [] : [...imageReadyRecords, ...activeRecords, ...visibleLocalNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, imageReadyRecords, localLoadError, visibleLocalNotVanscoRecords, priceDifferenceRecords]);`,
    "final display-record composition",
  );

  source = replaceOnceIn(
    source,
    `    localNotVansco: localNotVanscoRecords.length,`,
    `    localNotVansco: visibleLocalNotVanscoRecords.length,`,
    "reverse-check summary count",
  );

  fs.writeFileSync(pagePath, source);
}

const finalFinanceWixSource = fs.readFileSync(financeWixPath, "utf8");
const finalPageSource = fs.readFileSync(pagePath, "utf8");
for (const required of [registrationTruthMarker, "data.vehicleRegistration"]) {
  if (!finalFinanceWixSource.includes(required)) throw new Error(`Finance Wix truth fix is missing ${required}.`);
}
for (const required of [
  "mergePublishedListingVehicles(pipeline, vehicles, presence.vehicles || [])",
  "DEALERKIT_MISSING_WIX_CONTROLS",
  hideMarker,
]) {
  if (!finalPageSource.includes(required)) throw new Error(`DealerKit Stock Watch Finance Wix truth fix is missing ${required}.`);
}

console.log("Applied Finance Wix truth fix: reserved cards recognise vehicleRegistration, published Wix vehicles remain the reverse-check authority, and hidden reverse cards stay suppressed.");
