import test from "node:test";
import { runDeterministicHealthBatch } from "../api/marketing-ai-assistant-competence.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";

function fixture() {
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
      insert() { throw new Error("Diagnostic must remain write-free."); },
    };
    return query;
  } };
}

test("diagnose primary-source retrieval health", async () => {
  const total = REAL_CUSTOMER_SCENARIOS.length;
  const windows = [];
  for (let start = 0; start < total; start += 100) {
    const count = Math.min(100, total - start);
    const batch = await runDeterministicHealthBatch(fixture(), { start_index: start, count, total_conversations: total });
    windows.push({ start, count, accuracy: batch.report.knowledge_retrieval_accuracy, checks: batch.report.checks.knowledge_retrieval });
  }
  console.error("PRIMARY_SOURCE_RETRIEVAL_WINDOWS", JSON.stringify(windows));

  const badWindow = windows.find((window) => window.accuracy < 100);
  if (!badWindow) return;
  let firstBadPrefix = null;
  for (let count = 1; count <= badWindow.count; count += 1) {
    const batch = await runDeterministicHealthBatch(fixture(), { start_index: badWindow.start, count, total_conversations: total });
    if (batch.report.knowledge_retrieval_accuracy < 100) {
      firstBadPrefix = {
        start: badWindow.start,
        count,
        scenario_index: badWindow.start + count - 1,
        scenario: REAL_CUSTOMER_SCENARIOS[badWindow.start + count - 1],
        accuracy: batch.report.knowledge_retrieval_accuracy,
        checks: batch.report.checks.knowledge_retrieval,
        failed_scenarios: batch.report.failed_scenarios,
      };
      break;
    }
  }
  console.error("PRIMARY_SOURCE_RETRIEVAL_FIRST_BAD_PREFIX", JSON.stringify(firstBadPrefix));
});
