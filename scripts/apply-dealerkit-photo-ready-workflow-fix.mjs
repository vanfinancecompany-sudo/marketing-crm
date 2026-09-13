import fs from "node:fs";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url));
let source = fs.readFileSync(pagePath, "utf8");

function replaceOnce(before, after, label, already = "") {
  if (already && source.includes(already)) return;
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`DealerKit photo-ready workflow fix could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`DealerKit photo-ready workflow fix found duplicate anchor: ${label}`);
  }
  source = source.replace(before, after);
}

function replaceRegexOnce(pattern, after, label, already = "") {
  if (already && source.includes(already)) return;
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  if (!matches || matches.length !== 1) {
    throw new Error(`DealerKit photo-ready workflow fix expected one match for ${label}, found ${matches?.length || 0}`);
  }
  source = source.replace(pattern, after);
}

// Cars uses the same image-readiness endpoint and review workspace as the other lanes.
replaceRegexOnce(
  /  async function loadImageReadiness\(pipeline = selectedPipeline, isActive = \(\) => true\) \{\n    if \(pipeline === "cars"\) \{[\s\S]*?\n    \}\n\n    try \{/,
  `  async function loadImageReadiness(pipeline = selectedPipeline, isActive = () => true) {\n    // Photo readiness runs for Finance, Rent2Buy and Cars.\n    try {`,
  "Cars image-readiness early return",
  "Photo readiness runs for Finance, Rent2Buy and Cars."
);

// Keep saved Stock Watch actions attached to photo-ready alerts. This lets Hide,
// Never show again and Advertised/Awaiting refresh survive reloads while the
// underlying due-in photo condition is still true.
replaceOnce(
  `  const imageReadyRecords = imageReadyByPipeline[selectedPipeline] || [];`,
  `  const imageReadyRecords = useMemo(() => {\n    const actionByRegistration = new Map(currentRawRecords\n      .map((record) => [normalizeWatchRegistration(record.registration), record])\n      .filter(([registration]) => Boolean(registration)));\n\n    return (imageReadyByPipeline[selectedPipeline] || []).map((record) => {\n      const actionRecord = actionByRegistration.get(normalizeWatchRegistration(record.registration));\n      const workflowStatus = workflowStatusOf(actionRecord) || workflowStatusOf(record);\n      let displayStatus = "images_ready";\n      if (isNeverShowStatus(workflowStatus)) displayStatus = "never";\n      else if (isTemporaryHiddenStatus(workflowStatus)) displayStatus = "hidden";\n      else if (isAdvertisedStatus(workflowStatus)) displayStatus = "advertised";\n\n      return {\n        ...record,\n        displayStatus,\n        matchStatus: "images_ready",\n        imageReadinessAlert: true,\n        workflowStatus,\n        workflow_status: workflowStatus,\n        notes: actionRecord?.notes ?? record.notes ?? "",\n      };\n    });\n  }, [currentRawRecords, imageReadyByPipeline, selectedPipeline]);`,
  "photo-ready workflow merge",
  "const actionByRegistration = new Map(currentRawRecords"
);

replaceOnce(
  `  const isLocalNotVansco = record.displayStatus === "local_not_vansco";`,
  `  const isLocalNotVansco = record.displayStatus === "local_not_vansco";\n  const isImageReady = record.imageReadinessAlert === true || record.matchStatus === "images_ready" || String(record.id || "").startsWith("images-ready-");`,
  "photo-ready WatchCard flag",
  "const isImageReady = record.imageReadinessAlert === true"
);

replaceOnce(
  `    && record.displayStatus === "missing"\n    && (selectedPipeline === "finance" || selectedPipeline === "rent2buy" || selectedPipeline === "cars")`,
  `    && (record.displayStatus === "missing" || isImageReady)\n    && (selectedPipeline === "finance" || selectedPipeline === "rent2buy" || selectedPipeline === "cars")`,
  "photo-ready Review vehicle eligibility",
  `&& (record.displayStatus === "missing" || isImageReady)`
);

replaceOnce(
  `        <div className="vehicle-card__meta">Registration: {record.registration || "Not found"}</div>`,
  `        <div className="vehicle-card__meta">Registration: {record.registration || "Not found"}</div>\n        {isImageReady ? <div className="vehicle-card__meta"><strong>Current advert:</strong> {record.currentAdvertImageCount ?? record.cmsImageCount ?? "?"} vehicle image{Number(record.currentAdvertImageCount ?? record.cmsImageCount) === 1 ? "" : "s"}</div> : null}\n        {isImageReady ? <div className="vehicle-card__meta"><strong>DealerKit now has:</strong> {record.sourceImageCount ?? "?"} vehicle images</div> : null}\n        {isImageReady ? <div className="vehicle-card__meta">Due-in photo alert: your live advert still has only 1–2 placeholder images and DealerKit now has the fuller stock gallery. Use <strong>Review vehicle</strong> to update the existing advert.</div> : null}\n        {isImageReady && record.sourceCheckedAt ? <div className="vehicle-card__meta">DealerKit images checked: {formatWatchTimestamp(record.sourceCheckedAt)}</div> : null}`,
  "photo-ready card details",
  "Due-in photo alert: your live advert still has only 1–2 placeholder images"
);

replaceOnce(
  `{!isLocalNotVansco && record.displayStatus === "missing" ? <button className="button button--primary" type="button" onClick={() => saveWorkflow("added_to_crm", "Marked as advertised")} disabled={Boolean(savingAction)}>{savingAction === "added_to_crm" ? "Marking..." : "Mark as advertised"}</button> : null}`,
  `{!isLocalNotVansco && (record.displayStatus === "missing" || record.displayStatus === "images_ready") ? <button className="button button--primary" type="button" onClick={() => saveWorkflow("added_to_crm", "Marked as advertised")} disabled={Boolean(savingAction)}>{savingAction === "added_to_crm" ? "Marking..." : "Mark as advertised"}</button> : null}`,
  "photo-ready Mark as advertised",
  `(record.displayStatus === "missing" || record.displayStatus === "images_ready") ? <button`
);

// Render photo-ready alerts through the normal action card so they get Review vehicle,
// Hide, Never show again, notes and Mark as advertised rather than a read-only card.
replaceOnce(
  `{filteredRecords.map((record) => record.displayStatus === "price_difference" ? <PriceDifferenceCard key={record.id} record={record} /> : record.displayStatus === "images_ready" ? <ImageReadyCard key={record.id} record={record} /> : <WatchCard key={normalizeWatchRegistration(record.registration) || record.stockUrl || record.localStockUrl || record.id} record={record} selectedPipeline={selectedPipeline} onRecordSaved={handleRecordSaved} />)}`,
  `{filteredRecords.map((record) => record.displayStatus === "price_difference" ? <PriceDifferenceCard key={record.id} record={record} /> : <WatchCard key={normalizeWatchRegistration(record.registration) || record.stockUrl || record.localStockUrl || record.id} record={record} selectedPipeline={selectedPipeline} onRecordSaved={handleRecordSaved} />)}`,
  "photo-ready actionable card rendering",
  `record.displayStatus === "price_difference" ? <PriceDifferenceCard key={record.id} record={record} /> : <WatchCard key={normalizeWatchRegistration(record.registration)`
);

replaceOnce(
  `    imagesReady: imageReadyRecords.length,`,
  `    imagesReady: imageReadyRecords.filter((record) => record.displayStatus === "images_ready").length,`,
  "active photo-ready summary count",
  `imagesReady: imageReadyRecords.filter((record) => record.displayStatus === "images_ready").length`
);

replaceOnce(
  `    advertised: activeRecords.filter((record) => record.displayStatus === "advertised").length,`,
  `    advertised: activeRecords.filter((record) => record.displayStatus === "advertised").length + imageReadyRecords.filter((record) => record.displayStatus === "advertised").length,`,
  "advertised photo-ready summary count",
  `+ imageReadyRecords.filter((record) => record.displayStatus === "advertised").length`
);

replaceOnce(
  `    hidden: activeRecords.filter((record) => record.displayStatus === "hidden").length,`,
  `    hidden: activeRecords.filter((record) => record.displayStatus === "hidden").length + imageReadyRecords.filter((record) => record.displayStatus === "hidden").length,`,
  "hidden photo-ready summary count",
  `+ imageReadyRecords.filter((record) => record.displayStatus === "hidden").length`
);

replaceOnce(
  `    never: activeRecords.filter((record) => record.displayStatus === "never").length,`,
  `    never: activeRecords.filter((record) => record.displayStatus === "never").length + imageReadyRecords.filter((record) => record.displayStatus === "never").length,`,
  "never photo-ready summary count",
  `+ imageReadyRecords.filter((record) => record.displayStatus === "never").length`
);

replaceOnce(
  `    all: summary.missing + summary.localNotVansco + summary.priceDifference + summary.advertised + summary.reserved + summary.backInStock + summary.hidden + summary.never,`,
  `    all: summary.missing + summary.imagesReady + summary.localNotVansco + summary.priceDifference + summary.advertised + summary.reserved + summary.backInStock + summary.hidden + summary.never,`,
  "all action cards photo-ready count",
  `all: summary.missing + summary.imagesReady + summary.localNotVansco`
);

replaceOnce(
  `{selectedPipeline !== "cars" ? <SummaryCard label="New DealerKit photos ready" value={imageReadyError || (imageReadySummary && imageReadySummary.sourceAvailable === false) ? "Unavailable" : summary.imagesReady} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "images_ready" }))} /> : null}`,
  `<SummaryCard label="New DealerKit photos ready" value={imageReadyError || (imageReadySummary && imageReadySummary.sourceAvailable === false) ? "Unavailable" : summary.imagesReady} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "images_ready" }))} />`,
  "Cars photo-ready summary card",
  `<SummaryCard label="New DealerKit photos ready" value={imageReadyError || (imageReadySummary && imageReadySummary.sourceAvailable === false) ? "Unavailable" : summary.imagesReady}`
);

replaceOnce(
  `{selectedPipeline !== "cars" ? <div className="vansco-watch-note"><strong>Image readiness:</strong> this checks only registrations already advertised in this CRM and matching a main CMS vehicle page. If DealerKit has at least 5 images and more vehicle photos than the fullest current live advert for that registration, it appears in New DealerKit photos ready. Once your CMS page has multiple images, later DealerKit image additions are ignored.</div> : null}`,
  `<div className="vansco-watch-note"><strong>Image readiness:</strong> this is a due-in photo alert, not a general picture-count comparison. It appears only while the fullest current live advert has 1 or 2 placeholder images and DealerKit now has at least 5 images. Once an advert has 3 or more images, small later DealerKit additions are ignored.</div>`,
  "due-in photo-ready wording",
  `this is a due-in photo alert, not a general picture-count comparison`
);

replaceOnce(
  `{selectedPipeline !== "cars" && imageReadySummary && !imageReadySummary.complete ? <div className="vansco-watch-note vansco-watch-note--warning">DealerKit image counts are waiting for the next complete stock refresh before image-readiness alerts can be trusted.</div> : null}`,
  `{imageReadySummary && !imageReadySummary.complete ? <div className="vansco-watch-note vansco-watch-note--warning">DealerKit image counts are using the current degraded source snapshot. Known-good rows remain visible; refresh Dealer Stock when the source is healthy.</div> : null}`,
  "all-lane degraded image-readiness warning",
  `Known-good rows remain visible; refresh Dealer Stock when the source is healthy.`
);

// Refresh comparison must refresh the photo-ready endpoint as well; otherwise a
// transient first request can leave a false zero on screen until a full page reload.
replaceOnce(
  `      const [localVehiclesByReload, cachePayload] = await Promise.all([Promise.all(localLoads), loadPipeline(pipeline, { throwOnError: true })]);`,
  `      const [localVehiclesByReload, cachePayload] = await Promise.all([Promise.all(localLoads), loadPipeline(pipeline, { throwOnError: true })]);\n      await loadImageReadiness(pipeline);`,
  "comparison image-readiness refresh",
  `await loadImageReadiness(pipeline);\n      const [financeVehicles, rentVehicles, carsVehicles]`
);

replaceRegexOnce(
  /  function handleRecordSaved\(originalRecord, actionRecord\) \{[\s\S]*?\n  \}\n\n  return \(/,
  `  function handleRecordSaved(originalRecord, actionRecord) {\n    const originalRegistration = normalizeWatchRegistration(originalRecord.registration);\n    const savedRegistration = normalizeWatchRegistration(actionRecord.registration);\n    const savedWorkflowStatus = workflowStatusOf(actionRecord);\n\n    setRecordsByPipeline((prev) => ({\n      ...prev,\n      [selectedPipeline]: prev[selectedPipeline].map((record) => {\n        const recordRegistration = normalizeWatchRegistration(record.registration);\n        const sameRecord = (savedRegistration && recordRegistration === savedRegistration) || (originalRegistration && recordRegistration === originalRegistration) || record.stockUrl === actionRecord.stockUrl || record.stockUrl === actionRecord.stock_url;\n        return sameRecord ? { ...record, ...actionRecord, workflowStatus: savedWorkflowStatus || workflowStatusOf(record), workflow_status: savedWorkflowStatus || workflowStatusOf(record), notes: actionRecord.notes ?? record.notes } : record;\n      }),\n    }));\n\n    setImageReadyByPipeline((prev) => ({\n      ...prev,\n      [selectedPipeline]: (prev[selectedPipeline] || []).map((record) => {\n        const recordRegistration = normalizeWatchRegistration(record.registration);\n        const sameRecord = (savedRegistration && recordRegistration === savedRegistration) || (originalRegistration && recordRegistration === originalRegistration) || record.stockUrl === actionRecord.stockUrl || record.stockUrl === actionRecord.stock_url;\n        return sameRecord ? { ...record, workflowStatus: savedWorkflowStatus || workflowStatusOf(record), workflow_status: savedWorkflowStatus || workflowStatusOf(record), notes: actionRecord.notes ?? record.notes } : record;\n      }),\n    }));\n  }\n\n  return (`,
  "photo-ready saved-action state",
  `setImageReadyByPipeline((prev) => ({`
);

fs.writeFileSync(pagePath, source);
console.log("Applied DealerKit due-in photo readiness workflow: 1–2 image alerts, Cars support, actionable review cards and refresh-safe counts.");
