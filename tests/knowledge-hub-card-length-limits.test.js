import test from "node:test";
import assert from "node:assert/strict";

import {
  KNOWLEDGE_CARD_EXCERPT_MAX,
  KNOWLEDGE_CARD_TITLE_MAX,
  calculateKnowledgeQualityChecks,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";

function article(overrides = {}) {
  return {
    title: "T".repeat(KNOWLEDGE_CARD_TITLE_MAX),
    slug: "knowledge-hub-card-length-test",
    excerpt: "E".repeat(KNOWLEDGE_CARD_EXCERPT_MAX),
    seo_title: "Knowledge Hub Card Length Test Article",
    meta_description:
      "Regression fixture used to verify the permanent Knowledge Hub title and excerpt card limits before saving content.",
    content_markdown: "## Test section\n\nThis is enough article content to pass the minimum content validation while testing card field lengths only.",
    faq_json: [],
    cta: "View current used vans.",
    ...overrides,
  };
}

test("Knowledge Hub card title and excerpt limits are fixed at 60 and 149", () => {
  assert.equal(KNOWLEDGE_CARD_TITLE_MAX, 60);
  assert.equal(KNOWLEDGE_CARD_EXCERPT_MAX, 149);
});

test("an article exactly on both card limits passes card validation", () => {
  const errors = validateKnowledgeArticle(article());
  assert.equal(errors.title, undefined);
  assert.equal(errors.excerpt, undefined);
});

test("a title over 60 characters is rejected before save", () => {
  const errors = validateKnowledgeArticle(
    article({ title: "T".repeat(KNOWLEDGE_CARD_TITLE_MAX + 1) })
  );
  assert.match(errors.title, /60 characters or fewer/);
});

test("an excerpt over 149 characters is rejected before save", () => {
  const errors = validateKnowledgeArticle(
    article({ excerpt: "E".repeat(KNOWLEDGE_CARD_EXCERPT_MAX + 1) })
  );
  assert.match(errors.excerpt, /149 characters or fewer/);
});

test("quality checks visibly report both hard card limits", () => {
  const checks = calculateKnowledgeQualityChecks(article());
  assert.equal(checks.find((check) => check.key === "card_title_length")?.pass, true);
  assert.equal(checks.find((check) => check.key === "card_excerpt_length")?.pass, true);

  const failing = calculateKnowledgeQualityChecks(
    article({
      title: "T".repeat(KNOWLEDGE_CARD_TITLE_MAX + 1),
      excerpt: "E".repeat(KNOWLEDGE_CARD_EXCERPT_MAX + 1),
    })
  );
  assert.equal(failing.find((check) => check.key === "card_title_length")?.pass, false);
  assert.equal(failing.find((check) => check.key === "card_excerpt_length")?.pass, false);
});
