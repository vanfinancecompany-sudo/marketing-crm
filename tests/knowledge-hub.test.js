import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateKnowledgeQualityChecks,
  buildKnowledgeAnalytics,
  findKnowledgeArticleDuplicates,
  findKnowledgeTopicDuplicates,
  parseKnowledgeArticleResponse,
  parseKnowledgeTopicIdeasResponse,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";
import knowledgeHubHandler, {
  knowledgeAiConfiguration,
} from "../api/marketing-knowledge-hub.js";

const validArticle = {
  title: "How van finance works",
  slug: "how-van-finance-works",
  seo_title: "How Van Finance Works for UK Buyers",
  meta_description:
    "A practical guide to how van finance works, what information you may need and the choices to review before applying for a van.",
  excerpt: "A clear explanation of the van finance process.",
  content_markdown: "## Introduction\n\nUseful factual content for a customer. ".repeat(30),
  content_html: "<h2>Introduction</h2>",
  faq_json: [{ question: "Can I apply?", answer: "Eligibility depends on your circumstances." }],
  cta: "View available vans and apply when you are ready.",
  internal_link_suggestions: ["Van finance eligibility"],
  generation_metadata: {},
};

test("structured article parser accepts valid output and rejects invalid AI responses", () => {
  const parsed = parseKnowledgeArticleResponse(JSON.stringify(validArticle));
  assert.equal(parsed.slug, "how-van-finance-works");
  assert.equal(parsed.faq_json.length, 1);
  assert.throws(() => parseKnowledgeArticleResponse("{bad json"), /invalid JSON/);
  assert.throws(() => parseKnowledgeArticleResponse({ title: "Incomplete" }), /missing/);
});

test("topic duplicate protection detects exact and obvious near matches", () => {
  const topics = [
    {
      id: "topic-1",
      title: "How Van Finance Works",
      primary_keyword: "van finance process",
      secondary_keywords: [],
    },
  ];
  assert.equal(findKnowledgeTopicDuplicates({ title: "how van finance works" }, topics)[0].exact, true);
  assert.equal(
    findKnowledgeTopicDuplicates(
      { title: "Van finance process guide", primary_keyword: "how van finance works" },
      topics
    )[0].topic.id,
    "topic-1"
  );
  assert.equal(
    findKnowledgeTopicDuplicates(
      { title: "Vehicle inspection checklist" },
      [{ title: "Vehicle inspection checklist" }]
    )[0].exact,
    true
  );
});

test("Topic Finder parser validates and normalises structured suggestions", () => {
  const ideas = parseKnowledgeTopicIdeasResponse({
    ideas: [
      {
        title: "What documents do self-employed van buyers need?",
        category: "Self Employed",
        primary_keyword: "self employed van finance documents",
        secondary_keywords: ["proof of income"],
        intent: "Prepare for an application",
        rationale: "Closes a practical preparation gap.",
        priority: 5,
      },
    ],
  });
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].priority, 5);
  assert.equal(ideas[0].source, "ai_topic_finder");
  assert.throws(
    () => parseKnowledgeTopicIdeasResponse({ wrong: [] }),
    /structured topic ideas/
  );
});

test("content intelligence analytics explain quality, freshness, duplicates and gaps", () => {
  const topics = [
    { id: "t1", title: "Van finance explained", category: "Van Finance", priority: 5, status: "ready" },
    { id: "t2", title: "Van finance explained guide", category: "Van Finance", priority: 4, status: "idea" },
  ];
  const articles = [
    {
      ...validArticle,
      id: "a1",
      topic_id: "t1",
      category: "Van Finance",
      article_type: "finance-guide",
      status: "approved",
      updated_at: "2025-01-01T00:00:00.000Z",
      quality_checks: [{ key: "cta", label: "CTA", pass: false }],
    },
    {
      ...validArticle,
      id: "a2",
      topic_id: "t2",
      title: "How van finance works guide",
      category: "Van Finance",
      article_type: "finance-guide",
      status: "draft",
      quality_checks: [{ key: "cta", label: "CTA", pass: true }],
    },
  ];
  const analytics = buildKnowledgeAnalytics({
    topics,
    articles,
    freshnessDays: 180,
    now: new Date("2026-07-25T00:00:00.000Z"),
  });
  assert.equal(analytics.by_status.approved, 1);
  assert.equal(analytics.by_template["finance-guide"], 2);
  assert.equal(analytics.quality.pass_rate, 50);
  assert.equal(analytics.freshness.stale_articles.length, 1);
  assert.equal(analytics.missing_coverage.some((item) => item.category === "Rent2Buy"), true);
  assert.equal(findKnowledgeArticleDuplicates(articles).length > 0, true);
});

test("article validation and transparent quality checks expose warnings", () => {
  const shortArticle = { ...validArticle, content_markdown: "short", cta: "" };
  assert.equal(
    calculateKnowledgeQualityChecks(shortArticle, 1000).find(
      (check) => check.key === "adequate_length"
    ).pass,
    false
  );
  assert.equal(Boolean(validateKnowledgeArticle(shortArticle).content_markdown), true);
});

test("Knowledge Hub endpoint rejects requests without Marketing CRM access", async () => {
  const previous = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = "expected-secret";
  const response = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return payload;
    },
  };
  await knowledgeHubHandler(
    { method: "POST", headers: {}, body: { action: "load" } },
    response
  );
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.ok, false);
  if (previous === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = previous;
});

test("AI configuration reads server variables without exposing the key", () => {
  const configured = knowledgeAiConfiguration({
    OPENAI_API_KEY: "  secret-value  ",
    OPENAI_MODEL: "gpt-4.1-mini",
    VERCEL_ENV: "preview",
    VERCEL_URL: "marketing-preview.example",
    VERCEL_GIT_COMMIT_REF: "agent/knowledge-hub-v1-marketing",
  });
  assert.deepEqual(configured, {
    configured: true,
    model: "gpt-4.1-mini",
    environment: "preview",
    deployment_host: "marketing-preview.example",
    commit_ref: "agent/knowledge-hub-v1-marketing",
  });
  assert.doesNotMatch(JSON.stringify(configured), /secret-value/);
  assert.equal(knowledgeAiConfiguration({ VERCEL_ENV: "production" }).configured, false);
  assert.equal(knowledgeAiConfiguration({}).model, "gpt-4.1-mini");
});

test("route, sidebar and page expose the complete Knowledge Hub workflow", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const navigation = readFileSync(
    new URL("../public/shared/sidebar-navigation.js", import.meta.url),
    "utf8"
  );
  const page = readFileSync(new URL("../pages/KnowledgeHubPage.jsx", import.meta.url), "utf8");
  const panels = readFileSync(
    new URL("../components/KnowledgeHubV2Panels.jsx", import.meta.url),
    "utf8"
  );
  const workflow = `${page}\n${panels}`;
  assert.match(app, /"Knowledge Hub": "\/knowledge-hub"/);
  assert.match(app, /case "Knowledge Hub"/);
  assert.match(navigation, /label: "Knowledge Hub"/);
  for (const label of [
    "Topic Library",
    "Generate Article",
    "Article Library",
    "Article Editor",
    "Quality checklist",
    "Approve Selected",
    "Archive Selected",
    "Business Settings",
  ]) {
    assert.match(workflow, new RegExp(label));
  }
  assert.match(page, /MARKETING_ACCESS_DENIED_EVENT/);
  assert.match(page, /validateMarketingAccessKey/);
});

test("Knowledge Hub V2 exposes planning, Topic Finder, batch drafts, settings and analytics", () => {
  const page = readFileSync(new URL("../pages/KnowledgeHubPage.jsx", import.meta.url), "utf8");
  const panels = readFileSync(
    new URL("../components/KnowledgeHubV2Panels.jsx", import.meta.url),
    "utf8"
  );
  const api = readFileSync(
    new URL("../api/marketing-knowledge-hub.js", import.meta.url),
    "utf8"
  );
  const combined = `${page}\n${panels}\n${api}`;
  for (const label of [
    "Content Intelligence V2",
    "Topic Planner",
    "AI Topic Finder",
    "Batch Article Generation",
    "Business Settings",
    "Specialist AI Prompt Templates",
    "Quality pass rate",
    "Freshness",
    "Duplicate review",
    "Missing coverage",
  ]) {
    assert.match(combined, new RegExp(label));
  }
  assert.match(page, /for \(const topic of selected\)/);
  assert.match(api, /case "findTopics"/);
  assert.match(api, /case "saveTopicIdeas"/);
  assert.match(api, /case "saveTemplate"/);
  assert.doesNotMatch(api, /case "publish/i);
});

test("V2 migration is additive and installs priorities, settings and specialist templates", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/017_knowledge_hub_v2_content_intelligence.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /alter table public\.knowledge_topics/);
  assert.match(migration, /add column if not exists priority/);
  assert.match(migration, /alter table public\.knowledge_settings/);
  for (const field of [
    "business_description",
    "products_services",
    "factual_guidance",
    "prohibited_claims",
    "target_audiences",
    "content_goals",
    "freshness_days",
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${field}`));
  }
  for (const key of [
    "finance-guide",
    "rent2buy-guide",
    "vehicle-review",
    "comparison",
    "buying-guide",
    "faq",
  ]) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(migration, /create policy/i);
  assert.doesNotMatch(migration, /marketing_contacts|marketing_campaigns|vehicle_stock/i);
});

test("migration is additive, private and seeds all seven templates", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/016_knowledge_hub_v1.sql", import.meta.url),
    "utf8"
  );
  for (const table of [
    "knowledge_topics",
    "knowledge_templates",
    "knowledge_articles",
    "knowledge_settings",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.doesNotMatch(migration, /create policy/i);
  assert.equal((migration.match(/^\s*\('[^']+',\s*'(?:faq|finance-guide|rent2buy-guide|buying-guide|vehicle-guide|comparison|checklist)'/gm) || []).length, 7);
});
