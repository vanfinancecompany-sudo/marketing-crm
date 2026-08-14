import { createClient } from "@supabase/supabase-js";
import { runDeterministicHealthBatch } from "../api/marketing-ai-assistant-competence.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const TARGET_SCENARIOS = [
  "RC-081",
  "RC-086",
  "V3-002",
  "V3-053",
  "V3-068",
  "V3-071",
  "V3-076",
  "V3-093",
  "V3-094",
  "V3-099",
  "V5-043",
  "POLISH-077",
  "POLISH-094",
  "POLISH-095",
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
  if (!value) throw new Error(`${name} is required for the targeted product diagnostic.`);
  return value;
}

async function main() {
  if (!shouldRun()) {
    marker("BASELINE_PRODUCT_DIAGNOSTIC_SKIPPED", {
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

  const results = [];
  for (const sourceScenarioId of TARGET_SCENARIOS) {
    const index = REAL_CUSTOMER_SCENARIOS.findIndex((scenario) => scenario.id === sourceScenarioId);
    if (index < 0) throw new Error(`Target scenario ${sourceScenarioId} was not found.`);
    const scenario = REAL_CUSTOMER_SCENARIOS[index];
    const payload = await runDeterministicHealthBatch(supabase, {
      start_index: index,
      count: 1,
      total_conversations: REAL_CUSTOMER_SCENARIOS.length,
    });
    if (Number(payload.validation?.openai_calls || 0) !== 0 || Number(payload.validation?.database_writes || 0) !== 0) {
      throw new Error(`Safety validation failed for ${sourceScenarioId}.`);
    }
    const failures = payload.report.failed_scenarios?.[0]?.failures || [];
    const item = {
      source_scenario_id: sourceScenarioId,
      scenario_name: scenario.name,
      category: scenario.category,
      product_context: scenario.product_context,
      messages: scenario.messages,
      health_score: payload.report.overall_ai_health_score,
      product_separation_accuracy: payload.report.product_separation_accuracy,
      rule_violations: payload.report.rule_violations,
      product_failures: failures.filter((failure) => failure.rule === "product_separation"),
      other_failures: failures.filter((failure) => failure.rule !== "product_separation"),
    };
    results.push(item);
    marker("BASELINE_PRODUCT_DIAGNOSTIC_SCENARIO", item);
  }

  const failing = results.filter((item) => item.product_failures.length);
  marker("BASELINE_PRODUCT_DIAGNOSTIC_SUMMARY", {
    scenarios_checked: results.length,
    scenarios_clear: results.length - failing.length,
    scenarios_still_failing: failing.length,
    remaining_product_violations: failing.reduce((sum, item) => sum + item.product_failures.length, 0),
    failing_scenario_ids: failing.map((item) => item.source_scenario_id),
  });
}

main().catch((error) => {
  console.error("BASELINE_PRODUCT_DIAGNOSTIC_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  }));
  process.exitCode = 1;
});
