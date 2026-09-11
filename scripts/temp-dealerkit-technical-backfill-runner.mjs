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
  protectedData,
  safeTokenEqual,
  sha256,
  signBackfillFingerprint,
  stableStringify,
} from "../lib/_tempDealerKitTechnicalBackfill.js";

const EXPECTED_BRANCH = "fix/dealerkit-complete-vehicle-specifications";
const FINANCE_COHORT_START = "2026-09-10T00:00:00.000Z";
const CARS_COHORT_START = "2026-09-04T00:00:00.000Z";
const EXPECTED_MISSING_DETAIL_REGISTRATION = "LF73CRL";
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

async function queryByStoredTitle(configuration, collectionId, storedTitle) {
  const payload = await controlledWixRequest(configuration, "/wix-data/v2/items/query", {
    method: "POST",
    body: {
      dataCollectionId: collectionId,
      query: { filter: { title: { $eq: storedTitle } }, paging: { limit: 3, offset: 0 } },
      consistentRead: true,
    },
  });
  return Array.isArray(payload?.dataItems) ? payload.dataItems : [];
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
    const matchingKeys = scalarStrings(item?.data || {})
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

function isExpectedMissingDetail(row) {
  return row.lane === "finance"
    && row.registration === EXPECTED_MISSING_DETAIL_REGISTRATION
    && row.masterRows.length === 1
    && row.detailRows.length === 0
    && row.referenceRows.length === 0;
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

function fieldChangeCounts(plans = []) {
  const counts = {};
  for (const plan of plans) for (const field of plan.changeFields) counts[field] = (counts[field] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
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
    const referenceRows = row.detailRows.length === 0
      ? registrationReferences(row.lane === "cars" ? inventory.carDetailsRaw : inventory.financeDetailsRaw, row.registration)
      : [];
    const candidate = { ...row, referenceRows };
    const rowBlockers = [];
    if (row.masterRows.length !== 1) rowBlockers.push(`${row.registration} has ${row.masterRows.length} master rows in ${row.lane}.`);
    if (row.detailRows.length !== 1 && !isExpectedMissingDetail(candidate)) rowBlockers.push(`${row.registration} has ${row.detailRows.length} exact historical detail rows in ${row.lane}.`);
    if (duplicateSources.has(row.registration)) rowBlockers.push(`DealerKit returned more than one source identity for ${row.registration}.`);
    return { ...candidate, rowBlockers, excludedMissingDetail: isExpectedMissingDetail(candidate) };
  });
  for (const row of rowStates) blockers.push(...row.rowBlockers);

  const excluded = rowStates.filter((row) => row.excludedMissingDetail);
  if (excluded.length !== 1 || excluded[0]?.registration !== EXPECTED_MISSING_DETAIL_REGISTRATION) blockers.push(`Expected exactly one missing-detail exception for ${EXPECTED_MISSING_DETAIL_REGISTRATION}.`);

  const structurallyReady = rowStates.filter((row) => !row.excludedMissingDetail && row.rowBlockers.length === 0);
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

  if (plans.length !== EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT - 1) blockers.push(`Built ${plans.length} existing-detail plans, expected 38.`);
  const safe = blockers.length === 0;
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
  const summary = {
    expected: { finance: EXPECTED_FINANCE_COUNT, cars: EXPECTED_CARS_COUNT, total: EXPECTED_FINANCE_COUNT + EXPECTED_CARS_COUNT },
    cohortStarts: { finance: FINANCE_COHORT_START, cars: CARS_COHORT_START },
    targetCounts: { finance: financeTargets.length, cars: carTargets.length, total: targetRows.length },
    existingDetailPlans: plans.length,
    excludedMissingDetail: excluded.map((row) => ({ registration: row.registration, referencesFound: row.referenceRows.length })),
    wixScanned: inventory.scanned,
    dealerKit: { complete: snapshot.complete, reportedTotal: snapshot.apiReportedTotal, usableRecords: snapshot.vehicleCount },
    recordsWithChanges: plans.filter((plan) => plan.changeFields.length).length,
    noOpRecords: plans.filter((plan) => !plan.changeFields.length).length,
    changedByLane: {
      finance: plans.filter((plan) => plan.lane === "finance" && plan.changeFields.length).length,
      cars: plans.filter((plan) => plan.lane === "cars" && plan.changeFields.length).length,
    },
    fieldChangeCounts: fieldChangeCounts(plans),
    registrations: {
      finance: financeTargets.map((row) => row.registration).sort(),
      cars: carTargets.map((row) => row.registration).sort(),
    },
  };
  return { safe, executed: false, configuration, secret, inventory, snapshot, plans, blockers, records, summary, error: blockers[0] || null };
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

function collectionIdsForPlan(plan) {
  return plan.lane === "cars"
    ? { master: "CARFINANCE", detail: "CARPAGES" }
    : { master: "VANFINANCE-ALLVANS", detail: "VANFINANCEPAGES" };
}

async function freshItemByStoredTitle(configuration, collectionId, expectedItem) {
  const storedTitle = expectedItem?.data?.title;
  if (!storedTitle) throw new Error(`${collectionId} stored title is missing for ${expectedItem?.id || "unknown item"}.`);
  const rows = await queryByStoredTitle(configuration, collectionId, storedTitle);
  const expectedId = clean(expectedItem?.id, 300);
  const exact = rows.filter((item) => clean(item?.id, 300) === expectedId);
  if (exact.length !== 1) throw new Error(`${collectionId} no longer has exactly one expected item ${expectedId} for stored title ${storedTitle}.`);
  return exact[0];
}

async function refreshPlan(plan, configuration, secret, environment = process.env) {
  const ids = collectionIdsForPlan(plan);
  const [masterItem, detailItem, vehicle] = await Promise.all([
    freshItemByStoredTitle(configuration, ids.master, plan.masterItem),
    freshItemByStoredTitle(configuration, ids.detail, plan.detailItem),
    fetchDealerKitStockDetail(plan.vehicle.supplierStockId, { environment, specifications: true }),
  ]);
  if (sha256(masterItem.data || {}) !== sha256(plan.masterItem.data || {})) throw new Error(`${plan.registration} master row changed after dry-run.`);
  if (sha256(detailItem.data || {}) !== sha256(plan.detailItem.data || {})) throw new Error(`${plan.registration} detail row changed after dry-run.`);
  if (normalizeFinanceRegistration(vehicle.registration || "") !== plan.registration) throw new Error(`${plan.registration} DealerKit identity changed after dry-run.`);
  const fresh = buildPlan({
    lane: plan.lane,
    registration: plan.registration,
    updatedAt: plan.updatedAt,
    masterRows: [masterItem],
    detailRows: [detailItem],
  }, vehicle);
  const expectedToken = signBackfillFingerprint(secret, buildBackfillFingerprint(fresh));
  const originalToken = signBackfillFingerprint(secret, buildBackfillFingerprint(plan));
  if (!safeTokenEqual(originalToken, expectedToken)) throw new Error(`${plan.registration} dry-run fingerprint is stale.`);
  return fresh;
}

async function readBackDetail(plan, configuration) {
  const ids = collectionIdsForPlan(plan);
  return freshItemByStoredTitle(configuration, ids.detail, plan.detailItem);
}

function verifyAllowedAndProtected(plan, after) {
  for (const [field, expected] of Object.entries(plan.proposed)) {
    if (stableStringify(after?.data?.[field]) !== stableStringify(expected)) throw new Error(`${plan.registration} allowed field ${field} did not read back exactly.`);
  }
  const beforeProtected = sha256(protectedData(plan.detailItem.data || {}, plan.lane));
  const afterProtected = sha256(protectedData(after?.data || {}, plan.lane));
  if (beforeProtected !== afterProtected) throw new Error(`${plan.registration} a protected business field changed during the backfill.`);
}

async function rollbackPlan(plan, configuration) {
  const ids = collectionIdsForPlan(plan);
  const modifications = rollbackFieldModifications(plan.detailItem, plan.proposed);
  if (modifications.length) {
    await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(plan.detailItem.id)}`, {
      method: "PATCH",
      body: { dataCollectionId: ids.detail, patch: { dataItemId: plan.detailItem.id, fieldModifications: modifications } },
    });
  }
  const restored = await readBackDetail(plan, configuration);
  for (const field of Object.keys(plan.proposed)) {
    const beforeExists = Object.prototype.hasOwnProperty.call(plan.detailItem.data || {}, field);
    const afterExists = Object.prototype.hasOwnProperty.call(restored.data || {}, field);
    if (beforeExists !== afterExists) throw new Error(`${plan.registration} rollback field-presence verification failed for ${field}.`);
    if (beforeExists && stableStringify(restored.data[field]) !== stableStringify(plan.detailItem.data[field])) throw new Error(`${plan.registration} rollback value verification failed for ${field}.`);
  }
  if (sha256(protectedData(restored.data || {}, plan.lane)) !== sha256(protectedData(plan.detailItem.data || {}, plan.lane))) throw new Error(`${plan.registration} rollback protected-field verification failed.`);
  return true;
}

async function applyOne(plan, configuration, secret, environment = process.env) {
  const fresh = await refreshPlan(plan, configuration, secret, environment);
  if (!fresh.changeFields.length) return { registration: plan.registration, lane: plan.lane, executed: false, alreadyComplete: true, plan: fresh };
  const ids = collectionIdsForPlan(fresh);
  let writeAttempted = false;
  try {
    writeAttempted = true;
    await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(fresh.detailItem.id)}`, {
      method: "PATCH",
      body: { dataCollectionId: ids.detail, patch: { dataItemId: fresh.detailItem.id, fieldModifications: setFieldModifications(fresh.proposed) } },
    });
    const after = await readBackDetail(fresh, configuration);
    verifyAllowedAndProtected(fresh, after);
    return { registration: fresh.registration, lane: fresh.lane, executed: true, verified: true, changedFields: fresh.changeFields, plan: fresh };
  } catch (error) {
    if (writeAttempted) {
      try { await rollbackPlan(fresh, configuration); }
      catch (rollbackError) { throw new Error(`${error.message} Current-record rollback also failed: ${rollbackError.message}`); }
    }
    throw error;
  }
}

async function executeDryRun(dryRun, environment = process.env) {
  if (!dryRun.safe) throw new Error(`Backfill execution refused: ${dryRun.error || "dry-run is not safe"}.`);
  const pending = dryRun.plans.filter((plan) => plan.changeFields.length);
  const applied = [];
  const outcomes = [];
  try {
    for (const plan of pending) {
      const outcome = await applyOne(plan, dryRun.configuration, dryRun.secret, environment);
      outcomes.push({ registration: outcome.registration, lane: outcome.lane, executed: outcome.executed, verified: outcome.verified === true, changedFields: outcome.changedFields || [] });
      if (outcome.executed) applied.push(outcome.plan);
      console.log("TEMP_TECHNICAL_BACKFILL_EXECUTE", JSON.stringify(outcomes[outcomes.length - 1]));
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const appliedPlan of [...applied].reverse()) {
      try { await rollbackPlan(appliedPlan, dryRun.configuration); }
      catch (rollbackError) { rollbackFailures.push({ registration: appliedPlan.registration, error: rollbackError.message }); }
    }
    if (rollbackFailures.length) throw new Error(`${error.message} Prior-record rollback needs manual attention: ${JSON.stringify(rollbackFailures)}`);
    throw new Error(`${error.message} All earlier successful writes in this run were rolled back.`);
  }

  const finalCheck = await buildDryRun(environment);
  console.log("TEMP_TECHNICAL_BACKFILL_FINAL", JSON.stringify({ safe: finalCheck.safe, blockers: finalCheck.blockers, summary: finalCheck.summary }));
  if (!finalCheck.safe || finalCheck.summary.recordsWithChanges !== 0) throw new Error(`Final backfill verification found ${finalCheck.summary.recordsWithChanges} existing detail record(s) still requiring changes.`);
  return { safe: true, executed: true, outcomes, finalCheck };
}

export async function runTechnicalBackfillBuild({ execute = false } = {}) {
  if (!isTargetPreview()) {
    console.log("TEMP_TECHNICAL_BACKFILL skipped outside the dedicated preview branch.");
    return { skipped: true, safe: true, executed: false };
  }
  const dryRun = await buildDryRun(process.env);
  console.log("TEMP_TECHNICAL_BACKFILL_DRY_RUN", JSON.stringify({ safe: dryRun.safe, blockers: dryRun.blockers, summary: dryRun.summary }));
  for (const record of dryRun.records) console.log("TEMP_TECHNICAL_BACKFILL_TARGET", JSON.stringify(record));
  if (!execute) return dryRun;
  return executeDryRun(dryRun, process.env);
}
