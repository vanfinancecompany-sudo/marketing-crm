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

  // Reuse the tested sandbox mapping, but do not mutate Vercel's request object.
  // Some request properties are read-only in the runtime, which caused the first
  // production test to fail before the Carslink call was made.
  const productionRequest = {
    method: "POST",
    query: { ...(request.query || {}), limit: "5" },
    body: { ...(request.body || {}), limit: 5, confirmSandbox: true },
  };

  const previousSandboxKey = process.env.CARSLINK_SANDBOX_API_KEY;
  process.env.CARSLINK_SANDBOX_API_KEY = productionKey;

  try {
    return await sandboxHandler(productionRequest, response);
  } catch (error) {
    console.error("[carslink-production-test] failed", error);
    if (!response.headersSent) {
      return response.status(500).json({
        ok: false,
        error: error?.message || "Carslink production test failed.",
      });
    }
    throw error;
  } finally {
    if (previousSandboxKey === undefined) {
      delete process.env.CARSLINK_SANDBOX_API_KEY;
    } else {
      process.env.CARSLINK_SANDBOX_API_KEY = previousSandboxKey;
    }
  }
}
