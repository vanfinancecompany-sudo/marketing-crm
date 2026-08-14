import { createClient } from "@supabase/supabase-js";
import { recommendedKnowledgeWorkflowAction } from "../lib/knowledgeOpportunityWorkflow.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const OPPORTUNITY_IDS = [
  "79e0bc56-3fef-4184-b7b5-faf97f6f5997",
  "b4e4018b-c1b5-4a06-9b37-008f73349b9b",
  "115c0611-21df-4e3b-926f-4d4437fad39d",
  "18aacbd3-c001-4183-bde0-cc9593a3f882",
  "3ca57f3d-4a1e-4223-ab81-2d2714f35d14",
  "7260bfbb-19c1-4750-a98a-9e761b4d0108",
  "359dac84-5f17-432c-9560-886655b4a29c",
  "3acbb171-23f7-499c-9b22-d1b82ecfd0a2",
  "7bc779af-480e-4f66-90e4-4b15c033bc22",
  "8da09847-5a96-4957-878d-37eb42a722eb",
  "6dfe9898-a144-4349-ab8a-7d92967559d8",
  "0a8f1adc-422f-4304-b0fa-edeb38577ab8",
  "457a88d5-89bc-454c-8973-d1c64a1a4ea7",
  "cd21e4c0-84f5-493d-8858-97e135db05c5",
  "e4019bbe-6a24-4616-93eb-3e870426a97f",
  "e8042968-89b6-4d42-aac7-8b1b3230eba8",
  "3a30de75-d8b1-4bdb-a0f6-3ef053d943df",
];

function shouldRun() {
  return process.env.VERCEL_ENV === "production"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === "main";
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the read-only Knowledge Opportunity snapshot.`);
  return value;
}

function check(result, message) {
  if (result.error) throw new Error(`${message}: ${result.error.message || result.error}`);
  return result.data || [];
}

async function main() {
  if (!shouldRun()) {
    console.log("KNOWLEDGE_OPPORTUNITY_REVIEW_SKIPPED", JSON.stringify({
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    }));
    return;
  }

  const supabase = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const rows = check(await supabase
    .from("knowledge_assistant_opportunities")
    .select("id,product,title,normalised_intent,category,status,priority_score,priority_level,question_count,unique_result_count,unanswered_count,weak_answer_count,conflict_count,average_confidence,diagnosis,recommended_action,related_article_ids,related_business_section_ids,suggested_article_title,linked_article_id,live_assistant_question_count,live_assistant_gap_count,live_assistant_retrieval_miss_count,hub_search_count,hub_no_result_count,gsc_impressions,gsc_clicks,gsc_query_count,evidence_last_refreshed_at")
    .in("id", OPPORTUNITY_IDS), "Knowledge Opportunities could not be read");

  const relatedArticleIds = [...new Set(rows.flatMap((row) => [
    ...(Array.isArray(row.related_article_ids) ? row.related_article_ids : []),
    row.linked_article_id,
  ]).filter(Boolean))];

  const articles = relatedArticleIds.length
    ? check(await supabase.from("knowledge_articles").select("id,title,category,status,live_wix_url").in("id", relatedArticleIds), "Related articles could not be read")
    : [];

  const articleById = new Map(articles.map((item) => [item.id, item]));
  const touched = new Set(OPPORTUNITY_IDS);
  const safeRows = rows
    .filter((row) => touched.has(row.id))
    .sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0))
    .map((row) => ({
      id: row.id,
      product: row.product,
      title: row.title,
      intent: row.normalised_intent,
      category: row.category,
      status: row.status,
      priority_score: row.priority_score,
      priority_level: row.priority_level,
      recommended_workflow_action: recommendedKnowledgeWorkflowAction(row),
      recommended_action: row.recommended_action,
      diagnosis: row.diagnosis,
      suggested_article_title: row.suggested_article_title,
      competence: {
        questions: row.question_count,
        results: row.unique_result_count,
        unanswered: row.unanswered_count,
        weak: row.weak_answer_count,
        conflicts: row.conflict_count,
        average_confidence: row.average_confidence,
      },
      live_evidence: {
        assistant_questions: row.live_assistant_question_count,
        assistant_gaps: row.live_assistant_gap_count,
        retrieval_misses: row.live_assistant_retrieval_miss_count,
        hub_searches: row.hub_search_count,
        hub_no_results: row.hub_no_result_count,
        gsc_impressions: row.gsc_impressions,
        gsc_clicks: row.gsc_clicks,
        gsc_queries: row.gsc_query_count,
        last_refreshed_at: row.evidence_last_refreshed_at,
      },
      related_articles: (row.related_article_ids || []).map((id) => articleById.get(id)).filter(Boolean).map((item) => ({ id: item.id, title: item.title, category: item.category, status: item.status, live: Boolean(item.live_wix_url) })),
      related_business_section_count: Array.isArray(row.related_business_section_ids) ? row.related_business_section_ids.length : 0,
      linked_article: row.linked_article_id ? articleById.get(row.linked_article_id) || { id: row.linked_article_id } : null,
    }));

  console.log("KNOWLEDGE_OPPORTUNITY_REVIEW_SNAPSHOT", JSON.stringify({
    target_count: OPPORTUNITY_IDS.length,
    rows_found: safeRows.length,
    automatic_content_creation: false,
    database_writes: 0,
    customer_question_text_logged: false,
    opportunities: safeRows,
  }));
}

main().catch((error) => {
  console.error("KNOWLEDGE_OPPORTUNITY_REVIEW_FATAL", JSON.stringify({ message: error?.message || String(error) }));
  process.exitCode = 1;
});
