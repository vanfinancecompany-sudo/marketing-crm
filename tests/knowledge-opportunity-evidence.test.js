import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateKnowledgeOpportunityEvidence,
  calculateEvidenceAdjustedPriority,
  classifyAssistantEvidenceIntent,
  evidenceChannelPayload,
  evidencePriorityComponents,
  shouldCreateEvidenceOpportunity,
} from "../lib/knowledgeOpportunityEvidence.js";
import { telemetryFromAssistantResult } from "../lib/aiAssistantTelemetry.js";

test("live assistant evidence retains redacted customer wording without double-counting the same intent", () => {
  const evidence = aggregateKnowledgeOpportunityEvidence({
    assistantEvents: [
      { event_type: "assistant_response", product_context: "finance", customer_question: "How much deposit do I need? stu@example.com 07123 456 789", secondary_intents: ["deposit"], knowledge_gap: true, retrieval_required: true, retrieval_used: false, created_at: "2026-08-10T10:00:00Z" },
      { event_type: "assistant_response", product_context: "finance", customer_question: "Is there an upfront payment for finance?", secondary_intents: ["deposit"], knowledge_gap: false, retrieval_required: true, retrieval_used: true, created_at: "2026-08-11T10:00:00Z" },
    ],
  });
  const group = evidence.groups.find((item) => item.key === "finance:upfront_costs");
  assert.ok(group);
  assert.equal(group.live_assistant_question_count, 2);
  assert.equal(group.live_assistant_gap_count, 1);
  assert.equal(group.live_assistant_retrieval_miss_count, 1);
  assert.deepEqual(group.assistant_intents[0], { query: "deposit", count: 2, impressions: 0, clicks: 0 });
  assert.match(group.assistant_questions[0].query, /deposit/i);
  assert.doesNotMatch(group.assistant_questions[0].query, /stu@example\.com/i);
  assert.doesNotMatch(group.assistant_questions[0].query, /07123/);
  const channels = evidenceChannelPayload(group, 90);
  assert.equal(channels.live_assistant.question_variations.length, 2);
});

test("question wording can classify an assistant turn even when no secondary intent label is supplied", () => {
  const evidence = aggregateKnowledgeOpportunityEvidence({
    assistantEvents: [{
      event_type: "assistant_response",
      product_context: "finance",
      customer_question: "What documents do I need for a van finance application?",
      secondary_intents: [],
      knowledge_gap: true,
      retrieval_required: true,
      retrieval_used: false,
      created_at: "2026-08-10T10:00:00Z",
    }],
  });
  const group = evidence.groups.find((item) => item.key === "finance:documents");
  assert.ok(group);
  assert.equal(group.live_assistant_question_count, 1);
  assert.equal(group.assistant_questions[0].query, "What documents do I need for a van finance application?");
});

test("unsupported labels stay conservative while novel customer wording can form a guarded fallback cluster", () => {
  assert.equal(classifyAssistantEvidenceIntent("self_employed", "finance"), null);
  const evidence = aggregateKnowledgeOpportunityEvidence({
    assistantEvents: [{ event_type: "assistant_response", product_context: "finance", customer_question: "I am self employed", secondary_intents: ["self_employed"], knowledge_gap: true, retrieval_required: true, retrieval_used: false, created_at: "2026-08-10T10:00:00Z" }],
  });
  const group = evidence.groups[0];
  assert.ok(group);
  assert.equal(group.product, "finance");
  assert.match(group.normalised_intent, /self.*employed/);
  assert.equal(group.live_assistant_question_count, 1);
  assert.equal(shouldCreateEvidenceOpportunity(group), false);
  assert.equal(evidence.diagnostics.unclassified_assistant_events, 0);
});

test("two repeated no-result Hub searches can create a review opportunity", () => {
  const evidence = aggregateKnowledgeOpportunityEvidence({
    searchEvents: [
      { event_type: "search_submitted", query_text: "what documents do I need", normalised_query: "what documents do i need", result_count: 0, category: "Van Finance", created_at: "2026-08-10T10:00:00Z" },
      { event_type: "search_submitted", query_text: "documents needed for finance", normalised_query: "documents needed for finance", result_count: 0, category: "Van Finance", created_at: "2026-08-11T10:00:00Z" },
    ],
  });
  const group = evidence.groups.find((item) => item.key === "finance:documents");
  assert.ok(group);
  assert.equal(group.hub_search_count, 2);
  assert.equal(group.hub_no_result_count, 2);
  assert.equal(shouldCreateEvidenceOpportunity(group), true);
});

test("Google Search Console uses only the latest saved result per article", () => {
  const articles = [{ id: "article-1", category: "Van Finance" }];
  const visibilityResults = [
    { article_id: "article-1", provider: "google_search_console", checked_at: "2026-08-01T00:00:00Z", structured_evidence: { top_queries: [{ query: "van finance documents", impressions: 100, clicks: 10 }] } },
    { article_id: "article-1", provider: "google_search_console", checked_at: "2026-08-12T00:00:00Z", structured_evidence: { top_queries: [{ query: "van finance documents", impressions: 40, clicks: 4 }] } },
  ];
  const evidence = aggregateKnowledgeOpportunityEvidence({ visibilityResults, articles });
  const group = evidence.groups.find((item) => item.key === "finance:documents");
  assert.ok(group);
  assert.equal(group.gsc_impressions, 40);
  assert.equal(group.gsc_clicks, 4);
  assert.equal(group.gsc_query_count, 1);
});

test("GSC demand alone never creates a new Knowledge Opportunity", () => {
  assert.equal(shouldCreateEvidenceOpportunity({ gsc_impressions: 5000, gsc_clicks: 80, gsc_query_count: 5 }), false);
  assert.equal(shouldCreateEvidenceOpportunity({ hub_search_count: 3, gsc_impressions: 20 }), true);
});

test("evidence priority boosts are bounded and overall score remains capped", () => {
  const components = evidencePriorityComponents({
    live_assistant_question_count: 100,
    live_assistant_gap_count: 100,
    live_assistant_retrieval_miss_count: 100,
    hub_search_count: 100,
    hub_no_result_count: 100,
    gsc_impressions: 1000000,
    gsc_clicks: 1000,
  });
  assert.deepEqual(components, { live_demand: 12, live_gaps: 12, hub_demand: 10, gsc_demand: 8 });
  const priority = calculateEvidenceAdjustedPriority({
    question_count: 50,
    unanswered_count: 20,
    weak_answer_count: 20,
    conflict_count: 10,
    purchase_intent: true,
    last_seen_at: new Date().toISOString(),
    related_article_ids: [],
  }, {
    live_assistant_question_count: 100,
    live_assistant_gap_count: 100,
    live_assistant_retrieval_miss_count: 100,
    hub_search_count: 100,
    hub_no_result_count: 100,
    gsc_impressions: 1000000,
    gsc_clicks: 1000,
    last_seen_at: new Date().toISOString(),
  });
  assert.equal(priority.score, 100);
  assert.equal(priority.level, "critical");
});

test("Hub text evidence is redacted before it reaches opportunity provenance", () => {
  const evidence = aggregateKnowledgeOpportunityEvidence({
    searchEvents: [{
      event_type: "search_submitted",
      query_text: "documents for finance stu@example.com 07123 456 789",
      normalised_query: "documents for finance stu example com 07123 456 789",
      result_count: 0,
      category: "Van Finance",
      created_at: "2026-08-10T10:00:00Z",
    }],
  });
  const group = evidence.groups.find((item) => item.key === "finance:documents");
  assert.ok(group);
  assert.doesNotMatch(group.hub_queries[0].query, /stu@example\.com/i);
  assert.doesNotMatch(group.hub_queries[0].query, /07123/);
});

test("assistant telemetry carries normalized intent labels without copying browser message fields", () => {
  const telemetry = telemetryFromAssistantResult({
    conversation_intent: "product_question",
    secondary_intents: ["Poor Credit", "deposit", "Poor Credit"],
    retrieval_used: true,
  });
  assert.deepEqual(telemetry.secondary_intents, ["poor_credit", "deposit"]);
  assert.equal("message" in telemetry, false);
  assert.equal("question" in telemetry, false);
  assert.equal("customer_question" in telemetry, false);
});
