const RUN_KEY = "run-worker-20260821-1410";
const PUBLIC_ORIGIN = "https://marketing-crm-six.vercel.app";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }
  if (String(request.query?.run || "") !== RUN_KEY) {
    response.status(404).json({ ok: false });
    return;
  }

  const key = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "").trim();
  if (!key) {
    response.status(500).json({ ok: false, error: "Marketing server key missing." });
    return;
  }

  try {
    const workerResponse = await fetch(`${PUBLIC_ORIGIN}/api/buffer-facebook-automation-worker`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-marketing-customer-database-key": key,
      },
    });
    const text = await workerResponse.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    response.status(200).json({
      ok: workerResponse.ok && payload?.ok !== false,
      workerHttpStatus: workerResponse.status,
      worker: payload,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error?.message || String(error),
    });
  }
}
