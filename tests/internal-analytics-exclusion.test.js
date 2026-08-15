import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUSTOMER_ANALYTICS_TRUSTED_SINCE,
  assistantTelemetryVisitorHash,
  buildAssistantMeasurementSummary,
  filterTrustedCustomerAnalyticsEvents,
} from "../lib/aiAssistantTelemetry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = { AI_ASSISTANT_SESSION_SECRET: "internal-analytics-test-secret-123456789" };

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("internal visitor marker preserves anonymous hashing without storing identity", () => {
  const customerHash = assistantTelemetryVisitorHash("browser-visitor-1", environment);
  const internalHash = assistantTelemetryVisitorHash("internal:browser-visitor-1", environment);
  assert.ok(customerHash);
  assert.equal(internalHash, `internal:${customerHash}`);
  assert.equal(internalHash.includes("browser-visitor-1"), false);
});

test("an internal conversation also excludes matching unprefixed launcher telemetry", () => {
  const customerHash = assistantTelemetryVisitorHash("browser-visitor-2", environment);
  const internalHash = assistantTelemetryVisitorHash("internal:browser-visitor-2", environment);
  const events = [
    { event_type: "launcher_impression", visitor_hash: customerHash },
    { event_type: "launcher_open", visitor_hash: customerHash },
    { event_type: "conversation_start", visitor_hash: internalHash, customer_session_id: "internal-session" },
    { event_type: "launcher_impression", visitor_hash: "real-customer" },
  ];
  const trusted = filterTrustedCustomerAnalyticsEvents(events);
  assert.deepEqual(trusted, [{ event_type: "launcher_impression", visitor_hash: "real-customer" }]);
});

test("customer measurement excludes internal assistant and Knowledge Hub activity", () => {
  const customerHash = assistantTelemetryVisitorHash("browser-visitor-3", environment);
  const internalHash = assistantTelemetryVisitorHash("internal:browser-visitor-3", environment);
  const events = [
    { event_type: "launcher_impression", visitor_hash: customerHash, page_type: "homepage" },
    { event_type: "launcher_open", visitor_hash: customerHash, page_type: "homepage" },
    { event_type: "conversation_start", visitor_hash: internalHash, customer_session_id: "test-session", page_type: "homepage" },
    { event_type: "customer_message", visitor_hash: internalHash, customer_session_id: "test-session", page_type: "homepage" },
    { event_type: "launcher_impression", visitor_hash: "customer-a", page_type: "homepage" },
    { event_type: "launcher_open", visitor_hash: "customer-a", page_type: "homepage" },
    { event_type: "conversation_start", visitor_hash: "customer-a", customer_session_id: "customer-session", page_type: "homepage" },
    { event_type: "customer_message", visitor_hash: "customer-a", customer_session_id: "customer-session", page_type: "homepage" },
  ];
  const searches = [
    { event_type: "search_submitted", visitor_hash: internalHash, query_text: "vat", normalised_query: "vat", result_count: 0 },
    { event_type: "search_submitted", visitor_hash: "customer-b", query_text: "service history", normalised_query: "service history", result_count: 3 },
  ];
  const summary = buildAssistantMeasurementSummary(events, searches);
  assert.equal(summary.assistant.launcher_impressions, 1);
  assert.equal(summary.assistant.launcher_opens, 1);
  assert.equal(summary.assistant.conversations_started, 1);
  assert.equal(summary.assistant.customer_messages, 1);
  assert.equal(summary.knowledge_hub_search.searches, 1);
  assert.equal(summary.knowledge_hub_search.no_result_searches, 0);
  assert.equal(summary.measurement.customer_only, true);
  assert.equal(summary.measurement.trusted_since, CUSTOMER_ANALYTICS_TRUSTED_SINCE);
});

test("public test marker is explicit, anonymous and persistent for Knowledge Hub search", () => {
  const sitewide = source("api/ai-assistant-sitewide.js");
  const searchEmbed = source("public/knowledge-hub-search/embed.html");
  assert.match(sitewide, /vfc_internal_test/);
  assert.match(sitewide, /INTERNAL_ANALYTICS_PREFIX/);
  assert.match(sitewide, /analytics_visitor_id:\s*analyticsVisitorId/);
  assert.match(searchEmbed, /vfc_internal_analytics_v1/);
  assert.match(searchEmbed, /document\.referrer/);
  assert.match(searchEmbed, /localStorage\.setItem\(INTERNAL_TEST_STORAGE_KEY, "1"\)/);
  assert.match(searchEmbed, /visitor_id:\s*analyticsVisitor/);
  assert.match(searchEmbed, /internal:/);
});

test("customer reset applies only to browser evidence while GSC keeps the requested window", () => {
  const evidenceRefresh = source("api/_knowledgeOpportunityEvidenceRefresh.js");
  const controlCentre = source("api/marketing-ai-control-centre.js");
  const analyticsApi = source("api/marketing-ai-assistant-analytics.js");
  assert.match(evidenceRefresh, /CUSTOMER_ANALYTICS_TRUSTED_SINCE/);
  assert.match(evidenceRefresh, /loadEvidenceInputs\(supabase, customerSince, since\)/);
  assert.match(evidenceRefresh, /\.gte\("checked_at", gscSince\)/);
  assert.match(evidenceRefresh, /filterTrustedCustomerAnalyticsEvents\(inputs\.assistantEvents\)/);
  assert.match(evidenceRefresh, /filterTrustedCustomerAnalyticsEvents\(inputs\.searchEvents\)/);
  assert.match(controlCentre, /customer_measurement_reset_at/);
  assert.match(controlCentre, /visitor_hash,query_text/);
  assert.match(analyticsApi, /customer_measurement_reset_at/);
  assert.match(analyticsApi, /visitor_hash,query_text/);
});
