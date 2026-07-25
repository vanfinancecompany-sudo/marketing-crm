import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EDITORIAL_CATEGORY_WEIGHTS,
  applyIntentOverrides,
  articleContentHash,
  buildApprovalQueue,
  buildArticleHealth,
  buildArticleReviewSummary,
  buildKnowledgeCoverageMap,
  calculateEditorialScore,
  normalizeEditorialAnalysis,
} from "../lib/editorialIntelligence.js";

const scores = (score = 80) =>
  Object.fromEntries(
    Object.keys(EDITORIAL_CATEGORY_WEIGHTS).map((key) => [
      key,
      { score, reason: `${key} evidence`, lost_points: 100 - score },
    ])
  );

const analysis = {
  intent: {
    primary_product: "finance",
    secondary_product: "Rent2Buy",
    customer_journey: "decision",
    search_intent: "commercial",
    conversion_goal: "Browse Finance Vans",
    confidence_score: 86,
  },
  structured_ctas: [
    {
      role: "primary",
      button_text: "Browse Finance Vans",
      destination: "/finance-vans",
      order: 1,
      reason: "Matches the decision-stage intent.",
      confidence_score: 90,
    },
  ],
  internal_links: [
    {
      target_type: "article",
      target_id: "related",
      anchor_text: "finance application guide",
      context: "After the eligibility section.",
      relevance_score: 88,
    },
  ],
  business_recommendations: [
    {
      key: "mention_delivery",
      title: "Mention delivery",
      suggestion: "Explain nationwide delivery.",
      brain_section_key: "products",
      source_excerpt: "nationwide delivery",
      target_field: "content_markdown",
      confidence_score: 92,
    },
    {
      key: "unsupported",
      title: "Invented claim",
      suggestion: "Add a claim.",
      brain_section_key: "products",
      source_excerpt: "guaranteed approval",
      target_field: "content_markdown",
      confidence_score: 99,
    },
  ],
  category_scores: scores(82),
  strengths: ["Clear customer intent"],
  weaknesses: ["Meta description can be stronger"],
  suggested_improvements: [
    {
      key: "meta",
      title: "Improve meta description",
      description: "Make the benefit and intent clearer.",
      target_field: "meta_description",
      expected_gain: 4,
    },
  ],
  coverage_concepts: [
    { concept_key: "affordability", relevance_score: 78, evidence: "Monthly budget guidance." },
  ],
  warnings: [],
};

test("Business Intent Engine normalises AI metadata and preserves manual overrides", () => {
  const intent = applyIntentOverrides(analysis.intent, {
    primary_product: "both",
    conversion_goal: "Contact Us",
  });
  assert.equal(intent.primary_product, "both");
  assert.equal(intent.customer_journey, "decision");
  assert.equal(intent.conversion_goal, "Contact Us");
  assert.equal(intent.confidence_score, 86);
});

test("structured editorial analysis validates CTA, linking, Brain evidence and coverage", () => {
  const result = normalizeEditorialAnalysis(analysis, {
    articles: [{ id: "related" }],
    businessPages: [],
    concepts: [{ concept_key: "affordability" }],
    allowedCtaDestinations: ["/finance-vans"],
    brainSections: [
      {
        section_key: "products",
        content: "We offer nationwide delivery for eligible vehicle purchases.",
        entries: [],
      },
    ],
  });
  assert.equal(result.structured_ctas.length, 1);
  assert.equal(result.internal_links.length, 1);
  assert.equal(result.business_recommendations.length, 1);
  assert.equal(result.business_recommendations[0].key, "mention_delivery");
  assert.equal(result.coverage_concepts[0].concept_key, "affordability");
});

test("Article Scoring Engine applies weights, grades, confidence and blocking safeguards", () => {
  const weightTotal = Object.values(EDITORIAL_CATEGORY_WEIGHTS).reduce((total, value) => total + value, 0);
  assert.equal(Number(weightTotal.toFixed(2)), 1);
  const ready = calculateEditorialScore(scores(90), { confidenceScore: 90 });
  assert.equal(ready.overall_score, 90);
  assert.equal(ready.grade, 5);
  assert.equal(ready.confidence, "high");
  assert.equal(ready.publication_status, "ready");
  assert.equal(ready.lost_points.length, Object.keys(EDITORIAL_CATEGORY_WEIGHTS).length);

  const unsafe = scores(90);
  unsafe.business_accuracy.score = 40;
  const blocked = calculateEditorialScore(unsafe, { confidenceScore: 95 });
  assert.equal(blocked.publication_status, "blocked");
});

test("approval queue prioritises ready articles while marking reviewed AI improvements", () => {
  const articles = [
    { id: "ready", title: "Ready", status: "draft", topic_id: "topic", updated_at: new Date().toISOString() },
    { id: "working", title: "Working", status: "draft", topic_id: "topic", updated_at: new Date().toISOString() },
  ];
  const queue = buildApprovalQueue({
    articles,
    topics: [{ id: "topic", estimated_value: 5, priority: 5 }],
    assessments: [
      { article_id: "ready", grade: 5, overall_score: 92, created_at: "2026-07-25T10:00:00Z", category_scores: { conversion_potential: { score: 90 } } },
      { article_id: "working", grade: 4, overall_score: 84, created_at: "2026-07-25T10:00:00Z", category_scores: { conversion_potential: { score: 80 } } },
    ],
    proposals: [{ article_id: "working", status: "review" }],
  });
  assert.equal(queue[0].article.id, "ready");
  assert.equal(queue[0].queue_state, "ready");
  assert.equal(queue[1].queue_state, "ai_improving");
});

test("coverage engine measures approved knowledge and avoids duplicate topic intent", () => {
  const result = buildKnowledgeCoverageMap({
    concepts: [
      { id: "c1", concept_key: "vat", label: "VAT", aliases: ["value added tax"], active: true },
      { id: "c2", concept_key: "documentation", label: "Documentation", aliases: [], active: true },
    ],
    articles: [
      { id: "a1", title: "VAT on vans", status: "approved" },
      { id: "a2", title: "Draft documentation", status: "draft" },
    ],
    articleConcepts: [
      { article_id: "a1", concept_id: "c1", relevance_score: 90 },
      { article_id: "a2", concept_id: "c2", relevance_score: 95 },
    ],
    topics: [],
  });
  const vat = result.find((item) => item.id === "c1");
  const documentation = result.find((item) => item.id === "c2");
  assert.equal(vat.coverage_score > 60, true);
  assert.equal(vat.recommended_topic, "");
  assert.equal(documentation.coverage_score, 0);
  assert.equal(documentation.recommended_topic, "");
});

test("score explanation feeds article health and under-one-minute review summary", () => {
  const assessment = normalizeEditorialAnalysis(analysis, {
    articles: [{ id: "related" }],
    concepts: [{ concept_key: "affordability" }],
    brainSections: [{ section_key: "products", content: "nationwide delivery", entries: [] }],
    allowedCtaDestinations: ["/finance-vans"],
  });
  const article = { content_markdown: "Useful content ".repeat(450) };
  const summary = buildArticleReviewSummary(article, assessment);
  const health = buildArticleHealth(assessment, assessment.intent, false);
  assert.equal(summary.reading_time_minutes, 4);
  assert.equal(summary.review_time_minutes >= 1, true);
  assert.equal(summary.recommended_action, "minor_review");
  assert.equal(health.overall_health, assessment.overall_score);
  assert.equal(Array.isArray(health.warnings), true);
});

test("content hashing changes only when editorial article content changes", () => {
  const article = { title: "Guide", content_markdown: "Version one", status: "draft" };
  assert.equal(articleContentHash(article), articleContentHash({ ...article, status: "approved" }));
  assert.notEqual(articleContentHash(article), articleContentHash({ ...article, content_markdown: "Version two" }));
});

test("Phase 5 is additive, review-only and centralises Business Brain prompts", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/020_knowledge_hub_phase5_editorial_engine.sql", import.meta.url),
    "utf8"
  );
  const api = readFileSync(new URL("../api/marketing-editorial-engine.js", import.meta.url), "utf8");
  for (const table of [
    "knowledge_article_intents",
    "knowledge_article_editorial_assessments",
    "knowledge_article_editorial_overrides",
    "knowledge_article_concepts",
    "knowledge_article_revisions",
    "knowledge_article_improvement_proposals",
    "knowledge_editorial_events",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.doesNotMatch(migration, /drop table|drop column|create policy/i);
  assert.match(api, /buildAiPlatformPrompt/);
  assert.match(api, /Do not rewrite or approve it/);
  assert.match(api, /must not be applied/);
  assert.doesNotMatch(api, /case "publish"|case "send"|case "post"/i);
});
