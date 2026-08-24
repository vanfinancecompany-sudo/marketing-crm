import { loadCarslinkSyncStatus } from "../lib/carslinkSyncState.js";

function nextHourlyCheck(now = new Date()) {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  if (next.getUTCMinutes() >= 47) next.setUTCHours(next.getUTCHours() + 1);
  next.setUTCMinutes(47);
  return next.toISOString();
}

function refreshDueAt(lastSuccessAt) {
  if (!lastSuccessAt) return null;
  const value = new Date(lastSuccessAt).getTime();
  if (!Number.isFinite(value)) return null;
  return new Date(value + 12 * 60 * 60 * 1000).toISOString();
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }

  try {
    const status = await loadCarslinkSyncStatus();
    const configured = Boolean(String(process.env.CARSLINK_PRODUCTION_API_KEY || "").trim());
    const lastSuccessMs = status?.lastSuccessAt ? new Date(status.lastSuccessAt).getTime() : 0;
    const ageMs = lastSuccessMs ? Date.now() - lastSuccessMs : Number.POSITIVE_INFINITY;
    const healthy = Boolean(
      configured &&
      status?.state !== "error" &&
      lastSuccessMs &&
      ageMs < 18 * 60 * 60 * 1000,
    );

    return response.status(200).json({
      ok: true,
      configured,
      automaticEnabled: true,
      healthy,
      schedule: {
        checkEveryMinutes: 60,
        changeDetection: true,
        forceRefreshHours: 12,
        nextCheckAt: nextHourlyCheck(),
        refreshDueAt: refreshDueAt(status?.lastSuccessAt),
      },
      status,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: error?.message || "Could not load CarsLink sync status.",
    });
  }
}
