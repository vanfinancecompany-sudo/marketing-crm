import { fetchDealerKitStockSnapshot } from "./_dealerkit-stock-adapter.js";
import { normalizeRegistration } from "./_vansco-cache-utils.js";
import {
  FINANCE_WIX_STOCK_COLLECTIONS,
  assertFinanceWixStockCollection,
  previewFinanceWixStock,
} from "./finance-reserved-wix-stock.js";
import { isMarketingStockWatchActionAuthorized } from "./vansco-watch-action.js";

const WIX_TASKS_URL = "https://www.wixapis.com/cms/v1/tasks";
const DEFAULT_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const TASK_POLL_DELAY_MS = 350;
const TASK_MAX_POLLS = 24;

function clean(value) {
  return String(value ?? "").trim();
}

function safetyStop(message) {
  return new Error(`Safety stop: ${message} Nothing was changed in Wix.`);
}

function wixHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "wix-site-id": clean(process.env.WIX_FINANCE_SITE_ID) || DEFAULT_WIX_SITE_ID,
  };
  const apiKey = clean(process.env.WIX_FINANCE_API_KEY || process.env.WIX_API_KEY);
  if (apiKey) headers.Authorization = apiKey;
  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWixTask(taskId) {
  const response = await fetch(`${WIX_TASKS_URL}/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: wixHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = clean(await response.text()).slice(0, 500);
    throw new Error(`Could not read Wix draft task ${taskId} (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const payload = await response.json();
  return payload?.task || {};
}

async function waitForWixTask(taskId, label) {
  for (let poll = 0; poll < TASK_MAX_POLLS; poll += 1) {
    const task = await getWixTask(taskId);
    const status = clean(task?.status).toUpperCase();
    if (status === "COMPLETED") {
      const failed = Number(task?.itemsFailed || 0);
      const succeeded = Number(task?.itemsSucceeded || 0);
      if (failed > 0 || succeeded < 1) {
        const failures = Array.isArray(task?.failures)
          ? task.failures.map((failure) => clean(failure?.description || failure?.code)).filter(Boolean).join("; ")
          : "";
        throw new Error(`${label} draft task completed without changing the expected item${failures ? `: ${failures}` : ""}.`);
      }
      return task;
    }
    if (status === "FAILED") {
      const failures = Array.isArray(task?.failures)
        ? task.failures.map((failure) => clean(failure?.description || failure?.code)).filter(Boolean).join("; ")
        : "";
      throw new Error(`${label} draft task failed${failures ? `: ${failures}` : ""}.`);
    }
    await sleep(TASK_POLL_DELAY_MS);
  }
  throw new Error(`${label} draft task did not finish in time. Recheck the collection before retrying.`);
}

async function moveFinanceMatchToDraft(match) {
  const collectionId = assertFinanceWixStockCollection(match.collectionId);
  const itemId = clean(match.itemId);
  const label = match.collectionLabel || collectionId;
  if (!itemId) throw new Error(`Missing Wix item ID for ${label}.`);

  const response = await fetch(WIX_TASKS_URL, {
    method: "POST",
    headers: wixHeaders(),
    body: JSON.stringify({
      task: {
        type: "UPDATE_PUBLISH_STATUS",
        updatePublishStatusOptions: {
          dataCollectionId: collectionId,
          environment: "LIVE",
          filter: { _id: { $eq: itemId } },
          operation: "SET_DRAFT_STATUS",
        },
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = clean(await response.text()).slice(0, 700);
    throw new Error(`${label} could not start its Draft task (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = await response.json();
  const taskId = clean(payload?.task?.id);
  if (!taskId) throw new Error(`${label} did not return a Wix Draft task ID.`);
  const task = await waitForWixTask(taskId, label);
  return {
    collectionId,
    collectionLabel: label,
    itemId,
    taskId,
    taskStatus: clean(task?.status) || "COMPLETED",
    itemsSucceeded: Number(task?.itemsSucceeded || 0),
  };
}

export async function verifyDealerKitMissingRegistration(
  registrationValue,
  { loadSnapshot = fetchDealerKitStockSnapshot } = {},
) {
  const registration = normalizeRegistration(registrationValue);
  if (!registration) throw new Error("A valid vehicle registration is required.");

  let snapshot;
  try {
    snapshot = await loadSnapshot({ allowPartial: true });
  } catch (error) {
    if (/^Safety stop:/i.test(clean(error?.message))) throw error;
    throw safetyStop(`DealerKit could not be checked safely for ${registration}: ${clean(error?.message) || "DealerKit stock check failed."}`);
  }

  // Positive presence evidence is authoritative even when the wider snapshot is partial.
  // Check this before the absence/completeness gate so Reserved/Sold vehicles can never
  // fall through the "missing" route merely because another DealerKit row was unstable.
  const matches = (snapshot?.vehicles || []).filter(
    (vehicle) => normalizeRegistration(vehicle?.registration) === registration,
  );
  if (matches.length) {
    const statuses = Array.from(new Set(matches.map((vehicle) => clean(vehicle?.sourceStatus || vehicle?.status)).filter(Boolean)));
    throw safetyStop(`DealerKit currently contains ${registration}${statuses.length ? ` (${statuses.join(", ")})` : ""}, so the missing-stock removal route is no longer valid.`);
  }

  if (snapshot?.complete !== true) {
    throw safetyStop(`DealerKit could not prove ${registration} is absent because the current stock snapshot is incomplete or unstable.`);
  }

  return {
    providerId: "dealerkit",
    providerLabel: "DealerKit",
    registration,
    missing: true,
    checkedAt: snapshot.checkedAt || new Date().toISOString(),
    snapshotComplete: true,
    vehicleCount: Number(snapshot.vehicleCount ?? snapshot.vehicles?.length ?? 0),
  };
}

function assertCompleteFinancePreview(preview) {
  const collections = Array.isArray(preview?.collections) ? preview.collections : [];
  const expectedIds = new Set(FINANCE_WIX_STOCK_COLLECTIONS.map((collection) => collection.id));
  const returnedIds = new Set(collections.map((collection) => collection?.id).filter(Boolean));
  const failed = collections.filter((collection) => collection?.error);
  const missingCollections = Array.from(expectedIds).filter((id) => !returnedIds.has(id));

  if (collections.length !== expectedIds.size || missingCollections.length || failed.length) {
    const details = [
      missingCollections.length ? `missing collection checks: ${missingCollections.join(", ")}` : "",
      failed.length ? `failed collection checks: ${failed.map((collection) => collection.label || collection.id).join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw safetyStop(`Wix could not be fully verified before removal${details ? ` (${details})` : ""}.`);
  }
}

export async function unpublishMissingFinanceWixStock(
  registrationValue,
  {
    loadSnapshot = fetchDealerKitStockSnapshot,
    loadPreview = previewFinanceWixStock,
    mutateMatch = moveFinanceMatchToDraft,
  } = {},
) {
  const registration = normalizeRegistration(registrationValue);
  if (!registration) throw new Error("A valid vehicle registration is required.");

  const verifyMissing = () => verifyDealerKitMissingRegistration(registration, { loadSnapshot });
  const dealerKit = await verifyMissing();
  const preview = await loadPreview(registration);
  assertCompleteFinancePreview(preview);

  if (!Array.isArray(preview.matches) || preview.matches.length === 0) {
    return {
      ok: true,
      registration,
      dealerKit,
      changed: 0,
      results: [],
      protectedCollection: preview.protectedCollection,
      message: "This registration is already not live in any approved Van Finance Wix stock collection.",
    };
  }

  const results = [];
  let verificationStopped = false;
  for (const match of preview.matches) {
    let finalDealerKit;
    try {
      finalDealerKit = await verifyMissing();
    } catch (error) {
      verificationStopped = true;
      results.push({
        ok: false,
        safetyStop: true,
        ...match,
        error: clean(error?.message || error || "DealerKit could not be rechecked safely."),
      });
      break;
    }

    try {
      results.push({ ok: true, ...(await mutateMatch(match)), finalDealerKit });
    } catch (error) {
      results.push({
        ok: false,
        ...match,
        error: clean(error?.message || error || "Could not move the Wix item to draft."),
      });
    }
  }

  const failures = results.filter((result) => !result.ok);
  const lastFailure = failures[failures.length - 1];
  return {
    ok: failures.length === 0,
    registration,
    dealerKit,
    changed: results.filter((result) => result.ok).length,
    results,
    failures: failures.length,
    protectedCollection: preview.protectedCollection,
    message: verificationStopped
      ? `Safety stop: DealerKit changed or could not be rechecked before the next Wix change. No further Wix records were changed. ${lastFailure?.error || ""}`.trim()
      : failures.length
        ? `${failures.length} Finance Wix action(s) failed. Successful collections remain in Draft; review the results before retrying.`
        : `Moved ${results.length} matching Van Finance Wix record(s) to Draft after confirming the registration is absent from a complete DealerKit snapshot.`,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!isMarketingStockWatchActionAuthorized(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const registration = request.body?.registration;
  if (request.body?.confirmed !== true) {
    response.status(400).json({ ok: false, message: "Confirmation is required before moving Wix records to Draft." });
    return;
  }

  try {
    const result = await unpublishMissingFinanceWixStock(registration);
    response.status(result.ok ? 200 : 207).json(result);
  } catch (error) {
    console.error("FINANCE DEALERKIT-MISSING WIX STOCK ACTION ERROR", {
      registration: normalizeRegistration(registration),
      message: clean(error?.message).slice(0, 1000),
    });
    response.status(500).json({
      ok: false,
      message: error?.message || "Could not safely remove DealerKit-missing Finance Wix stock.",
    });
  }
}
