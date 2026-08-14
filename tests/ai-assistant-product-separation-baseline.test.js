import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHealthConversation } from "../lib/aiAssistantHealth.js";
import { buildRetrievalCorpus, filterKnowledgeForProduct, isExplicitProductComparison } from "../lib/aiAssistantCompetence.js";

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

test("retrieval removes cross-product passages hidden inside an otherwise allowed article", () => {
  const rentKnowledge = filterKnowledgeForProduct({
    sections: [],
    articles: [{
      id: "rent-mixed",
      title: "Rent2Buy customer guide",
      category: "Rent2Buy",
      content_markdown: "# Rent2Buy basics\nRent2Buy uses rental payments and does not require a credit check.\n\n# Finance comparison\nChoose traditional van finance if you want lender-backed funding, or apply for a finance quotation.",
      faq_json: [{ question: "Are deposits always £99 for traditional van finance?", answer: "No, finance deposits vary by lender and application." }],
    }],
  }, "rent2buy");
  const rentCorpus = buildRetrievalCorpus(rentKnowledge);
  assert.equal(rentCorpus.some((source) => /traditional van finance|finance quotation|finance deposits/i.test(`${source.heading} ${source.passage}`)), false);
  assert.equal(rentCorpus.some((source) => /Rent2Buy uses rental payments/i.test(source.passage)), true);

  const financeKnowledge = filterKnowledgeForProduct({
    sections: [],
    articles: [{
      id: "finance-mixed",
      title: "Finance customer guide",
      category: "Van Finance",
      content_markdown: "# Finance basics\nFinance is subject to lender assessment.\n\n# Rent2Buy comparison\nRent2Buy is a separate rental-to-ownership route.",
      faq_json: [],
    }],
  }, "finance");
  const financeCorpus = buildRetrievalCorpus(financeKnowledge);
  assert.equal(financeCorpus.some((source) => /Rent2Buy/i.test(`${source.heading} ${source.passage}`)), false);
  assert.equal(financeCorpus.some((source) => /lender assessment/i.test(source.passage)), true);
});

test("comparison mode keeps deliberately mixed passages available", () => {
  const knowledge = filterKnowledgeForProduct({
    sections: [],
    articles: [{
      id: "comparison",
      title: "Finance and Rent2Buy comparison",
      category: "Van Finance",
      content_markdown: "# Compare the routes\nFinance and Rent2Buy are different products with different structures.",
      faq_json: [],
    }],
  }, "finance", { comparison: true });
  const corpus = buildRetrievalCorpus(knowledge);
  assert.equal(corpus.some((source) => /Finance and Rent2Buy/i.test(`${source.title} ${source.passage}`)), true);
});

test("health scoring treats neutral vehicle guidance as shared rather than Finance", () => {
  const sharedSource = {
    type: "article",
    category: "Vehicle Guides",
    product: "Vehicle Guides",
    title: "Can You Buy a Used Van Without Seeing It First? A Guide for UK Buyers",
    heading: "Choosing the right van",
    passage: "Check the vehicle description, condition, history and suitability for the work you need it to do.",
    matched_terms: ["van"],
  };
  for (const scenario of [financeScenario, rent2buyScenario]) {
    const evaluated = evaluateHealthConversation({ scenario, turns: [{
      message: "Can you help me narrow it down?",
      result: result({ knowledge_sources_used: [sharedSource] }),
    }] });
    assert.deepEqual(productFailures(evaluated), [], scenario.product_context);
  }
});

test("health scoring still rejects product-specific wording inside a neutral category", () => {
  const evaluated = evaluateHealthConversation({ scenario: rent2buyScenario, turns: [{
    message: "What should I choose?",
    result: result({
      knowledge_sources_used: [{
        type: "article",
        category: "Vehicle Guides",
        product: "Vehicle Guides",
        title: "Vehicle guide",
        heading: "Funding",
        passage: "A van finance lender may assess the application and APR before offering terms.",
        matched_terms: ["van"],
      }],
    }),
  }] });
  assert.equal(productFailures(evaluated).length, 1);
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
