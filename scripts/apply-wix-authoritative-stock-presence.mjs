import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetUrl = new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url);
const targetPath = fileURLToPath(targetUrl);
let source = fs.readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Wix authoritative Stock Watch transform could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Wix authoritative Stock Watch transform found duplicate anchor: ${label}`);
  }
  source = source.replace(before, after);
}

if (!source.includes('from "../services/stockWatchWixListingPresence.js"')) {
  replaceOnce(
`} from "../services/vanscoStockCache.js";`,
`} from "../services/vanscoStockCache.js";
import { fetchStockWatchWixListingPresence } from "../services/stockWatchWixListingPresence.js";`,
    "Vansco stock cache import"
  );

  replaceOnce(
`  async function loadLocalStock(pipeline = selectedPipeline, isActive = () => true) {
    try {
      const vehicles = await fetchLocalVehiclesForPipeline(pipeline);
      if (!isActive()) return;
      const regs = vehicles.map((vehicle) => normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name)).filter(Boolean);
      setLocalVehiclesByPipeline((prev) => ({ ...prev, [pipeline]: vehicles }));
      setLocalRegistrationsByPipeline((prev) => ({ ...prev, [pipeline]: new Set(regs) }));
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: "" }));
      return vehicles;
    } catch (error) {
      if (!isActive()) return;
      setLocalVehiclesByPipeline((prev) => ({ ...prev, [pipeline]: [] }));
      setLocalRegistrationsByPipeline((prev) => ({ ...prev, [pipeline]: new Set() }));
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: error.message || \`Could not load \${pipelineLabel(pipeline)} local stock.\` }));
      throw error;
    }
  }`,
`  async function loadLocalStock(pipeline = selectedPipeline, isActive = () => true) {
    try {
      const vehicles = await fetchLocalVehiclesForPipeline(pipeline);
      const vehicleRegistrations = vehicles
        .map((vehicle) => normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name))
        .filter(Boolean);

      let effectiveRegistrations = vehicleRegistrations;
      let effectiveVehicles = vehicles;
      let presenceWarning = "";

      if (pipeline === "cars" || pipeline === "rent2buy") {
        try {
          const presence = await fetchStockWatchWixListingPresence(pipeline);
          if (presence.complete) {
            effectiveRegistrations = (presence.registrations || []).map(normalizeLocalStockRegistration).filter(Boolean);
            const liveRegistrationSet = new Set(effectiveRegistrations);
            effectiveVehicles = vehicles.filter((vehicle) => {
              const registration = normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);
              return Boolean(registration && liveRegistrationSet.has(registration));
            });
          } else {
            presenceWarning = "Live Wix listing presence was only partially checked, so Stock Watch is temporarily using the Marketing CRM stock fallback.";
          }
        } catch (presenceError) {
          presenceWarning = \`Could not confirm live Wix listing presence, so Stock Watch is temporarily using the Marketing CRM stock fallback: \${presenceError?.message || "Wix check failed."}\`;
        }
      }

      if (!isActive()) return;
      setLocalVehiclesByPipeline((prev) => ({ ...prev, [pipeline]: effectiveVehicles }));
      setLocalRegistrationsByPipeline((prev) => ({ ...prev, [pipeline]: new Set(effectiveRegistrations) }));
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: presenceWarning }));
      return effectiveVehicles;
    } catch (error) {
      if (!isActive()) return;
      setLocalVehiclesByPipeline((prev) => ({ ...prev, [pipeline]: [] }));
      setLocalRegistrationsByPipeline((prev) => ({ ...prev, [pipeline]: new Set() }));
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: error.message || \`Could not load \${pipelineLabel(pipeline)} local stock.\` }));
      throw error;
    }
  }`,
    "loadLocalStock"
  );

  source = source
    .replace("This registration is currently in this CRM stock tab.", "This registration is currently live in the stock listing source used for this tab.")
    .replace("Local CRM regs loaded", "Live stock regs loaded")
    .replace("local CRM registrations loaded", "live stock registrations loaded")
    .replace("Cars local stock source is not confirmed yet. This page loaded {activeLocalRegistrations.size} local Cars registrations. Check the Cars Supabase table name/fields before relying on Cars results.", "Cars Stock Watch uses live CAR FINANCE Wix listing state as the authority. The Marketing CRM car table is used only for supporting card details.");
}

if (!source.includes('from "../services/vanscoImageReadiness.js"')) {
  replaceOnce(
`import { fetchStockWatchWixListingPresence } from "../services/stockWatchWixListingPresence.js";`,
`import { fetchStockWatchWixListingPresence } from "../services/stockWatchWixListingPresence.js";
import { fetchVanscoImageReadiness } from "../services/vanscoImageReadiness.js";`,
    "image readiness service import"
  );
}

if (!source.includes('{ value: "images_ready", label: "New Vansco photos ready" }')) {
  replaceOnce(
`  { value: "missing", label: "Missing from my stock" },`,
`  { value: "missing", label: "Missing from my stock" },
  { value: "images_ready", label: "New Vansco photos ready" },`,
    "image readiness filter"
  );
}

if (!source.includes('case "images_ready": return "New Vansco photos ready";')) {
  replaceOnce(
`    case "local_not_vansco": return "My stock not on Vansco";`,
`    case "images_ready": return "New Vansco photos ready";
    case "local_not_vansco": return "My stock not on Vansco";`,
    "image readiness display label"
  );
}

if (!source.includes("function ImageReadyCard({ record })")) {
  replaceOnce(
`function WatchCard({ record, selectedPipeline, onRecordSaved }) {`,
`function ImageReadyCard({ record }) {
  return (
    <article className="vansco-card">
      <div className="vansco-card__image-wrap">
        {record.imageUrl ? <img src={record.imageUrl} alt={record.title || "Vehicle"} className="vansco-card__image" /> : <div className="vansco-card__image vansco-card__image--placeholder">No image</div>}
      </div>
      <div className="vansco-card__body">
        <div className="vansco-card__badges"><PipelineBadge pipeline={record.pipeline} /><DisplayStatusBadge status="images_ready" /><SourceStatusBadge status={record.sourceStatus} /></div>
        <h3>{record.title || "Vehicle photos ready"}</h3>
        <div className="vehicle-card__meta">Registration: {record.registration}</div>
        <div className="vehicle-card__meta"><strong>Main CMS vehicle page:</strong> {record.cmsImageCount} image</div>
        <div className="vehicle-card__meta"><strong>Vansco now has:</strong> {record.sourceImageCount} vehicle images</div>
        <div className="vehicle-card__meta">This vehicle already matches the correct CRM and its main CMS vehicle page. Add the newer Vansco gallery images to that page.</div>
        {record.sourceCheckedAt ? <div className="vehicle-card__meta">Vansco images checked: {formatWatchTimestamp(record.sourceCheckedAt)}</div> : null}
        <div className="card-actions">
          {record.localStockUrl ? <a className="button button--primary" href={record.localStockUrl} target="_blank" rel="noreferrer">Open my vehicle page</a> : null}
          {record.stockUrl ? <a className="button button--ghost" href={record.stockUrl} target="_blank" rel="noreferrer">Open Vansco Page</a> : null}
        </div>
      </div>
    </article>
  );
}

function WatchCard({ record, selectedPipeline, onRecordSaved }) {`,
    "image readiness card"
  );
}

if (!source.includes("const [imageReadyByPipeline, setImageReadyByPipeline]")) {
  replaceOnce(
`  const [showDiagnostics, setShowDiagnostics] = useState(false);`,
`  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [imageReadyByPipeline, setImageReadyByPipeline] = useState({ finance: [], rent2buy: [], cars: [] });
  const [imageReadySummaryByPipeline, setImageReadySummaryByPipeline] = useState({ finance: null, rent2buy: null, cars: null });
  const [imageReadyErrorByPipeline, setImageReadyErrorByPipeline] = useState({ finance: "", rent2buy: "", cars: "" });`,
    "image readiness state"
  );
}

if (!source.includes("async function loadImageReadiness(pipeline = selectedPipeline")) {
  replaceOnce(
`  useEffect(() => {
    let active = true;
    loadLocalStock(selectedPipeline, () => active).catch(() => null);`,
`  async function loadImageReadiness(pipeline = selectedPipeline, isActive = () => true) {
    if (pipeline === "cars") {
      if (isActive()) {
        setImageReadyByPipeline((prev) => ({ ...prev, cars: [] }));
        setImageReadySummaryByPipeline((prev) => ({ ...prev, cars: { imageUpdatesReady: 0, complete: true } }));
        setImageReadyErrorByPipeline((prev) => ({ ...prev, cars: "" }));
      }
      return { alerts: [], summary: { imageUpdatesReady: 0, complete: true } };
    }

    try {
      const payload = await fetchVanscoImageReadiness(pipeline);
      if (!isActive()) return payload;
      setImageReadyByPipeline((prev) => ({ ...prev, [pipeline]: payload.alerts || [] }));
      setImageReadySummaryByPipeline((prev) => ({ ...prev, [pipeline]: payload.summary || null }));
      setImageReadyErrorByPipeline((prev) => ({ ...prev, [pipeline]: "" }));
      return payload;
    } catch (error) {
      if (!isActive()) return null;
      setImageReadyByPipeline((prev) => ({ ...prev, [pipeline]: [] }));
      setImageReadySummaryByPipeline((prev) => ({ ...prev, [pipeline]: null }));
      setImageReadyErrorByPipeline((prev) => ({ ...prev, [pipeline]: error.message || "Could not check Vansco image readiness." }));
      return null;
    }
  }

  useEffect(() => {
    let active = true;
    loadLocalStock(selectedPipeline, () => active).catch(() => null);
    loadImageReadiness(selectedPipeline, () => active);`,
    "image readiness loader"
  );
}

if (!source.includes("const imageReadyRecords = imageReadyByPipeline[selectedPipeline]")) {
  replaceOnce(
`  const cacheSummary = cacheSummaryByPipeline[selectedPipeline] || null;`,
`  const cacheSummary = cacheSummaryByPipeline[selectedPipeline] || null;
  const imageReadyRecords = imageReadyByPipeline[selectedPipeline] || [];
  const imageReadySummary = imageReadySummaryByPipeline[selectedPipeline] || null;
  const imageReadyError = imageReadyErrorByPipeline[selectedPipeline] || "";`,
    "active image readiness state"
  );
}

if (!source.includes("...imageReadyRecords, ...activeRecords")) {
  replaceOnce(
`  const displayRecords = useMemo(() => [...activeRecords, ...localNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, localNotVanscoRecords, priceDifferenceRecords]);`,
`  const displayRecords = useMemo(() => [...imageReadyRecords, ...activeRecords, ...localNotVanscoRecords, ...priceDifferenceRecords], [activeRecords, imageReadyRecords, localNotVanscoRecords, priceDifferenceRecords]);`,
    "image readiness display records"
  );
}

if (!source.includes("imagesReady: imageReadyRecords.length")) {
  replaceOnce(
`  const summary = useMemo(() => ({
    missing: activeRecords.filter((record) => record.displayStatus === "missing").length,`,
`  const summary = useMemo(() => ({
    imagesReady: imageReadyRecords.length,
    missing: activeRecords.filter((record) => record.displayStatus === "missing").length,`,
    "image readiness summary count"
  );
  replaceOnce(
`  }), [activeRecords, localNotVanscoRecords, priceDifferenceRecords]);`,
`  }), [activeRecords, imageReadyRecords, localNotVanscoRecords, priceDifferenceRecords]);`,
    "image readiness summary dependencies"
  );
}

if (!source.includes("images_ready: summary.imagesReady")) {
  replaceOnce(
`  const filterCounts = useMemo(() => ({
    missing: summary.missing,`,
`  const filterCounts = useMemo(() => ({
    missing: summary.missing,
    images_ready: summary.imagesReady,`,
    "image readiness filter count"
  );
}

if (!source.includes('["missing", "images_ready", "local_not_vansco"')) {
  replaceOnce(
`    const actionStatuses = ["missing", "local_not_vansco", "price_difference", "advertised", "reserved", "back_in_stock", "hidden", "never"];`,
`    const actionStatuses = ["missing", "images_ready", "local_not_vansco", "price_difference", "advertised", "reserved", "back_in_stock", "hidden", "never"];`,
    "image readiness action status"
  );
}

if (!source.includes('label="New Vansco photos ready" value={summary.imagesReady}')) {
  replaceOnce(
`          <SummaryCard label={\`Missing from \${pipelineLabel(selectedPipeline)}\`} value={summary.missing} tone="blue" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "missing" }))} />`,
`          <SummaryCard label={\`Missing from \${pipelineLabel(selectedPipeline)}\`} value={summary.missing} tone="blue" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "missing" }))} />
          {selectedPipeline !== "cars" ? <SummaryCard label="New Vansco photos ready" value={summary.imagesReady} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "images_ready" }))} /> : null}`,
    "image readiness summary card"
  );
}

if (!source.includes("Photo update needed:")) {
  replaceOnce(
`        {selectedPipeline === "finance" ? <div className="vansco-watch-note"><strong>Price differences:</strong> Van Finance only. It compares exact registration matches where both prices and VAT basis are clear. It never changes Wix or Vansco prices.</div> : null}`,
`        {selectedPipeline === "finance" ? <div className="vansco-watch-note"><strong>Price differences:</strong> Van Finance only. It compares exact registration matches where both prices and VAT basis are clear. It never changes Wix or Vansco prices.</div> : null}
        {selectedPipeline !== "cars" ? <div className="vansco-watch-note"><strong>Image readiness:</strong> this checks only registrations already advertised in this CRM and matching a main CMS vehicle page. If that page still has exactly one image and Vansco now has multiple vehicle photos, it appears in New Vansco photos ready. Once your CMS page has multiple images, later Vansco image additions are ignored.</div> : null}
        {imageReadyRecords.length ? <div className="vansco-watch-note vansco-watch-note--warning"><strong>Photo update needed:</strong> {imageReadyRecords.length} {imageReadyRecords.length === 1 ? "vehicle has" : "vehicles have"} newer Vansco photos ready to add to the main CMS vehicle page.</div> : null}
        {selectedPipeline !== "cars" && imageReadySummary && !imageReadySummary.complete ? <div className="vansco-watch-note vansco-watch-note--warning">Vansco image counts are waiting for the next complete stock refresh before image-readiness alerts can be trusted.</div> : null}
        {imageReadyError ? <div className="error-banner">Image readiness check: {imageReadyError}</div> : null}`,
    "image readiness explanation"
  );
}

if (!source.includes("imageReadiness: imageReadySummary")) {
  replaceOnce(
`{JSON.stringify({ selectedPipeline, localRegsLoaded: activeLocalRegistrations.size, financeRegsUsedForCars: selectedPipeline === "cars" ? financeRegistrationsForCars.size : 0, vanscoCurrentRegsLoaded: currentVanscoRegistrationSet.size, localNotVansco: summary.localNotVansco, priceDifferences: summary.priceDifference, localLoadError, cacheSummary, actionSummary: summary, debug: debugByPipeline[selectedPipeline] }, null, 2)}`,
`{JSON.stringify({ selectedPipeline, localRegsLoaded: activeLocalRegistrations.size, financeRegsUsedForCars: selectedPipeline === "cars" ? financeRegistrationsForCars.size : 0, vanscoCurrentRegsLoaded: currentVanscoRegistrationSet.size, localNotVansco: summary.localNotVansco, priceDifferences: summary.priceDifference, imageReadiness: imageReadySummary, localLoadError, cacheSummary, actionSummary: summary, debug: debugByPipeline[selectedPipeline] }, null, 2)}`,
    "image readiness diagnostics"
  );
}

if (!source.includes('record.displayStatus === "images_ready" ? <ImageReadyCard')) {
  replaceOnce(
`{filteredRecords.map((record) => record.displayStatus === "price_difference" ? <PriceDifferenceCard key={record.id} record={record} /> : <WatchCard key={normalizeWatchRegistration(record.registration) || record.stockUrl || record.localStockUrl || record.id} record={record} selectedPipeline={selectedPipeline} onRecordSaved={handleRecordSaved} />)}`,
`{filteredRecords.map((record) => record.displayStatus === "price_difference" ? <PriceDifferenceCard key={record.id} record={record} /> : record.displayStatus === "images_ready" ? <ImageReadyCard key={record.id} record={record} /> : <WatchCard key={normalizeWatchRegistration(record.registration) || record.stockUrl || record.localStockUrl || record.id} record={record} selectedPipeline={selectedPipeline} onRecordSaved={handleRecordSaved} />)}`,
    "image readiness card rendering"
  );
}

if (!source.includes("await loadImageReadiness(selectedPipeline);")) {
  replaceOnce(
`      await loadPipeline(selectedPipeline);
      setSuccessMessage(\`Vansco URL list refreshed: \${urlResult.urlsFound || 0} current URLs. Details checked: \${batchResult.successCount || 0} success, \${batchResult.failureCount || 0} failed, \${batchResult.remainingCount || 0} remaining.\`);`,
`      await loadPipeline(selectedPipeline);
      await loadImageReadiness(selectedPipeline);
      setSuccessMessage(\`Vansco URL list refreshed: \${urlResult.urlsFound || 0} current URLs. Details checked: \${batchResult.successCount || 0} success, \${batchResult.failureCount || 0} failed, \${batchResult.remainingCount || 0} remaining.\`);`,
    "image readiness refresh"
  );
}

fs.writeFileSync(targetPath, source);
console.log("Applied authoritative live Wix listing presence and Vansco image-readiness alerts to Stock Watch comparisons.");

const refreshUrl = new URL("../api/vansco-cache-live-refresh.js", import.meta.url);
const refreshPath = fileURLToPath(refreshUrl);
let refreshSource = fs.readFileSync(refreshPath, "utf8");

function replaceRefreshOnce(before, after, label) {
  const first = refreshSource.indexOf(before);
  if (first === -1) throw new Error(`Vansco image-count transform could not find: ${label}`);
  if (refreshSource.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Vansco image-count transform found duplicate anchor: ${label}`);
  }
  refreshSource = refreshSource.replace(before, after);
}

if (!refreshSource.includes('from "./_vansco-image-gallery.js"')) {
  replaceRefreshOnce(
`} from "./_vansco-cache-utils.js";`,
`} from "./_vansco-cache-utils.js";
import { countVanscoVehicleImages } from "./_vansco-image-gallery.js";`,
    "image gallery import"
  );
}

if (!refreshSource.includes("async function getLatestImageCountSnapshot")) {
  replaceRefreshOnce(
`async function processOne(supabase, row) {`,
`async function getLatestImageCountSnapshot(supabase, currentRunId) {
  const { data, error } = await supabase
    .from(REFRESH_RUNS_TABLE)
    .select("id, last_result")
    .order("updated_at", { ascending: false })
    .limit(12);

  if (error) throw error;

  for (const row of data || []) {
    if (row.id === currentRunId) continue;
    const snapshot = row?.last_result?.imageCountsByRegistration;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Object.keys(snapshot).length) continue;
    return snapshot;
  }

  return {};
}

async function processOne(supabase, row) {`,
    "previous image-count snapshot helper"
  );
}

if (!refreshSource.includes("const sourceImageCount = countVanscoVehicleImages")) {
  replaceRefreshOnce(
`    const parsed = parseDetailHtml(row.stock_url, page.html, row.title || vehicleTitleFromUrl(row.stock_url));
    const { rejected_registration_candidates: rejectedRegistrationCandidates = [], ...cacheFields } = parsed;`,
`    const parsed = parseDetailHtml(row.stock_url, page.html, row.title || vehicleTitleFromUrl(row.stock_url));
    const sourceImageCount = countVanscoVehicleImages(page.html, row.stock_url);
    const { rejected_registration_candidates: rejectedRegistrationCandidates = [], ...cacheFields } = parsed;`,
    "source image count extraction"
  );
  replaceRefreshOnce(
`      imageFound: Boolean(parsed.image_url),
      rejectedRegistrationCandidates,`,
`      imageFound: Boolean(parsed.image_url),
      sourceImageCount,
      rejectedRegistrationCandidates,`,
    "source image count result"
  );
}

if (!refreshSource.includes("const imageCountsByRegistration = {")) {
  replaceRefreshOnce(
`    run = await updateRun(supabase, run.id, { stage: "processing_dragon_details", last_batch_size: batchSize });

    const runStartedAt = run.started_at;`,
`    run = await updateRun(supabase, run.id, { stage: "processing_dragon_details", last_batch_size: batchSize });

    const previousImageCounts = await getLatestImageCountSnapshot(supabase, run.id);
    const currentRunImageCounts = run?.last_result?.imageCountsByRegistration;
    const imageCountsByRegistration = {
      ...previousImageCounts,
      ...(currentRunImageCounts && typeof currentRunImageCounts === "object" && !Array.isArray(currentRunImageCounts) ? currentRunImageCounts : {}),
    };

    const runStartedAt = run.started_at;`,
    "image-count snapshot initialization"
  );
}

if (!refreshSource.includes("imageCountsByRegistration[result.registration]")) {
  replaceRefreshOnce(
`        results.push(await processOne(supabase, row));`,
`        const result = await processOne(supabase, row);
        results.push(result);
        if (result?.ok && result.registration && Number.isFinite(Number(result.sourceImageCount))) {
          imageCountsByRegistration[result.registration] = Number(result.sourceImageCount);
        }`,
    "image-count snapshot update"
  );
}

if (!refreshSource.includes("latestBatchResults: results.slice(-3),\n          imageCountsByRegistration,")) {
  replaceRefreshOnce(
`          latestBatchResults: results.slice(-3),
          latestFailedDetails,`,
`          latestBatchResults: results.slice(-3),
          imageCountsByRegistration,
          latestFailedDetails,`,
    "mid-run image-count snapshot"
  );
}

if (!refreshSource.includes("processedThisBatch: results.length,\n        imageCountsByRegistration,")) {
  replaceRefreshOnce(
`        processedThisBatch: results.length,
        successThisBatch: results.filter((item) => item.ok).length,`,
`        processedThisBatch: results.length,
        imageCountsByRegistration,
        successThisBatch: results.filter((item) => item.ok).length,`,
    "final image-count snapshot"
  );
}

fs.writeFileSync(refreshPath, refreshSource);
console.log("Applied Vansco per-registration image-count snapshots to the live refresh.");
