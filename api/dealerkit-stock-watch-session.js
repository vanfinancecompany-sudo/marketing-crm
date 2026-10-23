import { fetchStableDealerKitStockSnapshot } from "./_dealerkit-stable-stock-snapshot.js";
import { getSupabaseServiceAdmin, normalizeRegistration, WATCH_TABLE } from "./_vansco-cache-utils.js";
import { syncDealerKitSourceState } from "./_dealerkit-source-state.js";
import { captureCompleteRent2BuyQuoteSnapshot } from "./_rent2buy-complete-quote-snapshot.mjs";
import { buildDealerKitStockWatchPayload } from "./dealerkit-stock-watch-list.js";
import { loadStockWatchComparisonInputs, STOCK_WATCH_PIPELINES } from "./_dealerkit-stock-watch-comparison.js";
import { buildStockWatchImageReadiness } from "../lib/dealerkitStockWatchReadiness.js";

function readActions(supabase, pipeline) {
  return supabase.from(WATCH_TABLE).select("*").eq("pipeline", pipeline).limit(2000);
}

export async function createDealerKitStockWatchSession({
  loadSnapshot = fetchStableDealerKitStockSnapshot,
  getSupabase = getSupabaseServiceAdmin,
  loadComparison = loadStockWatchComparisonInputs,
  syncSourceState = syncDealerKitSourceState,
  captureQuoteSnapshot = captureCompleteRent2BuyQuoteSnapshot,
  buildLane = buildDealerKitStockWatchPayload,
  loadActions = readActions,
  buildReadiness = buildStockWatchImageReadiness,
} = {}) {
  const startedAt = Date.now();
  const supabase = getSupabase();
  const sourceStartedAt = Date.now();
  // All independent Wix and decision reads start while DealerKit is loading.
  // Only this call owns the source snapshot; no other route receives a browser
  // supplied snapshot or performs a second bulk read for this refresh.
  const comparisonPromises = STOCK_WATCH_PIPELINES.map((pipeline) => loadComparison(pipeline));
  const actionsPromises = STOCK_WATCH_PIPELINES.map((pipeline) => loadActions(supabase, pipeline));
  let dealerKitStableSnapshotMs = 0;
  const snapshotPromise = Promise.resolve()
    .then(() => loadSnapshot({ allowPartial: true, stabilityAttempts: 3 }))
    .finally(() => { dealerKitStableSnapshotMs = Date.now() - sourceStartedAt; });
  const [snapshot, comparisons, actions] = await Promise.all([
    snapshotPromise,
    Promise.all(comparisonPromises),
    Promise.all(actionsPromises),
  ]);
  if (!snapshot || !Array.isArray(snapshot.vehicles)) throw new Error("DealerKit did not provide a usable stock snapshot.");

  let sourceStateSync;
  try {
    sourceStateSync = await syncSourceState(supabase, snapshot);
  } catch (error) {
    sourceStateSync = { available: false, written: 0, error: String(error?.message || error) };
  }
  // Optional reuse of the ALREADY FETCHED complete Stock Watch snapshot.
  // Never launches a second DealerKit bulk scan. No writes unless explicitly
  // enabled after schema review. A failure does not disrupt current Stock Watch.
  let quoteSnapshotCapture = { enabled: false, captured: false };
  if (process.env.RENT2BUY_QUOTE_SNAPSHOT_CAPTURE_ENABLED === "true") {
    if (snapshot.complete !== true) {
      quoteSnapshotCapture = { enabled: true, captured: false, reason: "incomplete_source" };
    } else {
      try {
        quoteSnapshotCapture = { enabled: true,
          ...(await captureQuoteSnapshot(supabase, snapshot)) };
      } catch (error) {
        quoteSnapshotCapture = { enabled: true, captured: false,
          reason: error?.code || "snapshot_unavailable" };
      }
    }
  }
  const laneStartedAt = Date.now();
  const laneDerivationMs = {};
  const lanePayloads = await Promise.all(STOCK_WATCH_PIPELINES.map(async (pipeline, index) => {
    const started = Date.now();
    try {
      return await buildLane({ pipeline, snapshot, supabase, actionsResult: actions[index], sourceStateSync });
    } finally {
      laneDerivationMs[pipeline] = Date.now() - started;
    }
  }));
  const sourceLaneDerivationMs = Date.now() - laneStartedAt;
  const lanes = {};
  const timingByPipeline = {};
  for (let index = 0; index < STOCK_WATCH_PIPELINES.length; index += 1) {
    const pipeline = STOCK_WATCH_PIPELINES[index];
    const lane = lanePayloads[index];
    const comparison = comparisons[index];
    const readinessStartedAt = Date.now();
    const comparisonComplete = comparison.presence?.complete === true;
    const readinessComplete = comparisonComplete && !comparison.cmsError && snapshot.complete === true;
    const alerts = comparisonComplete && !comparison.cmsError
      ? buildReadiness({
        pipeline,
        records: lane.records,
        listingPresence: comparison.presence,
        cmsItems: comparison.cmsItems,
        normalizeRegistration,
      })
      : [];
    const imageReadinessMs = Date.now() - readinessStartedAt;
    timingByPipeline[pipeline] = {
      ...comparison.timing,
      laneDerivationMs: laneDerivationMs[pipeline],
      imageReadinessMs,
    };
    lanes[pipeline] = {
      records: lane.records,
      summary: lane.summary,
      source: lane.source,
      comparison,
      imageReadiness: {
        alerts,
        summary: {
          imageUpdatesReady: alerts.length,
          complete: readinessComplete,
          degraded: snapshot.complete !== true,
          sourceAvailable: true,
          sourceCheckedAt: snapshot.checkedAt,
          dealerKitVehiclesAvailable: snapshot.vehicleCount,
          cmsRefreshedAt: comparison.cmsRefreshedAt,
        },
        error: !comparisonComplete
          ? "Live Wix listing presence is incomplete; photo readiness was not guessed."
          : comparison.cmsError,
      },
    };
  }

  return {
    ok: true,
    providerId: "dealerkit",
    snapshotGeneration: snapshot.checkedAt || new Date().toISOString(),
    sourceComplete: snapshot.complete === true,
    quoteSnapshotCapture,
    diagnostics: snapshot.diagnostics || null,
    lanes,
    timing: {
      dealerKitStableSnapshotMs,
      dealerKitStableSnapshotCalls: 1,
      dealerKitBulkReadAttempts: snapshot.diagnostics?.stability?.attemptsUsed || 1,
      sourceLaneDerivationMs,
      pipelines: timingByPipeline,
      totalMs: Date.now() - startedAt,
    },
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!process.env.MARKETING_CUSTOMER_DATABASE_API_KEY) {
    return response.status(503).json({ ok: false, message: "Marketing CRM DealerKit access is not configured." });
  }
  try {
    return response.status(200).json(await createDealerKitStockWatchSession());
  } catch (error) {
    return response.status(502).json({ ok: false, message: error?.message || "Could not refresh DealerKit Stock Watch." });
  }
}
