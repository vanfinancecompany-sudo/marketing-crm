import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTOMATION_JOB_TYPES,
  PROHIBITED_AUTOMATION_ACTIONS,
  assertSafeAutomationAction,
  buildDailyBriefing,
  buildScannerOpportunities,
  canQueueDraftFactory,
  evaluateDraftThreshold,
  mergeDiscoveredTopics,
  nextRetry,
} from "../lib/editorialAutomation.js";
import automationHandler from "../api/marketing-editorial-automation.js";
import workerHandler from "../api/marketing-editorial-automation-worker.js";

test("Automation Engine exposes bounded preparation jobs and blocks prohibited actions", () => {
  assert.deepEqual(AUTOMATION_JOB_TYPES, [
    "opportunity_scan",
    "topic_discovery",
    "draft_factory",
    "improvement",
    "editorial_refresh",
    "daily_briefing",
  ]);
  assert.equal(assertSafeAutomationAction("draft_factory"), "draft_factory");
  for (const action of PROHIBITED_AUTOMATION_ACTIONS) {
    assert.throws(() => assertSafeAutomationAction(action), /prohibits/);
  }
});

test("Opportunity Scanner explains freshness, weak scores, FAQ, CTA and linking gaps", () => {
  const opportunities = buildScannerOpportunities({
    articles: [{
      id: "article",
      title: "Van finance application guide",
      category: "Van Finance",
      status: "draft",
      faq_json: [],
      updated_at: "2025-01-01T00:00:00Z",
    }, {
      id: "duplicate",
      title: "Guide to van finance applications",
      category: "Van Finance",
      status: "draft",
      faq_json: [{ question: "Who can apply?", answer: "Eligible businesses can apply." }],
      updated_at: "2026-07-01T00:00:00Z",
    }],
    assessments: [{
      id: "assessment",
      article_id: "article",
      overall_score: 60,
      created_at: "2026-07-25T00:00:00Z",
      effective_intent: { primary_product: "finance", customer_journey: "decision" },
      category_scores: {
        cta_quality: { score: 45 },
        internal_linking: { score: 30 },
      },
    }],
    concepts: [{ id: "concept", concept_key: "vat", label: "VAT", aliases: [], primary_product: "both", active: true }],
    articleConcepts: [],
    topics: [],
    freshnessDays: 180,
    now: new Date("2026-07-25T00:00:00Z"),
  });
  for (const type of [
    "outdated_content",
    "weak_article",
    "duplicate_intent",
    "missing_faq",
    "weak_cta",
    "weak_linking",
    "missing_topic",
  ]) {
    assert.equal(opportunities.some((item) => item.opportunity_type === type), true);
  }
  assert.equal(opportunities.every((item) => item.status === "draft"), true);
  assert.equal(opportunities.every((item) => item.reason && item.fingerprint), true);
});

test("Coverage scanner never recommends duplicate topic intent", () => {
  const opportunities = buildScannerOpportunities({
    articles: [],
    assessments: [],
    concepts: [{ id: "concept", concept_key: "vat", label: "VAT", aliases: ["value added tax"], active: true }],
    articleConcepts: [],
    topics: [{ id: "topic", title: "VAT on vans explained", status: "ready" }],
  });
  assert.equal(opportunities.some((item) => item.source_concept_id === "concept"), false);
});

test("Topic Discovery merges exact and strong near duplicates", () => {
  const result = mergeDiscoveredTopics(
    [
      { title: "How van finance applications work" },
      { title: "How van finance application works" },
      { title: "Rent2Buy proof of income guide" },
    ],
    [{ title: "How van finance applications work" }]
  );
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].title, "Rent2Buy proof of income guide");
  assert.equal(result.duplicates.length, 2);
});

test("Draft Factory requires explicit opportunity approval and a quality threshold", () => {
  assert.equal(canQueueDraftFactory({ status: "draft", opportunity_type: "missing_topic" }), false);
  assert.equal(canQueueDraftFactory({ status: "approved", opportunity_type: "missing_topic" }), true);
  assert.equal(canQueueDraftFactory({ status: "approved", opportunity_type: "weak_article" }), false);
  assert.equal(
    evaluateDraftThreshold({ overall_score: 82, publication_status: "review", warnings: [] }, 75).passes,
    true
  );
  assert.equal(
    evaluateDraftThreshold({
      overall_score: 90,
      publication_status: "blocked",
      warnings: [{ severity: "critical" }],
    }, 75).passes,
    false
  );
});

test("Queue Management uses capped exponential retries and terminal failure", () => {
  const first = nextRetry({ attempts: 1, max_attempts: 3 }, new Date("2026-07-25T10:00:00Z"));
  assert.equal(first.retry, true);
  assert.equal(first.available_at, "2026-07-25T10:05:00.000Z");
  const second = nextRetry({ attempts: 2, max_attempts: 3 }, new Date("2026-07-25T10:00:00Z"));
  assert.equal(second.available_at, "2026-07-25T10:10:00.000Z");
  assert.deepEqual(nextRetry({ attempts: 3, max_attempts: 3 }), { retry: false, available_at: null });
});

test("Daily Briefing summarises yesterday and prioritises reviewable work", () => {
  const briefing = buildDailyBriefing({
    logs: [
      { action: "topic_discovery", result: "succeeded", created_at: "2026-07-24T10:00:00Z", details: {} },
      { action: "draft_factory", result: "succeeded", created_at: "2026-07-24T11:00:00Z", details: {} },
      { action: "improvement", result: "succeeded", created_at: "2026-07-24T12:00:00Z", details: { improvement_type: "missing_faq" } },
    ],
    opportunities: [
      { id: "low", title: "Low", reason: "Lower value", status: "draft", priority_score: 30 },
      { id: "high", title: "High", reason: "High application value", status: "draft", priority_score: 90 },
    ],
    jobs: [{ status: "succeeded", article_id: "article" }],
    assessments: [{
      article_id: "article",
      review_summary: { review_time_minutes: 4 },
    }],
    now: new Date("2026-07-25T09:00:00Z"),
  });
  assert.equal(briefing.completed_summary.topics_discovered, 1);
  assert.equal(briefing.completed_summary.drafts_generated, 1);
  assert.equal(briefing.completed_summary.articles_improved, 1);
  assert.equal(briefing.completed_summary.faqs_expanded, 1);
  assert.equal(briefing.priorities[0].title, "High");
  assert.equal(briefing.estimated_review_minutes, 8);
});

test("Automation APIs reject unauthenticated execution", async () => {
  const previous = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const response = {
    statusCode: 0,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return value; },
  };
  await automationHandler({ method: "POST", headers: {}, body: { action: "load" } }, response);
  assert.equal(response.statusCode, 401);
  await workerHandler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 401);
  if (previous) process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = previous;
});

test("Phase 6 migration, worker and UI enforce review-only automation", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/021_knowledge_hub_phase6_editorial_automation.sql", import.meta.url),
    "utf8"
  );
  const worker = readFileSync(
    new URL("../api/marketing-editorial-automation-worker.js", import.meta.url),
    "utf8"
  );
  const management = readFileSync(
    new URL("../api/marketing-editorial-automation.js", import.meta.url),
    "utf8"
  );
  const ui = readFileSync(
    new URL("../components/KnowledgeHubV6Panels.jsx", import.meta.url),
    "utf8"
  );
  const vercel = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
  for (const table of [
    "knowledge_automation_settings",
    "knowledge_automation_opportunities",
    "knowledge_automation_runs",
    "knowledge_automation_jobs",
    "knowledge_automation_logs",
    "knowledge_automation_briefings",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /idempotency_key text not null unique/i);
  assert.doesNotMatch(migration, /drop table|drop column|create policy/i);
  assert.match(worker, /ready_for_review/);
  assert.match(worker, /Review-only proposal prepared/);
  assert.match(worker, /recoverStaleJobs/);
  assert.match(worker, /action: "queue_recovery"/);
  assert.match(worker, /knowledge_automation_logs/);
  assert.match(management, /Only draft opportunities can be approved/);
  assert.match(management, /Automated draft preparation is disabled/);
  assert.match(ui, /Only you can approve an article/);
  assert.match(ui, /automatic publication, approval, scheduling/);
  assert.match(vercel, /marketing-editorial-automation-worker/);
  for (const forbidden of [
    'case "publish"',
    'case "approveArticle"',
    'case "schedulePublication"',
    'case "sendEmail"',
    'case "sendSms"',
    'case "postSocial"',
  ]) {
    assert.equal(`${worker}\n${management}`.includes(forbidden), false);
  }
});
