import fs from "node:fs";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url));
let source = fs.readFileSync(pagePath, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`DealerKit missing-stock controls could not find ${label}.`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`DealerKit missing-stock controls found duplicate ${label}.`);
  }
  source = source.replace(before, after);
}

if (!source.includes("DEALERKIT_MISSING_WIX_CONTROLS")) {
  replaceOnce(
    `import {\n  previewReservedFinanceWixStock,\n  unpublishReservedFinanceWixStock,\n} from "../services/financeReservedWixStock.js";`,
    `import {\n  previewReservedFinanceWixStock,\n  unpublishReservedFinanceWixStock,\n  unpublishMissingFinanceWixStock,\n} from "../services/financeReservedWixStock.js";`,
    "Finance Wix service import",
  );

  replaceOnce(
    `  const status = workflowStatusOf(record);`,
    `  async function moveMissingFinanceWixMatchesToDraft() {\n    setWixDrafting(true);\n    setWixActionError("");\n    try {\n      const result = await unpublishMissingFinanceWixStock(record.registration);\n      setWixDraftResult(result);\n      const refreshed = await previewReservedFinanceWixStock(record.registration);\n      setWixPreview(refreshed);\n    } catch (error) {\n      setWixActionError(error?.message || "Could not safely remove DealerKit-missing Finance Wix stock.");\n    } finally {\n      setWixDrafting(false);\n    }\n  }\n\n  // DEALERKIT_MISSING_WIX_CONTROLS: DealerKit absence gets a read-first Wix check, not an automatic deletion.\n  const status = workflowStatusOf(record);`,
    "WatchCard workflow status anchor",
  );

  const financeFlagPattern = /  const showFinanceReservedWix = [^\n]+;/;
  const financeFlagMatch = source.match(financeFlagPattern);
  if (!financeFlagMatch) throw new Error("DealerKit missing-stock controls could not find Finance reserved Wix flag.");
  source = source.replace(
    financeFlagPattern,
    `${financeFlagMatch[0]}\n  const showFinanceMissingWix = selectedPipeline === "finance" && isLocalNotVansco && Boolean(normalizeWatchRegistration(record.registration));`,
  );

  replaceOnce(
    `{showFinanceReservedWix ? (`,
    `{(showFinanceReservedWix || showFinanceMissingWix) ? (`,
    "Finance Wix control visibility",
  );

  replaceOnce(
    `onClick={moveFinanceWixMatchesToDraft}`,
    `onClick={showFinanceMissingWix ? moveMissingFinanceWixMatchesToDraft : moveFinanceWixMatchesToDraft}`,
    "Finance Wix draft action",
  );

  replaceOnce(
    `<div className="vehicle-card__meta">No live matches remain in the approved Finance stock collections.</div>`,
    `<><div className="vehicle-card__meta">No live matches remain in the approved Finance stock collections.</div>{showFinanceMissingWix ? <button className="button button--ghost" type="button" onClick={() => saveWorkflow("ignored", "Hidden")} disabled={Boolean(savingAction)}>{savingAction === "ignored" ? "Hiding..." : "Hide"}</button> : null}</>`,
    "Finance no-live-match state",
  );

  replaceOnce(
    `  const reservedDealerKitRegistrationSet = useMemo(() => new Set(currentRawRecords.filter((record) => isReservedLikeStatus(record.sourceStatus)).map((record) => normalizeWatchRegistration(record.registration)).filter(Boolean)), [currentRawRecords]);\n  const localNotVanscoRecords = useMemo(() => dedupeLocalVehiclesByRegistration(activeLocalVehicles).filter(({ registration }) => registration && !currentVanscoRegistrationSet.has(registration) && !reservedDealerKitRegistrationSet.has(registration)).map(({ vehicle, index }) => mapLocalVehicleToWatchRecord(vehicle, index, selectedPipeline)), [activeLocalVehicles, currentVanscoRegistrationSet, reservedDealerKitRegistrationSet, selectedPipeline]);`,
    `  const reservedDealerKitRegistrationSet = useMemo(() => new Set(currentRawRecords.filter((record) => isReservedLikeStatus(record.sourceStatus)).map((record) => normalizeWatchRegistration(record.registration)).filter(Boolean)), [currentRawRecords]);\n  const hiddenReverseRegistrationSet = useMemo(() => new Set(currentRawRecords.filter((record) => isTemporaryHiddenStatus(workflowStatusOf(record))).map((record) => normalizeWatchRegistration(record.registration)).filter(Boolean)), [currentRawRecords]);\n  const localNotVanscoRecords = useMemo(() => dedupeLocalVehiclesByRegistration(activeLocalVehicles).filter(({ registration }) => registration && !currentVanscoRegistrationSet.has(registration) && !reservedDealerKitRegistrationSet.has(registration) && !hiddenReverseRegistrationSet.has(registration)).map(({ vehicle, index }) => mapLocalVehicleToWatchRecord(vehicle, index, selectedPipeline)), [activeLocalVehicles, currentVanscoRegistrationSet, reservedDealerKitRegistrationSet, hiddenReverseRegistrationSet, selectedPipeline]);`,
    "hidden reverse-registration exclusion",
  );

  replaceOnce(
    `<div className="vansco-watch-note"><strong>My stock not on DealerKit:</strong> this reverse registration check shows active CRM vehicles absent from the current DealerKit feed.</div>`,
    `<div className="vansco-watch-note"><strong>My stock not on DealerKit:</strong> this reverse registration check shows active CRM vehicles absent from the current DealerKit feed. Finance cards can check Wix first: live listing rows can be moved to Draft safely, while cards already off Wix can be hidden from Stock Watch.</div>`,
    "reverse-check guidance",
  );

  fs.writeFileSync(pagePath, source);
}

console.log("Applied DealerKit missing-stock controls: Finance reverse-check cards verify Wix, remove only confirmed live listings, and hide only once Wix is clear.");
