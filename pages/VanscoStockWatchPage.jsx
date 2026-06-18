import { useEffect, useMemo, useState } from "react";
import {
  fetchCarMarketingVehicles,
  fetchFinanceMarketingVehicles,
  fetchRentMarketingVehicles,
} from "../services/marketingVehicles.js";
import {
  WATCH_PIPELINES,
  formatWatchTimestamp,
  pipelineLabel,
  sourceStatusLabel,
} from "../services/vanscoStockWatch.js";
import {
  fetchVanscoCacheRecords,
  processVanscoCacheBatch,
  refreshVanscoCacheUrls,
  saveVanscoWatchAction,
} from "../services/vanscoStockCache.js";

const DEFAULT_FILTERS = { finance: "missing", rent2buy: "missing", cars: "missing" };

const SIMPLE_FILTERS = [
  { value: "missing", label: "Missing from my stock" },
  { value: "local_not_vansco", label: "My stock not on Vansco" },
  { value: "advertised", label: "Advertised / Awaiting refresh" },
  { value: "reserved", label: "Reserved on Vansco" },
  { value: "back_in_stock", label: "Back in stock / Review hidden" },
  { value: "hidden", label: "Hidden" },
  { value: "never", label: "Never show again" },
  { value: "all", label: "All action cards" },
];

function normalizeWatchRegistration(value) {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!text || text.length < 5 || text.length > 8) return "";
  if (!/[A-Z]/.test(text) || !/[0-9]/.test(text)) return "";
  return text;
}

function isPlaceholderRegistration(registration) {
  return /^REG\d+HERE$/i.test(String(registration || ""));
}

function normalizeLocalStockRegistration(value) {
  const registration = normalizeWatchRegistration(value);
  return registration && !isPlaceholderRegistration(registration) ? registration : "";
}

function workflowStatusOf(record) {
  return String(record?.workflowStatus || record?.workflow_status || "").toLowerCase();
}

function isReservedLikeStatus(status) {
  return ["reserved", "sold", "deposit_taken"].includes(String(status || "").toLowerCase());
}

function isTemporaryHiddenStatus(status) {
  return status === "ignored" || status === "hidden";
}

function isAdvertisedStatus(status) {
  return status === "added_to_crm" || status === "marked_advertised" || status === "advertised_awaiting_refresh";
}

function isNeverShowStatus(status) {
  return status === "never_show_again" || status === "not_listing_spec" || status === "not_listing_price" || status === "not_listing_mileage";
}

function workflowLabel(status) {
  const value = String(status || "").toLowerCase();
  if (isAdvertisedStatus(value)) return "Advertised / Awaiting refresh";
  if (isTemporaryHiddenStatus(value)) return "Hidden";
  if (isNeverShowStatus(value)) return "Never show again";
  return "New";
}

function recordCheckedTimeMs(record) {
  const rawValue = record?.lastCheckedAt || record?.lastSuccessfullyCheckedAt || record?.updatedAt || record?.updated_at;
  const time = rawValue ? new Date(rawValue).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function recordSearchText(record) {
  return [record.registration, record.title, record.sourceStatus, record.workflowStatus, record.workflow_status, record.notes, record.stockUrl, record.localStockUrl]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function dedupeDisplayRecords(records) {
  const byKey = new Map();
  records.forEach((record) => {
    const registration = normalizeWatchRegistration(record.registration);
    const key = registration || record.stockUrl || record.vehicleKey || record.id;
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing || recordCheckedTimeMs(record) >= recordCheckedTimeMs(existing)) byKey.set(key, record);
  });
  return Array.from(byKey.values());
}

function dedupeLocalVehiclesByRegistration(vehicles) {
  const byReg = new Map();
  vehicles.forEach((vehicle, index) => {
    const registration = normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);
    if (!registration) return;
    if (!byReg.has(registration)) byReg.set(registration, { vehicle, index, registration });
  });
  return Array.from(byReg.values());
}

function mapLocalVehicleToWatchRecord(vehicle, index, selectedPipeline) {
  const registration = normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);
  const title = vehicle.title || vehicle.name || vehicle.registration || vehicle.reg || "Local CRM vehicle";
  const localStockUrl = vehicle.weblink || vehicle.webLink || vehicle.link || "";
  const imageUrl = vehicle.image || vehicle.picture || vehicle.imageUrl || vehicle.image_url || "";

  return {
    id: `local-not-vansco-${selectedPipeline}-${registration || index}`,
    title,
    registration,
    imageUrl,
    localStockUrl,
    pipeline: selectedPipeline,
    displayStatus: "local_not_vansco",
    matchStatus: "local_not_vansco",
    workflowStatus: "",
    sourceStatus: "",
    notes: "",
    safeExactRegistrationMatch: true,
  };
}

function classifyWatchRecord(record, localRegistrationSet, selectedPipeline, financeRegistrationsForCars = new Set()) {
  const registration = normalizeWatchRegistration(record.registration);
  const hasExactLocalMatch = Boolean(registration && localRegistrationSet?.has(registration));
  const hasFinanceMatchForCars = selectedPipeline === "cars" && !hasExactLocalMatch && Boolean(registration && financeRegistrationsForCars?.has(registration));
  const workflowStatus = workflowStatusOf(record);
  const reservedOnVansco = isReservedLikeStatus(record.sourceStatus);
  const currentlyOnVansco = record.isCurrentlyOnVansco !== false;
  const baseRecord = { ...record, pipeline: selectedPipeline, workflowStatus, safeExactRegistrationMatch: hasExactLocalMatch, financeStockMatchForCars: hasFinanceMatchForCars };

  if (!currentlyOnVansco) return { ...baseRecord, displayStatus: "hidden_not_current", matchStatus: "hidden_not_current" };
  if (!registration) return { ...baseRecord, displayStatus: "hidden_no_registration", matchStatus: "hidden_no_registration" };
  if (hasExactLocalMatch && reservedOnVansco) return { ...baseRecord, displayStatus: "reserved", matchStatus: "reserved_still_listed" };
  if (hasExactLocalMatch) return { ...baseRecord, displayStatus: "hidden_already_ok", matchStatus: "listed" };
  if (hasFinanceMatchForCars) return { ...baseRecord, displayStatus: "advertised", matchStatus: "advertised_in_finance_awaiting_refresh" };
  if (isNeverShowStatus(workflowStatus)) return { ...baseRecord, displayStatus: "never", matchStatus: "never_show_again" };
  if (isAdvertisedStatus(workflowStatus)) return { ...baseRecord, displayStatus: "advertised", matchStatus: "advertised_awaiting_refresh" };
  if (isTemporaryHiddenStatus(workflowStatus)) {
    if (!reservedOnVansco) return { ...baseRecord, displayStatus: "back_in_stock", matchStatus: "hidden_back_in_stock" };
    return { ...baseRecord, displayStatus: "hidden", matchStatus: "hidden" };
  }
  if (reservedOnVansco) return { ...baseRecord, displayStatus: "hidden_reserved_not_advertised", matchStatus: "hidden_reserved_not_advertised" };
  return { ...baseRecord, displayStatus: "missing", matchStatus: "missing" };
}

function SummaryCard({ label, value, tone = "default", onClick }) {
  const className = tone === "blue" ? "stat-card stat-card--blue" : tone === "amber" ? "stat-card stat-card--amber" : "stat-card";
  return (
    <article className={className} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
    </article>
  );
}

function SourceStatusBadge({ status }) {
  if (!status) return null;
  const badgeClass = `status-pill vansco-status-pill vansco-status-pill--${status || "unknown"}`;
  return <span className={badgeClass}>{sourceStatusLabel(status)}</span>;
}

function displayStatusLabel(status) {
  switch (status) {
    case "local_not_vansco": return "My stock not on Vansco";
    case "advertised": return "Advertised / Awaiting refresh";
    case "reserved": return "Reserved on Vansco";
    case "back_in_stock": return "Back in stock / Review hidden";
    case "hidden": return "Hidden";
    case "never": return "Never show again";
    default: return "Missing from my stock";
  }
}

function DisplayStatusBadge({ status }) {
  return <span className="tag">{displayStatusLabel(status)}</span>;
}

function PipelineBadge({ pipeline }) {
  return <span className="tag">{pipelineLabel(pipeline)}</span>;
}

function WatchCard({ record, selectedPipeline, onRecordSaved }) {
  const [notesDraft, setNotesDraft] = useState(record.notes || "");
  const [savingAction, setSavingAction] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    setNotesDraft(record.notes || "");
    setSaveMessage("");
    setSavingAction("");
  }, [record.id, record.notes, record.workflowStatus, record.displayStatus]);

  async function saveWorkflow(workflowStatus, message) {
    setSavingAction(workflowStatus);
    setSaveMessage("");
    try {
      const nextRecord = await saveVanscoWatchAction({ pipeline: selectedPipeline, record, workflowStatus, notes: notesDraft });
      onRecordSaved(record, nextRecord);
      setSaveMessage(message);
    } catch (error) {
      setSaveMessage(error.message || "Could not save.");
    } finally {
      setSavingAction("");
    }
  }

  const status = workflowStatusOf(record);
  const isHiddenOrNever = isTemporaryHiddenStatus(status) || isNeverShowStatus(status);
  const isAdvertised = isAdvertisedStatus(status) || record.displayStatus === "advertised";
  const isLocalNotVansco = record.displayStatus === "local_not_vansco";

  return (
    <article className="vansco-card">
      <div className="vansco-card__image-wrap">
        {record.imageUrl ? <img src={record.imageUrl} alt={record.title || "Vehicle"} className="vansco-card__image" /> : <div className="vansco-card__image vansco-card__image--placeholder">No image</div>}
      </div>
      <div className="vansco-card__body">
        <div className="vansco-card__badges"><PipelineBadge pipeline={selectedPipeline} /><DisplayStatusBadge status={record.displayStatus} /><SourceStatusBadge status={record.sourceStatus} /></div>
        <h3>{record.title || "Untitled vehicle"}</h3>
        <div className="vehicle-card__meta">Registration: {record.registration || "Not found"}</div>
        {isLocalNotVansco ? <div className="vehicle-card__meta">This registration is active in your CRM stock, but was not found in the current Vansco cache for this tab.</div> : null}
        {!isLocalNotVansco && record.safeExactRegistrationMatch ? <div className="vehicle-card__meta">This registration is currently in this CRM stock tab.</div> : null}
        {!isLocalNotVansco && record.financeStockMatchForCars ? <div className="vehicle-card__meta">This Cars vehicle registration is already active in Van Finance stock.</div> : null}
        {!isLocalNotVansco && record.lastSuccessfullyCheckedAt ? <div className="vehicle-card__meta">Status last checked: {formatWatchTimestamp(record.lastSuccessfullyCheckedAt)}</div> : null}
        {!isLocalNotVansco && record.lastError ? <div className="vehicle-card__meta">Last detail check issue: {record.lastError}</div> : null}
        {!isLocalNotVansco && (isHiddenOrNever || isAdvertised) ? <div className="vehicle-card__meta">Current status: {workflowLabel(status)}</div> : null}
        {!isLocalNotVansco ? <label className="field"><span className="field__label">Notes</span><textarea className="field__input field__textarea" rows="3" value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} placeholder="Optional notes for this stock check" /></label> : null}
        <div className="card-actions">
          {isLocalNotVansco && record.localStockUrl ? <a className="button button--ghost" href={record.localStockUrl} target="_blank" rel="noreferrer">Open my stock page</a> : null}
          {!isLocalNotVansco ? <a className="button button--ghost" href={record.stockUrl || "#"} target="_blank" rel="noreferrer">Open Vansco Page</a> : null}
          {!isLocalNotVansco && (isAdvertised ? <button className="button button--primary" type="button" onClick={() => saveWorkflow("new", "Unmarked")} disabled={Boolean(savingAction)}>{savingAction === "new" ? "Unmarking..." : "Unmark advertised"}</button> : isHiddenOrNever ? <button className="button button--primary" type="button" onClick={() => saveWorkflow("new", "Unhidden")} disabled={Boolean(savingAction)}>{savingAction === "new" ? "Unhiding..." : "Unhide"}</button> : <button className="button button--ghost" type="button" onClick={() => saveWorkflow("ignored", "Hidden")} disabled={Boolean(savingAction)}>{savingAction === "ignored" ? "Hiding..." : "Hide"}</button>)}
          {!isLocalNotVansco && record.displayStatus === "missing" ? <button className="button button--primary" type="button" onClick={() => saveWorkflow("added_to_crm", "Marked as advertised")} disabled={Boolean(savingAction)}>{savingAction === "added_to_crm" ? "Marking..." : "Mark as advertised"}</button> : null}
          {!isLocalNotVansco && !isNeverShowStatus(status) ? <button className="button button--primary" type="button" onClick={() => saveWorkflow("never_show_again", "Moved to Never show again")} disabled={Boolean(savingAction)}>{savingAction === "never_show_again" ? "Saving..." : "Never show again"}</button> : null}
        </div>
        {record.displayStatus === "back_in_stock" ? <div className="vehicle-card__meta">This was hidden before, but Vansco now shows it as available/unknown again.</div> : null}
        {record.displayStatus === "advertised" && record.financeStockMatchForCars ? <div className="vehicle-card__meta">Advisory only: counted as advertised for the Cars tab because the registration is active in Van Finance stock.</div> : null}
        {record.displayStatus === "advertised" && !record.financeStockMatchForCars ? <div className="vehicle-card__meta">You marked this as advertised during the day. Overnight refresh should remove it automatically once its registration is found in this CRM stock tab.</div> : null}
        {isLocalNotVansco ? <div className="vehicle-card__meta">Advisory only: check whether this van has sold or needs removing from your website stock.</div> : null}
        {saveMessage ? <div className="vehicle-card__meta">{saveMessage}</div> : null}
      </div>
    </article>
  );
}

async function fetchLocalVehiclesForPipeline(pipeline) {
  if (pipeline === "finance") return fetchFinanceMarketingVehicles(500);
  if (pipeline === "rent2buy") return fetchRentMarketingVehicles(500);
  if (pipeline === "cars") return fetchCarMarketingVehicles(500);
  return [];
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function countVehicleRegistrations(vehicles) {
  return new Set(
    (vehicles || [])
      .map((vehicle) => normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name))
      .filter(Boolean)
  ).size;
}

export default function VanscoStockWatchPage() {
  const [selectedPipeline, setSelectedPipeline] = useState("finance");
  const [filtersByPipeline, setFiltersByPipeline] = useState(DEFAULT_FILTERS);
  const [searchByPipeline, setSearchByPipeline] = useState({ finance: "", rent2buy: "", cars: "" });
  const [recordsByPipeline, setRecordsByPipeline] = useState({ finance: [], rent2buy: [], cars: [] });
  const [cacheSummaryByPipeline, setCacheSummaryByPipeline] = useState({ finance: null, rent2buy: null, cars: null });
  const [localRegistrationsByPipeline, setLocalRegistrationsByPipeline] = useState({ finance: new Set(), rent2buy: new Set(), cars: new Set() });
  const [localVehiclesByPipeline, setLocalVehiclesByPipeline] = useState({ finance: [], rent2buy: [], cars: [] });
  const [localLoadErrorByPipeline, setLocalLoadErrorByPipeline] = useState({ finance: "", rent2buy: "", cars: "" });
  const [loadingPipeline, setLoadingPipeline] = useState("");
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [reloadComparisonStatus, setReloadComparisonStatus] = useState("");
  const [reloadComparisonProgress, setReloadComparisonProgress] = useState(0);
  const [reloadComparisonRunning, setReloadComparisonRunning] = useState(false);
  const [debugByPipeline, setDebugByPipeline] = useState({ finance: null, rent2buy: null, cars: null });
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  async function loadPipeline(pipeline = selectedPipeline, options = {}) {
    setLoadingPipeline(pipeline);
    setErrorMessage("");
    try {
      const payload = await fetchVanscoCacheRecords(pipeline);
      setRecordsByPipeline((prev) => ({ ...prev, [pipeline]: payload.records || [] }));
      setCacheSummaryByPipeline((prev) => ({ ...prev, [pipeline]: payload.summary || null }));
      return payload;
    } catch (error) {
      setErrorMessage(error.message || "Could not load Vansco Stock Watch cache.");
      if (options.throwOnError) throw error;
    } finally {
      setLoadingPipeline("");
    }
  }

  async function loadLocalStock(pipeline = selectedPipeline, isActive = () => true) {
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
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: error.message || `Could not load ${pipelineLabel(pipeline)} local stock.` }));
      throw error;
    }
  }

  useEffect(() => {
    let active = true;
    loadLocalStock(selectedPipeline, () => active).catch(() => null);
    if (selectedPipeline === "cars") loadLocalStock("finance", () => active).catch(() => null);
    return () => { active = false; };
  }, [selectedPipeline]);

  useEffect(() => { loadPipeline(selectedPipeline); }, [selectedPipeline]);

  const activeFilter = filtersByPipeline[selectedPipeline] || "missing";
  const activeSearch = searchByPipeline[selectedPipeline] || "";
  const rawActiveRecords = recordsByPipeline[selectedPipeline] || [];
  const currentRawRecords = useMemo(() => dedupeDisplayRecords(rawActiveRecords), [rawActiveRecords]);
  const activeLocalRegistrations = localRegistrationsByPipeline[selectedPipeline] || new Set();
  const financeRegistrationsForCars = selectedPipeline === "cars" ? localRegistrationsByPipeline.finance || new Set() : new Set();
  const activeLocalVehicles = localVehiclesByPipeline[selectedPipeline] || [];
  const localLoadError = localLoadErrorByPipeline[selectedPipeline] || "";
  const cacheSummary = cacheSummaryByPipeline[selectedPipeline] || null;

  const activeRecords = useMemo(() => currentRawRecords.map((record) => classifyWatchRecord(record, activeLocalRegistrations, selectedPipeline, financeRegistrationsForCars)), [activeLocalRegistrations, currentRawRecords, financeRegistrationsForCars, selectedPipeline]);

  const currentVanscoRegistrationSet = useMemo(() => {
    const regs = currentRawRecords
      .filter((record) => record.isCurrentlyOnVansco !== false)
      .map((record) => normalizeWatchRegistration(record.registration))
      .filter(Boolean);
    return new Set(regs);
  }, [currentRawRecords]);

  const localNotVanscoRecords = useMemo(() => dedupeLocalVehiclesByRegistration(activeLocalVehicles)
    .filter(({ registration }) => registration && !currentVanscoRegistrationSet.has(registration))
    .map(({ vehicle, index }) => mapLocalVehicleToWatchRecord(vehicle, index, selectedPipeline)), [activeLocalVehicles, currentVanscoRegistrationSet, selectedPipeline]);

  const displayRecords = useMemo(() => [...activeRecords, ...localNotVanscoRecords], [activeRecords, localNotVanscoRecords]);

  const summary = useMemo(() => ({
    missing: activeRecords.filter((record) => record.displayStatus === "missing").length,
    localNotVansco: localNotVanscoRecords.length,
    advertised: activeRecords.filter((record) => record.displayStatus === "advertised").length,
    reserved: activeRecords.filter((record) => record.displayStatus === "reserved").length,
    backInStock: activeRecords.filter((record) => record.displayStatus === "back_in_stock").length,
    hidden: activeRecords.filter((record) => record.displayStatus === "hidden").length,
    never: activeRecords.filter((record) => record.displayStatus === "never").length,
    hiddenNoReg: activeRecords.filter((record) => record.displayStatus === "hidden_no_registration").length,
    hiddenReserved: activeRecords.filter((record) => record.displayStatus === "hidden_reserved_not_advertised").length,
    alreadyListed: activeRecords.filter((record) => record.displayStatus === "hidden_already_ok").length,
  }), [activeRecords, localNotVanscoRecords]);

  const filterCounts = useMemo(() => ({
    missing: summary.missing,
    local_not_vansco: summary.localNotVansco,
    advertised: summary.advertised,
    reserved: summary.reserved,
    back_in_stock: summary.backInStock,
    hidden: summary.hidden,
    never: summary.never,
    all:
      summary.missing +
      summary.localNotVansco +
      summary.advertised +
      summary.reserved +
      summary.backInStock +
      summary.hidden +
      summary.never,
  }), [summary]);

  const filteredRecords = useMemo(() => {
    const actionStatuses = ["missing", "local_not_vansco", "advertised", "reserved", "back_in_stock", "hidden", "never"];
    const byFilter = activeFilter === "all" ? displayRecords.filter((record) => actionStatuses.includes(record.displayStatus)) : displayRecords.filter((record) => record.displayStatus === activeFilter);
    const searchText = activeSearch.trim().toLowerCase();
    if (!searchText) return byFilter;
    return byFilter.filter((record) => recordSearchText(record).includes(searchText));
  }, [activeFilter, displayRecords, activeSearch]);

  const lastCheckedAt = useMemo(() => currentRawRecords.reduce((latest, record) => {
    const checked = record.lastCheckedAt || record.lastSuccessfullyCheckedAt;
    if (!checked) return latest;
    if (!latest) return checked;
    return new Date(checked) > new Date(latest) ? checked : latest;
  }, ""), [currentRawRecords]);

  async function handleRefreshCache() {
    setRefreshingCache(true);
    setErrorMessage("");
    setSuccessMessage("");
    setDebugByPipeline((prev) => ({ ...prev, [selectedPipeline]: null }));
    try {
      const urlResult = await refreshVanscoCacheUrls();
      const batchResult = await processVanscoCacheBatch();
      await loadPipeline(selectedPipeline);
      setSuccessMessage(`Vansco URL list refreshed: ${urlResult.urlsFound || 0} current URLs. Details checked: ${batchResult.successCount || 0} success, ${batchResult.failureCount || 0} failed, ${batchResult.remainingCount || 0} remaining.`);
      setDebugByPipeline((prev) => ({ ...prev, [selectedPipeline]: { urlResult, batchResult } }));
    } catch (error) {
      setErrorMessage(`${error.message || "Could not refresh Vansco cache."} Showing the latest saved cache if available.`);
    } finally {
      setRefreshingCache(false);
    }
  }

  async function handleReloadComparison() {
    setErrorMessage("");
    setSuccessMessage("");
    setReloadComparisonRunning(true);
    setReloadComparisonProgress(0);
    setReloadComparisonStatus("Refreshing comparison...");
    const pipeline = selectedPipeline;

    try {
      await wait(500);
      setReloadComparisonProgress(20);
      await wait(800);
      setReloadComparisonProgress(45);
      await wait(800);
      setReloadComparisonProgress(70);
      await wait(900);
      setReloadComparisonProgress(100);

      const localLoads = [
        loadLocalStock("finance"),
        loadLocalStock("rent2buy"),
      ];

      if (pipeline === "cars") {
        localLoads.push(loadLocalStock("cars"));
      }

      const [localVehiclesByReload, cachePayload] = await Promise.all([
        Promise.all(localLoads),
        loadPipeline(pipeline, { throwOnError: true }),
      ]);
      const [financeVehicles, rentVehicles, carsVehicles] = localVehiclesByReload;
      const cacheRecords = cachePayload?.records || [];
      const pipelineName = pipelineLabel(pipeline);
      const carsText = pipeline === "cars" ? ` Cars: ${(carsVehicles || []).length} vehicles / ${countVehicleRegistrations(carsVehicles)} registrations.` : "";
      const finalMessage = `Comparison refreshed successfully using latest local stock and saved Vansco cache. Pipeline: ${pipelineName}. Finance: ${(financeVehicles || []).length} vehicles / ${countVehicleRegistrations(financeVehicles)} registrations. Rent2Buy: ${(rentVehicles || []).length} vehicles / ${countVehicleRegistrations(rentVehicles)} registrations.${carsText} Saved Vansco cache records: ${cacheRecords.length}.`;

      setReloadComparisonStatus(finalMessage);
      setSuccessMessage(finalMessage);
    } catch (error) {
      const finalError = `Comparison refresh failed: ${error.message || "Could not reload comparison."}`;
      setReloadComparisonStatus(finalError);
      setErrorMessage(finalError);
    } finally {
      setReloadComparisonRunning(false);
    }
  }

  function handleRecordSaved(originalRecord, actionRecord) {
    const originalRegistration = normalizeWatchRegistration(originalRecord.registration);
    const savedRegistration = normalizeWatchRegistration(actionRecord.registration);
    setRecordsByPipeline((prev) => ({
      ...prev,
      [selectedPipeline]: prev[selectedPipeline].map((record) => {
        const recordRegistration = normalizeWatchRegistration(record.registration);
        const sameRecord = (savedRegistration && recordRegistration === savedRegistration) || (originalRegistration && recordRegistration === originalRegistration) || record.stockUrl === actionRecord.stockUrl || record.stockUrl === actionRecord.stock_url;
        return sameRecord ? { ...record, ...actionRecord, workflowStatus: workflowStatusOf(actionRecord) || workflowStatusOf(record), workflow_status: workflowStatusOf(actionRecord) || workflowStatusOf(record), notes: actionRecord.notes ?? record.notes } : record;
      }),
    }));
  }

  return (
    <div className="page-stack">
      <section className="panel hero-panel vansco-watch-panel">
        <div className="panel__header"><div><h3>Vansco Stock Watch</h3><p>Advisory-only comparison by registration. It never auto-adds, removes, posts, publishes, or edits stock.</p></div><div className="card-actions"><button className="button button--primary" type="button" onClick={handleRefreshCache} disabled={refreshingCache}>{refreshingCache ? "Refreshing cache..." : "Refresh Vansco cache"}</button><button className="button button--ghost" type="button" onClick={handleReloadComparison} disabled={reloadComparisonRunning || loadingPipeline === selectedPipeline}>{reloadComparisonRunning ? "Refreshing comparison..." : "Reload comparison"}</button></div></div>
        {reloadComparisonStatus ? (
          <div className="vansco-watch-note vansco-watch-note--warning">
            <strong>Reload comparison:</strong> {reloadComparisonStatus}
            {reloadComparisonRunning ? (
              <div style={{ marginTop: "8px", height: "8px", borderRadius: "999px", background: "#e5e7eb", overflow: "hidden" }}>
                <div style={{ width: `${reloadComparisonProgress}%`, height: "100%", borderRadius: "999px", background: "#2563eb", transition: "width 300ms ease" }} />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="segmented-control">{WATCH_PIPELINES.map((pipeline) => <button key={pipeline.value} className={selectedPipeline === pipeline.value ? "segment is-active" : "segment"} type="button" onClick={() => setSelectedPipeline(pipeline.value)}>{pipeline.label}</button>)}</div>
        <div className="stat-grid stat-grid--centered">
          <SummaryCard label={`Missing from ${pipelineLabel(selectedPipeline)}`} value={summary.missing} tone="blue" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "missing" }))} />
          <SummaryCard label="My stock not on Vansco" value={summary.localNotVansco} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "local_not_vansco" }))} />
          <SummaryCard label="Advertised / Awaiting refresh" value={summary.advertised} tone="blue" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "advertised" }))} />
          <SummaryCard label="Reserved on Vansco" value={summary.reserved} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "reserved" }))} />
          <SummaryCard label="Back in stock / Review hidden" value={summary.backInStock} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "back_in_stock" }))} />
          <SummaryCard label="Hidden" value={summary.hidden} onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "hidden" }))} />
          <SummaryCard label="Never show again" value={summary.never} onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "never" }))} />
          <SummaryCard label="Local CRM regs loaded" value={activeLocalRegistrations.size} />
        </div>
        <div className="vansco-watch-note"><strong>Daytime workflow:</strong> when you advertise a Missing vehicle but the Vansco refresh cannot run until overnight, use <strong>Mark as advertised</strong>. It leaves Missing immediately and sits in Advertised / Awaiting refresh until the registration is found in this CRM stock tab.</div>
        <div className="vansco-watch-note"><strong>My stock not on Vansco:</strong> this is the reverse registration-only check. It shows active vehicles in your CRM stock tab where the registration is not in the current Vansco cache, helping you spot sold/removed vans that may still be advertised by you.</div>
        <div className="vansco-watch-note"><strong>Back in stock rule:</strong> hidden vehicles only appear there when Vansco is currently available/unknown, the vehicle is still on Vansco, and it is not already in this CRM stock tab. Use <strong>Never show again</strong> for vehicles you will not advertise so they do not inflate the review number.</div>
        <div className="vansco-watch-note"><strong>Accuracy check:</strong> {pipelineLabel(selectedPipeline)} has {activeLocalRegistrations.size} local CRM registrations loaded.{cacheSummary ? ` Vansco cache for this tab has ${cacheSummary.currentPipelineUrlCount ?? "?"} current URLs and ${cacheSummary.usableCachedRegistrations ?? cacheSummary.cachedRegs ?? "?"} usable registrations.` : ""}{lastCheckedAt ? ` Latest detail check: ${formatWatchTimestamp(lastCheckedAt)}.` : ""}</div>
        {selectedPipeline === "cars" ? <div className="vansco-watch-note"><strong>Cars secondary check:</strong> Cars stay separate, but this view also checks {financeRegistrationsForCars.size} active Van Finance registrations so Cars already advertised through Van Finance do not stay in Missing.</div> : null}
        {selectedPipeline === "cars" ? <div className="vansco-watch-note vansco-watch-note--warning">Cars local stock source is not confirmed yet. This page loaded {activeLocalRegistrations.size} local Cars registrations. Check the Cars Supabase table name/fields before relying on Cars results.</div> : null}
        {localLoadError ? <div className="error-banner">{localLoadError}</div> : null}{errorMessage ? <div className="error-banner">{errorMessage}</div> : null}{successMessage ? <div className="success-banner">{successMessage}</div> : null}
        <div className="vansco-watch-note">Hidden from working cards: {summary.alreadyListed} already listed/available, {summary.hiddenReserved} reserved but not advertised in this tab, {summary.hiddenNoReg} no valid registration. Advertised, Hide and Never Show Again are stored per tab. My stock not on Vansco is advisory only and does not save actions.</div>
        <div className="segmented-control">{SIMPLE_FILTERS.map((filter) => <button key={filter.value} className={activeFilter === filter.value ? "segment is-active" : "segment"} type="button" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: filter.value }))}>{filter.label} ({filterCounts[filter.value] ?? 0})</button>)}</div>
        <label className="field"><span className="field__label">Search this view</span><input className="field__input" value={activeSearch} onChange={(event) => setSearchByPipeline((prev) => ({ ...prev, [selectedPipeline]: event.target.value }))} placeholder="Search registration, title, status or notes" /></label>
        <div className="card-actions"><button className="button button--ghost" type="button" onClick={() => setShowDiagnostics((value) => !value)}>{showDiagnostics ? "Hide accuracy details" : "Show accuracy details"}</button></div>
        {showDiagnostics ? <pre className="diagnostics-panel">{JSON.stringify({ selectedPipeline, localRegsLoaded: activeLocalRegistrations.size, financeRegsUsedForCars: selectedPipeline === "cars" ? financeRegistrationsForCars.size : 0, vanscoCurrentRegsLoaded: currentVanscoRegistrationSet.size, localNotVansco: summary.localNotVansco, localLoadError, cacheSummary, actionSummary: summary, debug: debugByPipeline[selectedPipeline] }, null, 2)}</pre> : null}
      </section>
      <section className="panel"><div className="panel__header"><div><h3>{SIMPLE_FILTERS.find((filter) => filter.value === activeFilter)?.label || "Action cards"}</h3><p>{filteredRecords.length} advisory cards for {pipelineLabel(selectedPipeline)}.</p></div><span className="status-pill">{filteredRecords.length} shown</span></div>{loadingPipeline === selectedPipeline ? <div className="empty-state">Loading Vansco comparison...</div> : filteredRecords.length === 0 ? <div className="empty-state">No vehicles in this view.</div> : <div className="vansco-card-grid">{filteredRecords.map((record) => {
        return (
          <WatchCard
            key={normalizeWatchRegistration(record.registration) || record.stockUrl || record.localStockUrl || record.id}
            record={record}
            selectedPipeline={selectedPipeline}
            onRecordSaved={handleRecordSaved}
          />
        );
      })}</div>}</section>
    </div>
  );
}
