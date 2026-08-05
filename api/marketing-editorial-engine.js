import { createClient } from "@supabase/supabase-js";
import { openAIModelConfiguration } from "../lib/openAIModelConfiguration.js";
import { buildAiPlatformPrompt } from "../lib/businessIntelligence.js";
import {
  CUSTOMER_JOURNEYS,
  EDITORIAL_CATEGORY_WEIGHTS,
  PRIMARY_PRODUCTS,
  SEARCH_INTENTS,
  applyIntentOverrides,
  articleContentHash,
  buildArticleReviewSummary,
  normalizeEditorialAnalysis,
} from "../lib/editorialIntelligence.js";
import { markdownToKnowledgeHtml } from "../lib/knowledgeHub.js";
import {
  WEBSITE_INDEX_CATEGORIES,
  isApprovedInternalUrl,
} from "../lib/internalLinking.js";
import { refreshArticleInternalLinks } from "../lib/internalLinkingService.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CATEGORY_KEYS = Object.keys(EDITORIAL_CATEGORY_WEIGHTS);
const ARTICLE_EDIT_FIELDS = new Set([
  "title",
  "seo_title",
  "meta_description",
  "excerpt",
  "content_markdown",
  "cta",
]);

const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "reason", "lost_points"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" },
    lost_points: { type: "integer", minimum: 0, maximum: 100 },
  },
};

const EDITORIAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "structured_ctas",
    "internal_links",
    "business_recommendations",
    "category_scores",
    "strengths",
    "weaknesses",
    "suggested_improvements",
    "coverage_concepts",
    "warnings",
  ],
  properties: {
    intent: {
      type: "object",
      additionalProperties: false,
      required: [
        "primary_product",
        "secondary_product",
        "customer_journey",
        "search_intent",
        "conversion_goal",
        "confidence_score",
      ],
      properties: {
        primary_product: { type: "string", enum: PRIMARY_PRODUCTS },
        secondary_product: { type: "string" },
        customer_journey: { type: "string", enum: CUSTOMER_JOURNEYS },
        search_intent: { type: "string", enum: SEARCH_INTENTS },
        conversion_goal: { type: "string" },
        confidence_score: { type: "integer", minimum: 0, maximum: 100 },
      },
    },
    structured_ctas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "button_text", "destination", "order", "reason", "confidence_score"],
        properties: {
          role: { type: "string", enum: ["primary", "secondary"] },
          button_text: { type: "string" },
          destination: { type: "string" },
          order: { type: "integer", minimum: 1, maximum: 3 },
          reason: { type: "string" },
          confidence_score: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    internal_links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["target_type", "target_id", "anchor_text", "context", "relevance_score"],
        properties: {
          target_type: { type: "string", enum: ["article", "business_page"] },
          target_id: { type: "string" },
          anchor_text: { type: "string" },
          context: { type: "string" },
          relevance_score: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    business_recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "key",
          "title",
          "suggestion",
          "brain_section_key",
          "source_excerpt",
          "target_field",
          "confidence_score",
        ],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          suggestion: { type: "string" },
          brain_section_key: { type: "string" },
          source_excerpt: { type: "string" },
          target_field: { type: "string" },
          confidence_score: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    category_scores: {
      type: "object",
      additionalProperties: false,
      required: CATEGORY_KEYS,
      properties: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, SCORE_SCHEMA])),
    },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    suggested_improvements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "description", "target_field", "expected_gain"],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          target_field: { type: "string" },
          expected_gain: { type: "integer", minimum: 0, maximum: 30 },
        },
      },
    },
    coverage_concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["concept_key", "relevance_score", "evidence"],
        properties: {
          concept_key: { type: "string" },
          relevance_score: { type: "integer", minimum: 0, maximum: 100 },
          evidence: { type: "string" },
        },
      },
    },
    warnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "message"],
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          message: { type: "string" },
        },
      },
    },
  },
};

const IMPROVEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["replacement", "explanation"],
  properties: {
    replacement: { type: "string" },
    explanation: { type: "string" },
  },
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clean = (value, max = 50000) => String(value || "").trim().slice(0, max);
const cleanList = (value, limit = 50) =>
  (Array.isArray(value) ? value : [])
    .map((item) => clean(item, 200))
    .filter(Boolean)
    .slice(0, limit);

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers[API_KEY_HEADER] || "";
  const authorization = request.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
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

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function data(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

function aiConfiguration() {
  return {
    configured: Boolean(clean(process.env.OPENAI_API_KEY, 10000)),
    model: openAIModelConfiguration(process.env).default_model,
  };
}

function shortFingerprint(value) {
  let hash = 2166136261;
  const input = clean(value, 5000);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function deriveBusinessBrainPages(sections = [], persistedPages = []) {
  const pages = [...persistedPages];
  const urls = new Set(pages.map((page) => page.url));
  sections.forEach((section) => {
    const candidates = [
      ...(section.entries || []).flatMap((entry) =>
        (clean(entry.value).match(/https?:\/\/[^\s),]+/g) || []).map((url) => ({
          url,
          title: clean(entry.label, 300) || url,
        }))
      ),
      ...(clean(section.content).match(/https?:\/\/[^\s),]+/g) || []).map((url) => ({
        url,
        title: url,
      })),
    ];
    candidates.forEach(({ url, title }) => {
      if (urls.has(url)) return;
      urls.add(url);
      const descriptor = `${title} ${url}`;
      pages.push({
        id: null,
        page_key: `brain_${shortFingerprint(url)}`,
        title,
        url,
        product: /rent\s?2\s?buy|rent-to-buy/i.test(descriptor)
          ? "rent2buy"
          : /finance/i.test(descriptor)
            ? "finance"
            : "both",
        page_type: "business_brain_page",
        active: true,
        source: "business_brain",
      });
    });
  });
  return pages;
}

async function callStructuredAi({ input, schema, schemaName, systemInstruction }) {
  const configuration = aiConfiguration();
  if (!configuration.configured) {
    throw new ApiError(500, "OPENAI_API_KEY is not available to this deployment.");
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clean(process.env.OPENAI_API_KEY, 10000)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: configuration.model,
      input: [
        { role: "system", content: systemInstruction },
        { role: "user", content: input },
      ],
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    console.error("EDITORIAL AI HTTP ERROR", {
      status: response.status,
      code: result?.error?.code,
      message: result?.error?.message,
    });
    throw new ApiError(502, "The AI editorial service could not complete this request.");
  }
  if (result.status === "incomplete") throw new ApiError(502, "The AI editorial response was incomplete.");
  const refusal = result.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "refusal")?.refusal;
  if (refusal) throw new ApiError(502, "The AI editorial service could not complete this request.");
  const output =
    result.output_text ||
    result.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new ApiError(502, "The AI returned no structured editorial response.");
  return output;
}

async function loadEditorialContext(supabase, articleId = "") {
  const queries = [
    supabase.from("knowledge_articles").select("*").neq("status", "archived").order("updated_at", { ascending: false }),
    supabase.from("knowledge_topics").select("*").order("updated_at", { ascending: false }),
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
    supabase.from("knowledge_business_sections").select("*").eq("active", true).order("sort_order"),
    supabase
      .from("knowledge_business_pages")
      .select("*")
      .eq("active", true)
      .eq("approval_status", "approved")
      .eq("verified", true)
      .order("title"),
    supabase.from("knowledge_concepts").select("*").eq("active", true).order("label"),
  ];
  if (articleId) queries.push(supabase.from("knowledge_article_intents").select("*").eq("article_id", articleId).maybeSingle());
  const results = await Promise.all(queries);
  results.forEach((result) => data(result, "Editorial context could not be loaded."));
  return {
    articles: results[0].data || [],
    topics: results[1].data || [],
    settings: results[2].data || {},
    brainSections: results[3].data || [],
    businessPages: deriveBusinessBrainPages(results[3].data || [], results[4].data || []),
    websiteIndex: results[4].data || [],
    concepts: results[5].data || [],
    intent: articleId ? results[6].data : null,
  };
}

async function loadEditorial(supabase) {
  const contextPromise = loadEditorialContext(supabase);
  const results = await Promise.all([
    supabase.from("knowledge_article_intents").select("*"),
    supabase
      .from("knowledge_article_editorial_assessments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1500),
    supabase.from("knowledge_article_editorial_overrides").select("*"),
    supabase.from("knowledge_article_concepts").select("*"),
    supabase
      .from("knowledge_article_revisions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1500),
    supabase
      .from("knowledge_article_improvement_proposals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("knowledge_editorial_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("knowledge_internal_link_suggestions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1500),
    supabase
      .from("knowledge_internal_link_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1500),
  ]);
  results.forEach((result) => data(result, "Editorial intelligence could not be loaded."));
  const context = await contextPromise;
  const intents = results[0].data || [];
  const assessments = results[1].data || [];
  const events = results[6].data || [];
  const byArticle = new Map(intents.map((intent) => [intent.article_id, intent]));
  const latestAssessment = new Map();
  assessments.forEach((assessment) => {
    if (!latestAssessment.has(assessment.article_id)) {
      latestAssessment.set(assessment.article_id, assessment);
    }
  });
  const latestBrainUpdate = events.find((event) => event.event_type === "business_brain_update");
  return {
    intents,
    assessments,
    overrides: results[2].data || [],
    article_concepts: results[3].data || [],
    revisions: results[4].data || [],
    proposals: results[5].data || [],
    events,
    business_pages: context.businessPages,
    website_index: context.websiteIndex,
    link_suggestions: results[7].data || [],
    link_events: results[8].data || [],
    concepts: context.concepts,
    stale_article_ids: context.articles
      .filter(
        (article) =>
          byArticle.get(article.id)?.source_content_hash !== articleContentHash(article) ||
          (
            latestBrainUpdate &&
            new Date(latestBrainUpdate.created_at) >
              new Date(latestAssessment.get(article.id)?.created_at || 0)
          )
      )
      .map((article) => article.id),
    ai_configuration: aiConfiguration(),
  };
}

function allowedCtaDestinations(context) {
  const preferred = context.brainSections.find(
    (section) => section.section_key === "preferred_ctas"
  );
  return [
    context.settings.website_url,
    ...context.businessPages.map((page) => page.url),
    ...(preferred?.entries || []).flatMap((entry) => [entry.label, entry.value]),
    ...context.brainSections.flatMap((section) =>
      clean(`${section.content || ""} ${(section.entries || []).map((entry) => `${entry.label} ${entry.value}`).join(" ")}`)
        .match(/https?:\/\/[^\s),]+/g) || []
    ),
  ].map((value) => clean(value, 1000)).filter(Boolean);
}

function editorialPrompt({ article, context }) {
  const topic = context.topics.find((candidate) => candidate.id === article.topic_id) || {};
  const indexedArticleIds = new Set(
    context.websiteIndex
      .filter((page) => page.knowledge_article_id)
      .map((page) => page.knowledge_article_id)
  );
  const assembled = buildAiPlatformPrompt({
    sections: context.brainSections,
    settings: context.settings,
    topic,
    task: "article_review",
    module: "knowledge_hub_editorial_engine",
    requestedTask:
      "Classify and assess this article, recommend supported CTAs and natural contextual links, map business coverage, and explain its publication readiness. Do not rewrite or approve it.",
    sourceContent: JSON.stringify({
      article,
      allowed_article_targets: context.articles
        .filter(
          (candidate) =>
            candidate.id !== article.id &&
            candidate.status === "approved" &&
            indexedArticleIds.has(candidate.id)
        )
        .map(({ id, title, category, article_type }) => ({ id, title, category, article_type })),
      allowed_business_pages: context.websiteIndex.map(({ page_key, title, url, product, page_type, category, keywords, vehicle_types, customer_intent, priority, description }) => ({
        page_key,
        title,
        url,
        product,
        page_type,
        category,
        keywords,
        vehicle_types,
        customer_intent,
        priority,
        description,
      })),
      allowed_cta_destinations: allowedCtaDestinations(context),
      coverage_concepts: context.concepts.map(({ concept_key, label, aliases, primary_product }) => ({
        concept_key,
        label,
        aliases,
        primary_product,
      })),
    }),
  });
  return {
    prompt: `${assembled.prompt}

Return one strict editorial assessment. Every business recommendation must cite an exact short
source_excerpt found verbatim in its Business Brain section. Never invent company facts. Recommend
at most three CTAs and six natural links. Use only the supplied article IDs and business page keys.
Scores must reflect the supplied draft, not hypothetical improvements. A critical unsupported
business, regulatory, or compliance claim must be a critical warning.`,
    metadata: assembled.metadata,
  };
}

async function nextRevisionNumber(supabase, articleId) {
  const latest = data(
    await supabase
      .from("knowledge_article_revisions")
      .select("revision_number")
      .eq("article_id", articleId)
      .order("revision_number", { ascending: false })
      .limit(1),
    "Revision history could not be checked."
  );
  return Number(latest?.[0]?.revision_number || 0) + 1;
}

async function recordRevision(supabase, {
  article,
  assessment = {},
  changeSource = "user_edit",
  changeSummary = "",
  createdBy = null,
}) {
  const revision = data(
    await supabase
      .from("knowledge_article_revisions")
      .insert({
        article_id: article.id,
        revision_number: await nextRevisionNumber(supabase, article.id),
        change_source: changeSource,
        change_summary: clean(changeSummary, 2000),
        article_snapshot: article,
        editorial_snapshot: assessment || {},
        created_by: createdBy || null,
      })
      .select()
      .single(),
    "Editorial history could not be saved."
  );
  return revision;
}

export async function analyseArticle(supabase, body) {
  const articleId = clean(body.article_id, 100);
  if (!articleId) throw new ApiError(400, "Article id is required.");
  const context = await loadEditorialContext(supabase, articleId);
  const article = context.articles.find((candidate) => candidate.id === articleId);
  if (!article) throw new ApiError(404, "Article could not be found.");
  const prompt = editorialPrompt({ article, context });
  const indexedArticleIds = new Set(
    context.websiteIndex
      .filter((page) => page.knowledge_article_id)
      .map((page) => page.knowledge_article_id)
  );
  const parsed = normalizeEditorialAnalysis(
    await callStructuredAi({
      input: prompt.prompt,
      schema: EDITORIAL_SCHEMA,
      schemaName: "knowledge_editorial_assessment",
      systemInstruction:
        "You are a careful UK van-finance editorial director. Use supplied business knowledge as the only source of business facts and follow the JSON schema exactly.",
    }),
    {
      articles: context.articles.filter(
        (candidate) =>
          candidate.id !== article.id &&
          candidate.status === "approved" &&
          indexedArticleIds.has(candidate.id)
      ),
      businessPages: context.websiteIndex,
      concepts: context.concepts,
      brainSections: context.brainSections,
      allowedCtaDestinations: allowedCtaDestinations(context),
    }
  );
  const sourceHash = articleContentHash(article);
  const manualOverrides = context.intent?.manual_overrides || {};
  const effectiveIntent = applyIntentOverrides(parsed.intent, manualOverrides);
  const now = new Date().toISOString();
  const intent = data(
    await supabase
      .from("knowledge_article_intents")
      .upsert({
        article_id: article.id,
        ...effectiveIntent,
        manual_overrides: manualOverrides,
        source_content_hash: sourceHash,
        model: aiConfiguration().model,
        prompt_metadata: prompt.metadata,
        analysed_at: now,
        updated_at: now,
      })
      .select()
      .single(),
    "Business intent could not be saved."
  );
  const assessmentPayload = {
    article_id: article.id,
    source_content_hash: sourceHash,
    effective_intent: effectiveIntent,
    structured_ctas: parsed.structured_ctas,
    internal_links: parsed.internal_links,
    business_recommendations: parsed.business_recommendations,
    category_scores: parsed.category_scores,
    overall_score: parsed.overall_score,
    grade: parsed.grade,
    confidence: parsed.confidence,
    publication_status: parsed.publication_status,
    strengths: parsed.strengths,
    weaknesses: parsed.weaknesses,
    lost_points: parsed.lost_points,
    suggested_improvements: parsed.suggested_improvements,
    review_summary: buildArticleReviewSummary(article, parsed),
    coverage_concepts: parsed.coverage_concepts,
    warnings: parsed.warnings,
    model: aiConfiguration().model,
    prompt_metadata: prompt.metadata,
  };
  const assessment = data(
    await supabase
      .from("knowledge_article_editorial_assessments")
      .insert(assessmentPayload)
      .select()
      .single(),
    "Editorial assessment could not be saved."
  );
  const linkSuggestions = await refreshArticleInternalLinks(supabase, article.id, {
    assessmentId: assessment.id,
    reason: "Editorial assessment refreshed the approved internal-link matches.",
  });
  const conceptByKey = new Map(context.concepts.map((concept) => [concept.concept_key, concept]));
  const conceptRows = parsed.coverage_concepts
    .map((mapping) => ({
      article_id: article.id,
      concept_id: conceptByKey.get(mapping.concept_key)?.id,
      assessment_id: assessment.id,
      relevance_score: mapping.relevance_score,
      evidence: mapping.evidence,
      source: "ai",
      updated_at: now,
    }))
    .filter((mapping) => mapping.concept_id);
  if (conceptRows.length) {
    data(
      await supabase
        .from("knowledge_article_concepts")
        .upsert(conceptRows, { onConflict: "article_id,concept_id" }),
      "Knowledge coverage could not be saved."
    );
  }
  const revision = await recordRevision(supabase, {
    article,
    assessment,
    changeSource: "score_recalculation",
    changeSummary: `Editorial score recalculated: ${assessment.overall_score}/100.`,
  });
  return { intent, assessment, article_concepts: conceptRows, revision, link_suggestions: linkSuggestions };
}

async function saveIntentOverrides(supabase, body) {
  const articleId = clean(body.article_id, 100);
  const existing = data(
    await supabase.from("knowledge_article_intents").select("*").eq("article_id", articleId).single(),
    "Analyse the article before overriding its intent."
  );
  const overrides = body.overrides && typeof body.overrides === "object" ? body.overrides : {};
  const effective = applyIntentOverrides(existing, overrides);
  const intent = data(
    await supabase
      .from("knowledge_article_intents")
      .update({
        ...effective,
        manual_overrides: overrides,
        updated_at: new Date().toISOString(),
      })
      .eq("article_id", articleId)
      .select()
      .single(),
    "Business intent overrides could not be saved."
  );
  return intent;
}

async function saveEditorialOverrides(supabase, body) {
  const articleId = clean(body.article_id, 100);
  const payload = body.overrides && typeof body.overrides === "object" ? body.overrides : {};
  const assessment = data(
    await supabase
      .from("knowledge_article_editorial_assessments")
      .select("structured_ctas,internal_links")
      .eq("article_id", articleId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    "Analyse the article before overriding recommendations."
  );
  const approvedIndexPages = data(
    await supabase
      .from("knowledge_business_pages")
      .select("page_key,knowledge_article_id")
      .eq("active", true)
      .eq("approval_status", "approved")
      .eq("verified", true),
    "Approved Website Index destinations could not be checked."
  ) || [];
  const indexedArticleIds = approvedIndexPages
    .map((page) => page.knowledge_article_id)
    .filter(Boolean);
  const normalized = normalizeEditorialAnalysis(
    {
      intent: {
        primary_product: "both",
        secondary_product: "",
        customer_journey: "research",
        search_intent: "informational",
        conversion_goal: "",
        confidence_score: 0,
      },
      structured_ctas: payload.structured_ctas ?? assessment.structured_ctas,
      internal_links: payload.internal_links ?? assessment.internal_links,
      category_scores: {},
      business_recommendations: [],
      strengths: [],
      weaknesses: [],
      suggested_improvements: [],
      coverage_concepts: [],
      warnings: [],
    },
    {
      articles: data(
        await supabase
          .from("knowledge_articles")
          .select("id")
          .eq("status", "approved")
          .in(
            "id",
            indexedArticleIds.length
              ? indexedArticleIds
              : ["00000000-0000-0000-0000-000000000000"]
          ),
        "Articles could not be checked."
      ),
      businessPages: approvedIndexPages,
    }
  );
  return data(
    await supabase
      .from("knowledge_article_editorial_overrides")
      .upsert({
        article_id: articleId,
        structured_ctas: normalized.structured_ctas,
        internal_links: normalized.internal_links,
        dismissed_recommendations: Array.isArray(payload.dismissed_recommendations)
          ? payload.dismissed_recommendations.map((item) => clean(item, 100)).filter(Boolean)
          : [],
        updated_at: new Date().toISOString(),
      })
      .select()
      .single(),
    "Editorial overrides could not be saved."
  );
}

export async function proposeImprovement(supabase, body) {
  const articleId = clean(body.article_id, 100);
  const recommendationKey = clean(body.recommendation_key, 200);
  const [articleResult, assessmentResult, brainResult, settingsResult] = await Promise.all([
    supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    supabase
      .from("knowledge_article_editorial_assessments")
      .select("*")
      .eq("article_id", articleId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    supabase.from("knowledge_business_sections").select("*").eq("active", true).order("sort_order"),
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
  ]);
  const article = data(articleResult, "Article could not be found.");
  const assessment = data(assessmentResult, "Editorial assessment could not be found.");
  const brainSections = data(brainResult, "Business Brain could not be loaded.") || [];
  const settings = data(settingsResult, "Business settings could not be loaded.") || {};
  const recommendation = [...(assessment.suggested_improvements || []), ...(assessment.business_recommendations || [])]
    .find((item) => item.key === recommendationKey);
  if (!recommendation) throw new ApiError(404, "Editorial recommendation could not be found.");
  const targetField = ARTICLE_EDIT_FIELDS.has(recommendation.target_field)
    ? recommendation.target_field
    : "content_markdown";
  const assembled = buildAiPlatformPrompt({
    sections: brainSections,
    settings,
    task: "article_review",
    module: "knowledge_hub_editorial_improvement",
    requestedTask:
      "Prepare one review-only improvement proposal for the specified article field. Do not change or approve the saved article.",
    sourceContent: JSON.stringify({
      article,
      target_field: targetField,
      recommendation,
      current_value: article[targetField] || "",
    }),
  });
  const proposed = JSON.parse(
    await callStructuredAi({
      input: `${assembled.prompt}

Return a complete replacement value for only the requested field. Preserve accurate useful content.
Do not invent business claims. This is a proposal for manual review and must not be applied.`,
      schema: IMPROVEMENT_SCHEMA,
      schemaName: "knowledge_editorial_improvement",
      systemInstruction:
        "You are a careful UK van-finance editor preparing a review-only change. Follow the JSON schema exactly.",
    })
  );
  const proposal = data(
    await supabase
      .from("knowledge_article_improvement_proposals")
      .insert({
        article_id: article.id,
        assessment_id: assessment.id,
        recommendation_key: recommendation.key,
        title: recommendation.title,
        description: clean(proposed.explanation, 5000) || recommendation.description || recommendation.suggestion,
        target_field: targetField,
        proposed_changes: { [targetField]: clean(proposed.replacement, 50000) },
        status: "review",
        model: aiConfiguration().model,
        prompt_metadata: assembled.metadata,
      })
      .select()
      .single(),
    "Improvement proposal could not be saved."
  );
  return proposal;
}

export async function applyImprovement(supabase, body) {
  const proposalId = clean(body.proposal_id, 100);
  const proposal = data(
    await supabase
      .from("knowledge_article_improvement_proposals")
      .select("*")
      .eq("id", proposalId)
      .single(),
    "Improvement proposal could not be found."
  );
  if (proposal.status !== "review") throw new ApiError(400, "This proposal has already been decided.");
  const article = data(
    await supabase.from("knowledge_articles").select("*").eq("id", proposal.article_id).single(),
    "Article could not be found."
  );
  const field = proposal.target_field;
  if (!ARTICLE_EDIT_FIELDS.has(field)) throw new ApiError(400, "The proposal targets an unsupported field.");
  const replacement = clean(proposal.proposed_changes?.[field], 50000);
  if (!replacement) throw new ApiError(400, "The proposal does not contain a replacement.");
  const updated = data(
    await supabase
      .from("knowledge_articles")
      .update({
        [field]: replacement,
        ...(field === "content_markdown" ? { content_html: markdownToKnowledgeHtml(replacement) } : {}),
        status: "draft",
        approved_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", article.id)
      .select()
      .single(),
    "The approved improvement could not be applied."
  );
  const decided = data(
    await supabase
      .from("knowledge_article_improvement_proposals")
      .update({ status: "applied", applied_at: new Date().toISOString() })
      .eq("id", proposal.id)
      .select()
      .single(),
    "The proposal decision could not be saved."
  );
  const revision = await recordRevision(supabase, {
    article: updated,
    changeSource: "ai_improvement",
    changeSummary: `Applied reviewed AI proposal: ${proposal.title}.`,
  });
  return { article: updated, proposal: decided, revision };
}

async function rejectImprovement(supabase, body) {
  return data(
    await supabase
      .from("knowledge_article_improvement_proposals")
      .update({ status: "rejected", rejected_at: new Date().toISOString() })
      .eq("id", clean(body.proposal_id, 100))
      .eq("status", "review")
      .select()
      .single(),
    "The proposal decision could not be saved."
  );
}

async function recordArticleRevision(supabase, body) {
  const article = data(
    await supabase.from("knowledge_articles").select("*").eq("id", clean(body.article_id, 100)).single(),
    "Article could not be found."
  );
  const source = ["user_edit", "approval", "archive"].includes(body.change_source)
    ? body.change_source
    : "user_edit";
  return recordRevision(supabase, {
    article,
    changeSource: source,
    changeSummary: clean(body.change_summary, 2000),
  });
}

async function recordBusinessBrainUpdate(supabase, body) {
  const sectionKey = clean(body.section_key, 100);
  if (!sectionKey) throw new ApiError(400, "Business Brain section key is required.");
  return data(
    await supabase
      .from("knowledge_editorial_events")
      .insert({
        event_type: "business_brain_update",
        section_key: sectionKey,
        summary: clean(body.summary, 2000) || `${sectionKey.replaceAll("_", " ")} updated.`,
        details: { editorial_assessments_stale: true },
      })
      .select()
      .single(),
    "Business Brain editorial history could not be saved."
  );
}

async function saveWebsiteIndexEntry(supabase, body) {
  const entry = body.entry && typeof body.entry === "object" ? body.entry : {};
  const entryId = clean(entry.id, 100);
  const title = clean(entry.title, 300);
  const url = clean(entry.url, 2000);
  const category = WEBSITE_INDEX_CATEGORIES.includes(entry.category)
    ? entry.category
    : "Products";
  const settings = data(
    await supabase
      .from("knowledge_settings")
      .select("website_url")
      .eq("settings_key", "default")
      .maybeSingle(),
    "Website settings could not be loaded."
  ) || {};
  if (!title) throw new ApiError(400, "Website Index title is required.");
  if (!isApprovedInternalUrl(url, settings.website_url || "")) {
    throw new ApiError(
      400,
      "Website Index URL must be a relative internal path or use the configured website domain."
    );
  }
  const duplicateQuery = supabase
    .from("knowledge_business_pages")
    .select("id,title")
    .ilike("url", url);
  const duplicates = data(
    entryId ? await duplicateQuery.neq("id", entryId) : await duplicateQuery,
    "Website Index duplicates could not be checked."
  ) || [];
  if (duplicates.length) {
    throw new ApiError(409, `This destination is already indexed as "${duplicates[0].title}".`);
  }
  const knowledgeArticleId = clean(entry.knowledge_article_id, 100) || null;
  if (knowledgeArticleId) {
    const linkedArticle = data(
      await supabase
        .from("knowledge_articles")
        .select("id,status")
        .eq("id", knowledgeArticleId)
        .single(),
      "Linked Knowledge Hub article could not be found."
    );
    if (linkedArticle.status !== "approved") {
      throw new ApiError(400, "Only approved Knowledge Hub articles can be indexed.");
    }
  }
  const existing = entryId
    ? data(
        await supabase
          .from("knowledge_business_pages")
          .select("*")
          .eq("id", entryId)
          .single(),
        "Website Index entry could not be found."
      )
    : null;
  const payload = {
    page_key: existing?.page_key || `website_${shortFingerprint(url)}`,
    title,
    url,
    category,
    keywords: cleanList(entry.keywords),
    vehicle_types: cleanList(entry.vehicle_types),
    customer_intent: cleanList(entry.customer_intent),
    priority: Math.max(1, Math.min(5, Number(entry.priority) || 3)),
    description: clean(entry.description, 5000),
    knowledge_article_id: knowledgeArticleId,
    product: ["finance", "rent2buy", "both", "general"].includes(entry.product)
      ? entry.product
      : "general",
    page_type: "website_index",
    active: entry.status !== "Hidden" && entry.active !== false,
    source: existing?.source || "manual",
    external_id: existing?.external_id || null,
    sync_metadata: existing?.sync_metadata || {},
    last_synced_at: existing?.last_synced_at || null,
    approval_status: entry.status === "Hidden" || entry.active === false ? "hidden" : "approved",
    verified: entry.status !== "Hidden" && entry.active !== false,
    verification_source: existing?.verification_source || "manual",
    verified_at:
      entry.status !== "Hidden" && entry.active !== false
        ? existing?.verified_at || new Date().toISOString()
        : existing?.verified_at || null,
    monitor_in_ai_visibility_when_published:
      entry.monitor_in_ai_visibility_when_published !== false,
    updated_at: new Date().toISOString(),
  };
  const saved = data(
    entryId
      ? await supabase
          .from("knowledge_business_pages")
          .update(payload)
          .eq("id", entryId)
          .select()
          .single()
      : await supabase
          .from("knowledge_business_pages")
          .insert(payload)
          .select()
          .single(),
    "Website Index entry could not be saved."
  );
  data(
    await supabase.from("knowledge_internal_link_events").insert({
      website_page_id: saved.id,
      article_id: saved.knowledge_article_id,
      action: saved.active ? "index_saved" : "index_hidden",
      reason: "Website Index entry updated after editorial review.",
      details: {
        category: saved.category,
        url: saved.url,
        source: saved.source,
        wix_sync_ready: true,
        verified: saved.verified,
        monitor_in_ai_visibility_when_published:
          saved.monitor_in_ai_visibility_when_published,
      },
    }),
    "Website Index audit history could not be saved."
  );
  return saved;
}

async function decideInternalLink(supabase, body) {
  const suggestionId = clean(body.suggestion_id, 100);
  const decision = clean(body.decision, 40);
  const suggestion = data(
    await supabase
      .from("knowledge_internal_link_suggestions")
      .select("*")
      .eq("id", suggestionId)
      .single(),
    "Internal-link suggestion could not be found."
  );
  if (decision === "edit_anchor") {
    if (!["pending", "accepted"].includes(suggestion.status)) {
      throw new ApiError(400, "This internal-link suggestion can no longer be edited.");
    }
  } else if (!["accept", "reject"].includes(decision) || suggestion.status !== "pending") {
    throw new ApiError(400, "Only pending internal-link suggestions can be accepted or rejected.");
  }
  const anchorText = clean(body.anchor_text, 100);
  if (anchorText.length < 2) throw new ApiError(400, "Anchor text must contain at least two characters.");
  const now = new Date().toISOString();
  const status =
    decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : suggestion.status;
  const updated = data(
    await supabase
      .from("knowledge_internal_link_suggestions")
      .update({
        anchor_text: anchorText,
        status,
        decided_at: ["accepted", "rejected"].includes(status) ? now : suggestion.decided_at,
        updated_at: now,
      })
      .eq("id", suggestion.id)
      .select()
      .single(),
    "Internal-link decision could not be saved."
  );
  const action =
    decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "anchor_edited";
  data(
    await supabase.from("knowledge_internal_link_events").insert({
      suggestion_id: suggestion.id,
      article_id: suggestion.article_id,
      website_page_id: suggestion.website_page_id,
      action,
      reason: clean(body.reason, 1000) || `User ${action.replace("_", " ")} the suggestion.`,
      details: {
        previous_anchor_text: suggestion.anchor_text,
        anchor_text: anchorText,
        destination_url: suggestion.destination_url,
        automatic_insertion: false,
      },
    }),
    "Internal-link audit history could not be saved."
  );
  return updated;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  try {
    const body = parseBody(request);
    const supabase = getSupabase();
    let result;
    switch (body.action) {
      case "load":
        result = await loadEditorial(supabase);
        break;
      case "analyseArticle":
        result = await analyseArticle(supabase, body);
        break;
      case "saveIntentOverrides":
        result = { intent: await saveIntentOverrides(supabase, body) };
        break;
      case "saveEditorialOverrides":
        result = { overrides: await saveEditorialOverrides(supabase, body) };
        break;
      case "proposeImprovement":
        result = { proposal: await proposeImprovement(supabase, body) };
        break;
      case "applyImprovement":
        result = await applyImprovement(supabase, body);
        break;
      case "rejectImprovement":
        result = { proposal: await rejectImprovement(supabase, body) };
        break;
      case "recordRevision":
        result = { revision: await recordArticleRevision(supabase, body) };
        break;
      case "recordBusinessBrainUpdate":
        result = { event: await recordBusinessBrainUpdate(supabase, body) };
        break;
      case "saveWebsiteIndexEntry":
        result = { entry: await saveWebsiteIndexEntry(supabase, body) };
        break;
      case "refreshInternalLinks":
        result = {
          suggestions: await refreshArticleInternalLinks(
            supabase,
            clean(body.article_id, 100),
            { reason: "User requested a fresh approved-destination match." }
          ),
        };
        break;
      case "decideInternalLink":
        result = { suggestion: await decideInternalLink(supabase, body) };
        break;
      default:
        throw new ApiError(400, "Unsupported Editorial Engine action.");
    }
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("EDITORIAL ENGINE ERROR", {
      action: parseBody(request).action || "",
      message: error.message,
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Editorial Engine request failed.",
    });
  }
}
