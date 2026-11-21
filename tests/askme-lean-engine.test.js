import test from "node:test";
import assert from "node:assert/strict";
import { buildAskMeRequest, sanitiseActions } from "../lib/askme/contract.js";
import { answerCustomerMessage, buildLeanActions, buildLeanPrompt, checkLeanReply } from "../lib/askme/leanEngine.js";
import { normalisePageContext } from "../lib/publicAssistantFoundation.js";
import { handleCustomerAssistantRequest, selectAskMeEngine, websiteChannelFor } from "../api/ai-assistant-customer.js";

const vfcVehicle = normalisePageContext({ page_type: "finance_vehicle", vehicle: {
  registration: "LS73XFA", title: "Ford Transit Custom 320 Limited", year: "2023/73", vehicle_kind: "van",
  specification: "MILEAGE: 21,000\nFUEL TYPE: DIESEL\nTRANSMISSION: MANUAL", apply_link: "/apply?vehicle=LS73XFA",
  stock_status: "available", pricing: { finance_monthly: "£641", finance_retail_vat: "£30,495" }, vat_status: "No VAT applicable",
} }).vehicle;
const r2bVehicle = normalisePageContext({ page_type: "rent2buy_general", vehicle: {
  registration: "LR72PJU", title: "MAXUS eDeliver 9", apply_link: "/apply-for-no-credit-check-rent2buy-vans?registration=LR72PJU",
  stock_status: "available", pricing: { rent2buy_initial: "£2,190", rent2buy_monthly: "£525" }, term_months: 48,
} }).vehicle;
const verifiedQuote = { status: "verified", registration: "LR72PJU", quote_id: "q-12345678", vehicle_title: "MAXUS eDeliver 9", term_months: 36, miles_per_month: 2000, initial_ex_vat: 3000, initial_inc_vat: 3600, monthly_ex_vat: 610, monthly_inc_vat: 732 };
const financeLinks = { browse_stock: "/vans", apply: "/apply", contact: "/contact" };

const request = (overrides) => buildAskMeRequest({ channel: "website_vfc", product: "finance", message: "hello", context: { page_type: "finance_general" }, ...overrides });
const modelReturning = (reply, action = "none", seen = {}) => async (prompt, route) => { seen.prompt = prompt; seen.route = route; return { reply, action, model: route.model, usage: { input_tokens: 900, output_tokens: 60 } }; };
const noModel = async () => assert.fail("the model must not be called for verified pricing");

test("the contract locks product and is channel-neutral", () => {
  assert.throws(() => buildAskMeRequest({ channel: "whatsapp", product: "both", message: "hi" }), /locked product/);
  const whatsapp = buildAskMeRequest({ channel: "whatsapp", product: "rent2buy", message: "Am I covered in Poole?" });
  assert.equal(whatsapp.context.page_type, null);
  assert.deepEqual(whatsapp.context.selected_quote, { status: "none" });
  assert.deepEqual(sanitiseActions([{ type: "apply", label: "Go", url: "javascript:alert(1)" }, { type: "hack", label: "x", url: "/x" }]), []);
});

test("narrow checks: approval promises, cross-product words and unverified £ figures", () => {
  const evidenceText = "deposit from £99. Monthly £641.";
  assert.deepEqual(checkLeanReply("Yes, you can apply. Approval isn't guaranteed.", { product: "finance", evidenceText }).problems, []);
  assert.ok(checkLeanReply("You'll be approved, don't worry.", { product: "finance", evidenceText }).problems.includes("approval_promise"));
  assert.ok(checkLeanReply("You could also try Rent2Buy.", { product: "finance", evidenceText }).problems.includes("cross_product_rent2buy"));
  assert.ok(checkLeanReply("Our lenders will decide.", { product: "rent2buy", evidenceText }).problems.includes("cross_product_finance"));
  assert.match(checkLeanReply("It's £599 a month.", { product: "finance", evidenceText }).problems.join(), /unverified_figure:599/);
  assert.deepEqual(checkLeanReply("From £641 a month, deposits from £99.", { product: "finance", evidenceText }).problems, []);
});

test("actions are built from verified data: vehicle apply, reserved vehicles, verified quotes, general pages", () => {
  assert.deepEqual(buildLeanActions({ product: "finance", vehicle: vfcVehicle, links: financeLinks, choice: "apply" }), [{ type: "apply", label: "Apply for this van", url: "/apply?vehicle=LS73XFA" }]);
  const reserved = { ...vfcVehicle, stock_status: "reserved" };
  assert.deepEqual(buildLeanActions({ product: "finance", vehicle: reserved, links: financeLinks, choice: "apply" }), [{ type: "browse_stock", label: "Browse vans", url: "/vans" }]);
  const quoteApply = buildLeanActions({ product: "rent2buy", vehicle: r2bVehicle, selectedQuote: verifiedQuote, quoteToken: "v1.abc.def", links: {}, choice: "apply" });
  assert.equal(quoteApply[0].label, "Apply with my selected quote");
  assert.match(quoteApply[0].url, /registration=LR72PJU&r2b_quote=v1\.abc\.def$/);
  assert.deepEqual(buildLeanActions({ product: "finance", vehicle: {}, links: financeLinks, choice: "apply" }), [{ type: "apply", label: "Start a finance application", url: "/apply" }]);
  assert.deepEqual(buildLeanActions({ product: "finance", vehicle: vfcVehicle, links: financeLinks, choice: "none" }), []);
});

test("verified pricing is answered from page data without a model call, with an apply action", async () => {
  const result = await answerCustomerMessage(request({ message: "What would I pay upfront and per month?", context: { page_type: "finance_vehicle", vehicle: vfcVehicle } }), { links: financeLinks, requestReply: noModel });
  assert.match(result.reply, /£641/);
  assert.match(result.reply, /£30,495/);
  assert.match(result.reply, /from £99/);
  assert.equal(result.actions[0].url, "/apply?vehicle=LS73XFA");
  assert.equal(result.diagnostics.path, "verified_pricing");
});

test("Rent2Buy: a verified selected quote is used exactly; without one the listing is labelled", async () => {
  const withQuote = await answerCustomerMessage(buildAskMeRequest({ channel: "website_rent2buy", product: "rent2buy", message: "How much is this one a month?", context: { page_type: "rent2buy_general", vehicle: r2bVehicle, selected_quote: verifiedQuote, quote_token: "v1.abc.def" } }), { requestReply: noModel });
  assert.match(withQuote.reply, /£610 plus VAT per month/);
  assert.doesNotMatch(withQuote.reply, /£525/);
  assert.equal(withQuote.actions[0].label, "Apply with my selected quote");
  const listing = await answerCustomerMessage(buildAskMeRequest({ channel: "website_rent2buy", product: "rent2buy", message: "What's due upfront and per month?", context: { page_type: "rent2buy_general", vehicle: r2bVehicle } }), { requestReply: noModel });
  assert.match(listing.reply, /advertised illustration/);
  assert.match(listing.reply, /£2,190 \+ VAT initial rental/);
  assert.match(listing.reply, /calculator/);
});

test("eligibility goes to one model call with the verified facts in the prompt", async () => {
  const seen = {};
  const result = await answerCustomerMessage(request({ message: "I've got a CCJ, can I still apply?" }), {
    links: financeLinks,
    environment: { OPENAI_WIX_MAIN_MODEL: "gpt-6-sol" },
    requestReply: modelReturning("Yes, you can still apply with a CCJ. Approval isn't guaranteed and depends on affordability, status and lender criteria. Would you like to start an application?", "apply", seen),
  });
  assert.match(seen.prompt.input, /poor or bad credit can apply/i);
  assert.match(seen.prompt.instructions, /Never mention Rent2Buy/);
  assert.equal(seen.route.model, "gpt-6-sol");
  assert.equal(seen.route.reasoning_effort, "low");
  assert.match(result.reply, /you can still apply/);
  assert.deepEqual(result.actions, [{ type: "apply", label: "Start a finance application", url: "/apply" }]);
  assert.equal(result.diagnostics.path, "model");
});

test("a reply with an invented figure is replaced by a safe answer and a contact action", async () => {
  const result = await answerCustomerMessage(request({ message: "How much would a Transit cost me a month?" }), {
    links: financeLinks,
    requestReply: modelReturning("A Transit would be about £350 a month.", "none"),
  });
  assert.doesNotMatch(result.reply, /£350/);
  assert.equal(result.diagnostics.path, "model_rejected");
  assert.equal(result.actions[0].type, "contact");
});

test("Rent2Buy prompt keeps finance words out and carries the self-employed policy", () => {
  const prompt = buildLeanPrompt(buildAskMeRequest({ channel: "whatsapp", product: "rent2buy", message: "I'm self-employed. Will Rent2Buy consider me?" }));
  assert.match(prompt.input, /Self-employed customers can apply/);
  assert.match(prompt.instructions, /never mention lenders, APR/);
  assert.doesNotMatch(prompt.instructions, /chatting with a customer on the website/);
});

test("engine selection: legacy by default; test visitors use lean on Preview; ASKME_ENGINE=lean switches all traffic", () => {
  assert.equal(selectAskMeEngine({}, {}), "legacy");
  assert.equal(selectAskMeEngine({ analytics_visitor_id: "askme-test-1" }, {}), "legacy", "production test visitors stay legacy unless lean_test");
  assert.equal(selectAskMeEngine({ analytics_visitor_id: "askme-test-1" }, { VERCEL_ENV: "preview" }), "lean");
  assert.equal(selectAskMeEngine({ analytics_visitor_id: "askme-test-1", askme_engine: "legacy" }, { VERCEL_ENV: "preview" }), "legacy");
  assert.equal(selectAskMeEngine({ analytics_visitor_id: "customer" }, { VERCEL_ENV: "preview" }), "legacy");
  assert.equal(selectAskMeEngine({}, { ASKME_ENGINE: "lean" }), "lean");
  assert.equal(websiteChannelFor("https://www.rent2buyvans.co.uk").channel, "website_rent2buy");
});

// ---- Endpoint (website adapter) ------------------------------------------------------

const environment = { AI_ASSISTANT_SESSION_SECRET: "test-session-secret-that-is-long-enough", VERCEL_ENV: "preview" };
function responseRecorder() {
  return { headers: {}, statusCode: null, payload: null, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; }, end() { return this; } };
}
function mockSupabase(session) {
  const state = { updated: null, tables: [] };
  return {
    state,
    client: {
      async rpc() { return { data: true, error: null }; },
      from(table) {
        state.tables.push(table);
        return {
          select() { const chain = { eq() { return chain; }, async maybeSingle() { return { data: session, error: null }; } }; return chain; },
          update(payload) { state.updated = payload; const chain = { eq() { return chain; }, select() { return { async single() { return { data: { ...session, ...payload }, error: null }; } }; } }; return chain; },
          insert() { return { select() { return { async single() { return { data: {}, error: null }; } }; } }; },
        };
      },
    },
  };
}
const session = () => ({
  id: "session-1", page_type: "finance_vehicle", product_lock: "finance", vehicle_context: vfcVehicle,
  conversation_history: [], remembered_facts: { product_context: "finance" }, journey_state: { test_traffic: true },
  message_count: 0, status: "active", expires_at: new Date(Date.now() + 60_000).toISOString(),
});

test("endpoint: a Preview test visitor gets the lean engine, structured actions and no telemetry", async () => {
  const { client, state } = mockSupabase(session());
  const response = responseRecorder();
  await handleCustomerAssistantRequest({
    method: "POST",
    headers: { origin: "https://www.vanfinancecompany.co.uk", "x-forwarded-for": "192.0.2.30" },
    body: { action: "message", conversation_id: "conv-1", analytics_visitor_id: "askme-test-golden", page_context: { page_type: "finance_vehicle", vehicle: { registration: "LS73XFA" } }, message: "What are this van's key specs?" },
  }, response, {
    environment,
    supabase: client,
    simulateConversation: async () => assert.fail("legacy engine must not run for lean traffic"),
    leanRequestReply: modelReturning("It's a 2023 Ford Transit Custom 320 Limited with 21,000 miles, a diesel engine and a manual gearbox.", "apply"),
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.payload.reply, /21,000 miles/);
  assert.deepEqual(response.payload.actions, [{ type: "apply", label: "Apply for this van", url: "/apply?vehicle=LS73XFA" }]);
  assert.equal(response.payload.cta.url, "/apply?vehicle=LS73XFA");
  assert.equal(response.payload.diagnostics.engine, "lean");
  assert.ok(!state.tables.includes("ai_assistant_events"), "test traffic never reaches telemetry");
  assert.equal(state.updated.message_count, 1);
});

test("endpoint: ordinary customers stay on the legacy engine and get no diagnostics", async () => {
  const { client } = mockSupabase(session());
  const response = responseRecorder();
  let legacyCalled = false;
  await handleCustomerAssistantRequest({
    method: "POST",
    headers: { origin: "https://www.vanfinancecompany.co.uk", "x-forwarded-for": "192.0.2.31" },
    body: { action: "message", conversation_id: "conv-2", analytics_visitor_id: "visitor-123", page_context: { page_type: "finance_vehicle", vehicle: { registration: "LS73XFA" } }, message: "Can you tell me about the warranty?" },
  }, response, {
    environment,
    supabase: client,
    simulateConversation: async () => { legacyCalled = true; return { result: { reply: "Legacy reply.", remembered_facts: {} } }; },
    leanRequestReply: async () => assert.fail("lean engine must not run for ordinary customers"),
  });
  assert.equal(legacyCalled, true);
  assert.equal(response.payload.reply, "Legacy reply.");
  assert.equal(response.payload.diagnostics, undefined);
});
