import {
  fetchDealerKitStockDetail,
  fetchDealerKitStockSnapshot,
} from "./_dealerkit-stock-adapter.js";
import {
  ControlledPublishError,
  controlledWixConfiguration,
  controlledWixRequest,
} from "./_dealerkit-controlled-publish-state.js";
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
const MAX_COLLECTION_ITEMS = 2500;
const PAGE_SIZE = 100;
const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function assertPreviewBranch(environment = process.env) {
  if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH) {
    throw new ControlledPublishError(404, "Temporary technical backfill is not available in this environment.");
  }
}

function signingSecret(environment = process.env) {
  return clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 5000);
}

function itemRegistration(item = {}) {
  return normalizeFinanceRegistration(item?.data?.title || "");
}

async function queryCollection(configuration, collectionId) {
  const items = [];
  for (let offset = 0; offset < MAX_COLLECTION_ITEMS; offset += PAGE_SIZE) {
    const payload = await controlledWixRequest(configuration, "/wix-data/v2/items/query", {
      method: "POST",
      body: {
        dataCollectionId: collectionId,
        query: { paging: { limit: PAGE_SIZE, offset } },
        consistentRead: true,
      },
    });
    const page = Array.isArray(payload?.dataItems) ? payload.dataItems : [];
    items.push(...page);
    if (page.length < PAGE_SIZE) return items;
  }
  throw new ControlledPublishError(409, `${collectionId} exceeded the temporary backfill safety cap of ${MAX_COLLECTION_ITEMS} rows.`);
}

function groupByRegistration(items = []) {
  const grouped = new Map();
  const blank = [];
  for (const item of items) {
    const registration = itemRegistration(item);
    if (!registration) {
      blank.push(item?.id || null);
      continue;
    }
    const bucket = grouped.get(registration) || [];
    bucket.push(item);
    grouped.set(registration, bucket);
  }
  return { grouped, blank };
}

function duplicateRegistrations(grouped) {
  return Array.from(grouped.entries())
    .filter(([, items]) => items.length !== 1)
    .map(([registration, items]) => ({ registration, count: items.length }));
}

async function loadWixInventory(configuration) {
  const [financeMasters, carMasters, financeDetails, carDetails] = await Promise.all([
    queryCollection(configuration, "VANFINANCE-ALLVANS"),
    queryCollection(configuration, "CARFINANCE"),
    queryCollection(configuration, "VANFINANCEPAGES"),
    queryCollection(configuration, "CARPAGES"),
  ]);
  const financeMasterIndex = groupByRegistration(financeMasters);
  const carMasterIndex = groupByRegistration(carMasters);
  const financeDetailIndex = groupByRegistration(financeDetails);
  const carDetailIndex = groupByRegistration(carDetails);
  return {
    financeMasters,
    carMasters,
    financeDetails,
    carDetails,
    financeMasterIndex,
    carMasterIndex,
    financeDetailIndex,
    carDetailIndex,
  };
}

function inventoryBlockers(inventory) {
  const blockers = [];
  if (inventory.financeMasters.length !== EXPECTED_FINANCE_COUNT) blockers.push(`Finance published master count is ${inventory.financeMasters.length}, expected ${EXPECTED_FINANCE_COUNT}.`);
  if (inventory.carMasters.length !== EXPECTED_CARS_COUNT) blockers.push(`Cars published master count is ${inventory.carMasters.length}, expected ${EXPECTED_CARS_COUNT}.`);
  if (inventory.financeMasterIndex.blank.length) blockers.push(`Finance master has ${inventory.financeMasterIndex.blank.length} row(s) without a usable registration.`);
  if (inventory.carMasterIndex.blank.length) blockers.push(`Cars master has ${inventory.carMasterIndex.blank.length} row(s) without a usable registration.`);
  const financeDuplicates = duplicateRegistrations(inventory.financeMasterIndex.grouped);
  const carDuplicates = duplicateRegistrations(inventory.carMasterIndex.grouped);
  if (financeDuplicates.length) blockers.push(`Finance master has duplicate registration rows: ${financeDuplicates.map((item) => `${item.registration} x${item.count}`).join(", ")}.`);
  if (carDuplicates.length) blockers.push(`Cars master has duplicate registration rows: ${carDuplicates.map((item) => `${item.registration} x${item.count}`).join(", ")}.`);
  const overlap = Array.from(inventory.financeMasterIndex.grouped.keys()).filter((registration) => inventory.carMasterIndex.grouped.has(registration));
  if (overlap.length) blockers.push(`Registration(s) appear in both Finance and Cars published masters: ${overlap.join(", ")}.`);
  return blockers;
}

function masterRows(inventory) {
  return [
    ...Array.from(inventory.financeMasterIndex.grouped.entries()).map(([registration, items]) => ({ lane: "finance", registration, masterItem: items[0] })),
    ...Array.from(inventory.carMasterIndex.grouped.entries()).map(([registration, items]) => ({ lane: "cars", registration, masterItem: items[0] })),
  ].sort((a, b) => `${a.lane}:${a.registration}`.localeCompare(`${b.lane}:${b.registration}`));
}

function sourceIndex(snapshot) {
  return new Map((snapshot.vehicles || []).map((vehicle) => [normalizeFinanceRegistration(vehicle.registration || ""), vehicle]).filter(([registration]) => registration));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
  return results;
}

function planForRecord({ lane, registration, masterItem, detailItem, vehicle }) {
  const detailData = detailItem?.data || {};
  const built = lane === "cars"
    ? buildCarsAllowedBackfill(detailData, vehicle)
    : buildFinanceAllowedBackfill(detailData, vehicle);
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

function auditSummary(audit = {}) {
  return Object.fromEntries(Object.entries(audit).map(([field, additions]) => [field, {
    addedCount: Array.isArray(additions) ? additions.length : 0,
    sample: (Array.isArray(additions) ? additions : []).slice(0, 6),
  }]));
}

function recordPublicSummary(record, secret, globalSafe) {
  const blockers = record.blockers || [];
  const token = globalSafe && blockers.length === 0 && record.changeFields?.length
    ? signBackfillFingerprint(secret, buildBackfillFingerprint(record))
    : "";
  return {
    lane: record.lane,
    registration: record.registration,
    sourceStockId: record.vehicle?.supplierStockId || null,
    sourceUpdatedAt: record.vehicle?.sourceUpdatedAt || null,
    detailItemId: record.detailItem?.id || null,
    blockers,
    changeFieldCount: record.changeFields?.length || 0,
    changeFields: record.changeFields || [],
    additions: auditSummary(record.audit),
    confirmationToken: token || null,
  };
}

async function buildCompleteDryRun(environment = process.env) {
  const configuration = controlledWixConfiguration(environment);
  const secret = signingSecret(environment);
  const [inventory, snapshot] = await Promise.all([
    loadWixInventory(configuration),
    fetchDealerKitStockSnapshot({ environment, allowPartial: false }),
  ]);
  const blockers = inventoryBlockers(inventory);
  if (!secret) blockers.push("Backfill signing secret is unavailable.");
  if (!snapshot.complete) blockers.push("DealerKit stock snapshot is not complete.");

  const sourceByRegistration = sourceIndex(snapshot);
  const rows = masterRows(inventory);
  if (rows.length !== EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT) blockers.push(`Published master inventory contains ${rows.length} usable registration rows, expected ${EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT}.`);

  const fetchCandidates = rows.map((row) => ({ ...row, source: sourceByRegistration.get(row.registration) || null }));
  const detailResults = await mapLimit(fetchCandidates, 4, async (row) => {
    if (!row.source?.supplierStockId) return null;
    return fetchDealerKitStockDetail(row.source.supplierStockId, { environment, specifications: true });
  });

  const records = [];
  for (let index = 0; index < fetchCandidates.length; index += 1) {
    const row = fetchCandidates[index];
    const recordBlockers = [];
    const detailRows = row.lane === "cars"
      ? (inventory.carDetailIndex.grouped.get(row.registration) || [])
      : (inventory.financeDetailIndex.grouped.get(row.registration) || []);
    if (detailRows.length !== 1) recordBlockers.push(`${row.lane === "cars" ? "CARPAGES" : "VANFINANCEPAGES"} has ${detailRows.length} exact detail rows for ${row.registration}; exactly 1 is required.`);
    if (!row.source) recordBlockers.push(`DealerKit snapshot has no source record for ${row.registration}.`);
    const detailResult = detailResults[index];
    if (row.source && !detailResult?.ok) recordBlockers.push(`DealerKit detail read failed for ${row.registration}: ${clean(detailResult?.error?.message, 300) || "unknown error"}.`);
    const vehicle = detailResult?.ok ? detailResult.value : null;
    if (vehicle && normalizeFinanceRegistration(vehicle.registration || "") !== row.registration) recordBlockers.push(`DealerKit detail registration changed for ${row.registration}.`);

    const base = {
      lane: row.lane,
      registration: row.registration,
      masterItem: row.masterItem,
      detailItem: detailRows.length === 1 ? detailRows[0] : null,
      vehicle,
      blockers: recordBlockers,
      proposed: {}, audit: {}, changeFields: [],
    };
    records.push(recordBlockers.length || !base.detailItem || !vehicle ? base : { ...planForRecord(base), blockers: [] });
  }

  const recordBlockerCount = records.filter((record) => record.blockers.length).length;
  const globalSafe = blockers.length === 0 && recordBlockerCount === 0 && records.length === EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT;
  const publicRecords = records.map((record) => recordPublicSummary(record, secret, globalSafe));
  return {
    ok: true,
    dryRun: true,
    safeToExecute: globalSafe,
    checkedAt: new Date().toISOString(),
    blockers,
    summary: {
      expected: { finance: EXPECTED_FINANCE_COUNT, cars: EXPECTED_CARS_COUNT, total: EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT },
      publishedMasters: { finance: inventory.financeMasters.length, cars: inventory.carMasters.length, total: inventory.financeMasters.length + inventory.carMasters.length },
      usableMasterRegistrations: rows.length,
      dealerKitSnapshotComplete: Boolean(snapshot.complete),
      dealerKitSourceCount: snapshot.vehicleCount,
      recordBlockerCount,
      recordsWithChanges: records.filter((record) => record.changeFields.length).length,
      recordsAlreadyComplete: records.filter((record) => !record.blockers.length && !record.changeFields.length).length,
      fieldChanges: records.reduce((sum, record) => sum + record.changeFields.length, 0),
    },
    records: publicRecords,
  };
}

async function buildSingleFreshPlan(registrationInput, environment = process.env) {
  const registration = normalizeFinanceRegistration(registrationInput || "");
  if (!registration) throw new ControlledPublishError(400, "A valid registration is required.");
  const configuration = controlledWixConfiguration(environment);
  const inventory = await loadWixInventory(configuration);
  const blockers = inventoryBlockers(inventory);
  if (blockers.length) throw new ControlledPublishError(409, "Published Wix inventory no longer matches the approved 33 Finance + 6 Cars backfill set.", { blockers });

  const financeMasterRows = inventory.financeMasterIndex.grouped.get(registration) || [];
  const carMasterRows = inventory.carMasterIndex.grouped.get(registration) || [];
  if ((financeMasterRows.length ? 1 : 0) + (carMasterRows.length ? 1 : 0) !== 1) throw new ControlledPublishError(409, `${registration} is not an unambiguous member of exactly one published master lane.`);
  const lane = carMasterRows.length ? "cars" : "finance";
  const masterItem = (carMasterRows.length ? carMasterRows : financeMasterRows)[0];
  const detailRows = lane === "cars"
    ? (inventory.carDetailIndex.grouped.get(registration) || [])
    : (inventory.financeDetailIndex.grouped.get(registration) || []);
  if (detailRows.length !== 1) throw new ControlledPublishError(409, `${lane === "cars" ? "CARPAGES" : "VANFINANCEPAGES"} has ${detailRows.length} exact detail rows for ${registration}; exactly 1 is required.`);

  const snapshot = await fetchDealerKitStockSnapshot({ environment, allowPartial: false });
  const source = sourceIndex(snapshot).get(registration);
  if (!source?.supplierStockId) throw new ControlledPublishError(409, `DealerKit has no current source record for ${registration}.`);
  const vehicle = await fetchDealerKitStockDetail(source.supplierStockId, { environment, specifications: true });
  if (normalizeFinanceRegistration(vehicle.registration || "") !== registration) throw new ControlledPublishError(409, `DealerKit detail registration changed for ${registration}.`);
  return { configuration, ...planForRecord({ lane, registration, masterItem, detailItem: detailRows[0], vehicle }) };
}

function setFieldModifications(proposed = {}) {
  return Object.entries(proposed).map(([fieldPath, value]) => ({ fieldPath, action: "SET_FIELD", setFieldOptions: { value } }));
}

function rollbackFieldModifications(detailItem, proposed = {}) {
  const previous = detailItem?.data || {};
  return Object.keys(proposed).map((fieldPath) => Object.prototype.hasOwnProperty.call(previous, fieldPath)
    ? { fieldPath, action: "SET_FIELD", setFieldOptions: { value: previous[fieldPath] } }
    : { fieldPath, action: "REMOVE_FIELD" });
}

async function queryExactRegistration(configuration, collectionId, registration) {
  const payload = await controlledWixRequest(configuration, "/wix-data/v2/items/query", {
    method: "POST",
    body: {
      dataCollectionId: collectionId,
      query: { filter: { title: { $eq: registration } }, paging: { limit: 3, offset: 0 } },
      consistentRead: true,
    },
  });
  return (Array.isArray(payload?.dataItems) ? payload.dataItems : []).filter((item) => itemRegistration(item) === registration);
}

async function verifyAfterWrite(plan) {
  const collectionId = plan.lane === "cars" ? "CARPAGES" : "VANFINANCEPAGES";
  const rows = await queryExactRegistration(plan.configuration, collectionId, plan.registration);
  if (rows.length !== 1 || rows[0].id !== plan.detailItem.id) return { ok: false, reason: `Expected exactly one unchanged detail identity after write; found ${rows.length}.`, row: rows[0] || null };
  const after = rows[0];
  for (const [field, expected] of Object.entries(plan.proposed)) {
    if (stableStringify(after?.data?.[field]) !== stableStringify(expected)) return { ok: false, reason: `Allowed field ${field} did not read back exactly.`, row: after };
  }
  const beforeProtected = sha256(protectedData(plan.detailItem.data || {}, plan.lane));
  const afterProtected = sha256(protectedData(after.data || {}, plan.lane));
  if (beforeProtected !== afterProtected) return { ok: false, reason: "A protected field changed during the backfill write.", row: after };
  return { ok: true, row: after, protectedHash: afterProtected };
}

async function rollbackPlan(plan) {
  const collectionId = plan.lane === "cars" ? "CARPAGES" : "VANFINANCEPAGES";
  const modifications = rollbackFieldModifications(plan.detailItem, plan.proposed);
  if (modifications.length) {
    await controlledWixRequest(plan.configuration, `/wix-data/v2/items/${encodeURIComponent(plan.detailItem.id)}`, {
      method: "PATCH",
      body: { dataCollectionId: collectionId, patch: { dataItemId: plan.detailItem.id, fieldModifications: modifications } },
    });
  }
  const rows = await queryExactRegistration(plan.configuration, collectionId, plan.registration);
  const restored = rows.length === 1 && rows[0].id === plan.detailItem.id
    && stableStringify(rows[0].data || {}) === stableStringify(plan.detailItem.data || {});
  return { restored, rowCount: rows.length };
}

async function executeOne(registration, token, environment = process.env) {
  const secret = signingSecret(environment);
  if (!secret) throw new ControlledPublishError(500, "Backfill signing secret is unavailable.");
  const plan = await buildSingleFreshPlan(registration, environment);
  if (!plan.changeFields.length) {
    return { ok: true, executed: false, alreadyComplete: true, lane: plan.lane, registration: plan.registration, message: `${plan.registration} already has all source-backed technical/equipment data in scope.` };
  }
  const fingerprint = buildBackfillFingerprint(plan);
  const expectedToken = signBackfillFingerprint(secret, fingerprint);
  if (!safeTokenEqual(token, expectedToken)) throw new ControlledPublishError(409, "Backfill confirmation token is stale or does not match the current DealerKit/Wix state. Run the dry-run again.");

  const collectionId = plan.lane === "cars" ? "CARPAGES" : "VANFINANCEPAGES";
  const modifications = setFieldModifications(plan.proposed);
  let writeAttempted = false;
  try {
    writeAttempted = true;
    await controlledWixRequest(plan.configuration, `/wix-data/v2/items/${encodeURIComponent(plan.detailItem.id)}`, {
      method: "PATCH",
      body: { dataCollectionId: collectionId, patch: { dataItemId: plan.detailItem.id, fieldModifications: modifications } },
    });
    const verification = await verifyAfterWrite(plan);
    if (!verification.ok) throw new ControlledPublishError(502, verification.reason, { verification });
    return {
      ok: true,
      executed: true,
      verified: true,
      lane: plan.lane,
      registration: plan.registration,
      detailItemId: plan.detailItem.id,
      changedFields: plan.changeFields,
      protectedFieldsUnchanged: true,
      protectedDataHash: verification.protectedHash,
      message: `${plan.registration} technical/equipment backfill was written and verified.`,
    };
  } catch (error) {
    let rollback = null;
    if (writeAttempted) {
      try { rollback = await rollbackPlan(plan); }
      catch (rollbackError) { rollback = { restored: false, error: clean(rollbackError?.message, 500) || "Rollback failed." }; }
    }
    throw new ControlledPublishError(error?.status || 502, error?.message || "Technical backfill write failed.", {
      ...(error?.details || {}),
      rollback,
      manualAttentionRequired: Boolean(writeAttempted && !rollback?.restored),
    });
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    assertPreviewBranch(process.env);
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return response.status(405).json({ ok: false, message: "Method not allowed." });
    }
    const action = clean(request.query?.action, 40).toLowerCase() || "dry-run";
    if (action === "dry-run") return response.status(200).json(await buildCompleteDryRun(process.env));
    if (action === "execute") {
      const registration = clean(request.query?.registration, 30);
      const token = clean(request.query?.token, 200);
      if (!registration || !token) return response.status(400).json({ ok: false, message: "Registration and dry-run confirmation token are required." });
      return response.status(200).json(await executeOne(registration, token, process.env));
    }
    return response.status(400).json({ ok: false, message: "Supported actions are dry-run and execute." });
  } catch (error) {
    return response.status(error?.status || 502).json({
      ok: false,
      message: error?.message || "Temporary technical backfill failed.",
      details: error?.details || null,
    });
  }
}
