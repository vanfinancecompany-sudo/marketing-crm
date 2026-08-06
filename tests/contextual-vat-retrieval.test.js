import test from "node:test";
import assert from "node:assert/strict";
import { classifyConversationIntent } from "../lib/conversationIntelligence.js";
import { rankKnowledge } from "../lib/aiAssistantCompetence.js";
import { buildJourneyState } from "../lib/applicationJourneyEngine.js";
import { classifyUniversalMessage } from "../lib/humanConversationRecovery.js";
import { orchestrateConversationTurn } from "../lib/conversationKnowledgeOrchestrator.js";

function canonicalDecision(message, productContext = "finance", history = []) {
  const intent = classifyConversationIntent({ message, history, productContext });
  const human = classifyUniversalMessage({ message, messages: history, journey: {} });
  const journey = buildJourneyState({
    message,
    messages: history,
    intent,
    facts: { product_context: productContext },
    productContext,
    priorJourney: {},
  });
  const orchestration = orchestrateConversationTurn({
    message,
    intent,
    human,
    journey,
    priorJourney: {},
    buyingSignals: {},
  });
  return { intent, orchestration };
}

test("canonical Finance VAT follow-ups require approved knowledge retrieval", () => {
  const history = [
    { role: "user", content: "Finance" },
    { role: "assistant", content: "What would you like to know?" },
  ];
  for (const message of ["Tax included?", "VAT included?", "Are prices plus VAT?", "inc VAT?"]) {
    const result = canonicalDecision(message, "finance", history);
    assert.equal(result.intent.original_message, message, message);
    assert.equal(result.intent.secondary_intents.includes("vat_pricing"), true, message);
    assert.equal(result.intent.clarification_required, false, message);
    assert.equal(result.intent.retrieval_required, true, message);
    assert.equal(result.orchestration.retrieval_required, true, message);
    assert.ok(result.orchestration.priority_path_taken.includes("verified_business_knowledge"), message);
  }
});

test("canonical VAT wording ranks approved Finance evidence without rewriting the original turn", () => {
  const sources = rankKnowledge("Tax included?", [
    {
      type: "business_brain",
      source_id: "finance-vat",
      title: "Van Finance pricing",
      heading: "VAT treatment",
      passage: "Advertised Finance vehicle prices are shown plus VAT unless the individual vehicle advert explicitly states otherwise.",
      product: "finance",
    },
    {
      type: "business_brain",
      source_id: "delivery",
      title: "Finance delivery",
      heading: "Delivery",
      passage: "Qualifying Finance vehicles include mainland delivery.",
      product: "finance",
    },
  ], {
    messages: [{ role: "user", content: "Finance" }],
    limit: 8,
  });
  assert.equal(sources[0].source_id, "finance-vat");
  assert.ok(sources[0].matched_terms.includes("vat"));
});

test("canonical Rent2Buy VAT follow-ups retain the Rent2Buy boundary", () => {
  const result = canonicalDecision("Is tax included?", "rent2buy", [
    { role: "user", content: "Rent2Buy" },
    { role: "assistant", content: "What would you like to know?" },
  ]);
  assert.equal(result.intent.product_context, "rent2buy");
  assert.equal(result.intent.retrieval_required, true);
  assert.equal(result.orchestration.retrieval_required, true);
  assert.equal(result.orchestration.product_boundary_blocked, false);
});
