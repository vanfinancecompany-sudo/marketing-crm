import { acquireDealerKitPublishLease, blockDealerKitPreviewWrite } from "./_dealerkit-publish-safety.js";
import {currentActiveRent2BuyManualSpecial} from "../lib/rent2BuyCurrentManualSpecial.mjs";
import { retryTemporaryPublishOperation, samePublishValue, temporaryPublishError } from "../lib/dealerKitPublishRecovery.js";
import { approveDealerKitRecovery, claimDealerKitPublishStatus, recordPublishRecovery, verifyPendingDealerKitRepairs } from "./_dealerkit-publish-recovery.js";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { controlledPublishConfirmationMatches, wixItemPublishStatus } from "../lib/dealerKitControlledPublishPlan.js";
import {
  ControlledPublishError,
  buildFreshControlledPublishState,
  controlledWixCreateId,
  controlledWixRequest,
  queryControlledRegistrationItems,
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

async function insertTarget(configuration, target, registration) {
  const payload = await controlledWixRequest(configuration, "/wix-data/v2/items", {
    method: "POST",
    body: { dataCollectionId: target.collectionId, dataItem: { id: controlledWixCreateId(configuration.siteId, target.collectionId, registration), data: target.data } },
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

async function applyTarget(configuration, target, registration) {
  if (target?.operation === "update") return updateTarget(configuration, target);
  if (target?.operation === "create") return insertTarget(configuration, target, registration);
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
    payload = await retryTemporaryPublishOperation(() => request(configuration, "/cms/v1/tasks", {
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
    }), { retry: error => error?.details?.wixStatus === 429, wait });
  } catch (error) {
    const rejected = [400, 401, 403, 404, 422, 429].includes(error?.details?.wixStatus);
    throw new ControlledPublishError(error?.status || 502, `${target.collectionId} publish-status task could not be started safely.`, { ...(error?.details || {}), publishStatusChangeUncertain: !rejected });
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

function wixImageIdentity(value) {
  if (!value) return "";
  if (typeof value === "object") {
    return wixImageIdentity(value.url || value.src || value.fileUrl || value.image || value.uri || value._id || value.id || "");
  }
  const text = clean(value, 3000);
  const wixProtocol = text.match(/^(?:wix:)?image:\/\/v1\/([^\/#?]+)/i);
  if (wixProtocol) return `wix:${wixProtocol[1].toLowerCase()}`;
  const staticWix = text.match(/static\.wixstatic\.com\/media\/([^/?#]+)/i);
  if (staticWix) return `wix:${staticWix[1].toLowerCase()}`;
  try {
    const url = new URL(text);
    url.search = "";
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

function imageListIdentities(value) {
  return (Array.isArray(value) ? value : [])
    .map(wixImageIdentity)
    .filter(Boolean);
}

function exactImageListMatch(actual, expected) {
  const left = imageListIdentities(actual);
  const right = imageListIdentities(expected);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function targetMediaVerification(target = {}, item = {}) {
  const expected = target.data || {};
  const actual = item?.data || {};
  if (target.collectionId === "VANFINANCEPAGES") {
    const galleryVerified = exactImageListMatch(actual.mainImages, expected.mainImages);
    const countVerified = String(actual.imageCount ?? "") === String(expected.imageCount ?? "");
    return { mediaVerified: galleryVerified && countVerified, galleryVerified, countVerified };
  }
  if (target.collectionId === "VANPAGES") {
    const galleryVerified = exactImageListMatch(actual.mediaGallery, expected.mediaGallery);
    const countVerified = String(actual.numberOfImages ?? "") === String(expected.numberOfImages ?? "");
    return { mediaVerified: galleryVerified && countVerified, galleryVerified, countVerified };
  }

  const imageField = ["picture", "image", "addPicture", "additonalPicture"].find((field) => expected[field]);
  if (!imageField) return { mediaVerified: true, galleryVerified: true, countVerified: true };
  const imageVerified = wixImageIdentity(actual[imageField]) === wixImageIdentity(expected[imageField]);
  return { mediaVerified: imageVerified, galleryVerified: imageVerified, countVerified: true };
}

export async function verifyWritten(state, registration, targets = [], writes = [], dependencies = {}) {
  const results = [];
  const request = dependencies.request || controlledWixRequest;
  const writesByTarget = new Map(writes.map((write) => [targetKey(write), write]));
  for (const target of targets) {
    const configuration = configurationForTarget(state, target);
    const items = await queryControlledRegistrationItems(configuration, target.collectionId, registration, { request });
    const exact = items.length === 1 && normalizeFinanceRegistration(items[0]?.data?.title || "") === registration;
    const written = writesByTarget.get(targetKey(target));
    const expectedId = target.operation === "create" ? clean(written?.itemId, 300) : clean(target.itemId, 300);
    const identityMatches = Boolean(expectedId) && clean(items[0]?.id, 300) === expectedId;
    const publishStatus = wixItemPublishStatus(items[0]);
    const desiredPublishStatus = clean(target.desiredPublishStatus, 80).toUpperCase();
    const publishStatusMatches = !desiredPublishStatus || !publishStatus || publishStatus === desiredPublishStatus;
    const media = exact ? targetMediaVerification(target, items[0]) : { mediaVerified: false, galleryVerified: false, countVerified: false };
    results.push({ operation: target.operation, product: target.product, siteId: configuration.siteId, siteLabel: target.siteLabel || configuration.siteLabel || null, collectionId: target.collectionId, count: items.length, verified: exact && identityMatches && publishStatusMatches && media.mediaVerified, itemId: items[0]?.id || null, expectedItemId: expectedId || null, publishStatus: publishStatus || null, desiredPublishStatus: desiredPublishStatus || null, publishStatusVerified: publishStatusMatches, mediaVerified: media.mediaVerified, galleryVerified: media.galleryVerified, countVerified: media.countVerified });
  }
  return { verified: results.length === targets.length && results.every((item) => item.verified), results };
}

// Wix can return a temporarily incomplete read-back after publish-status tasks.
// Retry only the read-only verification, never the CMS writes or publish task.
export async function verifyWrittenWithRetry(state, registration, targets = [], writes = [], dependencies = {}) {
  const verify = dependencies.verify || verifyWritten;
  const wait = dependencies.wait || sleep;
  const delays = [500, 1000, 2000];
  let last = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    last = await verify(state, registration, targets, writes);
    if (last?.verified) return last;
    if (attempt < delays.length) await wait(delays[attempt]);
  }
  return last;
}

export function describeControlledPublishFailure(error = {}) {
  const failures = (error?.details?.verification?.results || []).filter((item) => !item.verified);
  if (!failures.length) return clean(error?.message, 450) || "Wix rejected the reconciliation.";
  const describe = (item) => {
    const collection = clean(item.collectionId, 100) || "Unknown Wix collection";
    const reasons = [];
    if (item.count !== 1) reasons.push(`record lookup returned ${Number(item.count || 0)} matches`);
    if (item.expectedItemId && item.itemId !== item.expectedItemId) reasons.push("item ID did not match");
    if (item.publishStatusVerified === false) reasons.push("publish status did not match");
    if (item.galleryVerified === false) reasons.push("image gallery did not match");
    if (item.countVerified === false) reasons.push("image count did not match");
    if (!reasons.length) reasons.push("Wix confirmation not verified");
    return `${collection}: ${reasons.join(", ")}`;
  };
  return failures.slice(0, 3).map(describe).join("; ");
}

function createdItemIdForTarget(target, writes) {
  if (target.operation !== "create") return clean(target.itemId, 300);
  return clean(writes.find((write) => targetKey(write) === targetKey(target))?.itemId, 300);
}

export async function reconcileControlledTargets(state, registration, targets = [], dependencies = {}) {
  const apply = dependencies.applyTarget || applyTarget;
  const setStatus = dependencies.setTargetPublishStatus || setTargetPublishStatus;
  const verify = dependencies.verifyWritten || verifyWrittenWithRetry;
  const rollbackWrites = dependencies.rollbackCreatedAndUpdated || rollbackCreatedAndUpdated;
  const rollbackStatuses = dependencies.rollbackPublishStatuses || rollbackPublishStatuses;
  const writes = [];
  const statusTransitions = [];

  try {
    for (const target of targets.filter((item) => item.operation !== "draft")) {
      writes.push(await apply(configurationForTarget(state, target), target, registration));
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
      : (error?.details?.code === "wix_cms_item_limit" ? error.message : "Wix reconciliation failed, so completed changes were rolled back."), {
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

function fieldsMatch(actual = {}, expected = {}) {
  return Object.entries(expected).every(([key, value]) => {
    if (["mainImages", "mediaGallery"].includes(key) && Array.isArray(value)) {
      return Array.isArray(actual[key]) && exactImageListMatch(actual[key], value);
    }
    if (["picture", "image", "addPicture", "additonalPicture"].includes(key) && value) {
      return Boolean(wixImageIdentity(actual[key])) && wixImageIdentity(actual[key]) === wixImageIdentity(value);
    }
    return samePublishValue(actual[key], value);
  });
}

function verifiedWrite(target, itemId, operation = "unchanged") {
  return { operation, product: target.product, siteId: target.siteId, collectionId: target.collectionId, kind: target.kind, itemId };
}

// Submit is resumable. Wix is the checkpoint for a known item ID and reviewed
// values. Legacy callers of reconcileControlledTargets retain their rollback
// contract while the staff Submit path verifies and reuses completed work.
export async function reconcileRecoverableTargets(state, registration, product, targets, {
  query = queryControlledRegistrationItems,
  write = applyTarget,
  setStatus = setTargetPublishStatus,
  audit = recordPublishRecovery,
  claimStatus = claimDealerKitPublishStatus,
  wait,
} = {}) {
  const writes = [];
  const statusTransitions = [];
  const identity = target => target.operation === "create"
    ? controlledWixCreateId(configurationForTarget(state, target).siteId, target.collectionId, registration)
    : target.itemId;
  const operations = targets.map(target => ({ ...verifiedWrite(target, identity(target), target.operation), desiredPublishStatus: target.desiredPublishStatus }));
  await audit(state, product, "publish_started", { operations, ...(state.plan?.vfc?.pricingReconciliation?.eligible ? { pricingReconciliation: state.plan.vfc.pricingReconciliation } : {}) });

  const getItem = async (target, configuration, { readLive = false } = {}) => {
    const items = await query(configuration, target.collectionId, registration, { includeDraftItems: !readLive });
    if (items.length > 1 || (items.length === 1 && items[0].id !== identity(target))) {
      throw new ControlledPublishError(409, target.collectionId + " changed during publishing. Submit again to review the current Wix records.", {
        code: "dealerkit_publish_identity_changed",
      });
    }
    return items[0];
  };
  const verifyStatus = async (target, configuration, item) => {
    const desired = target.desiredPublishStatus;
    if (!desired) return true;
    const observed = wixItemPublishStatus(item);
    // Some old collections omit the status field on a live item. Verify it
    // through the independent published-only read in that case.
    return observed ? observed === desired : desired === "PUBLISHED" && Boolean(await getItem(target, configuration, { readLive: true }));
  };

  try {
    for (const target of targets.filter(item => item.operation !== "draft")) {
      const configuration = configurationForTarget(state, target);
      let attempted = false;
      let retries = 0;
      const outcome = await retryTemporaryPublishOperation(async attempt => {
        retries = attempt;
        const existing = await getItem(target, configuration);
        if (existing && fieldsMatch(existing.data, target.data)) {
          return verifiedWrite(target, existing.id, attempted ? target.operation : "unchanged");
        }
        if (target.operation === "create" ? existing : !existing || !Object.keys(target.data).every(key => samePublishValue(existing.data?.[key], target.previousData?.[key]))) {
          throw new ControlledPublishError(409, target.collectionId + " was edited or removed during publishing. Submit again to review the current Wix record.", {
            code: "dealerkit_publish_fields_changed",
          });
        }
        attempted = true;
        return write(configuration, target, registration);
      }, {
        wait,
        retry: error => temporaryPublishError(error) || (target.operation === "create" && error?.details?.wixStatus === 409),
      });
      if (outcome.itemId !== identity(target)) throw new ControlledPublishError(502, "Wix returned an unexpected item ID for " + target.collectionId + ".", { manualAttentionRequired: true });
      writes.push(outcome);
      if (retries || outcome.operation === "create" || outcome.operation === "unchanged") {
        await audit(state, product, "record_reconciled", { ...outcome, retries, requestedOperation: target.operation });
      }
    }

    for (const target of targets.filter(item => item.publishStatusOperation)) {
      const configuration = configurationForTarget(state, target);
      const item = await getItem(target, configuration);
      if (!item) throw new ControlledPublishError(502, "Wix could not find " + target.collectionId + " for status verification.");
      if (await verifyStatus(target, configuration, item)) continue;
      const details = { siteId: configuration.siteId, collectionId: target.collectionId, itemId: item.id, status: target.desiredPublishStatus };
      const claim = await claimStatus(state, product, details);
      let statusTask;
      let recoveredResponse = false;
      try {
        statusTask = await setStatus(configuration, target, item.id);
      } catch (error) {
        if (!error?.details?.publishStatusChangeUncertain) {
          await audit(state, product, "status_rejected", { ...details, taskId: error.details?.taskId || null, reason: error.message }, claim);
          throw error;
        }
        await retryTemporaryPublishOperation(async () => {
          const latest = await getItem(target, configuration);
          if (!latest || !await verifyStatus(target, configuration, latest)) {
            throw new ControlledPublishError(502, "Wix has not confirmed the status change.");
          }
        }, { wait }).catch(() => { throw error; });
        statusTask = {
          ...verifiedWrite(target, item.id, "publish_status"),
          taskId: error.details.taskId || null,
          action: target.desiredPublishStatus === "DRAFT" ? "draft" : "publish",
          desiredPublishStatus: target.desiredPublishStatus,
        };
        recoveredResponse = true;
      }
      statusTransitions.push(statusTask);
      await audit(state, product, "status_verified", { ...details, taskId: statusTask.taskId, recoveredResponse }, claim);
    }

    const verification = await retryTemporaryPublishOperation(async () => {
      const results = await Promise.all(targets.map(async target => {
        const configuration = configurationForTarget(state, target);
        const item = await getItem(target, configuration);
        const verified = Boolean(item && fieldsMatch(item.data, target.data) && await verifyStatus(target, configuration, item));
        return { collectionId: target.collectionId, siteId: configuration.siteId, itemId: item?.id || null, verified };
      }));
      if (!results.every(result => result.verified)) {
        throw new ControlledPublishError(502, "Wix could not verify the saved fields and publishing status.", { verification: { results } });
      }
      return { verified: true, results };
    }, { wait });
    await audit(state, product, "publish_verified", { writes, statusTransitions, verification });
    return { writes: writes.filter(item => item.operation !== "unchanged"), statusTransitions, verification };
  } catch (error) {
    const manualAttentionRequired = Boolean(error.details?.publishStatusChangeUncertain || error.details?.manualAttentionRequired);
    await audit(state, product, "publish_interrupted", { writes, statusTransitions, reason: error.message, manualAttentionRequired });
    throw new ControlledPublishError(error.status || 502, error.message, {
      ...error.details, writes, statusTransitions, manualAttentionRequired, resumable: !manualAttentionRequired,
    });
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });

  const action = clean(request.body?.action, 100);
  if (action !== "approve_recovery" && !["publish_new_vehicle", "update_existing_vehicle"].includes(action)) return response.status(400).json({ ok: false, message: "Controlled publish action is not supported." });

  const registration = normalizeFinanceRegistration(request.body?.registration || "");
  const confirmRegistration = normalizeFinanceRegistration(request.body?.confirmRegistration || "");
  if (!registration || registration !== confirmRegistration) return response.status(400).json({ ok: false, message: "Type the vehicle registration exactly to unlock new-vehicle publishing." });

  if (blockDealerKitPreviewWrite(request, response)) return;
  let releaseLease;
  let state = null;
  try {
    const productMode = ["finance", "rent2buy", "both"].includes(clean(request.body?.productMode, 30)) ? clean(request.body.productMode, 30) : undefined;
    releaseLease = await acquireDealerKitPublishLease(registration);
    const refresh = () => buildFreshControlledPublishState(registration, process.env, { productMode });
    state = await refresh();
    if (action === "approve_recovery") {
      if (!["finance", "rent2buy"].includes(productMode)) throw new ControlledPublishError(400, "Choose one website for the Wix repair.");
      const result = await approveDealerKitRecovery(state, productMode, request.body?.recoveryApproval, { refresh });
      await releaseLease();
      return response.status(200).json({ ok: true, ...result });
    }
    if(["rent2buy","both"].includes(state.plan.mode) && await currentActiveRent2BuyManualSpecial(registration))
      throw new ControlledPublishError(409,"Active manual Rent2Buy special: controlled Wix price publication is locked.");
    const requestedIntent = action === "update_existing_vehicle" ? "update_existing_vehicle" : "create_new_vehicle";
    if (state.plan.writeIntent !== requestedIntent) throw new ControlledPublishError(409, "The Wix write intent changed during the final recheck. Rebuild the preview before continuing.", { expected: state.plan.writeIntent, requested: requestedIntent });
    if (!state.plan.canPublish) throw new ControlledPublishError(409, "The fresh DealerKit/Wix state is not safe for controlled reconciliation.", { blockers: state.plan.blockers });
    if (!controlledPublishConfirmationMatches(request.body?.confirmation, state.plan)) throw new ControlledPublishError(409, "The publish preview is stale. Rebuild the final preview before publishing.");

    if (state.plan.vfc?.pricingReconciliation?.eligible && (request.body?.pricingApproval !== true || request.body?.resumePartial !== true)) {
      throw new ControlledPublishError(409, "Approve the displayed VFC pricing reconciliation before publishing. A verified recovery audit is required.");
    }
    const targets = orderedTargets(state.plan.targets);
    if (!targets.length) throw new ControlledPublishError(409, "No verified Wix write targets are available.");

    const resumable = request.body?.resumePartial === true && ["finance", "rent2buy"].includes(state.plan.mode);
    if (resumable) await verifyPendingDealerKitRepairs(state, state.plan.mode);
    const outcome = resumable
      ? await reconcileRecoverableTargets(state, registration, state.plan.mode, targets)
      : await reconcileControlledTargets(state, registration, targets);
    const { writes, statusTransitions, verification } = outcome;

    const created = writes.filter((item) => item.operation === "create");
    const updated = writes.filter((item) => item.operation === "update");
    const drafted = statusTransitions.filter((item) => item.action === "draft");
    const restored = statusTransitions.filter((item) => item.action === "publish");
    const galleryComplete = state.plan.mode === "rent2buy"
      ? Boolean(state.imageSets?.rent2buy?.galleryComplete)
      : state.plan.mode === "finance"
        ? Boolean(state.imageSets?.vanFinance?.galleryComplete)
        : state.plan.mode === "both"
          ? Boolean(state.imageSets?.vanFinance?.galleryComplete && state.imageSets?.rent2buy?.galleryComplete)
          : true;
    await releaseLease();
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
      galleryComplete,
      followUpRequired: !galleryComplete,
      message: galleryComplete
        ? `${registration} was reconciled and verified across Wix CMS: ${created.length} created, ${updated.length} updated, ${restored.length} published/restored, ${drafted.length} stale category row(s) moved to Draft.`
        : `${registration} was reconciled and verified with the READY gallery images. Some selected DealerKit photos are still processing; use Check image status, then Reconcile advert again when they are READY.`,
    });
  } catch (error) {
    const reportedRollback = error?.details?.rollback || [];
    const writesBeforeFailure = error?.details?.writes || [];
    await releaseLease?.();
    response.status(error?.status || 502).json({
      ok: false,
      published: false,
      registration,
      writesBeforeFailure,
      rollback: reportedRollback,
      publishStatusTransitions: error?.details?.statusTransitions || [],
      publishStatusRollback: error?.details?.statusRollback || [],
      manualAttentionRequired: Boolean(error?.details?.manualAttentionRequired),
      message: error?.details?.cause || error?.details?.verification
        ? `${error?.message || "Controlled Wix publishing failed."} Reason: ${describeControlledPublishFailure({ message: error?.details?.cause || error?.message, details: error?.details })}`
        : error?.message || "Controlled Wix publishing failed.",
      details: error?.details || null,
    });
  } finally {
    await releaseLease?.();
  }
}
