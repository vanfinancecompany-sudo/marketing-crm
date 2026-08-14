import test from "node:test";
import assert from "node:assert/strict";
import {
  assistantTelemetryVisitorHash,
  buildAssistantMeasurementSummary,
  normaliseAssistantKnowledgeSources,
  normaliseAssistantTelemetryEvent,
  recordAssistantTelemetryEvents,
  telemetryFromAssistantResult,
} from "../lib/aiAssistantTelemetry.js";

test("assistant telemetry hashes a browser-session id without returning the raw value", () => {
  const environment = { AI_ASSISTANT_SESSION_SECRET: "measurement-test-secret-1234567890" };
  const first = assistantTelemetryVisitorHash("browser-session-123", environment);
  const second = assistantTelemetryVisitorHash("browser-session-123", environment);
  assert.equal(first, second);
  assert.ok(first);
  assert.notEqual(first, "browser-session-123");
});

test("knowledge-source telemetry keeps identifiers and scores but drops retrieved passage text", () => {
  const sources = normaliseAssistantKnowledgeSources([
    {
      source_id: "article-1",
      type: "article",
      title: "Van Finance Guide",
      heading: "Deposits",
      score: 0.87321,
      passage: "This full retrieved passage must not be copied into analytics.",
      secret_debug_field: "nope",
    },
  ]);
  assert.deepEqual(sources, [{
    source_id: "article-1",
    type: "article",
    title: "Van Finance Guide",
    heading: "Deposits",
    score: 0.873,
  }]);
  assert.equal("passage" in sources[0], false);
  assert.equal("secret_debug_field" in sources[0], false);
});

test("assistant-result telemetry carries retrieval decisions and knowledge sources", () => {
  const telemetry = telemetryFromAssistantResult({
    conversation_intent: "deposit_question",
    retrieval_required: true,
    retrieval_performed: true,
    retrieval_used: true,
    insufficient_knowledge: false,
    knowledge_sources_used: [{ source_id: "article-7", type: "article", title: "Deposit guide", score: 0.9 }],
  });
  assert.equal(telemetry.conversation_intent, "deposit_question");
  assert.equal(telemetry.retrieval_used, true);
  assert.equal(telemetry.knowledge_gap, false);
  assert.equal(telemetry.knowledge_sources[0].source_id, "article-7");
});

test("assistant-result telemetry falls back to source IDs when full source diagnostics are absent", () => {
  const telemetry = telemetryFromAssistantResult({
    retrieval_required: true,
    retrieval_performed: true,
    retrieval_used: true,
    knowledge_source_ids: ["fallback-article-1"],
  });
  assert.deepEqual(telemetry.knowledge_sources, [{
    source_id: "fallback-article-1",
    type: "unknown",
    title: null,
    heading: null,
    score: null,
  }]);
});

test("bulk assistant telemetry writes a completed turn in one insert", async () => {
  const calls = [];
  const supabase = {
    from(table) {
      assert.equal(table, "ai_assistant_events");
      return {
        insert(payload) {
          calls.push(payload);
          return {
            async select() {
              return { data: payload.map((_, index) => ({ id: `event-${index + 1}` })), error: null };
            },
          };
        },
      };
    },
  };
  const rows = await recordAssistantTelemetryEvents(supabase, [
    { event_type: "customer_message", customer_session_id: "session-1", message_number: 1 },
    { event_type: "assistant_response", customer_session_id: "session-1", message_number: 1, retrieval_used: true },
    { event_type: "cta_shown", customer_session_id: "session-1", message_number: 1, cta_label: "Apply" },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 3);
  assert.equal(rows.length, 3);
});

test("unsupported public-style event names are rejected before storage", () => {
  assert.throws(
    () => normaliseAssistantTelemetryEvent({ event_type: "raw_prompt_dump" }),
    /Unsupported assistant telemetry event/,
  );
});

test("measurement summary separates adoption, conversation depth, retrieval and search gaps", () => {
  const events = [
    { event_type: "launcher_impression", visitor_hash: "v1", page_type: "homepage" },
    { event_type: "launcher_impression", visitor_hash: "v2", page_type: "homepage" },
    { event_type: "launcher_open", visitor_hash: "v1", page_type: "homepage" },
    { event_type: "conversation_start", visitor_hash: "v1", customer_session_id: "s1", page_type: "homepage" },
    { event_type: "customer_message", customer_session_id: "s1", page_type: "homepage" },
    { event_type: "customer_message", customer_session_id: "s1", page_type: "homepage" },
    {
      event_type: "assistant_response",
      customer_session_id: "s1",
      page_type: "homepage",
      retrieval_used: true,
      knowledge_gap: false,
      knowledge_sources: [{ source_id: "article-1", type: "article", title: "Guide A" }],
    },
    {
      event_type: "assistant_response",
      customer_session_id: "s1",
      page_type: "homepage",
      retrieval_used: false,
      knowledge_gap: true,
      knowledge_sources: [],
    },
    { event_type: "cta_shown", customer_session_id: "s1" },
    { event_type: "cta_click", customer_session_id: "s1" },
  ];
  const searches = [
    { event_type: "search_submitted", query_text: "IVA finance", normalised_query: "iva finance", result_count: 0 },
    { event_type: "search_submitted", query_text: "IVA finance", normalised_query: "iva finance", result_count: 0 },
    { event_type: "search_submitted", query_text: "service history", normalised_query: "service history", result_count: 4 },
    { event_type: "result_selected", query_text: "service history", normalised_query: "service history", selected_article_id: "article-2" },
  ];

  const summary = buildAssistantMeasurementSummary(events, searches);
  assert.equal(summary.assistant.unique_exposed_visitors, 2);
  assert.equal(summary.assistant.unique_open_visitors, 1);
  assert.equal(summary.assistant.open_rate, 50);
  assert.equal(summary.assistant.conversations_with_2_plus_messages, 1);
  assert.equal(summary.knowledge.retrieval_rate, 50);
  assert.equal(summary.knowledge.knowledge_gap_rate, 50);
  assert.equal(summary.knowledge.top_sources[0].source_id, "article-1");
  assert.equal(summary.knowledge_hub_search.no_result_searches, 2);
  assert.deepEqual(summary.knowledge_hub_search.top_no_result_queries[0], { query: "IVA finance", count: 2 });
});
