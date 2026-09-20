import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetPath = fileURLToPath(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url));
let source = fs.readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`DealerKit stock-truth safety transform could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`DealerKit stock-truth safety transform found duplicate anchor: ${label}`);
  }
  source = source.replace(before, after);
}

if (!source.includes("DEALERKIT_STOCK_TRUTH_SAFETY")) {
  replaceOnce(
    `  const reservedOnVansco = isReservedLikeStatus(record.sourceStatus);
  const currentDealerKitBulkPresence = record.isCurrentDealerKitBulkRecord === true;`,
    `  const reservedOnVansco = isReservedLikeStatus(record.sourceStatus);
  const explicitlyAvailableOnDealerKit = String(record.sourceLifecycleStatus || record.sourceStatus || "").toLowerCase() === "available";
  const currentDealerKitBulkPresence = record.isCurrentDealerKitBulkRecord === true;`,
    "explicit available status"
  );

  replaceOnce(
    `    if (!reservedOnVansco && currentDealerKitBulkPresence) {`,
    `    if (explicitlyAvailableOnDealerKit && currentDealerKitBulkPresence) {`,
    "Back in stock availability gate"
  );

  replaceOnce(
    `  if (reservedOnVansco) return { ...baseRecord, displayStatus: "hidden_reserved_not_advertised", matchStatus: "hidden_reserved_not_advertised" };
  return { ...baseRecord, displayStatus: "missing", matchStatus: "missing" };`,
    `  if (reservedOnVansco) return { ...baseRecord, displayStatus: "hidden_reserved_not_advertised", matchStatus: "hidden_reserved_not_advertised" };
  // DEALERKIT_STOCK_TRUTH_SAFETY: only an explicit current available status may create an actionable Missing result.
  if (!explicitlyAvailableOnDealerKit) return { ...baseRecord, displayStatus: "hidden_not_available", matchStatus: "source_not_explicitly_available" };
  return { ...baseRecord, displayStatus: "missing", matchStatus: "missing" };`,
    "Missing availability gate"
  );

  replaceOnce(
    `      setErrorMessage(error.message || "Could not load DealerKit Stock Watch data.");`,
    `      setErrorMessage(\`Stock data incomplete / last verified snapshot shown. \${error.message || "Could not load DealerKit Stock Watch data."}\`);`,
    "DealerKit stale comparison warning"
  );

  replaceOnce(
    `          } else {
            presenceWarning = "Live Wix listing presence was only partially checked. Stock Watch classification is paused for this tab rather than falling back to CRM stock.";
            effectiveRegistrations = [];
            effectiveVehicles = [];
          }
        } catch (presenceError) {
          presenceWarning = \`Could not confirm live Wix listing presence. Stock Watch classification is paused for this tab: \${presenceError?.message || "Wix check failed."}\`;
          effectiveRegistrations = [];
          effectiveVehicles = [];
        }`,
    `          } else {
            presenceWarning = "Stock data incomplete / last verified snapshot shown. Live Wix listing presence was only partially checked, so Stock Watch totals and action cards are paused for this tab.";
            if (!isActive()) return null;
            setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: presenceWarning }));
            return null;
          }
        } catch (presenceError) {
          presenceWarning = \`Stock data incomplete / last verified snapshot shown. Could not confirm live Wix listing presence, so Stock Watch totals and action cards are paused for this tab: \${presenceError?.message || "Wix check failed."}\`;
          if (!isActive()) return null;
          setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: presenceWarning }));
          return null;
        }`,
    "retain verified Wix snapshot"
  );

  replaceOnce(
    `    } catch (error) {
      if (!isActive()) return;
      setLocalVehiclesByPipeline((prev) => ({ ...prev, [pipeline]: [] }));
      setLocalRegistrationsByPipeline((prev) => ({ ...prev, [pipeline]: new Set() }));
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: error.message || \`Could not load \${pipelineLabel(pipeline)} local stock.\` }));
      throw error;
    }`,
    `    } catch (error) {
      if (!isActive()) return;
      const message = \`Stock data incomplete / last verified snapshot shown. \${error.message || \`Could not load \${pipelineLabel(pipeline)} local stock.\`}\`;
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: message }));
      throw error;
    }`,
    "failed Wix read retains prior state"
  );

  replaceOnce(
    `  const dealerKitSnapshotComplete = cacheSummary?.sourceComplete === true;

  const activeRecords = useMemo(() => currentRawRecords.map((record) => classifyWatchRecord(record, activeLocalRegistrations, selectedPipeline, financeRegistrationsForCars)), [activeLocalRegistrations, currentRawRecords, financeRegistrationsForCars, selectedPipeline]);`,
    `  const dealerKitSnapshotComplete = cacheSummary?.sourceComplete === true;
  const comparisonPaused = Boolean(localLoadError) || !dealerKitSnapshotComplete;

  const activeRecords = useMemo(() => comparisonPaused ? [] : currentRawRecords.map((record) => classifyWatchRecord(record, activeLocalRegistrations, selectedPipeline, financeRegistrationsForCars)), [activeLocalRegistrations, comparisonPaused, currentRawRecords, financeRegistrationsForCars, selectedPipeline]);`,
    "pause classifications without both sources"
  );

  replaceOnce(
    `  const priceDifferenceRecords = useMemo(() => {
    if (selectedPipeline === "finance")`,
    `  const priceDifferenceRecords = useMemo(() => {
    if (comparisonPaused) return [];
    if (selectedPipeline === "finance")`,
    "pause price comparisons"
  );

  replaceOnce(
    `  }, [activeLocalVehicles, currentRawRecords, selectedPipeline]);

  const currentVanscoRegistrationSet = useMemo(() => new Set(currentRawRecords.filter((record) => record.isCurrentlyOnVansco !== false).map((record) => normalizeWatchRegistration(record.registration)).filter(Boolean)), [currentRawRecords]);`,
    `  }, [activeLocalVehicles, comparisonPaused, currentRawRecords, selectedPipeline]);

  const currentVanscoRegistrationSet = useMemo(() => new Set([
    ...(cacheSummary?.currentDealerKitRegistrations || []).map(normalizeWatchRegistration).filter(Boolean),
    ...currentRawRecords.filter((record) => record.isCurrentDealerKitBulkRecord === true).map((record) => normalizeWatchRegistration(record.registration)).filter(Boolean),
  ]), [cacheSummary, currentRawRecords]);`,
    "complete bulk registration presence"
  );

  replaceOnce(
    `  const localNotVanscoRecords = useMemo(() => {
    if (!dealerKitSnapshotComplete) return [];`,
    `  const localNotVanscoRecords = useMemo(() => {
    if (comparisonPaused) return [];`,
    "pause reverse comparison"
  );

  replaceOnce(
    `  }, [activeLocalVehicles, currentVanscoRegistrationSet, dealerKitSnapshotComplete, selectedPipeline]);`,
    `  }, [activeLocalVehicles, comparisonPaused, currentVanscoRegistrationSet, selectedPipeline]);`,
    "reverse comparison dependencies"
  );

  replaceOnce(
    `  const displayRecords = useMemo(() => localLoadError ? [] : [...imageReadyRecords, ...activeRecords, ...visibleLocalNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, imageReadyRecords, localLoadError, visibleLocalNotVanscoRecords, priceDifferenceRecords]);`,
    `  const displayRecords = useMemo(() => comparisonPaused ? [] : [...imageReadyRecords, ...activeRecords, ...visibleLocalNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, comparisonPaused, imageReadyRecords, visibleLocalNotVanscoRecords, priceDifferenceRecords]);`,
    "pause action cards"
  );

  replaceOnce(
    `  }), [summary]);

  const filteredRecords`,
    `  }), [summary]);
  const comparisonCount = (value) => comparisonPaused ? "—" : value;

  const filteredRecords`,
    "paused count display"
  );

  for (const expression of [
    "summary.missing",
    "summary.localNotVansco",
    "summary.priceDifference",
    "summary.advertised",
    "summary.reserved",
    "summary.backInStock",
    "summary.hidden",
    "summary.never",
    "activeLocalRegistrations.size",
  ]) {
    source = source.replace(`value={${expression}}`, `value={comparisonCount(${expression})}`);
  }
  source = source.replace(
    `value={imageReadyError || (imageReadySummary && imageReadySummary.sourceAvailable === false) ? "Unavailable" : summary.imagesReady}`,
    `value={comparisonPaused ? "—" : imageReadyError || (imageReadySummary && imageReadySummary.sourceAvailable === false) ? "Unavailable" : summary.imagesReady}`
  );
  source = source.replace(
    `{filter.label} ({filterCounts[filter.value] ?? 0})`,
    `{filter.label} ({comparisonCount(filterCounts[filter.value] ?? 0)})`
  );

  replaceOnce(
    `        <div className="vansco-watch-note"><strong>Price differences:</strong>`,
    `        {comparisonPaused ? <div className="vansco-watch-note vansco-watch-note--warning"><strong>Stock data incomplete / last verified snapshot shown.</strong> Action cards, summary totals and filter counts are paused until complete DealerKit and Wix stock presence are both verified.</div> : null}
        <div className="vansco-watch-note"><strong>Price differences:</strong>`,
    "visible paused comparison state"
  );

  replaceOnce(
    `        <div className="vansco-watch-note">Hidden from working cards: {summary.alreadyListed} already listed/available, {summary.hiddenReserved} reserved but not advertised in this tab, {summary.hiddenNoReg} no valid registration.`,
    `        <div className="vansco-watch-note">Hidden from working cards: {comparisonCount(summary.alreadyListed)} already listed/available, {comparisonCount(summary.hiddenReserved)} reserved but not advertised in this tab, {comparisonCount(summary.hiddenNoReg)} no valid registration.`,
    "pause hidden summary counts"
  );
}

fs.writeFileSync(targetPath, source);
console.log("Applied DealerKit Stock Watch stock-truth safety gates.");
