import {
  fetchDealerKitStockDetail,
  fetchDealerKitStockSnapshot,
} from "../api/_dealerkit-stock-adapter.js";
import { controlledWixConfiguration, controlledWixRequest } from "../api/_dealerkit-controlled-publish-state.js";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import {
  EXPECTED_CARS_COUNT,
  EXPECTED_FINANCE_COUNT,
  buildBackfillFingerprint,
  buildCarsAllowedBackfill,
  buildFinanceAllowedBackfill,
  signBackfillFingerprint,
} from "../lib/_tempDealerKitTechnicalBackfill.js";

const EXPECTED_BRANCH = "fix/dealerkit-complete-vehicle-specifications";
const FINANCE_COHORT_START = "2026-09-10T00:00:00.000Z";
const CARS_COHORT_START = "2026-09-04T00:00:00.000Z";
const PAGE_SIZE = 100;
const MAX_COLLECTION_ITEMS = 2500;
const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function isTargetPreview(environment = process.env) {
  return environment.VERCEL_ENV === "preview" && environment.VERCEL_GIT_COMMIT_REF === EXPECTED_BRANCH;
}

function registrationOf(item = {}) {
  return normalizeFinanceRegistration(item?.data?.title || "");
}

function itemUpdatedAt(item = {}) {
  const raw = item?.data?._updatedDate?.$date || item?.data?._updatedDate || item?._updatedDate?.$date || item?._updatedDate || null;
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

function scalarStrings(value, prefix = "", result = []) {
  if (value === null || value === undefined) return result;
  if (typeof value === "string" || typeof value === "number") {
    result.push([prefix, String(value)]);
    return result;
  }
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item, index) => scalarStrings(item, `${prefix}[${index}]`, result));
    return result;
  }
  if (typeof value === "object") {
    Object.entries(value).slice(0, 200).forEach(([key, nested]) => scalarStrings(nested, prefix ? `${prefix}.${key}` : key, result));
  }
  return result;
}

function registrationReferences(items = [], registration) {
  const wanted = normalizeFinanceRegistration(registration);
  if (!wanted) return [];
  const matches = [];
  for (const item of items) {
    const fields = scalarStrings(item?.data || {});
    const matchingKeys = fields
      .filter(([, value]) => normalizeFinanceRegistration(value).includes(wanted))
      .map(([key]) => key)
      .filter(Boolean);
    if (!matchingKeys.length) continue;
    matches.push({
      id: item?.id || null,
      title: clean(item?.data?.title, 300) || null,
      titleText: clean(item?.data?.titleText, 500) || null,
      applyLink: clean(item?.data?.applyLink, 1000) || null,
      updatedAt: itemUpdatedAt(item),
      matchingKeys: Array.from(new Set(matchingKeys)).slice(0, 20),
    });
  }
  return matches;
}

async function loadInventory(configuration) {
  const [financeMastersRaw, carMastersRaw, financeDetailsRaw, carDetailsRaw] = await Promise.all([
    queryCollection(configuration, "VANFINANCE-ALLVANS"),
    queryCollection(configuration, "CARFINANCE"),
    queryCollection(configuration, "VANFINANCEPAGES"),
    queryCollection(configuration, "CARPAGES"),
  ]);
  return {
    financeMasters: indexRows(financeMastersRaw),
    carMasters: indexRows(carMastersRaw),
    financeDetails: indexRows(financeDetailsRaw),
    carDetails: indexRows(carDetailsRaw),
    financeDetailsRaw,
    carDetailsRaw,
    scanned: {
      financeMasters: financeMastersRaw.length,
      carMasters: carMastersRaw.length,
      financeDetails: financeDetailsRaw.length,
      carDetails: carDetailsRaw.length,
    },
  };
}

function sourceMap(snapshot) {
  return new Map((snapshot.vehicles || [])
    .map((vehicle) => [normalizeFinanceRegistration(vehicle.registration || ""), vehicle])
    .filter(([registration]) => registration));
}

function sourceDuplicateSet(snapshot) {
  return new Set((snapshot?.diagnostics?.duplicateRegistrations || [])
    .map((item) => normalizeFinanceRegistration(item?.registration || ""))
    .filter(Boolean));
}

function masterRowsForLane(inventory, lane) {
  const masters = lane === "cars" ? inventory.carMasters : inventory.financeMasters;
  const details = lane === "cars" ? inventory.carDetails : inventory.financeDetails;
  return Array.from(masters.entries()).map(([registration, masterRows]) => ({
    lane,
    registration,
    masterRows,
    detailRows: details.get(registration) || [],
    updatedAt: itemUpdatedAt(masterRows[0]),
  }));
}

function withinCohort(row) {
  const updated = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
  const threshold = new Date(row.lane === "cars" ? CARS_COHORT_START : FINANCE_COHORT_START).getTime();
  return Number.isFinite(updated) && updated >= threshold;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = { ok: true, value: await worker(items[index]) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, run));
  return results;
}

function buildPlan(row, vehicle) {
  const masterItem = row.masterRows[0];
  const detailItem = row.detailRows[0];
  const built = row.lane === "cars"
    ? buildCarsAllowedBackfill(detailItem?.data || {}, vehicle)
    : buildFinanceAllowedBackfill(detailItem?.data || {}, vehicle);
  return {
    lane: row.lane,
    registration: row.registration,
    updatedAt: row.updatedAt,
    masterItem,
    detailItem,
    vehicle,
    proposed: built.proposed,
    audit: built.audit,
    changeFields: Object.keys(built.proposed).sort(),
  };
}

function additionsSummary(audit = {}) {
  return Object.fromEntries(Object.entries(audit).map(([field, additions]) => [field, {
    count: Array.isArray(additions) ? additions.length : 0,
    sample: (Array.isArray(additions) ? additions : []).slice(0, 5),
  }]));
}

async function buildDryRun(environment = process.env) {
  const configuration = controlledWixConfiguration(environment);
  const secret = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 5000);
  const [inventory, snapshot] = await Promise.all([
    loadInventory(configuration),
    fetchDealerKitStockSnapshot({ environment, allowPartial: true }),
  ]);
  const bySource = sourceMap(snapshot);
  const duplicateSources = sourceDuplicateSet(snapshot);
  const allMasterRows = [...masterRowsForLane(inventory, "finance"), ...masterRowsForLane(inventory, "cars")];
  const targetRows = allMasterRows.filter((row) => withinCohort(row) && bySource.has(row.registration));
  const financeTargets = targetRows.filter((row) => row.lane === "finance");
  const carTargets = targetRows.filter((row) => row.lane === "cars");
  const blockers = [];

  if (!secret) blockers.push("Backfill signing secret is unavailable.");
  if (financeTargets.length !== EXPECTED_FINANCE_COUNT) blockers.push(`Recovered Finance cohort contains ${financeTargets.length} records, expected ${EXPECTED_FINANCE_COUNT}.`);
  if (carTargets.length !== EXPECTED_CARS_COUNT) blockers.push(`Recovered Cars cohort contains ${carTargets.length} records, expected ${EXPECTED_CARS_COUNT}.`);

  const rowStates = targetRows.map((row) => {
    const rowBlockers = [];
    if (row.masterRows.length !== 1) rowBlockers.push(`${row.registration} has ${row.masterRows.length} master rows in ${row.lane}.`);
    if (row.detailRows.length !== 1) rowBlockers.push(`${row.registration} has ${row.detailRows.length} exact historical detail rows in ${row.lane}.`);
    if (duplicateSources.has(row.registration)) rowBlockers.push(`DealerKit returned more than one source identity for ${row.registration}.`);
    const referenceRows = row.detailRows.length === 0
      ? registrationReferences(row.lane === "cars" ? inventory.carDetailsRaw : inventory.financeDetailsRaw, row.registration)
      : [];
    return { ...row, rowBlockers, referenceRows };
  });
  for (const row of rowStates) blockers.push(...row.rowBlockers);

  const structurallyReady = rowStates.filter((row) => row.rowBlockers.length === 0);
  const sourceReads = await mapLimit(structurallyReady, 5, (row) => fetchDealerKitStockDetail(bySource.get(row.registration).supplierStockId, { environment, specifications: true }));
  const plans = [];
  for (let index = 0; index < structurallyReady.length; index += 1) {
    const row = structurallyReady[index];
    const read = sourceReads[index];
    if (!read?.ok) {
      blockers.push(`DealerKit detail read failed for ${row.registration}: ${clean(read?.error?.message, 300) || "unknown error"}.`);
      continue;
    }
    const vehicle = read.value;
    if (normalizeFinanceRegistration(vehicle.registration || "") !== row.registration) {
      blockers.push(`DealerKit detail registration changed for ${row.registration}.`);
      continue;
    }
    plans.push(buildPlan(row, vehicle));
  }

  const safe = blockers.length === 0 && plans.length === EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT;
  const records = plans.map((plan) => ({
    lane: plan.lane,
    registration: plan.registration,
    masterUpdatedAt: plan.updatedAt,
    sourceStockId: plan.vehicle.supplierStockId,
    sourceUpdatedAt: plan.vehicle.sourceUpdatedAt,
    detailItemId: plan.detailItem.id,
    changeFields: plan.changeFields,
    additions: additionsSummary(plan.audit),
    confirmationToken: safe && plan.changeFields.length ? signBackfillFingerprint(secret, buildBackfillFingerprint(plan)) : null,
  }));
  const missingDetailDiagnostics = Object.fromEntries(rowStates
    .filter((row) => row.detailRows.length === 0)
    .map((row) => [row.registration, row.referenceRows]));
  const summary = {
    expected: { finance: EXPECTED_FINANCE_COUNT, cars: EXPECTED_CARS_COUNT, total: EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT },
    cohortStarts: { finance: FINANCE_COHORT_START, cars: CARS_COHORT_START },
    targetCounts: { finance: financeTargets.length, cars: carTargets.length, total: targetRows.length },
    structurallyReady: structurallyReady.length,
    wixScanned: inventory.scanned,
    dealerKit: { complete: snapshot.complete, reportedTotal: snapshot.apiReportedTotal, usableRecords: snapshot.vehicleCount },
    plansBuilt: plans.length,
    recordsWithChanges: plans.filter((plan) => plan.changeFields.length).length,
    noOpRecords: plans.filter((plan) => !plan.changeFields.length).length,
    changedByLane: {
      finance: plans.filter((plan) => plan.lane === "finance" && plan.changeFields.length).length,
      cars: plans.filter((plan) => plan.lane === "cars" && plan.changeFields.length).length,
    },
    registrations: {
      finance: financeTargets.map((row) => row.registration).sort(),
      cars: carTargets.map((row) => row.registration).sort(),
    },
    missingDetailDiagnostics,
  };
  return { safe, executed: false, configuration, secret, inventory, snapshot, plans, blockers, records, summary, error: blockers[0] || null };
}

export async function runTechnicalBackfillBuild({ execute = false } = {}) {
  if (!isTargetPreview()) {
    console.log("TEMP_TECHNICAL_BACKFILL skipped outside the dedicated preview branch.");
    return { skipped: true, safe: true, executed: false };
  }
  if (execute) throw new Error("Temporary backfill execution is still hard-disabled. Complete and approve the exact 39-record dry-run first.");
  const dryRun = await buildDryRun(process.env);
  console.log("TEMP_TECHNICAL_BACKFILL_DRY_RUN", JSON.stringify({ safe: dryRun.safe, blockers: dryRun.blockers, summary: dryRun.summary }));
  for (const record of dryRun.records) console.log("TEMP_TECHNICAL_BACKFILL_TARGET", JSON.stringify(record));
  return dryRun;
}
