import test from "node:test";
import assert from "node:assert/strict";
import { createMuseHandler } from "../api/muse.js";
import { scrubForMuse, containsPii, museAuthorised, rateLimited } from "../lib/museConnector.js";

const KEY = "k".repeat(40);
const PII = {
  email: "jane.doe@example.com",
  phone: "07700 900123",
  name: "Jane Doe",
  postcode: "SW1A 1AA",
};

// Fixtures deliberately full of customer data, including in free-text fields.
const tables = {
  facebook_adverts: [{ id: 1, title: "Ford Transit Custom", price: 15995, vat: "plus", salePrice: 14995, vanDescription: `Call ${PII.phone} or ${PII.email}`, vanSpec: "L1H1", weblink: "https://example.com/v/1" }],
  rent_vehicles: [{ registration: "AB12CDE", created_at: "2026-11-01T00:00:00Z", monthly: 499, week: 115, initialRental: 999, vanDescription: "Clean van", vanSpec: "L2H1", webLink: "https://example.com/r/1" }],
  vehicle_views: [{ registration: "AB12 CDE" }, { registration: "AB12CDE" }],
  conversation_events: [
    { source_id: "e1", channel: "facebook_marketplace", kind: "received", occurred_at: "2026-11-20T10:00:00Z", product: "finance", question_excerpt: `I'm ${PII.name}, ${PII.email}`, conversation_ref: "abc" },
    { source_id: "TEST-1", channel: "facebook_marketplace", kind: "received", occurred_at: "2026-11-20T10:00:00Z" },
  ],
  ai_customer_sessions: [{ product_lock: "rent2buy", message_count: 4, last_activity_at: "2026-11-21T09:00:00Z", conversation_history: [{ role: "user", content: `My number is ${PII.phone}` }] }],
  knowledge_assistant_opportunities: [
    { product: "finance", normalised_intent: "credit_eligibility", title: `Jane Doe bad credit finance (asked by ${PII.email})`, status: "new", priority_level: "high", priority_score: 80, question_count: 12, unanswered_count: 3, weak_answer_count: 1, recommended_action: "create_faq", internal_notes: `Call ${PII.name} on ${PII.phone}` },
    // Learning-engine fallback intents are built from the customer's own words.
    { product: "rent2buy", normalised_intent: "jane_doe_sw1a_van", title: "Rent2Buy: jane doe sw1a van", suggested_article_title: "Rent2Buy: jane doe sw1a van", status: "new", priority_level: "low", priority_score: 10, question_count: 1, recommended_action: "Ring Jane Doe" },
    { product: "rent2buy", normalised_intent: "smith_family_question", title: "Rent2Buy: smith family question", status: "new", priority_level: "medium", priority_score: 30, question_count: 2 },
  ],
  ai_assistant_events: [],
  knowledge_hub_search_events: [
    { event_type: "search_submitted", result_count: 0, query_text: "Jane Doe deposit", normalised_query: "jane doe deposit", visitor_hash: "v1", created_at: "2026-11-20T10:00:00Z" },
    { event_type: "search_submitted", result_count: 0, query_text: "contact Smithson about my van", normalised_query: "contact smithson about my van", visitor_hash: "v2", created_at: "2026-11-20T11:00:00Z" },
  ],
  marketing_campaigns: [{ id: "c1", name: "Black Friday vans", description: "Promo", channel: "email", objective: "promotion", status: "completed", created_by: PII.email }],
  marketing_email_sends: [{ campaign_id: "c1", send_type: "production", requested_count: 100, eligible_count: 90, sent_count: 88, failed_count: 2, completed_at: "2026-11-22T00:00:00Z", error_summary: `bounce ${PII.email}` }],
  marketing_contacts: [{ first_name: "Jane", last_name: "Doe", email: PII.email, phone: PII.phone, postcode: PII.postcode }],
};

// Minimal chainable Supabase double: every filter returns the same builder; it
// resolves to the table's rows (or a count for head queries).
function fakeSupabase() {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, head: false, ops: [] };
      const builder = new Proxy({}, {
        get(_, prop) {
          if (prop === "then") {
            const data = tables[table] || [];
            const result = state.head ? { count: data.length, error: null } : { data, error: null };
            return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
          }
          return (...args) => {
            state.ops.push(prop);
            if (prop === "select" && args[1]?.head) state.head = true;
            if (["insert", "update", "upsert", "delete", "rpc"].includes(prop)) calls.push(`${table}.${prop}`);
            return builder;
          };
        },
      });
      return builder;
    },
  };
}

function call(handler, { method = "GET", resource, headers = {}, query = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body, headers: this.headers }); return this; },
      end() { resolve({ status: this.statusCode, body: null, headers: this.headers }); return this; },
    };
    handler({ method, headers: { "x-forwarded-for": `10.0.0.${Math.random()}`, ...headers }, query: { resource, ...query } }, res);
  });
}

const env = { MUSE_API_KEY: KEY, MARKETING_CUSTOMER_DATABASE_API_KEY: "crm-internal-key-should-not-work-for-muse" };
const auth = { "x-muse-api-key": KEY };

test("auth is required, and the CRM's own key is rejected", async () => {
  const handler = createMuseHandler({ environment: env, supabase: fakeSupabase() });
  assert.equal((await call(handler, { resource: "stock" })).status, 401);
  assert.equal((await call(handler, { resource: "stock", headers: { "x-muse-api-key": "wrong" } })).status, 401);
  assert.equal((await call(handler, { resource: "stock", headers: { "x-muse-api-key": env.MARKETING_CUSTOMER_DATABASE_API_KEY } })).status, 401);
  assert.equal((await call(handler, { resource: "stock", headers: { authorization: `Bearer ${KEY}` } })).status, 200);
  assert.equal(museAuthorised({ headers: { "x-muse-api-key": "short" } }, { MUSE_API_KEY: "short" }), false, "short keys are refused");
  assert.equal(museAuthorised({ headers: {} }, {}), false, "no key configured means no access");
});

test("read-only: non-GET methods are refused and no write is ever issued", async () => {
  const supabase = fakeSupabase();
  const handler = createMuseHandler({ environment: env, supabase });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal((await call(handler, { method, resource: "campaigns", headers: auth })).status, 405);
  }
  for (const resource of ["overview", "stock", "conversations", "opportunities", "campaigns", "ask-me"]) {
    await call(handler, { resource, headers: auth });
  }
  assert.deepEqual(supabase.calls, []);
});

test("no customer PII is ever returned by any resource", async () => {
  const handler = createMuseHandler({ environment: env, supabase: fakeSupabase() });
  for (const resource of ["overview", "stock", "conversations", "opportunities", "campaigns", "ask-me", "capabilities"]) {
    const { status, body } = await call(handler, { resource, headers: auth });
    assert.ok(status === 200, `${resource} returned ${status}`);
    const text = JSON.stringify(body);
    for (const value of [PII.email, PII.phone, "07700", PII.postcode, "jane", "doe", "smith", "sw1a"]) {
      const lower = text.toLowerCase();
      const word = value.toLowerCase();
      // Whole-word match, so "doe" does not match "does".
      const leaked = lower.split(/[^a-z0-9@.+ ]+/).some((part) => (` ${part} `).includes(` ${word} `) || part.includes(word) && /[@\d]/.test(word));
      assert.ok(!leaked && !(word.includes(" ") && lower.includes(word)), `${resource} leaked ${value}`);
    }
    assert.ok(!/conversation_history|question_excerpt|internal_notes|first_name|"email"\s*:/.test(text), `${resource} leaked a sensitive field`);
  }
});

test("resources return useful aggregated data", async () => {
  const handler = createMuseHandler({ environment: env, supabase: fakeSupabase() });
  const stock = (await call(handler, { resource: "stock", headers: auth })).body.data;
  assert.equal(stock.vehicles.rent2buy[0].views_30d, 2);
  assert.equal(stock.vehicles.finance[0].title, "Ford Transit Custom");
  const conv = (await call(handler, { resource: "conversations", headers: auth })).body.data;
  assert.equal(conv.channels.facebook_marketplace.received, 1, "test events excluded");
  assert.equal(conv.ask_me_website.messages, 4);
  const camp = (await call(handler, { resource: "campaigns", headers: auth })).body.data;
  assert.equal(camp.campaigns[0].email_production_totals.sent, 88);
  const opp = (await call(handler, { resource: "opportunities", headers: auth })).body.data;
  assert.equal(opp.items[0].topic, "Finance applications with credit difficulties");
  assert.equal(opp.items[0].questions, 12);
  const other = opp.items.find((i) => i.product === "rent2buy");
  assert.equal(other.theme, "other");
  assert.equal(other.questions, 3, "customer-worded intents are merged into one Other bucket");
  assert.deepEqual(other.recommended_actions, [], "free-text actions are dropped");
  const askMe = (await call(handler, { resource: "ask-me", headers: auth })).body.data;
  assert.deepEqual(askMe.summary.knowledge_hub_search.no_result_themes.map((t) => t.theme).sort(), ["other", "upfront_costs"]);
  assert.equal(askMe.summary.knowledge_hub_search.top_no_result_queries, undefined);
  const overview = (await call(handler, { resource: "overview", headers: auth })).body.data;
  assert.equal(overview.sections.contacts.counts.active, 1, "contacts are counts only");
  assert.equal(overview.sections.contacts.contacts, undefined);
});

test("openapi is public; unknown resources 404", async () => {
  const handler = createMuseHandler({ environment: env, supabase: fakeSupabase() });
  const spec = await call(handler, { resource: "openapi" });
  assert.equal(spec.status, 200);
  assert.equal(spec.body.components.securitySchemes.museKey.name, "x-muse-api-key");
  for (const path of Object.keys(spec.body.paths)) assert.deepEqual(Object.keys(spec.body.paths[path]), ["get"]);
  assert.equal((await call(handler, { resource: "contacts", headers: auth })).status, 404);
});

test("scrubber and rate limiter", () => {
  const out = scrubForMuse({ email: PII.email, nested: [{ phone: PII.phone, note: `ring ${PII.phone}` }], title: "Van" });
  assert.equal(out.email, undefined);
  assert.equal(out.nested[0].phone, undefined);
  assert.ok(!containsPii(out));
  assert.ok(containsPii({ x: PII.email }));
  const id = `client-${Math.random()}`;
  const now = 1_700_000_000_000;
  for (let i = 0; i < 60; i++) assert.equal(rateLimited(id, now), false);
  assert.equal(rateLimited(id, now), true);
  assert.equal(rateLimited(id, now + 60_000), false);
});

test("theme titles come only from the fixed list", async () => {
  const { fixedTheme, FIXED_THEME_KEYS } = await import("../lib/museConnector.js");
  const { classifyLearningIntent } = await import("../lib/knowledgeLearningEngine.js");
  for (const product of ["finance", "rent2buy"]) {
    for (const key of FIXED_THEME_KEYS) assert.notEqual(fixedTheme(key, product).key, "other");
    // The fixed list matches the learning engine's own fixed titles.
    for (const q of ["deliver", "deposit", "how does it work", "credit score", "next step", "documents", "monthly", "vehicle"]) {
      const c = classifyLearningIntent(q, product);
      assert.equal(fixedTheme(c.key, product).title, c.title, q);
    }
    assert.equal(fixedTheme("jane_doe", product).key, "other");
  }
});

test("the Muse key is used by the Muse endpoint only", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (["node_modules", ".git", "tests", "docs", "dist"].includes(name)) continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(m?js|jsx)$/.test(name) && readFileSync(path, "utf8").includes("MUSE_API_KEY")) hits.push(path.split("\\").join("/"));
    }
  };
  walk(".");
  assert.deepEqual(hits.sort(), ["api/muse.js", "lib/museConnector.js"]);
});

test("website analytics keeps numbers and fixed step names only", async () => {
  const { pickWebsiteAnalytics } = await import("../lib/museConnector.js");
  const out = pickWebsiteAnalytics(
    { current: { startDate: "2026-11-17", endDate: "2026-11-23", summary: { "traffic.sessions_count": 120 } }, notes: ["x"] },
    { reaches: 10, starts: 5, completions: 2, failureReasons: { [`Invalid email ${PII.email}`]: 1 }, unresolvedFailures: [{ reason: PII.phone }],
      steps: [{ name: "About you", viewed: 4, blocked: 1, reachedPct: 0.8 }, { name: PII.name, viewed: 1 }], blockedDevices: { mobile: 1, [PII.email]: 1 } },
  );
  assert.equal(out.traffic_last_7_days.summary.sessions_count, 120);
  assert.deepEqual(out.finance_application_funnel_today.steps.map((s) => s.step), ["About you"]);
  assert.ok(!containsPii(out));
  assert.ok(!JSON.stringify(out).includes("Jane"));
});

test("privacy check ignores numbers but catches contact details in keys and values", () => {
  assert.equal(containsPii({ rate: 0.4444444444, count: 7700900123 }), false);
  assert.equal(containsPii({ note: "ring 07700 900123" }), true);
  assert.equal(containsPii({ [PII.email]: 1 }), true);
});
