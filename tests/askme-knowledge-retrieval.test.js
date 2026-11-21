import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBusinessKnowledgeSections } from "../lib/businessIntelligence.js";
import { resetAssistantKnowledgeCache } from "../lib/assistantKnowledgeRuntime.js";
import { rankBusinessPages, resetBusinessPageCache, retrieveKnowledge, retrievalQuery, selectPassages, tokens } from "../lib/askme/knowledgeRetrieval.js";
import { answerCustomerMessage } from "../lib/askme/leanEngine.js";
import { buildAskMeRequest } from "../lib/askme/contract.js";

const article = (id, title, category, markdown) => ({ id, title, category, content_markdown: markdown, faq_json: [], live_wix_url: `https://www.vanfinancecompany.co.uk/post/${id}`, status: "approved", is_active: true });
const knowledge = {
  settings: {},
  sections: normalizeBusinessKnowledgeSections([], {}),
  articles: [
    article("warranty", "Used van warranty explained", "Van Finance", "## What the warranty covers\nEvery used van comes with a warranty covering the engine, gearbox and major mechanical components. Wear and tear items such as tyres, brakes and clutches are excluded from the warranty."),
    article("warranty-general", "Best vans for work", "Van Finance", "## Do your vans come with a warranty?\nOur work vans come with a warranty. Speak to us for more details."),
    article("gearbox-stock", "Manual gearbox specifications", "Van Finance", "## Gearbox\nVehicle specifications include the gearbox type, model and engine size."),
    article("insurance", "Do I need insurance for a financed van?", "Van Finance", "## Insurance requirements\nYou must have fully comprehensive insurance in place before the financed van is delivered or collected. The insurance must name the van and cover business use if you use it for work."),
    article("documents", "Documents needed for van finance", "Van Finance", "## Documents\nFor a finance application you normally need photo driving licence, proof of address and recent bank statements. Self-employed applicants may be asked for trading evidence."),
    article("new-business", "Van finance for new businesses", "Van Finance", "## Trading for only a few months\nA business that has only been trading for three months can still be considered. Lenders look at affordability and the business's circumstances; a short trading history can mean more questions."),
    article("new-business-2", "Is van finance open to a new business?", "Van Finance", "## Short trading history\nNew businesses trading for a few months are considered. Approval depends on affordability and lender criteria."),
    article("r2b-agreement", "Rent2Buy agreement terms explained", "Rent2Buy", "## Ending the agreement early\nYou can return the van and end the Rent2Buy rental agreement early; the rental agreement explains notice and any charges for early termination."),
  ],
};
const deps = { loadKnowledge: async () => knowledge, environment: {} };
const fresh = () => { resetAssistantKnowledgeCache(); resetBusinessPageCache(); };

test("selectPassages applies the relevance floor and per-source diversity", () => {
  const item = (source_id, heading, coverage, relative) => ({ source_id, title: source_id, heading, passage: "x", score: 1, coverage, relative });
  const ranked = [item("a", "1", 0.9, 1), item("a", "2", 0.9, 0.9), item("a", "3", 0.9, 0.8), item("b", "1", 0.8, 0.7), item("c", "1", 0.2, 0.9), item("d", "1", 0.9, 0.1)];
  assert.deepEqual(selectPassages(ranked).map((entry) => `${entry.source_id}${entry.heading}`), ["a1", "a2", "b1"]);
});

test("BM25 keeps specific words: 'insurance' is searched, not dropped", () => {
  assert.deepEqual(tokens("Do I need insurance before delivery?"), ["insurance", "before", "delivery"]);
  assert.deepEqual(tokens("I'm self employed, what docs?"), ["self-employed", "documents"]);
});

test("retrieval finds the relevant approved article for a detailed question", async () => {
  fresh();
  const result = await retrieveKnowledge({ product: "finance", message: "Does the warranty cover the gearbox? What isn't covered?" }, deps);
  // The approved warranty article (which lists the exclusions) ranks first.
  assert.equal(result.passages[0].title, "Used van warranty explained");
  assert.match(result.passages[0].passage, /tyres, brakes and clutches are excluded/);
  assert.ok(result.timings_ms.total_ms >= 0);
});

test("Finance and Rent2Buy knowledge never mix", async () => {
  fresh();
  const finance = await retrieveKnowledge({ product: "finance", message: "Can I end the rental agreement early?" }, deps);
  assert.ok(!finance.passages.some((item) => /Rent2Buy/.test(item.title)), "finance never sees Rent2Buy articles");
  const rent2buy = await retrieveKnowledge({ product: "rent2buy", message: "Can I end the rental agreement early?" }, deps);
  assert.equal(rent2buy.passages[0]?.title, "Rent2Buy agreement terms explained");
  assert.ok(!rent2buy.passages.some((item) => /finance/i.test(item.title)), "Rent2Buy never sees finance articles");
});

test("follow-up questions carry the previous customer turn into the search", async () => {
  fresh();
  assert.equal(retrievalQuery("and does it need business use?", [{ role: "user", content: "Do I need insurance?" }, { role: "assistant", content: "Yes." }]), "and does it need business use? Do I need insurance?");
  const result = await retrieveKnowledge({ product: "finance", message: "does it have to cover business use?", history: [{ role: "user", content: "Do I need insurance for the van?" }] }, deps);
  assert.equal(result.passages[0]?.title, "Do I need insurance for a financed van?");
});

test("business pages are matched by product and meaningful words only", () => {
  const pages = [
    { title: "Warranty", description: "Our used van warranty and AutoGuard cover", keywords: ["warranty", "autoguard"], product: "finance", url: "https://www.vanfinancecompany.co.uk/warranty", active: true },
    { title: "Rent2Buy payments", description: "How Rent2Buy payments and warranty work", keywords: ["payments"], product: "rent2buy", url: "https://www.rent2buyvans.co.uk/payments", active: true },
  ];
  assert.deepEqual(rankBusinessPages("What does the AutoGuard warranty cover?", pages, "finance").map((page) => page.title), ["Warranty"]);
  assert.deepEqual(rankBusinessPages("hello there", pages, "finance"), []);
});

test("lean engine: detailed questions get retrieved knowledge in the prompt; simple ones stay compact", async () => {
  fresh();
  const seen = {};
  const retrieve = (input) => retrieveKnowledge(input, deps);
  const detailed = await answerCustomerMessage(buildAskMeRequest({ channel: "website_vfc", product: "finance", message: "What documents do I need for finance if I'm self-employed?" }), {
    retrieve,
    requestReply: async (prompt, route) => { seen.detailed = prompt; return { reply: "You'll normally need photo driving licence, proof of address and recent bank statements; self-employed applicants may be asked for trading evidence.", action: "apply", model: route.model, usage: {} }; },
  });
  assert.match(seen.detailed.input, /# Approved knowledge/);
  assert.match(seen.detailed.input, /Knowledge Hub — Documents needed for van finance/);
  assert.match(seen.detailed.instructions, /order of authority/);
  assert.equal(detailed.diagnostics.path, "model_with_knowledge");
  assert.ok(detailed.diagnostics.retrieval.passages.some((item) => item.title === "Documents needed for van finance"));

  const simple = await answerCustomerMessage(buildAskMeRequest({ channel: "website_vfc", product: "finance", message: "Hello" }), {
    retrieve,
    requestReply: async (prompt, route) => { seen.simple = prompt; return { reply: "Hi! How can I help?", action: "none", model: route.model, usage: {} }; },
  });
  assert.doesNotMatch(seen.simple.input, /# Approved knowledge/);
  assert.equal(simple.diagnostics.path, "model");
});

test("lean engine: a retrieval failure never blocks the answer", async () => {
  const result = await answerCustomerMessage(buildAskMeRequest({ channel: "website_vfc", product: "finance", message: "Do you offer a warranty?" }), {
    retrieve: async () => { throw new Error("database down"); },
    requestReply: async (prompt, route) => ({ reply: "The team can confirm the warranty details for you.", action: "contact", model: route.model, usage: {} }),
  });
  assert.equal(result.status, "ready");
  assert.match(result.diagnostics.retrieval.error, /database down/);
});

test("multi-part questions retrieve evidence for each part", async () => {
  fresh();
  const result = await retrieveKnowledge({ product: "finance", message: "What documents do I need for finance, and do I need insurance before delivery?" }, deps);
  const titles = result.passages.map((item) => item.title);
  assert.ok(titles.includes("Documents needed for van finance"), titles.join(" | "));
  assert.ok(titles.includes("Do I need insurance for a financed van?"), titles.join(" | "));
  assert.equal(result.query_parts, 2);
});

test("everyday phrasing 'what do I need to bring to apply' searches documents", async () => {
  const { expandQuery } = await import("../lib/askme/knowledgeRetrieval.js");
  assert.match(expandQuery("What would I need to bring to apply?"), /documents$/);
  assert.equal(expandQuery("What documents do I need to apply?"), "What documents do I need to apply?");
  fresh();
  const result = await retrieveKnowledge({ product: "finance", message: "What would I need to bring to apply?", history: [{ role: "user", content: "How much is this one a month?" }] }, deps);
  assert.ok(result.passages.some((item) => /document/i.test(`${item.title} ${item.heading}`)), JSON.stringify(result.passages.map((item) => item.heading)));
});

test("a warranty follow-up uses the warranty passage on a vehicle page, not the gearbox specification", async () => {
  fresh();
  const request = buildAskMeRequest({
    channel: "website_vfc", product: "finance",
    message: "Does that include the gearbox?",
    history: [{ role: "user", content: "Do your vans come with a warranty?" }, { role: "assistant", content: "Our vans come with a warranty." }],
    context: { page_type: "finance_vehicle", vehicle: { registration: "TE57VAN", title: "Ford Transit", transmission: "Manual" } },
  });
  const result = await answerCustomerMessage(request, {
    retrieve: (input) => retrieveKnowledge(input, deps),
    requestReply: async (prompt) => {
      assert.match(prompt.input, /Knowledge Hub — Used van warranty explained[\s\S]*covers|Knowledge Hub — Used van warranty explained[\s\S]*covering the engine, gearbox/);
      return { reply: "Yes, the warranty covers the gearbox, subject to its terms.", action: "none" };
    },
  });
  assert.equal(result.diagnostics.path, "model_with_knowledge");
  assert.match(result.reply, /warranty covers the gearbox/);
  assert.equal(result.diagnostics.retrieval.passages[0].title, "Used van warranty explained");
});

test("thin follow-up searches the latest question first: documents after a trading-history question", async () => {
  fresh();
  const history = [{ role: "user", content: "My business has only been trading for three months. Can I apply?" }, { role: "assistant", content: "Yes, you can apply." }];
  const result = await retrieveKnowledge({ product: "finance", message: "What documents will I need?", history }, deps);
  assert.equal(result.passages[0].title, "Documents needed for van finance", JSON.stringify(result.passages.map((item) => item.title)));
  // Conversation context is kept alongside the latest question's evidence.
  assert.ok(result.passages.some((item) => /new business/i.test(item.title)), JSON.stringify(result.passages.map((item) => item.title)));
});
