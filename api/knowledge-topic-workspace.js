import { createClient } from "@supabase/supabase-js";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_TOPIC_STATUSES } from "../lib/knowledgeHub.js";
import { duplicateTopicRisk, findTopicDuplicateGroups, topicMatchesFilters } from "../lib/knowledgeTopicWorkspace.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  const bearer = clean(request.headers.authorization).replace(/^Bearer\s+/i, "");
  return Boolean(expected && [clean(request.headers[API_KEY_HEADER]), bearer].includes(expected));
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { throw new ApiError(400, "The request body is not valid JSON."); }
}

function supabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new ApiError(500, "Supabase is not configured.");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function data(result, fallback) {
  if (result.error) throw new ApiError(500, result.error.message || fallback);
  return result.data;
}

async function loadTopics(supabase) {
  return data(await supabase.from("knowledge_topics").select("*").order("updated_at", { ascending: false }), "Topics could not be loaded.") || [];
}

function cleanFilters(filters = {}) {
  return {
    search: clean(filters.search, 300),
    category: clean(filters.category, 80) || "all",
    status: clean(filters.status, 30) || "all",
    priority: clean(filters.priority, 10) || "all",
  };
}

async function resolveTopicIds(supabase, body) {
  const topics = await loadTopics(supabase);
  const requested = Array.isArray(body.topic_ids) ? body.topic_ids.map((id) => clean(id, 100)).filter(Boolean) : [];
  if (body.selection_mode === "filtered") {
    return topics.filter((topic) => topicMatchesFilters(topic, cleanFilters(body.filters))).map((topic) => topic.id);
  }
  const valid = new Set(topics.map((topic) => topic.id));
  return [...new Set(requested)].filter((id) => valid.has(id));
}

async function callFinderAi(input) {
  if (!process.env.OPENAI_API_KEY) throw new ApiError(500, "OPENAI_API_KEY is not configured.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${clean(process.env.OPENAI_API_KEY)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: clean(process.env.OPENAI_MODEL, 200) || "gpt-4.1-mini",
      input: [
        { role: "system", content: "You are a strict UK commercial-vehicle content planner. Follow category and subject boundaries exactly. Return fewer ideas rather than weak or adjacent ideas." },
        { role: "user", content: input },
      ],
      text: { format: { type: "json_schema", name: "strict_topic_review", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["ideas", "result_message"], properties: {
          result_message: { type: "string" },
          ideas: { type: "array", items: { type: "object", additionalProperties: false,
            required: ["title", "category", "intent", "primary_keyword", "rationale", "priority", "estimated_value", "difficulty", "target_persona", "seasonal", "opportunity_reason"],
            properties: {
              title: { type: "string" }, category: { type: "string", enum: KNOWLEDGE_CATEGORIES }, intent: { type: "string" }, primary_keyword: { type: "string" },
              rationale: { type: "string" }, priority: { type: "integer" }, estimated_value: { type: "integer" }, difficulty: { type: "integer" },
              target_persona: { type: "string" }, seasonal: { type: "boolean" }, opportunity_reason: { type: "string" }
            }
          }}
        }
      }}
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(502, payload.error?.message || "AI Topic Finder failed.");
  const output = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new ApiError(502, "AI Topic Finder returned no structured response.");
  return JSON.parse(output);
}

async function findTopics(supabase, body) {
  const categories = [...new Set((Array.isArray(body.categories) ? body.categories : []).map((item) => clean(item, 80)))].filter((item) => KNOWLEDGE_CATEGORIES.includes(item));
  if (!categories.length) throw new ApiError(400, "Select at least one category.");
  const quantity = Math.min(30, Math.max(1, Number(body.quantity) || 5));
  const brief = clean(body.brief, 4000);
  if (!brief) throw new ApiError(400, "Enter an Additional Brief so the subject boundary is clear.");
  const [topics, articles] = await Promise.all([
    loadTopics(supabase),
    data(await supabase.from("knowledge_articles").select("id,title,category,canonical_intent,status").neq("status", "archived"), "Approved article coverage could not be loaded.") || [],
  ]);
  const prompt = `STRICT SUBJECT BOUNDARY\nThe Additional Brief defines the strict subject boundary. Do not broaden beyond it. Every returned topic must directly answer the stated customer question. Reject loosely related ideas rather than filling the requested topic count.\n\nAdditional Brief:\n${brief}\n\nSelected categories (use only these): ${categories.join(", ")}\nCategory intersection rule: when more than one category is selected, every idea must genuinely relate to every selected category. Keep Van Finance and Rent2Buy separate unless both were explicitly selected. Do not infer extra categories.\n\nRequested maximum: ${quantity}. It is acceptable and preferred to return fewer ideas when additional suggestions would overlap or fall outside the brief. Explain this in result_message.\n\nExisting Topic Planner records to avoid:\n${topics.map((topic) => `- ${topic.title} | intent: ${topic.canonical_intent || topic.intent || ""} | ${topic.category}`).join("\n") || "- None"}\n\nExisting non-archived articles to avoid:\n${articles.map((article) => `- ${article.title} | intent: ${article.canonical_intent || ""} | ${article.category}`).join("\n") || "- None"}\n\nRules:\n- Directly answer a clear informational customer search intent.\n- Follow exclusions in the Additional Brief literally, including phrases such as do not suggest.\n- Avoid broad adjacent subjects, variants of existing coverage and multiple ideas with substantially the same intent.\n- rationale must briefly explain why the idea is inside the brief.\n- Return no more than ${quantity} strong distinct ideas.`;
  const generated = await callFinderAi(prompt);
  const accepted = [];
  for (const idea of generated.ideas || []) {
    if (!categories.includes(idea.category)) continue;
    const comparisons = [...topics, ...articles, ...accepted];
    const closest = comparisons.map((entry) => ({ entry, ...duplicateTopicRisk(idea, entry) })).sort((a, b) => (b.score || (b.risk === "duplicate" ? 1 : 0)) - (a.score || (a.risk === "duplicate" ? 1 : 0)))[0];
    accepted.push({
      ...idea,
      secondary_keywords: [],
      overlap_warning: closest && closest.risk !== "clear" ? `Possible overlap with “${closest.entry.title}” (${closest.reason.replaceAll("_", " ")}).` : "",
    });
    if (accepted.length >= quantity) break;
  }
  return { ideas: accepted, result_message: clean(generated.result_message, 1000) || `${accepted.length} strong distinct topic(s) found.` };
}

async function saveSelected(supabase, body) {
  const ideas = Array.isArray(body.ideas) ? body.ideas.slice(0, 30) : [];
  if (!ideas.length) throw new ApiError(400, "Select at least one suggestion.");
  const existing = await loadTopics(supabase);
  const rows = [];
  const skipped = [];
  for (const idea of ideas) {
    const category = clean(idea.category, 80);
    if (!KNOWLEDGE_CATEGORIES.includes(category)) { skipped.push({ title: clean(idea.title), reason: "unsupported_category" }); continue; }
    const duplicate = existing.concat(rows).map((topic) => ({ topic, ...duplicateTopicRisk(idea, topic) })).find((item) => item.risk === "duplicate");
    if (duplicate) { skipped.push({ title: clean(idea.title), reason: `duplicate_of:${duplicate.topic.title}` }); continue; }
    rows.push({
      title: clean(idea.title, 240), category, primary_keyword: clean(idea.primary_keyword, 200) || null, secondary_keywords: [],
      intent: clean(idea.intent, 1000) || null, canonical_intent: clean(idea.intent, 1000) || clean(idea.title, 240), notes: null, status: "idea",
      priority: Math.min(5, Math.max(1, Number(idea.priority) || 3)), estimated_value: Math.min(5, Math.max(1, Number(idea.estimated_value) || 3)),
      difficulty: Math.min(5, Math.max(1, Number(idea.difficulty) || 3)), target_persona: clean(idea.target_persona, 500), seasonal: Boolean(idea.seasonal),
      opportunity_reason: clean(idea.opportunity_reason || idea.rationale, 3000), source: "ai_topic_finder",
      finder_metadata: { rationale: clean(idea.rationale, 2000), reviewed_before_save: true, accepted_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
  }
  if (!rows.length) return { topics: [], skipped };
  const saved = data(await supabase.from("knowledge_topics").insert(rows).select(), "Selected topics could not be saved.") || [];
  return { topics: saved, skipped };
}

async function bulkAction(supabase, body) {
  const ids = await resolveTopicIds(supabase, body);
  if (!ids.length) throw new ApiError(400, "No valid topics are selected.");
  const linked = data(await supabase.from("knowledge_articles").select("topic_id").in("topic_id", ids), "Linked articles could not be checked.") || [];
  const protectedIds = new Set(linked.map((item) => item.topic_id));
  if (body.operation === "delete") {
    const deletable = ids.filter((id) => !protectedIds.has(id));
    if (!deletable.length) throw new ApiError(409, "Every selected topic has article history and was left untouched.");
    data(await supabase.from("knowledge_topics").delete().in("id", deletable), "Selected topics could not be deleted.");
    return { operation: "delete", affected_ids: deletable, protected_count: ids.length - deletable.length };
  }
  if (body.operation === "status") {
    const status = clean(body.value, 30);
    if (!KNOWLEDGE_TOPIC_STATUSES.includes(status)) throw new ApiError(400, "Unsupported topic status.");
    data(await supabase.from("knowledge_topics").update({ status, updated_at: new Date().toISOString() }).in("id", ids), "Topic statuses could not be updated.");
    return { operation: "status", affected_ids: ids, value: status };
  }
  if (body.operation === "category") {
    const category = clean(body.value, 80);
    if (!KNOWLEDGE_CATEGORIES.includes(category)) throw new ApiError(400, "Unsupported topic category.");
    data(await supabase.from("knowledge_topics").update({ category, updated_at: new Date().toISOString() }).in("id", ids), "Topic categories could not be updated.");
    return { operation: "category", affected_ids: ids, value: category };
  }
  throw new ApiError(400, "Unsupported bulk topic action.");
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  try {
    const body = parseBody(request);
    const supabase = supabaseClient();
    let result;
    if (body.action === "load") {
      const topics = await loadTopics(supabase);
      result = { topics, duplicate_groups: findTopicDuplicateGroups(topics) };
    } else if (body.action === "find") result = { finder: await findTopics(supabase, body) };
    else if (body.action === "saveSelected") result = { finder: await saveSelected(supabase, body) };
    else if (body.action === "bulk") result = { bulk: await bulkAction(supabase, body) };
    else throw new ApiError(400, "Unsupported topic workspace action.");
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("KNOWLEDGE TOPIC WORKSPACE ERROR", { message: error.message });
    return response.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "Topic workspace request failed." });
  }
}
