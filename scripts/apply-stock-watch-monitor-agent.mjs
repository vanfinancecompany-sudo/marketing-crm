import fs from "node:fs";
import { fileURLToPath } from "node:url";

function patch(relativePath, before, after, label, already = "") {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  let source = fs.readFileSync(path, "utf8");
  if (already && source.includes(already)) return;
  if (!source.includes(before)) throw new Error("Stock Watch Monitor transform missing " + label + " in " + relativePath);
  source = source.replace(before, after);
  fs.writeFileSync(path, source);
}

const loggerImport = 'import { createStockWatchTraceId, writeStockWatchActionLog } from "./_stock-watch-action-log.js";';

for (const file of ["../api/finance-reserved-wix-stock.js", "../api/rent2buy-reserved-wix-stock.js"]) {
  patch(file, '} from "./_vansco-cache-utils.js";', '} from "./_vansco-cache-utils.js";\n' + loggerImport, "action logger import", loggerImport);
}

const financeHandler = `export default async function handler(request, response) {
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
}`;

const financeTracedHandler = `export default async function handler(request, response) {
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
      await writeStockWatchActionLog({ traceId, pipeline: "finance", action, registration, authority, siteId: DEFAULT_WIX_SITE_ID, status: "completed", httpStatus: 200, startedAt, matchedRecords: result.matches?.length || 0, result: { liveCollectionCount: result.liveCollectionCount } });
      return response.status(200).json({ ...result, traceId });
    }
    if (action === "unpublish") {
      if (request.body?.confirmed !== true) {
        await writeStockWatchActionLog({ traceId, pipeline: "finance", action, registration, authority, siteId: DEFAULT_WIX_SITE_ID, status: "failed", httpStatus: 400, startedAt, error: "Confirmation required." });
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
    await writeStockWatchActionLog({ traceId, pipeline: "finance", action, registration, authority, siteId: DEFAULT_WIX_SITE_ID, status: "failed", httpStatus: 500, startedAt, failureCount: 1, error: error?.message || "Finance Stock Watch action failed." });
    console.error("FINANCE RESERVED WIX STOCK ACTION ERROR", { traceId, action, registration: normalizeRegistration(registration), message: clean(error?.message).slice(0, 1000) });
    return response.status(500).json({ ok: false, traceId, message: error?.message || "Could not check Van Finance Wix stock." });
  }
}`;
patch("../api/finance-reserved-wix-stock.js", financeHandler, financeTracedHandler, "Finance traced handler", "FINANCE_WIX_STOCK_TRACE");

const rentHandler = `export default async function handler(request, response) {
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
}`;

const rentTracedHandler = `export default async function handler(request, response) {
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
      await writeStockWatchActionLog({ traceId, pipeline: "rent2buy", action, registration, authority, siteId: FINANCE_WIX_SITE_ID, status: "completed", httpStatus: 200, startedAt, matchedRecords: result.matches?.length || 0, result: { authority: result.authority } });
      return response.status(200).json({ ...result, traceId });
    }
    if (action === "unpublish") {
      if (request.body?.confirmed !== true) {
        await writeStockWatchActionLog({ traceId, pipeline: "rent2buy", action, registration, authority, siteId: FINANCE_WIX_SITE_ID, status: "failed", httpStatus: 400, startedAt, error: "Confirmation required." });
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
    await writeStockWatchActionLog({ traceId, pipeline: "rent2buy", action, registration, authority, siteId: FINANCE_WIX_SITE_ID, status: "failed", httpStatus: 500, startedAt, failureCount: 1, error: error?.message || "Rent2Buy Stock Watch action failed." });
    console.error("RENT2BUY RESERVED WIX STOCK ACTION ERROR", { traceId, action, registration: normalizeRegistration(registration), message: clean(error?.message).slice(0, 1000) });
    return response.status(500).json({ ok: false, traceId, message: error?.message || "Could not check Rent2Buy Wix stock." });
  }
}`;
patch("../api/rent2buy-reserved-wix-stock.js", rentHandler, rentTracedHandler, "Rent2Buy traced handler", "RENT2BUY_WIX_STOCK_TRACE");

patch("../pages/VanscoStockWatchPage.jsx", '} from "../services/vanscoStockCache.js";', '} from "../services/vanscoStockCache.js";\nimport { fetchStockWatchMonitorStatus, runStockWatchMonitorNow } from "../services/stockWatchMonitor.js";', "monitor service import", 'from "../services/stockWatchMonitor.js"');

const componentAnchor = "export default function VanscoStockWatchPage() {";
const panelComponent = `function StockWatchMonitorPanel({ monitor, loading, running, error, onRun }) {
  const health = monitor?.health || "unknown";
  const lastRun = monitor?.lastRun || null;
  const issues = monitor?.issues || [];
  const counts = lastRun?.snapshot?.counts || {};
  const provider = monitor?.provider || {};
  const tone = health === "healthy" ? "#047857" : health === "critical" ? "#991b1b" : health === "warning" ? "#92400e" : "#475569";
  return (
    <div style={{ marginTop: 12, border: "1px solid #dbeafe", borderRadius: 14, padding: 12, background: "#f8fbff", display: "grid", gap: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div><strong>Stock Watch Monitor Agent</strong><div className="vehicle-card__meta">Health: <strong style={{ color: tone }}>{health.toUpperCase()}</strong> · Provider: {provider.label || lastRun?.provider_label || "Not checked"} · checks every 15 minutes</div></div>
        <button className="button button--ghost" type="button" onClick={onRun} disabled={running || loading}>{running ? "Running health check..." : "Run health check now"}</button>
      </div>
      {lastRun ? <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}><span>Last: {formatWatchTimestamp(lastRun.completed_at || lastRun.started_at)}</span><span>Source: {counts.providerVehicles ?? "?"}</span><span>Finance live: {counts.financeLive ?? "?"}</span><span>Rent2Buy live: {counts.rent2buyLive ?? "?"}</span><span>Rent2Buy reserved: {counts.rent2buyReserved ?? "?"}</span><span>Faults: {issues.length}</span></div> : null}
      {issues.slice(0, 5).map((item) => <div key={item.fingerprint} style={{ border: item.severity === "critical" ? "1px solid #fecaca" : "1px solid #fde68a", borderRadius: 9, padding: 8, background: "#fff" }}><div style={{ fontSize: 11, fontWeight: 900 }}>{String(item.severity || "warning").toUpperCase()} · {item.title}</div>{item.ai_diagnosis ? <div style={{ fontSize: 11, marginTop: 3 }}><strong>Agent diagnosis:</strong> {item.ai_diagnosis}</div> : null}<div style={{ fontSize: 11, marginTop: 3 }}><strong>Look here first:</strong> {item.look_here || "Monitor evidence"}</div>{Array.isArray(item.directions) ? <div style={{ fontSize: 10, marginTop: 3, color: "#475569" }}>{item.directions.slice(0, 3).join(" → ")}</div> : null}</div>)}
      {!issues.length && lastRun?.health === "healthy" ? <div style={{ fontSize: 11, color: "#047857", fontWeight: 800 }}>All monitored Stock Watch paths are healthy.</div> : null}
      {error ? <div className="error-banner">Monitor: {error}</div> : null}
    </div>
  );
}

` + componentAnchor;
patch("../pages/VanscoStockWatchPage.jsx", componentAnchor, panelComponent, "monitor panel component", "function StockWatchMonitorPanel(");

patch("../pages/VanscoStockWatchPage.jsx", '  const [showDiagnostics, setShowDiagnostics] = useState(false);', '  const [showDiagnostics, setShowDiagnostics] = useState(false);\n  const [stockWatchMonitor, setStockWatchMonitor] = useState(null);\n  const [stockWatchMonitorLoading, setStockWatchMonitorLoading] = useState(true);\n  const [stockWatchMonitorRunning, setStockWatchMonitorRunning] = useState(false);\n  const [stockWatchMonitorError, setStockWatchMonitorError] = useState("");', "monitor state", "const [stockWatchMonitor, setStockWatchMonitor]");

const loadAnchor = "  async function loadPipeline(pipeline = selectedPipeline, options = {}) {";
const loader = `  async function loadStockWatchMonitor() {
    setStockWatchMonitorLoading(true);
    try { const payload = await fetchStockWatchMonitorStatus(); setStockWatchMonitor(payload); setStockWatchMonitorError(""); return payload; }
    catch (error) { setStockWatchMonitorError(error?.message || "Could not load monitor status."); return null; }
    finally { setStockWatchMonitorLoading(false); }
  }

  async function handleRunStockWatchMonitor() {
    setStockWatchMonitorRunning(true); setStockWatchMonitorError("");
    try { await runStockWatchMonitorNow(); await loadStockWatchMonitor(); }
    catch (error) { setStockWatchMonitorError(error?.message || "Could not run Stock Watch Monitor."); }
    finally { setStockWatchMonitorRunning(false); }
  }

  useEffect(() => {
    let active = true;
    const load = async () => { if (active) await loadStockWatchMonitor(); };
    load();
    const timer = window.setInterval(load, 90000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

` + loadAnchor;
patch("../pages/VanscoStockWatchPage.jsx", loadAnchor, loader, "monitor loader", "async function loadStockWatchMonitor()");

const placement = '        {reloadComparisonStatus ? <div className="vansco-watch-note vansco-watch-note--warning">';
patch("../pages/VanscoStockWatchPage.jsx", placement, '        <StockWatchMonitorPanel monitor={stockWatchMonitor} loading={stockWatchMonitorLoading} running={stockWatchMonitorRunning} error={stockWatchMonitorError} onRun={handleRunStockWatchMonitor} />\n' + placement, "monitor panel placement", "<StockWatchMonitorPanel monitor={stockWatchMonitor}");

console.log("Applied Stock Watch Monitor Agent UI and Finance/Rent2Buy action tracing.");
