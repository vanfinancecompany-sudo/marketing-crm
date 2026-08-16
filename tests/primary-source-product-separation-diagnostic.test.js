import test from "node:test";
import { runDeterministicHealthBatch } from "../api/marketing-ai-assistant-competence.js";
import { emptyHealthAccumulator, mergeHealthAccumulators, summariseHealth } from "../lib/aiAssistantHealth.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";

test("diagnose primary-source product separation", async () => {
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
      insert() { throw new Error("Diagnostic must remain write-free."); },
    };
    return query;
  } };

  let accumulator = emptyHealthAccumulator();
  for (let start = 0; start < REAL_CUSTOMER_SCENARIOS.length; start += 100) {
    const batch = await runDeterministicHealthBatch(supabase, { start_index: start, count: Math.min(100, REAL_CUSTOMER_SCENARIOS.length - start), total_conversations: REAL_CUSTOMER_SCENARIOS.length });
    accumulator = mergeHealthAccumulators(accumulator, batch.report);
  }
  const report = summariseHealth(accumulator);
  const failures = report.failed_scenarios
    .map((item) => ({ ...item, failures: item.failures.filter((failure) => failure.rule === "product_separation") }))
    .filter((item) => item.failures.length);
  console.error("PRIMARY_SOURCE_PRODUCT_SEPARATION_DIAGNOSTIC", JSON.stringify(failures));
});
