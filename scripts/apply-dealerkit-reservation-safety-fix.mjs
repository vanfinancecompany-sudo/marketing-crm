import fs from "node:fs";
import { fileURLToPath } from "node:url";

function patchReservationEndpoint(relativePath, nextFunctionName) {
  const targetPath = fileURLToPath(new URL(relativePath, import.meta.url));
  let source = fs.readFileSync(targetPath, "utf8");

  if (!source.includes('from "./_dealerkit-reservation-verification.js"')) {
    const importAnchor = '} from "./_vansco-cache-utils.js";';
    const first = source.indexOf(importAnchor);
    if (first === -1) throw new Error(`DealerKit reservation safety fix could not find import anchor in ${relativePath}.`);
    if (source.indexOf(importAnchor, first + importAnchor.length) !== -1) {
      throw new Error(`DealerKit reservation safety fix found duplicate import anchors in ${relativePath}.`);
    }
    source = source.replace(
      importAnchor,
      `${importAnchor}\nimport { verifyDealerKitReservedRegistration } from "./_dealerkit-reservation-verification.js";`,
    );
  }

  if (!source.includes("return verifyDealerKitReservedRegistration(registration);")) {
    const pattern = new RegExp(
      `async function verifyReservedInVansco\\(registration\\) \\{[\\s\\S]*?\\n\\}\\n\\nasync function ${nextFunctionName}`,
    );
    const matches = source.match(pattern);
    if (!matches) throw new Error(`DealerKit reservation safety fix could not find legacy Vansco reservation guard in ${relativePath}.`);
    source = source.replace(
      pattern,
      `async function verifyReservedInVansco(registration) {\n  return verifyDealerKitReservedRegistration(registration);\n}\n\nasync function ${nextFunctionName}`,
    );
  }

  if (!source.includes("function isMarketingStockWatchAuthorized")) {
    const handlerAnchor = "export default async function handler(request, response) {";
    if (!source.includes(handlerAnchor)) throw new Error(`DealerKit reservation safety fix could not find handler in ${relativePath}.`);
    source = source.replace(
      handlerAnchor,
      `function isMarketingStockWatchAuthorized(request, environment = process.env) {\n  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY).slice(0, 2000);\n  const header = clean(request.headers?.["x-marketing-customer-database-key"]).slice(0, 2000);\n  const authorization = clean(request.headers?.authorization).slice(0, 2200);\n  const bearer = authorization.replace(/^Bearer\\s+/i, "");\n  return Boolean(expected && (header === expected || bearer === expected));\n}\n\n${handlerAnchor}`,
    );
  }

  if (!source.includes('message: "Marketing CRM access is required."')) {
    const cacheAnchor = '  response.setHeader("Cache-Control", "no-store, max-age=0");';
    if (!source.includes(cacheAnchor)) throw new Error(`DealerKit reservation safety fix could not find cache header in ${relativePath}.`);
    source = source.replace(
      cacheAnchor,
      `${cacheAnchor}\n  if (!isMarketingStockWatchAuthorized(request)) {\n    return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });\n  }`,
    );
  }

  fs.writeFileSync(targetPath, source);
}

patchReservationEndpoint("../api/finance-reserved-wix-stock.js", "getWixTask");
patchReservationEndpoint("../api/car-reserved-wix-stock.js", "getWixTask");
patchReservationEndpoint("../api/rent2buy-reserved-wix-stock.js", "unpublishItem");

await import("./apply-dealerkit-production-safety-audit-fixes.mjs");

console.log("Applied DealerKit reservation verification and Marketing access gating to Finance, Cars and Rent2Buy Wix draft actions.");
