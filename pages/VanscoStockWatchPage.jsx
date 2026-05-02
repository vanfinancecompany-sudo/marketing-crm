import { useEffect, useMemo, useState } from "react";
import { fetchFinanceMarketingVehicles, fetchRentMarketingVehicles } from "../services/marketingVehicles.js";
import {
  clearVanscoWatchRecords,
  DETAIL_FETCH_PRESETS,
  WATCH_FILTERS,
  WATCH_PIPELINES,
  WORKFLOW_OPTIONS,
  fetchVanscoWatchRecords,
  formatWatchTimestamp,
  isSuppressedWorkflowStatus,
  matchStatusLabel,
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

const RUNNING_STEPS = [
  { key: "clearing", label: "Clearing old results" },
  { key: "discovering", label: "Discovering Vansco vehicles" },
  { key: "processing", label: "Processing batches" },
  { key: "classifying", label: "Classifying results" },
  { key: "save-results", label: "Saving results..." },
  { key: "complete", label: "Complete" },
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

function applySafeExactRegistrationMatches(records, localRegistrationSet) {
  if (!localRegistrationSet?.size) return records;

  return records.map((record) => {
    const registration = normalizeWatchRegistration(record.registration);
    const hasExactLocalMatch = registration && localRegistrationSet.has(registration);

    if (!hasExactLocalMatch) return record;

    const matchStatus = isReservedLikeStatus(record.sourceStatus)
      ? "reserved_still_listed"
      : "listed";

    return {
      ...record,
      originalMatchStatus: record.originalMatchStatus || record.matchStatus,
      matchStatus,
      safeExactRegistrationMatch: true,
    };
  });
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
    : tone === "green"
      ? "stat-card stat-card--green"
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

function MatchStatusBadge({ status }) {
  return <span className="tag">{matchStatusLabel(status)}</span>;
}

function PipelineBadge({ pipeline }) {
  return <span className="tag">{pipelineLabel(pipeline)}</span>;
}

function WatchCard({ record, onRecordSaved }) {
  const [workflowStatus, setWorkflowStatus] = useState(record.workflowStatus || "new");
  const [notesDraft, setNotesDraft] = useState(record.notes || "");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    setWorkflowStatus(record.workflowStatus || "new");
    setNotesDraft(record.notes || "");
    setSaveMessage("");
  }, [record.id, record.workflowStatus, record.notes]);

  async function handleSave() {
    setSaving(true);
    setSaveMessage("");

    try {
      const nextRecord = await updateVanscoWatchRecord(record.id, {
        workflowStatus,
        notes: notesDraft,
      });
      onRecordSaved(nextRecord);
      setSaveMessage("Saved");
    } catch (error) {
      setSaveMessage(error.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  }

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
          <MatchStatusBadge status={record.matchStatus} />
          <SourceStatusBadge status={record.sourceStatus} />
        </div>

        <h3>{record.title || "Untitled vehicle"}</h3>

        <div className="vehicle-card__meta">Registration: {record.registration || "Not found"}</div>
        {record.safeExactRegistrationMatch ? (
          <div className="vehicle-card__meta">Exact registration match found in this CRM stock tab.</div>
        ) : null}

        <div className="field">
          <span className="field__label">Workflow status</span>
          <select
            className="field__input"
            value={workflowStatus}
            onChange={(event) => setWorkflowStatus(event.target.value)}
          >
            {WORKFLOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

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
          <a
            className="button button--ghost"
            href={record.stockUrl || "#"}
            target="_blank"
            rel="noreferrer"
          >
            Open Vansco Page
          </a>
          <button className="button button--primary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save status"}
          </button>
        </div>

        <div className="vehicle-card__meta">
          Workflow: {workflowLabel(record.workflowStatus)}
          {saveMessage ? ` | ${saveMessage}` : ""}
        </div>
      </div>
    </article>
  );
}

export default function VanscoStockWatchPage() {
  const [selectedPipeline, setSelectedPipeline] = useState("finance");
  const [filtersByPipeline, setFiltersByPipeline] = useState(DEFAULT_FILTERS);
  const [recordsByPipeline, setRecordsByPipeline] = useState({
    finance: [],
    rent2buy: [],
    cars: [],
  });
  const [localRegistrationsByPipeline, setLocalRegistrationsByPipeline] = useState({
    finance: new Set(),
    rent2buy: new Set(),
    cars: new Set(),
  });
  const [loadingPipeline, setLoadingPipeline] = useState("");
  const [checkingPipeline, setCheckingPipeline] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [detailFetchMode] = useState("standard");
  const [checkStartedAt, setCheckStartedAt] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [debugByPipeline, setDebugByPipeline] = useState({
    finance: null,
    rent2buy: null,
    cars: null,
  });
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [runningStatus, setRunningStatus] = useState(null);

  useEffect(() => {
    if (!checkingPipeline || !checkStartedAt) return undefined;

    const interval = window.setInterval(() => {
      const started = new Date(checkStartedAt).getTime();
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - started) / 1000)));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [checkingPipeline, checkStartedAt]);

  useEffect(() => {
    let active = true;

    async function loadLocalRegistrations() {
      try {
        let vehicles = [];

        if (selectedPipeline === "finance") {
          vehicles = await fetchFinanceMarketingVehicles(120);
        } else if (selectedPipeline === "rent2buy") {
          vehicles = await fetchRentMarketingVehicles(120);
        }

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
        setLocalRegistrationsByPipeline((prev) => ({
          ...prev,
          [selectedPipeline]: new Set(),
        }));
      }
    }

    loadLocalRegistrations();

    return () => {
      active = false;
    };
  }, [selectedPipeline]);

  useEffect(() => {
    let active = true;

    async function loadPipeline() {
      setLoadingPipeline(selectedPipeline);
      setErrorMessage("");

      try {
        const records = await fetchVanscoWatchRecords(selectedPipeline);
        if (!active) return;
        setRecordsByPipeline((prev) => ({
          ...prev,
          [selectedPipeline]: records,
        }));
      } catch (error) {
        if (!active) return;
        setErrorMessage(error.message || "Could not load Vansco Stock Watch data.");
      } finally {
        if (active) setLoadingPipeline("");
      }
    }

    loadPipeline();

    return () => {
      active = false;
    };
  }, [selectedPipeline]);

  const activeFilter = filtersByPipeline[selectedPipeline] || "missing";
  const rawActiveRecords = recordsByPipeline[selectedPipeline] || [];
  const activeLocalRegistrations = localRegistrationsByPipeline[selectedPipeline] || new Set();
  const activeRecords = useMemo(
    () => applySafeExactRegistrationMatches(rawActiveRecords, activeLocalRegistrations),
    [activeLocalRegistrations, rawActiveRecords]
  );

  const filteredRecords = useMemo(() => {
    if (activeFilter === "all") {
      return activeRecords;
    }

    if (activeFilter === "not_listing_or_ignored") {
      return activeRecords.filter((record) => isSuppressedWorkflowStatus(record.workflowStatus));
    }

    if (activeFilter === "new") {
      return activeRecords.filter((record) => record.workflowStatus === "new");
    }

    if (
      [
        "review_later",
        "added_to_crm",
        "added_to_wix",
        "removed_from_crm",
        "removed_from_wix",
      ].includes(activeFilter)
    ) {
      return activeRecords.filter((record) => record.workflowStatus === activeFilter);
    }

    if (["missing", "listed", "needs_review", "no_longer_on_vansco", "reserved_still_listed"].includes(activeFilter)) {
      return activeRecords.filter((record) => record.matchStatus === activeFilter);
    }

    return activeRecords;
  }, [activeFilter, activeRecords]);

  const summary = useMemo(() => {
    return {
      missing: activeRecords.filter(
        (record) => record.matchStatus === "missing" && !isSuppressedWorkflowStatus(record.workflowStatus)
      ).length,
      listed: activeRecords.filter((record) => record.matchStatus === "listed").length,
      needsReview: activeRecords.filter((record) => record.matchStatus === "needs_review").length,
      noLonger: activeRecords.filter((record) => record.matchStatus === "no_longer_on_vansco").length,
      reserved: activeRecords.filter((record) => record.matchStatus === "reserved_still_listed").length,
      reviewLater: activeRecords.filter((record) => record.workflowStatus === "review_later").length,
      ignored: activeRecords.filter((record) => isSuppressedWorkflowStatus(record.workflowStatus)).length,
      addedToCrm: activeRecords.filter((record) => record.workflowStatus === "added_to_crm").length,
      addedToWix: activeRecords.filter((record) => record.workflowStatus === "added_to_wix").length,
    };
  }, [activeRecords]);

  const exactUiMatches = useMemo(
    () => activeRecords.filter((record) => record.safeExactRegistrationMatch).length,
    [activeRecords]
  );

  const lastCheckedAt = useMemo(() => {
    return rawActiveRecords.reduce((latest, record) => {
      if (!record.lastCheckedAt) return latest;
      if (!latest) return record.lastCheckedAt;
      return new Date(record.lastCheckedAt) > new Date(latest) ? record.lastCheckedAt : latest;
    }, "");
  }, [rawActiveRecords]);

  async function handleRunCheck() {
    const confirmed = window.confirm(
      `Run a fresh Vansco check for ${pipelineLabel(selectedPipeline)}? This will clear previous watch results for this tab only. It will not delete CRM stock.`
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
      message: "Clearing old results...",
      processedVehicles: 0,
      totalVehicles: 0,
      percent: 4,
      validRegistrationsFound: 0,
      imagesFound: 0,
      reservedStatusesFound: 0,
    });

    try {
      await clearVanscoWatchRecords(selectedPipeline);
      setRecordsByPipeline((prev) => ({
        ...prev,
        [selectedPipeline]: [],
      }));

      const result = await runVanscoStockCheck(selectedPipeline, {
        detailFetchMode: "full",
        detailBatchSize: 25,
        onProgress: (progress) => {
          setRunningStatus((prev) => ({
            ...prev,
            ...progress,
          }));
        },
      });
      setRecordsByPipeline((prev) => ({
        ...prev,
        [selectedPipeline]: result.records,
      }));
      setDebugByPipeline((prev) => ({
        ...prev,
        [selectedPipeline]: result.diagnostics || null,
      }));
      setSuccessMessage(
        `Checked ${result.sourceVehicleCount} Vansco vehicles against ${result.localVehicleCount} ${pipelineLabel(selectedPipeline)} records.`
      );
    } catch (error) {
      setDebugByPipeline((prev) => ({
        ...prev,
        [selectedPipeline]: error.debugInfo || prev[selectedPipeline],
      }));
      setErrorMessage(error.message || "Vansco Stock Watch check failed.");
    } finally {
      setCheckingPipeline("");
      setRunningStatus((prev) => prev?.stage === "complete" ? prev : null);
    }
  }

  function handleRecordSaved(nextRecord) {
    setRecordsByPipeline((prev) => ({
      ...prev,
      [selectedPipeline]: prev[selectedPipeline].map((record) =>
        record.id === nextRecord.id ? nextRecord : record
      ),
    }));
  }

  const activeDebug = debugByPipeline[selectedPipeline];
  const activePreset =
    DETAIL_FETCH_PRESETS.find((preset) => preset.value === detailFetchMode) || DETAIL_FETCH_PRESETS[2];
  const isCheckingActiveTab = checkingPipeline === selectedPipeline;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Vansco Stock Watch</h3>
            <p>
              Manual stock checker only. It never auto-adds, auto-removes, auto-posts, or changes your
              existing stock records.
            </p>
            <div className="vehicle-card__meta">
              Detail fetch mode: Full check (automatic batched full scan)
            </div>
            <div className="vehicle-card__meta">
              One click runs a full scan for this tab, clears old watch rows for this tab only, and processes all batches automatically.
            </div>
            <div className="vehicle-card__meta">
              Safe exact-reg display: exact CRM registration matches are allowed to show as Already listed / Reserved even if the scan is low-confidence. Missing/removal decisions remain blocked by scan confidence.
            </div>
          </div>
          <div className="vansco-action-stack">
            <button
              className="button button--primary vansco-run-button"
              type="button"
              onClick={handleRunCheck}
              disabled={isCheckingActiveTab}
            >
              {isCheckingActiveTab ? (
                <>
                  <span className="vansco-spinner" aria-hidden="true" />
                  Checking Vansco...
                </>
              ) : "Check Vansco Stock"}
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
          Selected tab: {pipelineLabel(selectedPipeline)} | Last checked: {formatWatchTimestamp(lastCheckedAt)} | Local regs loaded: {activeLocalRegistrations.size} | Exact reg matches shown: {exactUiMatches}
        </div>

        {isCheckingActiveTab ? (
          <div className="vansco-progress-panel">
            <div className="vansco-progress-panel__header">
              <strong>{runningStatus?.message || "Running full Vansco scan..."}</strong>
              <span>{runningStatus?.percent ?? 0}%</span>
            </div>
            <div className="vansco-progress-bar" aria-hidden="true">
              <div className="vansco-progress-bar__fill" style={{ width: `${runningStatus?.percent ?? 0}%` }} />
            </div>
            <div className="vehicle-card__meta">
              Started at: {formatWatchTimestamp(checkStartedAt)} | Running for {formatElapsed(elapsedSeconds)}
            </div>
            <div className="vehicle-card__meta">
              Total URLs found: {runningStatus?.totalVehicles || 0} | Processed: {runningStatus?.processedVehicles || 0}
            </div>
            <div className="vehicle-card__meta">
              Valid registrations: {runningStatus?.validRegistrationsFound || 0} | Images: {runningStatus?.imagesFound || 0} | Reserved statuses: {runningStatus?.reservedStatusesFound || 0}
            </div>
            <div className="vansco-progress-steps">
              {RUNNING_STEPS.map((step, index) => {
                const currentIndex = RUNNING_STEPS.findIndex((item) => item.key === runningStatus?.stage);
                const status =
                  index < currentIndex ? "done" : index === currentIndex ? "active" : "pending";

                return (
                  <div key={step.key} className={`vansco-progress-step vansco-progress-step--${status}`}>
                    {step.label}
                  </div>
                );
              })}
            </div>
            {elapsedSeconds >= 30 ? (
              <div className="notice-banner notice-banner--error">
                This is taking longer than usual because vehicle detail pages are being enriched.
              </div>
            ) : null}
            {elapsedSeconds >= 55 ? (
              <div className="notice-banner notice-banner--error">
                Full scan is running in staged batches, so it can take a couple of minutes.
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="stats-grid vansco-summary-grid">
        <SummaryCard label={`Missing from ${pipelineLabel(selectedPipeline)}`} value={summary.missing} tone="blue" />
        <SummaryCard label="Already listed" value={summary.listed} tone="green" />
        <SummaryCard label="Needs Review" value={summary.needsReview} tone="amber" />
        <SummaryCard label="No longer on Vansco - high confidence only" value={summary.noLonger} tone="amber" />
        <SummaryCard label="Reserved on Vansco" value={summary.reserved} tone="amber" />
        <SummaryCard label="Review later" value={summary.reviewLater} />
        <SummaryCard label="Ignored / Not listing" value={summary.ignored} />
        <SummaryCard label="Added to CRM" value={summary.addedToCrm} tone="green" />
        <SummaryCard label="Added to Wix" value={summary.addedToWix} tone="green" />
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>{pipelineLabel(selectedPipeline)}</h3>
            <p>
              Compare Vansco all-stock results against the selected Marketing CRM stock group. Reserved,
              sold, and deposit-taken wording is flagged separately when it is still listed by you.
            </p>
          </div>
        </div>

        <div className="notice-banner notice-banner--error">
          Do not remove stock unless manually checked. This tool is advisory.
        </div>
        <div className="notice-banner">
          Registration is the comparison key. Vehicles without a valid registration are review-only.
        </div>
        {exactUiMatches ? (
          <div className="notice-banner notice-banner--success">
            {exactUiMatches} exact registration match{exactUiMatches === 1 ? "" : "es"} found in this CRM stock tab. These are shown as Already listed or Reserved on Vansco even if the scan confidence is low.
          </div>
        ) : null}

        <div className="vansco-tabs vansco-filter-tabs">
          {WATCH_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={activeFilter === filter.value ? "vansco-tab-button is-active" : "vansco-tab-button"}
              onClick={() =>
                setFiltersByPipeline((prev) => ({
                  ...prev,
                  [selectedPipeline]: filter.value,
                }))
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

        {successMessage ? <div className="notice-banner notice-banner--success">{successMessage}</div> : null}
        {errorMessage ? <div className="notice-banner notice-banner--error">{errorMessage}</div> : null}
        {activeDebug?.lowConfidenceWarning ? (
          <div className="notice-banner notice-banner--error">{activeDebug.lowConfidenceWarning}</div>
        ) : null}
        {activeDebug?.partialScan ? (
          <div className="notice-banner notice-banner--error">
            Partial Vansco scan. Results are review-only for missing/removal decisions. Exact registration matches can still be shown safely.
          </div>
        ) : null}
        {activeDebug?.requestTimedOut ? (
          <div className="notice-banner notice-banner--error">
            The browser timed out waiting for the Vansco check to finish. Full scans may exceed Vercel request limits.
          </div>
        ) : null}

        {activeDebug ? (
          <details className="vansco-debug-panel" open={showDiagnostics} onToggle={(event) => setShowDiagnostics(event.currentTarget.open)}>
            <summary className="vansco-debug-panel__summary">Diagnostics</summary>
            <div className="vehicle-card__meta">Vansco page fetched: {activeDebug.pageFetched ? "yes" : "no"}</div>
            <div className="vehicle-card__meta">HTML length: {activeDebug.htmlLength || 0}</div>
            <div className="vehicle-card__meta">Endpoint used: {activeDebug.endpointUsed || "Unknown"}</div>
            <div className="vehicle-card__meta">Source used: {activeDebug.sourceFamily || "unknown"}</div>
            <div className="vehicle-card__meta">Stock page CRM source used: {activeDebug.sourceTable || "Unknown"}</div>
            <div className="vehicle-card__meta">Registration field used: {activeDebug.registrationField || "Unknown"}</div>
            <div className="vehicle-card__meta">Pages fetched: {activeDebug.pagesFetched || 0}</div>
            <div className="vehicle-card__meta">Vansco total URLs found: {activeDebug.totalVehicleUrlsFound || 0}</div>
            <div className="vehicle-card__meta">Partial scan: {activeDebug.partialScan ? "yes" : "no"}</div>
            <div className="vehicle-card__meta">
              Detail fetch mode: {activeDebug.detailFetchMode || "standard"} | Detail fetch limit applied: {activeDebug.detailFetchLimitApplied ?? "-"}
            </div>
            <div className="vehicle-card__meta">Category pages fetched: {activeDebug.categoryPagesFetched || 0}</div>
            <div className="vehicle-card__meta">
              Category page failures: {(activeDebug.categoryPageFailures || []).length ? activeDebug.categoryPageFailures.join(", ") : "none"}
            </div>
            <div className="vehicle-card__meta">Candidate links found: {activeDebug.candidateLinksFound || 0}</div>
            <div className="vehicle-card__meta">Sitemap URLs found: {activeDebug.sitemapUrlsFound || 0}</div>
            <div className="vehicle-card__meta">
              Vehicles parsed per category: {Object.entries(activeDebug.vehiclesParsedByCategory || {}).map(([key, value]) => `${key}: ${value}`).join(" | ") || "none"}
            </div>
            <div className="vehicle-card__meta">Vehicle detail URLs kept: {activeDebug.vehiclesParsed || 0}</div>
            <div className="vehicle-card__meta">Vehicles parsed: {activeDebug.vehiclesParsed || 0}</div>
            <div className="vehicle-card__meta">Detail pages fetched: {activeDebug.detailPagesFetched || 0}</div>
            <div className="vehicle-card__meta">Detail pages failed: {activeDebug.detailPagesFailed || 0}</div>
            <div className="vehicle-card__meta">
              Vehicles enriched with registration: {activeDebug.vehiclesEnrichedWithRegistration || 0}
            </div>
            <div className="vehicle-card__meta">
              Vehicles enriched with image: {activeDebug.vehiclesEnrichedWithImage || 0}
            </div>
            <div className="vehicle-card__meta">
              Reserved / sold status found: {activeDebug.vehiclesWithSourceStatus || 0}
            </div>
            <div className="vehicle-card__meta">
              Vehicles with valid match key: {activeDebug.vehiclesWithValidMatchKey || 0}
            </div>
            <div className="vehicle-card__meta">
              Vansco valid registrations found: {activeDebug.vanscoValidRegistrationsFound || 0}
            </div>
            <div className="vehicle-card__meta">
              Vansco registrations extracted from title brackets: {activeDebug.vanscoRegistrationsExtractedFromTitleBrackets || 0}
            </div>
            <div className="vehicle-card__meta">
              Rejected fake registrations count: {activeDebug.rejectedFakeRegistrationsCount || 0}
            </div>
            <div className="vehicle-card__meta">
              Vansco vehicles without valid registration moved to Needs Review: {activeDebug.vanscoVehiclesWithoutValidRegistrationMovedToNeedsReview || 0}
            </div>
            <div className="vehicle-card__meta">Finance/selected CRM records loaded: {activeDebug.crmRecordCount ?? 0}</div>
            <div className="vehicle-card__meta">
              CRM valid registrations found: {activeDebug.crmValidRegistrationsFound || 0}
            </div>
            <div className="vehicle-card__meta">
              First 20 raw CRM registrations: {(activeDebug.crmRawRegistrationsSample || []).join(", ") || "none"}
            </div>
            <div className="vehicle-card__meta">
              First 20 normalised CRM registrations: {(activeDebug.crmNormalizedRegistrationsSample || []).join(", ") || "none"}
            </div>
            <div className="vehicle-card__meta">
              Vansco raw registrations sample: {(activeDebug.vanscoRawRegistrationsSample || []).join(", ") || "none"}
            </div>
            <div className="vehicle-card__meta">
              Vansco normalised registrations sample: {(activeDebug.vanscoNormalizedRegistrationsSample || []).join(", ") || "none"}
            </div>
            <div className="vehicle-card__meta">
              Sample first 20 extracted Vansco registrations: {(activeDebug.vanscoNormalizedRegistrationsSample || []).join(", ") || "none"}
            </div>
            <div className="vehicle-card__meta">
              Sample first 20 rejected fake reg candidates: {(activeDebug.sampleRejectedFakeRegistrations || []).join(", ") || "none"}
            </div>
            <div className="vehicle-card__meta">
              Exact registration overlap count: {activeDebug.exactRegistrationOverlapCount || 0}
            </div>
            <div className="vehicle-card__meta">
              UI exact registration matches shown: {exactUiMatches}
            </div>
            <div className="vehicle-card__meta">
              Sample matched registrations: {(activeDebug.sampleMatchedRegistrations || []).join(", ") || "none"}
            </div>
            <div className="vehicle-card__meta">
              Missing count based on valid registrations only: {activeDebug.missingCountBasedOnValidRegistrationsOnly || 0}
            </div>
            <div className="vehicle-card__meta">
              Needs Review count: {activeDebug.needsReviewCount || 0}
            </div>
            <div className="vehicle-card__meta">Scan complete: {activeDebug.scanComplete ? "yes" : "no"}</div>
            <div className="vehicle-card__meta">
              Registration confidence: {activeDebug.registrationConfidence || "low"}
            </div>
            <div className="vehicle-card__meta">
              No longer on Vansco results shown only if confidence is high: {activeDebug.noLongerHighConfidenceOnly ? "yes" : "no"}
            </div>
            <div className="vehicle-card__meta">
              Vehicles parsed for {pipelineLabel(selectedPipeline)}: {activeDebug.vehiclesParsedForPipeline || 0}
            </div>
            <div className="vehicle-card__meta">
              Source duplicate keys collapsed: {activeDebug.sourceDuplicateKeysCollapsed || 0}
            </div>
            <div className="vehicle-card__meta">
              Upsert duplicate keys collapsed: {activeDebug.upsertDuplicateKeysCollapsed || 0}
            </div>
            <div className="vehicle-card__meta">Matches by registration: {activeDebug.matchesByRegistration || 0}</div>
            <div className="vehicle-card__meta">Matches by URL: {activeDebug.matchesByUrl || 0}</div>
            <div className="vehicle-card__meta">
              Matches by fallback title: {activeDebug.matchesByFallbackTitle || 0}
            </div>
            <div className="vehicle-card__meta">Upsert payload count: {activeDebug.upsertPayloadCount || 0}</div>
            <div className="vehicle-card__meta">
              ID fields removed before upsert: {activeDebug.idsRemovedBeforeUpsert || 0}
            </div>
            <div className="vehicle-card__meta">
              Final payload contains id: {activeDebug.finalPayloadContainsId ? "yes" : "no"}
            </div>
            <div className="vehicle-card__meta">Stale rows deleted this run: {activeDebug.staleRowsDeleted || 0}</div>
            <div className="vehicle-card__meta">Obsolete rows deleted this run: {activeDebug.obsoleteRowsDeleted || 0}</div>
            {activeDebug.sourceTable ? (
              <div className="vehicle-card__meta">CRM stock table: {activeDebug.sourceTable}</div>
            ) : null}
            {activeDebug.localWarning ? (
              <div className="vehicle-card__meta">{activeDebug.localWarning}</div>
            ) : null}
            {(activeDebug.parserWarnings || []).map((warning) => (
              <div key={warning} className="vehicle-card__meta">
                Parser warning: {warning}
              </div>
            ))}
            {(activeDebug.sampleTitles || []).length ? (
              <div className="vehicle-card__meta">
                Sample titles: {(activeDebug.sampleTitles || []).join(" | ")}
              </div>
            ) : null}
          </details>
        ) : null}

        {loadingPipeline === selectedPipeline ? (
          <div className="empty-state">Loading saved Vansco Stock Watch records...</div>
        ) : filteredRecords.length === 0 ? (
          <div className="empty-state">
            No vehicles match this filter yet. Run a manual check to refresh this tab.
          </div>
        ) : (
          <div className="card-grid">
            {filteredRecords.map((record) => (
              <WatchCard key={record.id || `${record.pipeline}-${record.vehicleKey}`} record={record} onRecordSaved={handleRecordSaved} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
