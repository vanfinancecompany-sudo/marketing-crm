import { useEffect, useMemo, useRef, useState } from "react";
import { CONVERSATION_RATING_FIELDS, CONVERSATION_REVIEW_OUTCOMES } from "../lib/conversationIntelligence.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";
import { MODEL_COMPARISON_RATING_FIELDS } from "../lib/modelComparison.js";
import { compareAssistantModels, createCompetenceRequestId, loadModelComparisonConfiguration, loadModelComparisonSummary, saveConversationReview, saveModelComparisonReview, simulateCustomerConversation } from "../services/aiAssistantCompetence.js";
import { clearMarketingAccessKey, getStoredMarketingAccessKey, saveMarketingAccessKey, validateMarketingAccessKey } from "../services/marketingAccess.js";

const labels = {
  intent_understood: "Intent understood", conversation_naturalness: "Conversation naturalness", context_memory: "Context memory",
  clarification_quality: "Clarification quality", accuracy: "Answer accuracy", product_separation: "Product separation",
  helpfulness: "Helpfulness", brevity: "Brevity", conversion_value: "Conversion value", safety: "Safety",
};
const outcomeLabel = (value) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const newSessionId = () => globalThis.crypto?.randomUUID?.() || `simulation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const initialRatings = Object.fromEntries(CONVERSATION_RATING_FIELDS.map((field) => [field, 5]));
const initialComparisonRatings = Object.fromEntries(MODEL_COMPARISON_RATING_FIELDS.map((field) => [field, 5]));

function Diagnostic({ label, value }) { return <div className="competence-metric"><span>{label}</span><strong>{value == null || value === "" ? "—" : String(value)}</strong></div>; }

function ModelResultCard({ title, result }) {
  if (!result || !Object.keys(result).length) return null;
  return <article className="panel panel--nested"><div className="panel__header"><div><div className="eyebrow">{title}</div><h3>{result.model_identifier}</h3></div><span className="badge">{result.status}</span></div>
    {result.error ? <div className="notice notice--error"><strong>{result.error.type}</strong><br />{result.error.message}<br />Fallback: {result.fallback_behavior}</div> : <div className="notice notice--success"><strong>Assistant response</strong><p>{result.assistant_response}</p></div>}
    <div className="competence-metrics"><Diagnostic label="Response time" value={`${result.response_time_ms || 0} ms`} /><Diagnostic label="Input tokens" value={result.input_tokens || 0} /><Diagnostic label="Output tokens" value={result.output_tokens || 0} /><Diagnostic label="Total tokens" value={result.total_tokens || 0} /><Diagnostic label="Estimated cost" value={result.estimated_cost_usd == null ? "Unavailable" : `$${Number(result.estimated_cost_usd).toFixed(6)}`} /><Diagnostic label="Intent" value={result.intent_classification} /><Diagnostic label="Clarification" value={result.clarification_decision?.required ? result.clarification_decision.question || "Required" : "Not required"} /><Diagnostic label="Application readiness" value={result.application_readiness} /><Diagnostic label="Recommended CTA" value={result.recommended_cta} /></div>
    <details><summary>Facts, buying signal and evidence</summary><pre className="notice" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify({ remembered_facts: result.remembered_facts, buying_signal: result.buying_signal, application_cta: result.application_cta, knowledge_sources_used: result.knowledge_sources_used }, null, 2)}</pre></details>
  </article>;
}

function ResultDiagnostics({ result }) {
  if (!result) return <div className="competence-empty"><strong>No simulated response yet</strong><p>Send a message or run a realistic scenario.</p></div>;
  const coverage = result.coverage_diagnostics || {};
  return <div className="page-stack">
    <section className="panel">
      <div className="panel__header"><div><div className="eyebrow">Conversation intelligence</div><h3>Current decision</h3></div></div>
      <div className="competence-metrics">
        <Diagnostic label="Intent" value={result.conversation_intent} />
        <Diagnostic label="Sub-intents" value={result.secondary_intents?.join(", ") || "None"} />
        <Diagnostic label="Product lock" value={result.product_context} />
        <Diagnostic label="Retrieval used" value={result.retrieval_used ? "Yes" : "No"} />
        <Diagnostic label="Clarification" value={result.clarification_required ? "Required" : "Not required"} />
        <Diagnostic label="Action" value={result.recommended_action} />
        <Diagnostic label="Handoff" value={result.human_handoff_recommended ? "Recommended" : "No"} />
        <Diagnostic label="Knowledge gap" value={result.insufficient_knowledge ? "Yes" : "No"} />
        <Diagnostic label="Buying signal" value={`${result.buying_signal || "none"} · ${result.buying_signal_strength || "low"}`} />
        <Diagnostic label="Length target" value={result.response_length_target ? `${result.response_length_target.band}: max ${result.response_length_target.maximum_words} words` : "—"} />
        <Diagnostic label="Actual length" value={result.response_word_count == null ? "—" : `${result.response_word_count} words`} />
        <Diagnostic label="Repeated disclaimer" value={result.repeated_disclaimer ? "Yes" : "No"} />
        <Diagnostic label="Readiness" value={result.application_readiness} />
        <Diagnostic label="Frustration" value={result.frustration_state} />
        <Diagnostic label="Article-like" value={result.sounded_article_like ? "Yes" : "No"} />
        <Diagnostic label="Follow-up appropriate" value={result.follow_up_question_appropriate ? "Yes" : "No"} />
        <Diagnostic label="One question only" value={result.one_question_at_a_time ? "Yes" : "No"} />
        <Diagnostic label="Buying intent level" value={result.buying_intent_level} />
        <Diagnostic label="Conversation goal" value={result.conversation_goal} />
        <Diagnostic label="Journey stage" value={result.journey_stage} />
        <Diagnostic label="Lead completeness" value={result.lead_completeness ? `${result.lead_completeness.percentage}% (${result.lead_completeness.known_count}/${result.lead_completeness.total_count})` : "—"} />
        <Diagnostic label="Application mode" value={result.application_mode_active ? "Active" : "Inactive"} />
        <Diagnostic label="Application CTA" value={result.application_cta_generated ? result.application_cta?.label : "Not generated"} />
        <Diagnostic label="Recommended CTA" value={result.recommended_cta} />
        <Diagnostic label="Progressing" value={result.conversation_progressing ? "Yes" : "No"} />
        <Diagnostic label="Stalled" value={result.conversation_stalled ? "Yes" : "No"} />
        <Diagnostic label="Universal message type" value={result.universal_message_type} />
        <Diagnostic label="Message confidence" value={result.universal_message_confidence == null ? "—" : `${result.universal_message_confidence}%`} />
        <Diagnostic label="Recovery used" value={result.recovery_rule_used ? "Yes" : "No"} />
        <Diagnostic label="Customer emotion" value={result.customer_emotion} />
        <Diagnostic label="Objection" value={result.objection_detected ? result.objection_type : "None"} />
        <Diagnostic label="Repeated phrase" value={result.repeated_phrase_detected ? "Detected" : "No"} />
        <Diagnostic label="Confidence" value={`${result.confidence}%`} />
        <Diagnostic label="Response time" value={`${result.response_time_ms} ms`} />
      </div>
      <div className="notice"><strong>Intent reason:</strong> {result.intent_reason}<br /><strong>Learning diagnosis:</strong> {result.learning_diagnosis}<br /><strong>Clarification question:</strong> {result.clarification_question || "None"}</div>
      <div className="notice"><strong>Buying-signal reason:</strong> {result.buying_signal_reason || "None"}<br /><strong>Recommended action:</strong> {result.recommended_next_conversational_action || "None"}<br /><strong>Next best question:</strong> {result.next_best_question || "None"}<br /><strong>Context resolution:</strong> {result.contextual_resolution || "None"}</div>
      <div className="notice"><strong>V4 journey reasons:</strong> {result.buying_intent_reasons?.join(" ") || "None"}<br /><strong>Journey next question:</strong> {result.journey_next_best_question || "None"}<br /><strong>Repeated assistant wording:</strong> {result.repeated_assistant_wording ? result.repeated_assistant_phrase : "No"}</div>
      <div className="notice"><strong>V5 classification:</strong> {result.universal_message_reason || "None"}<br /><strong>Emotion:</strong> {result.customer_emotion_reason || "None"}<br /><strong>Objection:</strong> {result.objection_reason || "None"}<br /><strong>Low-confidence stop:</strong> {result.conversation_confidence_below_threshold ? "Yes — clarification used" : "No"}</div>
      {result.application_cta ? <div className="notice notice--success"><strong>{result.application_cta.label}</strong><br />Internal action: {result.application_cta.action_key}<br />URL: Not configured — future Wix abstraction only</div> : null}
      {Object.keys(coverage).length ? <div className="notice"><strong>Deterministic rule:</strong><br />Location: {coverage.detected_location || "Not supplied"}<br />Resolved: {coverage.resolved_postcode || (coverage.resolved_coordinates ? `${coverage.resolved_coordinates.latitude}, ${coverage.resolved_coordinates.longitude}` : "No")}<br />Distance: {coverage.distance_miles == null ? "Not calculated" : `${coverage.distance_miles} miles`}<br />Result: {coverage.coverage_result}<br />Certainty: {coverage.certainty}</div> : null}
      <h3>Remembered facts</h3>
      <pre className="notice" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result.remembered_facts || {}, null, 2)}</pre>
      <h3>Lead completeness</h3>
      <pre className="notice" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result.lead_completeness?.fields || {}, null, 2)}</pre>
      <h3>Corrections</h3>
      <pre className="notice" style={{ whiteSpace: "pre-wrap" }}>{result.corrections?.length ? JSON.stringify(result.corrections, null, 2) : "No corrected or overridden facts."}</pre>
      <h3>Live conversation summary</h3>
      <pre className="notice" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result.conversation_summary || {}, null, 2)}</pre>
      <h3>Knowledge sources used</h3>
      <div className="competence-sources">{result.knowledge_sources_used?.length ? result.knowledge_sources_used.map((source, index) => <article className="competence-source" key={`${source.source_id}-${index}`}><div><span className="badge">{source.type === "coverage_rule" ? "Coverage Rule" : source.type?.startsWith("article") ? "Article" : "Business Brain"}</span><strong>{source.title}</strong><b>{source.score}</b></div><h4>{source.heading}</h4><p>{source.passage}</p></article>) : <p>No business source was required or selected.</p>}</div>
    </section>
  </div>;
}

export default function RealCustomerSimulationPage() {
  const [accessStatus, setAccessStatus] = useState(() => getStoredMarketingAccessKey() ? "checking" : "locked");
  const [accessKey, setAccessKey] = useState("");
  const [productContext, setProductContext] = useState("finance");
  const [sessionId, setSessionId] = useState(newSessionId);
  const [message, setMessage] = useState("Can u help");
  const [messages, setMessages] = useState([]);
  const [rememberedFacts, setRememberedFacts] = useState({});
  const [journeyState, setJourneyState] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState({ outcome: "pass", ...initialRatings, reviewer_notes: "" });
  const [reviewMessage, setReviewMessage] = useState("");
  const [scenarios, setScenarios] = useState([...REAL_CUSTOMER_SCENARIOS]);
  const [scenarioDraft, setScenarioDraft] = useState(() => JSON.stringify(REAL_CUSTOMER_SCENARIOS, null, 2));
  const [scenarioId, setScenarioId] = useState(REAL_CUSTOMER_SCENARIOS[0]?.id || "");
  const [category, setCategory] = useState("greetings");
  const [batch, setBatch] = useState({ running: false, completed: 0, total: 0, failures: [] });
  const [modelConfiguration, setModelConfiguration] = useState(null);
  const [comparisonMode, setComparisonMode] = useState("both");
  const [comparisonResult, setComparisonResult] = useState(null);
  const [comparisonScenarioId, setComparisonScenarioId] = useState("");
  const [comparisonSummary, setComparisonSummary] = useState(null);
  const [comparisonReview, setComparisonReview] = useState({ outcome: "equivalent", default_ratings: { ...initialComparisonRatings }, comparison_ratings: { ...initialComparisonRatings }, reviewer_notes: "" });
  const [comparisonMessage, setComparisonMessage] = useState("");
  const activeRequest = useRef(null);
  const categories = useMemo(() => [...new Set(scenarios.map((item) => item.category))], [scenarios]);

  useEffect(() => {
    let active = true; const stored = getStoredMarketingAccessKey();
    if (!stored) { setAccessStatus("locked"); return () => { active = false; }; }
    validateMarketingAccessKey(stored).then(() => { if (active) setAccessStatus("unlocked"); }).catch((caught) => { clearMarketingAccessKey(); if (active) { setAccessStatus("locked"); setError(caught.message || "Saved access is not valid for this deployment."); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (accessStatus !== "unlocked") return;
    let active = true;
    loadModelComparisonConfiguration().then((payload) => {
      if (!active) return;
      setModelConfiguration(payload.configuration);
      setComparisonScenarioId(payload.configuration?.test_scenarios?.[0]?.id || "");
      return loadModelComparisonSummary();
    }).then((payload) => { if (active && payload?.summary) setComparisonSummary(payload.summary); }).catch(() => { if (active) setModelConfiguration(null); });
    return () => { active = false; };
  }, [accessStatus]);

  async function unlock(event) {
    event.preventDefault(); setError("");
    try { await validateMarketingAccessKey(accessKey.trim()); saveMarketingAccessKey(accessKey.trim()); setAccessStatus("unlocked"); setAccessKey(""); }
    catch (caught) { clearMarketingAccessKey(); setAccessStatus("locked"); setError(caught.message || "Access key not recognised."); }
  }

  function resetConversation(nextProduct = productContext) {
    activeRequest.current = null;
    setProductContext(nextProduct); setSessionId(newSessionId()); setMessages([]); setRememberedFacts({}); setJourneyState({}); setResult(null); setComparisonResult(null); setReviewMessage(""); setError("");
  }

  async function runModelComparison(overrides = {}) {
    if (!modelConfiguration?.comparison_available || busy || batch.running) return;
    const submitted = String(overrides.message ?? message).trim();
    if (!submitted) return;
    setBusy(true); setError(""); setComparisonMessage(""); setComparisonResult(null);
    try {
      const requestId = createCompetenceRequestId(); activeRequest.current = requestId;
      const response = await compareAssistantModels({
        request_id: requestId, comparison_id: `comparison-${requestId}`, comparison_mode: comparisonMode,
        message: submitted, product_context: overrides.product_context || productContext,
        messages: overrides.history || messages, remembered_facts: overrides.remembered_facts || rememberedFacts,
        journey_state: overrides.journey_state || journeyState, scenario_id: overrides.scenario_id || null,
        scenario_category: overrides.scenario_category || "manual",
      });
      if (activeRequest.current !== requestId || response.request_trace?.request_id !== requestId || response.request_trace?.submitted_question !== submitted) throw new Error("A stale or mismatched model comparison was rejected.");
      setComparisonResult(response.comparison);
    } catch (caught) { setError(caught.message || "Model comparison failed."); }
    finally { setBusy(false); }
  }

  async function runControlledComparisonScenario() {
    const scenario = modelConfiguration?.test_scenarios?.find((item) => item.id === comparisonScenarioId);
    if (!scenario) return;
    setProductContext(scenario.product_context);
    await runModelComparison({ message: scenario.message, history: scenario.history, product_context: scenario.product_context, scenario_id: scenario.id, scenario_category: scenario.category });
  }

  async function handleComparisonReview() {
    if (!comparisonResult?.id) return;
    setComparisonMessage("");
    try {
      await saveModelComparisonReview({ comparison_id: comparisonResult.id, ...comparisonReview });
      const report = await loadModelComparisonSummary();
      setComparisonSummary(report.summary); setComparisonMessage("Model comparison review saved.");
    } catch (caught) { setError(caught.message || "Comparison review could not be saved."); }
  }

  async function sendOne(content, transcript = messages, facts = rememberedFacts, scenario = null, activeSession = sessionId) {
    const requestId = createCompetenceRequestId(); activeRequest.current = requestId;
    const response = await simulateCustomerConversation({ request_id: requestId, session_id: activeSession, scenario_id: scenario, message: content, product_context: productContext, messages: transcript, remembered_facts: facts, journey_state: journeyState });
    if (activeRequest.current !== requestId || response.request_trace?.request_id !== requestId || response.request_trace?.submitted_question !== content) throw new Error("A stale or mismatched simulation response was rejected.");
    return response.result;
  }

  async function handleSend(event) {
    event?.preventDefault(); const submitted = message.trim(); if (!submitted || busy || batch.running) return;
    const before = [...messages]; setMessages([...before, { role: "user", content: submitted }]); setBusy(true); setError(""); setResult(null);
    try {
      const next = await sendOne(submitted, before);
      setResult(next); setRememberedFacts(next.remembered_facts || {}); setJourneyState(next); setMessages([...before, { role: "user", content: submitted }, { role: "assistant", content: next.reply }]); setMessage("");
    } catch (caught) { setMessages(before); setError(caught.message || "Conversation simulation failed."); }
    finally { setBusy(false); }
  }

  async function runScenario(scenario) {
    const nextSession = newSessionId(); setSessionId(nextSession); setProductContext(scenario.product_context); setMessages([]); setRememberedFacts({}); setJourneyState({}); setResult(null); setError("");
    let transcript = []; let facts = {}; let journey = {}; let latest = null;
    for (const content of scenario.messages) {
      const requestId = createCompetenceRequestId(); activeRequest.current = requestId;
      const response = await simulateCustomerConversation({ request_id: requestId, session_id: nextSession, scenario_id: scenario.id, message: content, product_context: scenario.product_context, messages: transcript, remembered_facts: facts, journey_state: journey });
      if (activeRequest.current !== requestId || response.request_trace?.request_id !== requestId || response.request_trace?.submitted_question !== content) throw new Error("Scenario returned a stale or mismatched result.");
      latest = response.result; facts = latest.remembered_facts || {}; journey = latest; transcript = [...transcript, { role: "user", content }, { role: "assistant", content: latest.reply }];
      setMessages([...transcript]); setRememberedFacts({ ...facts }); setJourneyState({ ...journey }); setResult(latest);
    }
    return latest;
  }

  async function handleRunScenario() {
    const scenario = scenarios.find((item) => item.id === scenarioId); if (!scenario || busy) return;
    setBusy(true); try { await runScenario(scenario); } catch (caught) { setError(caught.message || "Scenario failed."); } finally { setBusy(false); }
  }

  async function runGroup() {
    const selected = scenarios.filter((item) => item.product_context === productContext && item.category === category); if (!selected.length || batch.running) return;
    setBatch({ running: true, completed: 0, total: selected.length, failures: [] }); const failures = [];
    for (const scenario of selected) {
      try { await runScenario(scenario); } catch (caught) { failures.push({ id: scenario.id, message: caught.message }); }
      setBatch((current) => ({ ...current, completed: current.completed + 1, failures: [...failures] }));
    }
    setBatch((current) => ({ ...current, running: false }));
  }

  function applyScenarioDraft() {
    try {
      const parsed = JSON.parse(scenarioDraft); if (!Array.isArray(parsed) || parsed.some((item) => !item.id || !["finance", "rent2buy"].includes(item.product_context) || !Array.isArray(item.messages))) throw new Error("Each scenario needs id, product_context and messages.");
      setScenarios(parsed); setScenarioId(parsed[0]?.id || ""); setError("");
    } catch (caught) { setError(`Scenario library is invalid: ${caught.message}`); }
  }

  async function handleReview() {
    if (!result?.id) return; setReviewMessage("");
    try { await saveConversationReview({ result_id: result.id, ...review }); setReviewMessage("Conversation review saved and learning assessment refreshed."); }
    catch (caught) { setError(caught.message || "Review could not be saved."); }
  }

  if (accessStatus !== "unlocked") return <main className="page-stack"><section className="panel"><h2>Real Customer Simulation</h2><p>This internal page uses the existing Marketing CRM access check.</p><form onSubmit={unlock}><label className="field"><span className="field__label">Marketing CRM access key</span><input className="field__input" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} /></label><button className="button button--primary">Unlock</button></form>{error ? <div className="notice notice--error">{error}</div> : null}</section></main>;

  return <div className="page-stack">
    <section className="panel"><div className="panel__header"><div><div className="eyebrow">AI Sales Assistant V5</div><h2>Human Conversation & Recovery Simulation</h2><p>Test natural recovery, emotion-aware replies and grounded application progression without exposing a public Wix assistant. Use synthetic test wording only; do not enter real customer personal data.</p></div><button className="button button--ghost" type="button" disabled={busy || batch.running} onClick={() => resetConversation()}>Reset Conversation</button></div>
      <div className="competence-metrics"><Diagnostic label="Locked product" value={productContext} /><Diagnostic label="Session" value={sessionId} /><Diagnostic label="Messages" value={messages.length} /></div>
      <div className="competence-context"><button type="button" disabled={busy || batch.running} className={productContext === "finance" ? "is-selected" : ""} onClick={() => resetConversation("finance")}>Finance</button><button type="button" disabled={busy || batch.running} className={productContext === "rent2buy" ? "is-selected" : ""} onClick={() => resetConversation("rent2buy")}>Rent2Buy</button></div>
    </section>
    <section className="panel"><h3>Conversation transcript</h3><div className="competence-report-list">{messages.length ? messages.map((item, index) => <div key={`${index}-${item.role}`}><strong>{item.role === "user" ? "Customer" : "Assistant"}</strong><p>{item.content}</p></div>) : <p>No messages yet.</p>}</div>
      <form onSubmit={handleSend}><label className="field"><span className="field__label">Customer message</span><textarea className="field__input" rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type exactly as a real customer might..." /></label><button className="button button--primary" disabled={busy || batch.running}>{busy || batch.running ? "Testing..." : "Send Message"}</button></form>
      {error ? <div className="notice notice--error">{error}</div> : null}
    </section>
    {modelConfiguration?.comparison_available ? <section className="panel"><div className="panel__header"><div><div className="eyebrow">Preview only</div><h3>OpenAI model comparison</h3><p>Runs a non-mutating snapshot. Both models receive the same message, history, product lock, prompt, deterministic result and retrieved evidence. Neither response enters the other model’s history.</p></div><span className="badge">No store</span></div>
      <div className="field-grid"><label className="field"><span className="field__label">Model run</span><select className="field__input" value={comparisonMode} onChange={(event) => setComparisonMode(event.target.value)}><option value="default">Default model</option><option value="comparison">Comparison model</option><option value="both">Run both models</option></select></label><label className="field"><span className="field__label">Controlled comparison scenario</span><select className="field__input" value={comparisonScenarioId} onChange={(event) => setComparisonScenarioId(event.target.value)}>{modelConfiguration.test_scenarios?.map((scenario) => <option value={scenario.id} key={scenario.id}>{scenario.id} · {outcomeLabel(scenario.category)}</option>)}</select></label></div>
      <div className="competence-metrics"><Diagnostic label="Default model" value={modelConfiguration.default_model} /><Diagnostic label="Comparison model" value={modelConfiguration.comparison_model} /><Diagnostic label="Default available to project" value={modelConfiguration.project_availability?.[modelConfiguration.default_model]?.available ? "Yes" : modelConfiguration.project_availability?.[modelConfiguration.default_model]?.reason || "Unverified"} /><Diagnostic label="Comparison available to project" value={modelConfiguration.project_availability?.[modelConfiguration.comparison_model]?.available ? "Yes" : modelConfiguration.project_availability?.[modelConfiguration.comparison_model]?.reason || "Unverified"} /></div>
      <div className="card-actions"><button type="button" className="button button--primary" disabled={busy} onClick={() => runModelComparison()}>{busy ? "Running…" : "Compare Current Message"}</button><button type="button" className="button button--ghost" disabled={busy || !comparisonScenarioId} onClick={runControlledComparisonScenario}>Run Controlled Scenario</button></div>
      {comparisonResult ? <><div className="notice"><strong>Comparison ID:</strong> {comparisonResult.comparison_id}<br /><strong>Inputs equivalent:</strong> {comparisonResult.inputs_equivalent ? "Verified" : "Failed"}<br /><strong>History hash:</strong> {comparisonResult.conversation_history_hash}<br /><strong>Input hash:</strong> {comparisonResult.input_hash}<br /><strong>Shared source IDs:</strong> {comparisonResult.retrieved_source_ids?.join(", ") || "None"}<br /><strong>Retrieval time:</strong> {comparisonResult.retrieval_time_ms || 0} ms</div><div className="card-grid"><ModelResultCard title="Default model" result={comparisonResult.default_result} /><ModelResultCard title="Comparison model" result={comparisonResult.comparison_result} /></div>
        {comparisonResult.default_result?.status && comparisonResult.comparison_result?.status ? <div className="panel panel--nested"><h3>Comparison review</h3><div className="competence-outcomes">{[["default_better","Default model better"],["comparison_better","Comparison model better"],["equivalent","Equivalent"],["both_poor","Both poor"]].map(([value,label]) => <button type="button" key={value} className={comparisonReview.outcome === value ? "is-selected" : ""} onClick={() => setComparisonReview({ ...comparisonReview, outcome: value })}>{label}</button>)}</div>
          <div className="card-grid">{[["default_ratings","Default model"],["comparison_ratings","Comparison model"]].map(([side,title]) => <div key={side}><h4>{title}</h4><div className="competence-ratings">{MODEL_COMPARISON_RATING_FIELDS.map((field) => <label key={`${side}-${field}`}><span>{outcomeLabel(field)}</span><select value={comparisonReview[side][field]} onChange={(event) => setComparisonReview({ ...comparisonReview, [side]: { ...comparisonReview[side], [field]: Number(event.target.value) } })}>{[1,2,3,4,5].map((value) => <option value={value} key={value}>{value}/5</option>)}</select></label>)}</div></div>)}</div>
          <label className="field"><span className="field__label">Reviewer notes</span><textarea className="field__input" rows={3} value={comparisonReview.reviewer_notes} onChange={(event) => setComparisonReview({ ...comparisonReview, reviewer_notes: event.target.value })} /></label><button type="button" className="button button--primary" onClick={handleComparisonReview}>Save Comparison Review</button>{comparisonMessage ? <div className="notice">{comparisonMessage}</div> : null}</div> : null}</> : null}
      {comparisonSummary ? <details><summary><strong>Comparison summary ({comparisonSummary.total_comparisons || 0} completed)</strong></summary><div className="competence-metrics"><Diagnostic label="Default wins" value={comparisonSummary.default_wins} /><Diagnostic label="Comparison wins" value={comparisonSummary.comparison_wins} /><Diagnostic label="Ties" value={comparisonSummary.ties} /><Diagnostic label="Both poor" value={comparisonSummary.both_poor} /><Diagnostic label="Average cost / response" value={comparisonSummary.average_estimated_cost_per_response_usd == null ? "Unavailable" : `$${comparisonSummary.average_estimated_cost_per_response_usd}`} /><Diagnostic label="Estimated / 1,000" value={comparisonSummary.estimated_cost_per_1000_conversations_usd == null ? "Unavailable" : `$${comparisonSummary.estimated_cost_per_1000_conversations_usd}`} /></div><pre className="notice" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(comparisonSummary, null, 2)}</pre><p>No statistical-significance claim is made.</p></details> : null}
    </section> : null}
    <ResultDiagnostics result={result} />
    <section className="panel"><div className="panel__header"><div><div className="eyebrow">Manual review</div><h3>Score this behaviour</h3></div></div>
      <div className="competence-outcomes">{CONVERSATION_REVIEW_OUTCOMES.map((outcome) => <button type="button" className={review.outcome === outcome ? "is-selected" : ""} onClick={() => setReview({ ...review, outcome })} key={outcome}>{outcomeLabel(outcome)}</button>)}</div>
      <div className="competence-ratings">{CONVERSATION_RATING_FIELDS.map((field) => <label key={field}><span>{labels[field]}</span><select value={review[field]} onChange={(event) => setReview({ ...review, [field]: Number(event.target.value) })}>{[1,2,3,4,5].map((value) => <option value={value} key={value}>{value}/5</option>)}</select></label>)}</div>
      <label className="field"><span className="field__label">Reviewer notes</span><textarea className="field__input" rows={4} value={review.reviewer_notes} onChange={(event) => setReview({ ...review, reviewer_notes: event.target.value })} /></label><button className="button button--primary" type="button" disabled={!result?.id} onClick={handleReview}>Save Review</button>{reviewMessage ? <div className="notice">{reviewMessage}</div> : null}
    </section>
    <section className="panel"><div className="panel__header"><div><div className="eyebrow">Scenario library</div><h3>{scenarios.length} realistic scenarios</h3><p>Edit this working library, run one scenario, or run the selected product/category group.</p></div></div>
      <div className="field-grid"><label className="field"><span className="field__label">Scenario</span><select className="field__input" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{scenarios.map((item) => <option value={item.id} key={item.id}>{item.id} · {item.name}</option>)}</select></label><label className="field"><span className="field__label">Grouped category</span><select className="field__input" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option value={item} key={item}>{outcomeLabel(item)}</option>)}</select></label></div>
      <div className="card-actions"><button className="button button--primary" type="button" disabled={busy || batch.running} onClick={handleRunScenario}>Run One Scenario</button><button className="button button--ghost" type="button" disabled={busy || batch.running} onClick={runGroup}>{batch.running ? `Running ${batch.completed}/${batch.total}` : "Run Grouped Scenario Set"}</button></div>
      {batch.total ? <div className="notice">Completed {batch.completed}/{batch.total}. Failures: {batch.failures.length}.</div> : null}
      <details><summary>Edit realistic customer-message library</summary><textarea className="field__input" style={{ minHeight: 420, marginTop: 12 }} value={scenarioDraft} onChange={(event) => setScenarioDraft(event.target.value)} /><button className="button button--ghost" type="button" onClick={applyScenarioDraft}>Apply Edited Library</button></details>
    </section>
  </div>;
}
