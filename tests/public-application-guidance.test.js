import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isDirectApplicationNavigationQuestion,
  isRent2BuyCoreExplanationQuestion,
  isRent2BuyEligibilityQuestion,
  publicApplicationGuidanceReply,
} from "../lib/publicApplicationGuidance.js";

test("direct application navigation questions point Finance vehicle customers to the current page APPLY NOW control", () => {
  for (const message of [
    "How do I apply?",
    "How can I apply for this van?",
    "Where do I apply?",
    "What do I click to apply?",
    "I'm ready to apply",
  ]) {
    const reply = publicApplicationGuidanceReply({
      message,
      pageType: "finance_vehicle",
      productLock: "finance",
    });
    assert.match(reply, /APPLY NOW button on this page/i, message);
    assert.match(reply, /vehicle you.re viewing/i, message);
  }
});

test("Rent2Buy application navigation uses the page APPLY NOW control without creating another application route", () => {
  const reply = publicApplicationGuidanceReply({
    message: "How do I apply?",
    pageType: "rent2buy_general",
    productLock: "rent2buy",
  });
  assert.match(reply, /Rent2Buy application/i);
  assert.match(reply, /APPLY NOW button on this page/i);
  assert.doesNotMatch(reply, /https?:|link|navigate/i);
});

test("Rent2Buy core starter is deterministic and cannot invent Finance delivery or unsupported agreement details", () => {
  for (const message of ["How does Rent2Buy work?", "What is Rent2Buy?", "Tell me about Rent2Buy"]) {
    assert.equal(isRent2BuyCoreExplanationQuestion(message), true, message);
    const reply = publicApplicationGuidanceReply({
      message,
      pageType: "rent2buy_general",
      productLock: "rent2buy",
    });
    assert.match(reply, /separate rent-to-own arrangement and is not a finance product/i, message);
    assert.match(reply, /no credit check/i, message);
    assert.match(reply, /affordability/i, message);
    assert.match(reply, /100 miles of Southampton/i, message);
    assert.match(reply, /Collection only from Southampton/i, message);
    assert.match(reply, /APPLY NOW/i, message);
    assert.doesNotMatch(reply, /free (?:UK )?delivery|home delivery|mileage limit|fully comprehensive|insurance|early return|upgrade|optional final|final amount|final payment/i, message);
  }
});

test("Rent2Buy core starter route does not intercept Finance conversations", () => {
  assert.equal(publicApplicationGuidanceReply({
    message: "How does Rent2Buy work?",
    pageType: "finance_general",
    productLock: "finance",
  }), null);
});

test("common Rent2Buy eligibility questions are deterministic regardless of question order", () => {
  for (const message of [
    "Can I get a van?",
    "Can I get one?",
    "Will I qualify?",
    "Do I qualify?",
    "Am I eligible?",
    "Could I get accepted?",
  ]) {
    assert.equal(isRent2BuyEligibilityQuestion(message), true, message);
    const reply = publicApplicationGuidanceReply({
      message,
      pageType: "rent2buy_general",
      productLock: "rent2buy",
    });
    assert.match(reply, /Potentially, yes/i, message);
    assert.match(reply, /no credit check/i, message);
    assert.match(reply, /affordability/i, message);
    assert.match(reply, /100 miles of Southampton/i, message);
    assert.doesNotMatch(reply, /not enough verified|explain that another way/i, message);
  }

  for (const message of ["Is it easy to get?", "How easy is it to get?"]) {
    const reply = publicApplicationGuidanceReply({
      message,
      pageType: "rent2buy_general",
      productLock: "rent2buy",
    });
    assert.match(reply, /straightforward/i, message);
    assert.match(reply, /isn.t automatic/i, message);
    assert.match(reply, /no credit check/i, message);
    assert.match(reply, /100 miles of Southampton/i, message);
    assert.doesNotMatch(reply, /explain|not enough verified/i, message);
  }
});

test("Rent2Buy eligibility hard route does not leak into Finance conversations", () => {
  for (const message of ["Can I get a van?", "Is it easy to get?", "Will I qualify?"]) {
    assert.equal(publicApplicationGuidanceReply({
      message,
      pageType: "finance_general",
      productLock: "finance",
    }), null, message);
  }
});

test("eligibility and application-document questions are not swallowed by the Finance navigation guard", () => {
  for (const message of [
    "Can I apply if I'm self-employed?",
    "What documents do I need to apply?",
    "Will I be accepted if I apply?",
    "Can I apply with bad credit?",
  ]) {
    assert.equal(isDirectApplicationNavigationQuestion(message), false, message);
    assert.equal(publicApplicationGuidanceReply({ message, pageType: "finance_vehicle", productLock: "finance" }), null, message);
  }
});

test("public endpoint checks deterministic product guidance before canonical model generation", async () => {
  const source = await readFile(new URL("../api/ai-assistant-customer.js", import.meta.url), "utf8");
  const guidanceIndex = source.indexOf("publicApplicationGuidanceReply({");
  const canonicalIndex = source.indexOf("buildCanonicalConversationInput({", guidanceIndex);
  assert.ok(guidanceIndex >= 0);
  assert.ok(canonicalIndex > guidanceIndex);
  assert.match(source.slice(guidanceIndex, canonicalIndex), /cta: null/);
});
