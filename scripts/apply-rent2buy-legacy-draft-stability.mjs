import fs from "node:fs";
import { fileURLToPath } from "node:url";

const apiUrl = new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url);
const apiSource = fs.readFileSync(fileURLToPath(apiUrl), "utf8");
const legacySiteId = "548f025b-673c-47f7-9bb6-383ab5d946e4";
const financeSiteId = "85f11c52-ee54-495d-aaec-a351831709b5";

if (!apiSource.includes(financeSiteId)) {
  throw new Error("Rent2Buy single-CMS guard: authoritative VAN FINANCE Wix site ID is missing.");
}
if (apiSource.includes(legacySiteId)) {
  throw new Error("Rent2Buy single-CMS guard: historic RENT2BUY VANS Wix site must not be an API authority.");
}
if (!apiSource.includes('authority: "VAN FINANCE Wix Rent2Buy CMS only"')) {
  throw new Error("Rent2Buy single-CMS guard: API authority marker is missing.");
}

// The reserved-stock UI is injected by the previous transform. Keep its copy in
// sync with the single authoritative CMS without reintroducing a second data source.
const pageUrl = new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url);
const pagePath = fileURLToPath(pageUrl);
let pageSource = fs.readFileSync(pagePath, "utf8");

const replacements = [
  ["Read-only first: check this registration across all nine Rent2Buy listing/category collections on both Wix mirrors.", "Read-only first: check this registration across the nine live Rent2Buy listing/category collections in the authoritative VAN FINANCE Wix CMS."],
  ["Checking both Wix sites...", "Checking Rent2Buy CMS..."],
  ["VAN PAGES is HARD PROTECTED on both Wix sites.", "VAN PAGES is HARD PROTECTED in the authoritative Rent2Buy CMS."],
  ["No live listing/category matches remain on either Wix site. VAN PAGES stays protected.", "No live listing/category matches remain in the authoritative Rent2Buy CMS. VAN PAGES stays protected."],
  ["Rechecking both sites...", "Rechecking Rent2Buy CMS..."],
];

for (const [before, after] of replacements) {
  if (pageSource.includes(before)) pageSource = pageSource.replaceAll(before, after);
}

fs.writeFileSync(pagePath, pageSource);
console.log("Confirmed single authoritative Rent2Buy CMS and retired the historic standalone Wix mirror from Stock Watch authority.");
