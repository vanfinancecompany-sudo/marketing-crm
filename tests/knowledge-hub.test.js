import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateKnowledgeQualityChecks,
  findKnowledgeTopicDuplicates,
  parseKnowledgeArticleResponse,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";
import knowledgeHubHandler from "../api/marketing-knowledge-hub.js";

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

test("route, sidebar and page expose the complete Knowledge Hub workflow", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const navigation = readFileSync(
    new URL("../public/shared/sidebar-navigation.js", import.meta.url),
    "utf8"
  );
  const page = readFileSync(new URL("../pages/KnowledgeHubPage.jsx", import.meta.url), "utf8");
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
    "Knowledge Hub Settings",
  ]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /MARKETING_ACCESS_DENIED_EVENT/);
  assert.match(page, /validateMarketingAccessKey/);
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
