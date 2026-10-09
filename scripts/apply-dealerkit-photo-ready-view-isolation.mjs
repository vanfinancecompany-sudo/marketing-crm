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

/*
 * The single-snapshot Stock Watch UI replaced the old initial photo loader.
 * Previously this independent endpoint ran only when the user clicked the card,
 * leaving its default count at zero even when three alerts were ready.
 *
 * Await the ongoing initial session so applySession cannot overwrite the fresh
 * independently verified photo result. Recheck on each product-tab switch.
 * The cleanup protects against late results from a previous product tab.
 */
replaceExactlyOnce(
 '  const activeFilter = filtersByPipeline[selectedPipeline] || "missing";',
 `  useEffect(() => {
    let active = true;
    const loadLivePhotoAlerts = async () => {
      // The initial shared stock session can overwrite photo state. Join it first.
      try {
        if (sessionUiLoadRef.current) await sessionUiLoadRef.current;
      } catch {
        // Photo readiness has a separate Wix+DealerKit source and can still pass.
      }
      if (active) await loadImageReadiness(selectedPipeline, () => active);
    };
    void loadLivePhotoAlerts();
    return () => { active = false; };
  }, [selectedPipeline]);

  const activeFilter = filtersByPipeline[selectedPipeline] || "missing";`,
 "load verified photo alerts on initial screen and lane switches"
);
replaceExactlyOnce(
 'It appears only while that advert has 1 or 2 placeholder images and DealerKit now has at least 5 images. Once the advert has 3 or more images, small later DealerKit additions are ignored.',
 'It appears while that advert has 1 to 4 images, including warranty, Due In Soon or delivery graphics, and DealerKit has at least 5 images and more photos than the advert. Five or more advertised images count as an established gallery.',
 "correct photo-ready informational wording"
);

fs.writeFileSync(file,source);
console.log("Applied independent verified DealerKit photo-ready cards and click-to-refresh without relaxing stock comparison guards.");
