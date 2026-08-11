import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isFinanceVehiclePage,
  isVehicleApplyPrompt,
  starterRepliesFor,
} from "../public/wix-ai-assistant/visual-polish.mjs";

const financeVehicle = {
  pageType: "finance_vehicle",
  productContext: "finance",
  vehicle: { registration: "AB12 CDE", applicationMode: "page_form" },
};

test("controlled starter replies never invent open follow-up questions", () => {
  assert.deepEqual(starterRepliesFor({ pageType: "finance_general" }), [
    "How does van finance work?",
    "Who can apply for van finance?",
    "What deposit do I need?",
  ]);
  assert.deepEqual(starterRepliesFor({ pageType: "rent2buy_general" }), [
    "How does Rent2Buy work?",
    "Who can apply for Rent2Buy?",
    "What do I need to apply?",
  ]);
  assert.deepEqual(starterRepliesFor({ pageType: "homepage" }), []);
});

test("Apply for this van starter text exists only on the full finance vehicle page", () => {
  const vehicleReplies = starterRepliesFor(financeVehicle);
  assert.ok(vehicleReplies.some((reply) => reply.toLowerCase().includes("apply for this van")));
  assert.equal(starterRepliesFor({ pageType: "finance_general" }).some((reply) => reply.toLowerCase().includes("apply for this van")), false);
  assert.equal(starterRepliesFor({ pageType: "rent2buy_general" }).some((reply) => reply.toLowerCase().includes("apply for this van")), false);
  assert.equal(starterRepliesFor({ pageType: "homepage" }).some((reply) => reply.toLowerCase().includes("apply for this van")), false);
});

test("application CTA-card treatment is hard-gated to finance_vehicle context", () => {
  const prompt = "Ready to apply? Use the APPLY NOW button on the page.";
  assert.equal(isFinanceVehiclePage(financeVehicle), true);
  assert.equal(isVehicleApplyPrompt(prompt, financeVehicle), true);
  assert.equal(isVehicleApplyPrompt(prompt, { pageType: "finance_general" }), false);
  assert.equal(isVehicleApplyPrompt(prompt, { pageType: "homepage" }), false);
  assert.equal(isVehicleApplyPrompt(prompt, { pageType: "rent2buy_general" }), false);
});

test("visual layer softens chat while preserving VFC red for actions", async () => {
  const visual = await readFile(new URL("../public/wix-ai-assistant/visual-polish.mjs", import.meta.url), "utf8");
  assert.match(visual, /--vfc-assistant:#eef5fa/);
  assert.match(visual, /--vfc-customer:#25292d/);
  assert.match(visual, /--vfc-soft-bg:#f4f6f8/);
  assert.match(visual, /Van Finance Assistant/);
  assert.match(visual, /Ask about this van or van finance/);
  assert.match(visual, /APPLY FOR THIS VAN/);
  assert.match(visual, /Use the APPLY NOW button on this vehicle page/);
  assert.match(visual, />\$\{recording \? "Stop" : "Talk"\}<\/span>/);
  assert.match(visual, /✓ Voice captured\. Check the text, then press Send\./);
});

test("mobile composer stacks message field above Talk and Send controls", async () => {
  const [visual, loader] = await Promise.all([
    readFile(new URL("../public/wix-ai-assistant/visual-polish.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/wix-ai-assistant/site-loader.js", import.meta.url), "utf8"),
  ]);
  assert.match(visual, /@media \(max-width:520px\)/);
  assert.match(visual, /\.input-row \{ flex-wrap:wrap/);
  assert.match(visual, /\.input-row textarea \{ flex:1 0 100%/);
  assert.match(visual, /\.mic \{ flex:1 1 38%/);
  assert.match(visual, /\.send \{ flex:1 1 56%/);
  assert.match(loader, /right:8px; bottom:84px; width:calc\(100vw - 16px\)/);
  assert.match(loader, /height:min\(620px, calc\(100dvh - 130px\)\)/);
});

test("visual polish loads after the existing voice resilience layer", async () => {
  const embed = await readFile(new URL("../public/wix-ai-assistant/embed.html", import.meta.url), "utf8");
  const voiceIndex = embed.indexOf('await import("./voice-live-feedback.mjs")');
  const polishIndex = embed.indexOf('await import("./visual-polish.mjs")');
  assert.ok(voiceIndex >= 0);
  assert.ok(polishIndex > voiceIndex);
});
