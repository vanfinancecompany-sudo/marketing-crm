import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBusinessKnowledgeSections } from "../lib/businessIntelligence.js";
import {
  buildRetrievalCorpus,
  filterKnowledgeForProduct,
  rankKnowledge,
} from "../lib/aiAssistantCompetence.js";

const sections = normalizeBusinessKnowledgeSections([], {});
const financeKnowledge = filterKnowledgeForProduct({ sections, articles: [] }, "finance");
const financeCorpus = buildRetrievalCorpus(financeKnowledge);

const regressions = [
  {
    question: "Are your vans inspected before delivery?",
    expected: [/101-point/i, /12-month MOT/i, /second walk-around/i],
  },
  {
    question: "Do you replace the wet belt on a Ford Transit Custom?",
    expected: [/wet belt/i, /1,000 miles/i, /6 months/i],
  },
  {
    question: "What happens if my van has no service history?",
    expected: [/full service/i, /no service history/i],
  },
  {
    question: "Will you hand over a van with tyres close to the legal limit?",
    expected: [/tyres/i, /legal minimum|legal limit/i, /replaced/i],
  },
  {
    question: "What warranty comes with a used van?",
    expected: [/3 months/i, /3,000 miles/i, /in-house/i],
  },
  {
    question: "If my van develops a fault, do I have to bring it back to you?",
    expected: [/local/i, /garage/i, /VFC deals directly|directly with the garage/i],
  },
  {
    question: "What should I do if there is a problem with my van after delivery?",
    expected: [/after-sales/i, /photos|video/i, /local garage/i],
  },
  {
    question: "How much is the reservation deposit and when is the rest due?",
    expected: [/£100/i, /day before delivery/i, /bank transfer|card/i],
  },
  {
    question: "How long does remote van delivery normally take?",
    expected: [/7–10 working days|7-10 working days/i, /not a guaranteed|not guaranteed|typical/i],
  },
  {
    question: "If I cancel the finance in 14 days does that automatically reject the van?",
    expected: [/separate/i, /does not automatically|never state that cancelling/i, /distance/i],
  },
];

for (const regression of regressions) {
  test(`Jasmine primary-source retrieval: ${regression.question}`, () => {
    const ranked = rankKnowledge(regression.question, financeCorpus).slice(0, 6);
    assert.ok(ranked.length > 0, `No evidence retrieved for: ${regression.question}`);
    const evidence = ranked.map((source) => `${source.heading || ""} ${source.passage || ""}`).join("\n");
    for (const pattern of regression.expected) {
      assert.match(evidence, pattern, `${regression.question} did not retrieve evidence matching ${pattern}`);
    }
  });
}

test("Jasmine Finance regression corpus contains the owner-supplied after-sales and preparation evidence", () => {
  const text = financeCorpus.map((source) => source.passage).join("\n");
  assert.match(text, /101-point/i);
  assert.match(text, /wet belt/i);
  assert.match(text, /3 months or 3,000 miles/i);
  assert.match(text, /£100 reservation deposit/i);
  assert.match(text, /after-sales team/i);
});

test("Jasmine Rent2Buy retrieval does not inherit VFC Finance primary-source operations by default", () => {
  const rent2buyKnowledge = filterKnowledgeForProduct({ sections, articles: [] }, "rent2buy");
  const rent2buyCorpus = buildRetrievalCorpus(rent2buyKnowledge);
  const text = rent2buyCorpus.map((source) => source.passage).join("\n");
  assert.doesNotMatch(text, /Ford Transit Custom.*wet belt/i);
  assert.doesNotMatch(text, /£100 reservation deposit/i);
  assert.doesNotMatch(text, /3 months or 3,000 miles/i);
});
