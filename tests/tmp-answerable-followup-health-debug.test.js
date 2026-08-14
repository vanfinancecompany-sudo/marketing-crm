import test from "node:test";
import assert from "node:assert/strict";
import { simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";

test("trace VAT journey context", async () => {
  const content = `# Applications and eligibility

Application eligibility, next steps, self-employed and limited-company trading, poor credit, declined applications, documents, bank statements, licences, deposits, budgets, monthly payments, costs, affordability and accounts.

# Vehicles and service

Vans and vehicles including Transit Custom, Sprinter, tipper, electric, large, medium and small vans. Insurance, vehicle tax, warranty, mileage, collection, delivery and location coverage.

# Safety

Approval is subject to assessment. Delivery timing and vehicle availability must be confirmed.`;
  const articles = ["Van Finance", "Rent2Buy"].map((category, index) => ({ id: `health-${index}`, title: `${category} applications, vehicles and customer guidance`, category, content_markdown: content, faq_json: [], status: "approved", is_active: true }));
  const knowledge = {
    settings: { finance_covered_nations: ["England", "Wales", "Scotland"], rent2buy_base_postcode: "SO40 2NN", rent2buy_max_radius_miles: 100, coverage_borderline_tolerance_miles: 10, coverage_distance_method: "straight_line" },
    sections: [],
    articles,
  };
  const scenario = REAL_CUSTOMER_SCENARIOS.find((item) => item.id === "V4-067");
  assert.ok(scenario);

  let messages = [];
  let rememberedFacts = {};
  let journeyState = {};
  const trace = [];
  for (const message of scenario.messages.slice(0, 5)) {
    const response = await simulateCustomerConversation(null, {
      request_id: `debug-${trace.length + 1}`,
      session_id: "debug-v4-067",
      scenario_id: scenario.id,
      message,
      product_context: scenario.product_context,
      messages,
      remembered_facts: rememberedFacts,
      journey_state: journeyState,
    }, {
      persist: false,
      generationMode: "deterministic",
      knowledge,
    });
    const result = response.result;
    trace.push({
      message,
      reply: result.reply,
      universal_message_type: result.universal_message_type,
      conversation_intent: result.conversation_intent,
      retrieval_required: result.retrieval_required,
      retrieval_used: result.retrieval_used,
      source_count: result.knowledge_sources_used?.length || 0,
      next_best_question: result.next_best_question,
      supported_follow_up_question: result.supported_follow_up_question,
      remembered_facts: result.remembered_facts,
    });
    messages = [...messages, { role: "user", content: message }, { role: "assistant", content: result.reply }];
    rememberedFacts = result.remembered_facts || rememberedFacts;
    journeyState = result;
  }
  assert.fail(`FOLLOWUP_VAT_TRACE ${JSON.stringify(trace)}`);
});
