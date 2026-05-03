import { useEffect, useMemo, useState } from "react";
import { fetchFinanceMarketingVehicles, fetchRentMarketingVehicles } from "../services/marketingVehicles.js";
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
  return ["reserved", "sold", "deposit_taken"].includes(status);
}

function isBlockedStatus(workflowStatus) {
  return workflowStatus === "ignored" || String(workflowStatus || "").startsWith("not_listing_");
}

function recordCheckedTimeMs(record) {
  const rawValue = record?.lastCheckedAt || record?.updatedAt || record?.updated_at;
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
        {record.lastSuccessfullyCheckedAt ? <div className="vehicle-card__meta">Status last checked: {formatWatchTimestamp(record.lastSuccessfullyCheckedAt)}</div> : null}
        {record.lastError ? <div className="vehicle-card__meta">Last detail check issue: {record.lastError}</div> : null}
        {isIgnored ? (
          <div className="vehicle-card__meta">Current status: {workflowLabel(record.workflowStatus)}</div>
        ) : null}

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

export default function VanscoStockWatchPage() {
  const [selectedPipeline, setSelectedPipeline] = useState("finance");
  const [filtersByPipeline, setFiltersByPipeline] = useState(DEFAULT_FILTERS);
  const [recordsByPipeline, setRecordsByPipeline] = useState({ finance: [], rent2buy: [], cars: [] });
  const [cacheSummaryByPipeline, setCacheSummaryByPipeline] = useState({ finance: null, rent2buy: null, cars: null });
  const [localRegistrationsByPipeline, setLocalRegistrationsByPipeline] = useState({
    finance: new Set(),
    rent2buy: new Set(),
    cars: new Set(),
  });
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
        let vehicles = [];
        if (selectedPipeline === "finance") vehicles = await fetchFinanceMarketingVehicles(250);
        if (selectedPipeline === "rent2buy") vehicles = await fetchRentMarketingVehicles(250);
        if (!active) return;
        setLocalRegistrationsByPipeline((prev) => ({
          ...prev,
          [selectedPipeline]: new Set(
            vehicles
              .map((vehicle) => normalizeWatchRegistration(vehicle.reg || vehicle.registration || vehicle.title))
              .filter(Boolean)
          ),
        }));
      } catch {
        if (!active) return;
        setLocalRegistrationsByPipeline((prev) => ({ ...prev, [selectedPipeline]: new Set() }));
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
  }), [activeRecords]);

  const filteredRecords = useMemo(() => {
    if (activeFilter === "all") return activeRecords.filter((record) => ["missing", "reserved", "ignored"].includes(record.displayStatus));
    if (activeFilter === "reserved") return activeRecords.filter((record) => record.displayStatus === "reserved");
    if (activeFilter === "ignored") return activeRecords.filter((record) => record.displayStatus === "ignored");
    return activeRecords.filter((record) => record.displayStatus === "missing");
  }, [activeFilter, activeRecords]);

  const lastCheckedAt = useMemo(() => currentRawRecords.reduce((latest, record) => {
    if (!record.lastCheckedAt) return latest;
    if (!latest) return record.lastCheckedAt;
    return new Date(record.lastCheckedAt) > new Date(latest) ? record.lastCheckedAt : latest;
  }, ""), [currentRawRecords]);

  async function handleRefreshCache() {
    setRefreshingCache(true);
    setErrorMessage("");
    setSuccessMessage("");
    setDebugByPipeline((prev) => ({ ...prev, [selectedPipeline]: null }));

    try {
      const urlResult = await refreshVanscoCacheUrls();
      const batchResult = await processVanscoCacheBatch(3);
      await loadPipeline(selectedPipeline);
      const message = `Vansco URL list refreshed: ${urlResult.urlsFound || 0} current URLs. Detail batch processed: ${batchResult.successCount || 0} success, ${batchResult.failureCount || 0} failed.`;
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
          record.stockUrl === originalRecord.stockUrl;
        return sameRecord ? { ...record, ...actionRecord, id: record.id, watchRecordId: actionRecord.id } : record;
      }),
    }));
  }

  const activeDebug = debugByPipeline[selectedPipeline];
  const cacheSummary = cacheSummaryByPipeline[selectedPipeline] || {};

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Vansco Stock Watch</h3>
            <p>Cache-first advisory checker only. It compares cached Vansco registrations against the selected Marketing CRM stock tab.</p>
            <div className="vehicle-card__meta">Registration is the only comparison key. Nothing is auto-added, auto-removed, published to Wix, posted to Facebook, or edited in CRM stock.</div>
            <div className="vehicle-card__meta">Reserved, sold, or deposit taken vehicles are hidden from Missing unless you currently advertise that registration.</div>
            <div className="vehicle-card__meta">Blocking is saved per tab. Blocking in Finance does not block the same vehicle in Rent2Buy or Cars.</div>
          </div>
          <div className="vansco-action-stack">
            <button className="button button--primary vansco-run-button" type="button" onClick={handleRefreshCache} disabled={refreshingCache}>
              {refreshingCache ? <><span className="vansco-spinner" aria-hidden="true" />Refreshing cache...</> : "Refresh Vansco cache"}
            </button>
            <button className="button button--ghost vansco-run-button" type="button" onClick={() => loadPipeline(selectedPipeline)} disabled={loadingPipeline === selectedPipeline || refreshingCache}>
              Reload comparison
            </button>
          </div>
        </div>

        <div className="vansco-tabs vansco-pipeline-tabs">
          {WATCH_PIPELINES.map((pipeline) => (
            <button
              key={pipeline.value}
              type="button"
              className={selectedPipeline === pipeline.value ? "vansco-tab-button is-active" : "vansco-tab-button"}
              onClick={() => {
                setSelectedPipeline(pipeline.value);
                setSuccessMessage("");
                setErrorMessage("");
              }}
            >
              {pipeline.label}
            </button>
          ))}
        </div>

        <div className="vehicle-card__meta">
          Selected tab: {pipelineLabel(selectedPipeline)} | Status detail checked: {formatWatchTimestamp(lastCheckedAt)} | Local regs loaded: {activeLocalRegistrations.size}
        </div>
        <div className="vehicle-card__meta">
          Vansco URL list checked: {formatWatchTimestamp(cacheSummary.latestUrlListCheckedAt)} | Current URL count: {cacheSummary.currentUrlCount || 0} | Cached regs: {cacheSummary.cachedRegs || 0} | Details refreshed today: {cacheSummary.detailRefreshedToday || 0} | Failed detail checks: {cacheSummary.failedDetailChecks || 0}
        </div>
      </section>

      <section
        className="stats-grid vansco-summary-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 320px))",
          justifyContent: "center",
          gap: "1.5rem",
          maxWidth: "1100px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        <SummaryCard label={`Missing from ${pipelineLabel(selectedPipeline)}`} value={summary.missing} tone="blue" />
        <SummaryCard label="Reserved on Vansco" value={summary.reserved} tone="amber" />
        <SummaryCard label="Ignored / Blocked" value={summary.ignored} />
      </section>

      <section className="panel">
        <div className="panel__header"><div><h3>{pipelineLabel(selectedPipeline)}</h3><p>Missing means a current Vansco cached registration is available or unknown, not currently in this selected CRM stock tab, and not blocked for this tab. Reserved means you currently advertise it, but cached Vansco status says reserved, sold, or deposit taken.</p></div></div>
        <div className="notice-banner notice-banner--error">Advisory only. Do not remove stock unless manually checked.</div>
        {summary.hiddenReserved ? <div className="notice-banner">{summary.hiddenReserved} reserved Vansco vehicle{summary.hiddenReserved === 1 ? "" : "s"} not in your stock were hidden from Missing.</div> : null}
        {summary.hiddenNoReg ? <div className="notice-banner">{summary.hiddenNoReg} Vansco vehicle{summary.hiddenNoReg === 1 ? "" : "s"} had no valid registration and were hidden from the simple list.</div> : null}

        <div className="vansco-tabs vansco-filter-tabs" style={{ marginBottom: "1.25rem" }}>
          {SIMPLE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={activeFilter === filter.value ? "vansco-tab-button is-active" : "vansco-tab-button"}
              onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: filter.value }))}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {successMessage ? <div className="notice-banner notice-banner--success">{successMessage}</div> : null}
        {errorMessage ? <div className="notice-banner notice-banner--error">{errorMessage}</div> : null}

        {activeDebug ? (
          <details className="vansco-debug-panel" open={showDiagnostics} onToggle={(event) => setShowDiagnostics(event.currentTarget.open)}>
            <summary className="vansco-debug-panel__summary">Cache refresh diagnostics</summary>
            <div className="vehicle-card__meta">URLs found: {activeDebug.urlResult?.urlsFound || 0}</div>
            <div className="vehicle-card__meta">Detail batch processed: {activeDebug.batchResult?.processedCount || 0}</div>
            <div className="vehicle-card__meta">Detail successes: {activeDebug.batchResult?.successCount || 0}</div>
            <div className="vehicle-card__meta">Detail failures: {activeDebug.batchResult?.failureCount || 0}</div>
            {(activeDebug.batchResult?.results || []).map((sample, index) => (
              <div key={`${sample.stockUrl || "sample"}-${index}`} className="vehicle-card__meta">
                Batch item {index + 1}: {sample.stockUrl || "unknown URL"} | {sample.ok ? "ok" : sample.error || "failed"} | reg {sample.registration || "none"} | status {sample.sourceStatus || "unknown"}
              </div>
            ))}
          </details>
        ) : null}

        {loadingPipeline === selectedPipeline ? (
          <div className="empty-state">Loading Vansco cache comparison...</div>
        ) : filteredRecords.length === 0 ? (
          <div className="empty-state">No vehicles in this section.</div>
        ) : (
          <div className="card-grid">
            {filteredRecords.map((record) => <WatchCard key={record.id || `${selectedPipeline}-${record.vehicleKey}`} record={record} selectedPipeline={selectedPipeline} onRecordSaved={handleRecordSaved} />)}
          </div>
        )}
      </section>
    </div>
  );
}
