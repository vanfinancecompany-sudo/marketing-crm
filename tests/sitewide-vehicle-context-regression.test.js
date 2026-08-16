import test from "node:test";
import assert from "node:assert/strict";
import { handleSitewideAssistantRequest } from "../api/ai-assistant-sitewide.js";
import { clearPublicWixVehicleContextCache } from "../lib/publicWixSiteContext.js";

const environment = {
  AI_ASSISTANT_SESSION_SECRET: "sitewide-vehicle-regression-secret",
  AI_ASSISTANT_ALLOWED_ORIGINS: "https://www.vanfinancecompany.co.uk,https://www.rent2buyvans.co.uk",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  WIX_API_KEY: "test-wix-key",
  WIX_SITE_ID: "test-wix-site",
};

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

function activeSession(vehicleContext, pageType = "finance_vehicle", productLock = "finance") {
  return {
    id: "sitewide-session-id",
    page_type: pageType,
    product_lock: productLock,
    vehicle_context: vehicleContext,
    conversation_history: [],
    remembered_facts: { product_context: productLock, vehicle_interest: vehicleContext.registration },
    journey_state: {},
    application_readiness: "Exploring",
    budget: null,
    employment: null,
    message_count: 0,
    status: "active",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

function mockSupabase(initialSession) {
  const state = {
    session: structuredClone(initialSession),
    sessionUpdates: [],
    rpcCalls: 0,
    telemetryRows: [],
  };

  function sessionQuery() {
    const chain = {
      eq() { return chain; },
      async maybeSingle() { return { data: structuredClone(state.session), error: null }; },
      async single() { return { data: structuredClone(state.session), error: null }; },
    };
    return chain;
  }

  function sessionUpdate(payload) {
    let applied = false;
    const apply = () => {
      if (applied) return;
      applied = true;
      state.session = { ...state.session, ...structuredClone(payload) };
      state.sessionUpdates.push(structuredClone(payload));
    };
    const chain = {
      eq() { apply(); return chain; },
      select() {
        apply();
        return { async single() { return { data: structuredClone(state.session), error: null }; } };
      },
      then(resolve, reject) {
        apply();
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return chain;
  }

  const client = {
    async rpc() { state.rpcCalls += 1; return { data: true, error: null }; },
    from(table) {
      if (table === "ai_customer_sessions") {
        return {
          select() { return sessionQuery(); },
          update(payload) { return sessionUpdate(payload); },
        };
      }
      if (table === "ai_assistant_events") {
        return {
          insert(rows) {
            state.telemetryRows.push(...structuredClone(rows));
            return {
              async select() {
                return { data: rows.map((_, index) => ({ id: `event-${index}` })), error: null };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { client, state };
}

function wixResponse(dataItems) {
  return {
    ok: true,
    status: 200,
    async json() { return { dataItems }; },
  };
}

function financeCmsFetch(registration = "CK24 NRO") {
  return async (_url, options) => {
    const candidate = JSON.parse(options.body).query.filter.title.$eq;
    if (candidate !== registration) return wixResponse([]);
    return wixResponse([{
      id: `finance-${registration.replace(/\s+/g, "").toLowerCase()}`,
      data: {
        title: registration,
        titleText: registration.replace(/\s+/g, "") === "CK24NRO"
          ? "Ford Transit Trend CREW VAN"
          : "Ford Transit Custom Limited",
        year: "2024/24",
        descriptionLine: "CREW VAN - AIR CON - CRUISE CONTROL",
        vehicleDescriptionTextClick: "A diesel Transit crew van prepared for sale.",
        vehicleSpecificationText: `REGISTRATION: ${registration}\nMILEAGE: 27,000\nENGINE SIZE: 2.0\nFUEL TYPE: DIESEL\nTRANSMISSION: MANUAL`,
        applyLink: `/apply/${registration.replace(/\s+/g, "").toLowerCase()}`,
        priceVat: "£22,995 +VAT",
        mthPrice: "£480",
      },
    }]);
  };
}

async function sendSitewideMessage({ pageUrl, origin, conversationId, supabase, fetchImpl }) {
  const response = responseRecorder();
  let modelCalls = 0;
  await handleSitewideAssistantRequest({
    method: "POST",
    headers: { origin, "x-forwarded-for": "192.0.2.50" },
    body: {
      action: "message",
      conversation_id: conversationId,
      page_url: pageUrl,
      message: "Tell me about this van",
    },
  }, response, {
    environment,
    supabase,
    fetchImpl,
    simulateConversation: async () => {
      modelCalls += 1;
      throw new Error("The CMS-backed deterministic vehicle reply should handle this request.");
    },
  });
  return { response, modelCalls };
}

test("site-wide request upgrades an identity-only session and answers Tell me about this van from the resolved CMS profile", async () => {
  clearPublicWixVehicleContextCache();
  const conversationId = "existing-identity-only-conversation";
  const { client, state } = mockSupabase(activeSession({
    registration: "CK24NRO",
    vehicle_id: null,
    title: null,
    pricing: {},
  }));

  const { response, modelCalls } = await sendSitewideMessage({
    pageUrl: "https://www.vanfinancecompany.co.uk/van-finance/ck24nro",
    origin: "https://www.vanfinancecompany.co.uk",
    conversationId,
    supabase: client,
    fetchImpl: financeCmsFetch("CK24 NRO"),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(modelCalls, 0);
  assert.match(response.payload.reply, /Ford Transit Trend CREW VAN/i);
  assert.match(response.payload.reply, /27,000 miles/i);
  assert.match(response.payload.reply, /DIESEL/i);
  assert.match(response.payload.reply, /MANUAL/i);
  assert.match(response.payload.reply, /retail price £22,995 \+VAT/i);
  assert.match(response.payload.reply, /Finance from £480/i);
  assert.equal(state.session.vehicle_context.registration, "CK24NRO");
  assert.equal(state.session.vehicle_context.title, "Ford Transit Trend CREW VAN");
  assert.match(state.session.vehicle_context.specification, /27,000/);
  assert.equal(state.session.remembered_facts.vehicle_interest, "Ford Transit Trend CREW VAN");
  assert.equal(state.sessionUpdates.some((update) => update.vehicle_context?.title === "Ford Transit Trend CREW VAN"), true);
});

test("site-wide request cannot upgrade an existing session with a different registration", async () => {
  clearPublicWixVehicleContextCache();
  const conversationId = "different-vehicle-conversation";
  const { client, state } = mockSupabase(activeSession({
    registration: "CK24NRO",
    vehicle_id: null,
    title: null,
    pricing: {},
  }));

  const { response } = await sendSitewideMessage({
    pageUrl: "https://www.vanfinancecompany.co.uk/van-finance/ab12cde",
    origin: "https://www.vanfinancecompany.co.uk",
    conversationId,
    supabase: client,
    fetchImpl: financeCmsFetch("AB12CDE"),
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.payload.reply, /vehicle changed/i);
  assert.equal(state.session.vehicle_context.registration, "CK24NRO");
  assert.equal(state.session.vehicle_context.title, null);
  assert.equal(state.sessionUpdates.some((update) => update.vehicle_context?.registration === "AB12CDE"), false);
});

test("site-wide Rent2Buy resolution remains product-separated from Finance fields", async () => {
  clearPublicWixVehicleContextCache();
  const conversationId = "rent2buy-vehicle-conversation";
  const { client, state } = mockSupabase(activeSession({
    registration: "YR22OKJ",
    vehicle_id: null,
    title: null,
    pricing: {},
  }, "rent2buy_general", "rent2buy"));
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.dataCollectionId, "VANPAGES");
    return wixResponse([{
      id: "rent2buy-yr22okj",
      data: {
        title: "YR22OKJ",
        titleText: "Peugeot Boxer Professional",
        year: "2022/22",
        descriptionText: "A Boxer prepared for Rent2Buy.",
        vehcleTickDescription: "AIR CONDITIONING - BLUETOOTH",
        specText: "REGISTRATION: YR22 OKJ\nMILEAGE: 50,000\nFUEL TYPE: DIESEL\nTRANSMISSION: MANUAL",
        intialRentalCharge: "£1,800 + VAT / £2,160 inc VAT",
        monthlyPayments: "£515 + VAT / £618 inc VAT",
        priceVat: "£99,999 + VAT",
        mthPrice: "£9,999",
      },
    }]);
  };

  const { response, modelCalls } = await sendSitewideMessage({
    pageUrl: "https://www.rent2buyvans.co.uk/van-pages/yr22okj",
    origin: "https://www.rent2buyvans.co.uk",
    conversationId,
    supabase: client,
    fetchImpl,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(modelCalls, 0);
  assert.match(response.payload.reply, /Peugeot Boxer Professional/i);
  assert.match(response.payload.reply, /initial rental £1,800 \+ VAT/i);
  assert.match(response.payload.reply, /monthly payments £515 \+ VAT/i);
  assert.doesNotMatch(response.payload.reply, /£99,999|£9,999|retail price|Finance from/i);
  assert.equal(state.session.product_lock, "rent2buy");
  assert.equal(state.session.vehicle_context.pricing.finance_monthly, undefined);
  assert.equal(state.session.vehicle_context.pricing.finance_retail_vat, undefined);
});
