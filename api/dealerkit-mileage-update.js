import { createHash } from "node:crypto";
import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import { controlledWixConfiguration, controlledWixRequest, queryControlledRegistrationItems, controlledRent2BuyWixConfigurations } from "./_dealerkit-controlled-publish-state.js";
import { wixItemPublishStatus } from "../lib/dealerKitControlledPublishPlan.js";
import { controlledCarWixConfiguration } from "./_dealerkit-car-controlled-publish-state.js";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { cleanMileage, MILEAGE_COLLECTIONS, MILEAGE_CANONICAL, buildMileageFieldPatch } from "../lib/dealerKitMileageWatch.js";
import { writeStockWatchActionLog, createStockWatchTraceId } from "./_stock-watch-action-log.js";

const clean = (v, n = 1000) => String(v ?? "").trim().slice(0, n);
const API_KEY_HEADER = "x-marketing-customer-database-key";
const PIPELINES = ["finance", "rent2buy", "cars"];

class MileageError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function authorised(request, env = process.env) {
  const expected = clean(env.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function wixConfiguration(pipeline) {
  if (pipeline === "cars") return controlledCarWixConfiguration();
  if (pipeline === "rent2buy") return controlledRent2BuyWixConfigurations()[0];
  return controlledWixConfiguration();
}

function checkedBody(body) {
  const request = typeof body === "string" ? JSON.parse(body) : (body || {});
  const pipeline = clean(request.pipeline, 32).toLowerCase();
  const registration = normalizeFinanceRegistration(request.registration);
  const supplierStockId = clean(request.supplierStockId, 300);
  if (!PIPELINES.includes(pipeline)) throw new MileageError(400, "Unsupported mileage section.");
  if (!/^[A-Z0-9]{5,8}$/.test(registration) || !supplierStockId) {
    throw new MileageError(400, "A valid registration and DealerKit stock ID are required.");
  }
  return { ...request, pipeline, registration, supplierStockId };
}

async function liveDealerKitVehicle(input, fetchDetail = fetchDealerKitStockDetail) {
  const vehicle = await fetchDetail(input.supplierStockId, { specifications: false });
  if (normalizeFinanceRegistration(vehicle?.registration) !== input.registration ||
      clean(vehicle?.supplierStockId, 300) !== input.supplierStockId) {
    throw new MileageError(409, "DealerKit stock ID or registration changed. Refresh Stock Watch.");
  }
  if (!["available", "in_stock", "due_in"].includes(clean(vehicle?.status || vehicle?.sourceStatus, 80).toLowerCase().replace(/[\s-]+/g, "_"))) {
    throw new MileageError(409, "DealerKit does not currently show this vehicle as available. Nothing changed.");
  }
  const mileage = cleanMileage(vehicle?.mileage);
  if (mileage === null) throw new MileageError(409, "DealerKit has no valid current mileage.");
  return { vehicle, mileage };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fingerprintFor(input, mileage, targets) {
  const values = {
    pipeline: input.pipeline, registration: input.registration,
    supplierStockId: input.supplierStockId, mileage,
    targets: targets.map((item) => ({
      collectionId: item.collectionId, itemId: item.itemId,
      current: item.current, proposed: item.proposed,
    })),
  };
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

async function readWixRows(configuration, collectionId, registration, query = queryControlledRegistrationItems) {
  const rows = await query(configuration, collectionId, registration);
  const published = rows.filter((item) => wixItemPublishStatus(item) === "PUBLISHED");
  if (published.length > 1) throw new MileageError(409, "Multiple published Wix records in " + collectionId + ". Resolve before updating mileage.");
  if (!published.length) {
    if (rows.some((item) => !wixItemPublishStatus(item))) {
      throw new MileageError(409, "Wix publish status could not be verified in " + collectionId + ".");
    }
    return null; // Draft rows never become targets for a live mileage update.
  }
  const item = published[0];
  if (!item?.id) throw new MileageError(409, "Missing published Wix item ID in " + collectionId + ".");
  return item;
}

export async function buildMileagePreview(input, dependencies = {}) {
  const config = dependencies.configuration || wixConfiguration(input.pipeline);
  const { vehicle, mileage } = await liveDealerKitVehicle(input, dependencies.fetchDetail);
  const collections = MILEAGE_COLLECTIONS[input.pipeline];
  const required = MILEAGE_CANONICAL[input.pipeline];
  const targets = [];
  const present = new Set();
  const request = dependencies.query || queryControlledRegistrationItems;

  // Small bounded batches protect Wix rate limits and keep the canonical CMS authoritative.
  for (let i = 0; i < collections.length; i += 3) {
    const batch = await Promise.all(collections.slice(i, i + 3).map(async (collectionId) => {
      const row = await readWixRows(config, collectionId, input.registration, request);
      return { collectionId, row };
    }));
    for (const { collectionId, row } of batch) {
      if (!row) continue;
      present.add(collectionId);
      const patch = buildMileageFieldPatch(collectionId, row.data || {}, mileage, input.pipeline);
      if (patch.error) throw new MileageError(409, collectionId + ": " + patch.error);
      if (!patch.changed) continue;
      const proposed = patch.fields;
      const current = Object.fromEntries(Object.keys(proposed).map((key) => [key, row.data[key]]));
      targets.push({
        collectionId, itemId: row.id, current, proposed,
        previousMileage: patch.previousMileage, conflicts: patch.conflicts,
      });
    }
  }

  const absent = required.filter((id) => !present.has(id));
  if (absent.length) throw new MileageError(409, "Required published Wix listing/detail rows are missing: " + absent.join(", ") + ".");
  const priorValues = targets.map((item) => item.previousMileage);
  const lowered = priorValues.some((previous) => previous > mileage);
  const fingerprint = fingerprintFor(input, mileage, targets);
  return {
    ok: true, registration: input.registration, pipeline: input.pipeline,
    supplierStockId: input.supplierStockId, dealerMileage: mileage,
    changedRecords: targets.length, checkedCollections: collections.length,
    lowered, fingerprint, canApply: targets.length > 0,
    warning: input.pipeline === "rent2buy"
      ? "Mileage can affect Rent2Buy term eligibility and the Felix quote. No rental price, protected special, or existing quote will be changed."
      : "Only Wix mileage fields will change. Price, images, status and other advert text are preserved.",
    targets: targets.map((item) => ({
      collectionId: item.collectionId, itemId: item.itemId,
      previousMileage: item.previousMileage,
      changedFields: Object.keys(item.proposed),
      conflicts: item.conflicts,
    })),
    // Server-only write plan, not included in HTTP output.
    _plan: { config, targets, vehicle, fingerprint },
  };
}

async function patchItem(config, target, values, request = controlledWixRequest) {
  const fieldModifications = Object.entries(values).map(([fieldPath, value]) => ({
    fieldPath, action: "SET_FIELD", setFieldOptions: { value },
  }));
  return request(config, "/wix-data/v2/items/" + encodeURIComponent(target.itemId), {
    method: "PATCH",
    body: { dataCollectionId: target.collectionId, patch: { dataItemId: target.itemId, fieldModifications } },
  });
}

async function checkRow(config, registration, target, expected, query = queryControlledRegistrationItems) {
  const row = await readWixRows(config, target.collectionId, registration, query);
  if (!row || row.id !== target.itemId) throw new MileageError(409, "Wix row identity changed in " + target.collectionId + ".");
  if (!Object.entries(expected).every(([field, value]) => sameValue(row.data?.[field], value))) {
    throw new MileageError(409, "Wix mileage changed during the update in " + target.collectionId + ". Nothing further will be changed.");
  }
}

export async function applyMileagePreview(input, preview, dependencies = {}) {
  const { config, targets } = preview._plan;
  const query = dependencies.query || queryControlledRegistrationItems;
  const write = dependencies.request || controlledWixRequest;
  const applied = [];
  try {
    for (const target of targets) {
      await checkRow(config, input.registration, target, target.current, query);
      await patchItem(config, target, target.proposed, write);
      applied.push(target);
    }
    for (const target of targets) await checkRow(config, input.registration, target, target.proposed, query);
    return { verified: true, changedRecords: applied.length, collections: applied.map((row) => row.collectionId) };
  } catch (error) {
    const rollback = [];
    for (const target of [...applied].reverse()) {
      try {
        await patchItem(config, target, target.current, write);
        await checkRow(config, input.registration, target, target.current, query);
        rollback.push({ collectionId: target.collectionId, restored: true });
      } catch (rollbackError) {
        rollback.push({ collectionId: target.collectionId, restored: false, message: clean(rollbackError?.message) });
      }
    }
    throw new MileageError(502, "Mileage update was not fully verified. Previously changed rows were restored where possible. Review Wix before retrying.", {
      cause: clean(error?.message), rollback,
    });
  }
}

function publicPreview(preview) {
  const { _plan, ...publicData } = preview;
  return publicData;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
  let input;
  let traceId = "";
  const startedAt = new Date();
  try {
    input = checkedBody(request.body);
    const action = clean(input.action, 20).toLowerCase();
    if (!["preview", "apply"].includes(action)) throw new MileageError(400, "Unsupported mileage action.");
    if (action === "apply" && process.env.DEALERKIT_MILEAGE_UPDATE_ENABLED !== "true") {
      throw new MileageError(423, "Mileage writes are currently disabled. Complete live Wix field verification and explicitly enable controlled updates before applying.");
    }
    const preview = await buildMileagePreview(input);
    if (action === "preview") return response.status(200).json(publicPreview(preview));
    if (!/^[a-f0-9]{64}$/.test(clean(input.fingerprint, 100)) ||
        preview.fingerprint !== input.fingerprint) {
      throw new MileageError(409, "DealerKit or Wix changed since preview. Review mileage again before applying.");
    }
    if (normalizeFinanceRegistration(input.confirmRegistration) !== input.registration) {
      throw new MileageError(400, "Type the full registration to confirm the Wix mileage change.");
    }
    if (preview.lowered && input.acceptLowerMileage !== true) {
      throw new MileageError(409, "DealerKit mileage is lower than Wix. Explicitly approve the decrease before continuing.");
    }
    if (!preview.canApply) return response.status(200).json({ ok: true, verified: true, changedRecords: 0 });
    traceId = createStockWatchTraceId();
    await writeStockWatchActionLog({
      traceId, pipeline: input.pipeline, action: "mileage_update", registration: input.registration,
      authority: "DealerKit to Wix", status: "started", matchedRecords: preview.changedRecords,
      result: { from: preview.targets.map((r) => [r.collectionId, r.previousMileage]), to: preview.dealerMileage },
    });
    const result = await applyMileagePreview(input, preview);
    await writeStockWatchActionLog({
      traceId, pipeline: input.pipeline, action: "mileage_update", registration: input.registration,
      authority: "DealerKit to Wix", status: "completed", startedAt,
      matchedRecords: preview.changedRecords, changedRecords: result.changedRecords, failureCount: 0,
      result: { mileage: preview.dealerMileage, collections: result.collections, verified: result.verified },
    });
    return response.status(200).json({ ok: true, registration: input.registration, dealerMileage: preview.dealerMileage, ...result });
  } catch (error) {
    if (traceId && input) await writeStockWatchActionLog({
      traceId, pipeline: input.pipeline, action: "mileage_update", registration: input.registration,
      authority: "DealerKit to Wix", status: "failed", startedAt, failureCount: 1,
      error: clean(error.message), result: error.details || null,
    });
    return response.status(error.status || 502).json({
      ok: false, message: clean(error.message || "Mileage update could not be completed."),
      details: error.details || {},
    });
  }
}
