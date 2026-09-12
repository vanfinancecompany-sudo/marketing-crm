import fs from "node:fs";
import { fileURLToPath } from "node:url";

function patchFile(relativePath, before, after, already, label) {
  const targetPath = fileURLToPath(new URL(relativePath, import.meta.url));
  let source = fs.readFileSync(targetPath, "utf8");
  if (already && source.includes(already)) return;
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Production safety audit fix could not find ${label} in ${relativePath}.`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Production safety audit fix found duplicate ${label} anchor in ${relativePath}.`);
  }
  source = source.replace(before, after);
  fs.writeFileSync(targetPath, source);
}

patchFile(
  "../api/dealerkit-published-price.js",
  `  const retailPrice = parseRetailPrice(body.retail_price);\n  if (retailPrice === null || retailPrice < 1000 || retailPrice > 100000) throw new ApiError(400, "The DealerKit retail price is outside the permitted range.");\n  if (pipeline === "rent2buy" && !Number.isFinite(Number(body.mileage))) throw new ApiError(400, "DealerKit mileage is required to recalculate Rent2Buy pricing.");\n  return {\n    registration,\n    retailPrice,\n    mileage: Number.isFinite(Number(body.mileage)) ? Number(body.mileage) : null,\n    vatStatus: clean(body.vat_status || body.vatStatus, 80) || "unknown",\n    supplierStockId: "",\n    sourceMode: "saved_dealerkit_snapshot",\n  };`,
  `  throw new ApiError(409, "DealerKit stock identity is missing from this price card. Refresh Stock Watch before previewing or updating Wix prices.");`,
  "DealerKit stock identity is missing from this price card",
  "saved DealerKit price snapshot fallback",
);

patchFile(
  "../lib/dealerKitCarWixPlan.js",
  `  if (vehicle.sourceUpdatedAt && decision.reviewedSourceUpdatedAt && new Date(vehicle.sourceUpdatedAt).getTime() !== new Date(decision.reviewedSourceUpdatedAt).getTime()) blockers.push({ code: "stale_review", message: "DealerKit changed after the saved Cars review. Re-save the review first." });`,
  `  if (vehicle.sourceUpdatedAt && (!decision.reviewedSourceUpdatedAt || new Date(vehicle.sourceUpdatedAt).getTime() !== new Date(decision.reviewedSourceUpdatedAt).getTime())) blockers.push({ code: "stale_review", message: "DealerKit changed after the saved Cars review, or the saved review has no DealerKit source version. Re-save the review first." });`,
  "saved review has no DealerKit source version",
  "Cars stale review guard",
);

console.log("Applied production safety audit fixes: exact DealerKit identity required for price writes and Cars reviews fail closed without a reviewed source version.");
