import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compareFaqCollections, normalizeFaqCollection } from "../lib/faqNormalization.js";
import { verifyAcceptedCorrection } from "../lib/knowledgeCorrectionState.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const baseArticle = {
  title: "Title",
  slug: "title",
  seo_title: "SEO",
  meta_description: "Meta",
  excerpt: "Excerpt",
  content_markdown: "## Intro\n\nBody",
  faq_json: [{ question: "What is it?", answer: "A useful answer." }],
  cta: "Apply",
  category: "Guide",
  article_type: "guide",
  featured_image: "",
  generation_metadata: {},
};

test("JSON string and parsed FAQ array normalise identically", () => {
  const stringValue = JSON.stringify([{ answer: "A useful answer.", question: "What is it?" }]);
  assert.deepEqual(normalizeFaqCollection(stringValue), normalizeFaqCollection(baseArticle.faq_json));
});

test("wrapper objects, key order, whitespace, line endings and database metadata are ignored", () => {
  const saved = {
    faqs: [{
      id: "database-id",
      created_at: "2026-07-27T12:00:00Z",
      order: 1,
      answer: "  A useful\r\nanswer.  ",
      question: " What is it? ",
    }],
  };
  const proposed = [{ question: "What is it?", answer: "A useful\nanswer." }];
  assert.equal(compareFaqCollections(proposed, saved).equal, true);
});

test("null, missing and empty FAQ collections normalise to empty arrays", () => {
  assert.deepEqual(normalizeFaqCollection(null), []);
  assert.deepEqual(normalizeFaqCollection(undefined), []);
  assert.deepEqual(normalizeFaqCollection(""), []);
  assert.equal(compareFaqCollections(null, []).equal, true);
});

test("empty FAQ rows are removed", () => {
  const value = [{ question: "", answer: "" }, { question: " Real question? ", answer: " Real answer. " }];
  assert.deepEqual(normalizeFaqCollection(value), [{ question: "Real question?", answer: "Real answer." }]);
});

test("semantically identical FAQs pass corrected-draft verification", () => {
  const saved = { ...baseArticle, faq_json: JSON.stringify({ items: [{ id: "1", answer: " A useful answer. ", question: "What is it?" }] }) };
  const result = verifyAcceptedCorrection(saved, baseArticle, []);
  assert.equal(result.correction_save_verified, true);
  assert.deepEqual(result.correction_save_verification_errors, []);
});

test("changed question returns exact FAQ mismatch details", () => {
  const comparison = compareFaqCollections(baseArticle.faq_json, [{ question: "Different?", answer: "A useful answer." }]);
  assert.equal(comparison.equal, false);
  assert.equal(comparison.error.exact_field, "faq_json");
  assert.equal(comparison.error.mismatch_type, "question_changed");
  assert.equal(comparison.error.proposal_faq_count, 1);
  assert.equal(comparison.error.saved_faq_count, 1);
  assert.equal(comparison.error.mismatched_faq_index, 0);
  assert.equal(comparison.error.proposed_question, "What is it?");
  assert.equal(comparison.error.saved_question, "Different?");
});

test("changed answer returns exact FAQ mismatch details", () => {
  const comparison = compareFaqCollections(baseArticle.faq_json, [{ question: "What is it?", answer: "Changed." }]);
  assert.equal(comparison.equal, false);
  assert.equal(comparison.error.mismatch_type, "answer_changed");
  assert.equal(comparison.error.proposed_answer, "A useful answer.");
  assert.equal(comparison.error.saved_answer, "Changed.");
});

test("missing FAQ fails verification", () => {
  const comparison = compareFaqCollections(baseArticle.faq_json, []);
  assert.equal(comparison.equal, false);
  assert.equal(comparison.error.mismatch_type, "missing_saved_faq");
  assert.equal(comparison.error.proposal_faq_count, 1);
  assert.equal(comparison.error.saved_faq_count, 0);
});

test("extra FAQ fails verification", () => {
  const comparison = compareFaqCollections([], baseArticle.faq_json);
  assert.equal(comparison.equal, false);
  assert.equal(comparison.error.mismatch_type, "unexpected_saved_faq");
  assert.equal(comparison.error.proposal_faq_count, 0);
  assert.equal(comparison.error.saved_faq_count, 1);
});

test("FAQ order remains meaningful", () => {
  const proposed = [{ question: "First?", answer: "One." }, { question: "Second?", answer: "Two." }];
  const saved = [...proposed].reverse();
  const comparison = compareFaqCollections(proposed, saved);
  assert.equal(comparison.equal, false);
  assert.equal(comparison.error.mismatch_type, "question_changed");
  assert.equal(comparison.error.mismatched_faq_index, 0);
});

test("genuine FAQ mismatch keeps proposal and blocks approval and Wix", async () => {
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(wix, /status: "verification_failed"/);
  assert.match(wix, /\.\.\.correctionState/);
  assert.doesNotMatch(wix, /status: "verification_failed"[\s\S]{0,180}proposal: null/);
  assert.match(wix, /correctionSaveVerified[\s\S]*actionDisabled/);
  assert.match(wix, /Save and verify the corrected draft before approval and Wix export/);
});

test("proposal submission and acceptance API use the canonical FAQ normaliser", async () => {
  const service = await read("../services/publishingCorrections.js");
  const api = await read("../api/marketing-knowledge-corrections.js");
  assert.match(service, /faq_json: normalizeFaqCollection\(proposal\.after\?\.faq_json\)/);
  assert.match(api, /correctedArticle = \{ \.\.\.body\.corrected_article, faq_json: normalizeFaqCollection/);
  assert.match(api, /faq_json: normalizeFaqCollection\(articleUpdate\.faq_json\)/);
  assert.match(api, /faq_json: normalizeFaqCollection\(saved\.faq_json\)/);
});

test("no automatic approval or live Wix publication is added", async () => {
  const api = await read("../api/marketing-knowledge-corrections.js");
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(api, /approved: false/);
  assert.match(api, /wix_updated: false/);
  assert.match(wix, /It never publishes live/);
  assert.doesNotMatch(api, /status:\s*["']approved["']|status:\s*["']published["']/);
});
