import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  hasMeaningfulNewOpportunityEvidence,
  isDefaultActiveKnowledgeOpportunity,
  knowledgeOpportunityClusterFingerprint,
  knowledgeOpportunityEvidenceFingerprint,
  KNOWLEDGE_WORKFLOW_ACTIONS,
  recommendedKnowledgeWorkflowAction,
  workflowReopenReason,
} from "../lib/knowledgeOpportunityWorkflow.js";

const opportunity = (overrides = {}) => ({
  product: "finance",
  normalised_intent: "documents",
  recommended_action: "create_article",
  status: "new",
  unique_result_count: 2,
  unanswered_count: 1,
  weak_answer_count: 1,
  conflict_count: 0,
  candidate_reasons: ["insufficient_knowledge"],
  last_seen_at: "2026-08-05T12:00:00Z",
  questions: [{ competence_result_id: "result-1" }, { competence_result_id: "result-2" }],
  ...overrides,
});

test("every opportunity receives one explicit traffic-light recommendation", () => {
  const actions = [
    recommendedKnowledgeWorkflowAction(opportunity()),
    recommendedKnowledgeWorkflowAction(opportunity({ recommended_action: "improve_retrieval" })),
    recommendedKnowledgeWorkflowAction(opportunity({ status: "no_action_required" })),
  ];
  assert.deepEqual(actions, ["create_article", "review_later", "no_action_required"]);
  assert.equal(actions.every((action) => KNOWLEDGE_WORKFLOW_ACTIONS.includes(action)), true);
});

test("closed, resolved, no-action and draft-created records leave only the default active view", () => {
  for (const status of ["no_action_required", "draft_created", "resolved", "closed", "dismissed", "completed"]) assert.equal(isDefaultActiveKnowledgeOpportunity({ status }), false, status);
  for (const status of ["new", "reviewing", "review_later", "reopened"]) assert.equal(isDefaultActiveKnowledgeOpportunity({ status }), true, status);
});

test("cluster and evidence fingerprints are deterministic and product-separated", () => {
  assert.equal(knowledgeOpportunityClusterFingerprint(opportunity()), "finance:documents");
  assert.equal(knowledgeOpportunityClusterFingerprint(opportunity({ product: "rent2buy" })), "rent2buy:documents");
  assert.equal(knowledgeOpportunityEvidenceFingerprint(opportunity()), knowledgeOpportunityEvidenceFingerprint(opportunity({ questions: [...opportunity().questions].reverse() })));
});

test("unchanged analysis cannot reopen a closed opportunity", () => {
  const incoming = opportunity();
  const existing = { ...incoming, status: "closed", closed_at: "2026-08-05T13:00:00Z", evidence_fingerprint: knowledgeOpportunityEvidenceFingerprint(incoming) };
  assert.equal(hasMeaningfulNewOpportunityEvidence(existing, incoming), false);
});

test("new result or conflict evidence reopens with a visible reason", () => {
  const before = opportunity();
  const existing = { ...before, status: "closed", closed_at: "2026-08-05T13:00:00Z", evidence_fingerprint: knowledgeOpportunityEvidenceFingerprint(before) };
  const next = opportunity({ unique_result_count: 3, last_seen_at: "2026-08-06T12:00:00Z", questions: [...before.questions, { competence_result_id: "result-3" }] });
  assert.equal(hasMeaningfulNewOpportunityEvidence(existing, next), true);
  assert.match(workflowReopenReason(existing, next), /1 new competence result/);
});

test("workflow migration preserves records and stores lifecycle evidence", async () => {
  const migration = await readFile(new URL("../supabase/migrations/038_ai_knowledge_opportunity_workflow.sql", import.meta.url), "utf8");
  for (const field of ["linked_topic_id", "cluster_fingerprint", "evidence_fingerprint", "closure_reason", "closed_at", "review_later_at", "no_action_at", "draft_created_at", "resolved_at", "reopened_at", "reopen_reason"]) assert.match(migration, new RegExp(field));
  assert.doesNotMatch(migration, /delete\s+from|drop\s+table/i);
});

test("server workflow reuses Topic Planner, audits bulk actions and never invokes Wix", async () => {
  const [api, store] = await Promise.all([
    readFile(new URL("../api/marketing-ai-knowledge-opportunities.js", import.meta.url), "utf8"),
    readFile(new URL("../api/_knowledgeOpportunityStore.js", import.meta.url), "utf8"),
  ]);
  assert.match(api, /linked_topic_id/);
  assert.match(api, /knowledge_topics/);
  assert.match(api, /bulkUpdateOpportunities/);
  assert.match(api, /automatically_resolved/);
  assert.match(api, /automaticallyResolvable/);
  assert.match(store, /automatically_reopened/);
  assert.doesNotMatch(api, /WIX_API_KEY|WIX_SITE_ID|approveAndCreateWixDraft|publishToWix/);
});

test("protected UI includes legend, summaries, filters, card actions and bulk controls", async () => {
  const page = await readFile(new URL("../pages/AIKnowledgeOpportunitiesPage.jsx", import.meta.url), "utf8");
  for (const label of ["Create Article", "Review Later", "No Action Required", "Draft Created", "Resolved", "Reopened", "Create Knowledge Hub Draft", "Mark Resolved / Close", "Bulk workflow actions"]) assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /isDefaultActiveKnowledgeOpportunity/);
});
