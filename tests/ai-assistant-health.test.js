import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DETERMINISTIC_BATCH_LIMIT,
  LIVE_VALIDATION_MAX,
  LIVE_VALIDATION_MIN,
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
} from "../lib/aiAssistantHealth.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";
import { runDeterministicHealthBatch } from "../api/marketing-ai-assistant-competence.js";

function result(overrides = {}) {
  return {
    reply: "We can help with that. Applications are assessed and approval cannot be guaranteed.",
    product_context: "finance",
    detected_product: "finance",
    retrieval_required: true,
    retrieval_used: true,
    insufficient_knowledge: false,
    conflict_detected: false,
    human_handoff_recommended: false,
    repeated_disclaimer: false,
    sounded_article_like: false,
    one_question_at_a_time: true,
    repeated_assistant_wording: false,
    repeated_phrase_detected: false,
    contextual_resolution: "",
    knowledge_sources_used: [{ source_id: "finance-source", passage: "Finance applications are assessed." }],
    deterministic_rules_used: [],
    recommended_action: "continue",
    ...overrides,
  };
}

test("health constants cap deterministic and paid live samples", () => {
  assert.equal(MAX_DETERMINISTIC_CONVERSATIONS, 1000);
  assert.equal(DETERMINISTIC_BATCH_LIMIT, 100);
  assert.equal(LIVE_VALIDATION_MIN, 5);
  assert.equal(LIVE_VALIDATION_MAX, 20);
});

test("synthetic scenarios deterministically expand the real scenario library", () => {
  const first = syntheticScenarioAt(0);
  const repeated = syntheticScenarioAt(0);
  const wrapped = syntheticScenarioAt(REAL_CUSTOMER_SCENARIOS.length);
  assert.deepEqual(first, repeated);
  assert.notEqual(first.id, wrapped.id);
  assert.equal(first.source_scenario_id, wrapped.source_scenario_id);
  assert.equal(first.product_context, wrapped.product_context);
});

test("representative paid sample is deterministic and bounded", () => {
  const sample = Array.from({ length: 10 }, (_, index) => representativeScenarioAt(index, 10));
  assert.equal(sample.length, 10);
  assert.equal(new Set(sample.map((item) => item.id)).size, 10);
  assert.deepEqual(sample, Array.from({ length: 10 }, (_, index) => representativeScenarioAt(index, 10)));
});

test("deterministic evidence reply uses only supplied evidence and never calls OpenAI", () => {
  const response = deterministicEvidenceReply([
    { source_id: "finance-source", title: "Finance", heading: "Approval", passage: "Applications are assessed and approval cannot be guaranteed." },
  ], "finance");
  assert.match(response.reply, /Applications are assessed/i);
  assert.equal(response.confidence, 100);
  assert.deepEqual(response.source_ids, ["S1"]);
});

test("conversation evaluator detects product separation, hallucination and recovery failures", () => {
  const scenario = { id: "H-1", source_scenario_id: "S-1", product_context: "finance", messages: ["Can I apply?"] };
  const evaluated = evaluateHealthConversation({
    scenario,
    mode: "deterministic",
    turns: [{
      message: "Can I apply?",
      result: result({ reply: "Rent2Buy is guaranteed and the van is definitely in stock.", detected_product: "rent2buy", insufficient_knowledge: true, human_handoff_recommended: false }),
    }],
  });
  const rules = evaluated.failures.map((failure) => failure.rule);
  assert.ok(rules.includes("product_separation"));
  assert.ok(rules.includes("unsafe_promise"));
});

test("summary converts accumulated checks into dashboard percentages", () => {
  let accumulator = emptyHealthAccumulator("deterministic");
  accumulator = addHealthConversation(accumulator, evaluateHealthConversation({
    scenario: { id: "A", source_scenario_id: "A", product_context: "finance", messages: ["hello"] },
    mode: "deterministic",
    turns: [{ message: "hello", result: result({ retrieval_required: false, retrieval_used: false }) }],
  }));
  accumulator = addHealthConversation(accumulator, evaluateHealthConversation({
    scenario: { id: "B", source_scenario_id: "B", product_context: "finance", messages: ["Can I apply?"] },
    mode: "deterministic",
    turns: [{ message: "Can I apply?", result: result() }],
  }));
  const summary = summariseHealth(accumulator);
  assert.equal(summary.total_conversations, 2);
  assert.equal(summary.total_turns, 2);
  assert.ok(summary.overall_ai_health_score >= 0 && summary.overall_ai_health_score <= 100);
  assert.equal(typeof summary.product_separation_accuracy, "number");
  assert.equal(typeof summary.knowledge_retrieval_accuracy, "number");
});

test("pricing estimator is explicit and configurable", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  assert.equal(estimateOpenAICost(usage, {}), null);
  assert.equal(estimateOpenAICost(usage, { OPENAI_INPUT_COST_PER_MILLION_USD: "2", OPENAI_OUTPUT_COST_PER_MILLION_USD: "8" }), 10);
});

test("live validation is Preview-only and requires the OpenAI key", () => {
  assert.equal(liveValidationAllowed({ VERCEL_ENV: "production", OPENAI_API_KEY: "x" }), false);
  assert.equal(liveValidationAllowed({ VERCEL_ENV: "preview", OPENAI_API_KEY: "" }), false);
  assert.equal(liveValidationAllowed({ VERCEL_ENV: "preview", OPENAI_API_KEY: "x" }), true);
});

test("health accumulator merges batch summaries without losing denominator counts", () => {
  const a = summariseHealth(addHealthConversation(emptyHealthAccumulator(), evaluateHealthConversation({ scenario: { id: "A", source_scenario_id: "A", product_context: "finance", messages: ["hello"] }, turns: [{ message: "hello", result: result({ retrieval_required: false, retrieval_used: false }) }] })));
  const b = summariseHealth(addHealthConversation(emptyHealthAccumulator(), evaluateHealthConversation({ scenario: { id: "B", source_scenario_id: "B", product_context: "rent2buy", messages: ["hello"] }, turns: [{ message: "hello", result: result({ product_context: "rent2buy", detected_product: "rent2buy", retrieval_required: false, retrieval_used: false, knowledge_sources_used: [] }) }] })));
  const merged = mergeHealthAccumulators(a, b);
  assert.equal(merged.total_conversations, 2);
  assert.equal(merged.total_turns, 2);
});

test("full deterministic run preserves corrected product separation and retrieval rules", async () => {
  const content = `Finance and Rent2Buy customer guidance. Applications are assessed and approval cannot be guaranteed. Finance delivery is available across England, Wales and Scotland. Rent2Buy collection is from Southampton. Customers can ask about documents, deposit, servicing, warranty, mileage and vehicle choice. Approval is subject to assessment. Delivery timing and vehicle availability must be confirmed.`;
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
  const productFailures = report.failed_scenarios.filter((item) => item.failures.some((failure) => failure.rule === "product_separation"));
  assert.ok(report.overall_ai_health_score >= 97, `health score ${report.overall_ai_health_score}`);
  assert.equal(report.product_separation_accuracy, 100, JSON.stringify(productFailures));
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
  assert.match(app, /ai-assistant-health/);
  assert.match(navigation, /AI Health/);
});
