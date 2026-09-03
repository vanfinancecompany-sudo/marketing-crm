import {
  CACHE_TABLE,
  getSupabaseServiceAdmin,
  normalizeRegistration,
} from "./_vansco-cache-utils.js";

const WIX_QUERY_URL = "https://www.wixapis.com/wix-data/v2/items/query";
const WIX_TASKS_URL = "https://www.wixapis.com/cms/v1/tasks";
const DEFAULT_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const PAGE_SIZE = 100;
const MAX_ROWS_PER_COLLECTION = 2000;
const TASK_POLL_DELAY_MS = 350;
const TASK_MAX_POLLS = 24;

export const PROTECTED_CAR_COLLECTION_ID = "CARPAGES";

export const CAR_WIX_STOCK_COLLECTIONS = Object.freeze([
  { id: "CARFINANCE", label: "CAR FINANCE" },
]);

export const CAR_WIX_CHECK_COLLECTIONS = Object.freeze([
  ...CAR_WIX_STOCK_COLLECTIONS,
  { id: PROTECTED_CAR_COLLECTION_ID, label: "CAR PAGES", protected: true },
]);

const ALLOWED_COLLECTION_IDS = new Set(CAR_WIX_STOCK_COLLECTIONS.map((collection) => collection.id));
const READABLE_COLLECTION_IDS = new Set(CAR_WIX_CHECK_COLLECTIONS.map((collection) => collection.id));
const RESERVED_SOURCE_STATUSES = new Set(["reserved", "sold", "deposit_taken"]);

function clean(value) {
  return String(value ?? "").trim();
}

function wixHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "wix-site-id": clean(process.env.WIX_CAR_SITE_ID || process.env.WIX_FINANCE_SITE_ID) || DEFAULT_WIX_SITE_ID,
  };
  const apiKey = clean(process.env.WIX_CAR_API_KEY || process.env.WIX_FINANCE_API_KEY || process.env.WIX_API_KEY);
  if (apiKey) headers.Authorization = apiKey;
  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertCarWixStockCollection(collectionId) {
  const id = clean(collectionId);
  if (id === PROTECTED_CAR_COLLECTION_ID) {
    throw new Error("CAR PAGES is hard protected and can never be moved to draft by Stock Watch.");
  }
  if (!ALLOWED_COLLECTION_IDS.has(id)) {
    throw new Error(`Collection ${id || "(blank)"} is not an approved car stock collection.`);
  }
  return id;
}

function assertCarWixReadableCollection(collectionId) {
  const id = clean(collectionId);
  if (!READABLE_COLLECTION_IDS.has(id)) {
    throw new Error(`Collection ${id || "(blank)"} is not an approved car collection for Stock Watch checks.`);
  }
  return id;
}

function itemRegistration(item) {
  const data = item?.data || {};
  return normalizeRegistration(data.title || data.registration || data.reg || "");
}

function itemPublishStatus(item) {
  return clean(item?.data?._publishStatus || item?._publishStatus || "").toUpperCase();
}

async function queryCollectionPage(collectionId, offset) {
  const readableCollectionId = assertCarWixReadableCollection(collectionId);
  const response = await fetch(WIX_QUERY_URL, {
    method: "POST",
    headers: wixHeaders(),
    body: JSON.stringify({
      dataCollectionId: readableCollectionId,
      query: { paging: { limit: PAGE_SIZE, offset } },
      consistentRead: true,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = clean(await response.text()).slice(0, 500);
    throw new Error(`Could not read ${readableCollectionId} (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.dataItems) ? payload.dataItems : [];
}

async function findRegistrationInCollection(collection, registration) {
  const collectionId = assertCarWixReadableCollection(collection.id);
  const matches = [];

  for (let offset = 0; offset < MAX_ROWS_PER_COLLECTION; offset += PAGE_SIZE) {
    const page = await queryCollectionPage(collectionId, offset);
    for (const item of page) {
      if (itemRegistration(item) !== registration) continue;
      const status = itemPublishStatus(item);
      if (status && status !== "PUBLISHED") continue;
      matches.push({
        collectionId,
        collectionLabel: collection.label,
        itemId: clean(item?.id || item?.data?._id),
        publishStatus: status || "PUBLISHED",
        protected: collectionId === PROTECTED_CAR_COLLECTION_ID,
      });
    }
    if (page.length < PAGE_SIZE) break;
  }

  return matches.filter((match) => match.itemId);
}

export async function previewCarWixStock(registrationValue) {
  const registration = normalizeRegistration(registrationValue);
  if (!registration) throw new Error("A valid vehicle registration is required.");

  const settled = await Promise.allSettled(
    CAR_WIX_CHECK_COLLECTIONS.map(async (collection) => ({
      collection,
      matches: await findRegistrationInCollection(collection, registration),
    }))
  );

  const collections = settled.map((result, index) => {
    const collection = CAR_WIX_CHECK_COLLECTIONS[index];
    const protectedCollection = collection.id === PROTECTED_CAR_COLLECTION_ID;
    if (result.status === "rejected") {
      return {
        id: collection.id,
        label: collection.label,
        protected: protectedCollection,
        live: false,
        error: clean(result.reason?.message || result.reason || "Could not check collection."),
        matches: [],
      };
    }
    return {
      id: collection.id,
      label: collection.label,
      protected: protectedCollection,
      live: result.value.matches.length > 0,
      error: "",
      matches: result.value.matches,
    };
  });

  const matches = collections
    .filter((collection) => !collection.protected)
    .flatMap((collection) => collection.matches);
  const protectedMatches = collections
    .filter((collection) => collection.protected)
    .flatMap((collection) => collection.matches);

  return {
    ok: true,
    registration,
    collections,
    matches,
    protectedMatches,
    liveCollectionCount: collections.filter((collection) => collection.live).length,
    actionableLiveCollectionCount: collections.filter((collection) => collection.live && !collection.protected).length,
    protectedCollection: {
      id: PROTECTED_CAR_COLLECTION_ID,
      label: "CAR PAGES",
      protected: true,
      message: "Hard protected: the full car advert remains live so existing Google/indexed links are preserved.",
    },
    safety: {
      allowedCollectionIds: CAR_WIX_STOCK_COLLECTIONS.map((collection) => collection.id),
      protectedCollectionId: PROTECTED_CAR_COLLECTION_ID,
      message: "Car Stock Watch can only move CARFINANCE records to draft. CARPAGES is read-only and hard protected.",
    },
  };
}

async function verifyReservedInVansco(registration) {
  const supabase = getSupabaseServiceAdmin();
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("registration,source_status,is_currently_on_vansco,last_successfully_checked_at,updated_at")
    .eq("registration", registration)
    .order("last_successfully_checked_at", { ascending: false, nullsFirst: false })
    .limit(10);

  if (error) throw new Error(`Could not verify Vansco status: ${error.message || error}`);
  const latest = (data || []).find((row) => row?.is_currently_on_vansco !== false) || (data || [])[0] || null;
  const sourceStatus = clean(latest?.source_status).toLowerCase();
  if (!latest || !RESERVED_SOURCE_STATUSES.has(sourceStatus)) {
    throw new Error("Safety stop: Vansco no longer shows this registration as Reserved/Sold/Deposit Taken. Nothing was changed in Wix.");
  }
  return {
    registration,
    sourceStatus,
    checkedAt: latest.last_successfully_checked_at || latest.updated_at || "",
  };
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

async function setDraftMatch(match) {
  const collectionId = assertCarWixStockCollection(match.collectionId);
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
          filter: {
            _id: { $eq: itemId },
          },
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

export async function unpublishReservedCarWixStock(registrationValue) {
  const registration = normalizeRegistration(registrationValue);
  if (!registration) throw new Error("A valid vehicle registration is required.");

  const vansco = await verifyReservedInVansco(registration);
  const preview = await previewCarWixStock(registration);
  if (!preview.matches.length) {
    return {
      ok: true,
      registration,
      vansco,
      changed: 0,
      results: [],
      message: "This registration is not live in CAR FINANCE. CAR PAGES remains protected and unchanged.",
      protectedCollection: preview.protectedCollection,
      safety: preview.safety,
    };
  }

  const settled = await Promise.allSettled(preview.matches.map(setDraftMatch));
  const results = settled.map((result, index) => {
    const match = preview.matches[index];
    if (result.status === "fulfilled") return { ok: true, ...result.value };
    return {
      ok: false,
      collectionId: match.collectionId,
      collectionLabel: match.collectionLabel,
      itemId: match.itemId,
      error: clean(result.reason?.message || result.reason || "Could not move item to draft."),
    };
  });
  const failures = results.filter((result) => !result.ok);

  return {
    ok: failures.length === 0,
    registration,
    vansco,
    changed: results.filter((result) => result.ok).length,
    results,
    failures: failures.length,
    protectedCollection: preview.protectedCollection,
    safety: preview.safety,
    message: failures.length
      ? `${failures.length} CAR FINANCE action(s) failed. CAR PAGES remained protected and unchanged.`
      : `Moved ${results.length} matching CAR FINANCE record(s) to draft. CAR PAGES remained live and protected.`,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const action = clean(request.body?.action).toLowerCase();
  const registration = request.body?.registration;

  try {
    if (action === "preview") {
      const result = await previewCarWixStock(registration);
      return response.status(200).json(result);
    }
    if (action === "unpublish") {
      if (request.body?.confirmed !== true) {
        return response.status(400).json({ ok: false, message: "Confirmation is required before moving the CAR FINANCE record to draft." });
      }
      const result = await unpublishReservedCarWixStock(registration);
      return response.status(result.ok ? 200 : 207).json(result);
    }
    return response.status(400).json({ ok: false, message: "Unknown action." });
  } catch (error) {
    console.error("CAR RESERVED WIX STOCK ACTION ERROR", {
      action,
      registration: normalizeRegistration(registration),
      message: clean(error?.message).slice(0, 1000),
    });
    return response.status(500).json({
      ok: false,
      message: error?.message || "Could not check car Wix stock.",
    });
  }
}
