import {
  fetchDealerKitStockDetail,
  fetchDealerKitStockSnapshot,
} from "../api/_dealerkit-stock-adapter.js";
import {
  controlledWixConfiguration,
  controlledWixRequest,
} from "../api/_dealerkit-controlled-publish-state.js";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import {
  EXPECTED_CARS_COUNT,
  EXPECTED_FINANCE_COUNT,
  buildBackfillFingerprint,
  buildCarsAllowedBackfill,
  buildFinanceAllowedBackfill,
  protectedData,
  safeTokenEqual,
  sha256,
  signBackfillFingerprint,
  stableStringify,
} from "../lib/_tempDealerKitTechnicalBackfill.js";

const EXPECTED_BRANCH = "fix/dealerkit-complete-vehicle-specifications";
const PAGE_SIZE = 100;
const MAX_COLLECTION_ITEMS = 2500;
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
  throw new Error(`${collectionId} exceeded the temporary safety cap of ${MAX_COLLECTION_ITEMS} rows.`);
}

function indexRows(items = []) {
  const byRegistration = new Map();
  const blank = [];
  for (const item of items) {
    const registration = registrationOf(item);
    if (!registration) { blank.push(item?.id || null); continue; }
    const rows = byRegistration.get(registration) || [];
    rows.push(item);
    byRegistration.set(registration, rows);
  }
  return { byRegistration, blank };
}

function duplicates(index) {
  return Array.from(index.byRegistration.entries()).filter(([, rows]) => rows.length !== 1).map(([registration, rows]) => ({ registration, count: rows.length }));
}

async function loadInventory(configuration) {
  const [financeMasters, carMasters, financeDetails, carDetails] = await Promise.all([
    queryCollection(configuration, "VANFINANCE-ALLVANS"),
    queryCollection(configuration, "CARFINANCE"),
    queryCollection(configuration, "VANFINANCEPAGES"),
    queryCollection(configuration, "CARPAGES"),
  ]);
  return {
    financeMasters,
    carMasters,
    financeDetails,
    carDetails,
    financeMasterIndex: indexRows(financeMasters),
    carMasterIndex: indexRows(carMasters),
    financeDetailIndex: indexRows(financeDetails),
    carDetailIndex: indexRows(carDetails),
  };
}

function inventoryBlockers(inventory) {
  const blockers = [];
  if (inventory.financeMasters.length !== EXPECTED_FINANCE_COUNT) blockers.push(`Finance master count ${inventory.financeMasters.length}, expected ${EXPECTED_FINANCE_COUNT}.`);
  if (inventory.carMasters.length !== EXPECTED_CARS_COUNT) blockers.push(`Cars master count ${inventory.carMasters.length}, expected ${EXPECTED_CARS_COUNT}.`);
  if (inventory.financeMasterIndex.blank.length) blockers.push(`Finance master has ${inventory.financeMasterIndex.blank.length} blank registration row(s).`);
  if (inventory.carMasterIndex.blank.length) blockers.push(`Cars master has ${inventory.carMasterIndex.blank.length} blank registration row(s).`);
  const financeDupes = duplicates(inventory.financeMasterIndex);
  const carDupes = duplicates(inventory.carMasterIndex);
  if (financeDupes.length) blockers.push(`Finance master duplicates: ${financeDupes.map((item) => `${item.registration} x${item.count}`).join(", ")}.`);
  if (carDupes.length) blockers.push(`Cars master duplicates: ${carDupes.map((item) => `${item.registration} x${item.count}`).join(", ")}.`);
  const overlap = Array.from(inventory.financeMasterIndex.byRegistration.keys()).filter((registration) => inventory.carMasterIndex.byRegistration.has(registration));
  if (overlap.length) blockers.push(`Master lane overlap: ${overlap.join(", ")}.`);
  return blockers;
}

function masterRows(inventory) {
  return [
    ...Array.from(inventory.financeMasterIndex.byRegistration.entries()).map(([registration, rows]) => ({ lane: "finance", registration, masterItem: rows[0] })),
    ...Array.from(inventory.carMasterIndex.byRegistration.entries()).map(([registration, rows]) => ({ lane: "cars", registration, masterItem: rows[0] })),
  ].sort((a, b) => `${a.lane}:${a.registration}`.localeCompare(`${b.lane}:${b.registration}`));
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

function targetDuplicateSourceRegistrations(snapshot, targetRegistrations) {
  const target = new Set(targetRegistrations);
  return (snapshot?.diagnostics?.duplicateRegistrations || []).filter((item) => target.has(normalizeFinanceRegistration(item?.registration || "")));
}

function planRecord({ lane, registration, masterItem, detailItem, vehicle }) {
  const built = lane === "cars"
    ? buildCarsAllowedBackfill(detailItem?.data || {}, vehicle)
    : buildFinanceAllowedBackfill(detailItem?.data || {}, vehicle);
  return {
    lane,
    registration,
    masterItem,
    detailItem,
    vehicle,
    proposed: built.proposed,
    audit: built.audit,
    changeFields: Object.keys(built.proposed).sort(),
  };
}

function sourceMap(snapshot) {
  return new Map((snapshot.vehicles || []).map((vehicle) => [normalizeFinanceRegistration(vehicle.registration || ""), vehicle]).filter(([registration]) => registration));
}

function compactRecord(record = {}) {
  return {
    lane: record.lane,
    registration: record.registration,
    blockers: record.blockers || [],
    changeFields: record.changeFields || [],
    additions: Object.fromEntries(Object.entries(record.audit || {}).map(([field, additions]) => [field, Array.isArray(additions) ? additions.length : 0])),
    hasConfirmationToken: Boolean(record.confirmationToken),
  };
}

async function runDryRun(environment = process.env) {
  const configuration = controlledWixConfiguration(environment);
  const secret = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 5000);
  const [inventory, snapshot] = await Promise.all([
    loadInventory(configuration),
    fetchDealerKitStockSnapshot({ environment, allowPartial: true }),
  ]);
  const blockers = inventoryBlockers(inventory);
  if (!secret) blockers.push("Backfill signing secret is unavailable.");
  const rows = masterRows(inventory);
  if (rows.length !== EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT) blockers.push(`Usable master registrations ${rows.length}, expected ${EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT}.`);
  const targetRegistrations = rows.map((row) => row.registration);
  const targetSourceDupes = targetDuplicateSourceRegistrations(snapshot, targetRegistrations);
  if (targetSourceDupes.length) blockers.push(`DealerKit has duplicate source identities for target registration(s): ${targetSourceDupes.map((item) => item.registration).join(", ")}.`);

  const bySourceRegistration = sourceMap(snapshot);
  const candidates = rows.map((row) => ({ ...row, source: bySourceRegistration.get(row.registration) || null }));
  const detailReads = await mapLimit(candidates, 4, async (row) => row.source?.supplierStockId
    ? fetchDealerKitStockDetail(row.source.supplierStockId, { environment, specifications: true })
    : null);

  const records = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const row = candidates[index];
    const recordBlockers = [];
    const detailRows = row.lane === "cars"
      ? (inventory.carDetailIndex.byRegistration.get(row.registration) || [])
      : (inventory.financeDetailIndex.byRegistration.get(row.registration) || []);
    if (detailRows.length !== 1) recordBlockers.push(`${row.lane === "cars" ? "CARPAGES" : "VANFINANCEPAGES"} has ${detailRows.length} detail rows; exactly 1 required.`);
    if (!row.source?.supplierStockId) recordBlockers.push("DealerKit partial snapshot does not contain this target registration.");
    const sourceRead = detailReads[index];
    if (row.source && !sourceRead?.ok) recordBlockers.push(`DealerKit detail read failed: ${clean(sourceRead?.error?.message, 300) || "unknown error"}.`);
    const vehicle = sourceRead?.ok ? sourceRead.value : null;
    if (vehicle && normalizeFinanceRegistration(vehicle.registration || "") !== row.registration) recordBlockers.push("DealerKit detail registration does not match the Wix target.");
    const base = { lane: row.lane, registration: row.registration, masterItem: row.masterItem, detailItem: detailRows[0] || null, vehicle, blockers: recordBlockers, proposed: {}, audit: {}, changeFields: [] };
    records.push(recordBlockers.length || !base.detailItem || !vehicle ? base : { ...planRecord(base), blockers: [] });
  }

  const recordBlockerCount = records.filter((record) => record.blockers.length).length;
  const targetSourceCoverage = records.filter((record) => record.vehicle && !record.blockers.some((item) => item.includes("DealerKit"))).length;
  const safe = blockers.length === 0 && recordBlockerCount === 0 && records.length === EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT;
  for (const record of records) {
    record.confirmationToken = safe && record.changeFields.length
      ? signBackfillFingerprint(secret, buildBackfillFingerprint(record))
      : null;
  }
  return {
    safe,
    configuration,
    secret,
    snapshot,
    inventory,
    records,
    blockers,
    summary: {
      expected: { finance: EXPECTED_FINANCE_COUNT, cars: EXPECTED_CARS_COUNT, total: EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT },
      publishedMasters: { finance: inventory.financeMasters.length, cars: inventory.carMasters.length, total: inventory.financeMasters.length + inventory.carMasters.length },
      dealerKitSnapshotComplete: Boolean(snapshot.complete),
      dealerKitReportedTotal: Number(snapshot.apiReportedTotal || 0),
      dealerKitUsableRecords: Number(snapshot.vehicleCount || 0),
      targetSourceCoverage,
      recordBlockerCount,
      recordsWithChanges: records.filter((record) => record.changeFields.length).length,
      recordsAlreadyComplete: records.filter((record) => !record.blockers.length && !record.changeFields.length).length,
      fieldChanges: records.reduce((sum, record) => sum + record.changeFields.length, 0),
    },
  };
}

function setModifications(proposed = {}) {
  return Object.entries(proposed).map(([fieldPath, value]) => ({ fieldPath, action: "SET_FIELD", setFieldOptions: { value } }));
}

function rollbackModifications(detailItem, proposed = {}) {
  const previous = detailItem?.data || {};
  return Object.keys(proposed).map((fieldPath) => Object.prototype.hasOwnProperty.call(previous, fieldPath)
    ? { fieldPath, action: "SET_FIELD", setFieldOptions: { value: previous[fieldPath] } }
    : { fieldPath, action: "REMOVE_FIELD" });
}

async function currentSingleFromCollection(configuration, collectionId, registration) {
  const items = await queryCollection(configuration, collectionId);
  const rows = items.filter((item) => registrationOf(item) === registration);
  return rows.length === 1 ? rows[0] : null;
}

async function applyPreparedRecord(record, configuration, secret, environment = process.env) {
  const masterCollection = record.lane === "cars" ? "CARFINANCE" : "VANFINANCE-ALLVANS";
  const detailCollection = record.lane === "cars" ? "CARPAGES" : "VANFINANCEPAGES";
  const [masterItem, detailItem, vehicle] = await Promise.all([
    currentSingleFromCollection(configuration, masterCollection, record.registration),
    currentSingleFromCollection(configuration, detailCollection, record.registration),
    fetchDealerKitStockDetail(record.vehicle.supplierStockId, { environment, specifications: true }),
  ]);
  if (!masterItem || masterItem.id !== record.masterItem.id || sha256(masterItem.data || {}) !== sha256(record.masterItem.data || {})) throw new Error(`${record.registration} master row changed after dry-run.`);
  if (!detailItem || detailItem.id !== record.detailItem.id || sha256(detailItem.data || {}) !== sha256(record.detailItem.data || {})) throw new Error(`${record.registration} detail row changed after dry-run.`);
  if (normalizeFinanceRegistration(vehicle.registration || "") !== record.registration) throw new Error(`${record.registration} DealerKit identity changed after dry-run.`);

  const fresh = planRecord({ lane: record.lane, registration: record.registration, masterItem, detailItem, vehicle });
  const freshToken = signBackfillFingerprint(secret, buildBackfillFingerprint(fresh));
  if (!safeTokenEqual(record.confirmationToken, freshToken)) throw new Error(`${record.registration} confirmation fingerprint changed after dry-run.`);
  if (!fresh.changeFields.length) return { registration: record.registration, lane: record.lane, executed: false, alreadyComplete: true };

  let writeAttempted = false;
  try {
    writeAttempted = true;
    await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(detailItem.id)}`, {
      method: "PATCH",
      body: { dataCollectionId: detailCollection, patch: { dataItemId: detailItem.id, fieldModifications: setModifications(fresh.proposed) } },
    });
    const after = await currentSingleFromCollection(configuration, detailCollection, record.registration);
    if (!after || after.id !== detailItem.id) throw new Error(`${record.registration} detail identity could not be verified after write.`);
    for (const [field, expected] of Object.entries(fresh.proposed)) {
      if (stableStringify(after.data?.[field]) !== stableStringify(expected)) throw new Error(`${record.registration} allowed field ${field} did not read back exactly.`);
    }
    const beforeProtected = sha256(protectedData(detailItem.data || {}, record.lane));
    const afterProtected = sha256(protectedData(after.data || {}, record.lane));
    if (beforeProtected !== afterProtected) throw new Error(`${record.registration} protected fields changed during the backfill.`);
    return { registration: record.registration, lane: record.lane, executed: true, verified: true, changedFields: fresh.changeFields, protectedFieldsUnchanged: true };
  } catch (error) {
    if (writeAttempted) {
      try {
        await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(detailItem.id)}`, {
          method: "PATCH",
          body: { dataCollectionId: detailCollection, patch: { dataItemId: detailItem.id, fieldModifications: rollbackModifications(detailItem, fresh.proposed) } },
        });
        const restored = await currentSingleFromCollection(configuration, detailCollection, record.registration);
        if (!restored || stableStringify(restored.data || {}) !== stableStringify(detailItem.data || {})) throw new Error("rollback verification failed");
      } catch (rollbackError) {
        throw new Error(`${error.message} Rollback needs manual attention: ${rollbackError.message}`);
      }
    }
    throw error;
  }
}

export async function runTechnicalBackfillBuild({ execute = false } = {}) {
  if (!isTargetPreview()) {
    console.log("TEMP_TECHNICAL_BACKFILL skipped outside the dedicated preview branch.");
    return { skipped: true, safe: true, executed: false };
  }

  const dryRun = await runDryRun(process.env);
  console.log("TEMP_TECHNICAL_BACKFILL_DRY_RUN", JSON.stringify({ safeToExecute: dryRun.safe, blockers: dryRun.blockers, summary: dryRun.summary, sourceDiagnostics: dryRun.snapshot.complete ? null : dryRun.snapshot.diagnostics }));
  for (const record of dryRun.records) console.log("TEMP_TECHNICAL_BACKFILL_RECORD", JSON.stringify(compactRecord(record)));
  if (!dryRun.safe) return { safe: false, executed: false, dryRun, error: dryRun.blockers[0] || dryRun.records.find((record) => record.blockers.length)?.blockers?.[0] || "Dry-run blocked." };
  if (!execute) return { safe: true, executed: false, dryRun };

  const outcomes = [];
  for (const record of dryRun.records.filter((item) => item.changeFields.length)) {
    const outcome = await applyPreparedRecord(record, dryRun.configuration, dryRun.secret, process.env);
    outcomes.push(outcome);
    console.log("TEMP_TECHNICAL_BACKFILL_EXECUTE", JSON.stringify(outcome));
  }

  const finalCheck = await runDryRun(process.env);
  console.log("TEMP_TECHNICAL_BACKFILL_FINAL", JSON.stringify({ safeToExecute: finalCheck.safe, blockers: finalCheck.blockers, summary: finalCheck.summary }));
  if (!finalCheck.safe || finalCheck.summary.recordsWithChanges !== 0) throw new Error(`Final verification has ${finalCheck.summary.recordsWithChanges} record(s) still requiring scoped changes.`);
  return { safe: true, executed: true, outcomes, finalCheck };
}
