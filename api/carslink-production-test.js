const CARSLINK_ENDPOINT = "https://api.carslink.ai/api/v1/stock";

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

  const productionKey = String(process.env.CARSLINK_PRODUCTION_API_KEY || "").trim();
  if (!productionKey) {
    return response.status(503).json({
      ok: false,
      error: "CARSLINK_PRODUCTION_API_KEY is not configured in the deployment environment.",
    });
  }

  try {
    const protocol = request.headers?.["x-forwarded-proto"] || "https";
    const host = request.headers?.host;
    if (!host) throw new Error("Unable to determine deployment host for Carslink payload preview.");

    const previewUrl = `${protocol}://${host}/api/carslink-sandbox-sync?limit=5`;
    const previewResponse = await fetch(previewUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const preview = await previewResponse.json().catch(() => ({}));

    if (!previewResponse.ok) {
      throw new Error(preview?.error || `Carslink payload preview returned HTTP ${previewResponse.status}.`);
    }

    const payload = preview?.payload;
    const listings = Array.isArray(payload?.listings) ? payload.listings : [];
    if (!payload || listings.length < 1) {
      return response.status(422).json({
        ok: false,
        error: "No valid listings were available for the Carslink production test.",
        local_skipped: preview?.skipped || [],
      });
    }

    const carslinkResponse = await fetch(CARSLINK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${productionKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const carslink = await carslinkResponse.json().catch(() => ({}));

    if (!carslinkResponse.ok) {
      return response.status(carslinkResponse.status).json({
        ok: false,
        error: carslink?.message || carslink?.error || `Carslink returned HTTP ${carslinkResponse.status}.`,
        carslink,
        local_skipped: preview?.skipped || [],
      });
    }

    return response.status(200).json({
      ok: true,
      environment: "production",
      sent_count: listings.length,
      local_skipped: preview?.skipped || [],
      carslink,
    });
  } catch (error) {
    console.error("[carslink-production-test] failed", error);
    return response.status(500).json({
      ok: false,
      error: error?.message || "Carslink production test failed.",
    });
  }
}
