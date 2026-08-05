import { createClient } from "@supabase/supabase-js";
import { openAIModelConfiguration } from "../lib/openAIModelConfiguration.js";
import {
  AI_CONTENT_CHANNELS,
  AI_REVIEW_CATEGORY_KEYS,
  normalizeAiReview,
  parseAiContentAsset,
  parseWebsiteIntelligence,
} from "../lib/aiMarketingPlatform.js";
import { buildAiPlatformPrompt } from "../lib/businessIntelligence.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CHANNEL_KEYS = new Set(AI_CONTENT_CHANNELS.map((channel) => channel.key));
const WEBSITE_SECTION_KEYS = new Set([
  "company",
  "products",
  "faqs",
  "services",
  "tone",
  "vocabulary",
  "personas",
  "ctas",
]);

const ASSET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "body", "preview_text", "cta", "warnings"],
  properties: {
    title: { type: "string" },
    body: { type: "string" },
    preview_text: { type: "string" },
    cta: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
};

const WEBSITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["company", "products", "faqs", "services", "tone", "vocabulary", "personas", "ctas"],
  properties: Object.fromEntries(
    ["company", "products", "faqs", "services", "tone", "vocabulary", "personas", "ctas"].map(
      (key) => [key, { type: "array", items: { type: "string" } }]
    )
  ),
};

const REVIEW_CATEGORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "reason"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" },
  },
};

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overall_score", "summary", "categories", "recommendations", "warnings"],
  properties: {
    overall_score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    categories: {
      type: "object",
      additionalProperties: false,
      required: AI_REVIEW_CATEGORY_KEYS,
      properties: Object.fromEntries(
        AI_REVIEW_CATEGORY_KEYS.map((key) => [key, REVIEW_CATEGORY_SCHEMA])
      ),
    },
    recommendations: { type: "array", items: { type: "string" } },
    warnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "message"],
        properties: {
          category: { type: "string", enum: AI_REVIEW_CATEGORY_KEYS },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          message: { type: "string" },
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

function clean(value, max = 50000) {
  return String(value || "").trim().slice(0, max);
}

function cleanArray(values, limit = 100) {
  return Array.isArray(values) ? values.map((value) => clean(value, 5000)).filter(Boolean).slice(0, limit) : [];
}

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

function assertResult(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

function aiConfiguration(environment = process.env) {
  return {
    configured: Boolean(clean(environment.OPENAI_API_KEY, 10000)),
    model: openAIModelConfiguration(environment).default_model,
    environment: clean(environment.VERCEL_ENV, 50) || "local",
  };
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
    console.error("AI MARKETING PLATFORM HTTP ERROR", {
      status: response.status,
      code: result?.error?.code,
      message: result?.error?.message,
    });
    throw new ApiError(502, "The AI service could not complete this request.");
  }
  if (result.status === "incomplete") throw new ApiError(502, "The AI response was incomplete.");
  const refusal = result.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "refusal")?.refusal;
  if (refusal) throw new ApiError(502, "The AI could not complete this request.");
  const output =
    result.output_text ||
    result.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new ApiError(502, "The AI returned no structured response.");
  return output;
}

async function loadBrain(supabase) {
  const [settingsResult, sectionsResult] = await Promise.all([
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
    supabase.from("knowledge_business_sections").select("*").eq("active", true).order("sort_order"),
  ]);
  return {
    settings: assertResult(settingsResult, "Business settings could not be loaded.") || {},
    sections: assertResult(sectionsResult, "Business Brain could not be loaded.") || [],
  };
}

function contentFingerprint(asset) {
  const input = `${asset.title || ""}\n${asset.body || ""}\n${asset.preview_text || ""}\n${asset.cta || ""}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function loadPlatform(supabase) {
  const [articlesResult, assetsResult, sectionsResult, settingsResult, importsResult, reviewsResult] =
    await Promise.all([
      supabase
        .from("knowledge_articles")
        .select("*")
        .neq("status", "archived")
        .order("updated_at", { ascending: false }),
      supabase
        .from("marketing_ai_assets")
        .select("*")
        .order("updated_at", { ascending: false }),
      supabase.from("knowledge_business_sections").select("*").order("sort_order"),
      supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
      supabase
        .from("knowledge_website_imports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("marketing_ai_reviews")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
  return {
    articles: assertResult(articlesResult, "Articles could not be loaded.") || [],
    assets: assertResult(assetsResult, "Content assets could not be loaded.") || [],
    business_sections: assertResult(sectionsResult, "Business Brain could not be loaded.") || [],
    settings: assertResult(settingsResult, "Business settings could not be loaded.") || {},
    website_imports: assertResult(importsResult, "Website imports could not be loaded.") || [],
    reviews: assertResult(reviewsResult, "AI reviews could not be loaded.") || [],
    ai_configuration: aiConfiguration(),
  };
}

async function generateAsset(supabase, body) {
  const articleId = clean(body.article_id, 100);
  const channel = clean(body.channel, 80);
  if (!articleId || !CHANNEL_KEYS.has(channel)) throw new ApiError(400, "Article and channel are required.");
  const article = assertResult(
    await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    "Source article could not be found."
  );
  if (article.status !== "approved") {
    throw new ApiError(400, "Content Factory only accepts approved Knowledge Articles.");
  }
  const assetId = clean(body.asset_id, 100);
  if (!assetId) {
    const duplicate = assertResult(
      await supabase
        .from("marketing_ai_assets")
        .select("id,title,status")
        .eq("source_article_id", article.id)
        .eq("channel", channel)
        .neq("status", "archived")
        .limit(1),
      "Existing channel coverage could not be checked."
    );
    if (duplicate?.length) {
      throw new ApiError(
        409,
        `This article already has an active ${channel} asset: "${duplicate[0].title}". Open it to edit or regenerate.`
      );
    }
  }
  const brain = await loadBrain(supabase);
  const channelDefinition = AI_CONTENT_CHANNELS.find((item) => item.key === channel);
  const assembled = buildAiPlatformPrompt({
    sections: brain.sections,
    settings: brain.settings,
    specialist: { key: `content-factory-${channel}`, prompt: channelDefinition.guidance },
    topic: { title: article.title, category: article.category },
    generation: {
      targetAudience: article.generation_metadata?.target_audience,
      tone: article.generation_metadata?.tone,
    },
    task: "content_asset_generation",
    module: "content_factory",
    requestedTask: `Create one ${channelDefinition.label} draft asset. Generate only this channel.`,
    sourceContent: `Title: ${article.title}
Excerpt: ${article.excerpt || ""}
Article:
${article.content_markdown || ""}

Article CTA: ${article.cta || ""}`,
  });
  const generated = parseAiContentAsset(
    await callStructuredAi({
      input: `${assembled.prompt}

Everything is a draft for manual editing and approval. Do not claim it has been published, posted,
emailed or sent. Return the structured asset only.`,
      schema: ASSET_SCHEMA,
      schemaName: "marketing_content_asset",
      systemInstruction:
        "You create one draft marketing asset from an approved source article. Follow the supplied Business Brain and JSON schema exactly.",
    })
  );
  const payload = {
    source_article_id: article.id,
    channel,
    ...generated,
    status: "draft",
    approved_at: null,
    archived_at: null,
    updated_at: new Date().toISOString(),
    generation_metadata: {
      prompt: assembled.metadata,
      model: aiConfiguration().model,
      generated_at: new Date().toISOString(),
      source_article_updated_at: article.updated_at,
    },
  };
  if (assetId) {
    const existing = assertResult(
      await supabase.from("marketing_ai_assets").select("id,status,source_article_id,channel").eq("id", assetId).single(),
      "Content asset could not be found."
    );
    if (existing.status !== "draft") throw new ApiError(400, "Only draft assets can be regenerated.");
    if (existing.source_article_id !== article.id || existing.channel !== channel) {
      throw new ApiError(400, "The regeneration source does not match this asset.");
    }
    return assertResult(
      await supabase.from("marketing_ai_assets").update(payload).eq("id", assetId).select().single(),
      "Content asset could not be regenerated."
    );
  }
  return assertResult(
    await supabase.from("marketing_ai_assets").insert(payload).select().single(),
    "Content asset could not be saved."
  );
}

async function saveAsset(supabase, body) {
  const asset = body.asset || {};
  const id = clean(asset.id, 100);
  const status = clean(body.status || asset.status, 30);
  if (!id) throw new ApiError(400, "Content asset id is required.");
  if (!["draft", "approved", "archived"].includes(status)) {
    throw new ApiError(400, "Unsupported content asset status.");
  }
  const existing = assertResult(
    await supabase.from("marketing_ai_assets").select("*").eq("id", id).single(),
    "Content asset could not be found."
  );
  if (existing.status === "archived") throw new ApiError(400, "Archived assets are read only.");
  const payload = {
    title: clean(asset.title, 500),
    body: clean(asset.body, 50000),
    preview_text: clean(asset.preview_text, 1000),
    cta: clean(asset.cta, 2000),
    warnings: cleanArray(asset.warnings),
    status,
    updated_at: new Date().toISOString(),
    approved_at: status === "approved" ? new Date().toISOString() : null,
    archived_at: status === "archived" ? new Date().toISOString() : null,
  };
  if (!payload.title || !payload.body) throw new ApiError(400, "Asset title and body are required.");
  if (status === "approved") {
    const latestReview = assertResult(
      await supabase
        .from("marketing_ai_reviews")
        .select("*")
        .eq("target_type", "content_asset")
        .eq("target_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "Content review could not be checked."
    );
    if (!latestReview || latestReview.prompt_metadata?.content_fingerprint !== contentFingerprint(payload)) {
      throw new ApiError(409, "Run AI Review on the current draft before approving it.");
    }
  }
  return assertResult(
    await supabase.from("marketing_ai_assets").update(payload).eq("id", id).select().single(),
    "Content asset could not be saved."
  );
}

async function reviewAsset(supabase, body) {
  const assetId = clean(body.asset_id, 100);
  const asset = assertResult(
    await supabase.from("marketing_ai_assets").select("*").eq("id", assetId).single(),
    "Content asset could not be found."
  );
  if (asset.status !== "draft") throw new ApiError(400, "Only a draft asset can be reviewed.");
  const article = assertResult(
    await supabase.from("knowledge_articles").select("id,title,category,content_markdown,cta").eq("id", asset.source_article_id).single(),
    "Source article could not be loaded."
  );
  const brain = await loadBrain(supabase);
  const assembled = buildAiPlatformPrompt({
    sections: brain.sections,
    settings: brain.settings,
    specialist: { key: `review-${asset.channel}`, prompt: "Assess the draft against its channel and source article." },
    topic: { title: article.title, category: article.category },
    task: "content_review",
    module: "ai_review_engine",
    requestedTask:
      "Score brand voice, vocabulary, compliance, SEO, readability, repetition, CTA quality, generic wording and hallucination risk.",
    sourceContent: `Approved source article:
${article.content_markdown || ""}

Draft ${asset.channel} asset:
Title: ${asset.title}
Body: ${asset.body}
Preview: ${asset.preview_text}
CTA: ${asset.cta}`,
  });
  const review = normalizeAiReview(
    await callStructuredAi({
      input: `${assembled.prompt}

Return advisory findings only. Do not rewrite, edit, approve, post or send the asset.`,
      schema: REVIEW_SCHEMA,
      schemaName: "marketing_content_review",
      systemInstruction:
        "You are an evidence-based AI marketing reviewer. Follow the supplied Business Brain and JSON schema exactly.",
    })
  );
  return assertResult(
    await supabase
      .from("marketing_ai_reviews")
      .insert({
        target_type: "content_asset",
        target_id: asset.id,
        overall_score: review.overall_score,
        category_scores: review.categories,
        summary: review.summary,
        recommendations: review.recommendations,
        warnings: review.warnings,
        model: aiConfiguration().model,
        prompt_metadata: {
          ...assembled.metadata,
          content_fingerprint: contentFingerprint(asset),
        },
      })
      .select()
      .single(),
    "AI review could not be saved."
  );
}

function isPrivateHostname(hostname) {
  const value = hostname.toLowerCase();
  if (value === "localhost" || value.endsWith(".local") || value === "0.0.0.0" || value === "::1") return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value)) return true;
  const private172 = value.match(/^172\.(\d+)\./);
  return private172 ? Number(private172[1]) >= 16 && Number(private172[1]) <= 31 : false;
}

function validateWebsiteUrl(value) {
  let url;
  try {
    url = new URL(clean(value, 1000));
  } catch {
    throw new ApiError(400, "Enter a valid website URL.");
  }
  if (url.protocol !== "https:" || isPrivateHostname(url.hostname)) {
    throw new ApiError(400, "Website imports require a public HTTPS URL.");
  }
  url.hash = "";
  return url;
}

function websiteText(html) {
  return clean(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " "),
    60000
  );
}

async function analyseWebsite(supabase, body) {
  const url = validateWebsiteUrl(body.website_url);
  const websiteResponse = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
    headers: { "User-Agent": "MarketingCRM-BusinessBrain-Importer/1.0" },
  });
  if (!websiteResponse.ok) throw new ApiError(502, "The website could not be loaded for review.");
  const finalUrl = validateWebsiteUrl(websiteResponse.url);
  const contentType = websiteResponse.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) throw new ApiError(400, "The URL must return an HTML webpage.");
  const text = websiteText(await websiteResponse.text());
  if (text.length < 100) throw new ApiError(400, "The webpage did not contain enough readable text.");
  const brain = await loadBrain(supabase);
  const assembled = buildAiPlatformPrompt({
    sections: brain.sections,
    settings: brain.settings,
    task: "website_intelligence",
    module: "website_intelligence",
    requestedTask:
      "Extract company facts, products, FAQs, services, tone, vocabulary, personas and CTAs for human review.",
    sourceContent: text,
  });
  const extracted = parseWebsiteIntelligence(
    await callStructuredAi({
      input: `${assembled.prompt}

Extract only claims evidenced in the supplied website text. Keep each item independently reviewable.
Do not overwrite, merge or save any Business Brain section.`,
      schema: WEBSITE_SCHEMA,
      schemaName: "website_business_intelligence",
      systemInstruction:
        "You extract evidence-based business knowledge for human review. Follow the JSON schema exactly and do not invent missing facts.",
    })
  );
  return assertResult(
    await supabase
      .from("knowledge_website_imports")
      .insert({
        website_url: finalUrl.toString(),
        status: "review",
        extracted_sections: extracted,
        analysis_metadata: {
          prompt: assembled.metadata,
          model: aiConfiguration().model,
          analysed_at: new Date().toISOString(),
        },
      })
      .select()
      .single(),
    "Website analysis could not be saved for review."
  );
}

const WEBSITE_TO_BRAIN = {
  company: "company_profile",
  products: "products",
  services: "products",
  tone: "brand_voice",
  faqs: "faqs",
  personas: "customer_personas",
  vocabulary: "business_vocabulary",
  ctas: "preferred_ctas",
};

async function applyWebsiteImport(supabase, body) {
  const importId = clean(body.import_id, 100);
  const selected = cleanArray(body.selected_sections, WEBSITE_SECTION_KEYS.size).filter((key) =>
    WEBSITE_SECTION_KEYS.has(key)
  );
  if (!selected.length) throw new ApiError(400, "Select at least one extracted section.");
  const websiteImport = assertResult(
    await supabase.from("knowledge_website_imports").select("*").eq("id", importId).single(),
    "Website import could not be found."
  );
  if (websiteImport.status !== "review") throw new ApiError(400, "This website import has already been processed.");

  const sectionKeys = [...new Set(selected.map((key) => WEBSITE_TO_BRAIN[key]))];
  const sections = assertResult(
    await supabase.from("knowledge_business_sections").select("*").in("section_key", sectionKeys),
    "Business Brain sections could not be loaded."
  );
  const byKey = new Map((sections || []).map((section) => [section.section_key, section]));
  for (const importKey of selected) {
    const sectionKey = WEBSITE_TO_BRAIN[importKey];
    const section = byKey.get(sectionKey);
    if (!section) continue;
    const existingValues = new Set(
      (section.entries || []).map((entry) => clean(entry.value).toLowerCase()).filter(Boolean)
    );
    const additions = cleanArray(websiteImport.extracted_sections?.[importKey]).filter(
      (value) => !existingValues.has(value.toLowerCase())
    );
    if (!additions.length) continue;
    const entries = [
      ...(section.entries || []),
      ...additions.map((value) => ({
        label: `Website import · ${importKey}`,
        value,
      })),
    ];
    assertResult(
      await supabase
        .from("knowledge_business_sections")
        .update({ entries, updated_at: new Date().toISOString() })
        .eq("id", section.id),
      `The ${section.title} section could not be updated.`
    );
  }
  return assertResult(
    await supabase
      .from("knowledge_website_imports")
      .update({
        status: "saved",
        selected_sections: selected,
        saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", websiteImport.id)
      .select()
      .single(),
    "Website import could not be marked as saved."
  );
}

async function createCampaignFromArticle(supabase, body) {
  const values = body.values || {};
  const articleId = clean(values.article_id, 100);
  const article = assertResult(
    await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    "Source article could not be found."
  );
  if (article.status !== "approved") throw new ApiError(400, "Campaigns can only be created from approved articles.");
  const emailDraft = clean(values.email_draft, 50000);
  if (!emailDraft) throw new ApiError(400, "Review and supply an email draft before creating the campaign draft.");
  const audience = values.audience && typeof values.audience === "object" ? values.audience : {};
  const sourceAssetId = clean(values.asset_id, 100);
  if (sourceAssetId) {
    const sourceAsset = assertResult(
      await supabase
        .from("marketing_ai_assets")
        .select("id,source_article_id,channel,status")
        .eq("id", sourceAssetId)
        .single(),
      "Source email asset could not be found."
    );
    if (sourceAsset.source_article_id !== article.id || sourceAsset.channel !== "email" || sourceAsset.status === "archived") {
      throw new ApiError(400, "The selected email asset does not belong to this approved article.");
    }
  }
  const name = clean(values.name, 300) || `Article campaign · ${article.title}`;
  const campaign = assertResult(
    await supabase
      .from("marketing_campaigns")
      .insert({
        name,
        description: clean(values.description, 3000) || `Draft campaign created from approved Knowledge Article: ${article.title}`,
        channel: "email",
        objective: "custom",
        status: "draft",
        source_article_id: article.id,
        source_ai_asset_id: sourceAssetId || null,
        subject_line: clean(values.subject_line, 500) || article.seo_title || article.title,
        preview_text: clean(values.preview_text, 1000) || article.excerpt || "",
        metadata: {
          source: "knowledge_article_phase4",
          approval_state: "ready_for_review",
          audience: {
            rules: audience,
            eligible_count: null,
            calculated_at: null,
          },
          email_draft: emailDraft,
          source_article: {
            id: article.id,
            title: article.title,
            approved_at: article.approved_at,
          },
          manual_only: true,
        },
      })
      .select()
      .single(),
    "Campaign draft could not be created."
  );
  return campaign;
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
        result = await loadPlatform(supabase);
        break;
      case "generateAsset":
        result = { asset: await generateAsset(supabase, body) };
        break;
      case "saveAsset":
        result = { asset: await saveAsset(supabase, body) };
        break;
      case "reviewAsset":
        result = { review: await reviewAsset(supabase, body) };
        break;
      case "analyseWebsite":
        result = { website_import: await analyseWebsite(supabase, body) };
        break;
      case "applyWebsiteImport":
        result = { website_import: await applyWebsiteImport(supabase, body) };
        break;
      case "createCampaignFromArticle":
        result = { campaign: await createCampaignFromArticle(supabase, body) };
        break;
      default:
        throw new ApiError(400, "Unsupported AI Marketing Platform action.");
    }
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("AI MARKETING PLATFORM ERROR", {
      action: parseBody(request).action || "",
      message: error.message,
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "AI Marketing Platform request failed.",
    });
  }
}
