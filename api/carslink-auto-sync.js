import { runCarslinkProductionSync } from "../lib/carslinkProductionSync.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";
const PUBLIC_PRODUCTION_ORIGIN = "https://marketing-crm-six.vercel.app";
const PRIMARY_VERCEL_PROJECT_ID = "prj_UA8X61RmObkTDVp8cCkZ5X4oPlHl";

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

function normalizeHost(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .split("/")[0]
    .split(":")[0];
}

function publicOrigin() {
  const configured = String(process.env.MARKETING_CRM_PUBLIC_ORIGIN || "").trim();
  return (configured || PUBLIC_PRODUCTION_ORIGIN).replace(/\/$/, "");
}

function isPrimaryProduction(request) {
  const expectedProjectId = String(
    process.env.CARSLINK_PRIMARY_VERCEL_PROJECT_ID || PRIMARY_VERCEL_PROJECT_ID,
  ).trim();
  const currentProjectId = String(process.env.VERCEL_PROJECT_ID || "").trim();
  if (currentProjectId && expectedProjectId) return currentProjectId === expectedProjectId;

  const primaryHost = normalizeHost(publicOrigin());
  const projectHost = normalizeHost(process.env.VERCEL_PROJECT_PRODUCTION_URL || "");
  if (projectHost) return projectHost === primaryHost;
  return normalizeHost(request.headers.host || "") === primaryHost;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }

  if (!authorize(request)) {
    return response.status(401).json({ ok: false, error: "CarsLink automation access not recognised." });
  }

  // The repository is deployed to more than one Vercel project. Only the public
  // Marketing CRM project may send CarsLink feeds, preventing duplicate cron pushes.
  if (!isPrimaryProduction(request)) {
    return response.status(200).json({
      ok: true,
      sent: false,
      reason: "secondary-project",
      message: "CarsLink automatic sync is owned by the primary Marketing CRM deployment.",
    });
  }

  try {
    const origin = new URL(publicOrigin());
    const result = await runCarslinkProductionSync({
      request: {
        headers: {
          host: origin.host,
          "x-forwarded-proto": origin.protocol.replace(":", ""),
        },
      },
      trigger: "automatic",
      force: false,
    });

    return response.status(200).json(result);
  } catch (error) {
    console.error("[carslink-auto-sync] failed", error);
    return response.status(error?.statusCode || 500).json({
      ok: false,
      error: error?.message || "CarsLink automatic sync failed.",
    });
  }
}
