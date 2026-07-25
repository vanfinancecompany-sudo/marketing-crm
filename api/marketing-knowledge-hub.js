import { createClient } from "@supabase/supabase-js";
import {
  KNOWLEDGE_ARTICLE_STATUSES,
  KNOWLEDGE_ARTICLE_TYPES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_TOPIC_STATUSES,
  calculateKnowledgeQualityChecks,
  findKnowledgeTopicDuplicates,
  markdownToKnowledgeHtml,
  parseKnowledgeArticleResponse,
  parseKnowledgeTopicIdeasResponse,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "slug",
    "seo_title",
    "meta_description",
    "excerpt",
    "content_markdown",
    "content_html",
    "faq_json",
    "cta",
    "internal_link_suggestions",
    "generation_metadata",
  ],
  properties: {
    title: { type: "string" },
    slug: { type: "string" },
    seo_title: { type: "string" },
    meta_description: { type: "string" },
    excerpt: { type: "string" },
    content_markdown: { type: "string" },
    content_html: { type: "string" },
    faq_json: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
      },
    },
    cta: { type: "string" },
    internal_link_suggestions: { type: "array", items: { type: "string" } },
    generation_metadata: {
      type: "object",
      additionalProperties: false,
      required: ["fact_review_items"],
      properties: {
        fact_review_items: { type: "array", items: { type: "string" } },
      },
    },
  },
};
const TOPIC_IDEAS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ideas"],
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "category",
          "primary_keyword",
          "secondary_keywords",
          "intent",
          "rationale",
          "priority",
        ],
        properties: {
          title: { type: "string" },
          category: { type: "string", enum: KNOWLEDGE_CATEGORIES },
          primary_keyword: { type: "string" },
          secondary_keywords: { type: "array", items: { type: "string" } },
          intent: { type: "string" },
          rationale: { type: "string" },
          priority: { type: "integer" },
        },
      },
    },
  },
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers[API_KEY_HEADER] || "";
  const authorization = request.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body;
}

function assertResult(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result;
}

function cleanText(value, max = 20000) {
  return String(value || "").trim().slice(0, max);
}

export function knowledgeAiConfiguration(environment = process.env) {
  const deploymentHost = cleanText(
    environment.VERCEL_URL || environment.VERCEL_PROJECT_PRODUCTION_URL,
    500
  );
  return {
    configured: Boolean(cleanText(environment.OPENAI_API_KEY, 10000)),
    model: cleanText(environment.OPENAI_MODEL, 200) || "gpt-4.1-mini",
    environment: cleanText(environment.VERCEL_ENV || environment.NODE_ENV, 50) || "unknown",
    deployment_host: deploymentHost,
    commit_ref: cleanText(environment.VERCEL_GIT_COMMIT_REF, 200),
  };
}

function cleanStringArray(value, maximum = 30) {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item, 160)).filter(Boolean).slice(0, maximum)
    : [];
}

function cleanJsonArray(value, maximum = 100) {
  return Array.isArray(value) ? value.slice(0, maximum) : [];
}

function cleanTopic(value = {}) {
  const category = cleanText(value.category, 80);
  const status = cleanText(value.status || "idea", 30);
  const priority = Math.min(5, Math.max(1, Number(value.priority) || 3));
  if (!cleanText(value.title, 240)) throw new ApiError(400, "Topic title is required.");
  if (!KNOWLEDGE_CATEGORIES.includes(category)) throw new ApiError(400, "Unsupported topic category.");
  if (!KNOWLEDGE_TOPIC_STATUSES.includes(status)) throw new ApiError(400, "Unsupported topic status.");
  return {
    title: cleanText(value.title, 240),
    category,
    primary_keyword: cleanText(value.primary_keyword, 200) || null,
    secondary_keywords: cleanStringArray(value.secondary_keywords),
    intent: cleanText(value.intent, 1000) || null,
    notes: cleanText(value.notes, 5000) || null,
    status,
    priority,
    source: cleanText(value.source || "manual", 80),
    finder_metadata:
      value.finder_metadata && typeof value.finder_metadata === "object"
        ? value.finder_metadata
        : {},
    updated_at: new Date().toISOString(),
  };
}

function cleanArticle(value = {}, requestedStatus = "") {
  const status = cleanText(requestedStatus || value.status || "draft", 30);
  if (!KNOWLEDGE_ARTICLE_STATUSES.includes(status)) throw new ApiError(400, "Unsupported article status.");
  const article = {
    topic_id: value.topic_id || null,
    template_id: value.template_id || null,
    title: cleanText(value.title, 240),
    slug: cleanText(value.slug, 260),
    category: cleanText(value.category, 80) || null,
    article_type: cleanText(value.article_type, 80) || null,
    seo_title: cleanText(value.seo_title, 240) || null,
    meta_description: cleanText(value.meta_description, 500) || null,
    excerpt: cleanText(value.excerpt, 2000) || null,
    content_markdown: cleanText(value.content_markdown, 150000) || null,
    content_html: markdownToKnowledgeHtml(value.content_markdown),
    faq_json: cleanJsonArray(value.faq_json),
    cta: cleanText(value.cta, 2000) || null,
    internal_link_suggestions: cleanJsonArray(value.internal_link_suggestions),
    quality_checks: calculateKnowledgeQualityChecks(
      value,
      value.generation_metadata?.approximate_length
    ),
    generation_metadata:
      value.generation_metadata && typeof value.generation_metadata === "object"
        ? value.generation_metadata
        : {},
    status,
    approved_at: status === "approved" ? new Date().toISOString() : value.approved_at || null,
    updated_at: new Date().toISOString(),
  };
  const validation = validateKnowledgeArticle(article);
  if (Object.keys(validation).length) {
    throw new ApiError(400, Object.values(validation).join(" "));
  }
  return article;
}

async function loadHub(supabase) {
  const [topics, templates, articles, settings] = await Promise.all([
    supabase.from("knowledge_topics").select("*").order("updated_at", { ascending: false }),
    supabase.from("knowledge_templates").select("*").eq("active", true).order("name"),
    supabase
      .from("knowledge_articles")
      .select("*, knowledge_topics(title,primary_keyword)")
      .order("updated_at", { ascending: false }),
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
  ]);
  [topics, templates, articles, settings].forEach((result) => assertResult(result, "Knowledge Hub could not load."));
  return {
    topics: topics.data || [],
    templates: templates.data || [],
    articles: articles.data || [],
    settings: settings.data || null,
  };
}

async function saveTopic(supabase, topic) {
  const payload = cleanTopic(topic);
  const result = topic?.id
    ? await supabase.from("knowledge_topics").update(payload).eq("id", topic.id).select().single()
    : await supabase.from("knowledge_topics").insert(payload).select().single();
  return assertResult(result, "Topic could not be saved.").data;
}

async function deleteTopic(supabase, topicId) {
  if (!topicId) throw new ApiError(400, "Topic id is required.");
  assertResult(
    await supabase.from("knowledge_topics").delete().eq("id", topicId),
    "Topic could not be deleted."
  );
  return { id: topicId };
}

function generationPrompt({ topic, template, generation, settings }) {
  return `${template.prompt}

Business: ${settings?.business_name || "Van Finance Company"}
Website: ${settings?.website_url || "https://www.vanfinancecompany.co.uk"}
Topic: ${topic.title}
Category: ${topic.category}
Primary keyword: ${topic.primary_keyword || ""}
Secondary keywords: ${(topic.secondary_keywords || []).join(", ")}
Customer/search intent: ${topic.intent || ""}
Topic notes: ${topic.notes || ""}
Target audience: ${generation.targetAudience || settings?.default_audience || template.default_audience || ""}
Tone: ${generation.tone || settings?.default_tone || template.default_tone || ""}
Approximate length: ${Number(generation.approximateLength || 1000)} words
Additional instructions: ${generation.instructions || "None"}
Default CTA: ${settings?.default_cta || ""}
Business description: ${settings?.business_description || ""}
Products and services: ${settings?.products_services || ""}
Confirmed factual guidance: ${settings?.factual_guidance || ""}
Claims and statements to avoid: ${settings?.prohibited_claims || ""}
Business target audiences: ${(settings?.target_audiences || []).join(", ")}
Content goals: ${(settings?.content_goals || []).join(", ")}

Prioritise helpfulness, clarity and factual restraint. Answer a real customer question or intent.
Do not invent rates, approval guarantees, vehicle availability, prices, legal claims or company
policies. Mark an uncertain business-specific fact as "[REVIEW: confirm ...]" instead of guessing.
Avoid keyword stuffing, repeated paragraphs, doorway-page variants and generic filler. Return useful
Markdown and equivalent clean HTML.`;
}

async function callKnowledgeStructuredAi({
  input,
  schema,
  schemaName,
  systemInstruction,
  operationLabel = "content",
}) {
  const configuration = knowledgeAiConfiguration();
  if (!configuration.configured) {
    const deployment = configuration.deployment_host
      ? ` for ${configuration.deployment_host}`
      : "";
    throw new ApiError(
      500,
      `OPENAI_API_KEY is not available to this ${configuration.environment} deployment${deployment}. Add it to the Vercel project that owns this URL, then redeploy.`
    );
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cleanText(process.env.OPENAI_API_KEY, 10000)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: configuration.model,
      input: [
        {
          role: "system",
          content: systemInstruction,
        },
        { role: "user", content: input },
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    console.error("KNOWLEDGE AI HTTP ERROR", {
      status: response.status,
      code: result?.error?.code,
      message: result?.error?.message,
    });
    throw new ApiError(
      502,
      `The AI service could not generate the ${operationLabel}. Please try again.`
    );
  }
  if (result.status === "incomplete") {
    throw new ApiError(502, "The AI response was incomplete. Please try again.");
  }
  const refusal = result.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "refusal")?.refusal;
  if (refusal) throw new ApiError(502, `The AI could not generate the ${operationLabel}.`);
  const output =
    result.output_text ||
    result.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new ApiError(502, "The AI returned no structured response.");
  return output;
}

async function generateArticle(supabase, body) {
  const topicId = body.topic?.id;
  if (!topicId) throw new ApiError(400, "A saved topic is required.");
  const templateKey = cleanText(body.generation?.templateKey || "faq", 80);
  if (!KNOWLEDGE_ARTICLE_TYPES.includes(templateKey)) throw new ApiError(400, "Unsupported article type.");

  const [topicResult, templateResult, settingsResult, existingArticleResult] = await Promise.all([
    supabase.from("knowledge_topics").select("*").eq("id", topicId).single(),
    supabase.from("knowledge_templates").select("*").eq("key", templateKey).eq("active", true).single(),
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
    supabase
      .from("knowledge_articles")
      .select("id,title,status")
      .eq("topic_id", topicId)
      .neq("status", "archived")
      .limit(1),
  ]);
  const topic = assertResult(topicResult, "Topic could not be found.").data;
  const template = assertResult(templateResult, "Template could not be found.").data;
  assertResult(settingsResult, "Knowledge settings could not be loaded.");
  assertResult(existingArticleResult, "Existing topic coverage could not be checked.");
  if (existingArticleResult.data?.length) {
    throw new ApiError(
      409,
      `This topic already has an active article: "${existingArticleResult.data[0].title}".`
    );
  }

  const generated = parseKnowledgeArticleResponse(
    await callKnowledgeStructuredAi({
      input: generationPrompt({
        topic,
        template,
        generation: body.generation || {},
        settings: settingsResult.data,
      }),
      schema: ARTICLE_SCHEMA,
      schemaName: "knowledge_article",
      operationLabel: "article",
      systemInstruction:
        "You are a careful UK van-finance knowledge editor. Produce useful, non-spammy content and follow the JSON schema exactly.",
    })
  );
  const article = cleanArticle({
    ...generated,
    topic_id: topic.id,
    template_id: template.id,
    category: topic.category,
    article_type: template.key,
    status: "draft",
    generation_metadata: {
      ...generated.generation_metadata,
      target_audience: body.generation?.targetAudience || "",
      tone: body.generation?.tone || "",
      approximate_length: Number(body.generation?.approximateLength || 1000),
      generated_at: new Date().toISOString(),
    },
  });
  const saved = assertResult(
    await supabase.from("knowledge_articles").insert(article).select().single(),
    "The generated article could not be saved."
  ).data;
  assertResult(
    await supabase
      .from("knowledge_topics")
      .update({ status: "generated", updated_at: new Date().toISOString() })
      .eq("id", topic.id),
    "The topic status could not be updated."
  );
  return saved;
}

function topicFinderPrompt({ categories, quantity, settings, topics, articles, brief }) {
  return `Generate ${quantity} genuinely useful content topic ideas grouped across these categories:
${categories.join(", ")}.

Business: ${settings?.business_name || "Van Finance Company"}
Website: ${settings?.website_url || ""}
Business description: ${settings?.business_description || ""}
Products and services: ${settings?.products_services || ""}
Confirmed factual guidance: ${settings?.factual_guidance || ""}
Claims to avoid: ${settings?.prohibited_claims || ""}
Target audiences: ${(settings?.target_audiences || []).join(", ") || settings?.default_audience || ""}
Content goals: ${(settings?.content_goals || []).join(", ")}
Additional finder brief: ${brief || "Find unanswered, commercially useful customer questions."}

Existing topics to avoid:
${topics.map((topic) => `- ${topic.title} [${topic.category}]`).join("\n") || "- None"}

Existing articles to avoid duplicating:
${articles.map((article) => `- ${article.title} [${article.category}]`).join("\n") || "- None"}

Every idea must answer a distinct real customer intent. Avoid near-duplicates, keyword variants,
doorway pages, generic filler, invented demand data and unsupported business claims. Priority is an
editorial value from 1 (low) to 5 (highest), based on customer usefulness and missing coverage—not
an invented search-volume score.`;
}

async function findTopics(supabase, body) {
  const categories = cleanStringArray(body.categories, KNOWLEDGE_CATEGORIES.length).filter(
    (category) => KNOWLEDGE_CATEGORIES.includes(category)
  );
  if (!categories.length) throw new ApiError(400, "Select at least one topic category.");
  const quantity = Math.min(30, Math.max(1, Number(body.quantity) || 12));
  const [topicsResult, articlesResult, settingsResult] = await Promise.all([
    supabase
      .from("knowledge_topics")
      .select("id,title,category,primary_keyword,secondary_keywords,status")
      .neq("status", "archived")
      .limit(200),
    supabase
      .from("knowledge_articles")
      .select("id,title,category,article_type,status")
      .neq("status", "archived")
      .limit(200),
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
  ]);
  [topicsResult, articlesResult, settingsResult].forEach((result) =>
    assertResult(result, "Topic Finder context could not be loaded.")
  );
  const existingTopics = topicsResult.data || [];
  const parsed = parseKnowledgeTopicIdeasResponse(
    await callKnowledgeStructuredAi({
      input: topicFinderPrompt({
        categories,
        quantity,
        settings: settingsResult.data,
        topics: existingTopics,
        articles: articlesResult.data || [],
        brief: cleanText(body.brief, 3000),
      }),
      schema: TOPIC_IDEAS_SCHEMA,
      schemaName: "knowledge_topic_ideas",
      operationLabel: "topic ideas",
      systemInstruction:
        "You are a careful content planner for a UK van business. Produce distinct, useful topic ideas and follow the JSON schema exactly.",
    })
  );
  const accepted = [];
  let duplicateCount = 0;
  parsed.forEach((idea) => {
    const duplicate = findKnowledgeTopicDuplicates(idea, [...existingTopics, ...accepted]);
    if (duplicate.length) duplicateCount += 1;
    else if (categories.includes(idea.category) && accepted.length < quantity) accepted.push(idea);
  });
  return { ideas: accepted, duplicate_count: duplicateCount };
}

async function saveTopicIdeas(supabase, ideas) {
  const existingResult = assertResult(
    await supabase
      .from("knowledge_topics")
      .select("id,title,category,primary_keyword,secondary_keywords,status")
      .neq("status", "archived"),
    "Existing topics could not be checked."
  );
  const accepted = [];
  const skipped = [];
  cleanJsonArray(ideas, 30).forEach((idea) => {
    const payload = cleanTopic({
      ...idea,
      status: "idea",
      source: "ai_topic_finder",
      finder_metadata: {
        rationale: cleanText(idea.rationale, 2000),
        accepted_at: new Date().toISOString(),
      },
    });
    const duplicate = findKnowledgeTopicDuplicates(payload, [
      ...(existingResult.data || []),
      ...accepted,
    ])[0];
    if (duplicate) skipped.push({ title: payload.title, duplicate_of: duplicate.topic.title });
    else accepted.push(payload);
  });
  if (!accepted.length) return { topics: [], skipped };
  const saved = assertResult(
    await supabase.from("knowledge_topics").insert(accepted).select(),
    "Selected topic ideas could not be saved."
  );
  return { topics: saved.data || [], skipped };
}

async function saveArticle(supabase, body) {
  if (!body.article?.id) throw new ApiError(400, "Article id is required.");
  const payload = cleanArticle(body.article, body.status);
  return assertResult(
    await supabase
      .from("knowledge_articles")
      .update(payload)
      .eq("id", body.article.id)
      .select()
      .single(),
    "Article could not be saved."
  ).data;
}

async function bulkUpdateArticles(supabase, body) {
  const ids = cleanStringArray(body.article_ids, 500);
  const status = cleanText(body.status, 30);
  if (!ids.length) throw new ApiError(400, "Select at least one article.");
  if (!["approved", "archived"].includes(status)) throw new ApiError(400, "Unsupported bulk action.");
  const payload = {
    status,
    updated_at: new Date().toISOString(),
    ...(status === "approved" ? { approved_at: new Date().toISOString() } : {}),
  };
  assertResult(
    await supabase.from("knowledge_articles").update(payload).in("id", ids),
    "Articles could not be updated."
  );
  return { ids, ...payload };
}

async function saveSettings(supabase, settings = {}) {
  const payload = {
    settings_key: "default",
    business_name: cleanText(settings.business_name, 200),
    website_url: cleanText(settings.website_url, 500),
    default_cta: cleanText(settings.default_cta, 2000),
    default_tone: cleanText(settings.default_tone, 300),
    default_audience: cleanText(settings.default_audience, 300),
    business_description: cleanText(settings.business_description, 5000),
    products_services: cleanText(settings.products_services, 10000),
    factual_guidance: cleanText(settings.factual_guidance, 20000),
    prohibited_claims: cleanText(settings.prohibited_claims, 10000),
    target_audiences: cleanStringArray(settings.target_audiences, 30),
    content_goals: cleanStringArray(settings.content_goals, 30),
    freshness_days: Math.min(730, Math.max(30, Number(settings.freshness_days) || 180)),
    updated_at: new Date().toISOString(),
  };
  return assertResult(
    await supabase.from("knowledge_settings").upsert(payload, { onConflict: "settings_key" }).select().single(),
    "Knowledge settings could not be saved."
  ).data;
}

async function saveTemplate(supabase, template = {}) {
  const key = cleanText(template.key, 80);
  if (!KNOWLEDGE_ARTICLE_TYPES.includes(key)) throw new ApiError(400, "Unsupported template.");
  const payload = {
    name: cleanText(template.name, 200),
    description: cleanText(template.description, 2000),
    prompt: cleanText(template.prompt, 20000),
    default_tone: cleanText(template.default_tone, 500),
    default_audience: cleanText(template.default_audience, 500),
    updated_at: new Date().toISOString(),
  };
  if (!payload.name || !payload.prompt) {
    throw new ApiError(400, "Template name and prompt are required.");
  }
  return assertResult(
    await supabase
      .from("knowledge_templates")
      .update(payload)
      .eq("key", key)
      .select()
      .single(),
    "Template could not be saved."
  ).data;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });

  try {
    const body = parseBody(request);
    const supabase = getSupabase();
    let data;
    switch (body.action) {
      case "load":
        data = {
          ...(await loadHub(supabase)),
          ai_configuration: knowledgeAiConfiguration(),
        };
        break;
      case "saveTopic":
        data = { topic: await saveTopic(supabase, body.topic) };
        break;
      case "deleteTopic":
        data = { topic: await deleteTopic(supabase, body.topic_id) };
        break;
      case "findTopics":
        data = { finder: await findTopics(supabase, body) };
        break;
      case "saveTopicIdeas":
        data = { finder: await saveTopicIdeas(supabase, body.ideas) };
        break;
      case "generateArticle":
        data = { article: await generateArticle(supabase, body) };
        break;
      case "saveArticle":
        data = { article: await saveArticle(supabase, body) };
        break;
      case "bulkUpdateArticles":
        data = { update: await bulkUpdateArticles(supabase, body) };
        break;
      case "saveSettings":
        data = { settings: await saveSettings(supabase, body.settings) };
        break;
      case "saveTemplate":
        data = { template: await saveTemplate(supabase, body.template) };
        break;
      default:
        throw new ApiError(400, "Unsupported Knowledge Hub action.");
    }
    return response.status(200).json({ ok: true, ...data });
  } catch (error) {
    console.error("MARKETING KNOWLEDGE HUB ERROR", {
      action: parseBody(request).action || "",
      message: error.message,
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Knowledge Hub request failed.",
    });
  }
}
