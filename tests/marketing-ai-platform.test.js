import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_CONTENT_CHANNELS,
  AI_REVIEW_CATEGORY_KEYS,
  buildTopicPlannerSections,
  calculateArticleSeoIntelligence,
  calculateBusinessBrainCompleteness,
  normalizeAiReview,
  parseAiContentAsset,
  parseWebsiteIntelligence,
  recommendInternalLinks,
} from "../lib/aiMarketingPlatform.js";
import { buildAiPlatformPrompt } from "../lib/businessIntelligence.js";

test("Phase 4 supports all requested draft channels and review dimensions", () => {
  assert.deepEqual(
    AI_CONTENT_CHANNELS.map((channel) => channel.key),
    ["email", "facebook", "linkedin", "google_business_profile", "x", "sms", "meta_ad"]
  );
  assert.deepEqual(AI_REVIEW_CATEGORY_KEYS, [
    "brand_voice",
    "vocabulary",
    "compliance",
    "seo",
    "readability",
    "repetition",
    "cta_quality",
    "generic_wording",
    "hallucination_risk",
  ]);
});

test("central prompt builder assembles Business Brain and a requested module task", () => {
  const result = buildAiPlatformPrompt({
    sections: [
      { section_key: "brand_voice", title: "Brand Voice", content: "Clear and helpful.", entries: [], active: true },
      { section_key: "business_vocabulary", title: "Business Vocabulary", content: "", entries: [{ label: "Rent2Buy", value: "Use this spelling." }], active: true },
      { section_key: "preferred_ctas", title: "Preferred CTAs", content: "Apply when ready.", entries: [], active: true },
    ],
    specialist: { key: "email", prompt: "Write an email draft." },
    module: "content_factory",
    task: "content_asset_generation",
    requestedTask: "Create one email asset.",
    sourceContent: "Approved source article.",
  });
  assert.match(result.prompt, /Clear and helpful/);
  assert.match(result.prompt, /Rent2Buy: Use this spelling/);
  assert.match(result.prompt, /Apply when ready/);
  assert.match(result.prompt, /Create one email asset/);
  assert.match(result.prompt, /Approved source article/);
  assert.equal(result.metadata.prompt_version, "ai_platform_v1");
  assert.equal(result.metadata.module, "content_factory");
});

test("Business Brain completeness is transparent and deterministic", () => {
  const result = calculateBusinessBrainCompleteness([
    { section_key: "company_profile", content: "Confirmed company facts for customers.", entries: [{ label: "Area", value: "UK" }], active: true },
    { section_key: "products", content: "", entries: [], active: true },
  ]);
  assert.equal(result.sections.find((section) => section.key === "company_profile").score > 0, true);
  assert.equal(result.sections.find((section) => section.key === "products").score, 0);
  assert.equal(result.overall >= 0 && result.overall <= 100, true);
});

test("SEO Intelligence reports requested scores and structural warnings", () => {
  const article = {
    id: "article-1",
    title: "Van finance guide",
    status: "draft",
    category: "Van Finance",
    seo_title: "Van Finance Guide",
    meta_description: "Short",
    content_markdown: "## Introduction\n\nA short paragraph.",
    faq_json: [],
    cta: "",
    internal_link_suggestions: [],
    generation_metadata: {},
  };
  const score = calculateArticleSeoIntelligence(article, [
    article,
    { id: "article-2", title: "Van finance guide", status: "approved" },
  ]);
  assert.equal(score.flags.missing_headings, true);
  assert.equal(score.flags.missing_faq, true);
  assert.equal(score.flags.duplicate_title, true);
  assert.equal(score.flags.thin_content, true);
  for (const key of ["seo_score", "readability", "business_relevance", "cta_quality", "internal_linking", "overall_score"]) {
    assert.equal(score[key] >= 0 && score[key] <= 100, true);
  }
});

test("internal links remain suggestions and classify approved destinations", () => {
  const suggestions = recommendInternalLinks(
    { id: "source", title: "Van finance options", category: "Van Finance" },
    [
      { id: "finance", title: "Van finance eligibility", category: "Van Finance", article_type: "finance-guide", status: "approved" },
      { id: "rent", title: "Rent2Buy questions", category: "Rent2Buy", article_type: "faq", status: "approved" },
      { id: "draft", title: "Draft guide", category: "Van Finance", status: "draft" },
    ]
  );
  assert.equal(suggestions.some((item) => item.type === "Finance page"), true);
  assert.equal(suggestions.some((item) => item.type === "Rent2Buy page"), true);
  assert.equal(suggestions.some((item) => item.article_id === "draft"), false);
});

test("planner derives all seven review sections without adding a publish action", () => {
  const result = buildTopicPlannerSections({
    topics: [
      { id: "priority", title: "Priority", category: "Van Finance", priority: 5, estimated_value: 5 },
      { id: "seasonal", title: "Seasonal", category: "Rent2Buy", seasonal: true },
    ],
    articles: [
      { id: "approved", title: "Approved", category: "Van Finance", status: "approved", approved_at: "2026-07-24T00:00:00Z", updated_at: "2026-07-24T00:00:00Z" },
    ],
    now: new Date("2026-07-25T00:00:00Z"),
  });
  assert.deepEqual(Object.keys(result), [
    "high_priority",
    "seasonal",
    "missing_coverage",
    "refresh_needed",
    "recently_published",
    "duplicate_risks",
    "opportunities",
  ]);
  assert.equal(result.seasonal[0].id, "seasonal");
  assert.equal(result.recently_published[0].id, "approved");
});

test("structured asset, website and reviewer parsers reject incomplete output", () => {
  assert.equal(parseAiContentAsset({ title: "Email", body: "Draft", preview_text: "", cta: "", warnings: [] }).title, "Email");
  assert.throws(() => parseAiContentAsset({ title: "Missing body" }), /incomplete/);
  assert.equal(parseWebsiteIntelligence({ company: ["Fact"], products: [], faqs: [], services: [], tone: [], vocabulary: [], personas: [], ctas: [] }).company[0], "Fact");
  assert.throws(() => parseWebsiteIntelligence({ company: [] }), /No reviewable/);
  const review = normalizeAiReview({
    overall_score: 80,
    summary: "Review",
    categories: Object.fromEntries(AI_REVIEW_CATEGORY_KEYS.map((key) => [key, { score: 80, reason: key }])),
    recommendations: ["Review manually"],
    warnings: [],
  });
  assert.equal(review.categories.compliance.score, 80);
});

test("Phase 4 implementation exposes draft-only workflows and one additive migration", () => {
  const migration = readFileSync(new URL("../supabase/migrations/019_marketing_crm_phase4_ai_platform.sql", import.meta.url), "utf8");
  const api = readFileSync(new URL("../api/marketing-ai-platform.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../pages/ContentFactoryPage.jsx", import.meta.url), "utf8");
  const planner = readFileSync(new URL("../components/KnowledgeHubV2Panels.jsx", import.meta.url), "utf8");
  const campaigns = readFileSync(new URL("../pages/MarketingCentrePage.jsx", import.meta.url), "utf8");
  const combined = `${api}\n${page}\n${planner}\n${campaigns}`;

  for (const table of ["marketing_ai_assets", "knowledge_website_imports", "marketing_ai_reviews"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /alter table public\.knowledge_topics/);
  assert.match(migration, /alter table public\.marketing_campaigns/);
  assert.doesNotMatch(migration, /drop table|drop column|create policy/i);
  for (const label of [
    "AI Content Factory",
    "Import Website",
    "SEO Intelligence dashboard",
    "Internal linking recommendations",
    "Find 100 New Topics",
    "Create Campaign From Article",
    "AI Review Engine",
  ]) {
    assert.match(combined, new RegExp(label));
  }
  assert.match(api, /status: "draft"/);
  assert.match(api, /Run AI Review on the current draft before approving it/);
  assert.doesNotMatch(api, /case "publish"|case "send"|case "post"/i);
});
