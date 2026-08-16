import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompetencePrompt,
  buildRetrievalCorpus,
  filterKnowledgeForProduct,
} from "../lib/aiAssistantCompetence.js";
import { enforceRent2BuyReplyBoundary } from "../lib/assistantProductBrains.js";
import { polishConversationPresentation } from "../lib/conversationPolish.js";

test("Rent2Buy brain rejects subject-to-status Business Knowledge before retrieval", () => {
  const bounded = filterKnowledgeForProduct({
    sections: [{
      id: "eligibility",
      section_key: "sales_knowledge",
      title: "Eligibility",
      active: true,
      content: "",
      entries: [
        { label: "Rent2Buy assessment", value: "There is no credit check; affordability is assessed instead." },
        { label: "Rent2Buy status", value: "Rent2Buy is subject to status." },
      ],
    }],
    articles: [],
    settings: {},
  }, "rent2buy");
  const corpus = buildRetrievalCorpus(bounded);
  assert.equal(corpus.some((source) => /subject[-\s]+to[-\s]+status/i.test(source.passage)), false);
  assert.equal(corpus.some((source) => /no credit check/i.test(source.passage)), true);
});

test("Rent2Buy brain rejects a contaminated Rent2Buy article rather than trusting its category", () => {
  const bounded = filterKnowledgeForProduct({
    sections: [],
    articles: [{
      id: "bad-r2b-status",
      title: "How Rent2Buy works",
      category: "Rent2Buy",
      content_markdown: "## Eligibility\nRent2Buy has no credit check but is subject to status.",
      faq_json: [],
    }],
    settings: {},
  }, "rent2buy");
  assert.equal(bounded.articles.some((article) => article.id === "bad-r2b-status"), false);
  assert.equal(buildRetrievalCorpus(bounded).some((source) => source.source_id === "bad-r2b-status"), false);
});

test("Rent2Buy runtime prompt explicitly prohibits Finance-style status qualification", () => {
  const bounded = filterKnowledgeForProduct({ sections: [], articles: [], settings: {} }, "rent2buy");
  const prompt = buildCompetencePrompt({
    question: "If there is no credit check, is Rent2Buy subject to status?",
    sources: [],
    sections: bounded.sections,
    productContext: "rent2buy",
  });
  assert.match(prompt, /Never describe Rent2Buy as subject to status/i);
  assert.match(prompt, /no credit check; affordability/i);
});

test("final Rent2Buy reply boundary removes ambiguous status language and preserves safe facts", () => {
  const reply = enforceRent2BuyReplyBoundary("There is no credit check, but it is subject to status. Collection only from Southampton.");
  assert.doesNotMatch(reply, /subject[-\s]+to[-\s]+status/i);
  assert.match(reply, /does not use a credit check/i);
  assert.match(reply, /affordability/i);
  assert.match(reply, /Collection only from Southampton/i);
});

test("final Rent2Buy reply boundary catches hyphenated and approval variants", () => {
  for (const wording of [
    "Rent2Buy is subject-to-status.",
    "This option is subject to lender approval.",
    "Rent2Buy is subject to credit approval.",
  ]) {
    const reply = enforceRent2BuyReplyBoundary(`${wording} Collection only from Southampton.`);
    assert.doesNotMatch(reply, /subject(?:[-\s]+)to(?:[-\s]+)(?:status|lender|credit)/i, wording);
    assert.match(reply, /affordability/i, wording);
  }
});

test("explicit Finance-only status wording is preserved while a Rent2Buy status claim is removed", () => {
  const reply = enforceRent2BuyReplyBoundary("Finance is subject to status. Rent2Buy is subject to status. Collection only from Southampton.");
  assert.match(reply, /Finance is subject to status/i);
  assert.equal((reply.match(/subject to status/gi) || []).length, 1);
  assert.match(reply, /affordability/i);
  assert.match(reply, /Collection only from Southampton/i);
});

test("conversation polish applies the status guard only to Rent2Buy replies", () => {
  const rent2buy = polishConversationPresentation({
    reply: "There is no credit check, although Rent2Buy is subject to status. Collection only from Southampton.",
    question: "Is it subject to status?",
    productContext: "rent2buy",
    intent: { retrieval_required: true },
    journey: {},
  });
  assert.doesNotMatch(rent2buy.reply, /Rent2Buy is subject to status/i);
  assert.match(rent2buy.reply, /affordability/i);
  assert.match(rent2buy.reply, /Collection only from Southampton/i);

  const finance = polishConversationPresentation({
    reply: "Finance is subject to status.",
    question: "Is finance subject to status?",
    productContext: "finance",
    intent: { retrieval_required: true },
    journey: {},
  });
  assert.equal(finance.reply, "Finance is subject to status.");
});
