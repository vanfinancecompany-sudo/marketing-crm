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
    `import {\n  previewReservedFinanceWixStock,\n  unpublishReservedFinanceWixStock,\n} from "../services/financeReservedWixStock.js";\nimport {\n  previewMissingFinanceWixStock,\n  unpublishMissingFinanceWixStock,\n} from "../services/financeReservedWixStock.js";`,
    "Finance Wix service import",
  );

  replaceOnce(
    `  const status = workflowStatusOf(record);`,
    `  async function moveMissingFinanceWixMatchesToDraft() {\n    setWixDrafting(true);\n    setWixActionError("");\n    try {\n      const result = await unpublishMissingFinanceWixStock(record.registration);\n      setWixDraftResult(result);\n      const refreshed = await previewMissingFinanceWixStock(record.registration);\n      setWixPreview(refreshed);\n    } catch (error) {\n      setWixActionError(error?.message || "Could not safely remove DealerKit-missing Finance Wix stock.");\n    } finally {\n      setWixDrafting(false);\n    }\n  }\n\n  // DEALERKIT_MISSING_WIX_CONTROLS: DealerKit absence gets a read-first Wix check, not an automatic deletion.\n  const status = workflowStatusOf(record);`,
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
    `{isLocalNotVansco && record.localStockUrl ? <a className="button button--ghost" href={record.localStockUrl} target="_blank" rel="noreferrer">Open my stock page</a> : null}`,
    `{isLocalNotVansco && record.localStockUrl ? <a className="button button--ghost" href={record.localStockUrl} target="_blank" rel="noreferrer">Open my stock page</a> : null}\n          {isLocalNotVansco && (selectedPipeline !== "finance" || !wixPreview || (Array.isArray(wixPreview.matches) && wixPreview.matches.length > 0)) ? <button className="button button--ghost" type="button" onClick={() => saveWorkflow("ignored", "Hidden from Stock Watch. Wix was not changed.")} disabled={Boolean(savingAction)}>{savingAction === "ignored" ? "Hiding..." : "Hide from Stock Watch"}</button> : null}`,
    "reverse-check Hide action",
  );

  replaceOnce(
    `<div className="vehicle-card__meta">No live matches remain in the approved Finance stock collections.</div>`,
    `<><div className="vehicle-card__meta">No live matches remain in the approved Finance stock collections.</div>{showFinanceMissingWix ? <button className="button button--ghost" type="button" onClick={() => saveWorkflow("ignored", "Hidden")} disabled={Boolean(savingAction)}>{savingAction === "ignored" ? "Hiding..." : "Hide from Stock Watch"}</button> : null}</>`,
    "Finance no-live-match Hide state",
  );

  const legacyReverseGuidance = `<div className="vansco-watch-note"><strong>My stock not on DealerKit:</strong> this reverse registration check shows active CRM vehicles absent from the current DealerKit feed.</div>`;
  if (source.includes(legacyReverseGuidance)) {
    replaceOnce(
      legacyReverseGuidance,
      `<div className="vansco-watch-note"><strong>My stock not on DealerKit:</strong> this reverse registration check shows active CRM vehicles absent from the current DealerKit feed. Any Finance, Rent2Buy or Cars card can be hidden from Stock Watch without changing Wix. Finance cards can additionally check Wix first and safely move confirmed live listing rows to Draft.</div>`,
      "reverse-check guidance",
    );
  } else if (!source.includes("No CRM vehicle is classified as absent until a complete DealerKit snapshot proves it.")) {
    throw new Error("DealerKit missing-stock controls could not find safe reverse-check guidance.");
  }

  // The newer classifier already gives Reserved presence precedence and, more
  // importantly, suppresses every reverse absence card while the DealerKit snapshot
  // is incomplete. Mark that routing as satisfied so the older final-safety transform
  // does not replace it with its weaker one-line reverse comparison.
  if (!source.includes("DEALERKIT_RESERVED_BUCKET_ROUTING")) {
    source = source.replace(
      `  if (!currentlyOnVansco) return { ...baseRecord, displayStatus: "hidden_not_current", matchStatus: "hidden_not_current" };\n  if (!registration) return { ...baseRecord, displayStatus: "hidden_no_registration", matchStatus: "hidden_no_registration" };\n  if (hasExactLocalMatch && reservedOnVansco) return { ...baseRecord, displayStatus: "reserved", matchStatus: "reserved_still_listed" };`,
      `  // DEALERKIT_RESERVED_BUCKET_ROUTING: Reserved presence wins before absence; reverse absence also requires a complete source snapshot.\n  if (!currentlyOnVansco) return { ...baseRecord, displayStatus: "hidden_not_current", matchStatus: "hidden_not_current" };\n  if (!registration) return { ...baseRecord, displayStatus: "hidden_no_registration", matchStatus: "hidden_no_registration" };\n  if (hasExactLocalMatch && reservedOnVansco) return { ...baseRecord, displayStatus: "reserved", matchStatus: "reserved_still_listed" };`,
    );
  }

  // The next legacy build transform matches the diagnostics line literally. Keep its
  // anchor compatible without weakening the real dealerKitSnapshotComplete gate above.
  source = source.replace(
    `{JSON.stringify({ selectedPipeline, dealerKitSnapshotComplete, localRegsLoaded:`,
    `{JSON.stringify({ selectedPipeline, localRegsLoaded:`,
  );

  fs.writeFileSync(pagePath, source);
}

console.log("Applied DealerKit missing-stock controls: Finance reverse-check cards verify Wix, and all pipelines can temporarily hide feed-missing cards without changing Wix.");