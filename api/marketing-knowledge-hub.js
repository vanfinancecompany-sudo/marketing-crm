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
import {
  BUSINESS_KNOWLEDGE_SECTION_KEYS,
  buildAiPlatformPrompt,
  buildBusinessIntelligencePrompt,
  parseKnowledgeArticleReviewResponse,
} from "../lib/businessIntelligence.js";

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
          "estimated_value",
          "difficulty",
          "target_persona",
          "seasonal",
          "opportunity_reason",
        ],
        properties: {
          title: { type: "string" },
          category: { type: "string", enum: KNOWLEDGE_CATEGORIES },
          primary_keyword: { type: "string" },
          secondary_keywords: { type: "array", items: { type: "string" } },
          intent: { type: "string" },
          rationale: { type: "string" },
          priority: { type: "integer" },
          estimated_value: { type: "integer" },
          difficulty: { type: "integer" },
          target_persona: { type: "string" },
          seasonal: { type: "boolean" },
          opportunity_reason: { type: "string" },
        },
      },
    },
  },
};
const REVIEW_CATEGORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "reason", "findings"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" },
    findings: { type: "array", items: { type: "string" } },
  },
};
const ARTICLE_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overall_score",
    "summary",
    "categories",
    "strengths",
    "issues",
    "recommendations",
  ],
  properties: {
    overall_score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    categories: {
      type: "object",
      additionalProperties: false,
      required: [
        "brand_consistency",
        "vocabulary",
        "readability",
        "seo",
        "cta_quality",
        "compliance",
        "repetition",
        "generic_wording",
        "hallucination_risk",
      ],
      properties: {
        brand_consistency: REVIEW_CATEGORY_SCHEMA,
        vocabulary: REVIEW_CATEGORY_SCHEMA,
        readability: REVIEW_CATEGORY_SCHEMA,
        seo: REVIEW_CATEGORY_SCHEMA,
        cta_quality: REVIEW_CATEGORY_SCHEMA,
        compliance: REVIEW_CATEGORY_SCHEMA,
        repetition: REVIEW_CATEGORY_SCHEMA,
        generic_wording: REVIEW_CATEGORY_SCHEMA,
        hallucination_risk: REVIEW_CATEGORY_SCHEMA,
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "description", "evidence"],
        properties: {
          category: {
            type: "string",
            enum: [
              "brand_consistency",
              "vocabulary",
              "readability",
              "seo",
              "cta_quality",
              "compliance",
              "repetition",
              "generic_wording",
              "hallucination_risk",
            ],
          },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          description: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
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
  const estimatedValue = Math.min(5, Math.max(1, Number(value.estimated_value) || 3));
  const difficulty = Math.min(5, Math.max(1, Number(value.difficulty) || 3));
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
    estimated_value: estimatedValue,
    difficulty,
    target_persona: cleanText(value.target_persona, 500),
    seasonal: Boolean(value.seasonal),
    opportunity_reason: cleanText(value.opportunity_reason, 3000),
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
  const [topics, templates, articles, settings, businessSections, reviews] = await Promise.all([
    supabase.from("knowledge_topics").select("*").order("updated_at", { ascending: false }),
    supabase.from("knowledge_templates").select("*").eq("active", true).order("name"),
    supabase
      .from("knowledge_articles")
      .select("*, knowledge_topics(title,primary_keyword)")
      .order("updated_at", { ascending: false }),
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
    supabase
      .from("knowledge_business_sections")
      .select("*")
      .order("sort_order", { ascending: true }),
    supabase
      .from("knowledge_article_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  [topics, templates, articles, settings, businessSections, reviews].forEach((result) =>
    assertResult(result, "Knowledge Hub could not load.")
  );
  return {
    topics: topics.data || [],
    templates: templates.data || [],
    articles: articles.data || [],
    settings: settings.data || null,
    business_sections: businessSections.data || [],
    article_reviews: reviews.data || [],
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

  const [
    topicResult,
    templateResult,
    settingsResult,
    businessSectionsResult,
    existingArticleResult,
  ] = await Promise.all([
    supabase.from("knowledge_topics").select("*").eq("id", topicId).single(),
    supabase.from("knowledge_templates").select("*").eq("key", templateKey).eq("active", true).single(),
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
    supabase
      .from("knowledge_business_sections")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
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
  assertResult(businessSectionsResult, "Business Intelligence could not be loaded.");
  assertResult(existingArticleResult, "Existing topic coverage could not be checked.");
  if (existingArticleResult.data?.length) {
    throw new ApiError(
      409,
      `This topic already has an active article: "${existingArticleResult.data[0].title}".`
    );
  }

  const assembledPrompt = buildBusinessIntelligencePrompt({
    topic,
    specialist: template,
    generation: body.generation || {},
    settings: settingsResult.data,
    sections: businessSectionsResult.data || [],
    task: "article_generation",
  });
  const generated = parseKnowledgeArticleResponse(
    await callKnowledgeStructuredAi({
      input: `${assembledPrompt.prompt}

Return useful Markdown and equivalent clean HTML. The result is a draft for human review.`,
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
      business_intelligence: assembledPrompt.metadata,
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

function topicFinderPrompt({
  categories,
  quantity,
  settings,
  businessSections,
  topics,
  articles,
  brief,
}) {
  const assembled = buildAiPlatformPrompt({
    sections: businessSections,
    settings,
    task: "topic_finder",
    module: "topic_planner",
    requestedTask: `Generate ${quantity} genuinely useful content topic ideas grouped across these categories: ${categories.join(", ")}.`,
  });
  return `${assembled.prompt}

Additional finder brief: ${brief || "Find unanswered, commercially useful customer questions."}

Existing topics to avoid:
${topics.map((topic) => `- ${topic.title} [${topic.category}]`).join("\n") || "- None"}

Existing articles to avoid duplicating:
${articles.map((article) => `- ${article.title} [${article.category}]`).join("\n") || "- None"}

Every idea must answer a distinct real customer intent. Avoid near-duplicates, keyword variants,
doorway pages, generic filler, invented demand data and unsupported business claims. Priority is an
editorial value from 1 (low) to 5 (highest), based on customer usefulness and missing coverage—not
an invented search-volume score. Estimate value and difficulty from 1 to 5, identify a target
persona, mark genuinely seasonal ideas and explain the opportunity without inventing demand data.`;
}

async function findTopics(supabase, body) {
  const categories = cleanStringArray(body.categories, KNOWLEDGE_CATEGORIES.length).filter(
    (category) => KNOWLEDGE_CATEGORIES.includes(category)
  );
  if (!categories.length) throw new ApiError(400, "Select at least one topic category.");
  const quantity = Math.min(100, Math.max(1, Number(body.quantity) || 12));
  const [topicsResult, articlesResult, settingsResult, businessSectionsResult] = await Promise.all([
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
    supabase
      .from("knowledge_business_sections")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
  ]);
  [topicsResult, articlesResult, settingsResult, businessSectionsResult].forEach((result) =>
    assertResult(result, "Topic Finder context could not be loaded.")
  );
  const existingTopics = topicsResult.data || [];
  const parsed = parseKnowledgeTopicIdeasResponse(
    await callKnowledgeStructuredAi({
      input: topicFinderPrompt({
        categories,
        quantity,
        settings: settingsResult.data,
        businessSections: businessSectionsResult.data || [],
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
  cleanJsonArray(ideas, 100).forEach((idea) => {
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

function cleanBusinessEntries(entries) {
  return cleanJsonArray(entries, 100)
    .map((entry) => ({
      label: cleanText(entry?.label, 300),
      value: cleanText(entry?.value, 5000),
    }))
    .filter((entry) => entry.label || entry.value);
}

async function saveBusinessSection(supabase, section = {}) {
  const sectionKey = cleanText(section.section_key, 80);
  if (!BUSINESS_KNOWLEDGE_SECTION_KEYS.includes(sectionKey)) {
    throw new ApiError(400, "Unsupported Business Knowledge section.");
  }
  const payload = {
    section_key: sectionKey,
    title: cleanText(section.title, 200),
    description: cleanText(section.description, 2000),
    content: cleanText(section.content, 50000),
    entries: cleanBusinessEntries(section.entries),
    sort_order: Math.max(0, Number(section.sort_order) || 0),
    active: section.active !== false,
    updated_at: new Date().toISOString(),
  };
  if (!payload.title) throw new ApiError(400, "Business Knowledge section title is required.");
  return assertResult(
    await supabase
      .from("knowledge_business_sections")
      .upsert(payload, { onConflict: "section_key" })
      .select()
      .single(),
    "Business Knowledge section could not be saved."
  ).data;
}

async function reviewArticle(supabase, body) {
  const articleId = cleanText(body.article_id, 100);
  if (!articleId) throw new ApiError(400, "Article id is required.");
  const article = assertResult(
    await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    "Article could not be found."
  ).data;
  if (article.status !== "draft") {
    throw new ApiError(400, "Only a saved draft can be sent to the AI Reviewer.");
  }

  const [settingsResult, businessSectionsResult, templateResult] = await Promise.all([
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
    supabase
      .from("knowledge_business_sections")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    article.article_type
      ? supabase
          .from("knowledge_templates")
          .select("*")
          .eq("key", article.article_type)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  [settingsResult, businessSectionsResult, templateResult].forEach((result) =>
    assertResult(result, "AI Reviewer context could not be loaded.")
  );
  const assembledPrompt = buildBusinessIntelligencePrompt({
    sections: businessSectionsResult.data || [],
    settings: settingsResult.data,
    specialist: templateResult.data || { key: article.article_type || "" },
    topic: {
      title: article.title,
      category: article.category,
    },
    generation: article.generation_metadata || {},
    task: "article_review",
  });
  const review = parseKnowledgeArticleReviewResponse(
    await callKnowledgeStructuredAi({
      input: `${assembledPrompt.prompt}

# Article to review
Title: ${article.title}
SEO title: ${article.seo_title || ""}
Meta description: ${article.meta_description || ""}
Excerpt: ${article.excerpt || ""}
Content:
${article.content_markdown || ""}

CTA: ${article.cta || ""}
FAQs: ${JSON.stringify(article.faq_json || [])}

Score brand consistency, vocabulary, compliance, SEO, readability, repetition, CTA quality,
generic wording and hallucination risk. Score only what is evidenced in the article and Business Intelligence. Explain each score, quote
only short evidence snippets, and identify uncertainty as a review issue. Do not rewrite the article,
change its status or approve it.`,
      schema: ARTICLE_REVIEW_SCHEMA,
      schemaName: "knowledge_article_review",
      operationLabel: "article review",
      systemInstruction:
        "You are an advisory content reviewer. Return a strict, evidence-based quality assessment and never rewrite or approve content.",
    })
  );
  const configuration = knowledgeAiConfiguration();
  return assertResult(
    await supabase
      .from("knowledge_article_reviews")
      .insert({
        article_id: article.id,
        overall_score: review.overall_score,
        category_scores: review.categories,
        summary: review.summary,
        strengths: review.strengths,
        issues: review.issues,
        recommendations: review.recommendations,
        model: configuration.model,
        prompt_metadata: assembledPrompt.metadata,
      })
      .select()
      .single(),
    "The AI review could not be saved."
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
      case "saveBusinessSection":
        data = { business_section: await saveBusinessSection(supabase, body.business_section) };
        break;
      case "reviewArticle":
        data = { review: await reviewArticle(supabase, body) };
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
