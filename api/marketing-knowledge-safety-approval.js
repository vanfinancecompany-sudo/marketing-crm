import { createClient } from "@supabase/supabase-js";
import {
  calculateKnowledgeQualityChecks,
  markdownToKnowledgeHtml,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";
import { articleContentHash } from "../lib/editorialIntelligence.js";
import { evaluatePublishingSafety } from "../lib/publishingSafety.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 150000) => String(value || "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY, 10000);
  const header = clean(request.headers?.[API_KEY_HEADER], 10000);
  const authorization = clean(request.headers?.authorization, 10000);
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ApiError(500, "Supabase is not configured.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

function cleanArticlePayload(article = {}) {
  const payload = {
    topic_id: article.topic_id || null,
    template_id: article.template_id || null,
    title: clean(article.title, 240),
    slug: clean(article.slug, 260),
    category: clean(article.category, 80) || null,
    article_type: clean(article.article_type, 80) || null,
    seo_title: clean(article.seo_title, 240) || null,
    meta_description: clean(article.meta_description, 500) || null,
    excerpt: clean(article.excerpt, 2000) || null,
    featured_image: clean(article.featured_image, 3000) || null,
    content_markdown: clean(article.content_markdown, 150000) || null,
    content_html: markdownToKnowledgeHtml(article.content_markdown),
    faq_json: Array.isArray(article.faq_json) ? article.faq_json.slice(0, 100) : [],
    cta: clean(article.cta, 2000) || null,
    internal_link_suggestions: Array.isArray(article.internal_link_suggestions)
      ? article.internal_link_suggestions.slice(0, 100)
      : [],
    quality_checks: calculateKnowledgeQualityChecks(
      article,
      article.generation_metadata?.approximate_length
    ),
    generation_metadata:
      article.generation_metadata && typeof article.generation_metadata === "object"
        ? article.generation_metadata
        : {},
    status: "approved",
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const validation = validateKnowledgeArticle(payload);
  if (Object.keys(validation).length) {
    throw new ApiError(400, Object.values(validation).join(" "));
  }
  return payload;
}

async function loadSafetyContext(supabase, articleIds) {
  const [assessmentsResult, businessKnowledgeResult] = await Promise.all([
    supabase
      .from("knowledge_article_editorial_assessments")
      .select("*")
      .in("article_id", articleIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("knowledge_business_sections")
      .select("section_key,content,entries,active")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
  ]);
  const assessments = resultData(assessmentsResult, "Editorial assessments could not be loaded.") || [];
  const latest = new Map();
  assessments.forEach((assessment) => {
    if (!latest.has(assessment.article_id)) latest.set(assessment.article_id, assessment);
  });
  return {
    latest,
    businessKnowledge:
      resultData(businessKnowledgeResult, "Business Knowledge could not be loaded.") || [],
  };
}

function ensureSafe(article, context) {
  const contentHash = articleContentHash(article);
  const safety = evaluatePublishingSafety(
    { ...article, content_hash: contentHash },
    {
      assessment: context.latest.get(article.id),
      businessKnowledge: context.businessKnowledge,
      currentContentHash: contentHash,
    }
  );
  if (safety.hard_blocked) {
    throw new ApiError(409, safety.hard_block_reasons.join(" "), safety);
  }
  return safety;
}

async function approveArticle(supabase, article) {
  if (!article?.id) throw new ApiError(400, "Article id is required.");
  const context = await loadSafetyContext(supabase, [article.id]);
  const safety = ensureSafe(article, context);
  const payload = cleanArticlePayload(article);
  const saved = resultData(
    await supabase
      .from("knowledge_articles")
      .update(payload)
      .eq("id", article.id)
      .select()
      .single(),
    "Article could not be approved."
  );
  return { article: saved, safety };
}

async function approveArticles(supabase, articleIds) {
  const ids = Array.isArray(articleIds)
    ? [...new Set(articleIds.map((id) => clean(id, 100)).filter(Boolean))].slice(0, 500)
    : [];
  if (!ids.length) throw new ApiError(400, "Select at least one article.");
  const articles = resultData(
    await supabase.from("knowledge_articles").select("*").in("id", ids),
    "Articles could not be loaded."
  ) || [];
  if (articles.length !== ids.length) throw new ApiError(404, "One or more articles could not be found.");
  const context = await loadSafetyContext(supabase, ids);
  const blocked = [];
  articles.forEach((article) => {
    try {
      ensureSafe(article, context);
    } catch (error) {
      blocked.push({ article_id: article.id, title: article.title, reasons: error.details?.hard_block_reasons || [error.message] });
    }
  });
  if (blocked.length) {
    throw new ApiError(
      409,
      `${blocked.length} selected article(s) are blocked by publishing safety checks.`,
      { blocked }
    );
  }
  const now = new Date().toISOString();
  resultData(
    await supabase
      .from("knowledge_articles")
      .update({ status: "approved", approved_at: now, updated_at: now })
      .in("id", ids),
    "Articles could not be approved."
  );
  return { update: { ids, status: "approved", approved_at: now, updated_at: now } };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, message: "Access key not recognised." });
  }
  let body = {};
  try {
    body = parseBody(request);
    const supabase = getSupabase();
    const output = body.action === "approveArticle"
      ? await approveArticle(supabase, body.article)
      : body.action === "approveArticles"
        ? await approveArticles(supabase, body.article_ids)
        : (() => { throw new ApiError(400, "Unsupported safety approval action."); })();
    return response.status(200).json({ ok: true, ...output });
  } catch (error) {
    console.error("KNOWLEDGE SAFETY APPROVAL ERROR", {
      action: clean(body.action, 100),
      status: error.status || 500,
      message: clean(error.message, 1000),
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.message || "Article approval failed.",
      safety: error.details || null,
    });
  }
}
