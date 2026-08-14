import { createClient } from "@supabase/supabase-js";
import { simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";
import { addHealthConversation, emptyHealthAccumulator, evaluateHealthConversation, summariseHealth } from "../lib/aiAssistantHealth.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const CASES = [
  {
    id: "LIVE-SMOKE-FINANCE",
    product_context: "finance",
    message: "What documents do I need for a van finance application?",
  },
  {
    id: "LIVE-SMOKE-RENT2BUY",
    product_context: "rent2buy",
    message: "Does Rent2Buy require a credit check?",
  },
];

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "production"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === "main";
}

function requireEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the live health smoke test.`);
  return value;
}

async function main() {
  if (!shouldRun()) {
    marker("LIVE_HEALTH_PRODUCTION_SMOKE_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  const supabase = createClient(
    requireEnvironment("SUPABASE_URL"),
    requireEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  requireEnvironment("OPENAI_API_KEY");

  marker("LIVE_HEALTH_FACTUAL_SMOKE_START", {
    conversations: CASES.length,
    database_writes_expected: 0,
    customer_records_expected: 0,
  });

  let accumulator = emptyHealthAccumulator("live");
  for (const testCase of CASES) {
    const response = await simulateCustomerConversation(supabase, {
      request_id: `health-${testCase.id}`,
      session_id: `health-${testCase.id}`,
      scenario_id: testCase.id,
      message: testCase.message,
      product_context: testCase.product_context,
      messages: [],
      remembered_facts: {},
      journey_state: {},
    }, {
      persist: false,
      generationMode: "live",
    });

    const evaluated = evaluateHealthConversation({
      scenario: {
        id: testCase.id,
        source_scenario_id: testCase.id,
        name: testCase.id,
        category: "live_factual_smoke",
        product_context: testCase.product_context,
        messages: [testCase.message],
      },
      turns: [{ message: testCase.message, result: response.result }],
      mode: "live",
    });
    accumulator = addHealthConversation(accumulator, evaluated);

    marker("LIVE_HEALTH_FACTUAL_SMOKE_CASE", {
      id: testCase.id,
      product_context: testCase.product_context,
      question: testCase.message,
      model: response.result.model,
      model_route: response.result.model_route,
      token_usage: response.result.token_usage,
      estimated_cost_usd: response.result.estimated_cost_usd,
      response_time_ms: response.result.response_time_ms,
      retrieval_time_ms: response.result.retrieval_time_ms,
      generation_time_ms: response.result.generation_time_ms,
      retrieval_performed: response.result.retrieval_performed,
      knowledge_source_ids: response.result.knowledge_source_ids,
      sources: (response.result.knowledge_sources_used || []).map((source) => ({
        type: source.type,
        title: source.title,
        heading: source.heading,
        category: source.category || source.product || null,
      })),
      reply: String(response.result.reply || "").slice(0, 500),
      rule_violations: evaluated.rule_violations,
      failures: evaluated.failures,
    });
  }

  marker("LIVE_HEALTH_FACTUAL_SMOKE_SUMMARY", summariseHealth(accumulator));
}

main().catch((error) => {
  console.error("LIVE_HEALTH_PRODUCTION_SMOKE_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  }));
  process.exitCode = 1;
});
