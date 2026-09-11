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
