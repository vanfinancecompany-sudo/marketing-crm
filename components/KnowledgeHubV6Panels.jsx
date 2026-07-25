import { useMemo, useState } from "react";

const titleCase = (value) =>
  String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function Briefing({ briefing }) {
  if (!briefing) {
    return <div className="notice">The first daily briefing will appear after the automation worker runs.</div>;
  }
  const completed = briefing.completed_summary || {};
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Daily Briefing · {briefing.briefing_date}</div>
          <h3>Good Morning</h3>
          <p>{briefing.explanation}</p>
        </div>
        <strong>{briefing.estimated_review_minutes} min review</strong>
      </div>
      <div className="knowledge-breakdown-grid">
        {Object.entries(completed).map(([key, value]) => (
          <div key={key}><strong>{titleCase(key)}</strong><span>{value}</span></div>
        ))}
      </div>
      <div className="knowledge-list" style={{ marginTop: 16 }}>
        {(briefing.priorities || []).map((priority) => (
          <div className="knowledge-list__item" key={priority.opportunity_id}>
            <span><strong>{priority.title}</strong><small>{priority.reason}</small></span>
            <b>{priority.priority_score}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function AutomationSettings({ settings, updateSettings, onSave, onPause, onResume, onScan, busy }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Quiet Assistant</div>
          <h3>Editorial Automation</h3>
          <p>Background preparation stops at review. Only you can approve an article.</p>
        </div>
        <span className={`status-pill ${settings.paused ? "" : "stat-card--green"}`}>
          {settings.paused ? "Paused" : "Running"}
        </span>
      </div>
      <div className="card-actions">
        {settings.paused ? (
          <button className="button button--success" disabled={busy} onClick={onResume}>Resume</button>
        ) : (
          <button className="button button--ghost" disabled={busy} onClick={onPause}>Pause</button>
        )}
        <button className="button button--primary" disabled={busy || settings.paused} onClick={onScan}>
          Scan & Discover Now
        </button>
      </div>
      <div className="field-grid" style={{ marginTop: 16 }}>
        {[
          ["minimum_draft_score", "Minimum draft score", 50, 95],
          ["daily_draft_limit", "Daily draft limit", 0, 20],
          ["max_jobs_per_run", "Jobs per worker run", 1, 10],
          ["max_attempts", "Retry attempts", 1, 5],
          ["automatic_improvement_attempts", "New-draft improvement attempts", 0, 3],
          ["scan_interval_hours", "Scan interval (hours)", 1, 168],
        ].map(([key, label, min, max]) => (
          <label className="field" key={key}>
            <span className="field__label">{label}</span>
            <input
              className="field__input"
              type="number"
              min={min}
              max={max}
              value={settings[key]}
              onChange={(event) => updateSettings({ ...settings, [key]: Number(event.target.value) })}
            />
          </label>
        ))}
      </div>
      <button className="button button--ghost" disabled={busy} onClick={onSave}>Save Automation Settings</button>
      <div className="notice" style={{ marginTop: 16 }}>
        Prohibited: automatic publication, approval, scheduling, website changes, email, SMS and social posting.
      </div>
    </section>
  );
}

function Opportunities({ opportunities, onApprove, onDismiss, busy }) {
  const [status, setStatus] = useState("draft");
  const [type, setType] = useState("all");
  const [edits, setEdits] = useState({});
  const filtered = opportunities.filter(
    (item) => (status === "all" || item.status === status) && (type === "all" || item.opportunity_type === type)
  );
  const update = (item, field, value) =>
    setEdits((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), [field]: value } }));
  return (
    <section className="panel">
      <div className="panel__header"><div><h3>Editorial Opportunities</h3><p>AI and deterministic findings remain draft opportunities until you approve them.</p></div></div>
      <div className="knowledge-filters">
        <select className="field__input" value={status} onChange={(event) => setStatus(event.target.value)}>
          {["draft", "queued", "completed", "dismissed", "all"].map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}
        </select>
        <select className="field__input" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="all">All opportunity types</option>
          {[...new Set(opportunities.map((item) => item.opportunity_type))].map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}
        </select>
      </div>
      <div className="knowledge-table-wrap">
        <table className="knowledge-table">
          <thead><tr><th>Priority</th><th>Opportunity</th><th>Classification</th><th>Decision</th></tr></thead>
          <tbody>
            {filtered.map((item) => {
              const values = { ...item, ...(edits[item.id] || {}) };
              return (
                <tr key={item.id}>
                  <td><strong>{item.priority_score}</strong><small>Value {item.business_value}/5 · Conversion {item.conversion_potential}/5 · Effort {item.editorial_effort}/5</small></td>
                  <td>
                    {item.status === "draft" ? (
                      <input className="field__input" value={values.title} onChange={(event) => update(item, "title", event.target.value)} />
                    ) : <strong>{item.title}</strong>}
                    <small>{item.reason}</small><small>{item.explanation}</small>
                  </td>
                  <td>
                    {item.status === "draft" ? (
                      <>
                        <select className="field__input" value={values.primary_product} onChange={(event) => update(item, "primary_product", event.target.value)}>{["finance", "rent2buy", "both"].map((value) => <option key={value}>{value}</option>)}</select>
                        <select className="field__input" value={values.customer_journey} onChange={(event) => update(item, "customer_journey", event.target.value)}>{["awareness", "research", "comparison", "decision", "ready_to_apply"].map((value) => <option key={value}>{value}</option>)}</select>
                      </>
                    ) : <>{titleCase(item.primary_product)}<small>{titleCase(item.customer_journey)}</small></>}
                  </td>
                  <td>
                    {item.status === "draft" ? (
                      <div className="card-actions">
                        <button className="button button--primary" disabled={busy} onClick={() => onApprove(item.id, edits[item.id] || {})}>Approve Preparation</button>
                        <button className="button button--ghost" disabled={busy} onClick={() => onDismiss(item.id)}>Dismiss</button>
                      </div>
                    ) : <span className="status-pill">{titleCase(item.status)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function JobsAndLogs({ jobs, logs, onCancel, onRetry, busy }) {
  const [logResult, setLogResult] = useState("all");
  const [logAction, setLogAction] = useState("all");
  const filteredLogs = useMemo(
    () => logs.filter(
      (item) => (logResult === "all" || item.result === logResult) && (logAction === "all" || item.action === logAction)
    ),
    [logs, logResult, logAction]
  );
  return (
    <>
      <section className="panel">
        <div className="panel__header"><div><h3>Automation Queue</h3><p>Priorities, retries, cancellation, duration and outcomes.</p></div></div>
        <div className="knowledge-table-wrap">
          <table className="knowledge-table">
            <thead><tr><th>Job</th><th>Status</th><th>Attempts</th><th>Duration</th><th>Control</th></tr></thead>
            <tbody>{jobs.slice(0, 100).map((job) => (
              <tr key={job.id}>
                <td><strong>{titleCase(job.job_type)}</strong><small>{job.explanation}</small></td>
                <td><span className="status-pill">{titleCase(job.status)}</span>{job.error_message ? <small>{job.error_message}</small> : null}</td>
                <td>{job.attempts}/{job.max_attempts}</td>
                <td>{job.duration_ms ? `${(job.duration_ms / 1000).toFixed(1)}s` : "-"}</td>
                <td>{job.status === "queued" ? <button className="button button--ghost" disabled={busy} onClick={() => onCancel(job.id)}>Cancel</button> : ["failed", "cancelled"].includes(job.status) ? <button className="button button--ghost" disabled={busy} onClick={() => onRetry(job.id)}>Retry</button> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel__header"><div><h3>Automation Log</h3><p>Every action includes its reason, result, target and duration.</p></div></div>
        <div className="knowledge-filters">
          <select className="field__input" value={logAction} onChange={(event) => setLogAction(event.target.value)}><option value="all">All actions</option>{[...new Set(logs.map((item) => item.action))].map((value) => <option key={value}>{value}</option>)}</select>
          <select className="field__input" value={logResult} onChange={(event) => setLogResult(event.target.value)}><option value="all">All results</option>{[...new Set(logs.map((item) => item.result))].map((value) => <option key={value}>{value}</option>)}</select>
        </div>
        <div className="knowledge-table-wrap">
          <table className="knowledge-table">
            <thead><tr><th>Timestamp</th><th>Action</th><th>Article / opportunity</th><th>Reason</th><th>Result</th><th>Duration</th></tr></thead>
            <tbody>{filteredLogs.slice(0, 250).map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString("en-GB")}</td>
                <td>{titleCase(log.action)}</td>
                <td>{log.knowledge_articles?.title || log.knowledge_automation_opportunities?.title || "-"}</td>
                <td>{log.reason}</td>
                <td><span className="status-pill">{titleCase(log.result)}</span></td>
                <td>{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function EditorialAutomationPlatform({
  automation,
  settings,
  updateSettings,
  onSaveSettings,
  onPause,
  onResume,
  onScan,
  onApprove,
  onDismiss,
  onCancel,
  onRetry,
  busy,
}) {
  return (
    <section className="page-stack">
      <AutomationSettings settings={settings} updateSettings={updateSettings} onSave={onSaveSettings} onPause={onPause} onResume={onResume} onScan={onScan} busy={busy} />
      <Briefing briefing={automation.briefings?.[0]} />
      <Opportunities opportunities={automation.opportunities || []} onApprove={onApprove} onDismiss={onDismiss} busy={busy} />
      <JobsAndLogs jobs={automation.jobs || []} logs={automation.logs || []} onCancel={onCancel} onRetry={onRetry} busy={busy} />
    </section>
  );
}
