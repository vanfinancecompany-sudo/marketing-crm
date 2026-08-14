import { createClient } from "@supabase/supabase-js";
import { runLiveHealthBatch } from "../api/marketing-ai-assistant-competence.js";
import { emptyHealthAccumulator, mergeHealthAccumulators, summariseHealth } from "../lib/aiAssistantHealth.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const TOTAL = 100;
const BATCH_SIZE = 2;
const PARALLEL_BATCHES = 3;

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "production"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === "main";
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the live health run.`);
  return value;
}

async function main() {
  if (!shouldRun()) {
    marker("LIVE_HEALTH_100_PRODUCTION_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  required("OPENAI_API_KEY");
  const supabase = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const permissionEnvironment = { ...process.env, VERCEL_ENV: "preview" };
  const starts = Array.from({ length: Math.ceil(TOTAL / BATCH_SIZE) }, (_, index) => index * BATCH_SIZE);
  let accumulator = emptyHealthAccumulator("live");
  let completed = 0;
  let lastPayload = null;

  marker("LIVE_HEALTH_100_PRODUCTION_START", {
    conversations: TOTAL,
    batch_size: BATCH_SIZE,
    parallel_batches: PARALLEL_BATCHES,
    database_writes_expected: 0,
    customer_records_expected: 0,
  });

  for (let cursor = 0; cursor < starts.length; cursor += PARALLEL_BATCHES) {
    const group = starts.slice(cursor, cursor + PARALLEL_BATCHES);
    const payloads = await Promise.all(group.map((startIndex) => runLiveHealthBatch(supabase, {
      start_index: startIndex,
      count: Math.min(BATCH_SIZE, TOTAL - startIndex),
      total_conversations: TOTAL,
      confirm_live_validation: true,
    }, permissionEnvironment)));

    for (const payload of payloads) {
      if (!payload?.batch?.count) throw new Error("A live health batch returned no conversations.");
      if (Number(payload.validation?.database_writes || 0) !== 0 || Number(payload.validation?.customer_records_created || 0) !== 0) {
        throw new Error("Live health write-safety validation failed.");
      }
      accumulator = mergeHealthAccumulators(accumulator, payload.report);
      completed += Number(payload.batch.count);
      lastPayload = payload;
    }

    const summary = summariseHealth(accumulator);
    marker("LIVE_HEALTH_100_PRODUCTION_PROGRESS", {
      completed,
      total: TOTAL,
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

  if (completed !== TOTAL) throw new Error(`Expected ${TOTAL} conversations but completed ${completed}.`);

  const report = {
    ...summariseHealth(accumulator),
    generated_at: lastPayload?.generated_at || new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA || lastPayload?.commit || null,
    validation: {
      ...(lastPayload?.validation || {}),
      database_writes: 0,
      customer_records_created: 0,
      sample_completed: TOTAL,
    },
  };

  marker("LIVE_HEALTH_100_PRODUCTION_SUMMARY", report);
}

main().catch((error) => {
  console.error("LIVE_HEALTH_100_PRODUCTION_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  }));
  process.exitCode = 1;
});
