import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHealthConversation } from "../lib/aiAssistantHealth.js";
import {
  buildCompetencePrompt,
  buildRetrievalCorpus,
  filterKnowledgeForProduct,
  isExplicitProductComparison,
} from "../lib/aiAssistantCompetence.js";
import { RENT2BUY_RULE_LABEL } from "../lib/rent2BuyRules.js";

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

test("natural comparison wording deliberately combines two already-sealed product knowledge pools", () => {
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
  assert.equal(bounded.brainId, "comparison");
  assert.match(bounded.categoryFilter, /both product categories allowed/i);
});

test("normal product brains reject an entire article when the article itself crosses the product boundary", () => {
  const rentKnowledge = filterKnowledgeForProduct({
    sections: [],
    articles: [{
      id: "rent-mixed",
      title: "Rent2Buy customer guide",
      category: "Rent2Buy",
      content_markdown: "# Rent2Buy basics\nRent2Buy uses rental payments and does not require a credit check.\n\n# Finance comparison\nChoose traditional van finance if you want lender-backed funding, or apply for a finance quotation.",
      faq_json: [],
    }],
  }, "rent2buy");
  assert.deepEqual(rentKnowledge.articles, []);

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
  assert.deepEqual(financeKnowledge.articles, []);
});

test("Rent2Buy brain blocks Finance delivery contamination even when it is hidden in a Rent2Buy article", () => {
  const bounded = filterKnowledgeForProduct({
    sections: [],
    articles: [{
      id: "poisoned-r2b",
      title: "How Rent2Buy works",
      category: "Rent2Buy",
      content_markdown: "## Collection\n\nFree UK delivery is included.",
      faq_json: [],
    }],
  }, "rent2buy");
  assert.deepEqual(bounded.articles, []);
  const corpus = buildRetrievalCorpus(bounded);
  assert.equal(corpus.some((source) => source.source_id === "poisoned-r2b"), false);
});

test("Rent2Buy article passages cannot become authority for restricted contract details", () => {
  const bounded = filterKnowledgeForProduct({
    sections: [{
      id: "r2b-business",
      section_key: "sales_knowledge",
      title: "Sales Knowledge",
      active: true,
      content: "",
      entries: [{ label: "Rent2Buy insurance", value: "The current approved insurance requirement is confirmed by the team." }],
    }],
    articles: [{
      id: "r2b-contract",
      title: "Rent2Buy agreement guide",
      category: "Rent2Buy",
      content_markdown: "## Agreement\n\nFully comprehensive insurance and a mileage limit apply. Early returns and upgrades depend on the agreement.",
      faq_json: [],
    }],
  }, "rent2buy");
  const corpus = buildRetrievalCorpus(bounded);
  assert.equal(corpus.some((source) => source.type.startsWith("article") && /insurance|mileage|early returns|upgrades/i.test(source.passage)), false);
  assert.equal(corpus.some((source) => source.type === "business_brain" && /Rent2Buy insurance/i.test(source.passage)), true);
});

test("unlabelled product facts are not treated as shared across the two brains", () => {
  const knowledge = {
    sections: [{
      id: "products",
      section_key: "products",
      title: "Products",
      active: true,
      content: "",
      entries: [
        { label: "Delivery", value: "Free UK delivery is included." },
        { label: "Collection", value: "Collection only from Southampton." },
      ],
    }],
    articles: [],
  };
  const financeCorpus = buildRetrievalCorpus(filterKnowledgeForProduct(knowledge, "finance"));
  const rentCorpus = buildRetrievalCorpus(filterKnowledgeForProduct(knowledge, "rent2buy"));
  assert.equal(financeCorpus.some((source) => source.heading === "Delivery" && /Free UK delivery/i.test(source.passage)), true);
  assert.equal(financeCorpus.some((source) => source.heading === "Collection"), false);
  assert.equal(rentCorpus.some((source) => source.heading === "Delivery"), false);
  assert.equal(rentCorpus.some((source) => source.heading === "Collection" && /Collection only from Southampton/i.test(source.passage)), true);
});

test("Rent2Buy brain keeps the permanent product rule in the control plane, never answer retrieval", () => {
  const bounded = filterKnowledgeForProduct({ sections: [], articles: [] }, "rent2buy");
  const compliance = bounded.sections.find((section) => section.section_key === "compliance");
  assert.equal(compliance.entries.some((entry) => entry.label === RENT2BUY_RULE_LABEL), true);
  const corpus = buildRetrievalCorpus(bounded);
  assert.equal(corpus.some((source) => source.heading === RENT2BUY_RULE_LABEL), false);
  const prompt = buildCompetencePrompt({ question: "How does Rent2Buy work?", sources: corpus.slice(0, 2), sections: bounded.sections, productContext: "rent2buy" });
  assert.match(prompt, /Non-overridable Rent2Buy brain rules/);
  assert.match(prompt, /Collection only from Southampton/);
  assert.match(prompt, /Never fill the gap from an article, Finance evidence or model inference/);
  assert.doesNotMatch(prompt, /Van Finance Company · 101-point PDI/);
});

test("comparison mode does not reopen a deliberately contaminated mixed article", () => {
  const knowledge = filterKnowledgeForProduct({
    sections: [],
    articles: [{
      id: "comparison",
      title: "Finance and Rent2Buy comparison",
      category: "Van Finance",
      content_markdown: "# Compare the routes\nFinance and Rent2Buy are different products. Free UK delivery is included for Rent2Buy.",
      faq_json: [],
    }],
  }, "finance", { comparison: true });
  const corpus = buildRetrievalCorpus(knowledge);
  assert.equal(corpus.some((source) => source.source_id === "comparison"), false);
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
