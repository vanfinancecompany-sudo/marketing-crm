import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assistantTitle } from "../public/wix-ai-assistant/widget.mjs";

test("assistant title follows the current Finance or Rent2Buy page context", () => {
  assert.equal(assistantTitle({ pageType: "finance_vehicle", productContext: "finance" }), "Finance Assistant");
  assert.equal(assistantTitle({ pageType: "finance_general", productContext: "finance" }), "Finance Assistant");
  assert.equal(assistantTitle({ pageType: "rent2buy_general", productContext: "rent2buy" }), "Rent2Buy Assistant");
  assert.equal(assistantTitle({ pageType: "homepage", productContext: null }), "Finance & Rent2Buy");
});

test("site-wide launcher is labelled Ask Me rather than Live Chat", async () => {
  const loader = await readFile(new URL("../public/wix-ai-assistant/site-loader.js", import.meta.url), "utf8");
  assert.match(loader, />Ask Me<\/button>/);
  assert.match(loader, /aria-label="Ask a question"/);
});
