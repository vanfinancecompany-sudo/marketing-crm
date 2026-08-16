import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBusinessKnowledgeSections } from "../lib/businessIntelligence.js";
import { filterKnowledgeForProduct } from "../lib/aiAssistantCompetence.js";
import { VFC_PRIMARY_SOURCE_KNOWLEDGE_VERSION } from "../lib/vfcPrimarySourceKnowledge.js";

test("canonical VFC evidence is injected even when persisted Business Intelligence is empty", () => {
  const sections = normalizeBusinessKnowledgeSections([], {});
  const sales = sections.find((section) => section.section_key === "sales_knowledge");
  const compliance = sections.find((section) => section.section_key === "compliance");
  const faqs = sections.find((section) => section.section_key === "faqs");

  assert.equal(VFC_PRIMARY_SOURCE_KNOWLEDGE_VERSION, "2026-08-16");
  assert.ok(sales.entries.some((entry) => /101-point PDI/i.test(entry.label)));
  assert.ok(sales.entries.some((entry) => /previous 1,000 miles or previous 6 months/i.test(entry.value)));
  assert.ok(sales.entries.some((entry) => /3 months or 3,000 miles/i.test(entry.value)));
  assert.ok(sales.entries.some((entry) => /£100 reservation deposit/i.test(entry.value)));
  assert.ok(compliance.entries.some((entry) => /cancelling the finance agreement automatically/i.test(entry.value)));
  assert.ok(faqs.entries.some((entry) => /How long does remote van delivery usually take/i.test(entry.label)));
});

test("canonical evidence is additive and does not overwrite administrator Business Intelligence", () => {
  const sections = normalizeBusinessKnowledgeSections([
    {
      section_key: "sales_knowledge",
      title: "Sales Knowledge",
      content: "Administrator supplied content remains.",
      entries: [{ label: "Existing fact", value: "Keep me." }],
      active: true,
    },
  ], {});
  const sales = sections.find((section) => section.section_key === "sales_knowledge");
  assert.equal(sales.content, "Administrator supplied content remains.");
  assert.ok(sales.entries.some((entry) => entry.label === "Existing fact" && entry.value === "Keep me."));
  assert.ok(sales.entries.some((entry) => /Remote-buying journey/i.test(entry.label)));
});

test("VFC Finance operations evidence stays out of Rent2Buy knowledge scope", () => {
  const sections = normalizeBusinessKnowledgeSections([], {});
  const finance = filterKnowledgeForProduct({ sections, articles: [] }, "finance");
  const rent2buy = filterKnowledgeForProduct({ sections, articles: [] }, "rent2buy");

  const financeText = JSON.stringify(finance.sections);
  const rent2buyText = JSON.stringify(rent2buy.sections);
  assert.match(financeText, /Ford wet-belt policy/);
  assert.match(financeText, /101-point PDI/);
  assert.doesNotMatch(rent2buyText, /Ford wet-belt policy/);
  assert.doesNotMatch(rent2buyText, /£100 reservation deposit/);
});
