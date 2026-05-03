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
  workflowLabel,
} from "../services/vanscoStockWatch.js";
import {
  fetchVanscoCacheRecords,
  processVanscoCacheBatch,
  refreshVanscoCacheUrls,
  saveVanscoWatchAction,
} from "../services/vanscoStockCache.js";

const DEFAULT_FILTERS = {
  finance: "missing",
  rent2buy: "missing",
  cars: "missing",
};

const SIMPLE_FILTERS = [
  { value: "missing", label: "Missing from my stock" },
  { value: "reserved", label: "Reserved on Vansco" },
  { value: "ignored", label: "Ignored / Blocked" },
  { value: "all", label: "All action cards" },
];

function normalizeWatchRegistration(value) {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!text || text.length < 5 || text.length > 8) return "";
  if (!/[A-Z]/.test(text) || !/[0-9]/.test(text)) return "";
  return text;
}

function isReservedLikeStatus(status) {
  return ["reserved", "sold", "deposit_taken"].includes(String(status || "").toLowerCase());
}

function isBlockedStatus(workflowStatus) {
  return workflowStatus === "ignored" || String(workflowStatus || "").startsWith("not_listing_");
}

function recordCheckedTimeMs(record) {
  const rawValue = record?.lastCheckedAt || record?.lastSuccessfullyCheckedAt || record?.updatedAt || record?.updated_at;
  const time = rawValue ? new Date(rawValue).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function dedupeDisplayRecords(records) {
  const byKey = new Map();

  records.forEach((record) => {
    const registration = normalizeWatchRegistration(record.registration);
    const key = registration || record.stockUrl || record.vehicleKey || record.id;
    if (!key) return;

    const existing = byKey.get(key);
    if (!existing || recordCheckedTimeMs(record) >= recordCheckedTimeMs(existing)) {
      byKey.set(key, record);
    }
  });

  return Array.from(byKey.values());
}

function classifyWatchRecord(record, localRegistrationSet, selectedPipeline) {
  const registration = normalizeWatchRegistration(record.registration);
  const hasExactLocalMatch = registration && localRegistrationSet?.has(registration);
  const blocked = isBlockedStatus(record.workflowStatus);
  const reservedOnVansco = isReservedLikeStatus(record.sourceStatus);
  const currentlyOnVansco = record.isCurrentlyOnVansco !== false;

  if (blocked) {
    return {
      ...record,
      pipeline: selectedPipeline,
      displayStatus: "ignored",
      safeExactRegistrationMatch: Boolean(hasExactLocalMatch),
    };
  }

  if (!currentlyOnVansco) {
    return {
      ...record,
      pipeline: selectedPipeline,
      displayStatus: "hidden_not_current",
      safeExactRegistrationMatch: Boolean(hasExactLocalMatch),
    };
  }

  if (!registration) {
    return {
      ...record,
      pipeline: selectedPipeline,
      displayStatus: "hidden_no_registration",
      safeExactRegistrationMatch: false,
    };
  }

  if (hasExactLocalMatch && reservedOnVansco) {
    return {
      ...record,
      pipeline: selectedPipeline,
      displayStatus: "reserved",
      matchStatus: "reserved_still_listed",
      safeExactRegistrationMatch: true,
    };
  }

  if (reservedOnVansco && !hasExactLocalMatch) {
    return {
      ...record,
      pipeline: selectedPipeline,
      displayStatus: "hidden_reserved_not_advertised",
      safeExactRegistrationMatch: false,
    };
  }

  if (!hasExactLocalMatch) {
    return {
      ...record,
      pipeline: selectedPipeline,
      displayStatus: "missing",
      matchStatus: "missing",
      safeExactRegistrationMatch: false,
    };
  }

  return {
    ...record,
    pipeline: selectedPipeline,
    displayStatus: "hidden_already_ok",
    matchStatus: "listed",
    safeExactRegistrationMatch: true,
  };
}

function SummaryCard({ label, value, tone = "default" }) {
  const className = tone === "blue"
    ? "stat-card stat-card--blue"
    : tone === "amber"
      ? "stat-card stat-card--amber"
      : "stat-card";

  return (
    <article className={className}>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
    </article>
  );
}

function SourceStatusBadge({ status }) {
  const badgeClass = `status-pill vansco-status-pill vansco-status-pill--${status || "unknown"}`;
  return <span className={badgeClass}>{sourceStatusLabel(status)}</span>;
}

function DisplayStatusBadge({ status }) {
  const label = status === "reserved"
    ? "Reserved on Vansco"
    : status === "ignored"
      ? "Ignored / Blocked"
      : "Missing from my stock";

  return <span className="tag">{label}</span>;
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
  }, [record.id, record.notes, record.workflowStatus]);

  async function saveWorkflow(workflowStatus, message) {
    setSavingAction(workflowStatus);
    setSaveMessage("");

    try {
      const nextRecord = await saveVanscoWatchAction({
        pipeline: selectedPipeline,
        record,
        workflowStatus,
        notes: notesDraft,
      });
      onRecordSaved(record, nextRecord);
      setSaveMessage(message);
    } catch (error) {
      setSaveMessage(error.message || "Could not save.");
    } finally {
      setSavingAction("");
    }
  }

  const isIgnored = isBlockedStatus(record.workflowStatus);

  return (
    <article className="vansco-card">
      <div className="vansco-card__image-wrap">
        {record.imageUrl ? (
          <img src={record.imageUrl} alt={record.title || "Vehicle"} className="vansco-card__image" />
        ) : (
          <div className="vansco-card__image vansco-card__image--placeholder">No image</div>
        )}
      </div>

      <div className="vansco-card__body">
        <div className="vansco-card__badges">
          <PipelineBadge pipeline={selectedPipeline} />
          <DisplayStatusBadge status={record.displayStatus} />
          <SourceStatusBadge status={record.sourceStatus} />
        </div>

        <h3>{record.title || "Untitled vehicle"}</h3>
        <div className="vehicle-card__meta">Registration: {record.registration || "Not found"}</div>
        {record.safeExactRegistrationMatch ? (
          <div className="vehicle-card__meta">This registration is currently in this CRM stock tab.</div>
        ) : null}
        {record.lastSuccessfullyCheckedAt ? (
          <div className="vehicle-card__meta">Status last checked: {formatWatchTimestamp(record.lastSuccessfullyCheckedAt)}</div>
        ) : null}
        {record.lastError ? <div className="vehicle-card__meta">Last detail check issue: {record.lastError}</div> : null}
        {isIgnored ? <div className="vehicle-card__meta">Current status: {workflowLabel(record.workflowStatus)}</div> : null}

        <label className="field">
          <span className="field__label">Notes</span>
          <textarea
            className="field__input field__textarea"
            rows="3"
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            placeholder="Optional notes for this stock check"
          />
        </label>

        <div className="card-actions">
          <a className="button button--ghost" href={record.stockUrl || "#"} target="_blank" rel="noreferrer">
            Open Vansco Page
          </a>
          {isIgnored ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => saveWorkflow("new", "Restored")}
              disabled={Boolean(savingAction)}
            >
              {savingAction === "new" ? "Restoring..." : "Unblock"}
            </button>
          ) : (
            <>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => saveWorkflow("ignored", "Ignored")}
                disabled={Boolean(savingAction)}
              >
                {savingAction === "ignored" ? "Ignoring..." : "Ignore"}
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={() => saveWorkflow("not_listing_spec", "Blocked")}
                disabled={Boolean(savingAction)}
              >
                {savingAction === "not_listing_spec" ? "Blocking..." : "Delete / Block"}
              </button>
            </>
          )}
        </div>

        {saveMessage ? <div className="vehicle-card__meta">{saveMessage}</div> : null}
      </div>
    </article>
  );
}

async function fetchLocalVehiclesForPipeline(pipeline) {
  if (pipeline === "finance") return fetchFinanceMarketingVehicles(250);
  if (pipeline === "rent2buy") return fetchRentMarketingVehicles(250);
  if (pipeline === "cars") return fetchCarMarketingVehicles(250);
  return [];
}

export default function VanscoStockWatchPage() {
  const [selectedPipeline, setSelectedPipeline] = useState("finance");
  const [filtersByPipeline, setFiltersByPipeline] = useState(DEFAULT_FILTERS);
  const [recordsByPipeline, setRecordsByPipeline] = useState({ finance: [], rent2buy: [], cars: [] });
  const [cacheSummaryByPipeline, setCacheSummaryByPipeline] = useState({ finance: null, rent2buy: null, cars: null });
  const [localRegistrationsByPipeline, setLocalRegistrationsByPipeline] = useState({ finance: new Set(), rent2buy: new Set(), cars: new Set() });
  const [localLoadErrorByPipeline, setLocalLoadErrorByPipeline] = useState({ finance: "", rent2buy: "", cars: "" });
  const [loadingPipeline, setLoadingPipeline] = useState("");
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [debugByPipeline, setDebugByPipeline] = useState({ finance: null, rent2buy: null, cars: null });
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  async function loadPipeline(pipeline = selectedPipeline) {
    setLoadingPipeline(pipeline);
    setErrorMessage("");
    try {
      const payload = await fetchVanscoCacheRecords(pipeline);
      setRecordsByPipeline((prev) => ({ ...prev, [pipeline]: payload.records || [] }));
      setCacheSummaryByPipeline((prev) => ({ ...prev, [pipeline]: payload.summary || null }));
    } catch (error) {
      setErrorMessage(error.message || "Could not load Vansco Stock Watch cache.");
    } finally {
      setLoadingPipeline("");
    }
  }

  useEffect(() => {
    let active = true;

    async function loadLocalRegistrations() {
      try {
        const vehicles = await fetchLocalVehiclesForPipeline(selectedPipeline);
        if (!active) return;
        const regs = vehicles
          .map((vehicle) => normalizeWatchRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name))
          .filter(Boolean);
        setLocalRegistrationsByPipeline((prev) => ({ ...prev, [selectedPipeline]: new Set(regs) }));
        setLocalLoadErrorByPipeline((prev) => ({ ...prev, [selectedPipeline]: "" }));
      } catch (error) {
        if (!active) return;
        setLocalRegistrationsByPipeline((prev) => ({ ...prev, [selectedPipeline]: new Set() }));
        setLocalLoadErrorByPipeline((prev) => ({
          ...prev,
          [selectedPipeline]: error.message || `Could not load ${pipelineLabel(selectedPipeline)} local stock.`,
        }));
      }
    }

    loadLocalRegistrations();
    return () => { active = false; };
  }, [selectedPipeline]);

  useEffect(() => {
    loadPipeline(selectedPipeline);
  }, [selectedPipeline]);

  const activeFilter = filtersByPipeline[selectedPipeline] || "missing";
  const rawActiveRecords = recordsByPipeline[selectedPipeline] || [];
  const currentRawRecords = useMemo(() => dedupeDisplayRecords(rawActiveRecords), [rawActiveRecords]);
  const activeLocalRegistrations = localRegistrationsByPipeline[selectedPipeline] || new Set();
  const localLoadError = localLoadErrorByPipeline[selectedPipeline] || "";
  const cacheSummary = cacheSummaryByPipeline[selectedPipeline] || null;

  const activeRecords = useMemo(
    () => currentRawRecords.map((record) => classifyWatchRecord(record, activeLocalRegistrations, selectedPipeline)),
    [activeLocalRegistrations, currentRawRecords, selectedPipeline]
  );

  const summary = useMemo(() => ({
    missing: activeRecords.filter((record) => record.displayStatus === "missing").length,
    reserved: activeRecords.filter((record) => record.displayStatus === "reserved").length,
    ignored: activeRecords.filter((record) => record.displayStatus === "ignored").length,
    hiddenNoReg: activeRecords.filter((record) => record.displayStatus === "hidden_no_registration").length,
    hiddenReserved: activeRecords.filter((record) => record.displayStatus === "hidden_reserved_not_advertised").length,
    alreadyListed: activeRecords.filter((record) => record.displayStatus === "hidden_already_ok").length,
  }), [activeRecords]);

  const filteredRecords = useMemo(() => {
    if (activeFilter === "all") return activeRecords.filter((record) => ["missing", "reserved", "ignored"].includes(record.displayStatus));
    if (activeFilter === "reserved") return activeRecords.filter((record) => record.displayStatus === "reserved");
    if (activeFilter === "ignored") return activeRecords.filter((record) => record.displayStatus === "ignored");
    return activeRecords.filter((record) => record.displayStatus === "missing");
  }, [activeFilter, activeRecords]);

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
      const message = `Vansco URL list refreshed: ${urlResult.urlsFound || 0} current URLs. Details checked: ${batchResult.successCount || 0} success, ${batchResult.failureCount || 0} failed, ${batchResult.remainingCount || 0} remaining.`;
      setSuccessMessage(message);
      setDebugByPipeline((prev) => ({ ...prev, [selectedPipeline]: { urlResult, batchResult } }));
    } catch (error) {
      setErrorMessage(`${error.message || "Could not refresh Vansco cache."} Showing the latest saved cache if available.`);
    } finally {
      setRefreshingCache(false);
    }
  }

  function handleRecordSaved(originalRecord, actionRecord) {
    const originalRegistration = normalizeWatchRegistration(originalRecord.registration);
    const savedRegistration = normalizeWatchRegistration(actionRecord.registration);
    setRecordsByPipeline((prev) => ({
      ...prev,
      [selectedPipeline]: prev[selectedPipeline].map((record) => {
        const recordRegistration = normalizeWatchRegistration(record.registration);
        const sameRecord = (savedRegistration && recordRegistration === savedRegistration) ||
          (originalRegistration && recordRegistration === originalRegistration) ||
          record.stockUrl === actionRecord.stockUrl ||
          record.stockUrl === actionRecord.stock_url;
        return sameRecord
          ? {
              ...record,
              ...actionRecord,
              workflowStatus: actionRecord.workflowStatus || actionRecord.workflow_status || record.workflowStatus,
              notes: actionRecord.notes ?? record.notes,
            }
          : record;
      }),
    }));
  }

  return (
    <div className="page-stack">
      <section className="panel hero-panel vansco-watch-panel">
        <div className="panel__header">
          <div>
            <h3>Vansco Stock Watch</h3>
            <p>Advisory-only comparison by registration. It never auto-adds, removes, posts, publishes, or edits stock.</p>
          </div>
          <div className="card-actions">
            <button className="button button--primary" type="button" onClick={handleRefreshCache} disabled={refreshingCache}>
              {refreshingCache ? "Refreshing cache..." : "Refresh Vansco cache"}
            </button>
            <button className="button button--ghost" type="button" onClick={() => loadPipeline(selectedPipeline)} disabled={loadingPipeline === selectedPipeline}>
              {loadingPipeline === selectedPipeline ? "Reloading..." : "Reload comparison"}
            </button>
          </div>
        </div>

        <div className="segmented-control">
          {WATCH_PIPELINES.map((pipeline) => (
            <button
              key={pipeline.value}
              className={selectedPipeline === pipeline.value ? "segment is-active" : "segment"}
              type="button"
              onClick={() => setSelectedPipeline(pipeline.value)}
            >
              {pipeline.label}
            </button>
          ))}
        </div>

        <div className="stat-grid stat-grid--centered">
          <SummaryCard label={`Missing from ${pipelineLabel(selectedPipeline)}`} value={summary.missing} tone="blue" />
          <SummaryCard label="Reserved on Vansco" value={summary.reserved} tone="amber" />
          <SummaryCard label="Ignored / Blocked" value={summary.ignored} />
          <SummaryCard label="Local CRM regs loaded" value={activeLocalRegistrations.size} />
        </div>

        <div className="vansco-watch-note">
          <strong>Accuracy check:</strong> {pipelineLabel(selectedPipeline)} has {activeLocalRegistrations.size} local CRM registrations loaded.
          {cacheSummary ? ` Vansco cache for this tab has ${cacheSummary.currentPipelineUrlCount ?? "?"} current URLs and ${cacheSummary.usableCachedRegistrations ?? cacheSummary.cachedRegs ?? "?"} usable registrations.` : ""}
          {lastCheckedAt ? ` Latest detail check: ${formatWatchTimestamp(lastCheckedAt)}.` : ""}
        </div>

        {selectedPipeline === "cars" && activeLocalRegistrations.size !== 43 ? (
          <div className="vansco-watch-note vansco-watch-note--warning">
            Cars local stock expected around 43, but this page loaded {activeLocalRegistrations.size}. Check the Cars Supabase table name/fields before relying on Cars results.
          </div>
        ) : null}

        {localLoadError ? <div className="error-banner">{localLoadError}</div> : null}
        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
        {successMessage ? <div className="success-banner">{successMessage}</div> : null}

        <div className="vansco-watch-note">
          Hidden from action cards: {summary.alreadyListed} already listed/available, {summary.hiddenReserved} reserved but not advertised in this tab, {summary.hiddenNoReg} no valid registration. Ignore/Delete-Block is stored per tab.
        </div>

        <div className="segmented-control">
          {SIMPLE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              className={activeFilter === filter.value ? "segment is-active" : "segment"}
              type="button"
              onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: filter.value }))}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="card-actions">
          <button className="button button--ghost" type="button" onClick={() => setShowDiagnostics((value) => !value)}>
            {showDiagnostics ? "Hide accuracy details" : "Show accuracy details"}
          </button>
        </div>

        {showDiagnostics ? (
          <pre className="diagnostics-panel">
            {JSON.stringify({
              selectedPipeline,
              localRegsLoaded: activeLocalRegistrations.size,
              localLoadError,
              cacheSummary,
              actionSummary: summary,
              debug: debugByPipeline[selectedPipeline],
            }, null, 2)}
          </pre>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>{SIMPLE_FILTERS.find((filter) => filter.value === activeFilter)?.label || "Action cards"}</h3>
            <p>{filteredRecords.length} advisory cards for {pipelineLabel(selectedPipeline)}.</p>
          </div>
          <span className="status-pill">{filteredRecords.length} shown</span>
        </div>

        {loadingPipeline === selectedPipeline ? (
          <div className="empty-state">Loading Vansco comparison...</div>
        ) : filteredRecords.length === 0 ? (
          <div className="empty-state">No vehicles in this view.</div>
        ) : (
          <div className="vansco-card-grid">
            {filteredRecords.map((record) => (
              <WatchCard
                key={normalizeWatchRegistration(record.registration) || record.stockUrl || record.id}
                record={record}
                selectedPipeline={selectedPipeline}
                onRecordSaved={handleRecordSaved}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
