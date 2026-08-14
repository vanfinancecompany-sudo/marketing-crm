import { handleAiControlCentreRequest } from "../api/marketing-ai-control-centre.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const INTERNAL_ACCESS_KEY = "build-time-read-only-control-centre-probe";

function clean(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "production"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === "main";
}

function required(name) {
  const value = clean(process.env[name], 5000);
  if (!value) throw new Error(`${name} is required for the read-only AI Control Centre check.`);
  return value;
}

function baselineSummary(item) {
  if (!item) return null;
  return {
    id: item.id || null,
    name: clean(item.name),
    mode: clean(item.mode, 30),
    conversations: Number(item.conversations || 0),
    turns: Number(item.turns || 0),
    overall_ai_health_score: item.overall_ai_health_score == null ? null : Number(item.overall_ai_health_score),
    commit_sha: clean(item.commit_sha, 100) || null,
    generated_at: item.generated_at || null,
    created_at: item.created_at || null,
  };
}

function assistantSummary(value = {}) {
  return {
    assistant: value.assistant || {},
    knowledge: {
      responses_with_retrieval: Number(value.knowledge?.responses_with_retrieval || 0),
      retrieval_rate: Number(value.knowledge?.retrieval_rate || 0),
      knowledge_gaps: Number(value.knowledge?.knowledge_gaps || 0),
      knowledge_gap_rate: Number(value.knowledge?.knowledge_gap_rate || 0),
      top_sources: (value.knowledge?.top_sources || []).slice(0, 5).map((item) => ({
        source_id: clean(item.source_id, 160),
        title: clean(item.title, 160) || null,
        type: clean(item.type, 60) || null,
        retrieval_count: Number(item.retrieval_count || 0),
      })),
    },
    knowledge_hub_search: {
      searches: Number(value.knowledge_hub_search?.searches || 0),
      no_result_searches: Number(value.knowledge_hub_search?.no_result_searches || 0),
      result_selections: Number(value.knowledge_hub_search?.result_selections || 0),
      selection_rate: Number(value.knowledge_hub_search?.selection_rate || 0),
    },
    by_page_type: (value.by_page_type || []).slice(0, 8),
  };
}

function visibilitySummary(value = {}) {
  return {
    published_pages: Number(value.published_pages || 0),
    checked_pages: Number(value.checked_pages || 0),
    unchecked_pages: Number(value.unchecked_pages || 0),
    google_indexed: Number(value.google_indexed || 0),
    google_pending: Number(value.google_pending || 0),
    ai_visible: Number(value.ai_visible || 0),
    chatgpt_detections: Number(value.chatgpt_detections || 0),
    gemini_detections: Number(value.gemini_detections || 0),
    perplexity_detections: Number(value.perplexity_detections || 0),
    google_ai_overview_detections: Number(value.google_ai_overview_detections || 0),
    awaiting_first_check: Number(value.awaiting_first_check || 0),
    needs_attention: Number(value.needs_attention || 0),
    total_verified_detections: Number(value.total_verified_detections || 0),
    visibility_rate: Number(value.visibility_rate || 0),
    visibility_rate_numerator: Number(value.visibility_rate_numerator || 0),
    visibility_rate_denominator: Number(value.visibility_rate_denominator || 0),
    last_checked_at: value.last_checked_at || null,
  };
}

async function main() {
  if (!shouldRun()) {
    marker("AI_CONTROL_CENTRE_STATE_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  required("SUPABASE_URL");
  required("SUPABASE_SERVICE_ROLE_KEY");
  const environment = {
    ...process.env,
    MARKETING_CUSTOMER_DATABASE_API_KEY: INTERNAL_ACCESS_KEY,
  };

  let statusCode = 200;
  let payload = null;
  const request = {
    method: "GET",
    query: { days: "28" },
    headers: { "x-marketing-customer-database-key": INTERNAL_ACCESS_KEY },
  };
  const response = {
    setHeader() {},
    status(code) { statusCode = code; return response; },
    json(body) { payload = body; return body; },
  };

  await handleAiControlCentreRequest(request, response, { environment });
  if (statusCode !== 200 || !payload) throw new Error(`AI Control Centre read failed with status ${statusCode}.`);

  marker("AI_CONTROL_CENTRE_STATE", {
    generated_at: payload.generated_at || null,
    days: payload.days || 28,
    assistant: assistantSummary(payload.assistant),
    assistant_active_users: payload.assistant_active_users || {},
    visibility: visibilitySummary(payload.visibility),
    opportunities: payload.opportunities || {},
    baselines: {
      latest: baselineSummary(payload.assistant_health_baseline),
      deterministic: baselineSummary(payload.assistant_health_baselines_by_mode?.deterministic),
      live: baselineSummary(payload.assistant_health_baselines_by_mode?.live),
    },
    rows_loaded: payload.rows_loaded || {},
  });
}

main().catch((error) => {
  console.error("AI_CONTROL_CENTRE_STATE_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
  }));
  process.exitCode = 1;
});
