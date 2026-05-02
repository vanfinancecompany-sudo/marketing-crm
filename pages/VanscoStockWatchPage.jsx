import { useEffect, useMemo, useState } from "react";
import {
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
        <div className="vehicle-card__meta">Price: {record.price || "Not found"}</div>
        <div className="vehicle-card__meta">
          {record.year || "Year not found"} {record.mileage ? `| ${record.mileage}` : ""}
        </div>
        <div className="vehicle-card__meta">First seen: {formatWatchTimestamp(record.firstSeenAt)}</div>
        <div className="vehicle-card__meta">Last checked: {formatWatchTimestamp(record.lastCheckedAt)}</div>
        <div className="vehicle-card__meta">Last seen on Vansco: {formatWatchTimestamp(record.lastSeenAt)}</div>

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
  const [loadingPipeline, setLoadingPipeline] = useState("");
  const [checkingPipeline, setCheckingPipeline] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [debugByPipeline, setDebugByPipeline] = useState({
    finance: null,
    rent2buy: null,
    cars: null,
  });

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
  const activeRecords = recordsByPipeline[selectedPipeline] || [];

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

    if (activeFilter === "missing") {
      return activeRecords.filter(
        (record) => record.matchStatus === "missing" && !isSuppressedWorkflowStatus(record.workflowStatus)
      );
    }

    return activeRecords.filter((record) => record.matchStatus === activeFilter);
  }, [activeFilter, activeRecords]);

  const summary = useMemo(() => {
    return {
      missing: activeRecords.filter(
        (record) => record.matchStatus === "missing" && !isSuppressedWorkflowStatus(record.workflowStatus)
      ).length,
      listed: activeRecords.filter((record) => record.matchStatus === "listed").length,
      noLonger: activeRecords.filter((record) => record.matchStatus === "no_longer_on_vansco").length,
      reserved: activeRecords.filter((record) => record.matchStatus === "reserved_still_listed").length,
      reviewLater: activeRecords.filter((record) => record.workflowStatus === "review_later").length,
      ignored: activeRecords.filter((record) => isSuppressedWorkflowStatus(record.workflowStatus)).length,
      addedToCrm: activeRecords.filter((record) => record.workflowStatus === "added_to_crm").length,
      addedToWix: activeRecords.filter((record) => record.workflowStatus === "added_to_wix").length,
    };
  }, [activeRecords]);

  const lastCheckedAt = useMemo(() => {
    return activeRecords.reduce((latest, record) => {
      if (!record.lastCheckedAt) return latest;
      if (!latest) return record.lastCheckedAt;
      return new Date(record.lastCheckedAt) > new Date(latest) ? record.lastCheckedAt : latest;
    }, "");
  }, [activeRecords]);

  async function handleRunCheck() {
    setCheckingPipeline(selectedPipeline);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result = await runVanscoStockCheck(selectedPipeline);
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
          </div>
          <button
            className="button button--primary"
            type="button"
            onClick={handleRunCheck}
            disabled={checkingPipeline === selectedPipeline}
          >
            {checkingPipeline === selectedPipeline ? "Checking Vansco..." : "Check Vansco Stock"}
          </button>
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
          Selected tab: {pipelineLabel(selectedPipeline)} | Last checked: {formatWatchTimestamp(lastCheckedAt)}
        </div>
      </section>

      <section className="stats-grid vansco-summary-grid">
        <SummaryCard label={`Missing from ${pipelineLabel(selectedPipeline)}`} value={summary.missing} tone="blue" />
        <SummaryCard label="Already listed" value={summary.listed} tone="green" />
        <SummaryCard label="No longer on Vansco" value={summary.noLonger} tone="amber" />
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

        {activeDebug ? (
          <div className="vansco-debug-panel">
            <div className="vehicle-card__meta">Vansco page fetched: {activeDebug.pageFetched ? "yes" : "no"}</div>
            <div className="vehicle-card__meta">HTML length: {activeDebug.htmlLength || 0}</div>
            <div className="vehicle-card__meta">Endpoint used: {activeDebug.endpointUsed || "Unknown"}</div>
            <div className="vehicle-card__meta">Pages fetched: {activeDebug.pagesFetched || 0}</div>
            <div className="vehicle-card__meta">Candidate links found: {activeDebug.candidateLinksFound || 0}</div>
            <div className="vehicle-card__meta">Vehicle detail URLs kept: {activeDebug.vehiclesParsed || 0}</div>
            <div className="vehicle-card__meta">Vehicles parsed: {activeDebug.vehiclesParsed || 0}</div>
            <div className="vehicle-card__meta">
              Vehicles parsed for {pipelineLabel(selectedPipeline)}: {activeDebug.vehiclesParsedForPipeline || 0}
            </div>
            <div className="vehicle-card__meta">
              Source duplicate keys collapsed: {activeDebug.sourceDuplicateKeysCollapsed || 0}
            </div>
            <div className="vehicle-card__meta">
              Upsert duplicate keys collapsed: {activeDebug.upsertDuplicateKeysCollapsed || 0}
            </div>
            <div className="vehicle-card__meta">Upsert payload count: {activeDebug.upsertPayloadCount || 0}</div>
            <div className="vehicle-card__meta">
              ID fields removed before upsert: {activeDebug.idsRemovedBeforeUpsert || 0}
            </div>
            <div className="vehicle-card__meta">
              Final payload contains id: {activeDebug.finalPayloadContainsId ? "yes" : "no"}
            </div>
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
          </div>
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
