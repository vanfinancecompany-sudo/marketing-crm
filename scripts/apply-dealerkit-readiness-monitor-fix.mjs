import fs from "node:fs";
import { fileURLToPath } from "node:url";

function patch(relativePath, before, after, label, already = "") {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  let source = fs.readFileSync(path, "utf8");
  if (already && source.includes(already)) return;
  if (!source.includes(before)) throw new Error(`DealerKit readiness/monitor transform missing ${label} in ${relativePath}`);
  source = source.replace(before, after);
  fs.writeFileSync(path, source);
}

patch(
  "../pages/VanscoStockWatchPage.jsx",
  'value={summary.imagesReady} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "images_ready" }))}',
  'value={imageReadyError || (imageReadySummary && imageReadySummary.complete === false) ? "Unavailable" : summary.imagesReady} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "images_ready" }))}',
  "image readiness unavailable summary value",
  'value={imageReadyError || (imageReadySummary && imageReadySummary.complete === false) ? "Unavailable" : summary.imagesReady}'
);

patch(
  "../pages/VanscoStockWatchPage.jsx",
  'setImageReadySummaryByPipeline((prev) => ({ ...prev, [pipeline]: null }));\n      setImageReadyErrorByPipeline((prev) => ({ ...prev, [pipeline]: error.message || "Could not check DealerKit image readiness." }));',
  'setImageReadySummaryByPipeline((prev) => ({ ...prev, [pipeline]: error?.summary || { imageUpdatesReady: 0, complete: false, sourceAvailable: false } }));\n      setImageReadyErrorByPipeline((prev) => ({ ...prev, [pipeline]: error.message || "Could not check DealerKit image readiness." }));',
  "image readiness fail-closed state",
  'error?.summary || { imageUpdatesReady: 0, complete: false, sourceAvailable: false }'
);

const issuePanelAnchor = '{item.ai_diagnosis ? <div style={{ fontSize: 11, marginTop: 3 }}><strong>Agent diagnosis:</strong> {item.ai_diagnosis}</div> : null}<div style={{ fontSize: 11, marginTop: 3 }}><strong>Look here first:</strong> {item.look_here || "Monitor evidence"}</div>';
const issuePanelReplacement = '{item.ai_diagnosis ? <div style={{ fontSize: 11, marginTop: 3 }}><strong>Agent diagnosis:</strong> {item.ai_diagnosis}</div> : null}{Array.isArray(item.evidence?.diagnostics?.invalidRecords) && item.evidence.diagnostics.invalidRecords.length ? <div style={{ fontSize: 10, marginTop: 3, color: "#7c2d12" }}><strong>Rejected DealerKit rows:</strong> {item.evidence.diagnostics.invalidRecords.slice(0, 12).map((row) => `#${row.position || "?"} · ID ${row.supplierStockId || "missing"} · reg ${row.registrationCandidate || "missing"}`).join(" | ")}</div> : null}<div style={{ fontSize: 11, marginTop: 3 }}><strong>Look here first:</strong> {item.look_here || "Monitor evidence"}</div>';
patch(
  "../pages/VanscoStockWatchPage.jsx",
  issuePanelAnchor,
  issuePanelReplacement,
  "monitor rejected DealerKit row display",
  "Rejected DealerKit rows:"
);

patch(
  "../api/_stock-watch-monitor.js",
  `function millis(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}`,
  `function millis(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function isIntentionalSafetyStop(entry = {}) {
  const status = clean(entry.status).toLowerCase();
  if (["blocked", "safety_blocked"].includes(status)) return true;
  if (entry?.result?.safetyBlocked === true) return true;

  const message = [entry?.error, entry?.result?.message].map((value) => clean(value, 4000).toLowerCase()).filter(Boolean).join(" ");
  const reservedGuard = message.includes("reserved") && message.includes("sold") && message.includes("deposit taken");
  const noMutation = message.includes("nothing was changed") || message.includes("safety stop") || message.includes("safety-stopped") || message.includes("did not") || message.includes("no longer shows");
  return reservedGuard && noMutation;
}`,
  "intentional safety-stop classifier",
  "function isIntentionalSafetyStop(entry = {})"
);

patch(
  "../api/_stock-watch-monitor.js",
  'const recentFailures = actionLogs.filter((entry) => ["failed", "partial_failure"].includes(clean(entry.status).toLowerCase()) || Number(entry.failure_count || 0) > 0);',
  'const recentFailures = actionLogs.filter((entry) => !isIntentionalSafetyStop(entry) && (["failed", "partial_failure"].includes(clean(entry.status).toLowerCase()) || Number(entry.failure_count || 0) > 0));',
  "safety-stop exclusion from action failures",
  "!isIntentionalSafetyStop(entry)"
);

patch(
  "../api/_stock-watch-monitor.js",
  'evidence: { providerId: snapshot.providerId, error: snapshot.providerError },',
  'evidence: { providerId: snapshot.providerId, error: snapshot.providerError, diagnostics: snapshot.providerDiagnostics || null },',
  "provider diagnostics evidence",
  "diagnostics: snapshot.providerDiagnostics || null"
);

patch(
  "../api/stock-watch-monitor-agent.js",
  `    let provider = null;
    let providerError = "";
    try { provider = await loadStockSourceSnapshot({ supabase, environment, fetchImplementation }); }
    catch (error) { providerError = clean(error?.message || error, 2000); }`,
  `    let provider = null;
    let providerError = "";
    let providerDiagnostics = null;
    try { provider = await loadStockSourceSnapshot({ supabase, environment, fetchImplementation }); }
    catch (error) {
      providerError = clean(error?.message || error, 2000);
      providerDiagnostics = error?.diagnostics && typeof error.diagnostics === "object" ? error.diagnostics : null;
    }`,
  "provider diagnostic capture",
  "let providerDiagnostics = null;"
);

patch(
  "../api/stock-watch-monitor-agent.js",
  `      providerId: config.id,
      providerError: providerError || null,
      provider: provider || { providerId: config.id, providerLabel: config.label, vehicleCount: 0, vehicles: [], refresh: {} },`,
  `      providerId: config.id,
      providerError: providerError || null,
      providerDiagnostics,
      provider: provider || { providerId: config.id, providerLabel: config.label, vehicleCount: 0, vehicles: [], refresh: {} },`,
  "provider diagnostics snapshot",
  "providerDiagnostics,"
);

patch(
  "../api/_dealerkit-stock-adapter.js",
  `function invalidRecordDiagnostic(item, position, extra = {}) {
  return {
    position,
    idPresent: Boolean(clean(item?.id, 300)),
    registrationPresent: Boolean(normalizeRegistration(item?.vehicle?.registration || item?.vehicle?.plate || "")),
    sourceStatus: clean(item?.status ?? item?.meta?.status, 100) || "unknown",
    vehicleType: clean(item?.vehicle?.type, 100) || "unknown",
    ...extra,
  };
}`,
  `function invalidRecordDiagnostic(item, position, extra = {}) {
  const supplierStockId = clean(item?.id, 300);
  const registrationCandidate = clean(item?.vehicle?.registration || item?.vehicle?.plate || "", 80);
  return {
    position,
    supplierStockId: supplierStockId || null,
    registrationCandidate: registrationCandidate || null,
    idPresent: Boolean(supplierStockId),
    registrationPresent: Boolean(normalizeRegistration(registrationCandidate)),
    sourceStatus: clean(item?.status ?? item?.meta?.status, 100) || "unknown",
    vehicleType: clean(item?.vehicle?.type, 100) || "unknown",
    ...extra,
  };
}`,
  "invalid DealerKit record identifiers",
  "registrationCandidate: registrationCandidate || null"
);

patch(
  "../api/_dealerkit-stock-adapter.js",
  `  if (!complete && !allowPartial) {
    throw new DealerKitSnapshotIncompleteError(
      \`DealerKit stock snapshot is incomplete or unstable: \${deduped.vehicles.length} usable records against an initial total of \${total}.\`,
      diagnostics,
    );
  }`,
  `  if (!complete && !allowPartial) {
    const rejectedSummary = invalidRecords.slice(0, 12).map((record) =>
      \`#\${record.position || "?"} id=\${record.supplierStockId || "missing"} reg=\${record.registrationCandidate || "missing"} detail=\${record.detailStatus ?? "n/a"}\`
    ).join("; ");
    throw new DealerKitSnapshotIncompleteError(
      \`DealerKit stock snapshot is incomplete or unstable: \${deduped.vehicles.length} usable records against an initial total of \${total}.\${rejectedSummary ? \` Rejected records: \${rejectedSummary}.\` : ""}\`,
      diagnostics,
    );
  }`,
  "DealerKit incomplete snapshot detail",
  "const rejectedSummary = invalidRecords.slice(0, 12)"
);

console.log("Applied DealerKit image-readiness fail-closed UI, safety-stop monitor classification, and rejected-row diagnostics.");
