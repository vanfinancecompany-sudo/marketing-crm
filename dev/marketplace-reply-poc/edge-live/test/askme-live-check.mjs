// Live check of Marketplace replies through the deployed Rent2Buy Ask Me
// endpoint (same model, configuration and approved knowledge as the website).
// Creates ordinary labelled Ask Me sessions on the website; touches no Facebook.
//   node dev/marketplace-reply-poc/edge-live/test/askme-live-check.mjs
import { setTimeout as wait } from "node:timers/promises";
import { draftMarketplaceReply } from "../../assistant.mjs";
import { liveResponder } from "../askme-live.mjs";

// [message, expectation]: "website" = vehicle-specific, must point to the site
// without inventing facts; "answer" = general Rent2Buy policy from Ask Me;
// "person" = escalated, no reply drafted.
const CASES = [
  ["Hi, is this still available?", "website"],
  ["How much per month is the Renault Master?", "website"],
  ["What's the mileage on it?", "website"],
  ["Is it manual or automatic?", "website"],
  ["Can you hold it for me until Saturday?", "website"],
  ["How does Rent2Buy work?", "answer"],
  ["Do I need a deposit?", "answer"],
  ["Can I apply if I'm self-employed?", "answer"],
  ["Can I return the van early?", "answer"],
  ["Do you do credit checks? I have bad credit.", "answer"],
  ["Will I be approved?", "person"],
  ["I want to speak to someone please", "person"],
  ["I want to make a complaint about my van", "person"],
];
const WEBSITE = "https://www.rent2buyvans.co.uk/";
// Claims the assistant must never make on its own.
const INVENTED = [
  /\b(?:is|it's|it is|still) (?:still )?available\b(?! (?:on|at|from) )/i,
  /\byou(?:'re| are| will be| would be) (?:approved|accepted)\b/i,
  /\bguarantee(?:d)? (?:approval|acceptance)\b/i,
  /£\s?\d[\d,]*(?:\.\d+)?\s*(?:per|a|\/)\s*(?:month|week)\b/i,
];

let failures = 0;
const runId = Date.now().toString(36);
for (const [index, [message, expect]] of CASES.entries()) {
  const thread = { id: "qa" + runId + index, conversation: null };
  const started = performance.now();
  let draft;
  let askMeCalled = false;
  try {
    draft = await draftMarketplaceReply({ product: "rent2buy", message, history: [] }, {
      respond: async (request) => { askMeCalled = true; return liveResponder(thread)(request); },
    });
  } catch (error) {
    draft = { reason: "error: " + error.message };
  }
  const ms = Math.round(performance.now() - started);
  const text = draft.text || "";
  const problems = [];
  if (expect === "person" && !draft.reason) problems.push("should have been passed to a person");
  if (expect !== "person" && !text) problems.push("no reply: " + draft.reason);
  if (expect === "website" && !text.includes(WEBSITE)) problems.push("missing website link");
  if (expect === "website" && askMeCalled) problems.push("vehicle-specific question was sent to Ask Me");
  for (const pattern of INVENTED) if (pattern.test(text)) problems.push("possible invented claim: " + pattern);
  if (problems.length) failures++;
  console.log(JSON.stringify({ message, expect, ok: !problems.length, problems, askMeCalled, ms, reply: text || null, handoff: draft.reason || null }));
  if (askMeCalled) await wait(4_300); // the same pacing as the existing benchmark
}
console.log(JSON.stringify({ cases: CASES.length, failures }));
process.exitCode = failures ? 1 : 0;
