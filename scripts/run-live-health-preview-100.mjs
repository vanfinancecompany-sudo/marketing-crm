import { createClient } from "@supabase/supabase-js";
import { runLiveHealthBatch } from "../api/marketing-ai-assistant-competence.js";
import { emptyHealthAccumulator, mergeHealthAccumulators, summariseHealth } from "../lib/aiAssistantHealth.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const TARGET_BRANCH = "agent/live-health-100-preview-baseline";
const TOTAL_CONVERSATIONS = 100;
const REQUESTED_BATCH_SIZE = 5;

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === TARGET_BRANCH;
}

function requireEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the live health validation.`);
  return value;
}

async function main() {
  if (!shouldRun()) {
    marker("LIVE_HEALTH_100_SKIPPED", {
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

  marker("LIVE_HEALTH_100_START", {
    conversations: TOTAL_CONVERSATIONS,
    requested_batch_size: REQUESTED_BATCH_SIZE,
    database_writes_expected: 0,
    customer_records_expected: 0,
    model: process.env.OPENAI_MODEL || null,
  });

  let accumulator = emptyHealthAccumulator("live");
  let startIndex = 0;
  let lastPayload = null;

  while (startIndex < TOTAL_CONVERSATIONS) {
    const payload = await runLiveHealthBatch(supabase, {
      start_index: startIndex,
      count: Math.min(REQUESTED_BATCH_SIZE, TOTAL_CONVERSATIONS - startIndex),
      total_conversations: TOTAL_CONVERSATIONS,
      confirm_live_validation: true,
    }, process.env);

    if (!payload?.batch?.count) throw new Error(`Live health batch at ${startIndex} returned no conversations.`);
    if (Number(payload.validation?.database_writes || 0) !== 0 || Number(payload.validation?.customer_records_created || 0) !== 0) {
      throw new Error(`Live health safety validation failed at batch ${startIndex}.`);
    }

    accumulator = mergeHealthAccumulators(accumulator, payload.report);
    startIndex += Number(payload.batch.count);
    lastPayload = payload;
    const summary = summariseHealth(accumulator);

    marker("LIVE_HEALTH_100_PROGRESS", {
      completed: startIndex,
      total: TOTAL_CONVERSATIONS,
      health_score: summary.overall_ai_health_score,
      rule_violations: summary.rule_violations,
      failed_scenarios: summary.failed_scenario_count,
      product_separation_accuracy: summary.product_separation_accuracy,
      knowledge_retrieval_accuracy: summary.knowledge_retrieval_accuracy,
      average_response_ms: summary.average_response_ms,
      input_tokens: summary.input_tokens,
      output_tokens: summary.output_tokens,
      estimated_cost_usd: summary.estimated_cost_usd,
    });
  }

  const report = {
    ...summariseHealth(accumulator),
    generated_at: lastPayload?.generated_at || new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA || lastPayload?.commit || null,
    validation: {
      ...(lastPayload?.validation || {}),
      database_writes: 0,
      customer_records_created: 0,
      sample_completed: TOTAL_CONVERSATIONS,
    },
  };

  marker("LIVE_HEALTH_100_SUMMARY", report);
}

main().catch((error) => {
  console.error("LIVE_HEALTH_100_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  }));
  process.exitCode = 1;
});
