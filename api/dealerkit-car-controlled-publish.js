import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { carPublishConfirmationMatches } from "../lib/dealerKitCarWixPlan.js";
import { wixItemPublishStatus } from "../lib/dealerKitControlledPublishPlan.js";
import { ControlledPublishError, controlledWixRequest } from "./_dealerkit-controlled-publish-state.js";
import { setTargetPublishStatus } from "./dealerkit-controlled-publish.js";
import { buildFreshCarControlledPublishState } from "./_dealerkit-car-controlled-publish-state.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

// CARS_CREATE_OR_UPDATE_RECONCILE: Cars now uses the same fresh-plan intent,
// exact-ID reuse, publish-status restore and rollback principles as the van lanes.

function authorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function orderedTargets(targets = []) {
  return [...targets].sort((left, right) => {
    if (left.kind === right.kind) return left.collectionId.localeCompare(right.collectionId);
    return left.kind === "detail" ? -1 : 1;
  });
}

function fieldRollbackSnapshot(target) {
  const previous = target?.previousData || {};
  return Object.fromEntries(Object.keys(target?.data || {}).map((fieldPath) => [fieldPath, {
    existed: Object.prototype.hasOwnProperty.call(previous, fieldPath),
    value: previous[fieldPath],
  }]));
}

function setFieldModifications(data = {}) {
  return Object.entries(data).map(([fieldPath, value]) => ({ fieldPath, action: "SET_FIELD", setFieldOptions: { value } }));
}

function rollbackFieldModifications(snapshot = {}) {
  return Object.entries(snapshot).map(([fieldPath, previous]) => previous?.existed
    ? { fieldPath, action: "SET_FIELD", setFieldOptions: { value: previous.value } }
    : { fieldPath, action: "REMOVE_FIELD" });
}

async function insertTarget(configuration, target) {
  const payload = await controlledWixRequest(configuration, "/wix-data/v2/items", {
    method: "POST",
    body: { dataCollectionId: target.collectionId, dataItem: { data: target.data } },
  });
  const item = payload?.dataItem;
  if (!item?.id) throw new ControlledPublishError(502, `Wix did not return an item ID after creating ${target.collectionId}.`);
  return { operation: "create", collectionId: target.collectionId, kind: target.kind, itemId: item.id };
}

async function updateTarget(configuration, target) {
  const itemId = clean(target?.itemId, 300);
  if (!itemId) throw new ControlledPublishError(409, `Existing ${target?.collectionId || "Cars detail"} item ID is missing.`);
  const fieldModifications = setFieldModifications(target.data || {});
  if (!fieldModifications.length) throw new ControlledPublishError(409, `No fields are available to update in ${target.collectionId}.`);

  await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: { dataCollectionId: target.collectionId, patch: { dataItemId: itemId, fieldModifications } },
  });
  return {
    operation: "update",
    collectionId: target.collectionId,
    kind: target.kind,
    itemId,
    previousFields: fieldRollbackSnapshot(target),
  };
}

async function applyTarget(configuration, target) {
  return target?.operation === "update" ? updateTarget(configuration, target) : insertTarget(configuration, target);
}

async function rollbackWrite(configuration, item) {
  if (item.operation === "update") {
    const fieldModifications = rollbackFieldModifications(item.previousFields || {});
    if (fieldModifications.length) {
      await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(item.itemId)}`, {
        method: "PATCH",
        body: { dataCollectionId: item.collectionId, patch: { dataItemId: item.itemId, fieldModifications } },
      });
    }
    return;
  }
  await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(item.itemId)}?dataCollectionId=${encodeURIComponent(item.collectionId)}`, { method: "DELETE" });
}

async function rollbackWrites(configuration, writes = []) {
  const outcomes = [];
  for (const item of [...writes].reverse()) {
    try {
      await rollbackWrite(configuration, item);
      outcomes.push({ ...item, rolledBack: true });
    } catch (error) {
      outcomes.push({ ...item, rolledBack: false, error: clean(error?.message, 500) || "Rollback failed" });
    }
  }
  return outcomes;
}

async function rollbackPublishStatuses(configuration, transitions = []) {
  const outcomes = [];
  for (const transition of [...transitions].reverse()) {
    if (transition.sourceOperation === "create") {
      outcomes.push({ ...transition, rolledBack: true, skipped: true, reason: "Created row will be removed by field-write rollback." });
      continue;
    }
    const previous = clean(transition.previousPublishStatus, 80).toUpperCase();
    if (!["PUBLISHED", "DRAFT"].includes(previous)) {
      outcomes.push({ ...transition, rolledBack: false, error: "Previous Wix publish status was unavailable." });
      continue;
    }
    try {
      await setTargetPublishStatus(configuration, {
        ...transition,
        desiredPublishStatus: previous,
        currentPublishStatus: transition.desiredPublishStatus,
        rollbackPublishStatus: true,
      }, transition.itemId);
      outcomes.push({ ...transition, rolledBack: true });
    } catch (error) {
      outcomes.push({ ...transition, rolledBack: false, error: clean(error?.message, 500) || "Publish-status rollback failed" });
    }
  }
  return outcomes;
}

async function verifyWritten(configuration, registration, targets = [], writes = []) {
  const results = [];
  const writesByCollection = new Map(writes.map((write) => [write.collectionId, write]));
  for (const target of targets) {
    const payload = await controlledWixRequest(configuration, "/wix-data/v2/items/query", {
      method: "POST",
      body: {
        dataCollectionId: target.collectionId,
        query: { filter: { title: { $eq: registration } }, paging: { limit: 3, offset: 0 } },
        consistentRead: true,
      },
    });
    const items = Array.isArray(payload.dataItems) ? payload.dataItems : [];
    const exact = items.length === 1 && normalizeFinanceRegistration(items[0]?.data?.title || "") === registration;
    const expectedId = target.operation === "update"
      ? clean(target.itemId, 300)
      : clean(writesByCollection.get(target.collectionId)?.itemId, 300);
    const identityMatches = Boolean(expectedId) && clean(items[0]?.id, 300) === expectedId;
    const publishStatus = wixItemPublishStatus(items[0]);
    const desiredPublishStatus = clean(target.desiredPublishStatus, 80).toUpperCase();
    const publishStatusMatches = !desiredPublishStatus || !publishStatus || publishStatus === desiredPublishStatus;
    results.push({
      collectionId: target.collectionId,
      operation: target.operation || "create",
      count: items.length,
      verified: exact && identityMatches && publishStatusMatches,
      itemId: items[0]?.id || null,
      expectedItemId: expectedId || null,
      publishStatus: publishStatus || null,
      desiredPublishStatus: desiredPublishStatus || null,
    });
  }
  return { verified: results.length === targets.length && results.every((item) => item.verified), results };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  const action = clean(request.body?.action, 100);
  if (!["publish_new_car", "update_existing_car"].includes(action)) return response.status(400).json({ ok: false, message: "Controlled Cars publish action is not supported." });

  const registration = normalizeFinanceRegistration(request.body?.registration || "");
  const confirmRegistration = normalizeFinanceRegistration(request.body?.confirmRegistration || "");
  if (!registration || registration !== confirmRegistration) return response.status(400).json({ ok: false, message: "Type the vehicle registration exactly to unlock Cars publishing." });

  let state = null;
  const writes = [];
  const statusTransitions = [];
  try {
    state = await buildFreshCarControlledPublishState(registration);
    const requestedIntent = action === "update_existing_car" ? "update_existing_vehicle" : "create_new_vehicle";
    if (state.plan.writeIntent !== requestedIntent) throw new ControlledPublishError(409, "The Cars Wix write intent changed during the final recheck. Rebuild the preview before continuing.", { expected: state.plan.writeIntent, requested: requestedIntent });
    if (!state.plan.canPublish) throw new ControlledPublishError(409, "The fresh DealerKit/Wix Cars state is not safe for reconciliation.", { blockers: state.plan.blockers });
    if (!carPublishConfirmationMatches(request.body?.confirmation, state.plan)) throw new ControlledPublishError(409, "The Cars publish preview is stale. Rebuild the final preview before publishing.");

    const targets = orderedTargets(state.plan.targets);
    if (targets.length !== 2 || !targets.some((target) => target.collectionId === "CARFINANCE") || !targets.some((target) => target.collectionId === "CARPAGES")) {
      throw new ControlledPublishError(409, "The verified Cars write plan must contain exactly CARFINANCE and CARPAGES.");
    }

    for (const target of targets) writes.push(await applyTarget(state.configuration, target));
    for (const target of targets.filter((item) => item.publishStatusOperation)) {
      const itemId = target.operation === "create"
        ? clean(writes.find((write) => write.collectionId === target.collectionId)?.itemId, 300)
        : clean(target.itemId, 300);
      statusTransitions.push(await setTargetPublishStatus(state.configuration, target, itemId));
    }

    const verification = await verifyWritten(state.configuration, registration, targets, writes);
    if (!verification.verified) {
      const statusRollback = await rollbackPublishStatuses(state.configuration, statusTransitions);
      const rollback = await rollbackWrites(state.configuration, writes);
      const rollbackComplete = rollback.every((item) => item.rolledBack);
      const statusRollbackComplete = statusRollback.every((item) => item.rolledBack);
      throw new ControlledPublishError(502, rollbackComplete && statusRollbackComplete
        ? "Cars reconciliation could not be verified, so every completed change was rolled back."
        : "Cars reconciliation could not be verified and at least one rollback needs manual attention.",
      { verification, rollback, statusRollback, statusTransitions, manualAttentionRequired: !rollbackComplete || !statusRollbackComplete });
    }

    const created = writes.filter((item) => item.operation === "create");
    const updated = writes.filter((item) => item.operation === "update");
    return response.status(200).json({
      ok: true,
      published: true,
      verified: true,
      writeIntent: state.plan.writeIntent,
      registration,
      recordsWritten: writes.length,
      recordsCreated: created.length,
      recordsUpdated: updated.length,
      writes,
      publishStatusTransitions: statusTransitions,
      verification: verification.results,
      message: `${registration} was reconciled and verified in Cars: ${created.length} created, ${updated.length} updated, ${statusTransitions.filter((item) => item.action === "publish").length} published/restored.`,
    });
  } catch (error) {
    let statusRollback = error?.details?.statusRollback || [];
    if (statusTransitions.length && !statusRollback.length && state) statusRollback = await rollbackPublishStatuses(state.configuration, statusTransitions);
    let rollback = [];
    if (writes.length && !error?.details?.rollback && state) rollback = await rollbackWrites(state.configuration, writes);
    const reportedRollback = error?.details?.rollback || rollback;
    const rollbackComplete = !writes.length || (reportedRollback.length === writes.length && reportedRollback.every((item) => item.rolledBack));
    const statusRollbackComplete = !statusTransitions.length || (statusRollback.length === statusTransitions.length && statusRollback.every((item) => item.rolledBack));
    return response.status(error?.status || 502).json({
      ok: false,
      published: false,
      registration,
      writesBeforeFailure: writes,
      rollback: reportedRollback,
      publishStatusTransitions: statusTransitions,
      publishStatusRollback: statusRollback,
      manualAttentionRequired: Boolean(error?.details?.manualAttentionRequired || error?.details?.publishStatusChangeUncertain || (writes.length > 0 && !rollbackComplete) || (statusTransitions.length > 0 && !statusRollbackComplete)),
      message: error?.message || "Controlled Cars reconciliation failed.",
      details: error?.details || null,
    });
  }
}
