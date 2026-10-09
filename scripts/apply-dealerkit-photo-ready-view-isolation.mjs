import fs from "node:fs";
import {fileURLToPath} from "node:url";

const file=fileURLToPath(new URL("../pages/VanscoStockWatchPage.jsx",import.meta.url));
let source=fs.readFileSync(file,"utf8");
function replaceExactlyOnce(before,after,label){
 const matches=source.split(before).length-1;
 if(matches!==1)throw new Error(`Photo-ready view isolation: ${label} expected once, found ${matches}.`);
 source=source.replace(before,after);
}

// This runs after the stock-truth and photo-ready transforms. Normal stock
// comparison cards remain paused when their Wix/CRM support lookup fails.
// Independently verified DealerKit/Wix photo alerts remain actionable.
replaceExactlyOnce(
 'import { fetchVanscoImageReadiness } from "../services/vanscoImageReadiness.js";',
 'import { fetchVanscoImageReadiness } from "../services/vanscoImageReadiness.js";\nimport { selectVerifiedPhotoReadyRecords } from "../lib/photoReadyVisibleRecords.js";',
 "verified photo-ready import"
);
replaceExactlyOnce(
 '  const displayRecords = useMemo(\n',
 '  const visiblePhotoReadyRecords = useMemo(() => selectVerifiedPhotoReadyRecords({\n    records:imageReadyRecords, summary:imageReadySummary, error:imageReadyError, pipeline:selectedPipeline,\n  }),[imageReadyRecords,imageReadySummary,imageReadyError,selectedPipeline]);\n\n  const displayRecords = useMemo(\n',
 "verified photo-ready memo"
);
replaceExactlyOnce(
 '() => [...(positiveComparisonPaused ? [] : [...imageReadyRecords, ...activeRecords, ...visibleLocalNotVanscoRecords, ...priceDifferenceRecords]), ...advertisedStockRecords]',
 '() => [...visiblePhotoReadyRecords, ...(positiveComparisonPaused ? [] : [...activeRecords, ...visibleLocalNotVanscoRecords, ...priceDifferenceRecords]), ...advertisedStockRecords]',
 "photo-ready rows independent from paused comparison"
);
replaceExactlyOnce(
 '[activeRecords, advertisedStockRecords, imageReadyRecords, positiveComparisonPaused, priceDifferenceRecords, visibleLocalNotVanscoRecords]',
 '[activeRecords, advertisedStockRecords, visiblePhotoReadyRecords, positiveComparisonPaused, priceDifferenceRecords, visibleLocalNotVanscoRecords]',
 "photo-ready memo dependencies"
);
replaceExactlyOnce(
 'value={positiveComparisonPaused ? "—" : imageReadyError || (imageReadySummary && imageReadySummary.sourceAvailable === false) ? "Unavailable" : summary.imagesReady}',
 'value={imageReadyError || imageReadySummary?.sourceAvailable === false ? "Unavailable" : imageReadySummary?.sourceAvailable === true ? visiblePhotoReadyRecords.filter((record) => record.displayStatus === "images_ready").length : "—"}',
 "live photo-ready card count independent of local comparison"
);
replaceExactlyOnce(
 '{filter.value === "advertised_stock" ? (advertisedStockLoadError ? "—" : summary.advertisedStock) : filter.value === "local_not_vansco" ? absenceCount(filterCounts[filter.value] ?? 0) : positiveCount(filterCounts[filter.value] ?? 0)}',
 '{filter.value === "images_ready" ? (imageReadyError || imageReadySummary?.sourceAvailable === false ? "Unavailable" : imageReadySummary?.sourceAvailable === true ? visiblePhotoReadyRecords.filter((record) => record.displayStatus === "images_ready").length : "—") : filter.value === "advertised_stock" ? (advertisedStockLoadError ? "—" : summary.advertisedStock) : filter.value === "local_not_vansco" ? absenceCount(filterCounts[filter.value] ?? 0) : positiveCount(filterCounts[filter.value] ?? 0)}',
 "live photo-ready filter count independent of local comparison"
);
replaceExactlyOnce(
 'tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "images_ready" }))} />',
 'tone="amber" onClick={() => { setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "images_ready" })); void loadImageReadiness(selectedPipeline); }} />',
 "refresh photo-ready results when selecting their card"
);
replaceExactlyOnce(
 'Action cards and dependent counts are paused until live Wix stock presence is verified.',
 'Stock comparison cards and dependent counts are paused until live Wix stock presence is verified. Photo-ready alerts remain visible when independently verified by DealerKit and the live Wix listings.',
 "clarify pause message"
);
fs.writeFileSync(file,source);
console.log("Applied independent verified DealerKit photo-ready cards and click-to-refresh without relaxing stock comparison guards.");
