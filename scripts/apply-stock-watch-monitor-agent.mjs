import fs from "node:fs";
import { fileURLToPath } from "node:url";

function patchFile(relativePath, patches) {
  const targetPath = fileURLToPath(new URL(relativePath, import.meta.url));
  let source = fs.readFileSync(targetPath, "utf8");
  for (const { before, after, label, already } of patches) {
    if (already && source.includes(already)) continue;
    const first = source.indexOf(before);
    if (first === -1) throw new Error(`Stock Watch Monitor transform could not find: ${label} in ${relativePath}`);
    if (source.indexOf(before, first + before.length) !== -1) throw new Error(`Stock Watch Monitor transform found duplicate anchor: ${label} in ${relativePath}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(targetPath, source);
}

const LOGGER_IMPORT = `import { createStockWatchTraceId, writeStockWatchActionLog } from "./_stock-watch-action-log.js";`;

patchFile("../api/finance-reserved-wix-stock.js", [
  {
    label: "Finance action logger import",
    already: LOGGER_IMPORT,
    before: `} from "./_vansco-cache-utils.js";`,
    after: `} from "./_vansco-cache-utils.js";\n${LOGGER_IMPORT}`,
  },
  {
    label: "Finance traced handler",
    already: "FINANCE_WIX_STOCK_TRACE",
    before: `export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const action = clean(request.body?.action).toLowerCase();
  const registration = request.body?.registration;

  try {
    if (action === "preview") {
      const result = await previewFinanceWixStock(registration);
      return response.status(200).json(result);
    }
    if (action === "unpublish") {
      if (request.body?.confirmed !== true) {
        return response.status(400).json({ ok: false, message: "Confirmation is required before moving Wix records to draft." });
      }
      const result = await unpublishReservedFinanceWixStock(registration);
      return response.status(result.ok ? 200 : 207).json(result);
    }
    return response.status(400).json({ ok: false, message: "Unknown action." });
  } catch (error) {
    console.error("FINANCE RESERVED WIX STOCK ACTION ERROR", {
      action,
      registration: normalizeRegistration(registration),
      message: clean(error?.message).slice(0, 1000),
    });
    return response.status(500).json({
      ok: false,
      message: error?.message || "Could not check Van Finance Wix stock.",
    });
  }
}`,
    after: `export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const action = clean(request.body?.action).toLowerCase();
  const registration = request.body?.registration;
  const traceId = createStockWatchTraceId();
  const startedAt = new Date();
  const authority = "VAN FINANCE Wix stock collections";
  // FINANCE_WIX_STOCK_TRACE
  await writeStockWatchActionLog({ traceId, pipeline: "finance", action, registration, authority, siteId: DEFAULT_WIX_SITE_ID, status: "started", startedAt });

  try {
    if (action === "preview") {
      const result = await previewFinanceWixStock(registration);
      await writeStockWatchActionLog({ traceId, pipeline: "finance", action, registration, authority, siteId: DEFAULT_WIX_SITE_ID, status: "completed", httpStatus: 200, startedAt, matchedRecords: result.matches?.length || 0, result: { liveCollectionCount: result.liveCollectionCount, collections: result.collections?.map((item) => ({ id: item.id, live: item.live, error: item.error })) } });
      return response.status(200).json({ ...result, traceId });
    }
    if (action === "unpublish") {
      if (request.body?.confirmed !== true) {
        await writeStockWatchActionLog({ traceId, pipeline: "finance", action, registration, authority, siteId: DEFAULT_WIX_SITE_ID, status: "failed", httpStatus: 400, startedAt, error: "Confirmation is required before moving Wix records to draft." });
        return response.status(400).json({ ok: false, traceId, message: "Confirmation is required before moving Wix records to draft." });
      }
      const result = await unpublishReservedFinanceWixStock(registration);
      const httpStatus = result.ok ? 200 : 207;
      await writeStockWatchActionLog({ traceId, pipeline: "finance", action: "unpublish", registration, authority, siteId: DEFAULT_WIX_SITE_ID, status: result.ok ? "completed" : "partial_failure", httpStatus, startedAt, matchedRecords: result.results?.length || 0, changedRecords: result.changed || 0, failureCount: result.failures || 0, result: { results: result.results, message: result.message } });
      return response.status(httpStatus).json({ ...result, traceId });
    }
    await writeStockWatchActionLog({ traceId, pipeline: "finance", action, registration, authority, siteId: DEFAULT_WIX_SITE_ID, status: "failed", httpStatus: 400, startedAt, error: "Unknown action." });
    return response.status(400).json({ ok: false, traceId, message: "Unknown action." });
  } catch (error) {
    await writeStockWatchActionLog({ traceId, pipeline: "finance", action, registration, authority, siteId: DEFAULT_WIX_SITE_ID, status: "failed", httpStatus: 500, startedAt, failureCount: 1, error: error?.message || "Could not check Van Finance Wix stock." });
    console.error("FINANCE RESERVED WIX STOCK ACTION ERROR", {
      traceId,
      action,
      registration: normalizeRegistration(registration),
      message: clean(error?.message).slice(0, 1000),
    });
    return response.status(500).json({ ok: false, traceId, message: error?.message || "Could not check Van Finance Wix stock." });
  }
}`,
  },
]);

patchFile("../api/rent2buy-reserved-wix-stock.js", [
  {
    label: "Rent2Buy action logger import",
    already: LOGGER_IMPORT,
    before: `} from "./_vansco-cache-utils.js";`,
    after: `} from "./_vansco-cache-utils.js";\n${LOGGER_IMPORT}`,
  },
  {
    label: "Rent2Buy traced handler",
    already: "RENT2BUY_WIX_STOCK_TRACE",
    before: `export default async function handler(request, response) {
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
}`,
    after: `export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const action = clean(request.body?.action).toLowerCase();
  const registration = request.body?.registration;
  const traceId = createStockWatchTraceId();
  const startedAt = new Date();
  const authority = "VAN FINANCE Wix / ALLRENT2BUYVANS + category membership collections";
  // RENT2BUY_WIX_STOCK_TRACE
  await writeStockWatchActionLog({ traceId, pipeline: "rent2buy", action, registration, authority, siteId: FINANCE_WIX_SITE_ID, status: "started", startedAt });

  try {
    if (action === "preview") {
      const result = await previewRent2BuyWixStock(registration);
      await writeStockWatchActionLog({ traceId, pipeline: "rent2buy", action, registration, authority, siteId: FINANCE_WIX_SITE_ID, status: "completed", httpStatus: 200, startedAt, matchedRecords: result.matches?.length || 0, result: { authority: result.authority, collections: result.sites?.[0]?.collections?.map((item) => ({ id: item.id, live: item.live, error: item.error })) } });
      return response.status(200).json({ ...result, traceId });
    }
    if (action === "unpublish") {
      if (request.body?.confirmed !== true) {
        await writeStockWatchActionLog({ traceId, pipeline: "rent2buy", action, registration, authority, siteId: FINANCE_WIX_SITE_ID, status: "failed", httpStatus: 400, startedAt, error: "Confirmation is required before moving Rent2Buy listing records to Draft." });
        return response.status(400).json({ ok: false, traceId, message: "Confirmation is required before moving Rent2Buy listing records to Draft." });
      }
      const result = await unpublishReservedRent2BuyWixStock(registration);
      const httpStatus = result.ok ? 200 : 207;
      await writeStockWatchActionLog({ traceId, pipeline: "rent2buy", action: "unpublish", registration, authority, siteId: FINANCE_WIX_SITE_ID, status: result.ok ? "completed" : "partial_failure", httpStatus, startedAt, matchedRecords: result.results?.length || 0, changedRecords: result.changed || 0, failureCount: result.failures || 0, result: { authority: result.authority, results: result.results, message: result.message } });
      return response.status(httpStatus).json({ ...result, traceId });
    }
    await writeStockWatchActionLog({ traceId, pipeline: "rent2buy", action, registration, authority, siteId: FINANCE_WIX_SITE_ID, status: "failed", httpStatus: 400, startedAt, error: "Unknown action." });
    return response.status(400).json({ ok: false, traceId, message: "Unknown action." });
  } catch (error) {
    await writeStockWatchActionLog({ traceId, pipeline: "rent2buy", action, registration, authority, siteId: FINANCE_WIX_SITE_ID, status: "failed", httpStatus: 500, startedAt, failureCount: 1, error: error?.message || "Could not check Rent2Buy Wix stock." });
    console.error("RENT2BUY RESERVED WIX STOCK ACTION ERROR", {
      traceId,
      action,
      registration: normalizeRegistration(registration),
      message: clean(error?.message).slice(0, 1000),
    });
    return response.status(500).json({ ok: false, traceId, message: error?.message || "Could not check Rent2Buy Wix stock." });
  }
}`,
  },
]);

patchFile("../pages/VanscoStockWatchPage.jsx", [
  {
    label: "Monitor service import",
    already: 'from "../services/stockWatchMonitor.js"',
    before: `} from "../services/vanscoStockCache.js";`,
    after: `} from "../services/vanscoStockCache.js";\nimport { fetchStockWatchMonitorStatus, runStockWatchMonitorNow } from "../services/stockWatchMonitor.js";`,
  },
  {
    label: "Monitor panel component",
    already: "function StockWatchMonitorPanel(",
    before: `export default function VanscoStockWatchPage() {`,
    after: `function StockWatchMonitorPanel({ monitor, loading, running, error, onRun }) {
  const health = monitor?.health || "unknown";
  const lastRun = monitor?.lastRun || null;
  const issues = monitor?.issues || [];
  const snapshot = lastRun?.snapshot || {};
  const counts = snapshot.counts || {};
  const provider = monitor?.provider || {};
  const healthStyle = health === "healthy"
    ? { background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0" }
    : health === "warning"
      ? { background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }
      : health === "critical"
        ? { background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }
        : { background: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0" };

  return (
    <div style={{ marginTop: 12, border: "1px solid #dbeafe", borderRadius: 14, padding: 12, background: "#f8fbff", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong>Stock Watch Monitor Agent</strong>
            <span style={{ ...healthStyle, padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>{health}</span>
          </div>
          <div className="vehicle-card__meta">Provider: {provider.label || snapshot.provider?.providerLabel || "Not checked yet"} · automatic check every 15 minutes · AI diagnosis only when a new warning/critical fault appears.</div>
        </div>
        <button className="button button--ghost" type="button" onClick={onRun} disabled={running || loading}>{running ? "Running health check..." : "Run health check now"}</button>
      </div>
      {loading && !lastRun ? <div className="vehicle-card__meta">Loading monitor history...</div> : null}
      {lastRun ? (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11 }}>
          <span><strong>Last check:</strong> {formatWatchTimestamp(lastRun.completed_at || lastRun.started_at)}</span>
          <span><strong>Source:</strong> {counts.providerVehicles ?? "?"}</span>
          <span><strong>Finance live:</strong> {counts.financeLive ?? "?"}</span>
          <span><strong>Rent2Buy live:</strong> {counts.rent2buyLive ?? "?"}</span>
          <span><strong>Rent2Buy reserved:</strong> {counts.rent2buyReserved ?? "?"}</span>
          <span><strong>Open faults:</strong> {issues.length}</span>
        </div>
      ) : null}
      {issues.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          {issues.slice(0, 5).map((item) => (
            <div key={item.fingerprint} style={{ border: item.severity === "critical" ? "1px solid #fecaca" : "1px solid #fde68a", background: item.severity === "critical" ? "#fff7f7" : "#fffdf5", borderRadius: 10, padding: 9 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: item.severity === "critical" ? "#991b1b" : "#92400e" }}>{String(item.severity || "warning").toUpperCase()} · {item.title}</div>
              {item.ai_diagnosis ? <div style={{ marginTop: 4, fontSize: 11 }}><strong>Agent diagnosis:</strong> {item.ai_diagnosis}</div> : null}
              <div style={{ marginTop: 4, fontSize: 11 }}><strong>Look here first:</strong> {item.look_here || "See evidence below"}</div>
              {Array.isArray(item.directions) && item.directions.length ? <div style={{ marginTop: 3, fontSize: 10, color: "#475569" }}>{item.directions.slice(0, 3).join(" → ")}</div> : null}
              <div style={{ marginTop: 3, fontSize: 9, color: "#64748b" }}>Fault code {item.code} · seen {item.occurrences || 1} time(s){item.last_run_id ? ` · run ${String(item.last_run_id).slice(0, 8)}` : ""}</div>
            </div>
          ))}
        </div>
      ) : lastRun && health === "healthy" ? <div style={{ fontSize: 11, fontWeight: 800, color: "#047857" }}>All monitored Stock Watch paths are healthy. No action required.</div> : null}
      {error ? <div className="error-banner">Monitor: {error}</div> : null}
    </div>
  );
}

export default function VanscoStockWatchPage() {`,
  },
  {
    label: "Monitor state",
    already: "const [stockWatchMonitor, setStockWatchMonitor]",
    before: `  const [showDiagnostics, setShowDiagnostics] = useState(false);`,
    after: `  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [stockWatchMonitor, setStockWatchMonitor] = useState(null);
  const [stockWatchMonitorLoading, setStockWatchMonitorLoading] = useState(true);
  const [stockWatchMonitorRunning, setStockWatchMonitorRunning] = useState(false);
  const [stockWatchMonitorError, setStockWatchMonitorError] = useState("");`,
  },
  {
    label: "Monitor loader",
    already: "async function loadStockWatchMonitor()",
    before: `  async function loadPipeline(pipeline = selectedPipeline, options = {}) {`,
    after: `  async function loadStockWatchMonitor() {
    setStockWatchMonitorLoading(true);
    try {
      const payload = await fetchStockWatchMonitorStatus();
      setStockWatchMonitor(payload);
      setStockWatchMonitorError("");
      return payload;
    } catch (error) {
      setStockWatchMonitorError(error?.message || "Could not load monitor status.");
      return null;
    } finally {
      setStockWatchMonitorLoading(false);
    }
  }

  async function handleRunStockWatchMonitor() {
    setStockWatchMonitorRunning(true);
    setStockWatchMonitorError("");
    try {
      await runStockWatchMonitorNow();
      await loadStockWatchMonitor();
    } catch (error) {
      setStockWatchMonitorError(error?.message || "Could not run Stock Watch Monitor.");
    } finally {
      setStockWatchMonitorRunning(false);
    }
  }

  useEffect(() => {
    let active = true;
    const load = async () => { if (active) await loadStockWatchMonitor(); };
    load();
    const timer = window.setInterval(load, 90000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function loadPipeline(pipeline = selectedPipeline, options = {}) {`,
  },
  {
    label: "Monitor panel placement",
    already: "<StockWatchMonitorPanel monitor={stockWatchMonitor}",
    before: `        {reloadComparisonStatus ? <div className="vansco-watch-note vansco-watch-note--warning">`,
    after: `        <StockWatchMonitorPanel monitor={stockWatchMonitor} loading={stockWatchMonitorLoading} running={stockWatchMonitorRunning} error={stockWatchMonitorError} onRun={handleRunStockWatchMonitor} />
        {reloadComparisonStatus ? <div className="vansco-watch-note vansco-watch-note--warning">`,
  },
]);

console.log("Applied Stock Watch Monitor Agent UI and persistent action tracing to Finance/Rent2Buy draft paths.");
