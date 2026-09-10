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

async function insertTarget(configuration, target) {
  const payload = await controlledWixRequest(configuration, "/wix-data/v2/items", {
    method: "POST",
    body: { dataCollectionId: target.collectionId, dataItem: { data: target.data } },
  });
  const item = payload?.dataItem;
  if (!item?.id) throw new ControlledPublishError(502, `Wix did not return an item ID after creating ${target.collectionId}.`);
  return { product: target.product, collectionId: target.collectionId, kind: target.kind, itemId: item.id };
}

async function rollbackCreated(configuration, created = []) {
  const outcomes = [];
  for (const item of [...created].reverse()) {
    try {
      await controlledWixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(item.itemId)}?dataCollectionId=${encodeURIComponent(item.collectionId)}`, { method: "DELETE" });
      outcomes.push({ ...item, rolledBack: true });
    } catch (error) {
      outcomes.push({ ...item, rolledBack: false, error: clean(error?.message, 500) || "Rollback failed" });
    }
  }
  return outcomes;
}

async function verifyCreated(configuration, registration, targets = []) {
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
    results.push({ product: target.product, collectionId: target.collectionId, count: items.length, verified: exact, itemId: items[0]?.id || null });
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
  const created = [];
  try {
    state = await buildFreshControlledPublishState(registration);
    if (!state.plan.canPublish) throw new ControlledPublishError(409, "The fresh DealerKit/Wix state is not safe for new-vehicle publishing.", { blockers: state.plan.blockers });
    if (!controlledPublishConfirmationMatches(request.body?.confirmation, state.plan)) throw new ControlledPublishError(409, "The publish preview is stale. Rebuild the final preview before publishing.");

    const targets = orderedTargets(state.plan.targets);
    if (!targets.length) throw new ControlledPublishError(409, "No verified Wix create targets are available.");

    for (const target of targets) created.push(await insertTarget(state.configuration, target));

    const verification = await verifyCreated(state.configuration, registration, targets);
    if (!verification.verified) {
      const rollback = await rollbackCreated(state.configuration, created);
      const rollbackComplete = rollback.every((item) => item.rolledBack);
      throw new ControlledPublishError(502, rollbackComplete
        ? "Wix creation could not be verified, so every newly created row was rolled back."
        : "Wix creation could not be verified and at least one rollback needs manual attention.",
      { verification, rollback, manualAttentionRequired: !rollbackComplete });
    }

    response.status(200).json({
      ok: true,
      published: true,
      verified: true,
      newVehicleOnly: true,
      registration,
      recordsCreated: created.length,
      vanFinanceRecordsCreated: created.filter((item) => item.product === "van_finance").length,
      rent2buyRecordsCreated: created.filter((item) => item.product === "rent2buy").length,
      created,
      verification: verification.results,
      message: `${registration} was created and verified across ${created.length} Wix CMS row(s).`,
    });
  } catch (error) {
    let rollback = [];
    if (created.length && !error?.details?.rollback && state?.configuration) rollback = await rollbackCreated(state.configuration, created);
    const reportedRollback = error?.details?.rollback || rollback;
    const rollbackComplete = !created.length || (reportedRollback.length === created.length && reportedRollback.every((item) => item.rolledBack));
    response.status(error?.status || 502).json({
      ok: false,
      published: false,
      registration,
      createdBeforeFailure: created,
      rollback: reportedRollback,
      manualAttentionRequired: Boolean(error?.details?.manualAttentionRequired || (created.length > 0 && !rollbackComplete)),
      message: error?.message || "Controlled Wix publishing failed.",
      details: error?.details || null,
    });
  }
}
