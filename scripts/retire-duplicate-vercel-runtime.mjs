import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DUPLICATE_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const projectId = String(process.env.VERCEL_PROJECT_ID || "").trim();

if (projectId !== DUPLICATE_PROJECT_ID) {
  console.log("Primary/non-duplicate Vercel project detected; cron handlers remain unchanged.");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cronHandlers = [
  "api/vansco-cache-live-refresh.js",
  "api/stock-watch-monitor-agent.js",
  "api/marketing-template-campaign-send-orphan-worker.js",
  "api/marketing-template-campaign-send-worker.js",
  "api/sync-finance-stock.js",
  "api/sync-rent2buy-stock.js",
  "api/buffer-facebook-automation-cron.js",
  "api/buffer-instagram-mirror.js",
  "api/marketing-editorial-automation-worker-routed.js",
  "api/buffer-facebook-story-automation.js",
  "api/rent2buy-monthly-price-sync.js",
  "api/buffer-publish-status.js",
  "api/carslink-auto-sync.js",
];

const retiredHandler = `export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Retired-Duplicate-Project", "1");
  return response.status(204).end();
}
`;

for (const relativePath of cronHandlers) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Duplicate-project retirement could not find ${relativePath}`);
  }
  fs.writeFileSync(filePath, retiredHandler, "utf8");
}

console.log(`Retired ${cronHandlers.length} cron/runtime handlers for duplicate Vercel project ${DUPLICATE_PROJECT_ID}.`);
