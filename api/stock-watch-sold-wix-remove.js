import { fetchStableDealerKitStockSnapshot } from "./_dealerkit-stable-stock-snapshot.js";
import { normalizeRegistration } from "./_vansco-cache-utils.js";
import { isMarketingStockWatchActionAuthorized } from "./vansco-watch-action.js";
import { previewFinanceWixStock, FINANCE_WIX_STOCK_COLLECTIONS } from "./finance-reserved-wix-stock.js";
import { previewCarWixStock, CAR_WIX_STOCK_COLLECTIONS } from "./car-reserved-wix-stock.js";
import { previewRent2BuyWixStock, RENT2BUY_WIX_STOCK_COLLECTIONS } from "./rent2buy-reserved-wix-stock.js";

const WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const WIX_TASKS_URL = "https://www.wixapis.com/cms/v1/tasks";
const LANES = {
  finance: { collections: FINANCE_WIX_STOCK_COLLECTIONS, preview: previewFinanceWixStock },
  cars: { collections: CAR_WIX_STOCK_COLLECTIONS, preview: previewCarWixStock },
  rent2buy: { collections: RENT2BUY_WIX_STOCK_COLLECTIONS, preview: previewRent2BuyWixStock },
};
const FINAL_STATES = new Set(["sold", "awaiting_delivery", "removed_from_dealerkit"]);
const clean = value => String(value ?? "").trim();
const lifecycle = value => clean(value).toLowerCase().replace(/[\s-]+/g, "_");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function safety(message) {
  throw new Error("Safety stop: " + message);
}

export async function confirmDealerKitNotAvailable(registration, { loadSnapshot = fetchStableDealerKitStockSnapshot } = {}) {
  const snapshot = await loadSnapshot({ allowPartial: true });
  const matches = (snapshot?.vehicles || []).filter(vehicle => normalizeRegistration(vehicle.registration) === registration);
  if (matches.length !== 1) {
    if (matches.length > 1) safety("DealerKit returned multiple identities for this registration. Nothing was changed.");
    if (snapshot?.complete !== true) safety("DealerKit snapshot is incomplete and cannot prove this vehicle is absent. Nothing was changed.");
    return { state: "removed_from_dealerkit", checkedAt: snapshot.checkedAt };
  }
  const state = lifecycle(matches[0].status || matches[0].availability || matches[0].sourceStatus);
  if (!FINAL_STATES.has(state)) safety("DealerKit currently shows " + registration + " as " + (state || "unknown") + ". Nothing was changed.");
  return { state, checkedAt: snapshot.checkedAt };
}

function assertFullWixPreview(preview, pipeline) {
  if (preview?.ok !== true) safety("Wix preview failed.");
  const lane = LANES[pipeline];
  const allow = new Set(lane.collections.map(item => item.id));
  const collections = pipeline === "rent2buy" ? preview.sites?.[0]?.collections : preview.collections;
  if (!Array.isArray(collections) || lane.collections.some(({ id }) => !collections.some(c => c.id === id && !c.error))) {
    safety("Wix could not verify every approved listing collection. Nothing was changed.");
  }
  if (Array.isArray(preview.sites) && preview.sites.length !== 1) safety("Unexpected Rent2Buy Wix authority.");
  if (!Array.isArray(preview.matches)) safety("Wix did not return a verified match list.");
  for (const match of preview.matches) {
    if (!allow.has(match.collectionId) || !clean(match.itemId) || match.publishStatus !== "PUBLISHED"
      || (pipeline === "rent2buy" && match.siteId !== WIX_SITE_ID)) {
      safety("Wix returned an unexpected or protected record. Nothing was changed.");
    }
  }
  return preview.matches;
}

function wixHeaders() {
  const key = clean(process.env.WIX_FINANCE_API_KEY || process.env.WIX_API_KEY);
  if (!key) safety("Wix API credentials are unavailable.");
  return { "Content-Type": "application/json", "wix-site-id": WIX_SITE_ID, Authorization: key };
}

async function draftWixMatch(match) {
  const response = await fetch(WIX_TASKS_URL, {
    method: "POST",
    headers: wixHeaders(),
    body: JSON.stringify({
      task: {
        type: "UPDATE_PUBLISH_STATUS",
        updatePublishStatusOptions: {
          dataCollectionId: match.collectionId,
          environment: "LIVE",
          filter: { _id: { $eq: match.itemId } },
          operation: "SET_DRAFT_STATUS",
        },
      },
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Wix declined the draft request (" + response.status + ").");
  const data = await response.json();
  const taskId = clean(data?.task?.id);
  if (!taskId) throw new Error("Wix returned no draft task ID.");
  for (let attempt = 0; attempt < 24; attempt++) {
    const taskResponse = await fetch(WIX_TASKS_URL + "/" + encodeURIComponent(taskId), {
      headers: wixHeaders(),
      cache: "no-store",
    });
    if (!taskResponse.ok) throw new Error("Could not verify Wix task (" + taskResponse.status + ").");
    const body = await taskResponse.json();
    const task = body?.task || {};
    if (task.status === "FAILED") throw new Error("Wix draft task failed.");
    if (task.status === "COMPLETED") {
      if (Number(task.itemsFailed || 0) > 0 || Number(task.itemsSucceeded || 0) < 1) {
        throw new Error("Wix reported the draft task completed without a successful item update.");
      }
      return { collectionId: match.collectionId, itemId: match.itemId, taskId };
    }
    await sleep(350);
  }
  throw new Error("Wix task is still pending; recheck the advert before retrying.");
}

export async function removeSoldWixListing(
  { pipeline, registration },
  { confirmStatus = confirmDealerKitNotAvailable, loadPreview, draft = draftWixMatch } = {},
) {
  const lane = LANES[pipeline];
  const reg = normalizeRegistration(registration);
  if (!lane || !reg) safety("A supported stock lane and exact registration are required.");
  const checkWix = loadPreview || lane.preview;
  const confirmed = await confirmStatus(reg);
  const initial = await checkWix(reg);
  let matches = assertFullWixPreview(initial, pipeline);
  const results = [];
  for (const match of matches) {
    try {
      await confirmStatus(reg); // Revalidate immediately before every Wix mutation.
      const before = await checkWix(reg);
      const live = assertFullWixPreview(before, pipeline).find(x => x.collectionId === match.collectionId && x.itemId === match.itemId);
      if (!live) {
        results.push({ ok: true, skipped: true, collectionId: match.collectionId });
        continue;
      }
      const result = await draft(live);
      results.push({ ok: true, ...result });
    } catch (error) {
      results.push({ ok: false, collectionId: match.collectionId, error: clean(error?.message || error) });
      break; // Stop on failure; never blindly continue into other collections.
    }
  }
  const final = await checkWix(reg);
  matches = assertFullWixPreview(final, pipeline);
  return {
    ok: matches.length === 0 && results.every(result => result.ok),
    registration: reg,
    pipeline,
    dealerKitState: confirmed.state,
    changed: results.filter(result => result.ok && !result.skipped).length,
    remaining: matches.length,
    results,
    message: matches.length === 0 && results.every(result => result.ok)
      ? "Wix confirms the vehicle is no longer published in approved " + pipeline + " stock listings. Vehicle detail pages were preserved."
      : "Some Wix listings may still be published. Recheck before trying again.",
  };
}

export async function inspectSoldWixListing(
  { pipeline, registration },
  { confirmStatus = confirmDealerKitNotAvailable, loadPreview } = {},
) {
  const lane = LANES[pipeline];
  const reg = normalizeRegistration(registration);
  if (!lane || !reg) safety("A supported stock lane and exact registration are required.");
  const confirmed = await confirmStatus(reg);
  const preview = await (loadPreview || lane.preview)(reg);
  const matches = assertFullWixPreview(preview, pipeline);
  return {
    ok: true,
    previewOnly: true,
    registration: reg,
    pipeline,
    dealerKitState: confirmed.state,
    wouldRemove: matches.length,
    changed: 0,
    remaining: matches.length,
    message: "Preview-only safety check: " + matches.length + " published Wix record(s) found. No Wix items have been changed.",
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (!isMarketingStockWatchActionAuthorized(request)) {
    return response.status(401).json({ ok: false, message: "Marketing CRM access required." });
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  const pipeline = clean(request.body?.pipeline).toLowerCase();
  const registration = request.body?.registration;
  const action = clean(request.body?.action).toLowerCase();
  try {
    if (action === "check") {
      const result = await inspectSoldWixListing({ pipeline, registration });
      return response.status(200).json(result);
    }
    if (action !== "remove") {
      return response.status(400).json({ ok: false, message: "Unknown Sold / Removal Review action." });
    }
    if (request.body?.confirmed !== true) {
      return response.status(400).json({ ok: false, message: "Please confirm the Wix removal." });
    }
    if (process.env.VERCEL_ENV !== "production") {
      return response.status(409).json({ ok: false, previewOnly: true, message: "Preview mode is read-only. The real Remove from website action is only enabled in an approved CRM production release." });
    }
    const result = await removeSoldWixListing({ pipeline, registration });
    return response.status(result.ok ? 200 : 207).json(result);
  } catch (error) {
    return response.status(409).json({ ok: false, message: clean(error?.message || error) || "Wix removal safety check failed." });
  }
}
