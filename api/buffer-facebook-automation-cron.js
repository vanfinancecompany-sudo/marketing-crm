const ACCESS_HEADER = "x-marketing-customer-database-key";
const PUBLIC_PRODUCTION_ORIGIN = "https://marketing-crm-six.vercel.app";
const RETRY_DELAY_MS = 1500;
const MAX_ATTEMPTS = 2;
const TRANSIENT_REEL_ERROR = /terminated|fetch failed|und_err_socket|socket|other side closed|econnreset|network/i;

export const config = { maxDuration: 300 };

function authorize(request) {
  const cronSecret = String(process.env.CRON_SECRET || "");
  const marketingKey = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "");
  const authorization = String(request.headers.authorization || "");
  const supplied = String(request.headers[ACCESS_HEADER] || "");
  return Boolean(
    (cronSecret && authorization === `Bearer ${cronSecret}`) ||
    (marketingKey && (supplied === marketingKey || authorization === `Bearer ${marketingKey}`)),
  );
}

function publicOrigin() {
  const configured = String(process.env.MARKETING_CRM_PUBLIC_ORIGIN || "").trim();
  return (configured || PUBLIC_PRODUCTION_ORIGIN).replace(/\/$/, "");
}

function errorText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function reelErrors(payload = {}) {
  return ["vanFinance", "rent2buy"].flatMap((productKey) => {
    const message = errorText(payload?.results?.[productKey]?.video?.error).trim();
    return message ? [{ productKey, message }] : [];
  });
}

function transientErrors(payload = {}) {
  return reelErrors(payload).filter((item) => TRANSIENT_REEL_ERROR.test(item.message));
}

async function runWorker() {
  const key = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "").trim();
  if (!key) throw new Error("MARKETING_CUSTOMER_DATABASE_API_KEY is required for Buffer automation.");

  const workerResponse = await fetch(`${publicOrigin()}/api/buffer-facebook-automation-worker`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      [ACCESS_HEADER]: key,
    },
  });
  const raw = await workerResponse.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { ok: false, error: raw || `Worker returned HTTP ${workerResponse.status}.` };
  }
  return { workerResponse, payload };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, error: "Automation access not recognised." });
  }

  const attempts = [];
  let lastPayload = null;
  let lastHttpStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const { workerResponse, payload } = await runWorker();
      lastPayload = payload;
      lastHttpStatus = workerResponse.status;
      const errors = reelErrors(payload);
      const retryable = transientErrors(payload);
      attempts.push({
        attempt,
        workerHttpStatus: workerResponse.status,
        reelErrors: errors,
      });

      if (workerResponse.ok && retryable.length === 0) break;
      if (attempt >= MAX_ATTEMPTS || retryable.length === 0) break;

      console.warn("[buffer-facebook-cron] retrying transient Reel failure", {
        attempt,
        errors: retryable,
      });
      await wait(RETRY_DELAY_MS);
    } catch (error) {
      const message = errorText(error) || "Buffer automation worker request failed.";
      attempts.push({ attempt, workerHttpStatus: 0, reelErrors: [{ productKey: "worker", message }] });
      if (attempt >= MAX_ATTEMPTS || !TRANSIENT_REEL_ERROR.test(message)) {
        lastPayload = { ok: false, error: message };
        break;
      }
      console.warn("[buffer-facebook-cron] retrying worker transport failure", { attempt, message });
      await wait(RETRY_DELAY_MS);
    }
  }

  const finalReelErrors = reelErrors(lastPayload || {});
  const workerOk = lastHttpStatus >= 200 && lastHttpStatus < 300 && lastPayload?.ok !== false;
  const ok = workerOk && finalReelErrors.length === 0;

  if (!ok) {
    console.error("[buffer-facebook-cron] automation finished with unresolved errors", {
      workerHttpStatus: lastHttpStatus,
      reelErrors: finalReelErrors,
      attempts: attempts.length,
    });
  }

  return response.status(ok ? 200 : 207).json({
    ok,
    attempts,
    workerHttpStatus: lastHttpStatus,
    finalReelErrors,
    worker: lastPayload,
  });
}
