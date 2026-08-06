import { useEffect, useMemo, useState } from "react";
import { OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABELS } from "../lib/knowledgeLearningEngine.js";
import { isDefaultActiveKnowledgeOpportunity, KNOWLEDGE_WORKFLOW_LABELS, KNOWLEDGE_WORKFLOW_LIGHTS, recommendedKnowledgeWorkflowAction } from "../lib/knowledgeOpportunityWorkflow.js";
import { analyseExistingCompetenceResults, bulkUpdateKnowledgeOpportunities, createOpportunityArticleDraft, createOpportunityFaqDraft, linkOpportunityArticle, loadKnowledgeOpportunities, updateKnowledgeOpportunity } from "../services/aiKnowledgeOpportunities.js";
import { clearMarketingAccessKey, getStoredMarketingAccessKey, isMarketingAccessDenied, saveMarketingAccessKey, validateMarketingAccessKey } from "../services/marketingAccess.js";

const SUMMARY_LABELS = {
  new: "New opportunities", high_priority: "High priority", rent2buy: "Rent2Buy", finance: "Finance",
  unanswered: "Unanswered clusters", weak: "Weak-answer clusters", conflicts: "Conflict clusters",
  articles_suggested: "Articles suggested", drafts_created: "Drafts created", completed: "Completed",
};
const WORKFLOW_SUMMARY_LABELS = {
  create_article: "Create Article", review_later: "Review Later", no_action_required: "No Action Required",
  draft_created: "Draft Created", resolved: "Resolved", reopened: "Reopened",
};
const REOPENABLE_STATUSES = new Set(["no_action_required", "draft_created", "resolved", "closed", "dismissed", "completed"]);
const fmt = (value) => value ? new Date(value).toLocaleString("en-GB") : "—";
const average = (value, suffix = "") => value == null ? "Not reviewed" : `${value}${suffix}`;

function Metric({ label, value }) { return <div className="competence-metric"><span>{label}</span><strong>{value}</strong></div>; }

function OpportunityCard({ item, selected, checked, busy, onSelect, onChecked, onAction, onCreateDraft }) {
  const action = item.recommended_workflow_action || recommendedKnowledgeWorkflowAction(item);
  const canReopen = REOPENABLE_STATUSES.has(item.status);
  return <article className={`panel competence-library-card${selected ? " is-selected" : ""}`} style={{ textAlign: "left", width: "100%" }}>
    <div className="panel__header"><div style={{ flex: 1 }}><div className="card-actions" style={{ justifyContent: "space-between" }}><label className="toggle-row"><input type="checkbox" checked={checked} onChange={(event) => onChecked(event.target.checked)} />Select</label><span className="badge">{KNOWLEDGE_WORKFLOW_LIGHTS[action]} {KNOWLEDGE_WORKFLOW_LABELS[action]}</span></div><span className="badge">{item.product}</span><button type="button" onClick={onSelect} style={{ display: "block", width: "100%", border: 0, padding: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}><h3>{item.title}</h3><p>{item.diagnosis}</p></button></div><strong>{item.priority_score} · {item.priority_level}</strong></div>
    <div className="competence-metrics"><Metric label="Questions" value={item.question_count} /><Metric label="Results" value={item.unique_result_count} /><Metric label="Unanswered" value={item.unanswered_count} /><Metric label="Weak" value={item.weak_answer_count} /><Metric label="Conflicts" value={item.conflict_count} /></div>
    <small>{OPPORTUNITY_STATUS_LABELS[item.status]} · Last seen {fmt(item.last_seen_at)}{item.reopen_reason ? ` · ${item.reopen_reason}` : ""}</small>
    <div className="card-actions" style={{ marginTop: 12 }}>
      {!canReopen ? <><button className="button button--primary" disabled={busy || Boolean(item.linked_article_id)} onClick={onCreateDraft}>{item.linked_article_id ? "Draft Created" : "Create Knowledge Hub Draft"}</button><button className="button button--ghost" disabled={busy} onClick={() => onAction("review_later")}>Review Later</button><button className="button button--ghost" disabled={busy} onClick={() => onAction("no_action_required")}>No Action Required</button><button className="button button--danger" disabled={busy} onClick={() => onAction("closed")}>Mark Resolved / Close</button></> : <button className="button button--primary" disabled={busy} onClick={() => onAction("reopened")}>Reopen</button>}
      <button className="button button--ghost" disabled={busy} onClick={onSelect}>View details</button>
    </div>
  </article>;
}

function Improvement({ item }) {
  const before = item.improvement_metrics?.before || {};
  const after = item.improvement_metrics?.after || {};
  return <section className="panel panel--nested"><h3>Improvement tracking</h3><p>Comparison is evidence only; it does not claim the linked article caused a change.</p><div className="knowledge-two-column"><div><strong>Before improvement</strong><p>{before.result_count || 0} results · {before.unanswered_count || 0} unanswered<br />Confidence {average(before.average_confidence, "%")} · Accuracy {average(before.average_accuracy, "/5")} · Usefulness {average(before.average_usefulness, "/5")}</p></div><div><strong>After improvement</strong><p>{after.result_count || 0} results · {after.unanswered_count || 0} unanswered<br />Confidence {average(after.average_confidence, "%")} · Accuracy {average(after.average_accuracy, "/5")} · Usefulness {average(after.average_usefulness, "/5")}</p></div></div></section>;
}

function OpportunityDetail({ item, busy, onRefresh, setMessage, setError }) {
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.internal_notes || "");
  const [eventNotes, setEventNotes] = useState("");
  const [faq, setFaq] = useState({ question: item.suggested_faq?.question || item.questions?.[0]?.original_question || item.title, answer: item.suggested_faq?.answer || "", destination: item.faq_destination || "business_knowledge", destination_article_id: "" });
  useEffect(() => { setStatus(item.status); setNotes(item.internal_notes || ""); setFaq({ question: item.suggested_faq?.question || item.questions?.[0]?.original_question || item.title, answer: item.suggested_faq?.answer || "", destination: item.faq_destination || "business_knowledge", destination_article_id: "" }); }, [item.id]);

  async function act(operation, success) {
    try { await operation(); setMessage(success); setError(""); await onRefresh(); } catch (error) { setError(error.message); }
  }

  return <div className="page-stack">
    <section className="panel"><div className="panel__header"><div><div className="eyebrow">Opportunity detail</div><h2>{item.title}</h2><p>{item.summary}</p></div><span className="badge">{item.product} · {item.priority_level}</span></div>
      <div className="competence-metrics"><Metric label="Priority" value={item.priority_score} /><Metric label="Questions" value={item.question_count} /><Metric label="Results" value={item.unique_result_count} /><Metric label="Avg confidence" value={`${item.average_confidence}%`} /><Metric label="Avg accuracy" value={average(item.average_accuracy, "/5")} /><Metric label="Avg usefulness" value={average(item.average_usefulness, "/5")} /></div>
      <div className="notice"><strong>Priority components:</strong> {Object.entries(item.priority_components || {}).map(([key, value]) => `${key.replaceAll("_", " ")} ${value >= 0 ? "+" : ""}${value}`).join(" · ")}</div>
      <p><strong>Recommended action:</strong> {KNOWLEDGE_WORKFLOW_LIGHTS[item.recommended_workflow_action || recommendedKnowledgeWorkflowAction(item)]} {KNOWLEDGE_WORKFLOW_LABELS[item.recommended_workflow_action || recommendedKnowledgeWorkflowAction(item)]}<br /><strong>Diagnosis:</strong> {item.diagnosis}<br /><strong>Technical suggestion:</strong> {String(item.recommended_action || "").replaceAll("_", " ")}<br /><strong>Intent/category:</strong> {item.normalised_intent} / {item.category}<br /><strong>First/last seen:</strong> {fmt(item.first_seen_at)} / {fmt(item.last_seen_at)}</p>
      {item.linked_topic_id || item.linked_article_id ? <p><strong>Linked Topic Planner record:</strong> {item.linked_topic?.title || item.linked_topic_id || "—"}<br /><strong>Linked Knowledge Hub article:</strong> {item.linked_article?.title || item.linked_article_id || "—"}</p> : null}
      {item.closure_reason ? <div className="notice"><strong>Closure reason:</strong> {item.closure_reason}<br /><strong>Closed/resolved:</strong> {fmt(item.closed_at || item.resolved_at)}</div> : null}
      {item.reopen_reason ? <div className="notice"><strong>Reopened:</strong> {item.reopen_reason}<br />{fmt(item.reopened_at)}</div> : null}
      {item.observed_locations?.length ? <p><strong>Observed locations:</strong> {item.observed_locations.join(", ")}</p> : null}
    </section>

    <section className="panel"><h3>Manual status and audit note</h3><div className="field-grid"><label className="field"><span className="field__label">Status</span><select className="field__input" value={status} onChange={(event) => setStatus(event.target.value)}>{OPPORTUNITY_STATUSES.map((value) => <option value={value} key={value}>{OPPORTUNITY_STATUS_LABELS[value]}</option>)}</select></label><label className="field"><span className="field__label">Action reason</span><input className="field__input" value={eventNotes} onChange={(event) => setEventNotes(event.target.value)} placeholder="Why is this status changing?" /></label><label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Internal notes</span><textarea className="field__input" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div><button className="button button--primary" disabled={busy} onClick={() => act(() => updateKnowledgeOpportunity({ opportunity_id: item.id, status, internal_notes: notes, notes: eventNotes, user_action: "Marketing CRM administrator" }), "Opportunity update saved and audited.")}>Save manual decision</button></section>

    <section className="panel"><h3>Customer-question variations</h3>{item.questions?.map((question) => <div className="notice" key={question.id}><strong>{question.original_question}</strong>{question.location_reference ? <><br />Location example: {question.location_reference}</> : null}</div>)}</section>

    <section className="panel"><h3>Original competence results</h3>{item.results?.map((result) => <article className="panel panel--nested" key={result.id}><strong>{result.question}</strong><p>{result.answer}</p><small>{result.confidence}% confidence · Gap {result.knowledge_gap ? "yes" : "no"} · Conflict {result.conflict_detected ? "yes" : "no"}</small>{result.review ? <p>Review: {result.review.outcome} · Accuracy {result.review.accuracy || "—"}/5 · Usefulness {result.review.helpfulness || "—"}/5<br />{result.review.reviewer_notes}</p> : <p>No human review.</p>}<details><summary>Sources retrieved</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result.sources_used || [], null, 2)}</pre></details></article>)}</section>

    <section className="panel"><h3>Existing knowledge comparison</h3><div className="knowledge-two-column"><div><h4>Related approved articles</h4>{item.related_articles?.length ? item.related_articles.map((article) => <div className="notice" key={article.id}><strong>{article.title}</strong><br />{article.category}</div>) : <p>No related approved article identified.</p>}</div><div><h4>Relevant Business Brain guidance</h4>{item.related_business_sections?.length ? item.related_business_sections.map((section) => <div className="notice" key={section.id}><strong>{section.title}</strong><br />{String(section.content || "").slice(0, 500)}</div>) : <p>No strong Business Brain match identified.</p>}</div></div></section>

    <section className="panel"><h3>Suggested content response</h3><p><strong>Working title:</strong> {item.suggested_article_title}<br /><strong>Brief:</strong> {item.suggested_article_brief}</p><p><strong>Recommended headings:</strong> {(item.suggested_headings || []).join(" · ")}</p><div className="card-actions"><button className="button button--primary" disabled={busy || item.linked_article_id} onClick={() => { if (window.confirm("Create a Knowledge Hub draft only? It will not be approved or published.")) act(() => createOpportunityArticleDraft({ opportunity_id: item.id, title: item.suggested_article_title }), "Knowledge Hub draft created and linked. It remains unapproved and unpublished."); }}>{item.linked_article_id ? "Draft already linked" : "Create Knowledge Hub Draft"}</button>{item.related_articles?.map((article) => <button className="button button--ghost" disabled={busy} key={article.id} onClick={() => act(() => linkOpportunityArticle({ opportunity_id: item.id, article_id: article.id }), `Linked to ${article.title}.`)}>Link: {article.title}</button>)}</div></section>

    <section className="panel"><h3>Create FAQ Draft</h3><p>This creates a review record only. It does not alter active Business Knowledge or an article.</p><div className="field-grid"><label className="field"><span className="field__label">FAQ question</span><input className="field__input" value={faq.question} onChange={(event) => setFaq((current) => ({ ...current, question: event.target.value }))} /></label><label className="field"><span className="field__label">Destination</span><select className="field__input" value={faq.destination} onChange={(event) => setFaq((current) => ({ ...current, destination: event.target.value }))}><option value="business_knowledge">Business Knowledge Centre FAQ</option><option value="existing_article">Existing Knowledge Hub article</option><option value="new_article">New Knowledge Hub article</option></select></label><label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Draft answer</span><textarea className="field__input" rows={5} value={faq.answer} onChange={(event) => setFaq((current) => ({ ...current, answer: event.target.value }))} /></label></div><button className="button button--primary" disabled={busy || !faq.question.trim() || !faq.answer.trim()} onClick={() => act(() => createOpportunityFaqDraft({ opportunity_id: item.id, ...faq }), "FAQ draft created for manual review.")}>Create FAQ Draft</button></section>

    <Improvement item={item} />
    <section className="panel"><h3>Audit history</h3>{item.events?.length ? item.events.map((event) => <div className="notice" key={event.id}><strong>{event.event_type.replaceAll("_", " ")}</strong> · {fmt(event.created_at)}<br />{event.from_status || "—"} → {event.to_status || "—"}<br />{event.notes}</div>) : <p>No manual events yet.</p>}</section>
  </div>;
}

export default function AIKnowledgeOpportunitiesPage() {
  const [accessStatus, setAccessStatus] = useState(() => getStoredMarketingAccessKey() ? "checking" : "locked");
  const [accessKey, setAccessKey] = useState("");
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [product, setProduct] = useState("all");
  const [status, setStatus] = useState("active");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selected = data?.opportunities?.find((item) => item.id === selectedId) || null;
  const filtered = useMemo(() => (data?.opportunities || []).filter((item) => product === "all" || item.product === product).filter((item) => status === "all" || (status === "active" ? isDefaultActiveKnowledgeOpportunity(item) : item.status === status)), [data, product, status]);

  async function refresh() { setBusy(true); try { const loaded = await loadKnowledgeOpportunities(); setData(loaded); if (selectedId && !loaded.opportunities.some((item) => item.id === selectedId)) setSelectedId(null); } catch (caught) { setError(caught.message); } finally { setBusy(false); } }
  useEffect(() => { const key = getStoredMarketingAccessKey(); if (!key) { setAccessStatus("locked"); return; } validateMarketingAccessKey(key).then(() => { setAccessStatus("unlocked"); refresh(); }).catch(() => { clearMarketingAccessKey(); setAccessStatus("locked"); }); }, []);
  async function unlock(event) { event.preventDefault(); try { await validateMarketingAccessKey(accessKey.trim()); saveMarketingAccessKey(accessKey.trim()); setAccessStatus("unlocked"); await refresh(); } catch (caught) { setError(isMarketingAccessDenied(caught) ? "Access key not recognised." : caught.message); setAccessStatus("locked"); } }
  async function analyse() { if (!window.confirm("Analyse existing competence results now? This is idempotent and will not create or publish articles.")) return; setBusy(true); try { const result = await analyseExistingCompetenceResults(); setMessage(`${result.analysis.analysed_results} results analysed; ${result.analysis.opportunities_upserted} grouped opportunities updated.`); await refresh(); } catch (caught) { setError(caught.message); } finally { setBusy(false); } }
  async function workflowAction(item, nextStatus) {
    const reason = ["closed", "no_action_required"].includes(nextStatus) ? window.prompt(nextStatus === "closed" ? "Why is this opportunity being closed?" : "Why is no action required?", nextStatus === "closed" ? "Reviewed and closed." : "Existing knowledge is sufficient; no action required.") : "";
    if (["closed", "no_action_required"].includes(nextStatus) && reason === null) return;
    setBusy(true); setError("");
    try { await updateKnowledgeOpportunity({ opportunity_id: item.id, status: nextStatus, closure_reason: reason || "", notes: reason || "", user_action: "Marketing CRM administrator" }); setMessage(`${item.title}: ${OPPORTUNITY_STATUS_LABELS[nextStatus]}.`); setSelectedIds((current) => { const next = new Set(current); next.delete(item.id); return next; }); await refresh(); } catch (caught) { setError(caught.message); } finally { setBusy(false); }
  }
  async function createDraft(item) {
    if (!window.confirm("Create a Knowledge Hub draft only? It will not be approved, published or sent to Wix.")) return;
    setBusy(true); setError("");
    try { await createOpportunityArticleDraft({ opportunity_id: item.id, title: item.suggested_article_title }); setMessage(`${item.title}: Topic Planner record and Knowledge Hub draft created.`); setSelectedIds((current) => { const next = new Set(current); next.delete(item.id); return next; }); await refresh(); } catch (caught) { setError(caught.message); } finally { setBusy(false); }
  }
  function toggleSelected(id, checked) { setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; }); }
  async function bulkAction(workflowActionName) {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const reason = ["close", "no_action_required"].includes(workflowActionName) ? window.prompt(workflowActionName === "close" ? "Closure reason for the selected opportunities" : "Why is no action required?", workflowActionName === "close" ? "Reviewed and closed in bulk." : "No action required after review.") : "";
    if (["close", "no_action_required"].includes(workflowActionName) && reason === null) return;
    setBusy(true); setError("");
    try { const response = await bulkUpdateKnowledgeOpportunities({ opportunity_ids: ids, workflow_action: workflowActionName, closure_reason: reason || "", notes: reason || "" }); setMessage(`${response.bulk.updated_count} opportunities updated to ${OPPORTUNITY_STATUS_LABELS[response.bulk.status]}.`); setSelectedIds(new Set()); await refresh(); } catch (caught) { setError(caught.message); } finally { setBusy(false); }
  }

  if (accessStatus !== "unlocked") return <div className="page-stack"><section className="operations-summary competence-hero"><div><div className="eyebrow">Protected internal tool</div><h2>AI Knowledge Opportunities</h2><p>Use the established Marketing CRM access key.</p></div></section><form className="panel" onSubmit={unlock}><label className="field"><span className="field__label">Marketing CRM access key</span><input className="field__input" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} /></label><button className="button button--primary">Unlock</button>{error ? <div className="notice notice--error">{error}</div> : null}</form></div>;
  return <div className="page-stack"><section className="operations-summary competence-hero"><div><div className="eyebrow">Knowledge Learning Engine V2</div><h2>AI Knowledge Opportunities</h2><p>Turn weak, unanswered and repeated customer questions into grouped, prioritised improvements. Nothing is approved or published automatically.</p></div><button className="button button--primary" disabled={busy} onClick={analyse}>{busy ? "Working…" : "Analyse Existing Competence Results"}</button></section>
    <section className="panel"><div className="panel__header"><div><h3>Recommended-action traffic lights</h3><p>Each opportunity has one explicit next action. Priority scores remain available as supporting evidence.</p></div></div><div className="card-actions" style={{ gap: 18 }}>{Object.keys(KNOWLEDGE_WORKFLOW_LABELS).map((action) => <strong key={action}>{KNOWLEDGE_WORKFLOW_LIGHTS[action]} {KNOWLEDGE_WORKFLOW_LABELS[action]}</strong>)}</div></section>
    {message ? <div className="notice notice--success">{message}</div> : null}{error ? <div className="notice notice--error">{error}</div> : null}
    {data ? <><section className="panel"><h3>Workflow status</h3><div className="competence-metrics">{Object.entries(WORKFLOW_SUMMARY_LABELS).map(([key, label]) => <Metric label={label} value={data.summary[key] || 0} key={key} />)}</div></section><section className="panel"><details><summary>Evidence and legacy priority summary</summary><div className="competence-metrics" style={{ marginTop: 12 }}>{Object.entries(SUMMARY_LABELS).map(([key, label]) => <Metric label={label} value={data.summary[key] || 0} key={key} />)}</div></details></section>
      <div className="competence-filters"><button className={product === "all" ? "is-selected" : ""} onClick={() => setProduct("all")}>All products</button><button className={product === "finance" ? "is-selected" : ""} onClick={() => setProduct("finance")}>Finance</button><button className={product === "rent2buy" ? "is-selected" : ""} onClick={() => setProduct("rent2buy")}>Rent2Buy</button><select className="field__input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active statuses</option><option value="all">All statuses</option>{OPPORTUNITY_STATUSES.map((value) => <option value={value} key={value}>{OPPORTUNITY_STATUS_LABELS[value]}</option>)}</select></div>
      {selected ? <><button className="button button--ghost" onClick={() => setSelectedId(null)}>← Back to grouped opportunities</button><OpportunityDetail item={selected} busy={busy} onRefresh={refresh} setMessage={setMessage} setError={setError} /></> : <div className="page-stack">{filtered.length ? <><section className="panel"><div className="panel__header"><div><h3>Bulk workflow actions</h3><p>{selectedIds.size} selected</p></div><label className="toggle-row"><input type="checkbox" checked={filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id))} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); filtered.forEach((item) => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })} />Select visible</label></div><div className="card-actions"><button className="button button--ghost" disabled={busy || !selectedIds.size} onClick={() => bulkAction("review_later")}>Review Later</button><button className="button button--ghost" disabled={busy || !selectedIds.size} onClick={() => bulkAction("no_action_required")}>No Action Required</button><button className="button button--danger" disabled={busy || !selectedIds.size} onClick={() => bulkAction("close")}>Close</button><button className="button button--primary" disabled={busy || !selectedIds.size} onClick={() => bulkAction("reopen")}>Reopen</button></div></section>{filtered.map((item) => <OpportunityCard item={item} selected={false} checked={selectedIds.has(item.id)} busy={busy} onChecked={(checked) => toggleSelected(item.id, checked)} onSelect={() => setSelectedId(item.id)} onAction={(nextStatus) => workflowAction(item, nextStatus)} onCreateDraft={() => createDraft(item)} key={item.id} />)}</> : <div className="competence-empty">No opportunities match these filters. Run the controlled backfill when ready.</div>}</div>}
    </> : <div className="competence-empty">Loading opportunities…</div>}
  </div>;
}
