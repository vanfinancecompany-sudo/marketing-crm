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
  const equipmentPopulated = EQUIPMENT_FIELDS.filter((field) => clean(data?.[field], 30000));
  const financeSpec = clean(data?.vehicleSpecificationText, 30000);
  const carSummary = clean(data?.descriptionLine, 30000);
  const technicalText = lane === "cars" ? carSummary : financeSpec;
  const technicalMissing = {
    engine: !/ENGINE\s*SIZE\s*:/i.test(technicalText),
    euro: !/(?:EURO\s*STATUS|EURO)\s*:/i.test(technicalText),
    mpg: !/(?:COMBINED\s*MPG|MPG)\s*:/i.test(technicalText),
  };
  return {
    equipmentBlank,
    equipmentPopulated,
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
    scanned: {
      financeMasters: financeMasters.length,
      carMasters: carMasters.length,
      financeDetails: financeDetails.length,
      carDetails: carDetails.length,
    },
  };
}

function rowsForLane(inventory, lane) {
  const master = lane === "cars" ? inventory.carMasters : inventory.financeMasters;
  const details = lane === "cars" ? inventory.carDetails : inventory.financeDetails;
  return Array.from(master.entries()).map(([registration, masterRows]) => ({
    lane,
    registration,
    masterRows,
    detailRows: details.get(registration) || [],
  }));
}

function countBy(records, predicate) {
  return records.filter(predicate).length;
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
  const sourceMatched = rows
    .filter((row) => bySource.has(row.registration))
    .map((row) => {
      const exactDetail = row.detailRows.length === 1 ? row.detailRows[0] : null;
      const diagnostics = exactDetail ? equipmentDiagnostics(exactDetail.data || {}, row.lane) : null;
      return { ...row, exactDetail, diagnostics };
    });

  const usable = sourceMatched.filter((row) => row.exactDetail && row.masterRows.length >= 1);
  const diagnosticCandidates = usable.filter((row) => row.diagnostics.allSevenAccordionBlank || row.diagnostics.anyCoreTechnicalMissing || row.diagnostics.carFeatureListBlank);
  const blankAccordionCandidates = usable.filter((row) => row.diagnostics.allSevenAccordionBlank);
  const anyBlankCandidates = usable.filter((row) => row.diagnostics.anyAccordionBlank);

  const summary = {
    expectedBackfill: { finance: EXPECTED_FINANCE_COUNT, cars: EXPECTED_CARS_COUNT, total: EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT },
    wixScanned: inventory.scanned,
    uniqueMasterRegistrations: { finance: inventory.financeMasters.size, cars: inventory.carMasters.size },
    dealerKit: { complete: snapshot.complete, reportedTotal: snapshot.apiReportedTotal, usableRecords: snapshot.vehicleCount },
    sourceMatched: { finance: countBy(sourceMatched, (row) => row.lane === "finance"), cars: countBy(sourceMatched, (row) => row.lane === "cars") },
    exactDetailMatches: { finance: countBy(usable, (row) => row.lane === "finance"), cars: countBy(usable, (row) => row.lane === "cars") },
    allSevenAccordionBlank: { finance: countBy(blankAccordionCandidates, (row) => row.lane === "finance"), cars: countBy(blankAccordionCandidates, (row) => row.lane === "cars") },
    anyAccordionBlank: { finance: countBy(anyBlankCandidates, (row) => row.lane === "finance"), cars: countBy(anyBlankCandidates, (row) => row.lane === "cars") },
    broadDiagnosticCandidates: { finance: countBy(diagnosticCandidates, (row) => row.lane === "finance"), cars: countBy(diagnosticCandidates, (row) => row.lane === "cars") },
  };

  console.log("TEMP_TECHNICAL_BACKFILL_DIAGNOSTIC", JSON.stringify(summary));
  for (const row of diagnosticCandidates) {
    console.log("TEMP_TECHNICAL_BACKFILL_DIAGNOSTIC_RECORD", JSON.stringify({
      lane: row.lane,
      registration: row.registration,
      masterRowCount: row.masterRows.length,
      detailRowCount: row.detailRows.length,
      allSevenAccordionBlank: row.diagnostics.allSevenAccordionBlank,
      blankAccordionFields: row.diagnostics.equipmentBlank,
      technicalMissing: row.diagnostics.technicalMissing,
      carFeatureListBlank: row.diagnostics.carFeatureListBlank,
      sourceStockId: bySource.get(row.registration)?.supplierStockId || null,
    }));
  }

  const exactCandidateCount = summary.allSevenAccordionBlank.finance === EXPECTED_FINANCE_COUNT
    && summary.allSevenAccordionBlank.cars === EXPECTED_CARS_COUNT;
  return {
    safe: exactCandidateCount,
    executed: false,
    diagnosticOnly: true,
    summary,
    error: exactCandidateCount ? null : "The exact 33 Finance + 6 Cars candidate signature has not been proven yet.",
  };
}
