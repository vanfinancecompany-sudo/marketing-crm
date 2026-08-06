import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_DETERMINISTIC_CONVERSATIONS,
  addHealthConversation,
  deterministicEvidenceReply,
  emptyHealthAccumulator,
  estimateOpenAICost,
  evaluateHealthConversation,
  liveValidationAllowed,
  mergeHealthAccumulators,
  representativeScenarioAt,
  summariseHealth,
  syntheticScenarioAt,
  unsafePromiseDetected,
} from "../lib/aiAssistantHealth.js";
import { runDeterministicHealthBatch, runLiveHealthBatch } from "../api/marketing-ai-assistant-competence.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";

const scenario = { id: "fixture-1", name: "Finance fixture", category: "health", product_context: "finance", messages: ["Need a van", "Ready to apply"] };

function result(overrides = {}) {
  return {
    reply: "No problem. We can help you take the next step.",
    remembered_facts: { vehicle: "van" },
    updated_facts: {},
    knowledge_sources_used: [],
    retrieval_required: false,
    retrieval_used: false,
    insufficient_knowledge: false,
    cta_timing_eligible: false,
    application_mode_active: false,
    application_cta_generated: false,
    conversation_progressing: true,
    recovery_required: false,
    recovery_rule_used: false,
    response_word_count: 10,
    repeated_assistant_wording: false,
    repeated_phrase_detected: false,
    clarification_required: false,
    response_time_ms: 20,
    token_usage: { input_tokens: 0, output_tokens: 0 },
    estimated_cost_usd: 0,
    ...overrides,
  };
}

test("synthetic engine deterministically expands the existing library to 10,000 conversations", () => {
  assert.equal(MAX_DETERMINISTIC_CONVERSATIONS, 10000);
  assert.deepEqual(syntheticScenarioAt(0), syntheticScenarioAt(0));
  assert.equal(syntheticScenarioAt(9999).synthetic_index, 9999);
  assert.notEqual(syntheticScenarioAt(0, [scenario]).id, syntheticScenarioAt(1, [scenario]).id);
});

test("representative live sampling is stable and spans the scenario library", () => {
  const first = representativeScenarioAt(0, 50);
  const last = representativeScenarioAt(49, 50);
  assert.equal(first.synthetic_index, 0);
  assert.ok(last.synthetic_index > 500);
  assert.notEqual(first.source_scenario_id, last.source_scenario_id);
});

test("deterministic evidence response uses approved evidence without model generation", () => {
  const response = deterministicEvidenceReply([{ passage: "Approved Finance coverage rule: Finance covers England. Do not mention Rent2Buy." }], "finance");
  assert.equal(response.source_ids[0], "S1");
  assert.match(response.reply, /Finance covers England/);
  assert.doesNotMatch(response.reply, /Do not mention/);
});

test("unsafe promise detection distinguishes a promise from explicit non-guarantee wording", () => {
  assert.equal(unsafePromiseDetected("You will be approved."), true);
  assert.equal(unsafePromiseDetected("We guarantee approval."), true);
  assert.equal(unsafePromiseDetected("There is no guaranteed approval."), false);
  assert.equal(unsafePromiseDetected("Approval cannot be guaranteed and depends on assessment."), false);
  assert.equal(unsafePromiseDetected("We do not promise delivery tomorrow."), false);
});

test("explicit comparison evidence is not misreported as a product-separation leak", () => {
  const comparison = evaluateHealthConversation({ scenario, turns: [
    { message: "Compare Finance and Rent2Buy", result: result({ reply: "Finance and Rent2Buy are different routes.", knowledge_sources_used: [{ type: "article", category: "Rent2Buy", title: "Rent2Buy" }] }) },
  ] });
  assert.equal(comparison.failures.some((item) => item.rule === "product_separation"), false);
});

test("health evaluation reports product, retrieval, context, application and recovery checks", () => {
  const evaluated = evaluateHealthConversation({ scenario, turns: [
    { message: "Need a van", result: result() },
    { message: "Ready to apply", result: result({ application_mode_active: true, application_cta_generated: true, application_cta: { product: "finance" }, remembered_facts: { vehicle: "van" } }) },
    { message: "Is it insured?", result: result({ retrieval_required: true, retrieval_used: true, knowledge_sources_used: [{ type: "article", category: "Finance", title: "Insurance", matched_terms: ["insured"] }], remembered_facts: { vehicle: "van" } }) },
    { message: "?", result: result({ recovery_required: true, recovery_rule_used: true, remembered_facts: { vehicle: "van" } }) },
  ] });
  assert.equal(evaluated.failures.length, 0);
  assert.equal(evaluated.checks.context_retention.passed, 3);
  assert.equal(evaluated.checks.product_separation.passed, 5);
  assert.equal(evaluated.checks.knowledge_retrieval.passed, 1);
  assert.equal(evaluated.checks.application_progression.passed, 1);
  assert.equal(evaluated.checks.recovery_success.passed, 1);
});

test("cross-product sources and missed application CTAs fail deterministically", () => {
  const evaluated = evaluateHealthConversation({ scenario, turns: [
    { message: "Ready to apply", result: result({ cta_timing_eligible: true, knowledge_sources_used: [{ type: "article", category: "Rent2Buy", title: "Wrong product" }] }) },
  ] });
  assert.equal(evaluated.missed_application_opportunities, 1);
  assert.equal(evaluated.rule_violations, 2);
  assert.deepEqual(evaluated.failures.map((item) => item.rule).sort(), ["application_progression", "product_separation"]);
});

test("batch accumulators merge without losing counts and produce a bounded score", () => {
  const evaluated = evaluateHealthConversation({ scenario, turns: [{ message: "Need a van", result: result() }] });
  const one = addHealthConversation(emptyHealthAccumulator(), evaluated);
  const merged = mergeHealthAccumulators(one, one);
  const summary = summariseHealth(merged);
  assert.equal(summary.conversations, 2);
  assert.equal(summary.turns, 2);
  assert.ok(summary.overall_ai_health_score >= 0 && summary.overall_ai_health_score <= 100);
});

test("live validation is Preview-only with an explicit non-production local test escape hatch", () => {
  assert.equal(liveValidationAllowed({ VERCEL_ENV: "preview" }), true);
  assert.equal(liveValidationAllowed({ VERCEL_ENV: "production" }), false);
  assert.equal(liveValidationAllowed({ NODE_ENV: "test", AI_HEALTH_ALLOW_LOCAL_LIVE: "true" }), true);
  assert.equal(liveValidationAllowed({ NODE_ENV: "production", AI_HEALTH_ALLOW_LOCAL_LIVE: "true" }), false);
});

test("production rejects live validation before loading knowledge or calling OpenAI", async () => {
  await assert.rejects(
    runLiveHealthBatch({}, { total_conversations: 50, start_index: 0, count: 1, confirm_live_validation: true }, { VERCEL_ENV: "production" }),
    /only on protected Preview deployments/,
  );
});

test("cost estimates require reviewed server-side input and output rates", () => {
  assert.equal(estimateOpenAICost({ input_tokens: 1000, output_tokens: 500 }, {}), null);
  assert.equal(estimateOpenAICost({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, { OPENAI_INPUT_COST_PER_MILLION_USD: "1", OPENAI_OUTPUT_COST_PER_MILLION_USD: "4" }), 5);
});

test("protected health endpoint is write-free and deterministic mode never calls OpenAI", async () => {
  const api = await readFile(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const healthSlice = api.slice(api.indexOf("function deterministicHealthCoverage"), api.indexOf("async function startRun"));
  assert.match(healthSlice, /persist:\s*false/);
  assert.match(healthSlice, /generationMode:\s*"deterministic"/);
  assert.match(healthSlice, /openai_calls:\s*0/);
  assert.match(healthSlice, /database_writes:\s*0/);
  assert.doesNotMatch(healthSlice, /\.insert\(|\.upsert\(|createCustomer|customer_records.*insert/i);
});

test("deterministic server batch executes the real orchestration path without writes", async () => {
  let writes = 0;
  const tableData = {
    knowledge_settings: { finance_covered_nations: ["England", "Wales", "Scotland"] },
    knowledge_business_sections: [],
    knowledge_articles: [],
  };
  const supabase = { from(table) {
    const query = {
      select() { return query; },
      eq() { return query; },
      order() { return Promise.resolve({ data: tableData[table] || [], error: null }); },
      maybeSingle() { return Promise.resolve({ data: tableData[table] || null, error: null }); },
      insert() { writes += 1; throw new Error("Health validation must not write."); },
      upsert() { writes += 1; throw new Error("Health validation must not write."); },
    };
    return query;
  } };
  const payload = await runDeterministicHealthBatch(supabase, { start_index: 0, count: 1, total_conversations: 1 });
  assert.equal(payload.report.conversations, 1);
  assert.equal(payload.validation.openai_calls, 0);
  assert.equal(payload.validation.database_writes, 0);
  assert.equal(writes, 0);
});

test("the complete deterministic scenario library clears corrected failure classes above 97 health", async () => {
  const content = `# Applications and eligibility

Application eligibility, next steps, self-employed and limited-company trading, poor credit, declined applications, documents, bank statements, licences, deposits, budgets, monthly payments, costs, affordability and accounts.

# Vehicles and service

Vans and vehicles including Transit Custom, Sprinter, tipper, electric, large, medium and small vans. Insurance, vehicle tax, warranty, mileage, collection, delivery and location coverage.

# Safety

Approval is subject to assessment. Delivery timing and vehicle availability must be confirmed.`;
  const articles = ["Van Finance", "Rent2Buy"].map((category, index) => ({ id: `health-${index}`, title: `${category} applications, vehicles and customer guidance`, category, content_markdown: content, faq_json: [], status: "approved", is_active: true }));
  const tableData = {
    knowledge_settings: { finance_covered_nations: ["England", "Wales", "Scotland"], rent2buy_base_postcode: "SO40 2NN", rent2buy_max_radius_miles: 100, coverage_borderline_tolerance_miles: 10, coverage_distance_method: "straight_line" },
    knowledge_business_sections: [],
    knowledge_articles: articles,
  };
  const supabase = { from(table) {
    const query = {
      select() { return query; },
      eq() { return query; },
      order() { return Promise.resolve({ data: tableData[table] || [], error: null }); },
      maybeSingle() { return Promise.resolve({ data: tableData[table] || null, error: null }); },
      insert() { throw new Error("Deterministic health validation must remain write-free."); },
    };
    return query;
  } };
  let accumulator = emptyHealthAccumulator();
  for (let start = 0; start < REAL_CUSTOMER_SCENARIOS.length; start += 100) {
    const batch = await runDeterministicHealthBatch(supabase, { start_index: start, count: Math.min(100, REAL_CUSTOMER_SCENARIOS.length - start), total_conversations: REAL_CUSTOMER_SCENARIOS.length });
    accumulator = mergeHealthAccumulators(accumulator, batch.report);
  }
  const report = summariseHealth(accumulator);
  const correctedRules = new Set(["product_separation", "knowledge_retrieval", "unsafe_promise", "awkward_clarification"]);
  const correctedFailures = report.failed_scenarios.flatMap((item) => item.failures).filter((item) => correctedRules.has(item.rule));
  assert.ok(report.overall_ai_health_score >= 97, `health score ${report.overall_ai_health_score}`);
  assert.equal(report.product_separation_accuracy, 100);
  assert.equal(report.knowledge_retrieval_accuracy, 100);
  assert.deepEqual(correctedFailures, []);
});

test("dashboard uses no-store protected service and is wired into internal navigation", async () => {
  const [service, page, app, navigation] = await Promise.all([
    readFile(new URL("../services/aiAssistantCompetence.js", import.meta.url), "utf8"),
    readFile(new URL("../pages/AIAssistantHealthPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../public/shared/sidebar-navigation.js", import.meta.url), "utf8"),
  ]);
  assert.match(service, /cache:\s*"no-store"/);
  assert.match(page, /validateMarketingAccessKey/);
  assert.match(page, /runDeterministicHealthBatch/);
  assert.match(page, /runLiveHealthBatch/);
  assert.match(app, /AIAssistantHealthPage/);
  assert.match(navigation, /ai-assistant-health/);
});

test("health configuration never returns keys or accepts browser-selected models", async () => {
  const api = await readFile(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const config = api.slice(api.indexOf("function loadHealthConfiguration"), api.indexOf("async function startRun"));
  assert.doesNotMatch(config, /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(config, /body\.model|requested_model/);
});
