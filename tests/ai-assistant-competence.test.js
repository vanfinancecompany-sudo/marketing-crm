import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_ASSISTANT_TEST_LIBRARY,
  buildCompetencePrompt,
  buildKnowledgeGapReport,
  buildRetrievalCorpus,
  detectProduct,
  rankKnowledge,
  splitArticleMarkdown,
} from "../lib/aiAssistantCompetence.js";
import { competenceAuthorize, parseOpenAIAnswer, requestOpenAIAnswer } from "../api/marketing-ai-assistant-competence.js";

const sections = [
  { id: "brain-1", section_key: "products", title: "Products", active: true, content: "Finance is lender assessed. Rent2Buy has no credit check and is based on affordability.", entries: [] },
  { id: "brain-2", section_key: "faqs", title: "FAQs", active: true, content: "", entries: [{ label: "Can poor-credit customers apply?", value: "Customers may apply, but finance acceptance cannot be promised." }] },
  { id: "brain-3", section_key: "compliance", title: "Compliance", active: false, content: "This inactive rule must not enter retrieval.", entries: [] },
];
const articles = [{ id: "article-1", title: "Van finance with poor credit", category: "Van Finance", status: "approved", live_wix_url: "https://example.com/poor-credit", content_markdown: "## Can I apply?\n\nCustomers with poor credit can submit an application. A lender makes the decision.\n\n## Documents\n\nProof of identity and income may be requested.", faq_json: [{ question: "Is approval guaranteed?", answer: "No." }] }];

test("built-in competence library contains 50 broad internal tests", () => {
  assert.equal(AI_ASSISTANT_TEST_LIBRARY.length, 50);
  const categories = new Set(AI_ASSISTANT_TEST_LIBRARY.map((item) => item.category));
  for (const expected of ["finance", "rent2buy", "poor_credit", "self_employed", "limited_company", "documents", "delivery", "deposit", "application", "vehicle", "unknown", "conversation"]) assert.equal(categories.has(expected), true);
});

test("Markdown is split into temporary heading passages without creating stored chunks", () => {
  const passages = splitArticleMarkdown(articles[0]);
  assert.equal(passages.length, 2);
  assert.equal(passages[0].heading, "Can I apply?");
  assert.match(passages[1].passage, /Proof of identity/);
});

test("lexical ranking prioritises authoritative Business Brain and relevant FAQs", () => {
  const corpus = buildRetrievalCorpus({ sections, articles });
  assert.equal(corpus.some((item) => /inactive rule/.test(item.passage)), false);
  const ranked = rankKnowledge("Can I get finance with poor credit?", corpus);
  assert.equal(ranked.length > 0, true);
  assert.equal(["business_brain", "business_faq"].includes(ranked[0].type), true);
  assert.equal(ranked.some((item) => item.title === "Van finance with poor credit"), true);
  assert.equal(ranked.every((item) => typeof item.score === "number"), true);
});

test("product detection separates Finance, Rent2Buy, both and unknown", () => {
  assert.equal(detectProduct("Will a lender accept poor credit?"), "finance");
  assert.equal(detectProduct("Does Rent2Buy need a credit check?"), "both");
  assert.equal(detectProduct("How does the monthly rental work?"), "rent2buy");
  assert.equal(detectProduct("Are you open on Saturdays?"), "unknown");
});

test("assistant prompt makes evidence and competence philosophy explicit", () => {
  const sources = rankKnowledge("Can I get finance with poor credit?", buildRetrievalCorpus({ sections, articles }));
  const prompt = buildCompetencePrompt({ question: "Can I get finance with poor credit?", sources, sections });
  assert.match(prompt, /Maximum approximately 100 words/);
  assert.match(prompt, /Business Brain evidence outranks articles/);
  assert.match(prompt, /If evidence is missing or conflicts/);
  assert.match(prompt, /\[S1\]/);
});

test("knowledge-gap report aggregates gaps, sources, low ratings and conflicts", () => {
  const results = [
    { id: "one", question: "Known", answer: "Known answer", knowledge_gap: false, conflict_detected: false, sources_used: [{ type: "business_brain", section_key: "products", title: "Products" }] },
    { id: "two", question: "Unknown", answer: "I do not have that information.", knowledge_gap: true, conflict_detected: true, confidence_reason: "Deposit rule missing", sources_used: [{ type: "article", title: "Deposits" }] },
  ];
  const report = buildKnowledgeGapReport(results, [{ result_id: "two", accuracy: 2, outcome: "incorrect" }]);
  assert.deepEqual(report.common_gaps[0], ["Deposit rule missing", 1]);
  assert.equal(report.unanswered[0].id, "two");
  assert.equal(report.conflicts[0].id, "two");
  assert.equal(report.lowest_rated[0].review.accuracy, 2);
  assert.equal(report.success.average_accuracy, 2);
  assert.equal(report.success.incorrect_answers, 1);
});

test("migration stores only test evidence and creates no vector or chunk schema", () => {
  const migration = readFileSync(new URL("../supabase/migrations/032_ai_assistant_competence_test.sql", import.meta.url), "utf8");
  assert.match(migration, /knowledge_competence_runs/);
  assert.match(migration, /knowledge_competence_results/);
  assert.match(migration, /knowledge_competence_reviews/);
  assert.doesNotMatch(migration, /create extension[^;]*vector|create table[^;]*chunk|embedding\s+(?:vector|real)/i);
  assert.match(migration, /revoke all on function/);
});

test("internal page and API are wired without a public Wix assistant", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../public/shared/sidebar-navigation.js", import.meta.url), "utf8");
  assert.match(app, /AIAssistantCompetencePage/);
  assert.match(navigation, /AI Assistant Test/);
  assert.match(api, /status\", \"approved/);
  assert.match(api, /content_markdown/);
  assert.match(api, /OPENAI_API_KEY/);
  assert.doesNotMatch(api, /WIX_API_KEY|WIX_SITE_ID/);
  assert.match(readFileSync(new URL("../pages/AIAssistantCompetencePage.jsx", import.meta.url), "utf8"), /validateMarketingAccessKey/);
});

test("competence endpoint uses the established Marketing CRM header or Bearer key", () => {
  const environment = { MARKETING_CUSTOMER_DATABASE_API_KEY: "preview-secret" };
  assert.equal(competenceAuthorize({ headers: { "x-marketing-customer-database-key": "preview-secret" } }, environment), true);
  assert.equal(competenceAuthorize({ headers: { authorization: "Bearer preview-secret" } }, environment), true);
  assert.equal(competenceAuthorize({ headers: {} }, environment), false);
  assert.equal(competenceAuthorize({ headers: { "x-marketing-customer-database-key": "wrong" } }, environment), false);
  assert.equal(competenceAuthorize({ headers: { "x-marketing-customer-database-key": "preview-secret" } }, {}), false);
});

test("Responses API schema uses supported array constraints and keeps source de-duplication", async () => {
  let requestBody;
  const fetchImplementation = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ output_text: JSON.stringify({ answer: "Apply and a lender will assess your circumstances.", confidence: 80, confidence_reason: "Supported by finance guidance.", product_detected: "finance", knowledge_gap: false, conflict_detected: false, source_ids: ["S1", "S1", "invalid"] }) }) };
  };
  const requested = await requestOpenAIAnswer("prompt", { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-4.1-mini" }, fetchImplementation);
  assert.equal(requestBody.text.format.schema.properties.source_ids.uniqueItems, undefined);
  assert.equal(requestBody.text.format.schema.properties.source_ids.maxItems, 8);
  assert.deepEqual(parseOpenAIAnswer(requested.payload, requested.model).answer.source_ids, ["S1"]);
});

test("Responses API preserves the original OpenAI error and diagnostic metadata", async () => {
  const fetchImplementation = async () => ({ ok: false, status: 400, statusText: "Bad Request", json: async () => ({ error: { type: "invalid_request_error", code: "invalid_json_schema", message: "Unsupported keyword: uniqueItems" } }) });
  await assert.rejects(
    requestOpenAIAnswer("prompt", { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-4.1-mini" }, fetchImplementation),
    (error) => error.message.includes("Unsupported keyword: uniqueItems") && error.details.openai_status === 400 && error.details.model === "gpt-4.1-mini",
  );
});
