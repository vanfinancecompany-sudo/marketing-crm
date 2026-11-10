import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Apply LAST, after the existing legacy-to-DealerKit Stock Watch render transforms.
// Never change earlier brittle transform anchors or existing source/price/photo behaviour.
const file = fileURLToPath(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url));
let source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
if (source.includes("DEALERKIT_MILEAGE_WATCH_UI")) process.exit(0);

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error("Mileage UI transform: " + label + " expected once, found " + count + ".");
  source = source.replace(before, after);
}
function changeSection(start, end, update, label) {
  const begin = source.indexOf(start);
  if (begin < 0 || source.indexOf(start, begin + 1) >= 0) throw new Error("Mileage UI: " + label + " start ambiguous.");
  const finish = source.indexOf(end, begin + start.length);
  if (finish < 0) throw new Error("Mileage UI: " + label + " end missing.");
  const original = source.slice(begin, finish);
  const changed = update(original);
  if (!changed || changed === original) throw new Error("Mileage UI: " + label + " was not changed.");
  source = source.slice(0, begin) + changed + source.slice(finish);
}

replaceOnce(
  'import { fetchAdvertisedWixVehicles } from "../services/stockWatchWixListingPresence.js";',
  'import { fetchAdvertisedWixVehicles } from "../services/stockWatchWixListingPresence.js";\nimport { buildMileageDifferences } from "../lib/dealerKitMileageWatch.js";\nimport StockWatchMileageCard from "../components/StockWatchMileageCard.jsx";\n// DEALERKIT_MILEAGE_WATCH_UI',
  "imports",
);
replaceOnce(
  '  { value: "advertised_stock", label: "All advertised stock" },',
  '  { value: "advertised_stock", label: "All advertised stock" },\n  { value: "mileage_difference", label: "Mileage changes" },',
  "new filter",
);
replaceOnce(
  '  const dealerKitByRegistration = useMemo(() => buildDealerKitByRegistration(rawActiveRecords), [rawActiveRecords]);',
  '  const dealerKitByRegistration = useMemo(() => buildDealerKitByRegistration(rawActiveRecords), [rawActiveRecords]);\n  const mileageDifferenceRecords = useMemo(() => buildMileageDifferences(currentRawRecords, activeAdvertisedWixVehicles, selectedPipeline), [currentRawRecords, activeAdvertisedWixVehicles, selectedPipeline]);',
  "mileage diff computation",
);

changeSection('  const displayRecords = useMemo(', '  const summary = useMemo(', (section) => {
  if (!section.includes("...advertisedStockRecords]")) throw new Error("Mileage UI: Wix advertised records anchor missing.");
  let changed = section.replace("...advertisedStockRecords]", "...advertisedStockRecords, ...mileageDifferenceRecords]");
  const last = changed.lastIndexOf("advertisedStockRecords");
  if (last <= 0) throw new Error("Mileage UI: display dependencies missing.");
  changed = changed.slice(0, last) + "mileageDifferenceRecords, " + changed.slice(last);
  return changed;
}, "visible mileage records");

changeSection('  const summary = useMemo(', '  const filterCounts = useMemo(', (section) => {
  if (!section.includes("priceDifference: priceDifferenceRecords.length,")) throw new Error("Mileage UI: summary price anchor absent.");
  let next = section.replace("priceDifference: priceDifferenceRecords.length,", "priceDifference: priceDifferenceRecords.length,\n    mileageDifference: mileageDifferenceRecords.length,");
  const last = next.lastIndexOf("priceDifferenceRecords");
  if (last < 0) throw new Error("Mileage UI: summary dependencies missing.");
  next = next.slice(0, last + "priceDifferenceRecords".length) + ", mileageDifferenceRecords" + next.slice(last + "priceDifferenceRecords".length);
  return next;
}, "mileage summary");

changeSection('  const filterCounts = useMemo(', '  const filteredRecords = useMemo(', (section) => {
  const match = section.match(/(    price_difference: [^\n]+,\n)/);
  if (!match) throw new Error("Mileage UI: price filter count anchor absent.");
  let next = section.replace(match[1], match[1] + "    mileage_difference: summary.mileageDifference,\n");
  if (!next.includes("summary.priceDifference +")) throw new Error("Mileage UI: total count anchor missing.");
  next = next.replace("summary.priceDifference +", "summary.priceDifference + summary.mileageDifference +");
  return next;
}, "mileage filter counts");

changeSection('  const filteredRecords = useMemo(', '  const lastCheckedAt = useMemo(', (section) => {
  const needle = '"price_difference",';
  if (!section.includes(needle)) throw new Error("Mileage UI: action filter missing.");
  return section.replace(needle, needle + ' "mileage_difference",');
}, "mileage search results");

replaceOnce(
  '          <SummaryCard label="All advertised stock"',
  '          <SummaryCard label="Mileage changes" value={summary.mileageDifference} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "mileage_difference" }))} />\n          <SummaryCard label="All advertised stock"',
  "mileage summary card",
);
replaceOnce(
  '        <div className="vansco-watch-note"><strong>All advertised stock:</strong>',
  '        <div className="vansco-watch-note"><strong>Mileage changes:</strong> Compares the live published Wix mileage with DealerKit for the same registration. The approval workflow patches mileage fields only, never images, pricing, stock or offers. Rent2Buy eligibility must be reviewed separately if the mileage affects permitted terms.</div>\n        <div className="vansco-watch-note"><strong>All advertised stock:</strong>',
  "explanatory note",
);
replaceOnce(
  '{filteredRecords.map((record) => ',
  '{filteredRecords.map((record) => record.displayStatus === "mileage_difference" ? <StockWatchMileageCard key={record.id} record={record} onApplied={handleReloadComparison} /> : ',
  "mileage update review card",
);

fs.writeFileSync(file, source);
console.log("Added DealerKit Mileage Changes for Finance, Rent2Buy and Cars after existing Stock Watch UI transforms.");
