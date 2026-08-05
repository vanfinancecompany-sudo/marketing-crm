import {
  calculateOpportunityPriority,
  diagnoseExistingKnowledge,
  groupCompetenceCandidates,
  recommendOpportunityContent,
} from "../lib/knowledgeLearningEngine.js";

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
  const questions = [...new Set(group.questions.map((item) => item.original_question))];
  return {
    suggested_article_title: group.title,
    suggested_article_brief: `Answer the grouped ${group.product} intent rather than creating separate content for each wording. Cover: ${questions.slice(0, 6).join(" | ")}. Diagnosis: ${diagnosis.diagnosis}.`,
    suggested_headings: ["Direct answer", "Who this applies to", "What customers need to know", "Practical next steps", "Frequently asked questions"],
    suggested_factual_points: group.candidate_reasons,
    suggested_faq: { question: questions[0] || group.title, answer: "Draft answer requires review against the linked Business Knowledge before activation." },
    recommended_action: recommendation.action,
  };
}

export async function upsertOpportunityGroup(supabase, group, knowledge) {
  const diagnosis = diagnoseExistingKnowledge(group, knowledge);
  const recommendation = recommendOpportunityContent({ ...group, recommended_action: diagnosis.recommendedAction });
  const priority = calculateOpportunityPriority({ ...group, title: group.title, normalised_intent: group.normalised_intent, existing_article_count: diagnosis.relatedArticles.length });
  const suggestion = suggestionFor(group, diagnosis, recommendation);
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
    ...suggestion,
    updated_at: new Date().toISOString(),
  };
  const opportunity = data(await supabase.from("knowledge_assistant_opportunities").upsert(payload, { onConflict: "product,normalised_intent", ignoreDuplicates: false }).select().single(), "Knowledge opportunity could not be saved.");
  for (const question of group.questions) {
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
