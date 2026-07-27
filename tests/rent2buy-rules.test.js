import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePublishingSafety, assertPublishingSafe } from "../lib/publishingSafety.js";
import { evaluateRent2BuyRule, RENT2BUY_CORE_WORDING, withPermanentRent2BuyKnowledge } from "../lib/rent2BuyRules.js";
import { buildCorrectionPreview } from "../lib/publishingCorrections.js";

const filler = "Customers should review the agreement carefully and make sure the arrangement suits their circumstances before proceeding. ".repeat(24);
const rent2buy = (content) => ({ id: "r2b", title: "Rent2Buy vans", category: "Rent2Buy", status: "draft", content_markdown: content, content_html: "<p>Clean output</p>", faq_json: [], cta: "View Rent2Buy vans" });
const finance = (content) => ({ id: "fin", title: "Van finance guide", category: "Van Finance", status: "draft", content_markdown: content, content_html: "<p>Clean output</p>", faq_json: [], cta: "View finance vans" });
const approved = `## How Rent2Buy works\n\n${RENT2BUY_CORE_WORDING}\n\n${filler}`;

test("Rent2Buy content containing finance terminology is blocked", () => {
  const result = evaluateRent2BuyRule(rent2buy(`${approved}\n\nAPR and lender panels are available.`));
  assert.equal(result.passed, false);
  assert.ok(result.violations.length >= 2);
});

test("APR and lender-panel wording must be removed before a corrected proposal can pass", () => {
  const original = rent2buy(`${approved}\n\nRepresentative APR and our lender panel determine the finance rate.`);
  const proposed = { ...original, content_markdown: approved, changes: ["Removed APR and lender-panel wording"], removed_links: [], manual_confirmation_required: [], removed_sections: ["Finance wording"], removal_reasons: ["blocked content"] };
  const preview = buildCorrectionPreview({ originalArticle: original, proposed, safetyOptions: { ignoreAssessmentFreshness: true } });
  assert.equal(preview.safety_before.rent2buy_rule.passed, false);
  assert.equal(preview.safety_after.rent2buy_rule.passed, true);
});

test("free delivery is blocked for Rent2Buy", () => {
  assert.equal(evaluateRent2BuyRule(rent2buy(`${approved}\n\nFree UK delivery is included.`)).passed, false);
});

test("test-drive and try-before-buy wording is blocked", () => {
  assert.equal(evaluateRent2BuyRule(rent2buy(`${approved}\n\nTest drive before purchase and try the van before committing.`)).passed, false);
});

test("collection-only wording and Southampton are required and preserved", () => {
  const result = evaluateRent2BuyRule(rent2buy(approved));
  assert.equal(result.passed, true);
  assert.match(approved, /Collection only from Southampton\./);
});

test("Van Finance articles remain unaffected", () => {
  const article = finance(`## Finance options\n\nHire Purchase, APR and lenders may be discussed where accurate.\n\n${filler}`);
  const result = evaluateRent2BuyRule(article);
  assert.equal(result.applies, false);
  assert.equal(result.passed, true);
});

test("mixed articles keep Finance and Rent2Buy sections separated", () => {
  const mixed = { ...rent2buy(`## Van Finance\n\nHire Purchase and APR may be relevant to finance customers.\n\n${filler}\n\n## Rent2Buy\n\n${RENT2BUY_CORE_WORDING}\n\n${filler}`), category: "Both" };
  assert.equal(evaluateRent2BuyRule(mixed).passed, true);
  const unseparated = { ...mixed, content_markdown: `${RENT2BUY_CORE_WORDING}\n\nHire Purchase and APR may be relevant.\n\n${filler}` };
  assert.equal(evaluateRent2BuyRule(unseparated).passed, false);
});

test("corrected proposals must pass the Rent2Buy rule before acceptance", () => {
  const unsafe = rent2buy(`${approved}\n\nHome delivery is available.`);
  const result = evaluatePublishingSafety(unsafe, { ignoreAssessmentFreshness: true });
  assert.equal(result.hard_blocked, true);
  assert.ok(result.hard_block_reasons.some((reason) => reason.includes("Rent2Buy")));
});

test("Wix export safety independently blocks prohibited Rent2Buy wording", () => {
  const unsafe = rent2buy(`${approved}\n\nMonthly finance repayments and home delivery are available.`);
  assert.throws(() => assertPublishingSafe(unsafe, { ignoreAssessmentFreshness: true }), /Rent2Buy content/);
});

test("permanent rule is merged into existing active Compliance Business Knowledge", () => {
  const sections = withPermanentRent2BuyKnowledge([{ section_key: "compliance", title: "Compliance", active: true, entries: [{ label: "Existing", value: "Keep this" }] }]);
  assert.equal(sections[0].entries.some((entry) => entry.label === "Existing"), true);
  assert.equal(sections[0].entries.some((entry) => /Permanent Rent2Buy/.test(entry.label)), true);
});
