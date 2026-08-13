import { createClient } from "@supabase/supabase-js";
import {
  calculateKnowledgeQualityChecks,
  markdownToKnowledgeHtml,
  slugifyKnowledgeArticle,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";

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

function jsonArray(value, max = 100) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function revisionMetadata(article) {
  const metadata = article?.generation_metadata;
  return metadata && typeof metadata === "object" ? metadata : {};
}

function revisionSourceId(article) {
  return clean(revisionMetadata(article).revision_of, 100);
}

function isOpenRevision(article) {
  return article?.status === "archived" && revisionSourceId(article) && revisionMetadata(article).revision_state === "draft";
}

function cleanArticleInput(value = {}) {
  const title = clean(value.title, 240);
  const markdown = clean(value.content_markdown, 150000);
  const article = {
    topic_id: value.topic_id || null,
    template_id: value.template_id || null,
    title,
    slug: slugifyKnowledgeArticle(value.slug || title),
    category: clean(value.category, 80),
    article_type: clean(value.article_type || "faq", 80),
    seo_title: clean(value.seo_title, 240),
    meta_description: clean(value.meta_description, 500),
    excerpt: clean(value.excerpt, 2000),
    featured_image: clean(value.featured_image, 3000) || null,
    content_markdown: markdown,
    content_html: markdownToKnowledgeHtml(markdown),
    faq_json: jsonArray(value.faq_json),
    cta: clean(value.cta, 2000),
    internal_link_suggestions: jsonArray(value.internal_link_suggestions),
    generation_metadata: revisionMetadata(value),
  };
  article.quality_checks = calculateKnowledgeQualityChecks(
    article,
    article.generation_metadata?.approximate_length
  );
  const validation = validateKnowledgeArticle(article);
  if (Object.keys(validation).length) throw new ApiError(400, Object.values(validation).join(" "));
  return article;
}

function revisionSlug(source) {
  const stamp = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slugifyKnowledgeArticle(source.slug || source.title)}-revision-${stamp}-${suffix}`;
}

async function createRevisionDraft(supabase, body) {
  const sourceId = clean(body.article_id, 100);
  if (!sourceId) throw new ApiError(400, "Source article id is required.");

  const source = resultData(
    await supabase.from("knowledge_articles").select("*").eq("id", sourceId).single(),
    "Source article could not be found."
  );
  if (!["approved", "exported"].includes(source.status)) {
    throw new ApiError(409, "Only approved or exported articles can be opened as revision drafts.");
  }

  const archived = resultData(
    await supabase
      .from("knowledge_articles")
      .select("id,status,generation_metadata,updated_at")
      .eq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(250),
    "Existing revision drafts could not be checked."
  ) || [];
  const existing = archived.find((article) => isOpenRevision(article) && revisionSourceId(article) === sourceId);
  if (existing) throw new ApiError(409, `A revision draft already exists for this article: ${existing.id}.`);

  const now = new Date().toISOString();
  const draft = cleanArticleInput({
    ...source,
    slug: revisionSlug(source),
    generation_metadata: {
      ...revisionMetadata(source),
      revision_of: source.id,
      revision_state: "draft",
      revision_source_slug: source.slug,
      revision_source_status: source.status,
      revision_source_updated_at: source.updated_at,
      revision_created_at: now,
      created_or_updated_via: "jasmin_knowledge_revision_action",
    },
  });

  return resultData(
    await supabase
      .from("knowledge_articles")
      .insert({
        ...draft,
        status: "archived",
        approved_at: null,
        created_by: "jasmin_chatgpt_revision",
        updated_at: now,
      })
      .select()
      .single(),
    "Revision draft could not be created."
  );
}

async function updateRevisionDraft(supabase, body) {
  const id = clean(body.article?.id, 100);
  if (!id) throw new ApiError(400, "Revision article id is required.");

  const current = resultData(
    await supabase.from("knowledge_articles").select("*").eq("id", id).single(),
    "Revision draft could not be found."
  );
  if (!isOpenRevision(current)) throw new ApiError(409, "Only open revision drafts can be edited through this action.");

  const supplied = body.article && typeof body.article === "object" ? body.article : {};
  const article = cleanArticleInput({
    ...current,
    ...supplied,
    slug: current.slug,
    generation_metadata: {
      ...revisionMetadata(current),
      ...(supplied.generation_metadata && typeof supplied.generation_metadata === "object"
        ? supplied.generation_metadata
        : {}),
      revision_of: revisionSourceId(current),
      revision_state: "draft",
      created_or_updated_via: "jasmin_knowledge_revision_action",
    },
  });

  return resultData(
    await supabase
      .from("knowledge_articles")
      .update({ ...article, status: "archived", approved_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single(),
    "Revision draft could not be updated."
  );
}

async function approveRevision(supabase, body) {
  const revisionId = clean(body.article_id, 100);
  if (!revisionId) throw new ApiError(400, "Revision article id is required.");

  const revision = resultData(
    await supabase.from("knowledge_articles").select("*").eq("id", revisionId).single(),
    "Revision draft could not be found."
  );
  if (!isOpenRevision(revision)) throw new ApiError(409, "Only open revision drafts can be approved through this action.");

  const sourceId = revisionSourceId(revision);
  const source = resultData(
    await supabase.from("knowledge_articles").select("*").eq("id", sourceId).single(),
    "Source article for this revision could not be found."
  );
  if (!["approved", "exported"].includes(source.status)) {
    throw new ApiError(409, "The source article is no longer in an approvable revision state.");
  }

  const expectedUpdatedAt = clean(revisionMetadata(revision).revision_source_updated_at, 100);
  if (expectedUpdatedAt && clean(source.updated_at, 100) !== expectedUpdatedAt) {
    throw new ApiError(409, "The source article changed after this revision draft was created. Create a fresh revision draft before approving.");
  }

  const validation = validateKnowledgeArticle(revision);
  if (Object.keys(validation).length) throw new ApiError(400, Object.values(validation).join(" "));

  const now = new Date().toISOString();
  const applied = cleanArticleInput({
    ...revision,
    slug: source.slug,
    generation_metadata: {
      ...revisionMetadata(source),
      created_or_updated_via: "jasmin_knowledge_revision_action",
      last_revision_id: revision.id,
      last_revised_at: now,
    },
  });

  const updatedSource = resultData(
    await supabase
      .from("knowledge_articles")
      .update({ ...applied, status: "approved", approved_at: now, updated_at: now })
      .eq("id", source.id)
      .select()
      .single(),
    "Approved revision could not be applied to the source article."
  );

  const revisionUpdate = await supabase
    .from("knowledge_articles")
    .update({
      status: "archived",
      updated_at: now,
      generation_metadata: {
        ...revisionMetadata(revision),
        revision_state: "applied",
        revision_applied_at: now,
        revision_applied_to: source.id,
      },
    })
    .eq("id", revision.id);

  if (revisionUpdate.error) {
    console.error("JASMIN KNOWLEDGE REVISION CLEANUP WARNING", {
      revision_id: revision.id,
      source_article_id: source.id,
      message: clean(revisionUpdate.error.message, 500),
    });
  }

  return {
    article: updatedSource,
    revision_id: revision.id,
    revision_cleanup_pending: Boolean(revisionUpdate.error),
    next_step: "Use sendToWixDraft on the source article ID only after explicit user approval to create/update the Wix draft.",
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Jasmin access key not recognised." });

  let body = {};
  try {
    body = parseBody(request);
    const supabase = getSupabase();
    let data;
    switch (body.action) {
      case "createRevisionDraft":
        data = { article: await createRevisionDraft(supabase, body) };
        break;
      case "updateRevisionDraft":
        data = { article: await updateRevisionDraft(supabase, body) };
        break;
      case "approveRevision":
        data = await approveRevision(supabase, body);
        break;
      default:
        throw new ApiError(400, "Unsupported Jasmin Knowledge revision action.");
    }
    return response.status(200).json({ ok: true, action: body.action, ...data });
  } catch (error) {
    console.error("JASMIN KNOWLEDGE REVISION ACTION ERROR", {
      action: clean(body.action, 80),
      message: clean(error.message, 500),
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Jasmin Knowledge revision request failed.",
    });
  }
}
