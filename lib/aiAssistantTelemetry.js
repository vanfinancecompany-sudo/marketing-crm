import { secureHash } from "./publicAssistantFoundation.js";

export const ASSISTANT_EVENT_TYPES = Object.freeze([
  "launcher_impression",
  "launcher_open",
  "launcher_close",
  "conversation_start",
  "customer_message",
  "assistant_response",
  "cta_shown",
  "cta_click",
]);

export const PUBLIC_ASSISTANT_EVENT_TYPES = Object.freeze([
  "launcher_impression",
  "launcher_open",
  "launcher_close",
  "cta_click",
]);

const EVENT_TYPES = new Set(ASSISTANT_EVENT_TYPES);
const PAGE_TYPES = new Set(["finance_vehicle", "finance_general", "rent2buy_general", "homepage"]);
const PRODUCT_CONTEXTS = new Set(["finance", "rent2buy"]);

function clean(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function nullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentage(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size;
}

export function assistantTelemetryVisitorHash(visitorId, environment = process.env) {
  const value = clean(visitorId, 160);
  const secret = clean(environment?.AI_ASSISTANT_SESSION_SECRET, 1000);
  if (!value || !secret) return null;
  return secureHash(`analytics:${value}`, secret);
}

export function normaliseAssistantKnowledgeSources(sources = []) {
  if (!Array.isArray(sources)) return [];
  return sources.map((source) => {
    const sourceId = clean(source?.source_id || source?.id, 160);
    if (!sourceId) return null;
    const score = nullableNumber(source?.score);
    return {
      source_id: sourceId,
      type: clean(source?.type, 60) || null,
      title: clean(source?.title, 240) || null,
      heading: clean(source?.heading, 240) || null,
      score: score == null ? null : Math.round(score * 1000) / 1000,
    };
  }).filter(Boolean).slice(0, 12);
}

export function telemetryFromAssistantResult(result = {}) {
  return {
    conversation_intent: clean(result?.conversation_intent, 160) || null,
    retrieval_required: nullableBoolean(result?.retrieval_required),
    retrieval_performed: nullableBoolean(result?.retrieval_performed),
    retrieval_used: nullableBoolean(result?.retrieval_used),
    knowledge_gap: Boolean(result?.insufficient_knowledge || result?.knowledge_gap),
    knowledge_sources: normaliseAssistantKnowledgeSources(
      Array.isArray(result?.knowledge_sources_used) && result.knowledge_sources_used.length
        ? result.knowledge_sources_used
        : (result?.knowledge_source_ids || []).map((source_id) => ({ source_id, type: "unknown" })),
    ),
  };
}

export function normaliseAssistantTelemetryEvent(input = {}) {
  const eventType = clean(input.event_type, 60);
  if (!EVENT_TYPES.has(eventType)) throw new Error("Unsupported assistant telemetry event.");

  const pageType = clean(input.page_type, 60).toLowerCase();
  const productContext = clean(input.product_context, 40).toLowerCase();
  const messageNumber = Number.parseInt(input.message_number, 10);

  return {
    event_type: eventType,
    visitor_hash: clean(input.visitor_hash, 160) || null,
    customer_session_id: clean(input.customer_session_id, 80) || null,
    page_type: PAGE_TYPES.has(pageType) ? pageType : null,
    product_context: PRODUCT_CONTEXTS.has(productContext) ? productContext : null,
    conversation_intent: clean(input.conversation_intent, 160) || null,
    retrieval_required: nullableBoolean(input.retrieval_required),
    retrieval_performed: nullableBoolean(input.retrieval_performed),
    retrieval_used: nullableBoolean(input.retrieval_used),
    knowledge_gap: nullableBoolean(input.knowledge_gap),
    knowledge_sources: normaliseAssistantKnowledgeSources(input.knowledge_sources),
    cta_action_key: clean(input.cta_action_key, 160) || null,
    cta_label: clean(input.cta_label, 200) || null,
    message_number: Number.isInteger(messageNumber) && messageNumber > 0 && messageNumber <= 100 ? messageNumber : null,
    response_mode: clean(input.response_mode, 80) || null,
  };
}

export async function resolveAssistantCustomerSessionId(supabase, conversationId, environment = process.env) {
  const token = clean(conversationId, 160);
  const secret = clean(environment?.AI_ASSISTANT_SESSION_SECRET, 1000);
  if (!token || !secret || !supabase?.from) return null;
  const tokenHash = secureHash(token, secret);
  const result = await supabase
    .from("ai_customer_sessions")
    .select("id")
    .eq("public_token_hash", tokenHash)
    .maybeSingle();
  if (result?.error) throw result.error;
  return result?.data?.id || null;
}

export async function recordAssistantTelemetryEvents(supabase, inputs = []) {
  if (!supabase?.from) throw new Error("Assistant telemetry storage is unavailable.");
  const payloads = (Array.isArray(inputs) ? inputs : [inputs]).map((input) => normaliseAssistantTelemetryEvent(input));
  if (!payloads.length) return [];
  const result = await supabase.from("ai_assistant_events").insert(payloads).select("id");
  if (result?.error) throw result.error;
  return Array.isArray(result?.data) ? result.data : [];
}

export async function recordAssistantTelemetryEvent(supabase, input = {}) {
  const rows = await recordAssistantTelemetryEvents(supabase, [input]);
  return rows[0] || null;
}

export function isMissingAssistantTelemetryTableError(error) {
  const code = clean(error?.code, 40);
  const message = clean(error?.message, 1000).toLowerCase();
  return code === "42P01" || message.includes("ai_assistant_events") && message.includes("does not exist");
}

function topKnowledgeSources(events) {
  const counts = new Map();
  events.forEach((event) => {
    if (event?.event_type !== "assistant_response" || !Array.isArray(event?.knowledge_sources)) return;
    const seen = new Set();
    event.knowledge_sources.forEach((source) => {
      const id = clean(source?.source_id, 160);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const current = counts.get(id) || {
        source_id: id,
        type: clean(source?.type, 60) || null,
        title: clean(source?.title, 240) || null,
        retrieval_count: 0,
      };
      current.retrieval_count += 1;
      if (!current.title && source?.title) current.title = clean(source.title, 240);
      counts.set(id, current);
    });
  });
  return [...counts.values()].sort((a, b) => b.retrieval_count - a.retrieval_count || String(a.title || a.source_id).localeCompare(String(b.title || b.source_id))).slice(0, 25);
}

function summarisePageTypes(events) {
  const grouped = new Map();
  events.forEach((event) => {
    const key = clean(event?.page_type, 60) || "unknown";
    const current = grouped.get(key) || { page_type: key, impressions: 0, opens: 0, conversations: 0, messages: 0 };
    if (event?.event_type === "launcher_impression") current.impressions += 1;
    if (event?.event_type === "launcher_open") current.opens += 1;
    if (event?.event_type === "conversation_start") current.conversations += 1;
    if (event?.event_type === "customer_message") current.messages += 1;
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((a, b) => b.impressions - a.impressions || a.page_type.localeCompare(b.page_type));
}

function normaliseSearchQuery(value) {
  return clean(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function buildAssistantMeasurementSummary(events = [], searchEvents = []) {
  const assistantEvents = Array.isArray(events) ? events : [];
  const searches = Array.isArray(searchEvents) ? searchEvents : [];
  const impressions = assistantEvents.filter((event) => event?.event_type === "launcher_impression");
  const opens = assistantEvents.filter((event) => event?.event_type === "launcher_open");
  const starts = assistantEvents.filter((event) => event?.event_type === "conversation_start");
  const messages = assistantEvents.filter((event) => event?.event_type === "customer_message");
  const responses = assistantEvents.filter((event) => event?.event_type === "assistant_response");
  const ctaShown = assistantEvents.filter((event) => event?.event_type === "cta_shown");
  const ctaClicks = assistantEvents.filter((event) => event?.event_type === "cta_click");
  const exposedVisitors = uniqueCount(impressions.map((event) => event?.visitor_hash));
  const openedVisitors = uniqueCount(opens.map((event) => event?.visitor_hash));
  const conversationIds = new Set(starts.map((event) => event?.customer_session_id).filter(Boolean));
  const messageCounts = new Map();
  messages.forEach((event) => {
    if (!event?.customer_session_id) return;
    messageCounts.set(event.customer_session_id, (messageCounts.get(event.customer_session_id) || 0) + 1);
  });
  const twoPlusConversations = [...messageCounts.values()].filter((count) => count >= 2).length;
  const retrievalResponses = responses.filter((event) => event?.retrieval_used === true);
  const knowledgeGaps = responses.filter((event) => event?.knowledge_gap === true);

  const submittedSearches = searches.filter((event) => event?.event_type === "search_submitted");
  const selectedSearches = searches.filter((event) => event?.event_type === "result_selected");
  const noResultSearches = submittedSearches.filter((event) => Number(event?.result_count || 0) === 0);
  const noResultCounts = new Map();
  noResultSearches.forEach((event) => {
    const key = normaliseSearchQuery(event?.normalised_query || event?.query_text);
    if (!key) return;
    const current = noResultCounts.get(key) || { query: clean(event?.query_text, 500) || key, count: 0 };
    current.count += 1;
    noResultCounts.set(key, current);
  });

  return {
    assistant: {
      launcher_impressions: impressions.length,
      unique_exposed_visitors: exposedVisitors,
      launcher_opens: opens.length,
      unique_open_visitors: openedVisitors,
      open_rate: percentage(openedVisitors, exposedVisitors),
      conversations_started: conversationIds.size || starts.length,
      conversation_start_rate: percentage(conversationIds.size || starts.length, openedVisitors),
      customer_messages: messages.length,
      conversations_with_2_plus_messages: twoPlusConversations,
      assistant_responses: responses.length,
      cta_shown: ctaShown.length,
      cta_clicks: ctaClicks.length,
      cta_click_rate: percentage(ctaClicks.length, ctaShown.length),
    },
    knowledge: {
      responses_with_retrieval: retrievalResponses.length,
      retrieval_rate: percentage(retrievalResponses.length, responses.length),
      knowledge_gaps: knowledgeGaps.length,
      knowledge_gap_rate: percentage(knowledgeGaps.length, responses.length),
      top_sources: topKnowledgeSources(assistantEvents),
    },
    knowledge_hub_search: {
      searches: submittedSearches.length,
      no_result_searches: noResultSearches.length,
      result_selections: selectedSearches.length,
      selection_rate: percentage(selectedSearches.length, submittedSearches.length),
      top_no_result_queries: [...noResultCounts.values()].sort((a, b) => b.count - a.count || a.query.localeCompare(b.query)).slice(0, 25),
    },
    by_page_type: summarisePageTypes(assistantEvents),
  };
}
