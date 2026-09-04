import {
  CACHE_TABLE,
  getSupabaseServiceAdmin,
  normalizeRegistration,
} from "./_vansco-cache-utils.js";

const WIX_QUERY_URL = "https://www.wixapis.com/wix-data/v2/items/query";
const WIX_UNPUBLISH_ITEM_URL = "https://www.wixapis.com/wix-data/v2/items/unpublish";
const WIX_TASKS_URL = "https://www.wixapis.com/cms/v1/tasks";
const PAGE_SIZE = 100;
const MAX_ROWS_PER_COLLECTION = 2000;
const TASK_MAX_POLLS = 12;
const TASK_POLL_DELAY_MS = 1000;

export const RENT2BUY_WIX_SITES = Object.freeze([
  { id: "85f11c52-ee54-495d-aaec-a351831709b5", label: "VAN FINANCE Wix" },
  { id: "548f025b-673c-47f7-9bb6-383ab5d946e4", label: "RENT2BUY VANS Wix" },
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
  if (!ALLOWED_SITE_IDS.has(id)) throw new Error(`Wix site ${id || "(blank)"} is not approved for Rent2Buy Stock Watch.`);
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

function apiKeyCandidates(siteId) {
  const approvedSiteId = assertRent2BuyWixSite(siteId);
  const rent2buySiteId = RENT2BUY_WIX_SITES[1].id;
  const candidates = approvedSiteId === rent2buySiteId
    ? [
        ["WIX_RENT2BUY_API_KEY", process.env.WIX_RENT2BUY_API_KEY],
        ["WIX_API_KEY", process.env.WIX_API_KEY],
        ["WIX_FINANCE_API_KEY", process.env.WIX_FINANCE_API_KEY],
      ]
    : [
        ["WIX_FINANCE_API_KEY", process.env.WIX_FINANCE_API_KEY],
        ["WIX_API_KEY", process.env.WIX_API_KEY],
        ["WIX_RENT2BUY_API_KEY", process.env.WIX_RENT2BUY_API_KEY],
      ];

  const seen = new Set();
  return candidates
    .map(([source, value]) => ({ source, value: clean(value) }))
    .filter(({ value }) => value && !seen.has(value) && seen.add(value));
}

function wixHeaders(siteId, apiKey) {
  const approvedSiteId = assertRent2BuyWixSite(siteId);
  const headers = { "Content-Type": "application/json", "wix-site-id": approvedSiteId };
  const key = clean(apiKey) || apiKeyCandidates(approvedSiteId)[0]?.value || "";
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

async function queryCollectionPage(siteId, collectionId, offset) {
  const approvedSiteId = assertRent2BuyWixSite(siteId);
  const readableCollectionId = assertRent2BuyWixReadableCollection(collectionId);
  const response = await fetch(WIX_QUERY_URL, {
    method: "POST",
    headers: wixHeaders(approvedSiteId),
    body: JSON.stringify({
      dataCollectionId: readableCollectionId,
      query: { paging: { limit: PAGE_SIZE, offset } },
      consistentRead: true,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = clean(await response.text()).slice(0, 500);
    throw new Error(`Could not read ${readableCollectionId} on ${approvedSiteId} (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.dataItems) ? payload.dataItems : [];
}

async function findRegistrationInCollection(site, collection, registration) {
  const siteId = assertRent2BuyWixSite(site.id);
  const collectionId = assertRent2BuyWixReadableCollection(collection.id);
  const matches = [];
  for (let offset = 0; offset < MAX_ROWS_PER_COLLECTION; offset += PAGE_SIZE) {
    const page = await queryCollectionPage(siteId, collectionId, offset);
    for (const item of page) {
      if (itemRegistration(item) !== registration) continue;
      const status = itemPublishStatus(item);
      if (status && status !== "PUBLISHED") continue;
      matches.push({
        siteId,
        siteLabel: site.label,
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

async function previewSite(site, registration) {
  const settled = await Promise.allSettled(
    RENT2BUY_WIX_CHECK_COLLECTIONS.map(async (collection) => ({
      collection,
      matches: await findRegistrationInCollection(site, collection, registration),
    }))
  );
  const collections = settled.map((result, index) => {
    const collection = RENT2BUY_WIX_CHECK_COLLECTIONS[index];
    const protectedCollection = collection.id === PROTECTED_RENT2BUY_COLLECTION_ID;
    if (result.status === "rejected") {
      return { id: collection.id, label: collection.label, protected: protectedCollection, live: false, error: clean(result.reason?.message || result.reason || "Could not check collection."), matches: [] };
    }
    return { id: collection.id, label: collection.label, protected: protectedCollection, live: result.value.matches.length > 0, error: "", matches: result.value.matches };
  });
  return {
    id: site.id,
    label: site.label,
    collections,
    matches: collections.filter((collection) => !collection.protected).flatMap((collection) => collection.matches),
    protectedMatches: collections.filter((collection) => collection.protected).flatMap((collection) => collection.matches),
  };
}

export async function previewRent2BuyWixStock(registrationValue) {
  const registration = normalizeRegistration(registrationValue);
  if (!registration) throw new Error("A valid vehicle registration is required.");
  const settled = await Promise.allSettled(RENT2BUY_WIX_SITES.map((site) => previewSite(site, registration)));
  const sites = settled.map((result, index) => {
    const site = RENT2BUY_WIX_SITES[index];
    if (result.status === "fulfilled") return result.value;
    return { id: site.id, label: site.label, error: clean(result.reason?.message || result.reason || "Could not check Wix site."), collections: [], matches: [], protectedMatches: [] };
  });
  const matches = sites.flatMap((site) => site.matches || []);
  const protectedMatches = sites.flatMap((site) => site.protectedMatches || []);
  return {
    ok: true,
    registration,
    sites,
    matches,
    protectedMatches,
    actionableMatches: matches.length,
    protectedCollection: {
      id: PROTECTED_RENT2BUY_COLLECTION_ID,
      label: "VAN PAGES",
      protected: true,
      message: "Hard protected on both Wix sites: full Rent2Buy vehicle pages stay live for existing Google/indexed links.",
    },
    safety: {
      siteIds: RENT2BUY_WIX_SITES.map((site) => site.id),
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
  return { registration, sourceStatus, checkedAt: latest.last_successfully_checked_at || latest.updated_at || "" };
}

async function unpublishItem(siteId, collectionId, itemId, label, candidate) {
  const response = await fetch(WIX_UNPUBLISH_ITEM_URL, {
    method: "POST",
    headers: wixHeaders(siteId, candidate.value),
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

async function startLegacyDraftTask(siteId, collectionId, itemId, label, candidate) {
  const response = await fetch(WIX_TASKS_URL, {
    method: "POST",
    headers: wixHeaders(siteId, candidate.value),
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
    const error = new Error(`${label} could not start its legacy Wix Draft task (${response.status})${detail ? `: ${detail}` : ""}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  const taskId = clean(payload?.task?.id);
  if (!taskId) throw new Error(`${label} did not return a Wix Draft task ID.`);
  return taskId;
}

async function waitForLegacyDraftTask(siteId, taskId, label, candidate) {
  for (let poll = 0; poll < TASK_MAX_POLLS; poll += 1) {
    const response = await fetch(`${WIX_TASKS_URL}/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: wixHeaders(siteId, candidate.value),
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
      if (failed > 0 || succeeded < 1) throw new Error(`${label} legacy Wix Draft task completed without changing the expected item.`);
      return task;
    }
    if (status === "FAILED") throw new Error(`${label} legacy Wix Draft task failed.`);
    await sleep(TASK_POLL_DELAY_MS);
  }
  throw new Error(`${label} Wix Draft task did not finish in time. Recheck before retrying.`);
}

async function setDraftWithLegacyTask(siteId, collectionId, itemId, label, candidate) {
  const taskId = await startLegacyDraftTask(siteId, collectionId, itemId, label, candidate);
  const task = await waitForLegacyDraftTask(siteId, taskId, label, candidate);
  return {
    taskId,
    taskStatus: clean(task?.status) || "COMPLETED",
    itemsSucceeded: Number(task?.itemsSucceeded || 0),
  };
}

async function setDraftMatch(match) {
  const siteId = assertRent2BuyWixSite(match.siteId);
  const collectionId = assertRent2BuyWixStockCollection(match.collectionId);
  const itemId = clean(match.itemId);
  const label = `${match.siteLabel || siteId} / ${match.collectionLabel || collectionId}`;
  if (!itemId) throw new Error(`Missing Wix item ID for ${label}.`);

  const candidates = apiKeyCandidates(siteId);
  if (!candidates.length) throw new Error(`${label} has no configured Wix API key.`);

  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      let draftItem = null;
      let legacyTask = null;
      try {
        draftItem = await unpublishItem(siteId, collectionId, itemId, label, candidate);
      } catch (error) {
        if (Number(error?.status || 0) !== 428 || !/WDE0308|Draft items are not enabled/i.test(clean(error?.message))) throw error;
        legacyTask = await setDraftWithLegacyTask(siteId, collectionId, itemId, label, candidate);
      }
      return {
        siteId,
        siteLabel: match.siteLabel,
        collectionId,
        collectionLabel: match.collectionLabel,
        itemId,
        draftItemId: clean(draftItem?.id || draftItem?.data?._id) || itemId,
        operation: legacyTask ? "UPDATE_PUBLISH_STATUS" : "UNPUBLISH_DATA_ITEM",
        itemsSucceeded: 1,
        ...(legacyTask || {}),
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
    return { ok: true, registration, vansco, changed: 0, results: [], failures: 0, message: "No live Rent2Buy listing/category matches remain. VAN PAGES stays protected on both Wix sites.", protectedCollection: preview.protectedCollection };
  }

  const settled = await Promise.allSettled(preview.matches.map(setDraftMatch));
  const results = settled.map((result, index) => {
    const match = preview.matches[index];
    if (result.status === "fulfilled") return { ok: true, ...result.value };
    return {
      ok: false,
      siteId: match.siteId,
      siteLabel: match.siteLabel,
      collectionId: match.collectionId,
      collectionLabel: match.collectionLabel,
      itemId: match.itemId,
      error: clean(result.reason?.message || result.reason || "Could not move item to draft."),
    };
  });
  const failures = results.filter((result) => !result.ok);

  if (failures.length) {
    console.error("RENT2BUY WIX DRAFT PARTIAL FAILURE", {
      registration,
      failures: failures.map((failure) => ({
        siteId: failure.siteId,
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
    protectedCollection: preview.protectedCollection,
    message: failures.length
      ? `${failures.length} Rent2Buy collection action(s) failed. Successful listing records remain in Draft; VAN PAGES remained protected.`
      : `Moved ${results.length} matching Rent2Buy listing/category record(s) to Draft across the two Wix mirrors. VAN PAGES remained live and protected.`,
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
    if (action === "preview") return response.status(200).json(await previewRent2BuyWixStock(registration));
    if (action === "unpublish") {
      if (request.body?.confirmed !== true) return response.status(400).json({ ok: false, message: "Confirmation is required before moving Rent2Buy listing records to Draft." });
      const result = await unpublishReservedRent2BuyWixStock(registration);
      return response.status(result.ok ? 200 : 207).json(result);
    }
    return response.status(400).json({ ok: false, message: "Unknown action." });
  } catch (error) {
    console.error("RENT2BUY RESERVED WIX STOCK ACTION ERROR", { action, registration: normalizeRegistration(registration), message: clean(error?.message).slice(0, 1000) });
    return response.status(500).json({ ok: false, message: error?.message || "Could not check Rent2Buy Wix stock." });
  }
}
