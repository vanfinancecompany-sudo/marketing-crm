import test from "node:test";
import assert from "node:assert/strict";
import {
  getCachedAssistantKnowledge,
  preparedKnowledgeFor,
  resetAssistantKnowledgeCache,
} from "../lib/assistantKnowledgeRuntime.js";

function knowledgeFixture() {
  return {
    settings: {},
    sections: [],
    articles: [
      {
        id: "finance-1",
        title: "Van finance deposits",
        category: "Van Finance",
        content_markdown: "# Deposits\n\nFinance deposit information.",
        faq_json: [],
        live_wix_url: "",
      },
      {
        id: "rent2buy-1",
        title: "Rent2Buy affordability",
        category: "Rent2Buy",
        content_markdown: "# Affordability\n\nRent2Buy affordability information.",
        faq_json: [],
        live_wix_url: "",
      },
    ],
  };
}

test("prepared assistant knowledge keeps Finance and Rent2Buy corpora sealed", async () => {
  resetAssistantKnowledgeCache();
  const runtime = await getCachedAssistantKnowledge(async () => knowledgeFixture(), {
    environment: { AI_ASSISTANT_KNOWLEDGE_CACHE_TTL_MS: "30000" },
    now: () => 1000,
  });

  const finance = preparedKnowledgeFor(runtime, "finance");
  const rent2buy = preparedKnowledgeFor(runtime, "rent2buy");

  assert.equal(finance.bounded.brainId, "finance");
  assert.equal(rent2buy.bounded.brainId, "rent2buy");
  assert.ok(finance.corpus.some((source) => source.source_id === "finance-1"));
  assert.ok(!finance.corpus.some((source) => source.source_id === "rent2buy-1"));
  assert.ok(rent2buy.corpus.some((source) => source.source_id === "rent2buy-1"));
  assert.ok(!rent2buy.corpus.some((source) => source.source_id === "finance-1"));
});

test("warm assistant knowledge requests reuse the prepared corpus until TTL expiry", async () => {
  resetAssistantKnowledgeCache();
  let loads = 0;
  let time = 1000;
  const loadFresh = async () => {
    loads += 1;
    return knowledgeFixture();
  };
  const options = {
    environment: { AI_ASSISTANT_KNOWLEDGE_CACHE_TTL_MS: "30000" },
    now: () => time,
  };

  const first = await getCachedAssistantKnowledge(loadFresh, options);
  time += 1000;
  const second = await getCachedAssistantKnowledge(loadFresh, options);

  assert.equal(loads, 1);
  assert.equal(first.cache_hit, false);
  assert.equal(second.cache_hit, true);
  assert.equal(second.cache_joined, false);

  time += 30001;
  const third = await getCachedAssistantKnowledge(loadFresh, options);
  assert.equal(loads, 2);
  assert.equal(third.cache_hit, false);
});

test("concurrent cold requests share one knowledge load and one corpus build", async () => {
  resetAssistantKnowledgeCache();
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loadFresh = async () => {
    loads += 1;
    await gate;
    return knowledgeFixture();
  };

  const firstPromise = getCachedAssistantKnowledge(loadFresh, {
    environment: { AI_ASSISTANT_KNOWLEDGE_CACHE_TTL_MS: "30000" },
  });
  const secondPromise = getCachedAssistantKnowledge(loadFresh, {
    environment: { AI_ASSISTANT_KNOWLEDGE_CACHE_TTL_MS: "30000" },
  });

  release();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(loads, 1);
  assert.equal(first.cache_hit, false);
  assert.equal(second.cache_hit, true);
  assert.equal(second.cache_joined, true);
});
