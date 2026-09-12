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
  "../api/_vansco-cache-utils.js",
  String.raw`const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;`,
  String.raw`const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[A-Z]{1,3}\s?[0-9]{1,4}|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;`,
  "dateless registration extraction",
  String.raw`|[A-Z]{1,3}\s?[0-9]{1,4}|`
);

patch(
  "../api/_vansco-cache-utils.js",
  String.raw`const LEGACY_REG_PATTERN = /^(?:[A-Z][0-9]{1,3}[A-Z]{3}|[A-Z]{3}[0-9]{1,3}[A-Z]|[0-9]{1,4}[A-Z]{1,3})$/i;`,
  String.raw`const LEGACY_REG_PATTERN = /^(?:[A-Z][0-9]{1,3}[A-Z]{3}|[A-Z]{3}[0-9]{1,3}[A-Z]|[A-Z]{1,3}[0-9]{1,4}|[0-9]{1,4}[A-Z]{1,3})$/i;`,
  "dateless registration validation",
  String.raw`|[A-Z]{1,3}[0-9]{1,4}|`
);

patch(
  "../pages/VanscoStockWatchPage.jsx",
  'value={summary.imagesReady} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "images_ready" }))}',
  'value={imageReadyError || (imageReadySummary && imageReadySummary.sourceAvailable === false) ? "Unavailable" : summary.imagesReady} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "images_ready" }))}',
  "image readiness unavailable summary value",
  'value={imageReadyError || (imageReadySummary && imageReadySummary.sourceAvailable === false) ? "Unavailable" : summary.imagesReady}'
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
  "../api/_stock-watch-monitor.js",
  'evidence: { failed, succeeded, remaining: refresh.remaining, error: refresh.error, progressAgeMinutes: Number(progressAgeMinutes.toFixed(1)) },',
  'evidence: { failed, succeeded, remaining: refresh.remaining, error: refresh.error, progressAgeMinutes: Number(progressAgeMinutes.toFixed(1)), diagnostics: provider.diagnostics || snapshot.providerDiagnostics || null },',
  "degraded provider diagnostics evidence",
  "diagnostics: provider.diagnostics || snapshot.providerDiagnostics || null"
);

patch(
  "../api/_stock-source-provider.js",
  `export async function loadStockSourceSnapshot({
  supabase = null,
  environment = process.env,
  fetchImplementation = fetch,
} = {}) {`,
  `export async function loadStockSourceSnapshot({
  supabase = null,
  environment = process.env,
  fetchImplementation = fetch,
  allowPartial = false,
} = {}) {`,
  "provider partial-read option",
  "return fetchDealerKitStockSnapshot({ environment, fetchImplementation, allowPartial });"
);

patch(
  "../api/_stock-source-provider.js",
  'return fetchDealerKitStockSnapshot({ environment, fetchImplementation, allowPartial: false });',
  'return fetchDealerKitStockSnapshot({ environment, fetchImplementation, allowPartial });',
  "provider partial-read passthrough",
  'return fetchDealerKitStockSnapshot({ environment, fetchImplementation, allowPartial });'
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
    try {
      provider = await loadStockSourceSnapshot({ supabase, environment, fetchImplementation, allowPartial: true });
      providerDiagnostics = provider?.diagnostics && typeof provider.diagnostics === "object" ? provider.diagnostics : null;
    } catch (error) {
      providerError = clean(error?.message || error, 2000);
      providerDiagnostics = error?.diagnostics && typeof error.diagnostics === "object" ? error.diagnostics : null;
    }`,
  "provider diagnostic capture and degraded monitor read",
  "allowPartial: true });\n      providerDiagnostics = provider?.diagnostics"
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
  `async function requestJson(url, secret, fetchImplementation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: \`Bearer \${secret}\`,
        "user-agent": "VFC-DealerKit-Stock-Adapter/1.0",
      },
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    return { ok: response.ok, status: response.status, payload, responseBytes: text.length };
  } finally {
    clearTimeout(timeout);
  }
}`,
  `const DEALERKIT_REQUEST_ATTEMPTS = 3;
const TRANSIENT_DEALERKIT_STATUSES = new Set([500, 502, 503, 504]);

function retryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, attempt * 50));
}

async function requestJson(url, secret, fetchImplementation) {
  let lastResult = null;
  for (let attempt = 1; attempt <= DEALERKIT_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let shouldRetry = false;
    try {
      const response = await fetchImplementation(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: \`Bearer \${secret}\`,
          "user-agent": "VFC-DealerKit-Stock-Adapter/1.0",
        },
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      const result = { ok: response.ok, status: response.status, payload, responseBytes: text.length };
      lastResult = result;
      shouldRetry = TRANSIENT_DEALERKIT_STATUSES.has(response.status) && attempt < DEALERKIT_REQUEST_ATTEMPTS;
      if (!shouldRetry) return result;
    } finally {
      clearTimeout(timeout);
    }
    await retryDelay(attempt);
  }
  return lastResult;
}`,
  "transient DealerKit retries",
  "const DEALERKIT_REQUEST_ATTEMPTS = 3;"
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

patch(
  "../api/dealerkit-image-readiness.js",
  'fetchDealerKitStockSnapshot({ allowPartial: false }),',
  'fetchDealerKitStockSnapshot({ allowPartial: true }),',
  "image readiness degraded source read",
  'fetchDealerKitStockSnapshot({ allowPartial: true })'
);

patch(
  "../api/dealerkit-image-readiness.js",
  `    if (!dealerKitSnapshot.complete) {
      return response.status(503).json({
        ok: false,
        pipeline,
        sourceAvailable: false,
        message: "DealerKit returned an incomplete stock snapshot, so image readiness is unavailable until the source is healthy.",
        summary: { imageUpdatesReady: 0, complete: false, sourceAvailable: false },
        diagnostics: dealerKitSnapshot.diagnostics || {},
      });
    }`,
  `    const sourceDegraded = dealerKitSnapshot.complete === false;`,
  "image readiness partial snapshot handling",
  "const sourceDegraded = dealerKitSnapshot.complete === false;"
);

patch(
  "../api/dealerkit-image-readiness.js",
  `      ok: true,
      pipeline,
      sourceAvailable: true,
      alerts,`,
  `      ok: true,
      pipeline,
      sourceAvailable: true,
      degraded: sourceDegraded,
      diagnostics: sourceDegraded ? dealerKitSnapshot.diagnostics : undefined,
      alerts,`,
  "image readiness degraded response",
  "degraded: sourceDegraded,"
);

patch(
  "../api/dealerkit-image-readiness.js",
  `        complete: true,
        sourceAvailable: true,`,
  `        complete: !sourceDegraded,
        degraded: sourceDegraded,
        sourceAvailable: true,`,
  "image readiness degraded summary",
  "complete: !sourceDegraded,"
);

console.log("Applied DealerKit retries, degraded-source image readiness/monitor safety, dateless registrations, safety-stop classification, and rejected-row diagnostics.");