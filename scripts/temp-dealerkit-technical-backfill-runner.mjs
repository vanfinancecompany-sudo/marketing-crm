import { fetchDealerKitStockSnapshot } from "../api/_dealerkit-stock-adapter.js";
import { controlledWixConfiguration, controlledWixRequest } from "../api/_dealerkit-controlled-publish-state.js";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { EXPECTED_CARS_COUNT, EXPECTED_FINANCE_COUNT } from "../lib/_tempDealerKitTechnicalBackfill.js";

const EXPECTED_BRANCH = "fix/dealerkit-complete-vehicle-specifications";
const PAGE_SIZE = 100;
const MAX_COLLECTION_ITEMS = 2500;
const EQUIPMENT_FIELDS = Object.freeze([
  "audioAndCommunications",
  "driversAssistance",
  "exterior",
  "illumination",
  "interior",
  "performance",
  "safetyAndSecurity",
]);
const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function isTargetPreview(environment = process.env) {
  return environment.VERCEL_ENV === "preview" && environment.VERCEL_GIT_COMMIT_REF === EXPECTED_BRANCH;
}

function registrationOf(item = {}) {
  return normalizeFinanceRegistration(item?.data?.title || "");
}

function itemDate(item = {}, key = "_updatedDate") {
  const raw = item?.data?.[key]?.$date || item?.data?.[key] || item?.[key]?.$date || item?.[key] || null;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

async function queryCollection(configuration, collectionId) {
  const items = [];
  for (let offset = 0; offset < MAX_COLLECTION_ITEMS; offset += PAGE_SIZE) {
    const payload = await controlledWixRequest(configuration, "/wix-data/v2/items/query", {
      method: "POST",
      body: { dataCollectionId: collectionId, query: { paging: { limit: PAGE_SIZE, offset } }, consistentRead: true },
    });
    const page = Array.isArray(payload?.dataItems) ? payload.dataItems : [];
    items.push(...page);
    if (page.length < PAGE_SIZE) return items;
  }
  throw new Error(`${collectionId} exceeded the temporary safety cap.`);
}

function indexRows(items = []) {
  const byRegistration = new Map();
  for (const item of items) {
    const registration = registrationOf(item);
    if (!registration) continue;
    const rows = byRegistration.get(registration) || [];
    rows.push(item);
    byRegistration.set(registration, rows);
  }
  return byRegistration;
}

function sourceMap(snapshot) {
  return new Map((snapshot.vehicles || [])
    .map((vehicle) => [normalizeFinanceRegistration(vehicle.registration || ""), vehicle])
    .filter(([registration]) => registration));
}

function equipmentDiagnostics(data = {}, lane = "finance") {
  const equipmentBlank = EQUIPMENT_FIELDS.filter((field) => !clean(data?.[field], 30000));
  const financeSpec = clean(data?.vehicleSpecificationText, 30000);
  const technicalText = lane === "cars" ? clean(data?.descriptionLine, 30000) : financeSpec;
  const technicalMissing = {
    engine: !/ENGINE\s*SIZE\s*:/i.test(technicalText),
    euro: !/(?:EURO\s*STATUS|EURO)\s*:/i.test(technicalText),
    mpg: !/(?:COMBINED\s*MPG|MPG)\s*:/i.test(technicalText),
  };
  return {
    equipmentBlank,
    allSevenAccordionBlank: equipmentBlank.length === EQUIPMENT_FIELDS.length,
    anyAccordionBlank: equipmentBlank.length > 0,
    technicalMissing,
    anyCoreTechnicalMissing: Object.values(technicalMissing).some(Boolean),
    carFeatureListBlank: lane === "cars" ? !financeSpec : false,
  };
}

async function loadInventory(configuration) {
  const [financeMasters, carMasters, financeDetails, carDetails] = await Promise.all([
    queryCollection(configuration, "VANFINANCE-ALLVANS"),
    queryCollection(configuration, "CARFINANCE"),
    queryCollection(configuration, "VANFINANCEPAGES"),
    queryCollection(configuration, "CARPAGES"),
  ]);
  return {
    financeMasters: indexRows(financeMasters),
    carMasters: indexRows(carMasters),
    financeDetails: indexRows(financeDetails),
    carDetails: indexRows(carDetails),
    scanned: { financeMasters: financeMasters.length, carMasters: carMasters.length, financeDetails: financeDetails.length, carDetails: carDetails.length },
  };
}

function rowsForLane(inventory, lane) {
  const master = lane === "cars" ? inventory.carMasters : inventory.financeMasters;
  const details = lane === "cars" ? inventory.carDetails : inventory.financeDetails;
  return Array.from(master.entries()).map(([registration, masterRows]) => ({
    lane,
    registration,
    masterRows,
    masterItem: masterRows[0] || null,
    detailRows: details.get(registration) || [],
    detailItem: (details.get(registration) || []).length === 1 ? details.get(registration)[0] : null,
  }));
}

function countBy(records, predicate) {
  return records.filter(predicate).length;
}

function countUpdatedSince(records, iso) {
  const threshold = new Date(iso).getTime();
  return {
    finance: countBy(records, (row) => row.lane === "finance" && (new Date(itemDate(row.masterItem) || 0).getTime() >= threshold)),
    cars: countBy(records, (row) => row.lane === "cars" && (new Date(itemDate(row.masterItem) || 0).getTime() >= threshold)),
  };
}

function registrations(records, predicate) {
  return records.filter(predicate).map((row) => row.registration).sort();
}

export async function runTechnicalBackfillBuild() {
  if (!isTargetPreview()) {
    console.log("TEMP_TECHNICAL_BACKFILL skipped outside the dedicated preview branch.");
    return { skipped: true, safe: true, executed: false };
  }

  const configuration = controlledWixConfiguration(process.env);
  const [inventory, snapshot] = await Promise.all([
    loadInventory(configuration),
    fetchDealerKitStockSnapshot({ environment: process.env, allowPartial: true }),
  ]);
  const bySource = sourceMap(snapshot);
  const rows = [...rowsForLane(inventory, "finance"), ...rowsForLane(inventory, "cars")];
  const sourceMatched = rows.filter((row) => bySource.has(row.registration)).map((row) => ({
    ...row,
    diagnostics: row.detailItem ? equipmentDiagnostics(row.detailItem.data || {}, row.lane) : null,
  }));
  const usable = sourceMatched.filter((row) => row.detailItem && row.masterRows.length >= 1);
  const broad = usable.filter((row) => row.diagnostics.allSevenAccordionBlank || row.diagnostics.anyCoreTechnicalMissing || row.diagnostics.carFeatureListBlank);
  const allBlank = usable.filter((row) => row.diagnostics.allSevenAccordionBlank);
  const anyBlank = usable.filter((row) => row.diagnostics.anyAccordionBlank);

  const summary = {
    expectedBackfill: { finance: EXPECTED_FINANCE_COUNT, cars: EXPECTED_CARS_COUNT, total: EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT },
    wixScanned: inventory.scanned,
    uniqueMasterRegistrations: { finance: inventory.financeMasters.size, cars: inventory.carMasters.size },
    dealerKit: { complete: snapshot.complete, reportedTotal: snapshot.apiReportedTotal, usableRecords: snapshot.vehicleCount },
    sourceMatched: { finance: countBy(sourceMatched, (row) => row.lane === "finance"), cars: countBy(sourceMatched, (row) => row.lane === "cars") },
    exactDetailMatches: { finance: countBy(usable, (row) => row.lane === "finance"), cars: countBy(usable, (row) => row.lane === "cars") },
    allSevenAccordionBlank: { finance: countBy(allBlank, (row) => row.lane === "finance"), cars: countBy(allBlank, (row) => row.lane === "cars") },
    anyAccordionBlank: { finance: countBy(anyBlank, (row) => row.lane === "finance"), cars: countBy(anyBlank, (row) => row.lane === "cars") },
    broadDiagnosticCandidates: { finance: countBy(broad, (row) => row.lane === "finance"), cars: countBy(broad, (row) => row.lane === "cars") },
    masterUpdatedSince: {
      sep11: countUpdatedSince(sourceMatched, "2026-09-11T00:00:00Z"),
      sep10: countUpdatedSince(sourceMatched, "2026-09-10T00:00:00Z"),
      sep09: countUpdatedSince(sourceMatched, "2026-09-09T00:00:00Z"),
      sep08: countUpdatedSince(sourceMatched, "2026-09-08T00:00:00Z"),
      sep07: countUpdatedSince(sourceMatched, "2026-09-07T00:00:00Z"),
      sep05: countUpdatedSince(sourceMatched, "2026-09-05T00:00:00Z"),
      sep04: countUpdatedSince(sourceMatched, "2026-09-04T00:00:00Z"),
      sep03: countUpdatedSince(sourceMatched, "2026-09-03T00:00:00Z"),
      sep01: countUpdatedSince(sourceMatched, "2026-09-01T00:00:00Z"),
    },
    registrations: {
      financeAnyAccordionBlank: registrations(anyBlank, (row) => row.lane === "finance"),
      carsAnyAccordionBlank: registrations(anyBlank, (row) => row.lane === "cars"),
      financeBroad: registrations(broad, (row) => row.lane === "finance"),
      carsBroad: registrations(broad, (row) => row.lane === "cars"),
    },
  };

  console.log("TEMP_TECHNICAL_BACKFILL_DIAGNOSTIC", JSON.stringify(summary));
  const exactCandidateCount = summary.allSevenAccordionBlank.finance === EXPECTED_FINANCE_COUNT && summary.allSevenAccordionBlank.cars === EXPECTED_CARS_COUNT;
  return { safe: exactCandidateCount, executed: false, diagnosticOnly: true, summary, error: exactCandidateCount ? null : "The exact 33 Finance + 6 Cars candidate signature has not been proven yet." };
}
