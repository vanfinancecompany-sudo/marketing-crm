import { useEffect, useMemo, useState } from "react";
import { fetchFinanceMarketingVehicles, fetchRentMarketingVehicles } from "../services/marketingVehicles.js";
import {
  WATCH_PIPELINES,
  fetchVanscoWatchRecords,
  formatWatchTimestamp,
  pipelineLabel,
  runVanscoStockCheck,
  sourceStatusLabel,
  updateVanscoWatchRecord,
  workflowLabel,
} from "../services/vanscoStockWatch.js";

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

const RUNNING_STEPS = [
  { key: "clearing", label: "Preparing check" },
  { key: "discovering", label: "Finding Vansco vehicles" },
  { key: "processing", label: "Checking registrations" },
  { key: "classifying", label: "Comparing with my stock" },
  { key: "save-results", label: "Saving results" },
  { key: "complete", label: "Complete" },
];

const CURRENT_SCAN_WINDOW_MS = 10 * 60 * 1000;

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
  const rawValue = record?.lastCheckedAt || record?.last_checked_at || record?.updatedAt || record?.updated_at;
  const time = rawValue ? new Date(rawValue).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function filterCurrentScanRecords(records) {
  const activeRows = records.filter((record) => !isBlockedStatus(record.workflowStatus));
  const latestCheckedAt = activeRows.reduce((latest, record) => Math.max(latest, recordCheckedTimeMs(record)), 0);
  if (!latestCheckedAt) return records;
  const cutoff = latestCheckedAt - CURRENT_SCAN_WINDOW_MS;

  return records.filter((record) => {
    if (isBlockedStatus(record.workflowStatus)) return true;
    const checkedAt = recordCheckedTimeMs(record);
    if (!checkedAt) return true;
    return checkedAt >= cutoff;
  });
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

function classifyWatchRecord(record, localRegistrationSet) {
  const registration = normalizeWatchRegistration(record.registration);
  const hasExactLocalMatch = registration && localRegistrationSet?.has(registration);
  const blocked = isBlockedStatus(record.workflowStatus);
  const reservedOnVansco = isReservedLikeStatus(record.sourceStatus);

  if (blocked) {
    return {
      ...record,
      displayStatus: "ignored",
      safeExactRegistrationMatch: Boolean(hasExactLocalMatch),
    };
  }

  if (!registration) {
    return {
      ...record,
      displayStatus: "hidden_no_registration",
      safeExactRegistrationMatch: false,
    };
  }

  if (hasExactLocalMatch && reservedOnVansco) {
    return {
      ...record,
      displayStatus: "reserved",
      matchStatus: "reserved_still_listed",
      safeExactRegistrationMatch: true,
    };
  }

  if (reservedOnVansco && !hasExactLocalMatch) {
    return {
      ...record,
      displayStatus: "hidden_reserved_not_advertised",
      safeExactRegistrationMatch: false,
    };
  }

  if (!hasExactLocalMatch) {
    return {
      ...record,
      displayStatus: "missing",
      matchStatus: "missing",
      safeExactRegistrationMatch: false,
    };
  }

  return {
    ...record,
    displayStatus: "hidden_already_ok",
    matchStatus: "listed",
    safeExactRegistrationMatch: true,
  };
}

function formatElapsed(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
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

function WatchCard({ record, onRecordSaved }) {
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
      const nextRecord = await updateVanscoWatchRecord(record.id, {
        workflowStatus,
        notes: notesDraft,
      });
      onRecordSaved(nextRecord);
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
          <PipelineBadge pipeline={record.pipeline} />
          <DisplayStatusBadge status={record.displayStatus} />
          <SourceStatusBadge status={record.sourceStatus} />
        </div>

        <h3>{record.title || "Untitled vehicle"}</h3>
        <div className="vehicle-card__meta">Registration: {record.registration || "Not found"}</div>
        {record.safeExactRegistrationMatch ? (
          <div className="vehicle-card__meta">This registration is currently in this CRM stock tab.</div>
        ) : null}
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
  const [localRegistrationsByPipeline, setLocalRegistrationsByPipeline] = useState({
    finance: new Set(),
    rent2buy: new Set(),
    cars: new Set(),
  });
  const [loadingPipeline, setLoadingPipeline] = useState("");
  const [checkingPipeline, setCheckingPipeline] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [checkStartedAt, setCheckStartedAt] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [debugByPipeline, setDebugByPipeline] = useState({ finance: null, rent2buy: null, cars: null });
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [runningStatus, setRunningStatus] = useState(null);

  useEffect(() => {
    if (!checkingPipeline || !checkStartedAt) return undefined;
    const interval = window.setInterval(() => {
      const started = new Date(checkStartedAt).getTime();
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [checkingPipeline, checkStartedAt]);

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
    let active = true;

    async function loadPipeline() {
      setLoadingPipeline(selectedPipeline);
      setErrorMessage("");
      try {
        const records = await fetchVanscoWatchRecords(selectedPipeline);
        if (!active) return;
        setRecordsByPipeline((prev) => ({ ...prev, [selectedPipeline]: records }));
      } catch (error) {
        if (!active) return;
        setErrorMessage(error.message || "Could not load Vansco Stock Watch data.");
      } finally {
        if (active) setLoadingPipeline("");
      }
    }

    loadPipeline();
    return () => { active = false; };
  }, [selectedPipeline]);

  const activeFilter = filtersByPipeline[selectedPipeline] || "missing";
  const rawActiveRecords = recordsByPipeline[selectedPipeline] || [];
  const currentRawRecords = useMemo(
    () => dedupeDisplayRecords(filterCurrentScanRecords(rawActiveRecords)),
    [rawActiveRecords]
  );
  const activeLocalRegistrations = localRegistrationsByPipeline[selectedPipeline] || new Set();
  const activeRecords = useMemo(
    () => currentRawRecords.map((record) => classifyWatchRecord(record, activeLocalRegistrations)),
    [activeLocalRegistrations, currentRawRecords]
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

  async function handleRunCheck() {
    const confirmed = window.confirm(
      `Run a fresh Vansco check for ${pipelineLabel(selectedPipeline)}? It will compare Vansco stock against this tab only and will not edit CRM stock.`
    );
    if (!confirmed) return;

    setCheckingPipeline(selectedPipeline);
    setErrorMessage("");
    setSuccessMessage("");
    const startedAt = new Date().toISOString();
    setCheckStartedAt(startedAt);
    setElapsedSeconds(0);
    setRunningStatus({
      stage: "clearing",
      message: "Preparing check...",
      processedVehicles: 0,
      totalVehicles: 0,
      percent: 4,
      validRegistrationsFound: 0,
      imagesFound: 0,
      reservedStatusesFound: 0,
    });

    try {
      const result = await runVanscoStockCheck(selectedPipeline, {
        detailFetchMode: "full",
        detailBatchSize: 25,
        onProgress: (progress) => setRunningStatus((prev) => ({ ...prev, ...progress })),
      });
      setRecordsByPipeline((prev) => ({ ...prev, [selectedPipeline]: result.records }));
      setDebugByPipeline((prev) => ({ ...prev, [selectedPipeline]: result.diagnostics || null }));
      setSuccessMessage(`Checked ${result.sourceVehicleCount} Vansco vehicles against ${result.localVehicleCount} ${pipelineLabel(selectedPipeline)} records.`);
    } catch (error) {
      setDebugByPipeline((prev) => ({ ...prev, [selectedPipeline]: error.debugInfo || prev[selectedPipeline] }));
      setErrorMessage(error.message || "Vansco Stock Watch check failed.");
    } finally {
      setCheckingPipeline("");
      setRunningStatus((prev) => prev?.stage === "complete" ? prev : null);
    }
  }

  function handleRecordSaved(nextRecord) {
    setRecordsByPipeline((prev) => ({
      ...prev,
      [selectedPipeline]: prev[selectedPipeline].map((record) => record.id === nextRecord.id ? nextRecord : record),
    }));
  }

  const activeDebug = debugByPipeline[selectedPipeline];
  const isCheckingActiveTab = checkingPipeline === selectedPipeline;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Vansco Stock Watch</h3>
            <p>Manual advisory checker only. It compares Vansco registrations against the selected Marketing CRM stock tab.</p>
            <div className="vehicle-card__meta">Simple mode: Missing from my stock, Reserved on Vansco, and Ignored / Blocked only.</div>
            <div className="vehicle-card__meta">Reserved Vansco vehicles that you do not currently advertise are hidden from Missing.</div>
            <div className="vehicle-card__meta">Blocking is saved per tab. Blocking in Finance does not block the same vehicle in Rent2Buy or Cars.</div>
          </div>
          <div className="vansco-action-stack">
            <button className="button button--primary vansco-run-button" type="button" onClick={handleRunCheck} disabled={isCheckingActiveTab}>
              {isCheckingActiveTab ? <><span className="vansco-spinner" aria-hidden="true" />Checking Vansco...</> : "Check Vansco Stock"}
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
          Selected tab: {pipelineLabel(selectedPipeline)} | Last checked: {formatWatchTimestamp(lastCheckedAt)} | Local regs loaded: {activeLocalRegistrations.size}
        </div>

        {isCheckingActiveTab ? (
          <div className="vansco-progress-panel">
            <div className="vansco-progress-panel__header"><strong>{runningStatus?.message || "Running full Vansco scan..."}</strong><span>{runningStatus?.percent ?? 0}%</span></div>
            <div className="vansco-progress-bar" aria-hidden="true"><div className="vansco-progress-bar__fill" style={{ width: `${runningStatus?.percent ?? 0}%` }} /></div>
            <div className="vehicle-card__meta">Started at: {formatWatchTimestamp(checkStartedAt)} | Running for {formatElapsed(elapsedSeconds)}</div>
            <div className="vehicle-card__meta">Total URLs found: {runningStatus?.totalVehicles || 0} | Processed: {runningStatus?.processedVehicles || 0}</div>
            <div className="vehicle-card__meta">Valid registrations: {runningStatus?.validRegistrationsFound || 0} | Images: {runningStatus?.imagesFound || 0} | Reserved statuses: {runningStatus?.reservedStatusesFound || 0}</div>
            <div className="vansco-progress-steps">
              {RUNNING_STEPS.map((step, index) => {
                const currentIndex = RUNNING_STEPS.findIndex((item) => item.key === runningStatus?.stage);
                const status = index < currentIndex ? "done" : index === currentIndex ? "active" : "pending";
                return <div key={step.key} className={`vansco-progress-step vansco-progress-step--${status}`}>{step.label}</div>;
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className="stats-grid vansco-summary-grid">
        <SummaryCard label={`Missing from ${pipelineLabel(selectedPipeline)}`} value={summary.missing} tone="blue" />
        <SummaryCard label="Reserved on Vansco" value={summary.reserved} tone="amber" />
        <SummaryCard label="Ignored / Blocked" value={summary.ignored} />
      </section>

      <section className="panel">
        <div className="panel__header"><div><h3>{pipelineLabel(selectedPipeline)}</h3><p>Missing means a Vansco available registration is not currently in this selected CRM stock tab. Reserved means you currently advertise it, but Vansco says reserved, sold, or deposit taken.</p></div></div>
        <div className="notice-banner notice-banner--error">Advisory only. Do not remove stock unless manually checked.</div>
        {summary.hiddenReserved ? <div className="notice-banner">{summary.hiddenReserved} reserved Vansco vehicle{summary.hiddenReserved === 1 ? "" : "s"} not in your stock were hidden from Missing.</div> : null}
        {summary.hiddenNoReg ? <div className="notice-banner">{summary.hiddenNoReg} Vansco vehicle{summary.hiddenNoReg === 1 ? "" : "s"} had no valid registration and were hidden from the simple list.</div> : null}

        <div className="vansco-tabs vansco-filter-tabs">
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
            <summary className="vansco-debug-panel__summary">Diagnostics</summary>
            <div className="vehicle-card__meta">Vansco total URLs found: {activeDebug.totalVehicleUrlsFound || 0}</div>
            <div className="vehicle-card__meta">Source used: {activeDebug.sourceFamily || "unknown"}</div>
            <div className="vehicle-card__meta">Pages fetched: {activeDebug.pagesFetched || 0}</div>
            <div className="vehicle-card__meta">Detail pages fetched: {activeDebug.detailPagesFetched || 0}</div>
            <div className="vehicle-card__meta">Detail pages failed: {activeDebug.detailPagesFailed || 0}</div>
            <div className="vehicle-card__meta">Vansco valid registrations found: {activeDebug.vanscoValidRegistrationsFound || 0}</div>
            <div className="vehicle-card__meta">CRM valid registrations found: {activeDebug.crmValidRegistrationsFound || 0}</div>
            <div className="vehicle-card__meta">Scan complete: {activeDebug.scanComplete ? "yes" : "no"}</div>
            {(activeDebug.parserWarnings || []).map((warning) => <div key={warning} className="vehicle-card__meta">Parser warning: {warning}</div>)}
          </details>
        ) : null}

        {loadingPipeline === selectedPipeline ? (
          <div className="empty-state">Loading saved Vansco Stock Watch records...</div>
        ) : filteredRecords.length === 0 ? (
          <div className="empty-state">No vehicles in this section.</div>
        ) : (
          <div className="card-grid">
            {filteredRecords.map((record) => <WatchCard key={record.id || `${record.pipeline}-${record.vehicleKey}`} record={record} onRecordSaved={handleRecordSaved} />)}
          </div>
        )}
      </section>
    </div>
  );
}
