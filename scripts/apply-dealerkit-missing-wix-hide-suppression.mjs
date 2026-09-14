import fs from "node:fs";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url));
let source = fs.readFileSync(pagePath, "utf8");
const marker = "DEALERKIT_MISSING_WIX_HIDE_SUPPRESSION";

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`DealerKit missing-stock hide suppression could not find ${label}.`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`DealerKit missing-stock hide suppression found duplicate ${label}.`);
  }
  source = source.replace(before, after);
}

if (!source.includes(marker)) {
  replaceOnce(
    `  const displayRecords = useMemo(() => localLoadError ? [] : [...imageReadyRecords, ...activeRecords, ...localNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, imageReadyRecords, localLoadError, localNotVanscoRecords, priceDifferenceRecords]);`,
    `  // ${marker}: once a reverse-check card is deliberately hidden, keep it out of the working reverse-stock lane.\n  const hiddenReverseRegistrationSet = useMemo(() => new Set(currentRawRecords.filter((record) => isTemporaryHiddenStatus(workflowStatusOf(record))).map((record) => normalizeWatchRegistration(record.registration)).filter(Boolean)), [currentRawRecords]);\n  const visibleLocalNotVanscoRecords = useMemo(() => localNotVanscoRecords.filter((record) => !hiddenReverseRegistrationSet.has(normalizeWatchRegistration(record.registration))), [hiddenReverseRegistrationSet, localNotVanscoRecords]);\n  const displayRecords = useMemo(() => localLoadError ? [] : [...imageReadyRecords, ...activeRecords, ...visibleLocalNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, imageReadyRecords, localLoadError, visibleLocalNotVanscoRecords, priceDifferenceRecords]);`,
    "final display-record composition",
  );

  replaceOnce(
    `    localNotVansco: localNotVanscoRecords.length,`,
    `    localNotVansco: visibleLocalNotVanscoRecords.length,`,
    "reverse-check summary count",
  );

  fs.writeFileSync(pagePath, source);
}

console.log("Applied DealerKit missing-stock hide suppression after the authoritative Stock Watch transforms.");
