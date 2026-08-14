import { useEffect, useMemo, useState } from "react";
import { buildVisibilitySummary } from "../lib/aiVisibility.js";
import { loadAssistantAnalytics } from "../services/aiAssistantAnalytics.js";
import { loadKnowledgeOpportunities } from "../services/aiKnowledgeOpportunities.js";
import { loadAiVisibility } from "../services/aiVisibility.js";

const HEALTH_BASELINE_KEY = "aiAssistantHealthBaselineV1";
const WINDOWS = [7, 28, 90];

function safeBaseline() {
  try {
    const value = JSON.parse(localStorage.getItem(HEALTH_BASELINE_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function Metric({ label, value, suffix = "" }) {
  return (
    <div className="competence-metric">
      <span>{label}</span>
      <strong>{value == null ? "—" : `${value}${suffix}`}</strong>
    </div>
  );
}

function ControlPanel({ eyebrow, title, description, children, actionLabel, onAction, error }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <button className="button button--ghost" type="button" onClick={onAction}>{actionLabel}</button>
      </div>
      {error ? <div className="notice notice--error">{error}</div> : children}
    </section>
  );
}

export default function AIControlCentrePage({ onNavigate }) {
  const [days, setDays] = useState(28);
  const [analytics, setAnalytics] = useState(null);
  const [visibilityData, setVisibilityData] = useState(null);
  const [opportunities, setOpportunities] = useState(null);
  const [healthBaseline, setHealthBaseline] = useState(safeBaseline);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setErrors({});
    setHealthBaseline(safeBaseline());
    const [analyticsResult, visibilityResult, opportunityResult] = await Promise.allSettled([
      loadAssistantAnalytics(days),
      loadAiVisibility(),
      loadKnowledgeOpportunities(),
    ]);

    const nextErrors = {};
    if (analyticsResult.status === "fulfilled") setAnalytics(analyticsResult.value);
    else { setAnalytics(null); nextErrors.analytics = analyticsResult.reason?.message || "Assistant analytics could not be loaded."; }
    if (visibilityResult.status === "fulfilled") setVisibilityData(visibilityResult.value);
    else { setVisibilityData(null); nextErrors.visibility = visibilityResult.reason?.message || "AI Visibility could not be loaded."; }
    if (opportunityResult.status === "fulfilled") setOpportunities(opportunityResult.value);
    else { setOpportunities(null); nextErrors.opportunities = opportunityResult.reason?.message || "Knowledge Opportunities could not be loaded."; }
    setErrors(nextErrors);
    setLoading(false);
  }

  useEffect(() => { load(); }, [days]);

  const visibility = useMemo(() => {
    if (!visibilityData) return null;
    return buildVisibilitySummary({
      articles: visibilityData.articles || [],
      results: visibilityData.results || [],
      prompts: visibilityData.prompts || [],
      attentionDays: visibilityData.settings?.attention_days || 30,
    });
  }, [visibilityData]);

  const assistant = analytics?.summary?.assistant || {};
  const knowledge = analytics?.summary?.knowledge || {};
  const search = analytics?.summary?.knowledge_hub_search || {};
  const opportunitySummary = opportunities?.summary || {};
  const topSources = knowledge.top_sources || [];
  const noResultQueries = search.top_no_result_queries || [];

  return (
    <div className="page-stack competence-page">
      <section className="operations-summary competence-hero">
        <div>
          <div className="eyebrow">AI & Knowledge</div>
          <h2>AI Control Centre</h2>
          <p>One operational view of customer adoption, knowledge retrieval, AI visibility, assistant health and content gaps. Specialist tools remain the source of truth for detailed work.</p>
        </div>
        <div className="competence-target">
          <strong>{analytics?.summary ? `${days}d` : "—"}</strong>
          <span>measurement window</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div><h3>Measurement window</h3><p>Switch the same dashboard between recent and longer-term evidence.</p></div>
          <button className="button button--ghost" type="button" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
        <div className="card-actions">
          {WINDOWS.map((value) => (
            <button key={value} className={`button ${days === value ? "button--primary" : "button--ghost"}`} type="button" onClick={() => setDays(value)}>{value} days</button>
          ))}
        </div>
      </section>

      <ControlPanel
        eyebrow="Customer Assistant"
        title="Adoption and conversation funnel"
        description="Measures whether customers actually see, open and use Ask Me, independently from answer quality."
        actionLabel="Open Assistant Test"
        onAction={() => onNavigate("AI Assistant Competence Test")}
        error={errors.analytics}
      >
        <div className="competence-metrics">
          <Metric label="Unique exposures" value={assistant.unique_exposed_visitors} />
          <Metric label="Unique opens" value={assistant.unique_open_visitors} />
          <Metric label="Open rate" value={assistant.open_rate} suffix="%" />
          <Metric label="Conversations" value={assistant.conversations_started} />
          <Metric label="2+ message conversations" value={assistant.conversations_with_2_plus_messages} />
          <Metric label="Customer messages" value={assistant.customer_messages} />
          <Metric label="CTA clicks" value={assistant.cta_clicks} />
        </div>
      </ControlPanel>

      <ControlPanel
        eyebrow="Knowledge Retrieval"
        title="What the live assistant is actually using"
        description="Shows trusted server-side retrieval evidence, not browser-reported source claims."
        actionLabel="Open Knowledge Hub"
        onAction={() => onNavigate("Knowledge Hub")}
        error={errors.analytics}
      >
        <div className="competence-metrics">
          <Metric label="Assistant responses" value={assistant.assistant_responses} />
          <Metric label="Responses using retrieval" value={knowledge.responses_with_retrieval} />
          <Metric label="Retrieval rate" value={knowledge.retrieval_rate} suffix="%" />
          <Metric label="Knowledge gaps" value={knowledge.knowledge_gaps} />
          <Metric label="Gap rate" value={knowledge.knowledge_gap_rate} suffix="%" />
        </div>
        <div className="knowledge-two-column" style={{ marginTop: 14 }}>
          <div>
            <h4>Most-used knowledge sources</h4>
            {topSources.length ? topSources.slice(0, 5).map((source) => (
              <div className="notice" key={source.source_id}><strong>{source.title || source.source_id}</strong><br />{source.retrieval_count} retrieved response{source.retrieval_count === 1 ? "" : "s"}</div>
            )) : <p>No live retrieval evidence in this window yet.</p>}
          </div>
          <div>
            <h4>Knowledge Hub search</h4>
            <div className="competence-metrics">
              <Metric label="Searches" value={search.searches} />
              <Metric label="No-result searches" value={search.no_result_searches} />
              <Metric label="Article selections" value={search.result_selections} />
              <Metric label="Selection rate" value={search.selection_rate} suffix="%" />
            </div>
            {noResultQueries.slice(0, 3).map((item) => <div className="notice" key={item.query}><strong>{item.query}</strong><br />{item.count} no-result search{item.count === 1 ? "" : "es"}</div>)}
          </div>
        </div>
      </ControlPanel>

      <ControlPanel
        eyebrow="AI Visibility"
        title="Published-page discovery and AI evidence"
        description="Uses the existing AI Visibility evidence model and confirmed publication lifecycle."
        actionLabel="Open AI Visibility"
        onAction={() => onNavigate("AI Visibility")}
        error={errors.visibility}
      >
        <div className="competence-metrics">
          <Metric label="Published pages" value={visibility?.published_pages} />
          <Metric label="Google indexed" value={visibility?.google_indexed} />
          <Metric label="AI visible" value={visibility?.ai_visible} />
          <Metric label="Verified detections" value={visibility?.total_verified_detections} />
          <Metric label="Awaiting first check" value={visibility?.awaiting_first_check} />
          <Metric label="Needs attention" value={visibility?.needs_attention} />
          <Metric label="Visibility rate" value={visibility?.visibility_rate} suffix="%" />
        </div>
      </ControlPanel>

      <ControlPanel
        eyebrow="Assistant Health"
        title="Regression baseline"
        description="Separates assistant quality from customer adoption. The saved Health baseline remains the reference until a new validation is deliberately run."
        actionLabel="Open Assistant Health"
        onAction={() => onNavigate("AI Assistant Health")}
      >
        <div className="competence-metrics">
          <Metric label="Overall health" value={healthBaseline?.overall_ai_health_score} suffix="%" />
          <Metric label="Product separation" value={healthBaseline?.product_separation_accuracy} suffix="%" />
          <Metric label="Knowledge retrieval" value={healthBaseline?.knowledge_retrieval_accuracy} suffix="%" />
          <Metric label="Context retention" value={healthBaseline?.context_retention} suffix="%" />
          <Metric label="Failed scenarios" value={healthBaseline?.failed_scenario_count} />
          <Metric label="Baseline conversations" value={healthBaseline?.conversations} />
        </div>
        {!healthBaseline ? <div className="notice">No saved Assistant Health baseline is available in this browser yet.</div> : null}
      </ControlPanel>

      <ControlPanel
        eyebrow="Knowledge Opportunities"
        title="Where evidence says the knowledge base needs work"
        description="Prioritises unresolved gaps and weak-answer clusters without automatically creating content."
        actionLabel="Open Opportunities"
        onAction={() => onNavigate("AI Knowledge Opportunities")}
        error={errors.opportunities}
      >
        <div className="competence-metrics">
          <Metric label="New" value={opportunitySummary.new} />
          <Metric label="High priority" value={opportunitySummary.high_priority} />
          <Metric label="Unanswered clusters" value={opportunitySummary.unanswered} />
          <Metric label="Weak-answer clusters" value={opportunitySummary.weak} />
          <Metric label="Conflict clusters" value={opportunitySummary.conflicts} />
          <Metric label="Create article" value={opportunitySummary.create_article} />
          <Metric label="Resolved" value={opportunitySummary.resolved} />
        </div>
      </ControlPanel>
    </div>
  );
}
