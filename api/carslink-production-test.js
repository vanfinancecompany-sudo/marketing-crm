import { runCarslinkProductionSync } from "../lib/carslinkProductionSync.js";

export const config = { maxDuration: 300 };

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }

  if (request.body?.confirmProduction !== true) {
    return response.status(400).json({
      ok: false,
      error: "Production sync not sent. POST with { confirmProduction: true }.",
    });
  }

  try {
    const result = await runCarslinkProductionSync({
      request,
      trigger: "manual",
      force: true,
    });
    return response.status(200).json(result);
  } catch (error) {
    console.error("[carslink-production-sync] failed", error);
    return response.status(error?.statusCode || 500).json({
      ok: false,
      error: error?.message || "CarsLink production sync failed.",
      carslink: error?.carslink,
    });
  }
}
