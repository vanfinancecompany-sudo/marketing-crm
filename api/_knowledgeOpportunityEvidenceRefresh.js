import {
  aggregateKnowledgeOpportunityEvidence,
  calculateEvidenceAdjustedPriority,
  evidenceChannelPayload,
  shouldCreateEvidenceOpportunity,
} from "../lib/knowledgeOpportunityEvidence.js";
import { loadLearningKnowledge, upsertOpportunityGroup } from "./_knowledgeOpportunityStore.js";

const DEFAULT_DAYS = 90;
const MIN_DAYS = 7;
const MAX_DAYS = 180;
const PAGE_SIZE = 1000;
const MAX_ROWS = 25000;
const clean = (value, limit = 1000) => String(value || "").trim().slice(0, limit);

function data(result, fallback) {
  if (result?.error) throw new Error(result.error.message || fallback);
  return result?.data;
}

function requestedDays(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, number)) : DEFAULT_DAYS;
}

function later(first, second) {
  const firstTime = new Date(first || 0).getTime();
  const secondTime = new Date(second || 0).getTime();
  if (!Number.isFinite(firstTime)) return second || first || null;
  if (!Number.isFinite(secondTime)) return first || second || null;
  return secondTime > firstTime ? second : first;
}

function earlier(first, second) {
  if (!first) return second || null;
  if (!second) return first || null;
  return new Date(second).getTime() < new Date(first).getTime() ? second : first;
}

function evidenceColumns(evidence = {}, days = DEFAULT_DAYS, refreshedAt = new Date().toISOString()) {
  return {
    live_assistant_question_count: Number(evidence.live_assistant_question_count || 0),
    live_assistant_gap_count: Number(evidence.live_assistant_gap_count || 0),
    live_assistant_retrieval_miss_count: Number(evidence.live_assistant_retrieval_miss_count || 0),
    hub_search_count: Number(evidence.hub_search_count || 0),
    hub_no_result_count: Number(evidence.hub_no_result_count || 0),
    gsc_impressions: Math.round(Number(evidence.gsc_impressions || 0)),
    gsc_clicks: Math.round(Number(evidence.gsc_clicks || 0)),
    gsc_query_count: Number(evidence.gsc_query_count || 0),
    evidence_channels: evidenceChannelPayload(evidence, days),
    evidence_last_refreshed_at: refreshedAt,
  };
}

function hasStoredEvidence(opportunity = {}) {
  return Boolean(
    opportunity.evidence_last_refreshed_at
      || Number(opportunity.live_assistant_question_count || 0)
      || Number(opportunity.live_assistant_gap_count || 0)
      || Number(opportunity.live_assistant_retrieval_miss_count || 0)
      || Number(opportunity.hub_search_count || 0)
      || Number(opportunity.hub_no_result_count || 0)
      || Number(opportunity.gsc_impressions || 0)
      || Number(opportunity.gsc_clicks || 0)
      || Number(opportunity.gsc_query_count || 0),
  );
}

function syntheticGroup(evidence, days) {
  const reasons = [];
  if (Number(evidence.live_assistant_gap_count || 0) > 0) reasons.push("live_assistant_knowledge_gap");
  if (Number(evidence.live_assistant_retrieval_miss_count || 0) > 0) reasons.push("live_assistant_retrieval_miss");
  if (Number(evidence.hub_no_result_count || 0) > 0) reasons.push("knowledge_hub_no_result");
  if (Number(evidence.gsc_impressions || 0) > 0) reasons.push("google_search_demand");
  return {
    product: evidence.product,
    title: evidence.title,
    normalised_intent: evidence.normalised_intent,
    category: evidence.category,
    summary: `Evidence-backed opportunity from live customer behaviour in the last ${days} days. No content is created or published automatically.`,
    question_count: 0,
    unique_result_count: 0,
    unanswered_count: 0,
    weak_answer_count: 0,
    conflict_count: 0,
    average_confidence: 0,
    average_accuracy: null,
    average_usefulness: null,
    first_seen_at: evidence.first_seen_at,
    last_seen_at: evidence.last_seen_at,
    observed_locations: [],
    candidate_reasons: reasons,
    questions: [],
    external_evidence: evidence,
  };
}

async function loadPagedRows(buildQuery, fallback) {
  const rows = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const result = await buildQuery().range(from, from + PAGE_SIZE - 1);
    const page = data(result, fallback) || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadEvidenceInputs(supabase, since) {
  const [opportunities, assistantEvents, searchEvents, visibilityResults, knowledge] = await Promise.all([
    loadPagedRows(
      () => supabase.from("knowledge_assistant_opportunities").select("*").order("updated_at", { ascending: true }),
      "Knowledge opportunities could not be loaded.",
    ),
    loadPagedRows(
      () => supabase
        .from("ai_assistant_events")
        .select("event_type,product_context,conversation_intent,secondary_intents,retrieval_required,retrieval_performed,retrieval_used,knowledge_gap,created_at")
        .eq("event_type", "assistant_response")
        .gte("created_at", since)
        .order("created_at", { ascending: true }),
      "Assistant evidence could not be loaded.",
    ),
    loadPagedRows(
      () => supabase
        .from("knowledge_hub_search_events")
        .select("event_type,query_text,normalised_query,result_count,category,created_at")
        .eq("event_type", "search_submitted")
        .gte("created_at", since)
        .order("created_at", { ascending: true }),
      "Knowledge Hub search evidence could not be loaded.",
    ),
    loadPagedRows(
      () => supabase
        .from("knowledge_visibility_results")
        .select("article_id,provider,checked_at,structured_evidence")
        .eq("provider", "google_search_console")
        .gte("checked_at", since)
        .order("checked_at", { ascending: false }),
      "Google Search Console evidence could not be loaded.",
    ),
    loadLearningKnowledge(supabase),
  ]);

  return { opportunities, assistantEvents, searchEvents, visibilityResults, knowledge };
}

export async function refreshKnowledgeOpportunityEvidence(supabase, options = {}) {
  const days = requestedDays(options.days);
  const refreshedAt = new Date().toISOString();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const inputs = await loadEvidenceInputs(supabase, since);
  const aggregated = aggregateKnowledgeOpportunityEvidence({
    assistantEvents: inputs.assistantEvents,
    searchEvents: inputs.searchEvents,
    visibilityResults: inputs.visibilityResults,
    articles: inputs.knowledge.articles,
  });
  const groupByKey = new Map(aggregated.groups.map((group) => [group.key, group]));
  const existingByKey = new Map(inputs.opportunities.map((item) => [`${item.product}:${item.normalised_intent}`, item]));
  const result = {
    window_days: days,
    since,
    evidence_groups: aggregated.groups.length,
    existing_updated: 0,
    new_created: 0,
    stale_cleared: 0,
    below_creation_threshold: 0,
    diagnostics: aggregated.diagnostics,
    created_ids: [],
    updated_ids: [],
  };

  for (const evidence of aggregated.groups) {
    const existing = existingByKey.get(evidence.key);
    if (existing) {
      const priority = calculateEvidenceAdjustedPriority(existing, evidence);
      const update = {
        ...evidenceColumns(evidence, days, refreshedAt),
        priority_score: priority.score,
        priority_level: priority.level,
        priority_components: priority.components,
        first_seen_at: earlier(existing.first_seen_at, evidence.first_seen_at),
        last_seen_at: later(existing.last_seen_at, evidence.last_seen_at),
        updated_at: refreshedAt,
      };
      data(
        await supabase.from("knowledge_assistant_opportunities").update(update).eq("id", existing.id),
        "Live evidence could not be saved on an existing opportunity.",
      );
      result.existing_updated += 1;
      result.updated_ids.push(existing.id);
      continue;
    }

    if (!shouldCreateEvidenceOpportunity(evidence)) {
      result.below_creation_threshold += 1;
      continue;
    }

    const created = await upsertOpportunityGroup(
      supabase,
      syntheticGroup(evidence, days),
      inputs.knowledge,
      { allowAutomaticReopen: false, evidenceWindowDays: days },
    );
    result.new_created += 1;
    result.created_ids.push(created.id);
  }

  const zeroEvidence = {
    product: "",
    normalised_intent: "",
    live_assistant_question_count: 0,
    live_assistant_gap_count: 0,
    live_assistant_retrieval_miss_count: 0,
    hub_search_count: 0,
    hub_no_result_count: 0,
    gsc_impressions: 0,
    gsc_clicks: 0,
    gsc_query_count: 0,
    assistant_intents: [],
    hub_queries: [],
    gsc_queries: [],
    first_seen_at: null,
    last_seen_at: null,
  };

  for (const existing of inputs.opportunities) {
    const key = `${existing.product}:${existing.normalised_intent}`;
    if (groupByKey.has(key) || !hasStoredEvidence(existing)) continue;
    const priority = calculateEvidenceAdjustedPriority(existing, zeroEvidence);
    data(
      await supabase.from("knowledge_assistant_opportunities").update({
        ...evidenceColumns(zeroEvidence, days, refreshedAt),
        priority_score: priority.score,
        priority_level: priority.level,
        priority_components: priority.components,
        updated_at: refreshedAt,
      }).eq("id", existing.id),
      "Expired live evidence could not be cleared.",
    );
    result.stale_cleared += 1;
    result.updated_ids.push(existing.id);
  }

  result.updated_ids = [...new Set(result.updated_ids)];
  return result;
}