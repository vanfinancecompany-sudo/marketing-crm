import fs from "node:fs";
const path = "pages/VanscoStockWatchPage.jsx";
let source = fs.readFileSync(path, "utf8");
if (source.includes("// DEALERKIT_SOLD_REVIEW_UI")) process.exit(0);
function replace(from, to, step) {
  if (!source.includes(from)) throw new Error("Sold review UI transform anchor missing: " + step);
  source = source.replace(from, to);
}
function replaceInWatchCard(from, to, step) {
  const start = source.indexOf("function WatchCard(");
  const end = source.indexOf("async function fetchLocalVehiclesForPipeline", start);
  if (start < 0 || end < start) throw new Error("Sold review WatchCard boundary missing: " + step);
  const prefix = source.slice(0, start);
  const component = source.slice(start, end);
  if (!component.includes(from) || component.indexOf(from) !== component.lastIndexOf(from)) {
    throw new Error("Sold review WatchCard unique anchor missing: " + step);
  }
  source = prefix + component.replace(from, to) + source.slice(end);
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
replace("import { isSoldRemovalReview } from \"../lib/dealerKitPublicAvailability.mjs\";", "import { isSoldRemovalReview } from \"../lib/dealerKitPublicAvailability.mjs\";\nimport { removeSoldWixStock } from \"../services/soldWixRemoval.js\";", "Sold Wix service import");
replace("  const displayRecords = useMemo(", "  const soldReviewRecords = useMemo(() => {\n    if (advertisedStockErrorByPipeline[selectedPipeline]) return [];\n    const liveByReg = new Map(activeAdvertisedWixVehicles\n      .filter(vehicle => vehicle.publishStatus === \"PUBLISHED\" && vehicle.wixItemId && vehicle.collection_id)\n      .map(vehicle => [normalizeWatchRegistration(vehicle.registration), vehicle]));\n    return activeRecords.filter(record => record.displayStatus === \"sold\").flatMap(record => {\n      const advert = liveByReg.get(normalizeWatchRegistration(record.registration));\n      return advert ? [{\n        ...record, wixItemId: advert.wixItemId, wixCollectionId: advert.collection_id,\n        wixPublishStatus: advert.publishStatus,\n        localStockUrl: advert.advertUrl || \"\", currentWixAdvert: advert,\n      }] : [];\n    });\n  }, [activeRecords, activeAdvertisedWixVehicles, advertisedStockErrorByPipeline, selectedPipeline]);\n  const displayRecords = useMemo(", "Sold cards require Wix published main stock");
// Preserve any other Stock Watch card workstreams added by earlier build transformations.
const displayStart = source.indexOf("  const displayRecords = useMemo(");
const displayEnd = source.indexOf("  const summary = useMemo(", displayStart);
if (displayStart < 0 || displayEnd < 0) throw new Error("Sold review cannot find Stock Watch display memo");
const originalDisplay = source.slice(displayStart, displayEnd);
if (!originalDisplay.includes("...activeRecords")) throw new Error("Sold review cannot locate active Stock Watch records");
const updatedDisplay = originalDisplay
  .replace("...activeRecords", '...activeRecords.filter(record => record.displayStatus !== "sold"), ...soldReviewRecords')
  .replace("[activeRecords,", "[activeRecords, soldReviewRecords,");
source = source.slice(0, displayStart) + updatedDisplay + source.slice(displayEnd);
replace("sold: activeRecords.filter((record) => record.displayStatus === \"sold\").length,", "sold: soldReviewRecords.length,", "Sold count");
const summaryStart = source.indexOf("  const summary = useMemo(");
const summaryEnd = source.indexOf("  const filterCounts = useMemo(", summaryStart);
if (summaryStart < 0 || summaryEnd < 0) throw new Error("Sold review cannot find summary memo");
const summaryBlock = source.slice(summaryStart, summaryEnd);
if (!summaryBlock.includes("soldReviewRecords.length")) throw new Error("Sold review summary missing sold count");
source = source.slice(0, summaryStart) + summaryBlock.replace("[activeRecords,", "[activeRecords, soldReviewRecords,") + source.slice(summaryEnd);
replace("{activeFilter === \"advertised_stock\" && advertisedStockLoadError ?", "{(activeFilter === \"advertised_stock\" || activeFilter === \"sold\") && advertisedStockLoadError ?", "Show Wix error in sold filter");
replaceInWatchCard("  const [saveMessage, setSaveMessage] = useState(\"\");", "  const [saveMessage, setSaveMessage] = useState(\"\");\n  const [soldRemoving, setSoldRemoving] = useState(false);", "Sold action state");
replaceInWatchCard("  const status = workflowStatusOf(record);", "  async function removeSoldFromWix() {\n    if (record.displayStatus !== \"sold\" || soldRemoving || !record.wixItemId\n      || record.wixPublishStatus !== \"PUBLISHED\") return;\n    const approved = window.confirm(\"Remove \" + record.registration + \" from published \" + pipelineLabel(selectedPipeline) +\n      \" Wix stock? Historical vehicle detail pages will remain intact.\");\n    if (!approved) return;\n    setSoldRemoving(true);\n    setSaveMessage(\"\");\n    try {\n      const result = await removeSoldWixStock(selectedPipeline, record.registration);\n      await onSoldRemoved(record, result);\n      setSaveMessage(result.message || \"Wix listing removed.\");\n    } catch (error) {\n      setSaveMessage(error.message || \"Wix removal was not verified. The review remains open.\");\n    } finally {\n      setSoldRemoving(false);\n    }\n  }\n\n  const status = workflowStatusOf(record);", "Confirmed Wix removal action");
replaceInWatchCard("<SourceStatusBadge status={record.sourceStatus} />", "<SourceStatusBadge status={record.displayStatus === \"sold\" ? (record.sourceLifecycleStatus || record.sourceStatus) : record.sourceStatus} />", "Actual lifecycle badge");
replaceInWatchCard("          {!isLocalNotVansco && record.stockUrl ? <a className=\"button button--ghost\"", "          {record.displayStatus === \"sold\" && record.wixItemId && record.wixPublishStatus === \"PUBLISHED\" ? <button className=\"button button--primary\" type=\"button\" disabled={soldRemoving} onClick={removeSoldFromWix}>{soldRemoving ? \"Removing from Wix...\" : \"Remove from website\"}</button> : null}\n          {!isLocalNotVansco && record.stockUrl ? <a className=\"button button--ghost\"", "Sold removal button");
replaceInWatchCard("!isAdvertisedStockMaintenance && (isAdvertised ?", "!isAdvertisedStockMaintenance && record.displayStatus !== \"sold\" && (isAdvertised ?", "Hide status not an alternative to Sold removal");
replaceInWatchCard("!isAdvertisedStockMaintenance && !isNeverShowStatus(status) ?", "!isAdvertisedStockMaintenance && record.displayStatus !== \"sold\" && !isNeverShowStatus(status) ?", "Never show not an alternative to Sold removal");
replace("onRecordSaved={handleRecordSaved}", "onRecordSaved={handleRecordSaved} onSoldRemoved={handleSoldRemoved}", "Sold callback prop");
replace("  function handleReservedDrafted(originalRecord, actionRecord) {", "  async function handleSoldRemoved(record, result) {\n    if (result?.previewOnly) { setSuccessMessage(result.message); return; }\n    if (!result?.ok || Number(result.remaining) !== 0) throw new Error(\"Wix removal was not verified.\");\n    await loadAdvertisedStock(selectedPipeline);\n    setSuccessMessage(\"Wix confirmed \" + record.registration + \" removed from published \" + pipelineLabel(selectedPipeline) + \" listings.\");\n  }\n\n  function handleReservedDrafted(originalRecord, actionRecord) {", "Refresh after sold removal");
replace("The existing Hide control records your review in Stock Watch; it does not change Wix publication.", "Use Remove from website to move published Wix stock adverts to Draft. Vehicle detail pages remain protected.", "Sold instructions");
replace("Review the live advert and manually remove it in Wix; Hide only records a Stock Watch decision.", "Only vehicles still published in main Wix stock appear here. Use Remove from website after confirmation; detail pages remain protected.", "Sold helper instructions");
const soldSignature = source.match(/function WatchCard\(\{([^}]+)\}\)/);
if (!soldSignature) throw new Error("Sold WatchCard props missing");
source = source.replace(soldSignature[0], soldSignature[0].replace("onRecordSaved", "onRecordSaved, onSoldRemoved"));

replaceInWatchCard("  const [soldRemoving, setSoldRemoving] = useState(false);", "  const [soldRemoving, setSoldRemoving] = useState(false);\n  const isSoldPreview = " + JSON.stringify(process.env.VERCEL_ENV !== "production") + ";", "Sold preview mode marker");
replaceInWatchCard("soldRemoving ? \"Removing from Wix...\" : \"Remove from website\"", "soldRemoving ? \"Checking Wix...\" : isSoldPreview ? \"Preview check (no changes)\" : \"Remove from website\"", "Sold removal preview label");
replaceInWatchCard("const approved = window.confirm(\"Remove \" + record.registration + \" from published \" + pipelineLabel(selectedPipeline) +", "const approved = window.confirm(isSoldPreview ? \"Preview-only safety check for \" + record.registration + \". No Wix records will be changed.\" : \"Remove \" + record.registration + \" from published \" + pipelineLabel(selectedPipeline) +", "Sold preview confirmation");
const watchStart = source.indexOf("function WatchCard(");
const watchEnd = source.indexOf("async function fetchLocalVehiclesForPipeline", watchStart);
const watchComponent = source.slice(watchStart, watchEnd);
for (const expected of ["const [soldRemoving, setSoldRemoving]", "async function removeSoldFromWix()", "const isSoldPreview =", "onClick={removeSoldFromWix}"]) {
  if (!watchComponent.includes(expected)) throw new Error("Sold WatchCard is missing its own declaration: " + expected);
}
fs.writeFileSync(path, source);
console.log("Added separate Sold / Removal Review cards across Finance Vans, Rent2Buy and Cars.");
