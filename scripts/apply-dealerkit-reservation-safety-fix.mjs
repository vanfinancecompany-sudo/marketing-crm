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

  fs.writeFileSync(targetPath, source);
}

patchReservationEndpoint("../api/finance-reserved-wix-stock.js", "getWixTask");
patchReservationEndpoint("../api/car-reserved-wix-stock.js", "getWixTask");
patchReservationEndpoint("../api/rent2buy-reserved-wix-stock.js", "unpublishItem");

await import("./apply-dealerkit-vat-publishing-fix.mjs");
await import("./apply-dealerkit-production-safety-audit-fixes.mjs");

console.log("Applied DealerKit reservation safety verification to Finance, Cars and Rent2Buy Wix draft actions.");
