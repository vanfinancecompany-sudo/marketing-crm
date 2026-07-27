import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePublishingSafety, assertPublishingSafe } from "../lib/publishingSafety.js";
import {
  autoCorrectPureRent2BuyArticle,
  evaluateRent2BuyRule,
  RENT2BUY_COLLECTION_SENTENCE,
  withPermanentRent2BuyKnowledge,
} from "../lib/rent2BuyRules.js";
import { buildCorrectionPreview } from "../lib/publishingCorrections.js";

const filler = "Customers should review the agreement carefully and make sure the arrangement suits their circumstances before proceeding. ".repeat(24);
const rent2buy = (content) => ({ id: "r2b", title: "Rent2Buy vans", category: "Rent2Buy", status: "draft", content_markdown: content, content_html: "<p>Clean output</p>", faq_json: [], cta: "View Rent2Buy vans" });
const finance = (content) => ({ id: "fin", title: "Van finance guide", category: "Van Finance", status: "draft", content_markdown: content, content_html: "<p>Clean output</p>", faq_json: [], cta: "View finance vans" });
const approved = `## How Rent2Buy works\n\nRent2Buy is a separate rent-to-own arrangement and is not a finance product.\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\nThe agreement terms, payment structure, eligibility requirements and ownership conditions should be reviewed before proceeding.\n\n${filler}`;

test("Rent2Buy content containing finance terminology is blocked", () => {
  const result = evaluateRent2BuyRule(rent2buy(`${approved}\n\nAPR and lender panels are available.`));
  assert.equal(result.passed, false);
});

test("negative delivery mentions are removed rather than retained", () => {
  const corrected = autoCorrectPureRent2BuyArticle(rent2buy(`${approved}\n\nFree delivery is not available. Home delivery is unavailable.`));
  assert.doesNotMatch(corrected.content_markdown, /free delivery|home delivery/i);
  assert.equal(evaluateRent2BuyRule(corrected).passed, true);
});

test("finance comparison sections are removed from pure Rent2Buy articles", () => {
  const original = rent2buy(`${approved}\n\n## How Rent2Buy compares to traditional finance\n\nAPR, lenders and Hire Purchase are compared here.\n\n## Useful eligibility information\n\nApplicants should review eligibility and ownership conditions carefully.`);
  const corrected = autoCorrectPureRent2BuyArticle(original);
  assert.doesNotMatch(corrected.content_markdown, /traditional finance|APR|lenders|Hire Purchase/i);
  assert.match(corrected.content_markdown, /Useful eligibility information/);
});

test("trial semantic variations are detected and removed", () => {
  const original = rent2buy(`${approved}\n\nYou can test whether the van suits you before buying and rent before committing.`);
  assert.equal(evaluateRent2BuyRule(original).passed, false);
  const corrected = autoCorrectPureRent2BuyArticle(original);
  assert.doesNotMatch(corrected.content_markdown, /test whether|rent before committing|suits you before buying/i);
});

test("exact standalone Southampton collection sentence is inserted", () => {
  const corrected = autoCorrectPureRent2BuyArticle(rent2buy(`## How it works\n\nRent2Buy uses an agreement with rental payments.\n\n${filler}`));
  assert.match(corrected.content_markdown, /(?:^|\n)Collection only from Southampton\.(?:$|\n)/);
  assert.equal(corrected.content_markdown.match(/Collection only from Southampton\./g)?.length, 1);
});

test("no prohibited finance terminology remains after automatic correction", () => {
  const original = rent2buy(`${approved}\n\n## Finance comparison\n\nPCP, Hire Purchase, Lease Purchase, APR, finance rates, approval rates and lender panels are discussed.`);
  const corrected = autoCorrectPureRent2BuyArticle(original);
  assert.doesNotMatch(corrected.content_markdown, /\bPCP\b|Hire Purchase|Lease Purchase|\bAPR\b|finance rates|approval rates|lender panels/i);
  assert.equal(evaluateRent2BuyRule(corrected).passed, true);
});

test("unrelated useful Rent2Buy content is preserved", () => {
  const useful = "## Eligibility documents\n\nApplicants should provide accurate information and review the agreement before proceeding.";
  const corrected = autoCorrectPureRent2BuyArticle(rent2buy(`${approved}\n\n${useful}\n\nFree UK delivery is not available.`));
  assert.match(corrected.content_markdown, /Eligibility documents/);
  assert.match(corrected.content_markdown, /provide accurate information/);
});

test("corrected proposals remain incomplete when Rent2Buy failures remain", () => {
  const original = rent2buy(`${approved}\n\nAPR and lender panels apply.`);
  const proposed = { ...original, content_markdown: `${approved}\n\nAPR still applies.`, changes: [], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [] };
  const preview = buildCorrectionPreview({ originalArticle: original, proposed, safetyOptions: { ignoreAssessmentFreshness: true } });
  assert.equal(preview.correction_complete, true, "normalisation should automatically remove the remaining prohibited content");
  assert.equal(preview.safety_after.rent2buy_rule.passed, true);
});

test("Van Finance articles remain unaffected", () => {
  const article = finance(`## Finance options\n\nHire Purchase, APR and lenders may be discussed where accurate.\n\n${filler}`);
  assert.equal(evaluateRent2BuyRule(article).applies, false);
});

test("mixed articles keep Finance and Rent2Buy sections separated", () => {
  const mixed = { ...rent2buy(`## Van Finance\n\nHire Purchase and APR may be relevant to finance customers.\n\n${filler}\n\n## Rent2Buy\n\n${approved}`), category: "Both" };
  assert.equal(evaluateRent2BuyRule(mixed).passed, true);
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
