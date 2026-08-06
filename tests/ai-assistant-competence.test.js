import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_ASSISTANT_TEST_LIBRARY,
  buildCompetencePrompt,
  buildKnowledgeGapReport,
  buildRetrievalCorpus,
  detectProduct,
  filterKnowledgeForProduct,
  isExplicitProductComparison,
  rankKnowledge,
  splitArticleMarkdown,
} from "../lib/aiAssistantCompetence.js";
import { competenceAuthorize, parseOpenAIAnswer, requestOpenAIAnswer } from "../api/marketing-ai-assistant-competence.js";
import { acceptCompetenceResponse, testAssistantAnswer } from "../services/aiAssistantCompetence.js";

const sections = [
  { id: "brain-1", section_key: "products", title: "Products", active: true, content: "Finance is lender assessed. Rent2Buy has no credit check and is based on affordability.", entries: [] },
  { id: "brain-2", section_key: "faqs", title: "FAQs", active: true, content: "", entries: [{ label: "Can poor-credit customers apply?", value: "Customers may apply, but finance acceptance cannot be promised." }] },
  { id: "brain-3", section_key: "compliance", title: "Compliance", active: false, content: "This inactive rule must not enter retrieval.", entries: [] },
];
const articles = [{ id: "article-1", title: "Van finance with poor credit", category: "Van Finance", status: "approved", live_wix_url: "https://example.com/poor-credit", content_markdown: "## Can I apply?\n\nCustomers with poor credit can submit an application. A lender makes the decision.\n\n## Documents\n\nProof of identity and income may be requested.", faq_json: [{ question: "Is approval guaranteed?", answer: "No." }] }];
const rent2buyArticle = { id: "article-rent", title: "Rent2Buy eligibility", category: "Rent2Buy", status: "approved", content_markdown: "## Eligibility\n\nRent2Buy eligibility is based on affordability and uses a monthly rental agreement.", faq_json: [] };

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

test("lexical ranking normalises customer misspellings and keeps van as a useful term", () => {
  const corpus = buildRetrievalCorpus({
    sections: [],
    articles: [{ id: "vehicle", title: "Van applications and delivery", category: "Van Finance", content_markdown: "## Delivery\n\nVan delivery information and application documents.", faq_json: [] }],
  });
  for (const query of ["ned van quik", "wat docs do i ned", "delivry glasgow", "which van"]) {
    const ranked = rankKnowledge(query, corpus);
    assert.equal(ranked[0]?.source_id, "vehicle", query);
    assert.ok(ranked[0].matched_terms.length > 0, query);
  }
});

test("finance context excludes Rent2Buy articles and Business Knowledge before ranking", () => {
  const bounded = filterKnowledgeForProduct({ sections, articles: [...articles, rent2buyArticle] }, "finance");
  const corpus = buildRetrievalCorpus(bounded);
  const ranked = rankKnowledge("Can I apply with poor credit or use a monthly rental agreement?", corpus);
  assert.equal(bounded.articles.some((article) => article.category === "Rent2Buy"), false);
  assert.equal(corpus.some((source) => source.source_id === "article-rent" || /Rent2Buy|monthly rental/i.test(source.passage)), false);
  assert.equal(ranked.some((source) => source.source_id === "article-rent"), false);
  assert.match(bounded.categoryFilter, /exclude Rent2Buy/);
});

test("rent2buy context excludes Finance articles and Business Knowledge before ranking", () => {
  const bounded = filterKnowledgeForProduct({ sections, articles: [...articles, rent2buyArticle] }, "rent2buy");
  const corpus = buildRetrievalCorpus(bounded);
  const ranked = rankKnowledge("Can I use Rent2Buy if a lender declined me?", corpus);
  assert.deepEqual(bounded.articles.map((article) => article.id), ["article-rent"]);
  assert.equal(corpus.some((source) => source.source_id === "article-1" || /lender assessed/i.test(source.passage)), false);
  assert.equal(ranked.some((source) => source.source_id === "article-1"), false);
  assert.equal(isExplicitProductComparison("How does Rent2Buy compare with finance?"), true);
  assert.equal(isExplicitProductComparison("Does Rent2Buy require a credit check?"), false);
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

test("three sequential single-question requests cannot reuse an earlier answer or retrieval trace", async () => {
  const questions = [
    "I've seen a Transit Custom I like. What's the next step?",
    "I've been trading for six months and need a van quickly. Is there any point applying?",
    "I'm a plumber and do not know what my options are.",
  ];
  const seenRequests = [];
  let resultSequence = 0;
  const fetchImplementation = async (_url, options) => {
    const request = JSON.parse(options.body);
    seenRequests.push({ request, options });
    resultSequence += 1;
    const resultId = `result-${resultSequence}`;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: { id: resultId, question: request.question, answer: `Answer for: ${request.question}`, sources_used: [{ source_id: `source-${resultSequence}` }] },
        retrieved_sources: [{ source_id: `source-${resultSequence}`, passage: request.question }],
        request_trace: { request_id: request.request_id, submitted_question: request.question, result_question: request.question, result_id: resultId, retrieved_source_ids: [`source-${resultSequence}`], cached_value_used: false, previous_value_used: false },
      }),
    };
  };
  let renderedPayload = null;
  const resultIds = [];
  for (let index = 0; index < questions.length; index += 1) {
    const requestId = `request-${index + 1}`;
    renderedPayload = null;
    const response = await testAssistantAnswer({ request_id: requestId, question: questions[index], product_context: "finance", mode: "single", messages: [] }, fetchImplementation);
    renderedPayload = acceptCompetenceResponse(requestId, response);
    resultIds.push(renderedPayload.result.id);
    assert.equal(renderedPayload.result.question, questions[index]);
    assert.equal(renderedPayload.result.answer, `Answer for: ${questions[index]}`);
    assert.deepEqual(renderedPayload.request_trace.retrieved_source_ids, [`source-${index + 1}`]);
  }
  assert.deepEqual(seenRequests.map(({ request }) => request.question), questions);
  assert.deepEqual(seenRequests.map(({ request }) => request.messages), [[], [], []]);
  assert.deepEqual(seenRequests.map(({ options }) => options.cache), ["no-store", "no-store", "no-store"]);
  assert.deepEqual(seenRequests.map(({ request }) => request.request_id), ["request-1", "request-2", "request-3"]);
  assert.equal(new Set(seenRequests.map(({ request }) => request.request_id)).size, 3);
  assert.deepEqual(resultIds, ["result-1", "result-2", "result-3"]);
  assert.equal(renderedPayload.result.id, "result-3");
  assert.equal(acceptCompetenceResponse("request-3", { request_trace: { request_id: "request-1" } }), null);
});
