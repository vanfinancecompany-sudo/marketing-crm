import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHealthConversation } from "../lib/aiAssistantHealth.js";
import { filterKnowledgeForProduct, isExplicitProductComparison } from "../lib/aiAssistantCompetence.js";

const result = (overrides = {}) => ({
  reply: "I can help with the current product.",
  remembered_facts: {},
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
  response_word_count: 8,
  repeated_assistant_wording: false,
  repeated_phrase_detected: false,
  clarification_required: false,
  response_time_ms: 1,
  token_usage: { input_tokens: 0, output_tokens: 0 },
  estimated_cost_usd: 0,
  ...overrides,
});

const financeScenario = { id: "finance", name: "Finance product separation", category: "sales_product_lock", product_context: "finance", messages: [] };
const rent2buyScenario = { ...financeScenario, id: "rent2buy", name: "Rent2Buy product separation", product_context: "rent2buy" };

function productFailures(evaluated) {
  return evaluated.failures.filter((item) => item.rule === "product_separation");
}

test("natural comparison wording recognises Baseline One Finance versus Rent2Buy phrasing", () => {
  for (const wording of [
    "Is Finance better than Rent2Buy?",
    "Finance or Rent2Buy?",
    "Which is better, Finance or Rent2Buy?",
    "What is different about Finance and Rent2Buy?",
  ]) {
    assert.equal(isExplicitProductComparison(wording), true, wording);
  }
  assert.equal(isExplicitProductComparison("Does Rent2Buy require a credit check?"), false);
  assert.equal(isExplicitProductComparison("I have poor credit. Is it still worth applying?"), false);
});

test("natural comparison wording deliberately unlocks both product knowledge pools", () => {
  const knowledge = {
    sections: [],
    articles: [
      { id: "finance", title: "Finance", category: "Van Finance" },
      { id: "rent", title: "Rent2Buy", category: "Rent2Buy" },
    ],
  };
  const comparison = isExplicitProductComparison("Is Finance better than Rent2Buy?");
  const bounded = filterKnowledgeForProduct(knowledge, "finance", { comparison });
  assert.deepEqual(bounded.articles.map((article) => article.id), ["finance", "rent"]);
  assert.match(bounded.categoryFilter, /both product categories allowed/);
});

test("health scoring does not call an explicit better-than comparison a product leak", () => {
  for (const scenario of [financeScenario, rent2buyScenario]) {
    const evaluated = evaluateHealthConversation({ scenario, turns: [{
      message: "Is Finance better than Rent2Buy?",
      result: result({
        reply: "Finance and Rent2Buy are different routes, so the right fit depends on the customer's circumstances and the approved product rules.",
        comparison_mode: true,
        knowledge_sources_used: [
          { type: "article", category: "Van Finance", title: "Finance guide" },
          { type: "article", category: "Rent2Buy", title: "Rent2Buy guide" },
        ],
      }),
    }] });
    assert.deepEqual(productFailures(evaluated), [], scenario.product_context);
  }
});

test("a defensive product-lock clarification may name the other product without being treated as a cross-sell", () => {
  const evaluated = evaluateHealthConversation({ scenario: rent2buyScenario, turns: [{
    message: "finace",
    result: result({
      reply: "You mentioned Finance, but this simulation is locked to Rent2Buy. What would you like to know about that option?",
      conversation_intent: "product_clarification_required",
      clarification_required: true,
      recommended_action: "clarify",
    }),
  }] });
  assert.deepEqual(productFailures(evaluated), []);
});

test("product-lock metadata cannot hide a genuine cross-sell", () => {
  const evaluated = evaluateHealthConversation({ scenario: rent2buyScenario, turns: [{
    message: "finace",
    result: result({
      reply: "This simulation is locked to Rent2Buy, but you should switch to Finance.",
      conversation_intent: "product_clarification_required",
      clarification_required: true,
      recommended_action: "clarify",
    }),
  }] });
  const failures = productFailures(evaluated);
  assert.equal(failures.length, 1);
  assert.match(failures[0].reply_excerpt, /switch to Finance/);
});

test("unsolicited cross-product recommendations still fail and expose a bounded diagnostic excerpt", () => {
  const evaluated = evaluateHealthConversation({ scenario: rent2buyScenario, turns: [{
    message: "What happens next?",
    result: result({ reply: "You should start a Finance application instead." }),
  }] });
  const failures = productFailures(evaluated);
  assert.equal(failures.length, 1);
  assert.match(failures[0].reply_excerpt, /Finance application/);
  assert.ok(failures[0].reply_excerpt.length <= 240);
});
