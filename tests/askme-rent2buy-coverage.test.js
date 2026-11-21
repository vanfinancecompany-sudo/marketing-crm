import test from "node:test";
import assert from "node:assert/strict";
import { checkRent2BuyDistance, coverageReply, findCustomerPostcode, isLocationOnlyMessage, resetRent2BuyCoverageCache } from "../lib/askme/rent2buyCoverage.js";
import { answerCustomerMessage } from "../lib/askme/leanEngine.js";
import { buildAskMeRequest } from "../lib/askme/contract.js";

const within = { ok: true, postcode: "BH23 1QH", miles: 20, eligible: true, max_miles: 100, base_postcode: "SO40 2NN", provider: "OSRM" };

test("postcodes are recognised with or without spaces, any case, inside a sentence", () => {
  for (const text of ["BH23 1QH", "bh231qh", "My postcode is bh23 1qh", "I live in BH231QH, is that ok?", "it's bh23 1qh thanks"]) {
    assert.deepEqual(findCustomerPostcode(text), { postcode: "BH23 1QH", kind: "full" }, text);
  }
  assert.equal(findCustomerPostcode("How much is this van per month?"), null);
  assert.equal(findCustomerPostcode("Is the reg LA24WZJ available?"), null);
});

test("location-only messages are answered directly; mixed questions are not", () => {
  assert.equal(isLocationOnlyMessage("bh231qh", "BH23 1QH"), true);
  assert.equal(isLocationOnlyMessage("My postcode is BH23 1QH, can you check it?", "BH23 1QH"), true);
  assert.equal(isLocationOnlyMessage("I'm in BH23 1QH, how much is this van per month?", "BH23 1QH"), false);
});

test("the agreed reply for a postcode inside the area", () => {
  assert.equal(coverageReply(within), "Good news! BH23 1QH is approximately 20 driving miles from our Southampton collection point, so you're within our normal 100-mile Rent2Buy service area. You can apply, subject to our usual eligibility and affordability checks.");
  assert.match(coverageReply({ ...within, postcode: "NE1 4ST", miles: 320.4, eligible: false }), /approximately 320 driving miles.*outside our normal 100-mile/);
  assert.match(coverageReply({ ok: false, postcode: "ZZ9 9ZZ" }), /couldn't check the driving distance for ZZ9 9ZZ/);
});

test("checkRent2BuyDistance reads the existing Rent2Buy distance API and caches by postcode", async () => {
  resetRent2BuyCoverageCache();
  let calls = 0;
  const fetchImpl = async (url) => { calls += 1; assert.match(url, /\/api\/rent2buy-distance\?postcode=BH23%201QH$/); return { ok: true, status: 200, json: async () => ({ ok: true, postcode: "BH23 1QH", miles: 20.3, eligible: true, maxMiles: 100, basePostcode: "SO40 2NN", provider: "OSRM" }) }; };
  const first = await checkRent2BuyDistance("BH23 1QH", { fetchImpl, environment: {} });
  const second = await checkRent2BuyDistance("BH23 1QH", { fetchImpl, environment: {} });
  assert.equal(first.miles, 20.3);
  assert.equal(second.cache_hit, true);
  assert.equal(calls, 1);
  resetRent2BuyCoverageCache();
  const failed = await checkRent2BuyDistance("ZZ9 9ZZ", { fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({ ok: false }) }), environment: {} });
  assert.equal(failed.ok, false);
});

const r2b = (message, history = []) => buildAskMeRequest({ channel: "website_r2b", product: "rent2buy", message, history, context: { page_type: "rent2buy_general" } });

test("lean engine answers a postcode after the area question directly, using the latest postcode", async () => {
  const seen = [];
  const checkDistance = async (postcode) => { seen.push(postcode); return { ...within, postcode }; };
  const history = [{ role: "user", content: "Is Rent2Buy available in my area?" }, { role: "assistant", content: "What's your postcode?" }, { role: "user", content: "SO15 2AB" }];
  const result = await answerCustomerMessage(r2b("sorry, it's bh231qh", history), { environment: {}, checkDistance, links: { apply: "/apply", contact: "/contact" }, requestReply: async () => { throw new Error("model must not be called"); } });
  assert.deepEqual(seen, ["BH23 1QH"]);
  assert.equal(result.diagnostics.path, "verified_coverage");
  assert.match(result.reply, /^Good news! BH23 1QH is approximately 20 driving miles/);
  assert.equal(result.actions[0]?.type, "apply");
});

test("postcode plus another question: one model call with the verified distance as evidence", async () => {
  let prompt = null;
  const result = await answerCustomerMessage(r2b("I'm in BH23 1QH, what's due upfront?"), {
    environment: {},
    checkDistance: async () => within,
    retrieve: async () => ({ passages: [], pages: [] }),
    requestReply: async (p) => { prompt = p; return { reply: "You're about 20 driving miles away, within our 100-mile area. The minimum initial rental is £1,000 plus VAT.", action: "apply", usage: {} }; },
  });
  assert.match(prompt.input, /Service-area check \(verified just now\): BH23 1QH is 20 driving miles .* WITHIN/);
  assert.notEqual(result.diagnostics.path, "verified_coverage");
});

test("finance conversations never trigger the Rent2Buy check", async () => {
  let checked = false;
  await answerCustomerMessage(buildAskMeRequest({ channel: "website_vfc", product: "finance", message: "BH23 1QH", history: [], context: { page_type: "finance_general" } }), {
    environment: {}, checkDistance: async () => { checked = true; return within; }, retrieve: async () => ({ passages: [], pages: [] }),
    requestReply: async () => ({ reply: "Thanks. How can I help with van finance?", action: "none", usage: {} }),
  });
  assert.equal(checked, false);
});
