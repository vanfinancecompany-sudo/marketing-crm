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

// Finance Wix stock rows commonly store the registration in vehicleRegistration.
// The reserved-card checker must read the same registration fields as the
// authoritative live-listing endpoint or it can falsely report every collection
// as Not live and withhold the safe Draft control.
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

// The earlier authoritative-presence transforms correctly replace Finance's
// registration set with published VANFINANCE-ALLVANS registrations, but the
// reverse-check vehicle list was still only the intersection with Marketing CRM
// rows. That makes a genuinely live Wix van disappear from "My stock not on
// DealerKit" as soon as its supporting CRM row is absent/stale. Build the
// Finance reverse lane from Wix presence vehicles themselves, enriching them
// with CRM details only when a matching supporting row exists.
let source = fs.readFileSync(pagePath, "utf8");
const financePresenceMarker = "FINANCE_WIX_PRESENCE_VEHICLE_AUTHORITY";
if (!source.includes(financePresenceMarker)) {
  source = replaceOnceIn(
    source,
    `            effectiveVehicles = vehicles.filter((vehicle) => {\n              const registration = normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);\n              return Boolean(registration && liveRegistrationSet.has(registration));\n            });`,
    `            if (pipeline === "finance") {\n              // ${financePresenceMarker}: Wix live rows drive the Finance reverse-check lane.\n              const supportingVehiclesByRegistration = new Map();\n              vehicles.forEach((vehicle) => {\n                const registration = normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);\n                if (registration && !supportingVehiclesByRegistration.has(registration)) {\n                  supportingVehiclesByRegistration.set(registration, vehicle);\n                }\n              });\n              effectiveVehicles = (presence.vehicles || []).map((wixVehicle) => {\n                const registration = normalizeLocalStockRegistration(wixVehicle.registration || wixVehicle.reg || wixVehicle.title || wixVehicle.name);\n                const supportingVehicle = supportingVehiclesByRegistration.get(registration) || {};\n                return {\n                  ...supportingVehicle,\n                  ...wixVehicle,\n                  registration,\n                  reg: supportingVehicle.reg || registration,\n                  title: supportingVehicle.title || supportingVehicle.name || wixVehicle.title || registration,\n                  name: supportingVehicle.name || supportingVehicle.title || wixVehicle.title || registration,\n                  weblink: supportingVehicle.weblink || supportingVehicle.webLink || supportingVehicle.link || "",\n                  webLink: supportingVehicle.webLink || supportingVehicle.weblink || supportingVehicle.link || "",\n                  image: supportingVehicle.image || supportingVehicle.picture || supportingVehicle.imageUrl || supportingVehicle.image_url || wixVehicle.image || wixVehicle.imageUrl || "",\n                  imageUrl: supportingVehicle.imageUrl || supportingVehicle.image || supportingVehicle.picture || supportingVehicle.image_url || wixVehicle.imageUrl || wixVehicle.image || "",\n                };\n              }).filter((vehicle) => Boolean(vehicle.registration));\n            } else {\n              effectiveVehicles = vehicles.filter((vehicle) => {\n                const registration = normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);\n                return Boolean(registration && liveRegistrationSet.has(registration));\n              });\n            }`,
    "authoritative Finance reverse-check vehicle list",
  );
  fs.writeFileSync(pagePath, source);
}

// PR #495's controlled Finance Wix buttons were authored as a separate transform
// but were not in the build chain. Apply that transform here, after all of the
// existing Stock Watch truth/safety transforms, so the buttons are generated
// against the final page shape and remain read-first / fail-closed.
await import("./apply-dealerkit-missing-wix-controls.mjs");

source = fs.readFileSync(pagePath, "utf8");
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
for (const required of [financePresenceMarker, "DEALERKIT_MISSING_WIX_CONTROLS", hideMarker]) {
  if (!finalPageSource.includes(required)) throw new Error(`DealerKit Stock Watch Finance Wix truth fix is missing ${required}.`);
}

console.log("Applied Finance Wix truth fixes: reserved cards recognise vehicleRegistration, Finance reverse-check rows come from live Wix presence, PR #495 controls are in the build, and hidden reverse cards stay suppressed.");
