import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isDirectApplicationNavigationQuestion,
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

test("eligibility and application-document questions are not swallowed by the navigation guard", () => {
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

test("public endpoint checks direct application guidance before canonical model generation", async () => {
  const source = await readFile(new URL("../api/ai-assistant-customer.js", import.meta.url), "utf8");
  const guidanceIndex = source.indexOf("publicApplicationGuidanceReply({");
  const canonicalIndex = source.indexOf("buildCanonicalConversationInput({", guidanceIndex);
  assert.ok(guidanceIndex >= 0);
  assert.ok(canonicalIndex > guidanceIndex);
  assert.match(source.slice(guidanceIndex, canonicalIndex), /cta: null/);
});
