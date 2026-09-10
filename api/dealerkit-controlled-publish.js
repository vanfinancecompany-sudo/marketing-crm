import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { controlledPublishConfirmationMatches } from "../lib/dealerKitControlledPublishPlan.js";
import {
  ControlledPublishError,
  buildFreshControlledPublishState,
  controlledWixRequest,
} from "./_dealerkit-controlled-publish-state.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

function authorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function orderedTargets(targets = []) {
  return [...targets].sort((left, right) => {
    if (left.kind === right.kind) return `${left.product}:${left.collectionId}`.localeCompare(`${right.product}:${right.collectionId}`);
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
  return Object.entries(data).map(([fieldPath, value]) => ({
    fieldPath,
    action: "SET_FIELD",
    setFieldOptions: { value },
  }));
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
  return { operation: "create", product: target.product, collectionId: target.collectionId, kind: target.kind, itemId: item.id };
}

async function updateTarget(configuration, target) {
  const itemId = clean(target?.itemId, 300);
  if (!itemId) throw new ControlledPublishError(409, `Existing ${target?.collectionId || "detail"} item ID is missing.`);
  const fieldModifications = setFieldModifications(target.data || {});
  if (!fieldModifications.length) throw new ControlledPublishError(409, `No fields are available to update in ${target.collectionId}.`);

  await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: {
      dataCollectionId: target.collectionId,
      patch: {
        dataItemId: itemId,
        fieldModifications,
      },
    },
  });

  return {
    operation: "update",
    product: target.product,
    collectionId: target.collectionId,
    kind: target.kind,
    itemId,
    previousFields: fieldRollbackSnapshot(target),
  };
}

async function applyTarget(configuration, target) {
  return target?.operation === "update"
    ? updateTarget(configuration, target)
    : insertTarget(configuration, target);
}

async function rollbackWrite(configuration, item) {
  if (item.operation === "update") {
    const fieldModifications = rollbackFieldModifications(item.previousFields || {});
    if (fieldModifications.length) {
      await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(item.itemId)}`, {
        method: "PATCH",
        body: {
          dataCollectionId: item.collectionId,
          patch: {
            dataItemId: item.itemId,
            fieldModifications,
          },
        },
      });
    }
    return;
  }

  await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(item.itemId)}?dataCollectionId=${encodeURIComponent(item.collectionId)}`, { method: "DELETE" });
}

async function rollbackCreatedAndUpdated(configuration, writes = []) {
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

async function verifyWritten(configuration, registration, targets = []) {
  const results = [];
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
    const expectedId = target.operation === "update" ? clean(target.itemId, 300) : "";
    const identityMatches = !expectedId || clean(items[0]?.id, 300) === expectedId;
    results.push({
      operation: target.operation === "update" ? "update" : "create",
      product: target.product,
      collectionId: target.collectionId,
      count: items.length,
      verified: exact && identityMatches,
      itemId: items[0]?.id || null,
    });
  }
  return { verified: results.length === targets.length && results.every((item) => item.verified), results };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });

  const action = clean(request.body?.action, 100);
  if (action !== "publish_new_vehicle") return response.status(400).json({ ok: false, message: "Controlled publish action is not supported." });

  const registration = normalizeFinanceRegistration(request.body?.registration || "");
  const confirmRegistration = normalizeFinanceRegistration(request.body?.confirmRegistration || "");
  if (!registration || registration !== confirmRegistration) return response.status(400).json({ ok: false, message: "Type the vehicle registration exactly to unlock new-vehicle publishing." });

  let state = null;
  const writes = [];
  try {
    const productMode = ["finance", "rent2buy", "both"].includes(clean(request.body?.productMode, 30)) ? clean(request.body.productMode, 30) : undefined;
    state = await buildFreshControlledPublishState(registration, process.env, { productMode });
    if (!state.plan.canPublish) throw new ControlledPublishError(409, "The fresh DealerKit/Wix state is not safe for new-vehicle publishing.", { blockers: state.plan.blockers });
    if (!controlledPublishConfirmationMatches(request.body?.confirmation, state.plan)) throw new ControlledPublishError(409, "The publish preview is stale. Rebuild the final preview before publishing.");

    const targets = orderedTargets(state.plan.targets);
    if (!targets.length) throw new ControlledPublishError(409, "No verified Wix write targets are available.");

    for (const target of targets) writes.push(await applyTarget(state.configuration, target));

    const verification = await verifyWritten(state.configuration, registration, targets);
    if (!verification.verified) {
      const rollback = await rollbackCreatedAndUpdated(state.configuration, writes);
      const rollbackComplete = rollback.every((item) => item.rolledBack);
      throw new ControlledPublishError(502, rollbackComplete
        ? "Wix publishing could not be verified, so every write was rolled back."
        : "Wix publishing could not be verified and at least one rollback needs manual attention.",
      { verification, rollback, manualAttentionRequired: !rollbackComplete });
    }

    const created = writes.filter((item) => item.operation === "create");
    const updated = writes.filter((item) => item.operation === "update");
    response.status(200).json({
      ok: true,
      published: true,
      verified: true,
      newVehicleOnly: true,
      registration,
      recordsWritten: writes.length,
      recordsCreated: created.length,
      recordsUpdated: updated.length,
      vanFinanceRecordsCreated: created.filter((item) => item.product === "van_finance").length,
      rent2buyRecordsCreated: created.filter((item) => item.product === "rent2buy").length,
      vanFinanceRecordsUpdated: updated.filter((item) => item.product === "van_finance").length,
      rent2buyRecordsUpdated: updated.filter((item) => item.product === "rent2buy").length,
      writes,
      verification: verification.results,
      message: `${registration} was written and verified across ${writes.length} Wix CMS row(s): ${created.length} created, ${updated.length} existing detail page(s) refreshed.`,
    });
  } catch (error) {
    let rollback = [];
    if (writes.length && !error?.details?.rollback && state?.configuration) rollback = await rollbackCreatedAndUpdated(state.configuration, writes);
    const reportedRollback = error?.details?.rollback || rollback;
    const rollbackComplete = !writes.length || (reportedRollback.length === writes.length && reportedRollback.every((item) => item.rolledBack));
    response.status(error?.status || 502).json({
      ok: false,
      published: false,
      registration,
      writesBeforeFailure: writes,
      rollback: reportedRollback,
      manualAttentionRequired: Boolean(error?.details?.manualAttentionRequired || (writes.length > 0 && !rollbackComplete)),
      message: error?.message || "Controlled Wix publishing failed.",
      details: error?.details || null,
    });
  }
}
