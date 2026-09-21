import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { controlledPublishConfirmationMatches, wixItemPublishStatus } from "../lib/dealerKitControlledPublishPlan.js";
import { registrationTitleVariants } from "../lib/wixRegistrationVariants.js";
import {
  ControlledPublishError,
  buildFreshControlledPublishState,
  controlledWixRequest,
} from "./_dealerkit-controlled-publish-state.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);
const WIX_TASK_POLL_DELAY_MS = 350;
const WIX_TASK_MAX_POLLS = 24;

// VFC_CREATE_OR_UPDATE_RECONCILE: Van Finance targets may create, update,
// restore to Published, or move an obsolete category row to Draft.

function authorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function orderedTargets(targets = []) {
  return [...targets].sort((left, right) => {
    if (left.kind === right.kind) return `${left.product}:${left.siteId || ""}:${left.collectionId}`.localeCompare(`${right.product}:${right.siteId || ""}:${right.collectionId}`);
    return left.kind === "detail" ? -1 : 1;
  });
}

function configurationForTarget(state, target) {
  const siteId = clean(target?.siteId, 500);
  if (!siteId) return state?.configuration;
  const configuration = state?.configurationsBySiteId?.[siteId];
  if (!configuration) throw new ControlledPublishError(500, `No controlled Wix configuration is available for site ${siteId}.`);
  return configuration;
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
  return { operation: "create", product: target.product, siteId: configuration.siteId, siteLabel: target.siteLabel || configuration.siteLabel || null, collectionId: target.collectionId, kind: target.kind, itemId: item.id };
}

async function updateTarget(configuration, target) {
  const itemId = clean(target?.itemId, 300);
  if (!itemId) throw new ControlledPublishError(409, `Existing ${target?.collectionId || "detail"} item ID is missing.`);
  const fieldModifications = setFieldModifications(target.data || {});
  if (!fieldModifications.length) throw new ControlledPublishError(409, `No fields are available to update in ${target.collectionId}.`);

  await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: { dataCollectionId: target.collectionId, patch: { dataItemId: itemId, fieldModifications } },
  });

  return {
    operation: "update",
    product: target.product,
    siteId: configuration.siteId,
    siteLabel: target.siteLabel || configuration.siteLabel || null,
    collectionId: target.collectionId,
    kind: target.kind,
    itemId,
    previousFields: fieldRollbackSnapshot(target),
  };
}

async function applyTarget(configuration, target) {
  if (target?.operation === "update") return updateTarget(configuration, target);
  if (target?.operation === "create") return insertTarget(configuration, target);
  throw new ControlledPublishError(409, `Unsupported field-write operation ${target?.operation || "(blank)"}.`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPublishStatusTask(configuration, taskId, label, request = controlledWixRequest, wait = sleep) {
  for (let poll = 0; poll < WIX_TASK_MAX_POLLS; poll += 1) {
    let payload;
    try {
      payload = await request(configuration, `/cms/v1/tasks/${encodeURIComponent(taskId)}`, { method: "GET" });
    } catch (error) {
      throw new ControlledPublishError(error?.status || 502, `${label} task status could not be confirmed.`, { ...(error?.details || {}), taskId, publishStatusChangeUncertain: true });
    }
    const task = payload?.task || {};
    const status = clean(task.status, 80).toUpperCase();
    if (status === "COMPLETED") {
      const failed = Number(task.itemsFailed || 0);
      if (failed > 0) throw new ControlledPublishError(502, `${label} completed with a failed Wix item.`, { taskId, publishStatusChangeUncertain: false });
      return task;
    }
    if (status === "FAILED") throw new ControlledPublishError(502, `${label} failed in Wix.`, { taskId, publishStatusChangeUncertain: false });
    await wait(WIX_TASK_POLL_DELAY_MS);
  }
  throw new ControlledPublishError(502, `${label} did not finish in time.`, { taskId, publishStatusChangeUncertain: true });
}

export async function setTargetPublishStatus(configuration, target, itemId, dependencies = {}) {
  const request = dependencies.request || controlledWixRequest;
  const wait = dependencies.wait || sleep;
  const desired = clean(target?.desiredPublishStatus, 80).toUpperCase();
  const operation = desired === "DRAFT" ? "SET_DRAFT_STATUS" : desired === "PUBLISHED" ? "SET_PUBLISHED_STATUS" : "";
  if (!operation) throw new ControlledPublishError(409, `Unsupported publish status ${desired || "(blank)"}.`);
  if (target.collectionId === "VANFINANCEPAGES" && operation === "SET_DRAFT_STATUS" && target.rollbackPublishStatus !== true) throw new ControlledPublishError(409, "VANFINANCEPAGES can never be moved to Draft as an obsolete category.");
  if (!itemId) throw new ControlledPublishError(409, `Missing Wix item ID for the ${target.collectionId} publish-status change.`);

  let payload;
  try {
    payload = await request(configuration, "/cms/v1/tasks", {
      method: "POST",
      body: {
        task: {
          type: "UPDATE_PUBLISH_STATUS",
          updatePublishStatusOptions: {
            dataCollectionId: target.collectionId,
            environment: "LIVE",
            filter: { _id: { $eq: itemId } },
            operation,
          },
        },
      },
    });
  } catch (error) {
    throw new ControlledPublishError(error?.status || 502, `${target.collectionId} publish-status task could not be started safely.`, { ...(error?.details || {}), publishStatusChangeUncertain: true });
  }
  const taskId = clean(payload?.task?.id, 300);
  if (!taskId) throw new ControlledPublishError(502, `${target.collectionId} did not return a Wix publish-status task ID.`, { publishStatusChangeUncertain: true });
  const task = await waitForPublishStatusTask(configuration, taskId, `${target.collectionId} ${desired}`, request, wait);
  return {
    operation: "publish_status",
    action: desired === "DRAFT" ? "draft" : "publish",
    product: target.product,
    siteId: configuration.siteId,
    collectionId: target.collectionId,
    kind: target.kind,
    itemId,
    previousPublishStatus: clean(target.currentPublishStatus, 80).toUpperCase() || null,
    desiredPublishStatus: desired,
    sourceOperation: target.operation,
    taskId,
    taskStatus: clean(task.status, 80).toUpperCase() || "COMPLETED",
  };
}

async function rollbackWrite(state, item) {
  const configuration = configurationForTarget(state, item);
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

async function rollbackCreatedAndUpdated(state, writes = []) {
  const outcomes = [];
  for (const item of [...writes].reverse()) {
    try {
      await rollbackWrite(state, item);
      outcomes.push({ ...item, rolledBack: true });
    } catch (error) {
      outcomes.push({ ...item, rolledBack: false, error: clean(error?.message, 500) || "Rollback failed" });
    }
  }
  return outcomes;
}

async function rollbackPublishStatuses(state, transitions = [], dependencies = {}) {
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
      const rollbackTarget = {
        ...transition,
        desiredPublishStatus: previous,
        currentPublishStatus: transition.desiredPublishStatus,
        rollbackPublishStatus: true,
      };
      await setTargetPublishStatus(configurationForTarget(state, transition), rollbackTarget, transition.itemId, dependencies);
      outcomes.push({ ...transition, rolledBack: true });
    } catch (error) {
      outcomes.push({ ...transition, rolledBack: false, error: clean(error?.message, 500) || "Publish-status rollback failed" });
    }
  }
  return outcomes;
}

function targetKey(target = {}) {
  const product = clean(target.product, 80);
  const siteId = product === "van_finance" ? "" : clean(target.siteId, 500);
  return `${product}:${siteId}:${clean(target.collectionId, 300)}`;
}

export async function verifyWritten(state, registration, targets = [], writes = [], dependencies = {}) {
  const results = [];
  const request = dependencies.request || controlledWixRequest;
  const writesByTarget = new Map(writes.map((write) => [targetKey(write), write]));
  for (const target of targets) {
    const configuration = configurationForTarget(state, target);
    const candidates = target.kind === "detail" ? registrationTitleVariants(registration) : [registration];
    const matched = new Map();
    for (const candidate of candidates) {
      const payload = await request(configuration, "/wix-data/v2/items/query", {
        method: "POST",
        body: { dataCollectionId: target.collectionId, query: { filter: { title: { $eq: candidate } }, paging: { limit: 3, offset: 0 } }, consistentRead: true },
      });
      for (const item of Array.isArray(payload.dataItems) ? payload.dataItems : []) {
        if (normalizeFinanceRegistration(item?.data?.title || "") !== registration) continue;
        const id = clean(item?.id, 300);
        if (id) matched.set(id, item);
      }
      if (target.kind !== "detail" && matched.size) break;
    }
    const items = Array.from(matched.values());
    const exact = items.length === 1 && normalizeFinanceRegistration(items[0]?.data?.title || "") === registration;
    const written = writesByTarget.get(targetKey(target));
    const expectedId = target.operation === "create" ? clean(written?.itemId, 300) : clean(target.itemId, 300);
    const identityMatches = Boolean(expectedId) && clean(items[0]?.id, 300) === expectedId;
    const publishStatus = wixItemPublishStatus(items[0]);
    const desiredPublishStatus = clean(target.desiredPublishStatus, 80).toUpperCase();
    const publishStatusMatches = !desiredPublishStatus || !publishStatus || publishStatus === desiredPublishStatus;
    results.push({ operation: target.operation, product: target.product, siteId: configuration.siteId, siteLabel: target.siteLabel || configuration.siteLabel || null, collectionId: target.collectionId, count: items.length, verified: exact && identityMatches && publishStatusMatches, itemId: items[0]?.id || null, expectedItemId: expectedId || null, publishStatus: publishStatus || null, desiredPublishStatus: desiredPublishStatus || null, publishStatusVerified: publishStatusMatches });
  }
  return { verified: results.length === targets.length && results.every((item) => item.verified), results };
}

function createdItemIdForTarget(target, writes) {
  if (target.operation !== "create") return clean(target.itemId, 300);
  return clean(writes.find((write) => targetKey(write) === targetKey(target))?.itemId, 300);
}

export async function reconcileControlledTargets(state, registration, targets = [], dependencies = {}) {
  const apply = dependencies.applyTarget || applyTarget;
  const setStatus = dependencies.setTargetPublishStatus || setTargetPublishStatus;
  const verify = dependencies.verifyWritten || verifyWritten;
  const rollbackWrites = dependencies.rollbackCreatedAndUpdated || rollbackCreatedAndUpdated;
  const rollbackStatuses = dependencies.rollbackPublishStatuses || rollbackPublishStatuses;
  const writes = [];
  const statusTransitions = [];

  try {
    for (const target of targets.filter((item) => item.operation !== "draft")) {
      writes.push(await apply(configurationForTarget(state, target), target));
    }
    for (const target of targets.filter((item) => item.publishStatusOperation)) {
      const itemId = createdItemIdForTarget(target, writes);
      statusTransitions.push(await setStatus(configurationForTarget(state, target), target, itemId));
    }

    const verification = await verify(state, registration, targets, writes);
    if (!verification.verified) throw new ControlledPublishError(502, "Wix reconciliation could not be verified.", { verification });
    return { writes, statusTransitions, verification };
  } catch (error) {
    const statusRollback = await rollbackStatuses(state, statusTransitions);
    const rollback = rollbackWrites === rollbackCreatedAndUpdated
      ? await rollbackCreatedAndUpdated(state, writes)
      : await rollbackWrites(state, writes);
    const statusRollbackComplete = statusRollback.every((item) => item.rolledBack);
    const rollbackComplete = rollback.every((item) => item.rolledBack);
    const manualAttentionRequired = Boolean(error?.details?.publishStatusChangeUncertain || !statusRollbackComplete || !rollbackComplete);
    throw new ControlledPublishError(error?.status || 502, manualAttentionRequired
      ? "Wix reconciliation failed and at least one field or publish-status change needs manual attention."
      : "Wix reconciliation failed, so completed changes were rolled back.", {
      ...(error?.details || {}),
      writes,
      statusTransitions,
      rollback,
      statusRollback,
      manualAttentionRequired,
      cause: clean(error?.message, 1000) || "Controlled reconciliation failed.",
    });
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });

  const action = clean(request.body?.action, 100);
  if (!["publish_new_vehicle", "update_existing_vehicle"].includes(action)) return response.status(400).json({ ok: false, message: "Controlled publish action is not supported." });

  const registration = normalizeFinanceRegistration(request.body?.registration || "");
  const confirmRegistration = normalizeFinanceRegistration(request.body?.confirmRegistration || "");
  if (!registration || registration !== confirmRegistration) return response.status(400).json({ ok: false, message: "Type the vehicle registration exactly to unlock new-vehicle publishing." });

  let state = null;
  try {
    const productMode = ["finance", "rent2buy", "both"].includes(clean(request.body?.productMode, 30)) ? clean(request.body.productMode, 30) : undefined;
    state = await buildFreshControlledPublishState(registration, process.env, { productMode });
    const requestedIntent = action === "update_existing_vehicle" ? "update_existing_vehicle" : "create_new_vehicle";
    if (state.plan.writeIntent !== requestedIntent) throw new ControlledPublishError(409, "The Wix write intent changed during the final recheck. Rebuild the preview before continuing.", { expected: state.plan.writeIntent, requested: requestedIntent });
    if (!state.plan.canPublish) throw new ControlledPublishError(409, "The fresh DealerKit/Wix state is not safe for controlled reconciliation.", { blockers: state.plan.blockers });
    if (!controlledPublishConfirmationMatches(request.body?.confirmation, state.plan)) throw new ControlledPublishError(409, "The publish preview is stale. Rebuild the final preview before publishing.");

    const targets = orderedTargets(state.plan.targets);
    if (!targets.length) throw new ControlledPublishError(409, "No verified Wix write targets are available.");

    const outcome = await reconcileControlledTargets(state, registration, targets);
    const { writes, statusTransitions, verification } = outcome;

    const created = writes.filter((item) => item.operation === "create");
    const updated = writes.filter((item) => item.operation === "update");
    const drafted = statusTransitions.filter((item) => item.action === "draft");
    const restored = statusTransitions.filter((item) => item.action === "publish");
    response.status(200).json({
      ok: true,
      published: true,
      verified: true,
      newVehicleOnly: state.plan.writeIntent === "create_new_vehicle",
      writeIntent: state.plan.writeIntent,
      registration,
      recordsWritten: writes.length,
      recordsCreated: created.length,
      recordsUpdated: updated.length,
      recordsDrafted: drafted.length,
      recordsPublished: restored.length,
      vanFinanceRecordsCreated: created.filter((item) => item.product === "van_finance").length,
      rent2buyRecordsCreated: created.filter((item) => item.product === "rent2buy").length,
      vanFinanceRecordsUpdated: updated.filter((item) => item.product === "van_finance").length,
      rent2buyRecordsUpdated: updated.filter((item) => item.product === "rent2buy").length,
      writes,
      publishStatusTransitions: statusTransitions,
      verification: verification.results,
      message: `${registration} was reconciled and verified across Wix CMS: ${created.length} created, ${updated.length} updated, ${restored.length} published/restored, ${drafted.length} stale category row(s) moved to Draft.`,
    });
  } catch (error) {
    const reportedRollback = error?.details?.rollback || [];
    const writesBeforeFailure = error?.details?.writes || [];
    response.status(error?.status || 502).json({
      ok: false,
      published: false,
      registration,
      writesBeforeFailure,
      rollback: reportedRollback,
      publishStatusTransitions: error?.details?.statusTransitions || [],
      publishStatusRollback: error?.details?.statusRollback || [],
      manualAttentionRequired: Boolean(error?.details?.manualAttentionRequired),
      message: error?.message || "Controlled Wix publishing failed.",
      details: error?.details || null,
    });
  }
}
