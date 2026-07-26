import {
  CUSTOMER_JOURNEYS,
  EDITORIAL_CATEGORY_LABELS,
  PRIMARY_PRODUCTS,
  SEARCH_INTENTS,
  buildArticleHealth,
  buildArticleReviewSummary,
} from "../lib/editorialIntelligence.js";
import { InternalLinkReviewPanel } from "./KnowledgeHubInternalLinking.jsx";

const titleCase = (value) =>
  String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const stars = (grade = 0) => `${"★".repeat(Number(grade) || 0)}${"☆".repeat(5 - (Number(grade) || 0))}`;

function ScoreMeter({ label, score = 0 }) {
  return (
    <div>
      <span><strong>{label}</strong><b>{score}/100</b></span>
      <div className="knowledge-review-meter"><i style={{ width: `${score}%` }} /></div>
    </div>
  );
}

export function EditorialApprovalQueue({
  queue,
  selectedIds,
  setSelectedIds,
  onOpen,
  onAnalyseMissing,
  busy,
}) {
  const labels = {
    ready: "★★★★★ Ready",
    review: "★★★★ Review",
    ai_improving: "★★★ AI Improving",
    rewrite: "★★ Rewrite",
    reject: "★ Reject",
  };
  return (
    <div className="knowledge-table-wrap">
      <div className="card-actions" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy || !queue.some((item) => !item.assessment)}
          onClick={onAnalyseMissing}
        >
          Analyse Unscored Articles
        </button>
      </div>
      <table className="knowledge-table">
        <thead>
          <tr>
            <th>Select</th><th>Editorial priority</th><th>Article</th><th>Score</th><th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((item) => (
            <tr key={item.article.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.article.id)}
                  onChange={(event) =>
                    setSelectedIds((current) =>
                      event.target.checked
                        ? [...current, item.article.id]
                        : current.filter((id) => id !== item.article.id)
                    )
                  }
                />
              </td>
              <td><strong>{labels[item.queue_state]}</strong><small>Priority {item.priority_score}</small></td>
              <td>
                <button className="knowledge-title-button" onClick={() => onOpen(item.article)}>
                  {item.article.title}
                </button>
                <small>{item.article.category} · {item.article.article_type}</small>
              </td>
              <td>
                {item.assessment
                  ? <><strong>{item.assessment.overall_score}/100</strong><small>{stars(item.assessment.grade)}</small></>
                  : "Not analysed"}
              </td>
              <td>
                {item.assessment
                  ? titleCase(item.assessment.publication_status)
                  : "Editorial analysis required"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KnowledgeCoverageMap({ coverage }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Business Coverage</div>
          <h3>Knowledge Coverage Map</h3>
          <p>Measures approved coverage and recommends a topic only when the same intent is not already present.</p>
        </div>
      </div>
      <div className="knowledge-review-categories knowledge-v5-coverage">
        {coverage.map((item) => (
          <div key={item.id || item.concept_key}>
            <span><strong>{item.label}</strong><b>{item.coverage_score}%</b></span>
            <div className="knowledge-review-meter"><i style={{ width: `${item.coverage_score}%` }} /></div>
            <p>{item.article_count} approved article{item.article_count === 1 ? "" : "s"}</p>
            {item.recommended_topic ? <small>Opportunity: {item.recommended_topic}</small> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function EditorialScorePanel({ article, assessment, intent, stale, onAnalyse, busy }) {
  if (!assessment) {
    return (
      <section className="panel">
        <div className="panel__header">
          <div><div className="eyebrow">Editorial Engine</div><h3>Article not analysed</h3><p>Run the Business Intent, scoring, linking and recommendation engines together.</p></div>
          <button type="button" className="button button--primary" disabled={busy} onClick={onAnalyse}>
            {busy ? "Analysing..." : "Analyse Article"}
          </button>
        </div>
      </section>
    );
  }
  const summary = assessment.review_summary && Object.keys(assessment.review_summary).length
    ? assessment.review_summary
    : buildArticleReviewSummary(article, assessment);
  const health = buildArticleHealth(assessment, intent, stale);
  return (
    <>
      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">AI Editorial Engine · Advisory</div>
            <h3>Article Quality Score</h3>
            <p>{stars(assessment.grade)} · {titleCase(assessment.publication_status)} · {titleCase(assessment.confidence)} confidence</p>
          </div>
          <button type="button" className="button button--ghost" disabled={busy || stale === false && false} onClick={onAnalyse}>
            {busy ? "Analysing..." : stale ? "Refresh Analysis" : "Run New Analysis"}
          </button>
        </div>
        <div className="knowledge-review-summary">
          <div className={`knowledge-quality-score ${assessment.overall_score >= 85 ? "is-strong" : assessment.overall_score >= 70 ? "is-mixed" : "is-weak"}`}>
            <strong>{assessment.overall_score}</strong><span>/ 100</span>
          </div>
          <div>
            <h4>Recommended action: {titleCase(summary.recommended_action)}</h4>
            <p>Reading {summary.reading_time_minutes} min · Review {summary.review_time_minutes} min · Business risk {summary.business_risk}/100 · SEO risk {summary.seo_risk}/100 · Conversion {summary.conversion_rating}/100</p>
            {stale ? <small>Article content changed after this assessment. Refresh before approval.</small> : null}
          </div>
        </div>
        <div className="knowledge-review-categories" style={{ marginTop: 16 }}>
          {Object.entries(assessment.category_scores || {}).map(([key, category]) => (
            <div key={key}>
              <ScoreMeter label={EDITORIAL_CATEGORY_LABELS[key] || titleCase(key)} score={category.score} />
              <p>{category.reason}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel__header"><div><h3>Article Health</h3><p>Live publication warnings. Approval remains a user decision.</p></div></div>
        <div className="knowledge-breakdown-grid">
          {Object.entries(health).filter(([key]) => key !== "warnings").map(([key, score]) => (
            <div key={key}><strong>{titleCase(key)}</strong><span>{score}%</span></div>
          ))}
        </div>
        {health.warnings.length ? <div className="notice notice--error" style={{ marginTop: 16 }}>{health.warnings.join(" ")}</div> : null}
      </section>
    </>
  );
}

export function BusinessIntentPanel({ intent, overrides, setOverrides, onSave, busy }) {
  if (!intent) return null;
  const values = { ...intent, ...(overrides || {}) };
  return (
    <section className="panel">
      <div className="panel__header">
        <div><h3>Business Intent</h3><p>AI classification with reviewable manual overrides.</p></div>
        <button type="button" className="button button--ghost" disabled={busy} onClick={onSave}>Save Overrides</button>
      </div>
      <div className="field-grid">
        <label className="field"><span className="field__label">Primary product</span><select className="field__input" value={values.primary_product} onChange={(event) => setOverrides({ ...overrides, primary_product: event.target.value })}>{PRIMARY_PRODUCTS.map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}</select></label>
        <label className="field"><span className="field__label">Secondary product</span><input className="field__input" value={values.secondary_product || ""} onChange={(event) => setOverrides({ ...overrides, secondary_product: event.target.value })} /></label>
        <label className="field"><span className="field__label">Customer journey</span><select className="field__input" value={values.customer_journey} onChange={(event) => setOverrides({ ...overrides, customer_journey: event.target.value })}>{CUSTOMER_JOURNEYS.map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}</select></label>
        <label className="field"><span className="field__label">Search intent</span><select className="field__input" value={values.search_intent} onChange={(event) => setOverrides({ ...overrides, search_intent: event.target.value })}>{SEARCH_INTENTS.map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}</select></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Conversion goal</span><input className="field__input" value={values.conversion_goal || ""} onChange={(event) => setOverrides({ ...overrides, conversion_goal: event.target.value })} /></label>
      </div>
      <small>AI confidence {intent.confidence_score}/100. Saved overrides remain in force when content is re-analysed.</small>
    </section>
  );
}

export function EditorialRecommendationsPanel({
  assessment,
  overrides,
  setOverrides,
  onSaveOverrides,
  onPropose,
  proposals,
  onApply,
  onReject,
  busy,
  linkSuggestions = [],
  linkEvents = [],
  onLinkDecision,
  onRefreshLinks,
  linkRefreshFeedback,
}) {
  if (!assessment) return null;
  const ctas = overrides.structured_ctas ?? assessment.structured_ctas ?? [];
  const updateCta = (index, field, value) =>
    setOverrides({ ...overrides, structured_ctas: ctas.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) });
  return (
    <>
      <section className="panel">
        <div className="panel__header"><div><h3>Intelligent CTAs</h3><p>Structured recommendations only. Destinations and wording are manually overridable.</p></div><button className="button button--ghost" type="button" disabled={busy} onClick={onSaveOverrides}>Save CTA Overrides</button></div>
        <div className="card-actions" style={{ marginBottom: 12 }}>
          <button
            className="button button--ghost"
            type="button"
            disabled={busy || ctas.length >= 3}
            onClick={() =>
              setOverrides({
                ...overrides,
                structured_ctas: [
                  ...ctas,
                  {
                    role: ctas.length ? "secondary" : "primary",
                    button_text: "",
                    destination: "",
                    order: ctas.length + 1,
                    reason: "Manual override",
                    confidence_score: 100,
                  },
                ],
              })
            }
          >
            Add CTA
          </button>
        </div>
        <div className="knowledge-business-grid">
          {ctas.map((cta, index) => (
            <div className="notice" key={`${cta.destination}-${index}`}>
              <strong>{titleCase(cta.role)} · Order {cta.order}</strong>
              <select className="field__input" aria-label={`CTA ${index + 1} role`} value={cta.role} onChange={(event) => updateCta(index, "role", event.target.value)}><option value="primary">Primary</option><option value="secondary">Secondary</option></select>
              <input className="field__input" aria-label={`CTA ${index + 1} text`} value={cta.button_text} onChange={(event) => updateCta(index, "button_text", event.target.value)} />
              <input className="field__input" aria-label={`CTA ${index + 1} destination`} value={cta.destination} onChange={(event) => updateCta(index, "destination", event.target.value)} />
              <input className="field__input" type="number" min="1" max="3" aria-label={`CTA ${index + 1} order`} value={cta.order} onChange={(event) => updateCta(index, "order", Number(event.target.value))} />
              <small>{cta.reason}</small>
              <button className="button button--ghost" type="button" onClick={() => setOverrides({ ...overrides, structured_ctas: ctas.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
            </div>
          ))}
          {!ctas.length ? <div className="notice">No supported CTA recommendation was returned.</div> : null}
        </div>
      </section>
      <InternalLinkReviewPanel
        suggestions={linkSuggestions}
        events={linkEvents}
        onDecision={onLinkDecision}
        onRefresh={onRefreshLinks}
        busy={busy}
        refreshFeedback={linkRefreshFeedback}
      />
      <section className="panel">
        <div className="panel__header"><div><h3>Explain My Score</h3><p>See strengths, lost points and review-only one-click improvement proposals.</p></div></div>
        <div className="knowledge-two-column">
          <div><h4>Strengths</h4><ul>{(assessment.strengths || []).map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><h4>Weaknesses</h4><ul>{(assessment.weaknesses || []).map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
        <div className="knowledge-review-findings">
          {(assessment.lost_points || []).slice(0, 8).map((item) => (
            <div key={item.category}><strong>{item.label}</strong><span>-{item.points}</span><p>{item.reason}</p></div>
          ))}
        </div>
        <div className="knowledge-review-recommendations">
          <h4>Suggested improvements</h4>
          {[...(assessment.business_recommendations || []), ...(assessment.suggested_improvements || [])].map((item) => (
            <div className="notice" key={item.key} style={{ marginBottom: 8 }}>
              <strong>{item.title}</strong><p>{item.suggestion || item.description}</p>
              <button className="button button--ghost" type="button" disabled={busy} onClick={() => onPropose(item.key)}>Prepare Review Proposal</button>
            </div>
          ))}
        </div>
        {proposals.filter((proposal) => proposal.status === "review").map((proposal) => (
          <div className="notice" key={proposal.id} style={{ marginTop: 12 }}>
            <strong>Review proposal: {proposal.title}</strong><p>{proposal.description}</p>
            <pre className="knowledge-v5-proposal">{proposal.proposed_changes?.[proposal.target_field]}</pre>
            <div className="card-actions"><button className="button button--primary" disabled={busy} onClick={() => onApply(proposal.id)}>Apply to Draft</button><button className="button button--ghost" disabled={busy} onClick={() => onReject(proposal.id)}>Reject</button></div>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="panel__header"><div><h3>Business Brain Recommendations</h3><p>Every suggestion is retained only when its supporting excerpt exists in the saved Business Brain.</p></div></div>
        {(assessment.business_recommendations || []).map((item) => (
          <div className="notice" key={item.key} style={{ marginBottom: 8 }}>
            <strong>{item.title}</strong><p>{item.suggestion}</p><small>Supported by {titleCase(item.brain_section_key)}: “{item.source_excerpt}”</small>
          </div>
        ))}
        {!assessment.business_recommendations?.length ? <div className="notice">No supported Business Brain recommendation was returned.</div> : null}
      </section>
    </>
  );
}

export function EditorialHistoryPanel({ revisions, assessments, events = [] }) {
  const [first, second] = revisions.slice(0, 2);
  return (
    <section className="panel">
      <div className="panel__header"><div><h3>Editorial History</h3><p>User edits, reviewed AI improvements, Business Brain events and score changes remain comparable.</p></div></div>
      <div className="knowledge-table-wrap">
        <table className="knowledge-table">
          <thead><tr><th>Revision</th><th>Source</th><th>Summary</th><th>Date</th></tr></thead>
          <tbody>{revisions.slice(0, 20).map((revision) => <tr key={revision.id}><td>#{revision.revision_number}</td><td>{titleCase(revision.change_source)}</td><td>{revision.change_summary}</td><td>{new Date(revision.created_at).toLocaleString("en-GB")}</td></tr>)}</tbody>
        </table>
      </div>
      {first && second ? (
        <div className="knowledge-two-column" style={{ marginTop: 16 }}>
          <div className="notice"><strong>Revision #{first.revision_number}</strong><p>{first.article_snapshot?.title}</p><small>{first.article_snapshot?.content_markdown?.length || 0} characters</small></div>
          <div className="notice"><strong>Revision #{second.revision_number}</strong><p>{second.article_snapshot?.title}</p><small>{second.article_snapshot?.content_markdown?.length || 0} characters</small></div>
        </div>
      ) : null}
      {events.slice(0, 5).map((event) => (
        <div className="notice" key={event.id} style={{ marginTop: 8 }}>
          <strong>{titleCase(event.event_type)}</strong> · {event.summary}
          <small>{new Date(event.created_at).toLocaleString("en-GB")}</small>
        </div>
      ))}
      <small>{assessments.length} editorial score snapshot{assessments.length === 1 ? "" : "s"} retained.</small>
    </section>
  );
}
