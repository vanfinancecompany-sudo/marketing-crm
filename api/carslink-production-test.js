import sandboxHandler from "./carslink-sandbox-sync.js";

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

  // Reuse the already-tested sandbox payload builder and mapping logic, but inject
  // the production key only for this request. Production is currently empty, so
  // full_replace with a five-vehicle batch is a safe controlled first live test.
  const previousSandboxKey = process.env.CARSLINK_SANDBOX_API_KEY;
  process.env.CARSLINK_SANDBOX_API_KEY = productionKey;

  request.query = { ...(request.query || {}), limit: "5" };
  request.body = { ...(request.body || {}), confirmSandbox: true };

  try {
    return await sandboxHandler(request, response);
  } finally {
    if (previousSandboxKey === undefined) {
      delete process.env.CARSLINK_SANDBOX_API_KEY;
    } else {
      process.env.CARSLINK_SANDBOX_API_KEY = previousSandboxKey;
    }
  }
}
