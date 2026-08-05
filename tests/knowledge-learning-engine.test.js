import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessKnowledgeGapCandidate,
  calculateImprovementMetrics,
  calculateOpportunityPriority,
  classifyLearningIntent,
  diagnoseExistingKnowledge,
  extractLocationReferences,
  groupCompetenceCandidates,
  normaliseLearningQuestion,
  opportunityGroupKey,
  recommendOpportunityContent,
} from "../lib/knowledgeLearningEngine.js";

const result = (id, question, product = "rent2buy", overrides = {}) => ({ id, question, product_context: product, answer: "A test answer", confidence: 45, knowledge_gap: true, conflict_detected: false, sources_used: [], created_at: `2026-08-0${id.replace(/\D/g, "") || 1}T12:00:00Z`, ...overrides });

test("similar wording normalises to one deterministic intent", () => {
  assert.equal(opportunityGroupKey("How much is the upfront payment?", "rent2buy"), opportunityGroupKey("Do I need money down?", "rent2buy"));
  assert.equal(classifyLearningIntent("What is Rent2Buy?", "rent2buy").key, "product_explanation");
  assert.match(normaliseLearningQuestion("How much deposit do I need?"), /initial payment/);
});

test("UK places are retained as examples but abstracted into one location group", () => {
  const questions = ["Do you cover Manchester?", "Can I apply from Portsmouth?", "Is Rent2Buy available in Scotland?"];
  assert.equal(new Set(questions.map((question) => opportunityGroupKey(question, "rent2buy"))).size, 1);
  assert.deepEqual(extractLocationReferences(questions.join(" ")), ["Manchester", "Portsmouth", "Scotland"]);
  const groups = groupCompetenceCandidates(questions.map((question, index) => result(String(index + 1), question)), []);
  assert.equal(groups[0].title, "Rent2Buy coverage, distance and collection");
  assert.deepEqual(groups[0].observed_locations, ["Manchester", "Portsmouth", "Scotland"]);
});

test("Finance and Rent2Buy can never share an opportunity group", () => {
  const finance = opportunityGroupKey("Do you deliver to Manchester?", "finance");
  const rent = opportunityGroupKey("Do you cover Manchester?", "rent2buy");
  assert.notEqual(finance, rent);
  const groups = groupCompetenceCandidates([result("1", "Do you cover Manchester?", "finance"), result("2", "Do you cover Manchester?", "rent2buy")], []);
  assert.equal(groups.length, 2);
  assert.deepEqual(new Set(groups.map((group) => group.product)), new Set(["finance", "rent2buy"]));
});

test("exact and near-duplicate results collapse without duplicate result links", () => {
  const duplicate = result("1", "Do you cover Leeds?");
  const groups = groupCompetenceCandidates([duplicate, duplicate, result("2", "Can I apply from Manchester?")], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].unique_result_count, 2);
  assert.equal(groups[0].questions.length, 2);
});

test("manual backfill grouping is idempotent for identical source data", () => {
  const source = [result("1", "Do you cover Leeds?"), result("2", "Can I apply from Manchester?")];
  assert.deepEqual(groupCompetenceCandidates(source, []), groupCompetenceCandidates(source, []));
  const migration = readFileSync(new URL("../supabase/migrations/033_ai_assistant_learning_engine_v2.sql", import.meta.url), "utf8");
  assert.match(migration, /unique \(product, normalised_intent\)/);
  assert.match(migration, /unique \(competence_result_id\)/);
});

test("human review outweighs confidence-only evidence when assessing candidates", () => {
  const highConfidence = result("1", "Question", "finance", { answer: "This question is answered directly.", confidence: 90, knowledge_gap: false, sources_used: [{ type: "article", source_id: "a" }] });
  assert.equal(assessKnowledgeGapCandidate(highConfidence, { outcome: "incorrect", accuracy: 2, helpfulness: 2 }).qualifies, true);
  assert.equal(assessKnowledgeGapCandidate(highConfidence, { outcome: "pass", accuracy: 5, helpfulness: 5 }).qualifies, false);
});

test("priority score is transparent, bounded and increases with stronger evidence", () => {
  const low = calculateOpportunityPriority({ question_count: 1, last_seen_at: "2026-08-05", title: "general question" }, new Date("2026-08-05"));
  const high = calculateOpportunityPriority({ question_count: 10, unanswered_count: 4, weak_answer_count: 3, conflict_count: 1, last_seen_at: "2026-08-05", title: "application next step" }, new Date("2026-08-05"));
  assert.ok(high.score > low.score);
  assert.equal(Object.values(high.components).reduce((sum, value) => sum + value, 0), high.score);
  assert.ok(high.score <= 100);
});

test("existing knowledge diagnosis distinguishes retrieval, Business Brain and missing knowledge", () => {
  const opportunity = { title: "Rent2Buy coverage collection", unanswered_count: 2, conflict_count: 0 };
  assert.equal(diagnoseExistingKnowledge(opportunity, { articles: [{ id: "a", title: "Rent2Buy collection and coverage" }], sections: [] }).diagnosis, "Knowledge exists but retrieval missed it");
  assert.equal(diagnoseExistingKnowledge(opportunity, { articles: [], sections: [{ id: "b", title: "Coverage", content: "Rent2Buy collection coverage" }] }).diagnosis, "Business Brain needs clearer guidance");
  assert.equal(diagnoseExistingKnowledge(opportunity, { articles: [], sections: [] }).diagnosis, "No knowledge exists");
});

test("broad clusters recommend articles while narrow gaps recommend FAQs", () => {
  assert.equal(recommendOpportunityContent({ question_count: 5, normalised_intent: "coverage_collection" }).action, "create_article");
  assert.equal(recommendOpportunityContent({ question_count: 1, normalised_intent: "narrow_term" }).action, "create_faq");
});

test("status changes, article links and FAQ drafts are auditable manual actions", () => {
  const api = readFileSync(new URL("../api/marketing-ai-knowledge-opportunities.js", import.meta.url), "utf8");
  assert.match(api, /event_type: status !== existing\.status \? "status_changed"/);
  assert.match(api, /event_type: eventType/);
  assert.match(api, /event_type: "faq_draft_created"/);
  assert.match(api, /automatic_completion: false/);
  assert.match(api, /automatic_activation: false/);
});

test("before and after metrics are separated by the manual link timestamp", () => {
  const metrics = calculateImprovementMetrics([
    { created_at: "2026-08-01", confidence: 40, knowledge_gap: true, review: { accuracy: 2, helpfulness: 2 } },
    { created_at: "2026-08-04", confidence: 90, knowledge_gap: false, review: { accuracy: 5, helpfulness: 5 } },
  ], "2026-08-03");
  assert.equal(metrics.before.unanswered_count, 1);
  assert.equal(metrics.after.unanswered_count, 0);
  assert.equal(metrics.before.average_confidence, 40);
  assert.equal(metrics.after.average_confidence, 90);
});

test("draft action reuses Knowledge Hub generation and cannot approve or publish", () => {
  const api = readFileSync(new URL("../api/marketing-ai-knowledge-opportunities.js", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/033_ai_assistant_learning_engine_v2.sql", import.meta.url), "utf8");
  assert.match(api, /generateArticle\(supabase/);
  assert.match(api, /draft_only: true/);
  assert.doesNotMatch(api, /approveAndCreateWixDraft|publishToWix|status:\s*"approved"/);
  assert.doesNotMatch(migration, /vector\(|create extension[^;]*vector/i);
  assert.doesNotMatch(api, /WIX_API_KEY|WIX_SITE_ID/);
});
