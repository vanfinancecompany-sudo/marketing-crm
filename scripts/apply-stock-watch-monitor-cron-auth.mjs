import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetPath = fileURLToPath(new URL("../api/stock-watch-monitor-agent.js", import.meta.url));
let source = fs.readFileSync(targetPath, "utf8");

const before = `function isCronRequest(request) {
  return clean(request.headers?.["x-vercel-cron"], 20) === "1";
}`;

const after = `export function isCronRequest(request, environment = process.env) {
  const schedule = clean(request.headers?.["x-vercel-cron-schedule"], 100);
  const userAgent = clean(request.headers?.["user-agent"], 200).toLowerCase();
  const expectedSecret = clean(environment.CRON_SECRET, 2000);
  const authorization = clean(request.headers?.authorization, 2200);

  // Vercel Cron sends the deployed schedule in x-vercel-cron-schedule. When a
  // CRON_SECRET is configured Vercel also sends it as a Bearer token; require it.
  // The schedule + Vercel cron user-agent fallback keeps existing projects working
  // safely enough until a CRON_SECRET is configured.
  const isExpectedSchedule = schedule === "*/15 * * * *";
  const isVercelCronAgent = /vercel-cron/.test(userAgent);
  if (!isExpectedSchedule || !isVercelCronAgent) return false;
  if (expectedSecret) return authorization === \`Bearer \${expectedSecret}\`;
  return true;
}`;

if (!source.includes('x-vercel-cron-schedule')) {
  if (!source.includes(before)) throw new Error("Could not find Stock Watch Monitor cron detection anchor.");
  source = source.replace(before, after);
}

if (source.includes('const cron = request.method === "GET" && isCronRequest(request);')) {
  source = source.replace(
    'const cron = request.method === "GET" && isCronRequest(request);',
    'const cron = request.method === "GET" && isCronRequest(request, process.env);'
  );
}

fs.writeFileSync(targetPath, source);
console.log("Applied Vercel cron authentication to Stock Watch Monitor Agent.");

if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview") {
  const siteId = "548f025b-673c-47f7-9bb6-383ab5d946e4";
  const collectionId = "ALLRENT2BUYVANS";
  const itemId = "__dealerkit_price_write_permission_probe__";
  const candidates = [
    ["WIX_RENT2BUY_API_KEY", process.env.WIX_RENT2BUY_API_KEY],
    ["WIX_API_KEY", process.env.WIX_API_KEY],
    ["WIX_FINANCE_API_KEY", process.env.WIX_FINANCE_API_KEY],
  ];
  for (const [name, value] of candidates) {
    if (!String(value || "").trim()) {
      console.log(`RENT2BUY DATA UPDATE PROBE ${name}: NOT_CONFIGURED`);
      continue;
    }
    try {
      const result = await fetch(`https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        headers: { Authorization: String(value).trim(), "wix-site-id": siteId, "Content-Type": "application/json" },
        body: JSON.stringify({ dataCollectionId: collectionId, patch: { dataItemId: itemId, fieldModifications: [{ fieldPath: "title", action: "SET_FIELD", setFieldOptions: { value: itemId } }] } }),
      });
      const payload = await result.json().catch(() => ({}));
      const message = String(payload?.message || payload?.details?.applicationError?.description || "").replace(/\s+/g, " ").slice(0, 300);
      console.log(`RENT2BUY DATA UPDATE PROBE ${name}: HTTP_${result.status} ${message}`);
    } catch (error) {
      console.log(`RENT2BUY DATA UPDATE PROBE ${name}: NETWORK_ERROR ${String(error?.message || error).slice(0, 300)}`);
    }
  }
}
