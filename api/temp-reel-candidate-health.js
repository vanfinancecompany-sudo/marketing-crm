function safe(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function baseUrl(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || process.env.VERCEL_URL || "").trim();
  return `${host.includes("localhost") ? "http" : "https"}://${host}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const key = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "").trim();
    if (!key) return res.status(200).json({ ok: false, stage: "config", error: "marketing key missing" });
    const response = await fetch(`${baseUrl(req)}/api/youtube-daily-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-marketing-customer-database-key": key,
      },
      body: JSON.stringify({ action: "candidates" }),
    });
    const payload = await response.json().catch(() => ({}));
    return res.status(200).json({
      ok: response.ok && payload?.ok !== false,
      stage: "candidates",
      status: response.status,
      payloadOk: payload?.ok,
      error: safe(payload?.error || payload?.message || ""),
      financeCount: Array.isArray(payload?.finance) ? payload.finance.length : null,
      rent2buyCount: Array.isArray(payload?.rent2buy) ? payload.rent2buy.length : null,
    });
  } catch (error) {
    return res.status(200).json({ ok: false, stage: "exception", error: safe(error?.message || error) });
  }
}
