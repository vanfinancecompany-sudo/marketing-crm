import {
  calculateOpportunityPriority,
  diagnoseExistingKnowledge,
  groupCompetenceCandidates,
  recommendOpportunityContent,
} from "../lib/knowledgeLearningEngine.js";
import {
  calculateEvidenceAdjustedPriority,
  evidenceChannelPayload,
} from "../lib/knowledgeOpportunityEvidence.js";
import {
  hasMeaningfulNewOpportunityEvidence,
  knowledgeOpportunityClusterFingerprint,
  knowledgeOpportunityEvidenceFingerprint,
  workflowReopenReason,
} from "../lib/knowledgeOpportunityWorkflow.js";

const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
function data(result, fallback) { if (result.error) throw new Error(result.error.message || fallback); return result.data; }

export async function loadLearningKnowledge(supabase) {
  const [articles, sections, topics] = await Promise.all([
    supabase.from("knowledge_articles").select("id,title,category,status,content_markdown,faq_json,live_wix_url").eq("status", "approved").eq("is_active", true),
    supabase.from("knowledge_business_sections").select("id,section_key,title,content,entries,active").eq("active", true),
    supabase.from("knowledge_topics").select("id,title,category,status,canonical_intent,notes").neq("status", "archived"),
  ]);
  return { articles: data(articles, "Approved articles could not be loaded.") || [], sections: data(sections, "Business Knowledge could not be loaded.") || [], topics: data(topics, "Topic planner could not be loaded.") || [] };
}

function suggestionFor(group, diagnosis, recommendation) {
  const competenceQuestions = [...new Set((group.questions || []).map((item) => item.original_question).filter(Boolean))];
  const liveQuestions = (group.external_evidence?.assistant_questions || []).map((item) => clean(item.query, 500)).filter(Boolean);
  const hubQueries = (group.external_evidence?.hub_queries || []).map((item) => clean(item.query, 500)).filter(Boolean);
  const observedQuestions = [...new Set([...liveQuestions, ...hubQueries])].slice(0, 6);
  const questions = competenceQuestions.length ? competenceQuestions : observedQuestions;
  const evidenceHint = group.external_evidence
    ? `Use live assistant, Knowledge Hub search and Google Search Console evidence as demand signals only; verify underlying business facts before changing content.${observedQuestions.length ? ` Observed customer wording: ${observedQuestions.join(" | ")}.` : ""}`
    : "";
  return {
    suggested_article_title: group.title,
    suggested_article_brief: competenceQuestions.length
      ? `Answer the grouped ${group.product} intent rather than creating separate content for each wording. Cover: ${competenceQuestions.slice(0, 6).join(" | ")}. Diagnosis: ${diagnosis.diagnosis}.`
      : `Review the existing ${group.product} knowledge for this evidence-backed intent. Diagnosis: ${diagnosis.diagnosis}. ${evidenceHint}`.trim(),
    suggested_headings: ["Direct answer", "Who this applies to", "What customers need to know", "Practical next steps", "Frequently asked questions"],
    suggested_factual_points: group.candidate_reasons || [],
    suggested_faq: { question: questions[0] || group.title, answer: "Draft answer requires review against the linked Business Knowledge before activation." },
    recommended_action: recommendation.action,
  };
}

export async function upsertOpportunityGroup(supabase, group, knowledge, options = {}) {
  const diagnosis = diagnoseExistingKnowledge(group, knowledge);
  const recommendation = recommendOpportunityContent({ ...group, recommended_action: diagnosis.recommendedAction });
  const priorityInput = { ...group, title: group.title, normalised_intent: group.normalised_intent, existing_article_count: diagnosis.relatedArticles.length };
  const priority = group.external_evidence
    ? calculateEvidenceAdjustedPriority(priorityInput, group.external_evidence)
    : calculateOpportunityPriority(priorityInput);
  const suggestion = suggestionFor(group, diagnosis, recommendation);
  const existingResult = await supabase.from("knowledge_assistant_opportunities").select("*").eq("product", group.product).eq("normalised_intent", group.normalised_intent).maybeSingle();
  const existing = data(existingResult, "Existing knowledge opportunity could not be checked.");
  const clusterFingerprint = knowledgeOpportunityClusterFingerprint(group);
  const evidenceFingerprint = knowledgeOpportunityEvidenceFingerprint(group);
  const reopenable = ["closed", "no_action_required", "resolved", "dismissed", "completed"].includes(existing?.status);
  const allowAutomaticReopen = options.allowAutomaticReopen !== false && !group.external_evidence;
  const automaticallyReopened = allowAutomaticReopen && reopenable && hasMeaningfulNewOpportunityEvidence(existing, group);
  const reopenReason = automaticallyReopened ? workflowReopenReason(existing, group) : "";
  const payload = {
    product: group.product,
    title: clean(group.title, 300),
    normalised_intent: clean(group.normalised_intent, 200),
    category: group.category,
    summary: group.summary,
    priority_score: priority.score,
    priority_level: priority.level,
    priority_components: priority.components,
    question_count: group.question_count,
    unique_result_count: group.unique_result_count,
    unanswered_count: group.unanswered_count,
    weak_answer_count: group.weak_answer_count,
    conflict_count: group.conflict_count,
    average_confidence: group.average_confidence,
    average_accuracy: group.average_accuracy,
    average_usefulness: group.average_usefulness,
    first_seen_at: group.first_seen_at,
    last_seen_at: group.last_seen_at,
    observed_locations: group.observed_locations,
    candidate_reasons: group.candidate_reasons,
    diagnosis: diagnosis.diagnosis,
    related_article_ids: diagnosis.relatedArticles.map((item) => item.id),
    related_business_section_ids: diagnosis.relatedSections.map((item) => item.id),
    cluster_fingerprint: clusterFingerprint,
    evidence_fingerprint: evidenceFingerprint,
    ...suggestion,
    updated_at: new Date().toISOString(),
  };
  if (group.external_evidence) {
    Object.assign(payload, {
      live_assistant_question_count: Number(group.external_evidence.live_assistant_question_count || 0),
      live_assistant_gap_count: Number(group.external_evidence.live_assistant_gap_count || 0),
      live_assistant_retrieval_miss_count: Number(group.external_evidence.live_assistant_retrieval_miss_count || 0),
      hub_search_count: Number(group.external_evidence.hub_search_count || 0),
      hub_no_result_count: Number(group.external_evidence.hub_no_result_count || 0),
      gsc_impressions: Math.round(Number(group.external_evidence.gsc_impressions || 0)),
      gsc_clicks: Math.round(Number(group.external_evidence.gsc_clicks || 0)),
      gsc_query_count: Number(group.external_evidence.gsc_query_count || 0),
      evidence_channels: evidenceChannelPayload(group.external_evidence, options.evidenceWindowDays || 90),
      evidence_last_refreshed_at: payload.updated_at,
    });
  }
  if (automaticallyReopened) Object.assign(payload, { status: "reopened", reopened_at: payload.updated_at, reopen_reason: reopenReason });
  const opportunity = data(await supabase.from("knowledge_assistant_opportunities").upsert(payload, { onConflict: "product,normalised_intent", ignoreDuplicates: false }).select().single(), "Knowledge opportunity could not be saved.");
  if (automaticallyReopened) {
    data(await supabase.from("knowledge_assistant_opportunity_events").insert({
      opportunity_id: opportunity.id,
      event_type: "automatically_reopened",
      from_status: existing.status,
      to_status: "reopened",
      user_action: "Knowledge Learning Engine",
      notes: reopenReason,
      details: { previous_evidence_fingerprint: existing.evidence_fingerprint, evidence_fingerprint: evidenceFingerprint, cluster_fingerprint: clusterFingerprint, automatic: true },
    }), "Automatic reopen audit event could not be saved.");
  }
  for (const question of group.questions || []) {
    data(await supabase.from("knowledge_assistant_opportunity_questions").upsert({ opportunity_id: opportunity.id, ...question }, { onConflict: "competence_result_id", ignoreDuplicates: true }), "Opportunity question could not be linked.");
  }
  return opportunity;
}

export async function analyseCompetenceResults(supabase, results, reviews, settings = {}, knowledge = null) {
  const grouped = groupCompetenceCandidates(results, reviews, settings);
  const sourceKnowledge = knowledge || await loadLearningKnowledge(supabase);
  const saved = [];
  for (const group of grouped) saved.push(await upsertOpportunityGroup(supabase, group, sourceKnowledge));
  return { analysed_results: results.length, candidate_groups: grouped.length, opportunities_upserted: saved.length, opportunity_ids: saved.map((item) => item.id) };
}

export async function assessSavedCompetenceResult(supabase, resultId) {
  try {
    const [result, review, settings] = await Promise.all([
      supabase.from("knowledge_competence_results").select("*").eq("id", resultId).single(),
      supabase.from("knowledge_competence_reviews").select("*").eq("result_id", resultId).maybeSingle(),
      supabase.from("knowledge_settings").select("assistant_confidence_threshold").eq("settings_key", "default").maybeSingle(),
    ]);
    if (result.error) throw result.error;
    const configuration = { confidence_threshold: settings.data?.assistant_confidence_threshold ?? 65 };
    const initial = await analyseCompetenceResults(supabase, [result.data], review.data ? [review.data] : [], configuration);
    for (const opportunityId of initial.opportunity_ids || []) {
      const links = data(await supabase.from("knowledge_assistant_opportunity_questions").select("competence_result_id").eq("opportunity_id", opportunityId), "Opportunity links could not be refreshed.") || [];
      const resultIds = links.map((item) => item.competence_result_id);
      if (!resultIds.length) continue;
      const [allResults, allReviews] = await Promise.all([
        supabase.from("knowledge_competence_results").select("*").in("id", resultIds),
        supabase.from("knowledge_competence_reviews").select("*").in("result_id", resultIds),
      ]);
      await analyseCompetenceResults(supabase, data(allResults, "Opportunity results could not be refreshed.") || [], data(allReviews, "Opportunity reviews could not be refreshed.") || [], configuration);
    }
    return { ...initial, captured: true };
  } catch (error) {
    console.error("KNOWLEDGE LEARNING CAPTURE ERROR", { result_id: resultId, message: error.message, stack: error.stack });
    return { captured: false, message: error.message };
  }
}
