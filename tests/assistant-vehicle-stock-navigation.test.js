import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleCustomerAssistantRequest } from "../api/ai-assistant-customer.js";
import { simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";
import {
  buildConversationMemory,
  controlledVehiclePreferenceReply,
  extractVehiclePreference,
} from "../lib/conversationIntelligence.js";
import { buildPublicStockNavigation, PUBLIC_STOCK_ROUTES } from "../lib/publicStockNavigation.js";

const deterministicConversation = (input) => simulateCustomerConversation(null, input, {
  generationMode: "deterministic",
  persist: false,
  knowledge: { settings: {}, sections: [], articles: [] },
});

test("natural Finance MWB answers are stored and move past the repeated vehicle-type question", async () => {
  const messages = [{ role: "assistant", content: "What type of van are you looking for?" }];
  const { result } = await deterministicConversation({
    message: "a mwb van",
    messages,
    remembered_facts: { budget: "£350", budget_monthly_gbp: 350 },
    product_context: "finance",
  });
  assert.equal(result.remembered_facts.vehicle_type, "Medium wheelbase");
  assert.match(result.reply, /medium-wheelbase van.*preferred make or model/i);
  assert.doesNotMatch(result.reply, /what type of van are you looking for/i);
});

test("a combined MWB and Custom preference retains both concepts", async () => {
  const messages = [{ role: "assistant", content: "What type of van are you looking for?" }];
  const { result } = await deterministicConversation({
    message: "a mwb van maybe a custom",
    messages,
    remembered_facts: { budget: "£350", budget_monthly_gbp: 350 },
    product_context: "finance",
  });
  assert.equal(result.remembered_facts.vehicle_type, "Medium wheelbase");
  assert.equal(result.remembered_facts.vehicle_interest, "Transit Custom");
  assert.match(result.reply, /medium-wheelbase van.*Transit Custom/i);
  assert.doesNotMatch(result.reply, /what type of van are you looking for/i);
});

test("Rent2Buy LWB and subsequent Transit or misspelt Sprinter preferences continue naturally", async () => {
  const lwbMessages = [{ role: "assistant", content: "What type of van are you looking for?" }];
  const first = await deterministicConversation({
    message: "a lwb van",
    messages: lwbMessages,
    remembered_facts: { budget: "£350", budget_monthly_gbp: 350 },
    product_context: "rent2buy",
  });
  assert.equal(first.result.remembered_facts.vehicle_type, "Long wheelbase");
  assert.match(first.result.reply, /long-wheelbase van.*preferred make or model/i);

  const messages = [
    ...lwbMessages,
    { role: "user", content: "a lwb van" },
    { role: "assistant", content: first.result.reply },
  ];
  const second = await deterministicConversation({
    message: "probably a transit maybe a psrinter",
    messages,
    remembered_facts: first.result.remembered_facts,
    remembered_fact_metadata: first.result.remembered_fact_metadata,
    product_context: "rent2buy",
  });
  assert.equal(second.result.remembered_facts.vehicle_type, "Long wheelbase");
  assert.equal(second.result.remembered_facts.vehicle_interest, "Transit or Sprinter");
  assert.match(second.result.reply, /long-wheelbase.*Ford Transit or Mercedes Sprinter/i);
});

test("central vehicle preference parser handles natural size and model variants", () => {
  const cases = [
    ["I need a long wheelbase van", "long", "Long wheelbase"],
    ["probably a medium wheelbase", "medium", "Medium wheelbase"],
    ["short wheelbase", "short", "Short wheelbase"],
    ["maybe a Transit Custom", "model", "Transit Custom"],
  ];
  for (const [message, kind, expected] of cases) {
    const preference = extractVehiclePreference(message);
    assert.equal(kind === "model" ? preference.vehicle_interest : preference.vehicle_type, expected, message);
  }
});


test("combined size and automatic preference retains both facts", () => {
  const preference = extractVehiclePreference("I need a medium automatic van");
  assert.equal(preference.size, "medium");
  assert.equal(preference.vehicle_type, "Medium wheelbase");
  assert.equal(preference.transmission, "automatic");

  const memory = buildConversationMemory([{ role: "user", content: "I need a medium automatic van" }]);
  assert.equal(memory.remembered_facts.vehicle_type, "Medium wheelbase");
  assert.equal(memory.remembered_facts.transmission, "automatic");
});

test("medium automatic next-step request browses automatic stock instead of jumping straight to apply", () => {
  for (const productContext of ["finance", "rent2buy"]) {
    const navigation = buildPublicStockNavigation({
      message: "I need a medium automatic van. What should I do next?",
      productContext,
      facts: {},
    });
    assert.equal(navigation.category, "automatic", productContext);
    assert.equal(navigation.cta.label, "View Automatic Vans", productContext);
    assert.match(navigation.reply, /medium automatic van/i, productContext);
    assert.match(navigation.reply, /automatic .*stock/i, productContext);
    assert.doesNotMatch(navigation.reply, /APPLY NOW/i, productContext);
  }
  assert.equal(PUBLIC_STOCK_ROUTES.finance.automatic, "https://www.vanfinancecompany.co.uk/vans-on-finance?type=Automatic");
  assert.equal(PUBLIC_STOCK_ROUTES.rent2buy.automatic, "https://www.rent2buyvans.co.uk/view-automatic-vans");
});

test("stock follow-ups resolve remembered preferences without claiming unverified availability", () => {
  const memory = buildConversationMemory([
    { role: "assistant", content: "What type of van are you looking for?" },
    { role: "user", content: "a lwb van" },
    { role: "assistant", content: "Do you have a preferred make or model?" },
    { role: "user", content: "probably a transit maybe a psrinter" },
  ]);
  const navigation = buildPublicStockNavigation({ message: "yes do you have nay", productContext: "rent2buy", facts: memory.remembered_facts });
  assert.equal(navigation.cta.label, "View LWB Vans");
  assert.equal(navigation.cta.url, PUBLIC_STOCK_ROUTES.rent2buy.large);
  assert.match(navigation.reply, /best place to see what we currently have.*long-wheelbase Rent2Buy stock/i);
  assert.doesNotMatch(navigation.reply, /definitely|available today|we have one|can.t see live stock|send an enquiry/i);
});

test("stock routes are category-aware and isolated between Finance and Rent2Buy", () => {
  const finance = buildPublicStockNavigation({ message: "have you got any?", productContext: "finance", facts: { vehicle_type: "Medium wheelbase", vehicle_interest: "Transit Custom" } });
  const rent2buy = buildPublicStockNavigation({ message: "can I see them?", productContext: "rent2buy", facts: { vehicle_type: "Medium wheelbase", vehicle_interest: "Transit Custom" } });
  const directCustom = buildPublicStockNavigation({ message: "got any Customs?", productContext: "finance", facts: {} });
  const all = buildPublicStockNavigation({ message: "show me some vans", productContext: "finance", facts: {} });
  assert.equal(finance.cta.url, "https://www.vanfinancecompany.co.uk/vans-on-finance?type=Medium");
  assert.equal(rent2buy.cta.url, "https://www.rent2buyvans.co.uk/view-medium-vans");
  assert.equal(directCustom.cta.url, PUBLIC_STOCK_ROUTES.finance.medium);
  assert.equal(all.cta.url, PUBLIC_STOCK_ROUTES.finance.all);
  assert.doesNotMatch(finance.cta.url, /rent2buy/i);
  assert.doesNotMatch(rent2buy.cta.url, /vanfinancecompany/i);
});

test("public assistant emits a structured stock CTA and persists its final safe reply", async () => {
  const state = { session: {
    id: "stock-session",
    page_type: "rent2buy_general",
    product_lock: "rent2buy",
    vehicle_context: {},
    conversation_history: [{ role: "user", content: "a lwb van" }, { role: "assistant", content: "A long-wheelbase van — understood." }],
    remembered_facts: { product_context: "rent2buy", vehicle_type: "Long wheelbase", vehicle_interest: "Transit or Sprinter" },
    journey_state: {}, message_count: 2, status: "active", expires_at: new Date(Date.now() + 60_000).toISOString(),
  } };
  const supabase = {
    async rpc() { return { data: true, error: null }; },
    from(table) {
      if (table === "ai_assistant_events") return { insert() { return { async select() { return { data: [], error: null }; } }; } };
      assert.equal(table, "ai_customer_sessions");
      return {
        select() { const chain = { eq() { return chain; }, async maybeSingle() { return { data: structuredClone(state.session), error: null }; } }; return chain; },
        update(payload) { state.session = { ...state.session, ...structuredClone(payload) }; const chain = { eq() { return chain; }, select() { return { async single() { return { data: structuredClone(state.session), error: null }; } }; } }; return chain; },
      };
    },
  };
  const response = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await handleCustomerAssistantRequest({
    method: "POST",
    headers: { origin: "https://www.rent2buyvans.co.uk", "x-forwarded-for": "192.0.2.81" },
    body: { action: "message", conversation_id: "opaque", page_context: { pageType: "rent2buy_general" }, message: "do you have any?" },
  }, response, {
    environment: { AI_ASSISTANT_SESSION_SECRET: "stock-test-secret", AI_ASSISTANT_ALLOWED_ORIGINS: "https://www.rent2buyvans.co.uk" },
    supabase,
    simulateConversation: (_client, input) => deterministicConversation(input),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.cta, { label: "View LWB Vans", action: "navigate", behavior: "same_window", url: "https://www.rent2buyvans.co.uk/view-lwb-vans" });
  assert.equal(state.session.conversation_history.at(-1).content, response.payload.reply);
  assert.doesNotMatch(response.payload.reply, /definitely|available today|we have one/i);
});

test("live Rent2Buy prompt for a medium automatic van returns stock guidance rather than generic APPLY NOW", async () => {
  const state = { session: {
    id: "automatic-stock-session",
    page_type: "rent2buy_general",
    product_lock: "rent2buy",
    vehicle_context: {},
    conversation_history: [],
    remembered_facts: { product_context: "rent2buy" },
    journey_state: {}, message_count: 0, status: "active", expires_at: new Date(Date.now() + 60_000).toISOString(),
  } };
  const supabase = {
    async rpc() { return { data: true, error: null }; },
    from(table) {
      if (table === "ai_assistant_events") return { insert() { return { async select() { return { data: [], error: null }; } }; } };
      assert.equal(table, "ai_customer_sessions");
      return {
        select() { const chain = { eq() { return chain; }, async maybeSingle() { return { data: structuredClone(state.session), error: null }; } }; return chain; },
        update(payload) { state.session = { ...state.session, ...structuredClone(payload) }; const chain = { eq() { return chain; }, select() { return { async single() { return { data: structuredClone(state.session), error: null }; } }; } }; return chain; },
      };
    },
  };
  const response = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };

  await handleCustomerAssistantRequest({
    method: "POST",
    headers: { origin: "https://www.rent2buyvans.co.uk", "x-forwarded-for": "192.0.2.82" },
    body: {
      action: "message",
      conversation_id: "opaque",
      page_context: { pageType: "rent2buy_general" },
      message: "I need a medium automatic van. What should I do next?",
    },
  }, response, {
    environment: { AI_ASSISTANT_SESSION_SECRET: "stock-test-secret", AI_ASSISTANT_ALLOWED_ORIGINS: "https://www.rent2buyvans.co.uk" },
    supabase,
    simulateConversation: (_client, input) => deterministicConversation(input),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.cta.label, "View Automatic Vans");
  assert.equal(response.payload.cta.url, PUBLIC_STOCK_ROUTES.rent2buy.automatic);
  assert.match(response.payload.reply, /medium automatic van/i);
  assert.doesNotMatch(response.payload.reply, /APPLY NOW/i);
  assert.equal(state.session.remembered_facts.vehicle_type, "Medium wheelbase");
  assert.equal(state.session.remembered_facts.transmission, "automatic");
});

test("the site bridge navigates only after the widget emits a validated stock CTA", async () => {
  const loader = await readFile(new URL("../public/wix-ai-assistant/site-loader.js", import.meta.url), "utf8");
  assert.match(loader, /function navigateStockCta/);
  assert.match(loader, /window\.location\.assign\(url\.href\)/);
  assert.match(loader, /lockedProduct === "finance" && !financeUrl/);
  assert.match(loader, /lockedProduct === "rent2buy" && !rent2BuyUrl/);
});

test("vehicle preference acknowledgement never treats a stock question as a new preference statement", () => {
  assert.equal(controlledVehiclePreferenceReply({ message: "got any Customs?", facts: { vehicle_interest: "Transit Custom" } }), null);
});
