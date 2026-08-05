import { createClient } from "@supabase/supabase-js";
import { competenceAuthorize } from "./marketing-ai-assistant-competence.js";
import { generateArticle } from "./marketing-knowledge-hub.js";
import { analyseCompetenceResults, loadLearningKnowledge } from "./_knowledgeOpportunityStore.js";
import { calculateImprovementMetrics, OPPORTUNITY_STATUSES } from "../lib/knowledgeLearningEngine.js";

const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function getSupabase() { if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new ApiError(500, "Supabase is not configured."); return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function parseBody(request) { if (typeof request.body === "object") return request.body || {}; try { return JSON.parse(request.body || "{}"); } catch { throw new ApiError(400, "Request body is not valid JSON."); } }
function data(result, fallback) { if (result.error) throw new ApiError(500, result.error.message || fallback); return result.data; }

async function loadAll(supabase) {
  const [opportunities, questions, events, faqDrafts, results, reviews, knowledge] = await Promise.all([
    supabase.from("knowledge_assistant_opportunities").select("*").order("priority_score", { ascending: false }).order("last_seen_at", { ascending: false }),
    supabase.from("knowledge_assistant_opportunity_questions").select("*").order("created_at", { ascending: true }),
    supabase.from("knowledge_assistant_opportunity_events").select("*").order("created_at", { ascending: false }),
    supabase.from("knowledge_assistant_faq_drafts").select("*").order("created_at", { ascending: false }),
    supabase.from("knowledge_competence_results").select("*").order("created_at", { ascending: false }).limit(5000),
    supabase.from("knowledge_competence_reviews").select("*").order("created_at", { ascending: false }).limit(5000),
    loadLearningKnowledge(supabase),
  ]);
  const rows = data(opportunities, "Knowledge opportunities could not be loaded.") || [];
  const questionRows = data(questions, "Opportunity questions could not be loaded.") || [];
  const eventRows = data(events, "Opportunity history could not be loaded.") || [];
  const faqRows = data(faqDrafts, "FAQ drafts could not be loaded.") || [];
  const resultRows = data(results, "Competence results could not be loaded.") || [];
  const reviewRows = data(reviews, "Competence reviews could not be loaded.") || [];
  const reviewByResult = new Map(reviewRows.map((review) => [review.result_id, review]));
  const resultById = new Map(resultRows.map((result) => [result.id, { ...result, review: reviewByResult.get(result.id) || null }]));
  const articleById = new Map(knowledge.articles.map((article) => [article.id, article]));
  const sectionById = new Map(knowledge.sections.map((section) => [section.id, section]));
  const hydrated = rows.map((opportunity) => {
    const linkedQuestions = questionRows.filter((item) => item.opportunity_id === opportunity.id);
    const linkedResults = linkedQuestions.map((item) => resultById.get(item.competence_result_id)).filter(Boolean);
    return {
      ...opportunity,
      questions: linkedQuestions,
      results: linkedResults,
      events: eventRows.filter((item) => item.opportunity_id === opportunity.id),
      faq_drafts: faqRows.filter((item) => item.opportunity_id === opportunity.id),
      related_articles: (opportunity.related_article_ids || []).map((id) => articleById.get(id)).filter(Boolean),
      related_business_sections: (opportunity.related_business_section_ids || []).map((id) => sectionById.get(id)).filter(Boolean),
      improvement_metrics: calculateImprovementMetrics(linkedResults, opportunity.linked_at),
      linked_article: articleById.get(opportunity.linked_article_id) || null,
    };
  });
  const active = hydrated.filter((item) => !["dismissed", "completed"].includes(item.status));
  const summary = {
    new: hydrated.filter((item) => item.status === "new").length,
    high_priority: active.filter((item) => ["critical", "high"].includes(item.priority_level)).length,
    rent2buy: active.filter((item) => item.product === "rent2buy").length,
    finance: active.filter((item) => item.product === "finance").length,
    unanswered: active.filter((item) => item.unanswered_count > 0).length,
    weak: active.filter((item) => item.weak_answer_count > 0).length,
    conflicts: active.filter((item) => item.conflict_count > 0).length,
    articles_suggested: active.filter((item) => item.recommended_action === "create_article").length,
    drafts_created: hydrated.filter((item) => item.linked_article_id).length,
    completed: hydrated.filter((item) => item.status === "completed").length,
  };
  return { opportunities: hydrated, summary, topics: knowledge.topics };
}

async function analyseExisting(supabase) {
  const [results, reviews, settings] = await Promise.all([
    supabase.from("knowledge_competence_results").select("*").order("created_at", { ascending: true }).limit(5000),
    supabase.from("knowledge_competence_reviews").select("*").limit(5000),
    supabase.from("knowledge_settings").select("assistant_confidence_threshold").eq("settings_key", "default").maybeSingle(),
  ]);
  return analyseCompetenceResults(
    supabase,
    data(results, "Competence results could not be analysed.") || [],
    data(reviews, "Competence reviews could not be analysed.") || [],
    { confidence_threshold: settings.data?.assistant_confidence_threshold ?? 65 },
  );
}

async function updateOpportunity(supabase, body) {
  const id = clean(body.opportunity_id, 100);
  if (!id) throw new ApiError(400, "Opportunity id is required.");
  const existing = data(await supabase.from("knowledge_assistant_opportunities").select("*").eq("id", id).single(), "Opportunity could not be found.");
  const status = body.status ? clean(body.status, 80) : existing.status;
  if (!OPPORTUNITY_STATUSES.includes(status)) throw new ApiError(400, "Unsupported opportunity status.");
  const update = { status, internal_notes: clean(body.internal_notes ?? existing.internal_notes, 10000), updated_at: new Date().toISOString() };
  const saved = data(await supabase.from("knowledge_assistant_opportunities").update(update).eq("id", id).select().single(), "Opportunity could not be updated.");
  data(await supabase.from("knowledge_assistant_opportunity_events").insert({ opportunity_id: id, event_type: status !== existing.status ? "status_changed" : "notes_updated", from_status: existing.status, to_status: status, user_action: clean(body.user_action, 200) || "administrator", notes: clean(body.notes, 5000), details: { manual: true } }), "Opportunity audit event could not be saved.");
  return saved;
}

async function linkArticle(supabase, opportunityId, articleId, eventType = "article_linked") {
  const linkedAt = new Date().toISOString();
  const saved = data(await supabase.from("knowledge_assistant_opportunities").update({ linked_article_id: articleId, linked_at: linkedAt, updated_at: linkedAt }).eq("id", opportunityId).select().single(), "Article could not be linked.");
  data(await supabase.from("knowledge_assistant_opportunity_events").insert({ opportunity_id: opportunityId, event_type: eventType, user_action: "administrator", linked_article_id: articleId, details: { automatic_completion: false } }), "Article link audit could not be saved.");
  return saved;
}

async function createArticleDraft(supabase, body) {
  const id = clean(body.opportunity_id, 100);
  const opportunity = data(await supabase.from("knowledge_assistant_opportunities").select("*").eq("id", id).single(), "Opportunity could not be found.");
  if (opportunity.linked_article_id) throw new ApiError(409, "This opportunity already has a linked article.");
  const questions = data(await supabase.from("knowledge_assistant_opportunity_questions").select("original_question").eq("opportunity_id", id), "Grouped questions could not be loaded.") || [];
  const topicPayload = {
    title: clean(body.title || opportunity.suggested_article_title || opportunity.title, 300),
    category: opportunity.product === "rent2buy" ? "Rent2Buy" : opportunity.category || "Van Finance",
    primary_keyword: clean(opportunity.normalised_intent.replaceAll("_", " "), 200),
    secondary_keywords: [],
    intent: clean(opportunity.normalised_intent, 300),
    canonical_intent: clean(opportunity.normalised_intent, 300),
    article_angle: clean(`Grouped AI knowledge opportunity: ${opportunity.title}`, 500),
    notes: clean(`${opportunity.suggested_article_brief}\n\nGrouped customer questions:\n${questions.map((item) => `- ${item.original_question}`).join("\n")}`, 10000),
    status: "ready",
    priority: Math.max(1, Math.min(5, Math.ceil(opportunity.priority_score / 20))),
    source: "ai_knowledge_opportunity",
    finder_metadata: { opportunity_id: opportunity.id, grouped_questions: questions.map((item) => item.original_question), draft_only: true },
    created_by: "AI Knowledge Opportunities",
  };
  const topic = data(await supabase.from("knowledge_topics").insert(topicPayload).select().single(), "Knowledge Hub topic could not be created.");
  const article = await generateArticle(supabase, {
    topic,
    generation: {
      templateKey: opportunity.product === "rent2buy" ? "rent2buy-guide" : "finance-guide",
      targetAudience: "Customers asking the grouped competence-test questions",
      tone: "Friendly, concise and factual",
      approximateLength: 1000,
      instructions: `${opportunity.suggested_article_brief}\nUse the grouped questions as coverage requirements. Use relevant Business Brain evidence and related approved articles to avoid duplication. Create a draft only.`,
    },
  });
  await linkArticle(supabase, opportunity.id, article.id, "article_draft_created");
  return { topic, article };
}

async function createFaqDraft(supabase, body) {
  const id = clean(body.opportunity_id, 100);
  const destination = clean(body.destination, 80);
  if (!["business_knowledge", "existing_article", "new_article"].includes(destination)) throw new ApiError(400, "Choose a valid FAQ destination.");
  const opportunity = data(await supabase.from("knowledge_assistant_opportunities").select("*").eq("id", id).single(), "Opportunity could not be found.");
  const draft = data(await supabase.from("knowledge_assistant_faq_drafts").insert({ opportunity_id: id, question: clean(body.question || opportunity.suggested_faq?.question, 1000), answer: clean(body.answer || opportunity.suggested_faq?.answer, 5000), destination, destination_article_id: body.destination_article_id || null }).select().single(), "FAQ draft could not be created.");
  data(await supabase.from("knowledge_assistant_opportunities").update({ linked_faq_id: draft.id, faq_destination: destination, updated_at: new Date().toISOString() }).eq("id", id), "FAQ link could not be saved.");
  data(await supabase.from("knowledge_assistant_opportunity_events").insert({ opportunity_id: id, event_type: "faq_draft_created", user_action: "administrator", linked_faq_id: draft.id, details: { destination, automatic_activation: false } }), "FAQ audit could not be saved.");
  return draft;
}

export default async function handler(request, response) {
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!competenceAuthorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  try {
    const body = parseBody(request);
    const supabase = getSupabase();
    let result;
    if (body.action === "load") result = await loadAll(supabase);
    else if (body.action === "analyseExisting") result = { analysis: await analyseExisting(supabase) };
    else if (body.action === "updateOpportunity") result = { opportunity: await updateOpportunity(supabase, body) };
    else if (body.action === "linkArticle") result = { opportunity: await linkArticle(supabase, clean(body.opportunity_id, 100), clean(body.article_id, 100)) };
    else if (body.action === "createArticleDraft") result = await createArticleDraft(supabase, body);
    else if (body.action === "createFaqDraft") result = { faq_draft: await createFaqDraft(supabase, body) };
    else throw new ApiError(400, "Unsupported AI Knowledge Opportunities action.");
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("AI KNOWLEDGE OPPORTUNITIES ERROR", { message: error.message, stack: error.stack });
    return response.status(error.status || 500).json({ ok: false, message: error.message || "AI Knowledge Opportunities request failed." });
  }
}
