// Legacy export name retained because the Stock Watch build transform imports it.
// The implementation is DealerKit-backed after the supplier migration.
export async function fetchVanscoImageReadiness(pipeline) {
  const normalizedPipeline = String(pipeline || "finance").toLowerCase();
  if (!["finance", "rent2buy", "cars"].includes(normalizedPipeline)) {
    return { ok: true, pipeline: normalizedPipeline, alerts: [], summary: { imageUpdatesReady: 0, complete: true, sourceAvailable: true } };
  }

  const response = await fetch(`/api/dealerkit-image-readiness?pipeline=${encodeURIComponent(normalizedPipeline)}`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.message || `Could not load ${normalizedPipeline} DealerKit image readiness.`);
    error.summary = payload?.summary || { complete: false, sourceAvailable: false };
    error.diagnostics = payload?.diagnostics || null;
    throw error;
  }

  return {
    ok: true,
    pipeline: normalizedPipeline,
    alerts: Array.isArray(payload?.alerts) ? payload.alerts : [],
    summary: payload?.summary || {},
  };
}
