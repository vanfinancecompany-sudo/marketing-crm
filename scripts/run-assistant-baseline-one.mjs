import { createClient } from "@supabase/supabase-js";
import { runDeterministicHealthBatch } from "../api/marketing-ai-assistant-competence.js";
import {
  DETERMINISTIC_BATCH_LIMIT,
  emptyHealthAccumulator,
  mergeHealthAccumulators,
  summariseHealth,
} from "../lib/aiAssistantHealth.js";
import { normaliseHealthBaselineInput } from "../api/marketing-ai-control-centre.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const TARGET_BRANCH = "agent/run-assistant-baseline-one";
const SOURCE_MAIN_COMMIT = "7fe4e8b2b5bb0d1396d71b5b45b71c3702195023";
const TOTAL_CONVERSATIONS = 10000;

function logMarker(marker, payload = {}) {
  console.log(`${marker} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === TARGET_BRANCH;
}

function requireEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the protected Baseline One build runner.`);
  return value;
}

function conciseReport(report) {
  return {
    mode: report.mode,
    conversations: report.conversations,
    turns: report.turns,
    overall_ai_health_score: report.overall_ai_health_score,
    conversation_progression: report.conversation_progression,
    context_retention: report.context_retention,
    product_separation_accuracy: report.product_separation_accuracy,
    knowledge_retrieval_accuracy: report.knowledge_retrieval_accuracy,
    application_progression_accuracy: report.application_progression_accuracy,
    recovery_success: report.recovery_success,
    missed_application_opportunities: report.missed_application_opportunities,
    repeated_wording_rate: report.repeated_wording_rate,
    clarification_rate: report.clarification_rate,
    average_response_length_words: report.average_response_length_words,
    rule_violations: report.rule_violations,
    failed_scenario_count: report.failed_scenario_count,
    product_results: report.product_results,
    category_results: report.category_results,
    validation: report.validation,
    commit: report.commit,
    generated_at: report.generated_at,
  };
}

async function main() {
  if (!shouldRun()) {
    logMarker("BASELINE_ONE_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  const supabaseUrl = requireEnvironment("SUPABASE_URL");
  const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const existingResult = await supabase
    .from("ai_assistant_health_baselines")
    .select("id,name,mode,commit_sha,conversations,turns,overall_ai_health_score,report,validation,generated_at,created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (existingResult.error) {
    throw new Error(`Could not inspect Assistant Health baselines: ${existingResult.error.message}`);
  }

  const existingRows = Array.isArray(existingResult.data) ? existingResult.data : [];
  const existingFullDeterministic = existingRows.find((item) => item.mode === "deterministic" && Number(item.conversations) === TOTAL_CONVERSATIONS);
  if (existingFullDeterministic) {
    logMarker("BASELINE_ONE_ALREADY_EXISTS", {
      id: existingFullDeterministic.id,
      name: existingFullDeterministic.name,
      commit_sha: existingFullDeterministic.commit_sha,
      conversations: existingFullDeterministic.conversations,
      overall_ai_health_score: existingFullDeterministic.overall_ai_health_score,
      created_at: existingFullDeterministic.created_at,
    });
    logMarker("BASELINE_ONE_SUMMARY", conciseReport(existingFullDeterministic.report || {}));
    for (const failed of existingFullDeterministic.report?.failed_scenarios || []) {
      logMarker("BASELINE_ONE_FAILURE", failed);
    }
    return;
  }

  logMarker("BASELINE_ONE_START", {
    conversations: TOTAL_CONVERSATIONS,
    batch_size: DETERMINISTIC_BATCH_LIMIT,
    source_main_commit: SOURCE_MAIN_COMMIT,
    existing_baselines: existingRows.length,
  });

  let accumulator = emptyHealthAccumulator("deterministic");
  let lastPayload = null;

  for (let start = 0; start < TOTAL_CONVERSATIONS; start += DETERMINISTIC_BATCH_LIMIT) {
    const payload = await runDeterministicHealthBatch(supabase, {
      start_index: start,
      count: Math.min(DETERMINISTIC_BATCH_LIMIT, TOTAL_CONVERSATIONS - start),
      total_conversations: TOTAL_CONVERSATIONS,
    });
    accumulator = mergeHealthAccumulators(accumulator, payload.report);
    lastPayload = payload;
    const completed = Math.min(TOTAL_CONVERSATIONS, start + payload.batch.count);
    if (completed % 1000 === 0 || completed === TOTAL_CONVERSATIONS) {
      logMarker("BASELINE_ONE_PROGRESS", {
        completed,
        total: TOTAL_CONVERSATIONS,
        current_health: summariseHealth(accumulator).overall_ai_health_score,
      });
    }
  }

  const report = {
    ...summariseHealth(accumulator),
    generated_at: lastPayload?.generated_at || new Date().toISOString(),
    commit: SOURCE_MAIN_COMMIT,
    validation: lastPayload?.validation || {
      openai_calls: 0,
      database_writes: 0,
      geocoding_calls: 0,
    },
  };

  if (report.mode !== "deterministic") throw new Error(`Unexpected Baseline One mode: ${report.mode}`);
  if (Number(report.conversations) !== TOTAL_CONVERSATIONS) throw new Error(`Baseline One completed ${report.conversations} conversations instead of ${TOTAL_CONVERSATIONS}.`);
  if (Number(report.validation?.openai_calls || 0) !== 0) throw new Error("Deterministic Baseline One unexpectedly recorded OpenAI calls.");
  if (Number(report.validation?.database_writes || 0) !== 0) throw new Error("Deterministic validation unexpectedly recorded database writes before baseline save.");

  const sequence = existingRows.length + 1;
  const name = `Baseline ${sequence} · Deterministic`;
  const payload = normaliseHealthBaselineInput(
    { name, mode: "deterministic", report },
    { ...process.env, VERCEL_GIT_COMMIT_SHA: SOURCE_MAIN_COMMIT },
  );

  const saveResult = await supabase
    .from("ai_assistant_health_baselines")
    .insert(payload)
    .select("id,name,mode,commit_sha,conversations,turns,overall_ai_health_score,generated_at,created_at")
    .single();

  if (saveResult.error) throw new Error(`Baseline One could not be saved: ${saveResult.error.message}`);

  logMarker("BASELINE_ONE_SAVED", saveResult.data);
  logMarker("BASELINE_ONE_SUMMARY", conciseReport(report));
  for (const failed of report.failed_scenarios || []) {
    logMarker("BASELINE_ONE_FAILURE", failed);
  }
}

main().catch((error) => {
  console.error("BASELINE_ONE_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  }));
  process.exitCode = 1;
});
