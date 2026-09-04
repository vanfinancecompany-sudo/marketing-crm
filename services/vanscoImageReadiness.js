export async function fetchVanscoImageReadiness(pipeline) {
  const normalizedPipeline = String(pipeline || "finance").toLowerCase();
  if (!['finance', 'rent2buy'].includes(normalizedPipeline)) {
    return { ok: true, pipeline: normalizedPipeline, alerts: [], summary: { imageUpdatesReady: 0, complete: true } };
  }

  const response = await fetch(`/api/vansco-image-readiness?pipeline=${encodeURIComponent(normalizedPipeline)}`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Could not load ${normalizedPipeline} image readiness.`);
  }

  return {
    ok: true,
    pipeline: normalizedPipeline,
    alerts: Array.isArray(payload?.alerts) ? payload.alerts : [],
    summary: payload?.summary || {},
  };
}
