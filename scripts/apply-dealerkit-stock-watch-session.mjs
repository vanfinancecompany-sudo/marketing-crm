import fs from "node:fs";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url));
const readinessPath = fileURLToPath(new URL("../api/dealerkit-image-readiness.js", import.meta.url));
let readinessSource = fs.readFileSync(readinessPath, "utf8").replace(/\r\n/g, "\n");
if (!readinessSource.includes("export async function fetchCmsItems(")) {
  const anchor = "async function fetchCmsItems(";
  if (readinessSource.split(anchor).length !== 2) throw new Error("Stock Watch session transform could not uniquely export the CMS image reader.");
  readinessSource = readinessSource.replace(anchor, "export async function fetchCmsItems(");
  fs.writeFileSync(readinessPath, readinessSource);
}
let source = fs.readFileSync(pagePath, "utf8").replace(/\r\n/g, "\n");
if (source.includes("DEALERKIT_STOCK_WATCH_SESSION_UI")) process.exit(0);

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Stock Watch session transform expected one ${label}, found ${count}.`);
  source = source.replace(before, after);
}

function replaceBlock(start, end, replacement, label) {
  const first = source.indexOf(start);
  if (first < 0 || source.indexOf(start, first + start.length) >= 0) throw new Error(`Stock Watch session transform could not uniquely find ${label} start.`);
  const last = source.indexOf(end, first + start.length);
  if (last < 0) throw new Error(`Stock Watch session transform could not find ${label} end.`);
  source = source.slice(0, first) + replacement + source.slice(last);
}

replaceOnce('import { useEffect, useMemo, useState } from "react";', 'import { useEffect, useMemo, useRef, useState } from "react";', "React import");
replaceOnce('} from "../services/vanscoStockCache.js";', `} from "../services/vanscoStockCache.js";
import { createDealerKitStockWatchSessionCache, fetchDealerKitStockWatchSession, fetchDealerKitStockWatchComparison } from "../services/dealerkitStockWatchSession.js";
import { buildStockWatchImageReadiness } from "../lib/dealerkitStockWatchReadiness.js";`, "session imports");
replaceOnce('  const [imageReadyErrorByPipeline, setImageReadyErrorByPipeline] = useState({ finance: "", rent2buy: "", cars: "" });', `  const [imageReadyErrorByPipeline, setImageReadyErrorByPipeline] = useState({ finance: "", rent2buy: "", cars: "" });
  // DEALERKIT_STOCK_WATCH_SESSION_UI: one request owns the snapshot and all three read-only lane views.
  const sessionCacheRef = useRef(null);
  const sessionUiLoadRef = useRef(null);
  const sessionUiGenerationRef = useRef(0);
  if (!sessionCacheRef.current) sessionCacheRef.current = createDealerKitStockWatchSessionCache();`, "session state");

replaceBlock('  async function loadPipeline(pipeline = selectedPipeline, options = {}) {', '  async function loadLocalStock(', `  function applySession(session) {
    const records = {};
    const summaries = {};
    const imageAlerts = {};
    const imageSummaries = {};
    const imageErrors = {};
    for (const pipeline of ["finance", "rent2buy", "cars"]) {
      const lane = session.lanes[pipeline];
      if (!lane) throw new Error(\`DealerKit session omitted the \${pipeline} lane.\`);
      records[pipeline] = lane.records || [];
      summaries[pipeline] = lane.summary || null;
      imageAlerts[pipeline] = lane.imageReadiness?.alerts || [];
      imageSummaries[pipeline] = lane.imageReadiness?.summary || null;
      imageErrors[pipeline] = lane.imageReadiness?.error || "";
    }
    setRecordsByPipeline(records);
    setCacheSummaryByPipeline(summaries);
    setImageReadyByPipeline(imageAlerts);
    setImageReadySummaryByPipeline(imageSummaries);
    setImageReadyErrorByPipeline(imageErrors);
    setDebugByPipeline((previous) => Object.fromEntries(["finance", "rent2buy", "cars"].map((pipeline) => [
      pipeline, { ...(previous[pipeline] || {}), sessionTiming: session.timing, snapshotGeneration: session.snapshotGeneration },
    ])));
  }

  async function loadSession({ forceFresh = false } = {}) {
    const cache = sessionCacheRef.current;
    if (!forceFresh && cache.isCurrent()) return cache.peek();
    if (!forceFresh && sessionUiLoadRef.current) return sessionUiLoadRef.current;
    const uiGeneration = ++sessionUiGenerationRef.current;
    setLoadingPipeline(selectedPipeline);
    const work = cache.load(fetchDealerKitStockWatchSession, { forceFresh }).then(async ({ session }) => {
      if (uiGeneration !== sessionUiGenerationRef.current) return session;
      applySession(session);
      await Promise.allSettled(["finance", "rent2buy", "cars"].map((pipeline) =>
        loadLocalStock(pipeline, () => uiGeneration === sessionUiGenerationRef.current, session.lanes[pipeline].comparison)));
      return session;
    }).finally(() => {
      if (sessionUiLoadRef.current === work) sessionUiLoadRef.current = null;
      if (uiGeneration === sessionUiGenerationRef.current) setLoadingPipeline("");
    });
    sessionUiLoadRef.current = work;
    return work;
  }

`, "pipeline loader");

replaceOnce('  async function loadLocalStock(pipeline = selectedPipeline, isActive = () => true) {', '  async function loadLocalStock(pipeline = selectedPipeline, isActive = () => true, comparison = null) {\n    const localStartedAt = performance.now();', "local loader signature");
replaceOnce('          const presence = await fetchStockWatchWixListingPresence(pipeline);', '          const presence = comparison ? comparison.presence : await fetchStockWatchWixListingPresence(pipeline);', "shared Wix presence");
replaceOnce('      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: presenceWarning }));\n      return effectiveVehicles;', '      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: presenceWarning }));\n      setDebugByPipeline((prev) => ({ ...prev, [pipeline]: { ...(prev[pipeline] || {}), localComparisonMs: Math.round(performance.now() - localStartedAt), reusedWixListingPresence: Boolean(comparison) } }));\n      return effectiveVehicles;', "local comparison timing");

replaceBlock('  useEffect(() => {\n    let active = true;\n    loadLocalStock(selectedPipeline', '  const activeFilter =', `  useEffect(() => {
    const startedAt = performance.now();
    const cached = sessionCacheRef.current.isCurrent();
    if (!cached) {
      loadSession().catch((error) => setErrorMessage(\`Stock data incomplete / last verified snapshot shown. \${error.message || "Could not load DealerKit Stock Watch data."}\`));
    }
    setDebugByPipeline((previous) => ({
      ...previous,
      [selectedPipeline]: {
        ...(previous[selectedPipeline] || {}),
        tabSwitch: { cached, loadMs: Math.round(performance.now() - startedAt), at: new Date().toISOString() },
      },
    }));
  }, [selectedPipeline]);

`, "tab effects");

replaceBlock('  async function handleRefreshCache() {', '  function handleRecordSaved(', `  async function handleRefreshCache() {
    setRefreshingCache(true);
    setErrorMessage("");
    setSuccessMessage("");
    const startedAt = Date.now();
    try {
      const session = await loadSession({ forceFresh: true });
      const attempts = session.timing?.dealerKitBulkReadAttempts || 1;
      setSuccessMessage(\`DealerKit stock refreshed for Finance, Rent2Buy and Cars in \${((Date.now() - startedAt) / 1000).toFixed(1)}s. Source checked: \${formatWatchTimestamp(session.snapshotGeneration)}. Bulk read attempts: \${attempts}.\`);
    } catch (error) {
      setErrorMessage(\`\${error.message || "Could not refresh DealerKit stock data."} Showing the last verified snapshot if available.\`);
    } finally {
      setRefreshingCache(false);
    }
  }

  async function handleReloadComparison() {
    setErrorMessage("");
    setSuccessMessage("");
    setReloadComparisonRunning(true);
    setReloadComparisonProgress(15);
    setReloadComparisonStatus("Refreshing comparison...");
    const startedAt = Date.now();
    const pipeline = selectedPipeline;
    try {
      const session = sessionCacheRef.current.peek();
      if (!session?.lanes?.[pipeline]) throw new Error("Refresh Dealer Stock first to establish a source snapshot.");
      const pipelines = pipeline === "cars" ? ["cars", "finance"] : [pipeline];
      const comparisons = await Promise.all(pipelines.map(fetchDealerKitStockWatchComparison));
      setReloadComparisonProgress(70);
      for (let index = 0; index < pipelines.length; index += 1) {
        const laneName = pipelines[index];
        const comparison = comparisons[index];
        const lane = session.lanes[laneName];
        const complete = comparison.presence?.complete === true && !comparison.cmsError;
        const alerts = complete ? buildStockWatchImageReadiness({
          pipeline: laneName,
          records: lane.records,
          listingPresence: comparison.presence,
          cmsItems: comparison.cmsItems,
        }) : [];
        const imageReadiness = {
          alerts,
          summary: {
            imageUpdatesReady: alerts.length,
            complete: complete && session.sourceComplete,
            degraded: !session.sourceComplete,
            sourceAvailable: true,
            sourceCheckedAt: session.snapshotGeneration,
            dealerKitVehiclesAvailable: lane.source?.usableRecords,
            cmsRefreshedAt: comparison.cmsRefreshedAt,
          },
          error: !comparison.presence?.complete
            ? "Live Wix listing presence is incomplete; photo readiness was not guessed."
            : comparison.cmsError || "",
        };
        session.lanes[laneName] = { ...lane, comparison, imageReadiness };
        setImageReadyByPipeline((previous) => ({ ...previous, [laneName]: alerts }));
        setImageReadySummaryByPipeline((previous) => ({ ...previous, [laneName]: imageReadiness.summary }));
        setImageReadyErrorByPipeline((previous) => ({ ...previous, [laneName]: imageReadiness.error }));
      }
      await Promise.all(pipelines.map((laneName) => loadLocalStock(laneName, () => true, session.lanes[laneName].comparison)));
      if (comparisons.some((comparison) => comparison.presence?.complete !== true)) throw new Error("Live Wix listing presence is incomplete. This lane remains paused.");
      setReloadComparisonProgress(100);
      const message = \`Comparison refreshed for \${pipelineLabel(pipeline)} in \${((Date.now() - startedAt) / 1000).toFixed(1)}s using the refreshed live Wix listing snapshot and DealerKit source checked \${formatWatchTimestamp(session.snapshotGeneration)}. No DealerKit bulk read was needed.\`;
      setReloadComparisonStatus(message);
      setSuccessMessage(message);
    } catch (error) {
      const message = \`Comparison refresh failed: \${error.message || "Could not reload comparison."}\`;
      setReloadComparisonStatus(message);
      setErrorMessage(message);
    } finally {
      setReloadComparisonRunning(false);
    }
  }

`, "refresh handlers");

replaceOnce('disabled={refreshingCache}>{refreshingCache ? "Refreshing dealer stock..."', 'disabled={refreshingCache || reloadComparisonRunning}>{refreshingCache ? "Refreshing dealer stock..."', "dealer refresh button");
replaceOnce('disabled={reloadComparisonRunning || loadingPipeline === selectedPipeline}', 'disabled={reloadComparisonRunning || refreshingCache || loadingPipeline === selectedPipeline}', "comparison button");
replaceOnce('  const financeRegistrationsForCars = new Set();', '  // Cars has its own published CARFINANCE authority; never borrow Finance presence.\n  const financeRegistrationsForCars = new Set();', "Cars presence boundary");
replaceOnce('debug: debugByPipeline[selectedPipeline]', 'snapshotGeneration: sessionCacheRef.current.peek()?.snapshotGeneration, debug: debugByPipeline[selectedPipeline]', "accuracy diagnostics");

fs.writeFileSync(pagePath, source);
console.log("Applied single-snapshot DealerKit Stock Watch session UI.");
