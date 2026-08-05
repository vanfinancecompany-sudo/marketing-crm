import { useEffect, useMemo, useState } from "react";
import { AI_ASSISTANT_TEST_LIBRARY, COMPETENCE_REVIEW_OUTCOMES } from "../lib/aiAssistantCompetence.js";
import { completeCompetenceRun, loadCompetenceReport, saveCompetenceReview, startCompetenceRun, testAssistantAnswer } from "../services/aiAssistantCompetence.js";
import { clearMarketingAccessKey, getStoredMarketingAccessKey, isMarketingAccessDenied, saveMarketingAccessKey, validateMarketingAccessKey } from "../services/marketingAccess.js";

const OUTCOME_LABELS = { pass: "Pass", needs_adjustment: "Needs Adjustment", incorrect: "Incorrect", unsafe: "Unsafe", too_long: "Too Long", too_vague: "Too Vague" };
const RATING_LABELS = { accuracy: "Accuracy", helpfulness: "Helpfulness", conversion: "Conversion", brevity: "Brevity" };
const initialReview = { outcome: "pass", accuracy: 5, helpfulness: 5, conversion: 5, brevity: 5, reviewer_notes: "" };

function Metric({ label, value, tone = "" }) { return <div className={`competence-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }

function SourceCard({ source }) {
  return <article className="competence-source">
    <div><span className="badge">{source.type?.startsWith("article") ? "Article" : "Business Brain"}</span><strong>{source.title}</strong><b>{source.score}</b></div>
    <h4>{source.heading}</h4>
    <p>{source.passage}</p>
    {source.public_url ? <a href={source.public_url} target="_blank" rel="noreferrer">Open public Wix article</a> : null}
  </article>;
}

function ResultPanel({ payload, review, setReview, onSaveReview, reviewBusy }) {
  if (!payload?.result) return <div className="competence-empty"><strong>No answer tested yet</strong><p>Enter a realistic customer question or choose one from the test library.</p></div>;
  const result = payload.result;
  return <div className="page-stack">
    <section className="panel competence-answer">
      <div className="eyebrow">Customer Answer</div>
      <blockquote>{result.answer}</blockquote>
      <small>{payload.word_count} words · This is exactly what the proposed website assistant would show.</small>
    </section>
    <section className="panel">
      <div className="panel__header"><div><div className="eyebrow">Diagnostics</div><h3>Evidence and performance</h3></div></div>
      <div className="competence-metrics">
        <Metric label="Response Time" value={`${result.response_time_ms} ms`} tone={result.response_time_ms < 5000 ? "is-good" : "is-warning"} />
        <Metric label="Retrieval Time" value={`${result.retrieval_time_ms} ms`} />
        <Metric label="Generation Time" value={`${result.generation_time_ms} ms`} />
        <Metric label="Confidence" value={`${result.confidence}%`} tone={result.confidence >= 80 ? "is-good" : "is-warning"} />
        <Metric label="Test Context" value={result.product_context} />
        <Metric label="Category Filter" value={result.category_filter} />
        <Metric label="Product" value={result.product_detected} />
        <Metric label="Knowledge Gap" value={result.knowledge_gap ? "Yes" : "No"} tone={result.knowledge_gap ? "is-danger" : "is-good"} />
        <Metric label="Conflict" value={result.conflict_detected ? "Detected" : "None"} tone={result.conflict_detected ? "is-danger" : "is-good"} />
      </div>
      <div className="notice"><strong>Confidence reason:</strong> {result.confidence_reason}</div>
      <h3>Sources used</h3>
      <div className="competence-sources">{result.sources_used?.length ? result.sources_used.map((source, index) => <SourceCard source={source} key={`${source.source_id}-${source.heading}-${index}`} />) : <p>No source was strong enough to support an answer.</p>}</div>
    </section>
    <section className="panel">
      <div className="panel__header"><div><div className="eyebrow">Manual Review</div><h3>Rate this answer</h3></div></div>
      <div className="competence-outcomes">{COMPETENCE_REVIEW_OUTCOMES.map((outcome) => <button type="button" className={review.outcome === outcome ? "is-selected" : ""} onClick={() => setReview((current) => ({ ...current, outcome }))} key={outcome}>{OUTCOME_LABELS[outcome]}</button>)}</div>
      <div className="competence-ratings">{Object.entries(RATING_LABELS).map(([field, label]) => <label key={field}><span>{label}</span><select value={review[field]} onChange={(event) => setReview((current) => ({ ...current, [field]: Number(event.target.value) }))}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}/5</option>)}</select></label>)}</div>
      <label className="field"><span className="field__label">Reviewer Notes</span><textarea className="field__input" rows={4} value={review.reviewer_notes} onChange={(event) => setReview((current) => ({ ...current, reviewer_notes: event.target.value }))} placeholder="What was right, missing, unclear or unsafe?" /></label>
      <button className="button button--primary" type="button" disabled={reviewBusy} onClick={() => onSaveReview(result.id)}>{reviewBusy ? "Saving..." : "Save Review"}</button>
    </section>
  </div>;
}

function ReportList({ title, rows, render }) { return <section className="panel"><h3>{title}</h3>{rows?.length ? <div className="competence-report-list">{rows.slice(0, 12).map((row, index) => <div key={row.id || `${row[0]}-${index}`}>{render(row)}</div>)}</div> : <p>No evidence recorded yet.</p>}</section>; }

export default function AIAssistantCompetencePage() {
  const [accessStatus, setAccessStatus] = useState(() => getStoredMarketingAccessKey() ? "checking" : "locked");
  const [accessKey, setAccessKey] = useState("");
  const [accessError, setAccessError] = useState("");
  const [mode, setMode] = useState("single");
  const [question, setQuestion] = useState("Can I get a van if I have poor credit?");
  const [productContext, setProductContext] = useState("finance");
  const [messages, setMessages] = useState([]);
  const [payload, setPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(initialReview);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("all");
  const [batch, setBatch] = useState({ running: false, completed: 0, total: AI_ASSISTANT_TEST_LIBRARY.length, results: [] });
  const [report, setReport] = useState(null);
  const categories = useMemo(() => ["all", ...new Set(AI_ASSISTANT_TEST_LIBRARY.map((item) => item.category))], []);
  const questions = libraryFilter === "all" ? AI_ASSISTANT_TEST_LIBRARY : AI_ASSISTANT_TEST_LIBRARY.filter((item) => item.category === libraryFilter);

  useEffect(() => {
    let active = true;
    const stored = getStoredMarketingAccessKey();
    if (!stored) { setAccessStatus("locked"); return () => { active = false; }; }
    validateMarketingAccessKey(stored).then(() => {
      if (active) setAccessStatus("unlocked");
    }).catch((caught) => {
      clearMarketingAccessKey();
      if (active) { setAccessStatus("locked"); setAccessError(isMarketingAccessDenied(caught) ? "Your saved access has expired or is not valid for this Preview deployment." : caught.message || "Could not validate saved Marketing CRM access."); }
    });
    return () => { active = false; };
  }, []);

  async function unlock(event) {
    event.preventDefault();
    const key = accessKey.trim();
    if (!key) { setAccessError("Enter the Marketing CRM access key."); return; }
    setAccessStatus("checking"); setAccessError("");
    try {
      await validateMarketingAccessKey(key);
      if (!saveMarketingAccessKey(key)) throw new Error("The access key could not be saved in this browser.");
      setAccessKey(""); setAccessStatus("unlocked");
    } catch (caught) {
      clearMarketingAccessKey();
      setAccessStatus("locked");
      setAccessError(isMarketingAccessDenied(caught) ? "Access key not recognised." : caught.message || "Could not validate Marketing CRM access.");
    }
  }

  async function runQuestion(item = null, runId = null, runMode = mode) {
    const submitted = item?.question || question;
    const submittedContext = item ? (/rent\s*2\s*buy/i.test(item.question) || item.category === "rent2buy" ? "rent2buy" : "finance") : productContext;
    if (!submitted.trim()) return;
    setBusy(true); setError(""); setReviewMessage("");
    try {
      const result = await testAssistantAnswer({ question: submitted, product_context: submittedContext, messages: runMode === "conversation" ? messages : [], mode: runMode, run_id: runId, test_question_id: item?.id || null });
      setPayload(result); setReview(initialReview);
      if (runMode === "conversation") setMessages((current) => [...current, { role: "user", content: submitted }, { role: "assistant", content: result.result.answer }]);
      return result;
    } catch (caught) { setError(caught.message); throw caught; }
    finally { setBusy(false); }
  }

  async function runEntireSet() {
    setMode("library"); setError(""); setBatch({ running: true, completed: 0, total: AI_ASSISTANT_TEST_LIBRARY.length, results: [] });
    try {
      const { run } = await startCompetenceRun("test_set", AI_ASSISTANT_TEST_LIBRARY.length);
      const results = [];
      for (const item of AI_ASSISTANT_TEST_LIBRARY) {
        const result = await runQuestion(item, run.id, "test_set");
        results.push(result.result);
        setBatch({ running: true, completed: results.length, total: AI_ASSISTANT_TEST_LIBRARY.length, results: [...results] });
      }
      await completeCompetenceRun(run.id);
      setBatch({ running: false, completed: results.length, total: AI_ASSISTANT_TEST_LIBRARY.length, results });
    } catch (caught) { setBatch((current) => ({ ...current, running: false })); setError(caught.message); }
  }

  async function saveReview(resultId) {
    setReviewBusy(true); setReviewMessage("");
    try { await saveCompetenceReview({ result_id: resultId, ...review }); setReviewMessage("Review saved."); }
    catch (caught) { setError(caught.message); }
    finally { setReviewBusy(false); }
  }

  async function openReport() {
    setMode("report"); setBusy(true); setError("");
    try { setReport(await loadCompetenceReport()); } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }

  function chooseQuestion(item) { setQuestion(item.question); setProductContext(/rent\s*2\s*buy/i.test(item.question) || item.category === "rent2buy" ? "rent2buy" : "finance"); setMode("single"); setPayload(null); window.scrollTo({ top: 0, behavior: "smooth" }); }

  if (accessStatus !== "unlocked") return <div className="page-stack competence-page"><section className="operations-summary competence-hero"><div><div className="eyebrow">Protected internal tool</div><h2>AI Assistant Competence Test</h2><p>Unlock this page with the same Marketing CRM access key used by the Knowledge Hub, Content Factory and Customer Database.</p></div></section><section className="panel"><div className="panel__header"><div><h3>{accessStatus === "checking" ? "Checking saved access..." : "Unlock AI Assistant Test"}</h3><p>The key is validated by the established Marketing CRM access endpoint and saved in this browser only.</p></div></div>{accessStatus === "checking" ? <div className="notice">Validating protected access…</div> : <form className="field-grid" onSubmit={unlock}><label className="field"><span className="field__label">Marketing CRM access key</span><input className="field__input" type="password" autoComplete="off" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} /></label><div className="card-actions" style={{ alignSelf: "end" }}><button className="button button--primary" type="submit">Unlock</button></div>{accessError ? <div className="notice notice--error" style={{ gridColumn: "1 / -1" }}>{accessError}</div> : null}</form>}</section></div>;

  return <div className="page-stack competence-page">
    <section className="operations-summary competence-hero"><div><div className="eyebrow">Internal evidence tool</div><h2>AI Assistant Competence Test</h2><p>This does not test how clever the model is. It proves or disproves whether the existing Business Brain, approved FAQs and Knowledge Hub contain enough reliable information for a future customer-facing assistant.</p></div><div className="competence-target"><strong>90%+</strong><span>correct-answer target</span></div></section>
    <div className="competence-tabs">
      <button className={mode === "single" ? "is-active" : ""} onClick={() => setMode("single")}>Single Question</button>
      <button className={mode === "conversation" ? "is-active" : ""} onClick={() => setMode("conversation")}>Conversation</button>
      <button className={mode === "library" ? "is-active" : ""} onClick={() => setMode("library")}>Test Library</button>
      <button className={mode === "report" ? "is-active" : ""} onClick={openReport}>Knowledge Gap Report</button>
    </div>
    {error ? <div className="notice notice--error">{error}</div> : null}{reviewMessage ? <div className="notice notice--success">{reviewMessage}</div> : null}
    {mode === "single" || mode === "conversation" ? <>
      {mode === "conversation" && messages.length ? <section className="panel competence-conversation">{messages.map((message, index) => <div className={`is-${message.role}`} key={index}><strong>{message.role === "user" ? "Customer" : "Assistant"}</strong><p>{message.content}</p></div>)}</section> : null}
      <section className="panel"><div className="field-grid"><label className="field"><span className="field__label">Product Context</span><select className="field__input" value={productContext} onChange={(event) => { setProductContext(event.target.value); setPayload(null); }} required><option value="finance">Finance</option><option value="rent2buy">Rent2Buy</option></select></label><label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Customer Question</span><textarea className="field__input competence-question" rows={5} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Can I get a van if I have poor credit?" /></label></div><div className="card-actions"><button className="button button--primary" type="button" disabled={busy || !question.trim()} onClick={() => runQuestion()}>{busy ? "Testing..." : "Test Answer"}</button>{mode === "conversation" && messages.length ? <button className="button button--ghost" type="button" onClick={() => { setMessages([]); setPayload(null); }}>New Conversation</button> : null}</div></section>
      <ResultPanel payload={payload} review={review} setReview={setReview} onSaveReview={saveReview} reviewBusy={reviewBusy} />
    </> : null}
    {mode === "library" ? <section className="panel"><div className="panel__header"><div><div className="eyebrow">50 built-in checks</div><h3>Customer question library</h3><p>Run questions individually or execute the complete evidence set.</p></div><button className="button button--primary" type="button" disabled={batch.running} onClick={runEntireSet}>{batch.running ? `Running ${batch.completed}/${batch.total}` : "Run Entire Test Set"}</button></div>{batch.running || batch.completed ? <div className="competence-progress"><i style={{ width: `${Math.round(batch.completed / batch.total * 100)}%` }} /><span>{batch.completed} of {batch.total} complete</span></div> : null}<div className="competence-filters">{categories.map((category) => <button className={libraryFilter === category ? "is-selected" : ""} onClick={() => setLibraryFilter(category)} key={category}>{category.replaceAll("_", " ")}</button>)}</div><div className="competence-library">{questions.map((item) => <article key={item.id}><span>{item.id} · {item.category.replaceAll("_", " ")}</span><p>{item.question}</p><button type="button" onClick={() => chooseQuestion(item)}>Run individually</button></article>)}</div></section> : null}
    {mode === "report" ? <>{busy && !report ? <div className="competence-empty">Loading report...</div> : null}{report ? <>
      <section className="panel"><div className="panel__header"><div><div className="eyebrow">Success criteria</div><h3>Readiness scorecard</h3></div></div><div className="competence-metrics"><Metric label="Pass Rate" value={`${report.report.success.pass_rate}%`} tone={report.report.success.pass_rate >= 90 ? "is-good" : "is-warning"} /><Metric label="Avg Accuracy" value={`${report.report.success.average_accuracy}/5`} tone={report.report.success.average_accuracy >= 4.5 ? "is-good" : "is-warning"} /><Metric label="Avg Response" value={`${report.report.success.average_response_ms} ms`} tone={report.report.success.average_response_ms > 0 && report.report.success.average_response_ms < 5000 ? "is-good" : "is-warning"} /><Metric label="Unsafe" value={report.report.success.unsafe_answers} tone={report.report.success.unsafe_answers ? "is-danger" : "is-good"} /><Metric label="Incorrect" value={report.report.success.incorrect_answers} tone={report.report.success.incorrect_answers ? "is-danger" : "is-good"} /><Metric label="Knowledge Gaps" value={report.report.unanswered.length} tone={report.report.unanswered.length ? "is-warning" : "is-good"} /><Metric label="Conflicts" value={report.report.conflicts.length} tone={report.report.conflicts.length ? "is-danger" : "is-good"} /></div>{report.report.success.reviewed_answers ? null : <div className="notice">Run questions and add manual reviews before treating these readiness scores as evidence.</div>}</section>
      <div className="knowledge-two-column"><ReportList title="Most common missing information" rows={report.report.common_gaps} render={(row) => <><strong>{row[0]}</strong><span>{row[1]}</span></>} /><ReportList title="Most used Business Brain sections" rows={report.report.business_sections} render={(row) => <><strong>{row[0]}</strong><span>{row[1]}</span></>} /><ReportList title="Most used articles" rows={report.report.articles} render={(row) => <><strong>{row[0]}</strong><span>{row[1]}</span></>} /><ReportList title="Questions AI could not answer" rows={report.report.unanswered} render={(row) => <><strong>{row.question}</strong><span>{row.confidence}%</span></>} /><ReportList title="Questions with conflicting information" rows={report.report.conflicts} render={(row) => <><strong>{row.question}</strong><span>{row.confidence_reason}</span></>} /><ReportList title="Lowest rated answers" rows={report.report.lowest_rated} render={(row) => <><strong>{row.question}</strong><span>{row.review?.accuracy || 0}/5 accuracy</span></>} /></div>
    </> : null}</> : null}
  </div>;
}
