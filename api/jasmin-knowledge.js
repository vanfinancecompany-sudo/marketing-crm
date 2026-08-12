import { createClient } from "@supabase/supabase-js";
import {
  KNOWLEDGE_ARTICLE_TYPES,
  KNOWLEDGE_CATEGORIES,
  calculateKnowledgeQualityChecks,
  findKnowledgeTopicDuplicates,
  markdownToKnowledgeHtml,
  slugifyKnowledgeArticle,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";
import { publishKnowledgeArticleToWix } from "./marketing-wix-publishing.js";

const JASMIN_KEY_HEADER = "x-jasmin-marketing-key";
const clean = (value, max = 20000) => String(value || "").trim().slice(0, max);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authorised(request, environment = process.env) {
  const expected = clean(environment.JASMIN_MARKETING_API_KEY, 10000);
  const header = clean(
    request?.headers?.[JASMIN_KEY_HEADER] || request?.headers?.[JASMIN_KEY_HEADER.toLowerCase()],
    10000
  );
  const authorization = clean(request?.headers?.authorization, 10000);
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function getSupabase() {
  const url = clean(process.env.SUPABASE_URL, 2000);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 10000);
  if (!url || !key) throw new ApiError(500, "Marketing CRM data service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      throw new ApiError(400, "The request body is not valid JSON.");
    }
  }
  return request.body;
}

function resultData(result, fallback) {
  if (result.error) throw new ApiError(500, result.error.message || fallback);
  return result.data;
}

function strings(value, max = 30) {
  return Array.isArray(value)
    ? value.map((item) => clean(item, 200)).filter(Boolean).slice(0, max)
    : [];
}

function jsonArray(value, max = 100) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

async function loadKnowledge(supabase, body) {
  const limit = Math.min(250, Math.max(1, Number(body.limit) || 100));
  const [topics, articles, businessSections, reviews] = await Promise.all([
    supabase
      .from("knowledge_topics")
      .select("*")
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(limit),
    supabase
      .from("knowledge_articles")
      .select("*")
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(limit),
    supabase
      .from("knowledge_business_sections")
      .select("section_key,title,description,content,entries,sort_order,active,updated_at")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("knowledge_article_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  return {
    topics: resultData(topics, "Knowledge topics could not be loaded.") || [],
    articles: resultData(articles, "Knowledge articles could not be loaded.") || [],
    business_sections: resultData(businessSections, "Business Knowledge could not be loaded.") || [],
    article_reviews: resultData(reviews, "Article reviews could not be loaded.") || [],
  };
}

async function createTopic(supabase, body) {
  const topic = body.topic || {};
  const category = clean(topic.category, 80);
  if (!clean(topic.title, 240)) throw new ApiError(400, "Topic title is required.");
  if (!KNOWLEDGE_CATEGORIES.includes(category)) throw new ApiError(400, "Unsupported topic category.");

  const existing = resultData(
    await supabase
      .from("knowledge_topics")
      .select("id,title,category,primary_keyword,secondary_keywords,status")
      .neq("status", "archived"),
    "Existing topics could not be checked."
  ) || [];

  const candidate = {
    title: clean(topic.title, 240),
    category,
    primary_keyword: clean(topic.primary_keyword, 200) || null,
    secondary_keywords: strings(topic.secondary_keywords),
  };
  const duplicate = findKnowledgeTopicDuplicates(candidate, existing)[0];
  if (duplicate) {
    throw new ApiError(409, `A similar topic already exists: “${duplicate.topic.title}”.`);
  }

  const now = new Date().toISOString();
  const payload = {
    ...candidate,
    intent: clean(topic.intent, 1000) || null,
    notes: clean(topic.notes, 5000) || null,
    status: "idea",
    priority: Math.min(5, Math.max(1, Number(topic.priority) || 3)),
    estimated_value: Math.min(5, Math.max(1, Number(topic.estimated_value) || 3)),
    difficulty: Math.min(5, Math.max(1, Number(topic.difficulty) || 3)),
    target_persona: clean(topic.target_persona, 500) || null,
    seasonal: Boolean(topic.seasonal),
    opportunity_reason: clean(topic.opportunity_reason, 3000) || null,
    source: "jasmin_chatgpt",
    finder_metadata: {
      created_via: "jasmin_knowledge_action",
      created_at: now,
    },
    updated_at: now,
  };

  return resultData(
    await supabase.from("knowledge_topics").insert(payload).select().single(),
    "Topic could not be created."
  );
}

function cleanArticleInput(value = {}) {
  const category = clean(value.category, 80);
  const articleType = clean(value.article_type || "faq", 80);
  if (!KNOWLEDGE_CATEGORIES.includes(category)) throw new ApiError(400, "Unsupported article category.");
  if (!KNOWLEDGE_ARTICLE_TYPES.includes(articleType)) throw new ApiError(400, "Unsupported article type.");

  const title = clean(value.title, 240);
  const markdown = clean(value.content_markdown, 150000);
  const article = {
    topic_id: value.topic_id || null,
    template_id: value.template_id || null,
    title,
    slug: slugifyKnowledgeArticle(value.slug || title),
    category,
    article_type: articleType,
    seo_title: clean(value.seo_title, 240),
    meta_description: clean(value.meta_description, 500),
    excerpt: clean(value.excerpt, 2000),
    featured_image: clean(value.featured_image, 3000) || null,
    content_markdown: markdown,
    content_html: markdownToKnowledgeHtml(markdown),
    faq_json: jsonArray(value.faq_json),
    cta: clean(value.cta, 2000),
    internal_link_suggestions: jsonArray(value.internal_link_suggestions),
    generation_metadata: {
      ...(value.generation_metadata && typeof value.generation_metadata === "object"
        ? value.generation_metadata
        : {}),
      created_or_updated_via: "jasmin_knowledge_action",
    },
  };
  article.quality_checks = calculateKnowledgeQualityChecks(
    article,
    article.generation_metadata?.approximate_length
  );
  const validation = validateKnowledgeArticle(article);
  if (Object.keys(validation).length) {
    throw new ApiError(400, Object.values(validation).join(" "));
  }
  return article;
}

async function createDraft(supabase, body) {
  const article = cleanArticleInput(body.article || {});
  const duplicate = resultData(
    await supabase
      .from("knowledge_articles")
      .select("id,title,slug,status")
      .neq("status", "archived")
      .or(`slug.eq.${article.slug},title.eq.${article.title.replace(/,/g, "")}`)
      .limit(1),
    "Existing articles could not be checked."
  );
  if (duplicate?.length) {
    throw new ApiError(409, `An active article already exists: “${duplicate[0].title}”.`);
  }

  const now = new Date().toISOString();
  const saved = resultData(
    await supabase
      .from("knowledge_articles")
      .insert({
        ...article,
        status: "draft",
        approved_at: null,
        updated_at: now,
      })
      .select()
      .single(),
    "Article draft could not be created."
  );

  if (saved.topic_id) {
    const topicUpdate = await supabase
      .from("knowledge_topics")
      .update({ status: "generated", updated_at: now })
      .eq("id", saved.topic_id);
    if (topicUpdate.error) throw new ApiError(500, topicUpdate.error.message || "Topic status could not be updated.");
  }
  return saved;
}

async function updateDraft(supabase, body) {
  const id = clean(body.article?.id, 100);
  if (!id) throw new ApiError(400, "Article id is required.");
  const current = resultData(
    await supabase.from("knowledge_articles").select("*").eq("id", id).single(),
    "Article could not be found."
  );
  if (current.status !== "draft") {
    throw new ApiError(409, "Only draft articles can be edited through the Jasmin Knowledge action.");
  }
  const article = cleanArticleInput({ ...current, ...body.article, id });
  return resultData(
    await supabase
      .from("knowledge_articles")
      .update({ ...article, status: "draft", approved_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single(),
    "Article draft could not be updated."
  );
}

async function approveArticle(supabase, body) {
  const id = clean(body.article_id, 100);
  if (!id) throw new ApiError(400, "Article id is required.");
  const article = resultData(
    await supabase.from("knowledge_articles").select("*").eq("id", id).single(),
    "Article could not be found."
  );
  if (article.status !== "draft") throw new ApiError(409, "Only draft articles can be approved.");
  const validation = validateKnowledgeArticle(article);
  if (Object.keys(validation).length) throw new ApiError(400, Object.values(validation).join(" "));
  const now = new Date().toISOString();
  return resultData(
    await supabase
      .from("knowledge_articles")
      .update({ status: "approved", approved_at: now, updated_at: now })
      .eq("id", id)
      .select()
      .single(),
    "Article could not be approved."
  );
}

async function sendToWixDraft(supabase, body) {
  const articleId = clean(body.article_id, 100);
  if (!articleId) throw new ApiError(400, "Article id is required.");
  return publishKnowledgeArticleToWix({ supabase, articleId });
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!authorised(request)) {
    return response.status(401).json({ ok: false, message: "Jasmin access key not recognised." });
  }

  let body = {};
  try {
    body = parseBody(request);
    const supabase = getSupabase();
    let data;
    switch (body.action) {
      case "load":
        data = await loadKnowledge(supabase, body);
        break;
      case "createTopic":
        data = { topic: await createTopic(supabase, body) };
        break;
      case "createDraft":
        data = { article: await createDraft(supabase, body) };
        break;
      case "updateDraft":
        data = { article: await updateDraft(supabase, body) };
        break;
      case "approveArticle":
        data = { article: await approveArticle(supabase, body) };
        break;
      case "sendToWixDraft":
        data = await sendToWixDraft(supabase, body);
        break;
      default:
        throw new ApiError(400, "Unsupported Jasmin Knowledge action.");
    }
    return response.status(200).json({ ok: true, action: body.action, ...data });
  } catch (error) {
    console.error("JASMIN KNOWLEDGE ACTION ERROR", {
      action: clean(body.action, 80),
      message: clean(error.message, 500),
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Jasmin Knowledge request failed.",
    });
  }
}
