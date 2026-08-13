import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_ARTICLE_ROUTE_PREFIX,
  buildKnowledgeArticleWebsiteIndexRow,
  isVerifiedLiveKnowledgeArticle,
  missingKnowledgeArticleWebsiteIndexRows,
} from "../lib/knowledgeArticleWebsiteIndex.js";

const liveArticle = (extra = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "How to Compare Used Vans for Sale",
  slug: "compare-used-vans-for-sale",
  excerpt: "Compare condition, mileage and history before choosing a used van.",
  category: "Vehicle Guides",
  status: "approved",
  is_active: true,
  wix_item_id: "wix-item-1",
  wix_publication_status: "live",
  ...extra,
});

test("verified live approved articles are eligible and Wix drafts are not", () => {
  assert.equal(isVerifiedLiveKnowledgeArticle(liveArticle()), true);
  assert.equal(isVerifiedLiveKnowledgeArticle(liveArticle({ wix_publication_status: "draft" })), false);
  assert.equal(isVerifiedLiveKnowledgeArticle(liveArticle({ wix_item_id: "" })), false);
  assert.equal(isVerifiedLiveKnowledgeArticle(liveArticle({ status: "draft" })), false);
  assert.equal(isVerifiedLiveKnowledgeArticle(liveArticle({ is_active: false })), false);
});

test("auto-index uses the verified Wix Knowledge Hub dynamic article route", () => {
  const row = buildKnowledgeArticleWebsiteIndexRow(liveArticle(), "2026-08-13T12:00:00.000Z");
  assert.equal(KNOWLEDGE_ARTICLE_ROUTE_PREFIX, "/knowledge-hub-articles/");
  assert.equal(row.url, "/knowledge-hub-articles/compare-used-vans-for-sale");
  assert.equal(row.category, "Knowledge Hub");
  assert.equal(row.page_type, "knowledge_article");
  assert.equal(row.product, "finance");
  assert.equal(row.source, "wix");
  assert.equal(row.external_id, "wix-item-1");
  assert.equal(row.knowledge_article_id, liveArticle().id);
  assert.equal(row.approval_status, "approved");
  assert.equal(row.verified, true);
  assert.equal(row.verification_source, "wix_sync");
});

test("Rent2Buy live articles are indexed into the Rent2Buy product pool", () => {
  const row = buildKnowledgeArticleWebsiteIndexRow(liveArticle({
    title: "How Does Rent2Buy Work?",
    slug: "how-rent2buy-works",
  }));
  assert.equal(row.product, "rent2buy");
});

test("existing manual or hidden mappings prevent duplicate auto-index rows", () => {
  const article = liveArticle();
  const rows = missingKnowledgeArticleWebsiteIndexRows({
    articles: [article],
    existingPages: [{
      id: "existing",
      knowledge_article_id: article.id,
      active: false,
      approval_status: "hidden",
      verified: true,
    }],
  });
  assert.deepEqual(rows, []);
});

test("only missing verified-live article mappings are generated", () => {
  const first = liveArticle();
  const second = liveArticle({
    id: "22222222-2222-4222-8222-222222222222",
    title: "What Warranty Coverage Is Included with Your Van Purchase?",
    slug: "van-warranty-coverage",
    wix_item_id: "wix-item-2",
  });
  const draftOnly = liveArticle({
    id: "33333333-3333-4333-8333-333333333333",
    slug: "draft-only",
    wix_item_id: "wix-item-3",
    wix_publication_status: "draft",
  });

  const rows = missingKnowledgeArticleWebsiteIndexRows({
    articles: [first, second, draftOnly],
    existingPages: [{ knowledge_article_id: first.id }],
    now: "2026-08-13T12:00:00.000Z",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].knowledge_article_id, second.id);
  assert.equal(rows[0].url, "/knowledge-hub-articles/van-warranty-coverage");
});
