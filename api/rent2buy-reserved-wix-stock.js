import {
  CACHE_TABLE,
  getSupabaseServiceAdmin,
  normalizeRegistration,
} from "./_vansco-cache-utils.js";

const WIX_QUERY_URL = "https://www.wixapis.com/wix-data/v2/items/query";
const WIX_UNPUBLISH_ITEM_URL = "https://www.wixapis.com/wix-data/v2/items/unpublish";
const WIX_TASKS_URL = "https://www.wixapis.com/cms/v1/tasks";
const FINANCE_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const PAGE_SIZE = 100;
const MAX_ROWS_PER_COLLECTION = 2000;
const TASK_MAX_POLLS = 30;
const TASK_POLL_DELAY_MS = 500;

// Rent2Buy is now served from the VAN FINANCE Wix CMS. The historic standalone
// RENT2BUY VANS Wix CMS is deliberately not an authority and must never make a
// drafted/sold vehicle appear live again in Stock Watch.
export const RENT2BUY_WIX_SITES = Object.freeze([
  { id: FINANCE_WIX_SITE_ID, label: "VAN FINANCE Wix · Rent2Buy CMS" },
]);

export const PROTECTED_RENT2BUY_COLLECTION_ID = "VANPAGES";

export const RENT2BUY_WIX_STOCK_COLLECTIONS = Object.freeze([
  { id: "ALLRENT2BUYVANS", label: "ALL VANS" },
  { id: "MEDIUMVANS", label: "MWB" },
  { id: "PICKUPS", label: "PICKUPS" },
  { id: "SmallVans", label: "SMALL" },
  { id: "TIPPERS-LUTONS-DROPSDIES", label: "TIPPER" },
  { id: "LWBVANS", label: "LWB" },
  { id: "ELECTRICVANS", label: "ELECTRIC" },
  { id: "CREWVANS", label: "CREW" },
  { id: "AUTOMATICVANS", label: "AUTOMATIC" },
]);

export const RENT2BUY_WIX_CHECK_COLLECTIONS = Object.freeze([
  ...RENT2BUY_WIX_STOCK_COLLECTIONS,
  { id: PROTECTED_RENT2BUY_COLLECTION_ID, label: "VAN PAGES", protected: true },
]);

const ALLOWED_SITE_IDS = new Set(RENT2BUY_WIX_SITES.map((site) => site.id));
const ALLOWED_COLLECTION_IDS = new Set(RENT2BUY_WIX_STOCK_COLLECTIONS.map((collection) => collection.id));
const READABLE_COLLECTION_IDS = new Set(RENT2BUY_WIX_CHECK_COLLECTIONS.map((collection) => collection.id));
const RESERVED_SOURCE_STATUSES = new Set(["reserved", "sold", "deposit_taken"]);

function clean(value) {
  return String(value ?? "").trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function assertRent2BuyWixSite(siteId) {
  const id = clean(siteId);
  if (!ALLOWED_SITE_IDS.has(id)) {
    throw new Error(`Wix site ${id || "(blank)"} is not the authoritative Rent2Buy CMS.`);
  }
  return id;
}

export function assertRent2BuyWixStockCollection(collectionId) {
  const id = clean(collectionId);
  if (id === PROTECTED_RENT2BUY_COLLECTION_ID) {
    throw new Error("VAN PAGES is hard protected and can never be moved to draft by Stock Watch.");
  }
  if (!ALLOWED_COLLECTION_IDS.has(id)) {
    throw new Error(`Collection ${id || "(blank)"} is not an approved Rent2Buy stock collection.`);
  }
  return id;
}

function assertRent2BuyWixReadableCollection(collectionId) {
  const id = clean(collectionId);
  if (!READABLE_COLLECTION_IDS.has(id)) {
    throw new Error(`Collection ${id || "(blank)"} is not approved for Rent2Buy Stock Watch checks.`);
  }
  return id;
}

function apiKeyCandidates() {
  const candidates = [
    ["WIX_FINANCE_API_KEY", process.env.WIX_FINANCE_API_KEY],
    ["WIX_API_KEY", process.env.WIX_API_KEY],
  ];
  const seen = new Set();
  return candidates
    .map(([source, value]) => ({ source, value: clean(value) }))
    .filter(({ value }) => value && !seen.has(value) && seen.add(value));
}

function wixHeaders(apiKey = "") {
  const headers = {
    "Content-Type": "application/json",
    "wix-site-id": FINANCE_WIX_SITE_ID,
  };
  const key = clean(apiKey) || apiKeyCandidates()[0]?.value || "";
  if (key) headers.Authorization = key;
  return headers;
}

function itemRegistration(item) {
  const data = item?.data || {};
  return normalizeRegistration(data.title || data.registration || data.reg || "");
}

function itemPublishStatus(item) {
  return clean(item?.data?._publishStatus || item?._publishStatus || "").toUpperCase();
}

async function queryCollectionPage(collectionId, offset) {
  const readableCollectionId = assertRent2BuyWixReadableCollection(collectionId);
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
    throw new Error(`Could not read ${readableCollectionId} in the authoritative Rent2Buy CMS (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.dataItems) ? payload.dataItems : [];
}

async function findRegistrationInCollection(collection, registration) {
  const collectionId = assertRent2BuyWixReadableCollection(collection.id);
  const matches = [];
  for (let offset = 0; offset < MAX_ROWS_PER_COLLECTION; offset += PAGE_SIZE) {
    const page = await queryCollectionPage(collectionId, offset);
    for (const item of page) {
      if (itemRegistration(item) !== registration) continue;
      const status = itemPublishStatus(item);
      if (status && status !== "PUBLISHED") continue;
      matches.push({
        siteId: FINANCE_WIX_SITE_ID,
        siteLabel: RENT2BUY_WIX_SITES[0].label,
        collectionId,
        collectionLabel: collection.label,
        itemId: clean(item?.id || item?.data?._id),
        publishStatus: status || "PUBLISHED",
        protected: collectionId === PROTECTED_RENT2BUY_COLLECTION_ID,
      });
    }
    if (page.length < PAGE_SIZE) break;
  }
  return matches.filter((match) => match.itemId);
}

async function previewAuthoritativeSite(registration) {
  const settled = await Promise.allSettled(
    RENT2BUY_WIX_CHECK_COLLECTIONS.map(async (collection) => ({
      collection,
      matches: await findRegistrationInCollection(collection, registration),
    }))
  );

  const collections = settled.map((result, index) => {
    const collection = RENT2BUY_WIX_CHECK_COLLECTIONS[index];
    const protectedCollection = collection.id === PROTECTED_RENT2BUY_COLLECTION_ID;
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

  return {
    id: FINANCE_WIX_SITE_ID,
    label: RENT2BUY_WIX_SITES[0].label,
    collections,
    matches: collections.filter((collection) => !collection.protected).flatMap((collection) => collection.matches),
    protectedMatches: collections.filter((collection) => collection.protected).flatMap((collection) => collection.matches),
  };
}

export async function previewRent2BuyWixStock(registrationValue) {
  const registration = normalizeRegistration(registrationValue);
  if (!registration) throw new Error("A valid vehicle registration is required.");

  const site = await previewAuthoritativeSite(registration);
  return {
    ok: true,
    registration,
    sites: [site],
    matches: site.matches,
    protectedMatches: site.protectedMatches,
    actionableMatches: site.matches.length,
    authority: "VAN FINANCE Wix Rent2Buy CMS only",
    protectedCollection: {
      id: PROTECTED_RENT2BUY_COLLECTION_ID,
      label: "VAN PAGES",
      protected: true,
      message: "Hard protected in the authoritative VAN FINANCE Wix CMS: full Rent2Buy vehicle pages stay live for existing Google/indexed links.",
    },
    safety: {
      siteIds: [FINANCE_WIX_SITE_ID],
      allowedCollectionIds: RENT2BUY_WIX_STOCK_COLLECTIONS.map((collection) => collection.id),
      protectedCollectionId: PROTECTED_RENT2BUY_COLLECTION_ID,
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

async function unpublishItem(collectionId, itemId, label, candidate) {
  const response = await fetch(WIX_UNPUBLISH_ITEM_URL, {
    method: "POST",
    headers: wixHeaders(candidate.value),
    body: JSON.stringify({
      dataCollectionId: collectionId,
      dataItemId: itemId,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = clean(await response.text()).slice(0, 700);
    const error = new Error(`${label} could not be moved to Draft (${response.status})${detail ? `: ${detail}` : ""}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const draftItemId = clean(payload?.dataItem?.id || payload?.dataItem?.data?._id);
  if (draftItemId && draftItemId !== itemId) {
    throw new Error(`${label} returned an unexpected Wix draft item ID.`);
  }
  return payload?.dataItem || null;
}

async function startPublishStatusTask(collectionId, itemId, label, candidate) {
  const response = await fetch(WIX_TASKS_URL, {
    method: "POST",
    headers: wixHeaders(candidate.value),
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
    const error = new Error(`${label} could not start its Wix Draft task (${response.status})${detail ? `: ${detail}` : ""}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  const taskId = clean(payload?.task?.id);
  if (!taskId) throw new Error(`${label} did not return a Wix Draft task ID.`);
  return taskId;
}

async function waitForPublishStatusTask(taskId, label, candidate) {
  for (let poll = 0; poll < TASK_MAX_POLLS; poll += 1) {
    const response = await fetch(`${WIX_TASKS_URL}/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: wixHeaders(candidate.value),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = clean(await response.text()).slice(0, 500);
      const error = new Error(`${label} could not read Wix Draft task ${taskId} (${response.status})${detail ? `: ${detail}` : ""}`);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    const task = payload?.task || {};
    const status = clean(task?.status).toUpperCase();
    if (status === "COMPLETED") {
      const failed = Number(task?.itemsFailed || 0);
      const succeeded = Number(task?.itemsSucceeded || 0);
      if (failed > 0 || succeeded < 1) {
        const detail = Array.isArray(task?.failures)
          ? task.failures.map((failure) => clean(failure?.description || failure?.code)).filter(Boolean).join("; ")
          : "";
        throw new Error(`${label} Wix Draft task completed without changing the expected item${detail ? `: ${detail}` : ""}.`);
      }
      return task;
    }
    if (status === "FAILED") {
      const detail = Array.isArray(task?.failures)
        ? task.failures.map((failure) => clean(failure?.description || failure?.code)).filter(Boolean).join("; ")
        : "";
      throw new Error(`${label} Wix Draft task failed${detail ? `: ${detail}` : ""}.`);
    }
    await sleep(TASK_POLL_DELAY_MS);
  }
  throw new Error(`${label} Wix Draft task did not finish in time. Recheck before retrying.`);
}

async function setDraftMatch(match) {
  const siteId = assertRent2BuyWixSite(match.siteId);
  const collectionId = assertRent2BuyWixStockCollection(match.collectionId);
  const itemId = clean(match.itemId);
  const label = `${match.siteLabel || siteId} / ${match.collectionLabel || collectionId}`;
  if (!itemId) throw new Error(`Missing Wix item ID for ${label}.`);

  const candidates = apiKeyCandidates();
  if (!candidates.length) throw new Error(`${label} has no configured VAN FINANCE Wix API key.`);

  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      let draftItem = null;
      let task = null;
      try {
        draftItem = await unpublishItem(collectionId, itemId, label, candidate);
      } catch (error) {
        if (Number(error?.status || 0) !== 428 || !/WDE0308|Draft items are not enabled/i.test(clean(error?.message))) {
          throw error;
        }
        const taskId = await startPublishStatusTask(collectionId, itemId, label, candidate);
        task = await waitForPublishStatusTask(taskId, label, candidate);
      }

      return {
        siteId,
        siteLabel: RENT2BUY_WIX_SITES[0].label,
        collectionId,
        collectionLabel: match.collectionLabel,
        itemId,
        draftItemId: clean(draftItem?.id || draftItem?.data?._id) || itemId,
        operation: task ? "UPDATE_PUBLISH_STATUS" : "UNPUBLISH_DATA_ITEM",
        taskId: clean(task?.id),
        taskStatus: clean(task?.status),
        itemsSucceeded: task ? Number(task?.itemsSucceeded || 0) : 1,
        authSource: candidate.source,
      };
    } catch (error) {
      lastError = error;
      const authFailure = Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403;
      if (!authFailure || index === candidates.length - 1) break;
    }
  }

  throw lastError || new Error(`${label} could not move to Draft.`);
}

export async function unpublishReservedRent2BuyWixStock(registrationValue) {
  const registration = normalizeRegistration(registrationValue);
  if (!registration) throw new Error("A valid vehicle registration is required.");

  const vansco = await verifyReservedInVansco(registration);
  const preview = await previewRent2BuyWixStock(registration);
  if (!preview.matches.length) {
    return {
      ok: true,
      registration,
      vansco,
      changed: 0,
      results: [],
      failures: 0,
      message: "No live Rent2Buy listing/category matches remain in the authoritative VAN FINANCE Wix CMS. VAN PAGES stays protected.",
      protectedCollection: preview.protectedCollection,
    };
  }

  // Keep mutation order deterministic. This avoids duplicate/category rows racing
  // each other and makes a partial failure easy to identify and retry safely.
  const results = [];
  for (const match of preview.matches) {
    try {
      results.push({ ok: true, ...(await setDraftMatch(match)) });
    } catch (error) {
      results.push({
        ok: false,
        siteId: match.siteId,
        siteLabel: match.siteLabel,
        collectionId: match.collectionId,
        collectionLabel: match.collectionLabel,
        itemId: match.itemId,
        error: clean(error?.message || error || "Could not move item to draft."),
      });
    }
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    console.error("RENT2BUY WIX DRAFT PARTIAL FAILURE", {
      registration,
      authoritySiteId: FINANCE_WIX_SITE_ID,
      failures: failures.map((failure) => ({
        collectionId: failure.collectionId,
        itemId: failure.itemId,
        error: clean(failure.error).slice(0, 1000),
      })),
    });
  }

  return {
    ok: failures.length === 0,
    registration,
    vansco,
    changed: results.filter((result) => result.ok).length,
    results,
    failures: failures.length,
    authority: "VAN FINANCE Wix Rent2Buy CMS only",
    protectedCollection: preview.protectedCollection,
    message: failures.length
      ? `${failures.length} Rent2Buy collection action(s) failed in the authoritative CMS. Successful listing records remain in Draft; VAN PAGES remained protected.`
      : `Moved ${results.length} matching Rent2Buy listing/category record(s) to Draft in the authoritative VAN FINANCE Wix CMS. VAN PAGES remained live and protected.`,
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
      return response.status(200).json(await previewRent2BuyWixStock(registration));
    }
    if (action === "unpublish") {
      if (request.body?.confirmed !== true) {
        return response.status(400).json({ ok: false, message: "Confirmation is required before moving Rent2Buy listing records to Draft." });
      }
      const result = await unpublishReservedRent2BuyWixStock(registration);
      return response.status(result.ok ? 200 : 207).json(result);
    }
    return response.status(400).json({ ok: false, message: "Unknown action." });
  } catch (error) {
    console.error("RENT2BUY RESERVED WIX STOCK ACTION ERROR", {
      action,
      registration: normalizeRegistration(registration),
      message: clean(error?.message).slice(0, 1000),
    });
    return response.status(500).json({
      ok: false,
      message: error?.message || "Could not check Rent2Buy Wix stock.",
    });
  }
}
