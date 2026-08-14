import test from "node:test";
import { syntheticScenarioAt } from "../lib/aiAssistantHealth.js";
import { simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";

const TARGETS = [242, 308, 369, 472, 568];

function fixtureSupabase() {
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
  return { from(table) {
    const query = {
      select() { return query; },
      eq() { return query; },
      order() { return Promise.resolve({ data: tableData[table] || [], error: null }); },
      maybeSingle() { return Promise.resolve({ data: tableData[table] || null, error: null }); },
      insert() { throw new Error("Deterministic debug must remain write-free."); },
    };
    return query;
  } };
}

test("temporary representative deterministic retrieval traces", async () => {
  const supabase = fixtureSupabase();
  const traces = [];
  for (const index of TARGETS) {
    const scenario = syntheticScenarioAt(index);
    let messages = [];
    let rememberedFacts = {};
    let journeyState = {};
    for (let turnIndex = 0; turnIndex < scenario.messages.length; turnIndex += 1) {
      const message = scenario.messages[turnIndex];
      const response = await simulateCustomerConversation(supabase, {
        request_id: `trace-${scenario.id}-${turnIndex + 1}`,
        session_id: `trace-${scenario.id}`,
        scenario_id: scenario.source_scenario_id || scenario.id,
        message,
        product_context: scenario.product_context,
        messages,
        remembered_facts: rememberedFacts,
        journey_state: journeyState,
      }, { persist: false, generationMode: "deterministic" });
      const result = response.result;
      traces.push({
        scenario: scenario.id,
        turn: turnIndex + 1,
        message,
        type: result.universal_message_type,
        intent: result.conversation_intent,
        secondary: result.secondary_intents,
        normalized: result.normalised_message,
        retrieval_required: result.retrieval_required,
        retrieval_used: result.retrieval_used,
        insufficient: result.insufficient_knowledge,
        application: result.application_mode_active,
        sources: (result.knowledge_sources_used || []).map((source) => ({ id: source.source_id, heading: source.heading, matched: source.matched_terms })),
        reply: String(result.reply || "").slice(0, 120),
      });
      messages = [...messages, { role: "user", content: message }, { role: "assistant", content: result.reply || "" }];
      rememberedFacts = result.remembered_facts || rememberedFacts;
      journeyState = result;
    }
  }
  const failingMessages = new Set(["can you switch", "do I need my licence", "Fine", "Is the van taxed?", "Can you help me narrow it down?"]);
  throw new Error(`DETERMINISTIC_RETRIEVAL_TRACE ${JSON.stringify(traces.filter((trace) => failingMessages.has(trace.message)))}`);
});
