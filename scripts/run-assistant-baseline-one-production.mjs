import { createClient } from "@supabase/supabase-js";
import { runDeterministicHealthBatch } from "../api/marketing-ai-assistant-competence.js";
import {
  DETERMINISTIC_BATCH_LIMIT,
  emptyHealthAccumulator,
  mergeHealthAccumulators,
  summariseHealth,
} from "../lib/aiAssistantHealth.js";
import { normaliseHealthBaselineInput } from "../api/marketing-ai-control-centre.js";

const TOTAL_CONVERSATIONS = 10000;
const SOURCE_MAIN_COMMIT = "7fe4e8b2b5bb0d1396d71b5b45b71c3702195023";

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "production"
    && process.env.VERCEL_GIT_COMMIT_REF === "main";
}

function requireEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the production Baseline One runner.`);
  return value;
}

function addDiagnostics(diagnostics, report) {
  for (const scenario of report?.failed_scenarios || []) {
    const sourceId = scenario.source_scenario_id || scenario.scenario_id || "unknown";
    diagnostics.failed_source_scenarios[sourceId] = (diagnostics.failed_source_scenarios[sourceId] || 0) + 1;
    const category = scenario.category || "unknown";
    diagnostics.failed_categories[category] = (diagnostics.failed_categories[category] || 0) + 1;
    const product = scenario.product_context || "unknown";
    diagnostics.failed_products[product] = (diagnostics.failed_products[product] || 0) + 1;
    for (const failure of scenario.failures || []) {
      const rule = failure.rule || "unknown";
      diagnostics.rule_counts[rule] = (diagnostics.rule_counts[rule] || 0) + 1;
      if (!diagnostics.examples[rule]) {
        diagnostics.examples[rule] = {
          source_scenario_id: sourceId,
          scenario_name: scenario.name,
          category,
          product_context: product,
          turn: failure.turn,
          message: failure.message,
          detail: failure.detail,
        };
      }
    }
  }
}

async function main() {
  if (!shouldRun()) {
    marker("BASELINE_ONE_PRODUCTION_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
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
    .limit(100);
  if (existingResult.error) throw new Error(`Could not inspect Assistant Health baselines: ${existingResult.error.message}`);
  const existingRows = Array.isArray(existingResult.data) ? existingResult.data : [];
  const existing = existingRows.find((item) => item.mode === "deterministic" && Number(item.conversations) === TOTAL_CONVERSATIONS);

  if (existing) {
    marker("BASELINE_ONE_ALREADY_EXISTS", {
      id: existing.id,
      name: existing.name,
      commit_sha: existing.commit_sha,
      conversations: existing.conversations,
      turns: existing.turns,
      score: existing.overall_ai_health_score,
      created_at: existing.created_at,
    });
    marker("BASELINE_ONE_SUMMARY", existing.report || {});
    return;
  }

  marker("BASELINE_ONE_START", {
    conversations: TOTAL_CONVERSATIONS,
    batch_size: DETERMINISTIC_BATCH_LIMIT,
    source_main_commit: SOURCE_MAIN_COMMIT,
    existing_baselines: existingRows.length,
  });

  let accumulator = emptyHealthAccumulator("deterministic");
  let lastPayload = null;
  const diagnostics = {
    rule_counts: {},
    failed_source_scenarios: {},
    failed_categories: {},
    failed_products: {},
    examples: {},
  };

  for (let start = 0; start < TOTAL_CONVERSATIONS; start += DETERMINISTIC_BATCH_LIMIT) {
    const payload = await runDeterministicHealthBatch(supabase, {
      start_index: start,
      count: Math.min(DETERMINISTIC_BATCH_LIMIT, TOTAL_CONVERSATIONS - start),
      total_conversations: TOTAL_CONVERSATIONS,
    });
    accumulator = mergeHealthAccumulators(accumulator, payload.report);
    addDiagnostics(diagnostics, payload.report);
    lastPayload = payload;
    const completed = Math.min(TOTAL_CONVERSATIONS, start + payload.batch.count);
    if (completed % 1000 === 0 || completed === TOTAL_CONVERSATIONS) {
      const partial = summariseHealth(accumulator);
      marker("BASELINE_ONE_PROGRESS", {
        completed,
        total: TOTAL_CONVERSATIONS,
        score: partial.overall_ai_health_score,
        rule_violations: partial.rule_violations,
        failed_scenarios: partial.failed_scenario_count,
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
  const payload = normaliseHealthBaselineInput(
    { name: `Baseline ${sequence} · Deterministic`, mode: "deterministic", report },
    { ...process.env, VERCEL_GIT_COMMIT_SHA: SOURCE_MAIN_COMMIT },
  );
  const saved = await supabase
    .from("ai_assistant_health_baselines")
    .insert(payload)
    .select("id,name,mode,commit_sha,conversations,turns,overall_ai_health_score,generated_at,created_at")
    .single();
  if (saved.error) throw new Error(`Baseline One could not be saved: ${saved.error.message}`);

  marker("BASELINE_ONE_SAVED", saved.data);
  marker("BASELINE_ONE_DIAGNOSTICS", diagnostics);
  marker("BASELINE_ONE_SUMMARY", report);
}

main().catch((error) => {
  console.error("BASELINE_ONE_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  }));
  process.exitCode = 1;
});
