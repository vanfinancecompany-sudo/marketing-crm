import test from "node:test";
import { runDeterministicHealthBatch } from "../api/marketing-ai-assistant-competence.js";
import { emptyHealthAccumulator, mergeHealthAccumulators, summariseHealth } from "../lib/aiAssistantHealth.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";

test("print deterministic health regressions for Rent2Buy coverage work", async () => {
  const content = `# Applications and eligibility\n\nApplication eligibility, next steps, self-employed and limited-company trading, poor credit, declined applications, documents, bank statements, licences, deposits, budgets, monthly payments, costs, affordability and accounts.\n\n# Vehicles and service\n\nVans and vehicles including Transit Custom, Sprinter, tipper, electric, large, medium and small vans. Insurance, vehicle tax, warranty, mileage, collection, delivery and location coverage.\n\n# Safety\n\nApproval is subject to assessment. Delivery timing and vehicle availability must be confirmed.`;
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
      insert() { throw new Error("Diagnostic health validation must remain write-free."); },
    };
    return query;
  } };
  let accumulator = emptyHealthAccumulator();
  for (let start = 0; start < REAL_CUSTOMER_SCENARIOS.length; start += 100) {
    const batch = await runDeterministicHealthBatch(supabase, { start_index: start, count: Math.min(100, REAL_CUSTOMER_SCENARIOS.length - start), total_conversations: REAL_CUSTOMER_SCENARIOS.length });
    accumulator = mergeHealthAccumulators(accumulator, batch.report);
  }
  const report = summariseHealth(accumulator);
  console.error("RENT2BUY_LOCATION_HEALTH_DIAGNOSTIC", JSON.stringify({
    overall: report.overall_ai_health_score,
    conversation_progression: report.conversation_progression,
    context_retention: report.context_retention,
    product_separation_accuracy: report.product_separation_accuracy,
    knowledge_retrieval_accuracy: report.knowledge_retrieval_accuracy,
    application_progression_accuracy: report.application_progression_accuracy,
    recovery_success: report.recovery_success,
    rule_violations: report.rule_violations,
    failures: report.failed_scenarios,
  }, null, 2));
});
