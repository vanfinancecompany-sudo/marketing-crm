import { useEffect, useMemo, useRef, useState } from "react";
import { CONVERSATION_RATING_FIELDS, CONVERSATION_REVIEW_OUTCOMES } from "../lib/conversationIntelligence.js";
import { CONVERSATION_POLISH_REVIEW_FIELDS } from "../lib/conversationPolish.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";
import { createCompetenceRequestId, saveConversationReview, simulateCustomerConversation } from "../services/aiAssistantCompetence.js";
import { clearMarketingAccessKey, getStoredMarketingAccessKey, saveMarketingAccessKey, validateMarketingAccessKey } from "../services/marketingAccess.js";

const labels = {
  intent_understood: "Intent understood", conversation_naturalness: "Conversation Naturalness", context_memory: "Context memory",
  clarification_quality: "Clarification quality", accuracy: "Answer accuracy", product_separation: "Product separation",
  helpfulness: "Helpfulness", brevity: "Brevity", conversion_value: "Conversion value", safety: "Safety",
  sales_flow_quality: "Sales Flow Quality", transition_quality: "Transition Quality", knowledge_integration: "Knowledge Integration",
  conversation_smoothness: "Conversation Smoothness", cta_timing: "CTA Timing", conversation_confidence: "Conversation Confidence",
  redundancy_score: "Redundancy Score", human_feel_rating: "Human Feel Rating",
};
const outcomeLabel = (value) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const newSessionId = () => globalThis.crypto?.randomUUID?.() || `simulation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const initialRatings = Object.fromEntries(CONVERSATION_RATING_FIELDS.map((field) => [field, 5]));
const initialPolishRatings = Object.fromEntries(CONVERSATION_POLISH_REVIEW_FIELDS.map((field) => [field, 5]));
const coreRatingFields = CONVERSATION_RATING_FIELDS.filter((field) => field !== "conversation_naturalness");
const polishRatingFields = ["conversation_naturalness", ...CONVERSATION_POLISH_REVIEW_FIELDS];

function Diagnostic({ label, value }) { return <div className="competence-metric"><span>{label}</span><strong>{value == null || value === "" ? "—" : String(value)}</strong></div>; }

function ResultDiagnostics({ result }) {
  if (!result) return <div className="competence-empty"><strong>No simulated response yet</strong><p>Send a message or run a realistic scenario.</p></div>;
  const coverage = result.coverage_diagnostics || {};
  return <div className="page-stack">
    <section className="panel">
      <div className="panel__header"><div><div className="eyebrow">Conversation intelligence</div><h3>Current decision</h3></div></div>
      <div className="competence-metrics">
        <Diagnostic label="Intent" value={result.conversation_intent} />
        <Diagnostic label="Sub-intents" value={result.secondary_intents?.join(", ") || "None"} />
        <Diagnostic label="V6 detected intents" value={result.detected_intents?.join(", ") || "None"} />
        <Diagnostic label="Product lock" value={result.product_context} />
        <Diagnostic label="Retrieval required" value={result.retrieval_required ? "Yes" : "No"} />
        <Diagnostic label="Retrieval performed" value={result.retrieval_performed ? "Yes" : "No"} />
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
        <Diagnostic label="Application mode paused" value={result.application_mode_paused ? "Yes" : "No"} />
        <Diagnostic label="Application mode resumed" value={result.application_mode_resumed ? "Yes" : "No"} />
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
        <Diagnostic label="Repeated Fact Score" value={result.repeated_fact_score == null ? "—" : `${result.repeated_fact_score}/100`} />
        <Diagnostic label="Recent Phrase Similarity" value={result.recent_phrase_similarity == null ? "—" : `${result.recent_phrase_similarity}%`} />
        <Diagnostic label="Conversation Variety Score" value={result.conversation_variety_score == null ? "—" : `${result.conversation_variety_score}/100`} />
        <Diagnostic label="Redundancy Score" value={result.redundancy_score == null ? "—" : `${result.redundancy_score}/100`} />
        <Diagnostic label="Human Feel Rating" value={result.human_feel_rating == null ? "—" : `${result.human_feel_rating}/100`} />
        <Diagnostic label="Sentence range" value={result.preferred_sentence_range_met ? "2–5 sentences" : `${result.response_sentence_count || 0} sentences`} />
        <Diagnostic label="CTA timing" value={result.cta_generated_early ? "Shown early" : result.cta_timing_eligible ? "Existing CTA" : "Held back"} />
        <Diagnostic label="Confidence" value={`${result.confidence}%`} />
        <Diagnostic label="Response time" value={`${result.response_time_ms} ms`} />
      </div>
      <div className="notice"><strong>Intent reason:</strong> {result.intent_reason}<br /><strong>Learning diagnosis:</strong> {result.learning_diagnosis}<br /><strong>Clarification question:</strong> {result.clarification_question || "None"}</div>
      <div className="notice"><strong>Buying-signal reason:</strong> {result.buying_signal_reason || "None"}<br /><strong>Recommended action:</strong> {result.recommended_next_conversational_action || "None"}<br /><strong>Next best question:</strong> {result.next_best_question || "None"}<br /><strong>Context resolution:</strong> {result.contextual_resolution || "None"}</div>
      <div className="notice"><strong>V4 journey reasons:</strong> {result.buying_intent_reasons?.join(" ") || "None"}<br /><strong>Journey next question:</strong> {result.journey_next_best_question || "None"}<br /><strong>Repeated assistant wording:</strong> {result.repeated_assistant_wording ? result.repeated_assistant_phrase : "No"}</div>
      <div className="notice"><strong>V5 classification:</strong> {result.universal_message_reason || "None"}<br /><strong>Emotion:</strong> {result.customer_emotion_reason || "None"}<br /><strong>Objection:</strong> {result.objection_reason || "None"}<br /><strong>Low-confidence stop:</strong> {result.conversation_confidence_below_threshold ? "Yes — clarification used" : "No"}</div>
      <div className="notice"><strong>V6 priority path:</strong> {result.priority_path_taken?.join(" → ") || "None"}<br /><strong>Conversation paused:</strong> {result.conversation_paused ? "Yes" : "No"}<br /><strong>Conversation resumed:</strong> {result.conversation_resumed ? "Yes" : "No"}<br /><strong>Resume reason:</strong> {result.resume_reason || "None"}<br /><strong>Journey stage:</strong> {result.journey_stage_before_retrieval || "—"} → {result.journey_stage_after_retrieval || "—"}<br /><strong>Knowledge source IDs:</strong> {result.knowledge_source_ids?.join(", ") || "None"}</div>
      <div className="notice"><strong>Conversation polish:</strong> {result.polish_transition_type || "none"}<br /><strong>Transition applied:</strong> {result.polish_transition_applied ? "Yes" : "No"}<br /><strong>CTA timing reason:</strong> {result.cta_timing_reason || "None"}<br /><strong>Recently communicated facts:</strong> {result.recently_communicated_facts?.join(", ") || "None"}<br /><strong>Repeated facts:</strong> {result.repeated_fact_keys?.join(", ") || "None"}</div>
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
  const [review, setReview] = useState({ outcome: "pass", ...initialRatings, polish_ratings: initialPolishRatings, reviewer_notes: "" });
  const [reviewMessage, setReviewMessage] = useState("");
  const [scenarios, setScenarios] = useState([...REAL_CUSTOMER_SCENARIOS]);
  const [scenarioDraft, setScenarioDraft] = useState(() => JSON.stringify(REAL_CUSTOMER_SCENARIOS, null, 2));
  const [scenarioId, setScenarioId] = useState(REAL_CUSTOMER_SCENARIOS[0]?.id || "");
  const [category, setCategory] = useState("greetings");
  const [batch, setBatch] = useState({ running: false, completed: 0, total: 0, failures: [] });
  const activeRequest = useRef(null);
  const categories = useMemo(() => [...new Set(scenarios.map((item) => item.category))], [scenarios]);

  useEffect(() => {
    let active = true; const stored = getStoredMarketingAccessKey();
    if (!stored) { setAccessStatus("locked"); return () => { active = false; }; }
    validateMarketingAccessKey(stored).then(() => { if (active) setAccessStatus("unlocked"); }).catch((caught) => { clearMarketingAccessKey(); if (active) { setAccessStatus("locked"); setError(caught.message || "Saved access is not valid for this deployment."); } });
    return () => { active = false; };
  }, []);

  async function unlock(event) {
    event.preventDefault(); setError("");
    try { await validateMarketingAccessKey(accessKey.trim()); saveMarketingAccessKey(accessKey.trim()); setAccessStatus("unlocked"); setAccessKey(""); }
    catch (caught) { clearMarketingAccessKey(); setAccessStatus("locked"); setError(caught.message || "Access key not recognised."); }
  }

  function resetConversation(nextProduct = productContext) {
    activeRequest.current = null;
    setProductContext(nextProduct); setSessionId(newSessionId()); setMessages([]); setRememberedFacts({}); setJourneyState({}); setResult(null); setReviewMessage(""); setError("");
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
    <section className="panel"><div className="panel__header"><div><div className="eyebrow">AI Sales Assistant · Salesperson Polish</div><h2>Conversation & Application Experience Simulation</h2><p>The V5 Human Conversation & Recovery Simulation remains intact while reviewers assess natural transitions, concise grounded answers and well-timed application guidance. Use synthetic test wording only; do not enter real customer personal data.</p></div><button className="button button--ghost" type="button" disabled={busy || batch.running} onClick={() => resetConversation()}>Reset Conversation</button></div>
      <div className="competence-metrics"><Diagnostic label="Locked product" value={productContext} /><Diagnostic label="Session" value={sessionId} /><Diagnostic label="Messages" value={messages.length} /></div>
      <div className="competence-context"><button type="button" disabled={busy || batch.running} className={productContext === "finance" ? "is-selected" : ""} onClick={() => resetConversation("finance")}>Finance</button><button type="button" disabled={busy || batch.running} className={productContext === "rent2buy" ? "is-selected" : ""} onClick={() => resetConversation("rent2buy")}>Rent2Buy</button></div>
    </section>
    <section className="panel"><h3>Conversation transcript</h3><div className="competence-report-list">{messages.length ? messages.map((item, index) => <div key={`${index}-${item.role}`}><strong>{item.role === "user" ? "Customer" : "Assistant"}</strong><p>{item.content}</p></div>) : <p>No messages yet.</p>}</div>
      <form onSubmit={handleSend}><label className="field"><span className="field__label">Customer message</span><textarea className="field__input" rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type exactly as a real customer might..." /></label><button className="button button--primary" disabled={busy || batch.running}>{busy || batch.running ? "Testing..." : "Send Message"}</button></form>
      {error ? <div className="notice notice--error">{error}</div> : null}
    </section>
    <ResultDiagnostics result={result} />
    <section className="panel"><div className="panel__header"><div><div className="eyebrow">Manual review</div><h3>Score this behaviour</h3></div></div>
      <div className="competence-outcomes">{CONVERSATION_REVIEW_OUTCOMES.map((outcome) => <button type="button" className={review.outcome === outcome ? "is-selected" : ""} onClick={() => setReview({ ...review, outcome })} key={outcome}>{outcomeLabel(outcome)}</button>)}</div>
      <h4>Core behaviour</h4><div className="competence-ratings">{coreRatingFields.map((field) => <label key={field}><span>{labels[field]}</span><select value={review[field]} onChange={(event) => setReview({ ...review, [field]: Number(event.target.value) })}>{[1,2,3,4,5].map((value) => <option value={value} key={value}>{value}/5</option>)}</select></label>)}</div>
      <h4>Conversation polish</h4><div className="competence-ratings">{polishRatingFields.map((field) => <label key={field}><span>{labels[field]}</span><select value={field === "conversation_naturalness" ? review[field] : review.polish_ratings[field]} onChange={(event) => field === "conversation_naturalness" ? setReview({ ...review, [field]: Number(event.target.value) }) : setReview({ ...review, polish_ratings: { ...review.polish_ratings, [field]: Number(event.target.value) } })}>{[1,2,3,4,5].map((value) => <option value={value} key={value}>{value}/5</option>)}</select></label>)}</div>
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
