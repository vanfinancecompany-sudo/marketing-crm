import { useEffect, useMemo, useRef, useState } from "react";
import { emptyHealthAccumulator, mergeHealthAccumulators, summariseHealth } from "../lib/aiAssistantHealth.js";
import { loadAssistantHealthConfiguration, runDeterministicHealthBatch, runLiveHealthBatch } from "../services/aiAssistantCompetence.js";
import { loadAssistantHealthBaselines, saveAssistantHealthBaseline } from "../services/aiAssistantHealthBaselines.js";
import { clearMarketingAccessKey, getStoredMarketingAccessKey, isMarketingAccessDenied, saveMarketingAccessKey, validateMarketingAccessKey } from "../services/marketingAccess.js";

const BASELINE_KEY = "aiAssistantHealthBaselineV1";
const metricDefinitions = [
  ["Overall AI Health", "overall_ai_health_score", "%"],
  ["Conversation Progression", "conversation_progression", "%"],
  ["Context Retention", "context_retention", "%"],
  ["Product Separation", "product_separation_accuracy", "%"],
  ["Knowledge Retrieval", "knowledge_retrieval_accuracy", "%"],
  ["Application Progression", "application_progression_accuracy", "%"],
  ["Recovery Success", "recovery_success", "%"],
  ["Missed Applications", "missed_application_opportunities", ""],
  ["Repeated Wording", "repeated_wording_rate", "%"],
  ["Clarification Rate", "clarification_rate", "%"],
  ["Avg Response Length", "average_response_length_words", " words"],
  ["Rule Violations", "rule_violations", ""],
  ["Failed Scenarios", "failed_scenario_count", ""],
];

function Metric({ label, value, suffix, baseline }) {
  const delta = baseline == null || typeof value !== "number" ? null : Number((value - baseline).toFixed(1));
  const lowerIsBetter = /Missed|Repeated|Clarification|Violations|Failed|Length/.test(label);
  const good = delta == null ? "" : lowerIsBetter ? delta <= 0 : delta >= 0;
  return <div className={`competence-metric${good === "" ? "" : good ? " is-good" : " is-warning"}`}><span>{label}</span><strong>{value ?? "—"}{value == null ? "" : suffix}</strong>{delta == null ? null : <small>{delta > 0 ? "+" : ""}{delta} vs baseline</small>}</div>;
}

function HealthReport({ report, baseline, live = false }) {
  if (!report) return <div className="competence-empty"><strong>No validation run yet</strong><p>Choose a run size and start the protected validation.</p></div>;
  return <div className="page-stack">
    <section className="panel">
      <div className="panel__header"><div><div className="eyebrow">{live ? "Live model sample" : "Deterministic regression"}</div><h3>{report.conversations.toLocaleString()} conversations · {report.turns.toLocaleString()} turns</h3></div><div className="competence-target"><strong>{report.overall_ai_health_score}</strong><span>health score</span></div></div>
      <div className="competence-metrics">{metricDefinitions.map(([label, key, suffix]) => <Metric key={key} label={label} value={report[key]} suffix={suffix} baseline={baseline?.[key]} />)}</div>
      {live ? <div className="competence-metrics"><Metric label="Average Latency" value={report.average_response_ms} suffix=" ms" baseline={baseline?.average_response_ms} /><Metric label="Avg Input Tokens" value={report.average_input_tokens} suffix="" baseline={baseline?.average_input_tokens} /><Metric label="Avg Output Tokens" value={report.average_output_tokens} suffix="" baseline={baseline?.average_output_tokens} /><Metric label="Estimated Cost" value={report.estimated_cost_usd == null ? null : `$${report.estimated_cost_usd}`} suffix="" /><Metric label="Cost / Conversation" value={report.estimated_cost_per_conversation_usd == null ? null : `$${report.estimated_cost_per_conversation_usd}`} suffix="" /><Metric label="Response Quality" value={report.response_quality_score} suffix="%" baseline={baseline?.response_quality_score} /></div> : null}
    </section>
    <section className="panel"><div className="panel__header"><div><div className="eyebrow">Failures</div><h3>Failed scenarios and rule violations</h3></div></div>{report.failed_scenarios?.length ? <div className="competence-report-list">{report.failed_scenarios.map((item) => <div key={item.scenario_id}><strong>{item.scenario_id} · {item.name}</strong><span>{item.product_context} · {item.category}</span>{item.failures.map((failure, index) => <p key={`${failure.rule}-${index}`}><b>{failure.rule}</b>: {failure.detail}</p>)}</div>)}</div> : <div className="notice notice--success">No failed scenarios were recorded in this run.</div>}</section>
    <section className="panel"><div className="panel__header"><div><div className="eyebrow">Coverage</div><h3>Results by product</h3></div></div><div className="competence-metrics">{Object.entries(report.product_results || {}).map(([product, item]) => <Metric key={product} label={product === "rent2buy" ? "Rent2Buy" : "Finance"} value={`${item.conversations} run · ${item.failed} failed`} suffix="" />)}</div></section>
  </div>;
}

function BaselineLibrary({ baselines = [] }) {
  if (!baselines.length) return <div className="notice">No server baseline has been saved yet. Complete a validation run, then save it deliberately.</div>;
  return <section className="panel"><div className="panel__header"><div><div className="eyebrow">Durable baselines</div><h3>Saved regression snapshots</h3><p>Protected server records survive browser changes and are used for future comparisons.</p></div></div><div className="competence-report-list">{baselines.slice(0, 8).map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.mode} · {Number(item.conversations || 0).toLocaleString()} conversations · health {item.overall_ai_health_score ?? "—"}%</span><p>{item.commit_sha ? `Commit ${String(item.commit_sha).slice(0, 7)} · ` : ""}{item.created_at ? new Date(item.created_at).toLocaleString("en-GB") : ""}</p></div>)}</div></section>;
}

export default function AIAssistantHealthPage() {
  const [accessStatus, setAccessStatus] = useState(() => getStoredMarketingAccessKey() ? "checking" : "locked");
  const [accessKey, setAccessKey] = useState("");
  const [accessError, setAccessError] = useState("");
  const [configuration, setConfiguration] = useState(null);
  const [mode, setMode] = useState("deterministic");
  const [deterministicCount, setDeterministicCount] = useState(10000);
  const [liveCount, setLiveCount] = useState(100);
  const [report, setReport] = useState(null);
  const [localBaseline, setLocalBaseline] = useState(() => { try { return JSON.parse(localStorage.getItem(BASELINE_KEY) || "null"); } catch { return null; } });
  const [serverBaselines, setServerBaselines] = useState([]);
  const [progress, setProgress] = useState({ running: false, completed: 0, total: 0 });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [savingBaseline, setSavingBaseline] = useState(false);
  const cancelRef = useRef(false);

  const latestServerBaseline = useMemo(() => serverBaselines.find((item) => item.mode === mode) || null, [serverBaselines, mode]);
  const comparisonBaseline = latestServerBaseline?.report || (localBaseline?.mode === mode ? localBaseline : null);

  async function loadProtectedConfiguration() {
    const [configurationPayload, baselinePayload] = await Promise.all([
      loadAssistantHealthConfiguration(),
      loadAssistantHealthBaselines(),
    ]);
    setConfiguration(configurationPayload.configuration);
    setServerBaselines(baselinePayload.baselines || []);
  }

  useEffect(() => {
    let active = true;
    const stored = getStoredMarketingAccessKey();
    if (!stored) { setAccessStatus("locked"); return () => { active = false; }; }
    validateMarketingAccessKey(stored).then(async () => {
      if (!active) return;
      setAccessStatus("unlocked");
      const [configurationPayload, baselinePayload] = await Promise.all([loadAssistantHealthConfiguration(), loadAssistantHealthBaselines()]);
      if (active) { setConfiguration(configurationPayload.configuration); setServerBaselines(baselinePayload.baselines || []); }
    }).catch((caught) => {
      clearMarketingAccessKey();
      if (active) { setAccessStatus("locked"); setAccessError(isMarketingAccessDenied(caught) ? "Your saved access is not valid for this deployment." : caught.message); }
    });
    return () => { active = false; cancelRef.current = true; };
  }, []);

  async function unlock(event) {
    event.preventDefault(); setAccessError("");
    try {
      await validateMarketingAccessKey(accessKey.trim());
      saveMarketingAccessKey(accessKey.trim()); setAccessKey(""); setAccessStatus("unlocked");
      await loadProtectedConfiguration();
    } catch (caught) { clearMarketingAccessKey(); setAccessStatus("locked"); setAccessError(isMarketingAccessDenied(caught) ? "Access key not recognised." : caught.message); }
  }

  async function runValidation(live) {
    const total = live ? Math.min(100, Math.max(50, Number(liveCount) || 100)) : Math.min(10000, Math.max(1, Number(deterministicCount) || 10000));
    const batchSize = live ? configuration.live_batch_limit : configuration.deterministic_batch_limit;
    cancelRef.current = false; setError(""); setMessage(""); setReport(null); setProgress({ running: true, completed: 0, total });
    let accumulator = emptyHealthAccumulator(live ? "live" : "deterministic");
    try {
      for (let start = 0; start < total && !cancelRef.current; start += batchSize) {
        const payload = live
          ? await runLiveHealthBatch({ start_index: start, count: Math.min(batchSize, total - start), total_conversations: total, confirm_live_validation: true })
          : await runDeterministicHealthBatch({ start_index: start, count: Math.min(batchSize, total - start), total_conversations: total });
        accumulator = mergeHealthAccumulators(accumulator, payload.report);
        const summary = summariseHealth(accumulator);
        setReport({ ...summary, generated_at: payload.generated_at, commit: payload.commit, validation: payload.validation });
        setProgress({ running: true, completed: Math.min(total, start + payload.batch.count), total });
      }
    } catch (caught) { setError(caught.message || "AI health validation failed."); }
    finally { setProgress((current) => ({ ...current, running: false })); }
  }

  async function saveBaseline() {
    if (!report || savingBaseline) return;
    setSavingBaseline(true); setError(""); setMessage("");
    try {
      const sequence = serverBaselines.length + 1;
      const name = `Baseline ${sequence} · ${mode === "live" ? "Live" : "Deterministic"}`;
      const payload = await saveAssistantHealthBaseline({ name, mode, report });
      localStorage.setItem(BASELINE_KEY, JSON.stringify(report));
      setLocalBaseline(report);
      const refreshed = await loadAssistantHealthBaselines();
      setServerBaselines(refreshed.baselines || []);
      setMessage(`${payload.baseline?.name || name} saved as a protected server baseline.`);
    } catch (caught) { setError(caught.message || "Assistant Health baseline could not be saved."); }
    finally { setSavingBaseline(false); }
  }

  function exportReport() { if (!report) return; const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `ai-assistant-health-${mode}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); }

  if (accessStatus !== "unlocked") return <div className="page-stack competence-page"><section className="operations-summary competence-hero"><div><div className="eyebrow">Protected internal tool</div><h2>AI Assistant Health</h2><p>Unlock with the existing Marketing CRM access key.</p></div></section><section className="panel">{accessStatus === "checking" ? <div className="notice">Validating protected access…</div> : <form className="field-grid" onSubmit={unlock}><label className="field"><span className="field__label">Marketing CRM access key</span><input className="field__input" type="password" autoComplete="off" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} /></label><div className="card-actions" style={{ alignSelf: "end" }}><button className="button button--primary">Unlock</button></div>{accessError ? <div className="notice notice--error">{accessError}</div> : null}</form>}</section></div>;

  return <div className="page-stack competence-page">
    <section className="operations-summary competence-hero"><div><div className="eyebrow">Internal regression suite</div><h2>AI Assistant Health</h2><p>Validate orchestration, approved retrieval, product boundaries, conversation memory and application progression after every PR. Validation execution is write-free. Saving a completed baseline is a separate protected action.</p></div><div className="competence-target"><strong>{configuration?.scenario_library_size || "—"}</strong><span>source scenarios</span></div></section>
    <div className="competence-tabs"><button className={mode === "deterministic" ? "is-active" : ""} onClick={() => { setMode("deterministic"); setReport(null); }}>Deterministic Simulation</button><button className={mode === "live" ? "is-active" : ""} onClick={() => { setMode("live"); setReport(null); }}>Live AI Validation</button></div>
    {message ? <div className="notice notice--success">{message}</div> : null}{error ? <div className="notice notice--error">{error}</div> : null}
    {latestServerBaseline ? <div className="notice"><strong>Comparison baseline:</strong> {latestServerBaseline.name} · {Number(latestServerBaseline.conversations || 0).toLocaleString()} conversations · health {latestServerBaseline.overall_ai_health_score ?? "—"}%</div> : null}
    {mode === "deterministic" ? <section className="panel"><div className="panel__header"><div><h3>Run up to 10,000 synthetic conversations</h3><p>Baseline One defaults to the full 10,000. It runs the existing server classifiers, memory, journey, orchestrator, lexical retrieval and product filters. Approved evidence is selected deterministically; OpenAI, geocoding and database writes are disabled.</p></div></div><div className="field-grid"><label className="field"><span className="field__label">Conversation count</span><input className="field__input" type="number" min="1" max="10000" value={deterministicCount} onChange={(event) => setDeterministicCount(event.target.value)} /></label></div><div className="card-actions"><button className="button button--primary" disabled={progress.running} onClick={() => runValidation(false)}>Run Deterministic Validation</button>{progress.running ? <button className="button button--ghost" onClick={() => { cancelRef.current = true; }}>Stop after current batch</button> : null}</div></section> : <section className="panel"><div className="panel__header"><div><h3>Sample 50–100 conversations with OpenAI</h3><p>Baseline One defaults to 100. This paid mode is manually started, Preview-only and uses the configured server-side model. It never creates customer records or competence results.</p></div></div>{configuration?.preview_live_validation_available ? <><div className="field-grid"><label className="field"><span className="field__label">Representative sample size</span><input className="field__input" type="number" min="50" max="100" value={liveCount} onChange={(event) => setLiveCount(event.target.value)} /></label></div><div className="notice"><strong>Model:</strong> {configuration.model}<br /><strong>Cost estimates:</strong> {configuration.pricing_configured ? "Configured" : "Unavailable until both pricing environment variables are set"}</div><button className="button button--primary" disabled={progress.running} onClick={() => runValidation(true)}>Run Live AI Validation</button></> : <div className="notice notice--warning">Live validation is disabled here. Open this page on a protected Vercel Preview deployment.</div>}</section>}
    {progress.running || progress.completed ? <div className="competence-progress"><i style={{ width: `${progress.total ? Math.round(progress.completed / progress.total * 100) : 0}%` }} /><span>{progress.completed.toLocaleString()} of {progress.total.toLocaleString()} conversations {progress.running ? "running" : "completed"}</span></div> : null}
    <div className="card-actions"><button className="button button--ghost" disabled={!report || progress.running || savingBaseline} onClick={saveBaseline}>{savingBaseline ? "Saving…" : "Save as Server Baseline"}</button><button className="button button--ghost" disabled={!report} onClick={exportReport}>Export JSON report</button>{comparisonBaseline ? <span className="badge">Baseline: {latestServerBaseline?.name || comparisonBaseline.commit?.slice(0, 7) || "browser fallback"}</span> : null}</div>
    <HealthReport report={report} baseline={comparisonBaseline} live={mode === "live"} />
    <BaselineLibrary baselines={serverBaselines} />
  </div>;
}
