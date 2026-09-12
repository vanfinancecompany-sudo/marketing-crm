import fs from "node:fs";
import { fileURLToPath } from "node:url";

function patchReservationAuth(relativePath) {
  const targetPath = fileURLToPath(new URL(relativePath, import.meta.url));
  let source = fs.readFileSync(targetPath, "utf8");

  if (!source.includes("function isMarketingStockWatchAuthorized")) {
    const handlerAnchor = "export default async function handler(request, response) {";
    if (!source.includes(handlerAnchor)) throw new Error(`Reservation auth fix could not find handler in ${relativePath}.`);
    source = source.replace(
      handlerAnchor,
      `function isMarketingStockWatchAuthorized(request, environment = process.env) {\n  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY).slice(0, 2000);\n  const header = clean(request.headers?.["x-marketing-customer-database-key"]).slice(0, 2000);\n  const authorization = clean(request.headers?.authorization).slice(0, 2200);\n  const bearer = authorization.replace(/^Bearer\\s+/i, "");\n  return Boolean(expected && (header === expected || bearer === expected));\n}\n\n${handlerAnchor}`,
    );
  }

  if (!source.includes('message: "Marketing CRM access is required."')) {
    const cacheAnchor = '  response.setHeader("Cache-Control", "no-store, max-age=0");';
    if (!source.includes(cacheAnchor)) throw new Error(`Reservation auth fix could not find cache header in ${relativePath}.`);
    source = source.replace(
      cacheAnchor,
      `${cacheAnchor}\n  if (!isMarketingStockWatchAuthorized(request)) {\n    return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });\n  }`,
    );
  }

  fs.writeFileSync(targetPath, source);
}

patchReservationAuth("../api/finance-reserved-wix-stock.js");
patchReservationAuth("../api/rent2buy-reserved-wix-stock.js");
patchReservationAuth("../api/car-reserved-wix-stock.js");

console.log("Applied Marketing CRM authentication to Finance, Rent2Buy and Cars reservation Wix Stock Watch actions.");
