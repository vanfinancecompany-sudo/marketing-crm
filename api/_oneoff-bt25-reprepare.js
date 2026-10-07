const ACCESS_HEADER = "x-marketing-customer-database-key";
const REGISTRATION = "BT25LVK";
const ONE_OFF_TOKEN = "bt25-20261007-cb7f3c90";

function clean(value) {
  return String(value ?? "").trim();
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (clean(request.query?.token) !== ONE_OFF_TOKEN) return response.status(404).json({ ok: false, message: "Not found." });

  const key = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  const host = clean(process.env.VERCEL_URL);
  if (!key || !host) return response.status(500).json({ ok: false, message: "Preview environment is not configured for the one-off media repair." });

  const result = await fetch(`https://${host}/api/dealerkit-wix-prepare-media`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      [ACCESS_HEADER]: key,
    },
    body: JSON.stringify({
      registration: REGISTRATION,
      confirmRegistration: REGISTRATION,
      productMode: "finance",
    }),
  });
  const payload = await result.json().catch(() => ({}));
  return response.status(result.status).json({
    ok: result.ok && payload?.ok !== false,
    registration: REGISTRATION,
    mediaOnly: true,
    cmsWritesAttempted: false,
    ready: Boolean(payload?.ready),
    importedCount: Array.isArray(payload?.images) ? payload.images.length : 0,
    pendingCount: Array.isArray(payload?.pending) ? payload.pending.length : 0,
    message: clean(payload?.message) || `Prepare images returned HTTP ${result.status}.`,
  });
}
