import fs from "node:fs";
const path = "pages/VanscoStockWatchPage.jsx";
let source = fs.readFileSync(path, "utf8");
if (source.includes("// DEALERKIT_SOLD_REVIEW_UI")) process.exit(0);
function replace(from, to, step) {
  if (!source.includes(from)) throw new Error("Sold review UI transform anchor missing: " + step);
  source = source.replace(from, to);
}
replace(
  'import StockWatchMileageCard from "../components/StockWatchMileageCard.jsx";',
  'import StockWatchMileageCard from "../components/StockWatchMileageCard.jsx";\nimport { isSoldRemovalReview } from "../lib/dealerKitPublicAvailability.mjs";\n// DEALERKIT_SOLD_REVIEW_UI',
  "imports"
);
replace(
  '  { value: "reserved", label: "Reserved on DealerKit" },',
  '  { value: "reserved", label: "Reserved on DealerKit" },\n  { value: "sold", label: "Sold / Removal Review" },',
  "filter"
);
replace(
  '  if (!registration) return { ...baseRecord, displayStatus: "hidden_no_registration", matchStatus: "hidden_no_registration" };',
  '  if (!registration) return { ...baseRecord, displayStatus: "hidden_no_registration", matchStatus: "hidden_no_registration" };\n  if (isSoldRemovalReview(baseRecord)) return { ...baseRecord, displayStatus: "sold", matchStatus: "sold_or_removed_review" };\n  if (["sold", "awaiting_delivery", "removed_from_dealerkit"].includes(String(baseRecord.sourceLifecycleStatus || "").toLowerCase()) && (isTemporaryHiddenStatus(workflowStatus) || isNeverShowStatus(workflowStatus))) return { ...baseRecord, displayStatus: "hidden", matchStatus: "sold_review_dismissed" };',
  "classification"
);
replace(
  '    case "reserved": return "Reserved on DealerKit";',
  '    case "reserved": return "Reserved on DealerKit";\n    case "sold": return "Sold / Removal Review";',
  "badge label"
);
replace(
  '    reserved: activeRecords.filter((record) => record.displayStatus === "reserved").length,',
  '    reserved: activeRecords.filter((record) => record.displayStatus === "reserved").length,\n    sold: activeRecords.filter((record) => record.displayStatus === "sold").length,',
  "summary"
);
replace(
  '    reserved: summary.reserved,',
  '    reserved: summary.reserved,\n    sold: summary.sold,',
  "filter count"
);
replace(
  'summary.advertised + summary.reserved + summary.backInStock',
  'summary.advertised + summary.reserved + summary.sold + summary.backInStock',
  "all count"
);
replace(
  '"advertised", "reserved", "back_in_stock"',
  '"advertised", "reserved", "sold", "back_in_stock"',
  "filterable statuses"
);
replace(
  '          <SummaryCard label="Back in stock / Review hidden"',
  '          <SummaryCard label="Sold / Removal Review" value={summary.sold} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "sold" }))} />\n          <SummaryCard label="Back in stock / Review hidden"',
  "summary card"
);
replace(
  '        {isLocalNotVansco ? <div className="vehicle-card__meta">Advisory only: check whether this van has sold or needs removing from your website stock.</div> : null}',
  '        {record.displayStatus === "sold" ? <div className="vehicle-card__meta"><strong>Sold / removal review:</strong> DealerKit no longer confirms this vehicle as available. Check the live Wix advert and remove it manually. The existing Hide control records your review in Stock Watch; it does not change Wix publication.</div> : null}\n        {isLocalNotVansco ? <div className="vehicle-card__meta">Advisory only: check whether this van has sold or needs removing from your website stock.</div> : null}',
  "manual removal note"
);
replace(
  '        <div className="vansco-watch-note"><strong>All advertised stock:</strong>',
  '        <div className="vansco-watch-note"><strong>Sold / Removal Review:</strong> DealerKit confirmed Sold, Awaiting Delivery, or a verified removal. Customer applications must stop. Review the live advert and manually remove it in Wix; Hide only records a Stock Watch decision.</div>\n        <div className="vansco-watch-note"><strong>All advertised stock:</strong>',
  "workflow description"
);
fs.writeFileSync(path, source);
console.log("Added separate Sold / Removal Review cards across Finance Vans, Rent2Buy and Cars.");
