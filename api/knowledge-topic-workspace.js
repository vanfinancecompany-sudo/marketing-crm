import { createClient } from "@supabase/supabase-js";
import marketingKnowledgeHubHandler from "./marketing-knowledge-hub.js";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_TOPIC_STATUSES } from "../lib/knowledgeHub.js";
import { findTopicDuplicateGroups, topicMatchesFilters } from "../lib/knowledgeTopicWorkspace.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message, code = "TOPIC_WORKSPACE_FAILED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `topic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  const bearer = clean(request.headers.authorization).replace(/^Bearer\s+/i, "");
  return Boolean(expected && [clean(request.headers[API_KEY_HEADER]), bearer].includes(expected));
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    throw new ApiError(400, "The request body is not valid JSON.", "INVALID_JSON");
  }
}

function supabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ApiError(500, "Topic workspace database access is not configured.", "TOPIC_DATABASE_NOT_CONFIGURED");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function data(result, fallback, code = "TOPIC_DATABASE_FAILED") {
  if (result.error) {
    console.error("KNOWLEDGE TOPIC WORKSPACE DATABASE ERROR", {
      code: result.error.code,
      message: result.error.message,
      details: result.error.details,
    });
    throw new ApiError(500, fallback, code);
  }
  return result.data;
}

function cleanFilters(filters = {}) {
  return {
    search: clean(filters.search, 300),
    category: clean(filters.category, 80) || "all",
    status: clean(filters.status, 30) || "all",
    priority: clean(filters.priority, 10) || "all",
  };
}

async function loadTopics(supabase) {
  return (
    data(
      await supabase.from("knowledge_topics").select("*").order("updated_at", { ascending: false }),
      "Unable to load Topic Planner records.",
      "TOPIC_LOAD_FAILED"
    ) || []
  );
}

async function resolveTopicIds(supabase, body) {
  const topics = await loadTopics(supabase);
  const requested = Array.isArray(body.topic_ids)
    ? body.topic_ids.map((id) => clean(id, 100)).filter(Boolean)
    : [];
  if (body.selection_mode === "filtered") {
    return topics
      .filter((topic) => topicMatchesFilters(topic, cleanFilters(body.filters)))
      .map((topic) => topic.id);
  }
  const valid = new Set(topics.map((topic) => topic.id));
  return [...new Set(requested)].filter((id) => valid.has(id));
}

function createInternalResponse() {
  let statusCode = 200;
  let body = null;
  const headers = new Map();
  const response = {
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
      return response;
    },
    status(code) {
      statusCode = Number(code) || 500;
      return response;
    },
    json(value) {
      body = value;
      return response;
    },
    end() {
      return response;
    },
  };
  return {
    response,
    result: () => ({ statusCode, body, headers }),
  };
}

async function requestEstablishedKnowledgeHub(request, action, payload = {}) {
  // Call the established handler in-process. A server-to-server fetch to a protected
  // Vercel preview can receive Vercel's own 401 before the app route runs, which must
  // never be interpreted as an expired Marketing access key.
  const internal = createInternalResponse();
  await marketingKnowledgeHubHandler(
    {
      ...request,
      method: "POST",
      headers: request.headers,
      body: { action, ...payload },
    },
    internal.response
  );

  const { statusCode, body: result } = internal.result();
  if (statusCode < 200 || statusCode >= 300 || result?.ok === false) {
    const safeMessage = clean(result?.message, 1000) || "The established Knowledge Hub API request failed.";
    throw new ApiError(
      statusCode || 500,
      safeMessage,
      action === "load"
        ? "TOPIC_LOAD_FAILED"
        : action === "findTopics"
          ? "TOPIC_FIND_FAILED"
          : "TOPIC_SAVE_FAILED"
    );
  }
  return result || {};
}

function strictFinderBrief(brief, categories, quantity) {
  return [
    "STRICT TOPIC BOUNDARY:",
    "The Additional Brief below is a strict instruction, not loose inspiration.",
    "Every suggestion must directly answer the stated customer question or search intent.",
    "Do not broaden into adjacent subjects. Follow all exclusions literally.",
    `Use only these selected categories: ${categories.join(", ")}.`,
    categories.length > 1
      ? "Every suggestion must genuinely relate to every selected category."
      : "Do not infer or add another category.",
    `Return no more than ${quantity} strong distinct suggestions. Return fewer rather than weak, repetitive or off-brief ideas.`,
    "Never use title-only similarity; avoid duplicate customer/search intent as well as duplicate titles.",
    "",
    "USER ADDITIONAL BRIEF:",
    brief,
  ].join("\n");
}

async function loadWorkspace(request) {
  const established = await requestEstablishedKnowledgeHub(request, "load");
  const topics = Array.isArray(established.topics) ? established.topics : [];
  let duplicateGroups = [];
  try {
    duplicateGroups = findTopicDuplicateGroups(topics);
  } catch (error) {
    console.error("KNOWLEDGE TOPIC DUPLICATE ANALYSIS ERROR", { message: error.message });
  }
  return { topics, duplicate_groups: duplicateGroups };
}

async function findTopics(request, body) {
  const categories = [
    ...new Set(
      (Array.isArray(body.categories) ? body.categories : [])
        .map((item) => clean(item, 80))
        .filter((item) => KNOWLEDGE_CATEGORIES.includes(item))
    ),
  ];
  if (!categories.length) throw new ApiError(400, "Select at least one category.", "TOPIC_CATEGORY_REQUIRED");
  const quantity = Math.min(30, Math.max(1, Number(body.quantity) || 5));
  const brief = clean(body.brief, 4000);
  if (!brief) {
    throw new ApiError(400, "Enter an Additional Brief so the subject boundary is clear.", "TOPIC_BRIEF_REQUIRED");
  }
  const established = await requestEstablishedKnowledgeHub(request, "findTopics", {
    categories,
    quantity,
    brief: strictFinderBrief(brief, categories, quantity),
  });
  return established.finder || { ideas: [], duplicate_count: 0 };
}

async function saveSelected(request, body) {
  const ideas = Array.isArray(body.ideas) ? body.ideas.slice(0, 30) : [];
  if (!ideas.length) {
    throw new ApiError(400, "Select at least one suggestion.", "TOPIC_SELECTION_REQUIRED");
  }
  const established = await requestEstablishedKnowledgeHub(request, "saveTopicIdeas", { ideas });
  return established.finder || { topics: [], skipped: [] };
}

async function bulkAction(supabase, body) {
  const ids = await resolveTopicIds(supabase, body);
  if (!ids.length) throw new ApiError(400, "No valid topics are selected.", "TOPIC_SELECTION_REQUIRED");

  const linked =
    data(
      await supabase.from("knowledge_articles").select("topic_id").in("topic_id", ids),
      "Linked article history could not be checked.",
      "TOPIC_ARTICLE_HISTORY_CHECK_FAILED"
    ) || [];
  const protectedIds = new Set(linked.map((item) => item.topic_id));

  if (body.operation === "delete") {
    const deletable = ids.filter((id) => !protectedIds.has(id));
    if (!deletable.length) {
      throw new ApiError(
        409,
        "Every selected topic has article history and was left untouched.",
        "TOPIC_DELETE_PROTECTED"
      );
    }
    data(
      await supabase.from("knowledge_topics").delete().in("id", deletable),
      "Selected Topic Planner suggestions could not be deleted.",
      "TOPIC_DELETE_FAILED"
    );
    return {
      operation: "delete",
      affected_ids: deletable,
      protected_count: ids.length - deletable.length,
    };
  }

  if (body.operation === "status") {
    const status = clean(body.value, 30);
    if (!KNOWLEDGE_TOPIC_STATUSES.includes(status)) {
      throw new ApiError(400, "Unsupported topic status.", "TOPIC_STATUS_INVALID");
    }
    data(
      await supabase
        .from("knowledge_topics")
        .update({ status, updated_at: new Date().toISOString() })
        .in("id", ids),
      "Topic statuses could not be updated.",
      "TOPIC_STATUS_UPDATE_FAILED"
    );
    return { operation: "status", affected_ids: ids, value: status };
  }

  if (body.operation === "category") {
    const category = clean(body.value, 80);
    if (!KNOWLEDGE_CATEGORIES.includes(category)) {
      throw new ApiError(400, "Unsupported topic category.", "TOPIC_CATEGORY_INVALID");
    }
    data(
      await supabase
        .from("knowledge_topics")
        .update({ category, updated_at: new Date().toISOString() })
        .in("id", ids),
      "Topic categories could not be updated.",
      "TOPIC_CATEGORY_UPDATE_FAILED"
    );
    return { operation: "category", affected_ids: ids, value: category };
  }

  throw new ApiError(400, "Unsupported bulk topic action.", "TOPIC_BULK_ACTION_INVALID");
}

export default async function handler(request, response) {
  const id = requestId();
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Topic-Workspace-Request-Id", id);

  if (request.method === "OPTIONS") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(204).end();
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({
      ok: false,
      error: "Topic workspace only accepts POST requests.",
      message: "Topic workspace only accepts POST requests.",
      code: "METHOD_NOT_ALLOWED",
      request_id: id,
    });
  }
  if (!authorize(request)) {
    return response.status(401).json({
      ok: false,
      error: "Access key not recognised.",
      message: "Access key not recognised.",
      code: "ACCESS_DENIED",
      request_id: id,
    });
  }

  let action = "unknown";
  try {
    const body = parseBody(request);
    action = clean(body.action, 50) || "unknown";
    let result;

    if (action === "load") result = await loadWorkspace(request);
    else if (action === "find") result = { finder: await findTopics(request, body) };
    else if (action === "saveSelected") result = { finder: await saveSelected(request, body) };
    else if (action === "bulk") result = { bulk: await bulkAction(supabaseClient(), body) };
    else throw new ApiError(400, "Unsupported topic workspace action.", "TOPIC_ACTION_INVALID");

    return response.status(200).json({ ok: true, action, request_id: id, ...result });
  } catch (error) {
    const status = Number(error.status) || 500;
    const code = clean(error.code, 100) || "TOPIC_WORKSPACE_FAILED";
    const safeMessage =
      status >= 500 && code === "TOPIC_WORKSPACE_FAILED"
        ? "Topic workspace request failed."
        : clean(error.message, 1000) || "Topic workspace request failed.";

    console.error("KNOWLEDGE TOPIC WORKSPACE ERROR", {
      request_id: id,
      action,
      status,
      code,
      message: error.message,
    });

    return response.status(status).json({
      ok: false,
      error: safeMessage,
      message: safeMessage,
      code,
      action,
      request_id: id,
    });
  }
}
