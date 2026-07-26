import { createClient } from "@supabase/supabase-js";
import {
  AI_PROVIDER_KEYS,
  DETECTION_STATUSES,
  VISIBILITY_PROVIDERS,
  buildVisibilitySummary,
  deriveVisibilityPrompts,
  isConfirmedPublishedArticle,
  visibilityPromptFingerprint,
} from "../lib/aiVisibility.js";
import {
  getVisibilityProviderAdapter,
  visibilityProviderConnection,
} from "../lib/aiVisibilityProviders.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const PROVIDER_KEYS = new Set(VISIBILITY_PROVIDERS.map((provider) => provider.key));
const MANUAL_STATUSES = new Set([
  "indexed",
  "not_indexed",
  "detected",
  "mentioned",
  "cited",
  "not_detected",
]);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
const parseBody = (request) =>
  typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
const configuredAccessKey = () =>
  String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "").trim();
const suppliedAccessKey = (request) => String(request.headers?.[API_KEY_HEADER] || "").trim();
const authorize = (request) =>
  Boolean(configuredAccessKey() && suppliedAccessKey(request) === configuredAccessKey());
const getSupabase = () => {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new ApiError(500, "Supabase is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};
const data = (result, fallback) => {
  if (result.error) throw new ApiError(500, result.error.message || fallback);
  return result.data;
};

async function audit(supabase, payload) {
  data(
    await supabase.from("knowledge_visibility_audit_events").insert(payload),
    "AI Visibility audit event could not be saved."
  );
}

async function auditDashboardCalculation(supabase, summary) {
  const latest = data(
    await supabase
      .from("knowledge_visibility_audit_events")
      .select("created_at")
      .eq("action", "dashboard_calculated")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "AI Visibility calculation history could not be checked."
  );
  if (latest && Date.now() - new Date(latest.created_at).getTime() < 15 * 60 * 1000) return;
  await audit(supabase, {
    action: "dashboard_calculated",
    reason: "AI Visibility metrics recalculated from stored evidence.",
    details: {
      published_pages: summary.published_pages,
      eligible_checked_articles: summary.visibility_rate_denominator,
      total_verified_detections: summary.total_verified_detections,
      fabricated_values: 0,
    },
  });
}

async function loadAllRows(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const page = data(
      await queryFactory().range(start, start + pageSize - 1),
      "Complete AI Visibility evidence could not be loaded."
    ) || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function loadVisibility(supabase) {
  const [articles, prompts, results, connections, settings, auditEvents] = await Promise.all([
    loadAllRows(() =>
      supabase
        .from("knowledge_articles")
        .select("*, knowledge_topics(title,primary_keyword,intent)")
        .order("published_at", { ascending: false, nullsFirst: false })
    ),
    loadAllRows(() =>
      supabase.from("knowledge_visibility_prompts").select("*").order("updated_at", { ascending: false })
    ),
    loadAllRows(() =>
      supabase.from("knowledge_visibility_results").select("*").order("checked_at", { ascending: false })
    ),
    supabase.from("knowledge_visibility_provider_connections").select("*").order("provider"),
    supabase.from("knowledge_visibility_settings").select("*").eq("settings_key", "default").maybeSingle(),
    supabase.from("knowledge_visibility_audit_events").select("*").order("created_at", { ascending: false }).limit(1000),
  ]);
  [connections, settings, auditEvents].forEach((result) =>
    data(result, "AI Visibility Centre could not be loaded.")
  );
  const visibilitySettings = settings.data || {
    attention_days: 30,
    maximum_active_prompts_per_article: 8,
  };
  const summary = buildVisibilitySummary({
    articles,
    prompts,
    results,
    attentionDays: visibilitySettings.attention_days,
  });
  await auditDashboardCalculation(supabase, summary);
  const byProvider = new Map((connections.data || []).map((item) => [item.provider, item]));
  return {
    articles,
    prompts,
    results,
    provider_connections: VISIBILITY_PROVIDERS.map((provider) =>
      visibilityProviderConnection(provider.key, byProvider.get(provider.key))
    ),
    settings: visibilitySettings,
    audit_events: auditEvents.data || [],
    summary,
  };
}

function validatePublishedUrl(value, websiteUrl = "") {
  const url = clean(value, 2000);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error();
    if (websiteUrl) {
      const configured = new URL(websiteUrl);
      if (
        parsed.origin !== configured.origin &&
        !parsed.hostname.toLowerCase().endsWith(".wixsite.com")
      ) throw new Error();
    }
    return parsed.toString();
  } catch {
    throw new ApiError(
      400,
      websiteUrl
        ? "Wix publication URL must use the configured website domain or a Wix site domain."
        : "A verified HTTPS source URL is required."
    );
  }
}

async function savePublication(supabase, body) {
  const articleId = clean(body.article_id, 100);
  const article = data(
    await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    "Article could not be found."
  );
  if (!["approved", "exported"].includes(article.status)) {
    throw new ApiError(400, "Only approved or exported articles can be confirmed as published.");
  }
  const publication = body.publication && typeof body.publication === "object" ? body.publication : {};
  const settings = data(
    await supabase
      .from("knowledge_settings")
      .select("website_url")
      .eq("settings_key", "default")
      .maybeSingle(),
    "Website settings could not be loaded."
  ) || {};
  const liveUrl = validatePublishedUrl(publication.live_wix_url, settings.website_url || "");
  const publishedAt = new Date(publication.published_at || "");
  if (Number.isNaN(publishedAt.getTime()) || publishedAt.getTime() > Date.now() + 60000) {
    throw new ApiError(400, "A valid publication date is required and cannot be in the future.");
  }
  const lastWixSync = publication.last_wix_sync_at
    ? new Date(publication.last_wix_sync_at)
    : null;
  if (lastWixSync && Number.isNaN(lastWixSync.getTime())) {
    throw new ApiError(400, "Last Wix sync must be a valid date.");
  }
  const now = new Date().toISOString();
  const saved = data(
    await supabase
      .from("knowledge_articles")
      .update({
        wix_item_id: clean(publication.wix_item_id, 500) || null,
        wix_collection_id: clean(publication.wix_collection_id, 500) || null,
        live_wix_url: liveUrl,
        published_at: publishedAt.toISOString(),
        last_wix_sync_at: lastWixSync?.toISOString() || null,
        wix_sync_status: "live",
        publication_verified_at: now,
        publication_verification_notes: clean(publication.notes, 5000),
        updated_at: now,
      })
      .eq("id", article.id)
      .select()
      .single(),
    "Wix publication evidence could not be saved."
  );
  await audit(supabase, {
    article_id: article.id,
    action: "publication_updated",
    reason: "Administrator confirmed the live Wix publication record.",
    details: {
      live_wix_url: liveUrl,
      wix_item_id: saved.wix_item_id,
      wix_collection_id: saved.wix_collection_id,
      manually_verified: true,
    },
  });
  try {
    await derivePrompts(supabase, { article_id: article.id });
  } catch (error) {
    console.error("AI VISIBILITY PROMPT DERIVATION ERROR", {
      article_id: article.id,
      message: error.message,
    });
  }
  return saved;
}

async function derivePrompts(supabase, body) {
  const articleId = clean(body.article_id, 100);
  const [articleResult, sectionsResult, settingsResult, existingResult] = await Promise.all([
    supabase
      .from("knowledge_articles")
      .select("*, knowledge_topics(title,primary_keyword,intent)")
      .eq("id", articleId)
      .single(),
    supabase.from("knowledge_business_sections").select("*").eq("active", true).order("sort_order"),
    supabase.from("knowledge_visibility_settings").select("*").eq("settings_key", "default").maybeSingle(),
    supabase.from("knowledge_visibility_prompts").select("*").eq("article_id", articleId),
  ]);
  [articleResult, sectionsResult, settingsResult, existingResult].forEach((result) =>
    data(result, "Monitoring prompt context could not be loaded.")
  );
  const maximum = settingsResult.data?.maximum_active_prompts_per_article || 8;
  const existingFingerprints = new Set((existingResult.data || []).map((prompt) => prompt.prompt_fingerprint));
  const derived = deriveVisibilityPrompts({
    article: articleResult.data,
    topic: articleResult.data.knowledge_topics || {},
    businessSections: sectionsResult.data || [],
    maximum,
  }).filter((prompt) => !existingFingerprints.has(prompt.prompt_fingerprint));
  const remaining = Math.max(
    0,
    maximum - (existingResult.data || []).filter((prompt) => prompt.active).length
  );
  const rows = derived.slice(0, remaining).map((prompt) => ({
    article_id: articleId,
    ...prompt,
    active: true,
    created_by: "derived",
  }));
  const created = rows.length
    ? data(
        await supabase.from("knowledge_visibility_prompts").insert(rows).select(),
        "Derived monitoring prompts could not be saved."
      )
    : [];
  await audit(supabase, {
    article_id: articleId,
    action: "prompts_derived",
    reason: "Monitoring prompts derived from saved article and Business Brain evidence.",
    details: { created_count: created.length, maximum_active_prompts: maximum },
  });
  return created;
}

async function savePrompt(supabase, body) {
  const prompt = body.prompt && typeof body.prompt === "object" ? body.prompt : {};
  const promptText = clean(prompt.prompt_text, 500);
  if (promptText.length < 5) throw new ApiError(400, "Monitoring prompt must contain at least five characters.");
  const articleId = clean(prompt.article_id, 100);
  const fingerprint = visibilityPromptFingerprint(promptText);
  const existing = prompt.id
    ? data(
        await supabase.from("knowledge_visibility_prompts").select("*").eq("id", clean(prompt.id, 100)).single(),
        "Monitoring prompt could not be found."
      )
    : null;
  const effectiveArticleId = existing?.article_id || articleId;
  if (!effectiveArticleId) throw new ApiError(400, "Article is required.");
  const [promptSettingsResult, articlePromptsResult] = await Promise.all([
    supabase
      .from("knowledge_visibility_settings")
      .select("maximum_active_prompts_per_article")
      .eq("settings_key", "default")
      .maybeSingle(),
    supabase
      .from("knowledge_visibility_prompts")
      .select("id,prompt_fingerprint,active")
      .eq("article_id", effectiveArticleId),
  ]);
  [promptSettingsResult, articlePromptsResult].forEach((result) =>
    data(result, "Monitoring prompt safeguards could not be checked.")
  );
  const siblingPrompts = (articlePromptsResult.data || []).filter((item) => item.id !== existing?.id);
  if (siblingPrompts.some((item) => item.prompt_fingerprint === fingerprint)) {
    throw new ApiError(409, "This monitoring prompt already exists for the article.");
  }
  const willBeActive = prompt.active !== false;
  const activeSiblingCount = siblingPrompts.filter((item) => item.active).length;
  const maximum = promptSettingsResult.data?.maximum_active_prompts_per_article || 8;
  if (willBeActive && activeSiblingCount >= maximum) {
    throw new ApiError(400, `Disable another prompt before exceeding the ${maximum}-prompt monitoring limit.`);
  }
  const saved = data(
    existing
      ? await supabase
          .from("knowledge_visibility_prompts")
          .update({
            prompt_text: promptText,
            prompt_source: existing.prompt_source === "manual" ? "manual" : existing.prompt_source,
            prompt_fingerprint: fingerprint,
            active: prompt.active !== false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single()
      : await supabase
          .from("knowledge_visibility_prompts")
          .insert({
            article_id: effectiveArticleId,
            prompt_text: promptText,
            prompt_source: "manual",
            prompt_fingerprint: fingerprint,
            active: prompt.active !== false,
            created_by: "administrator",
          })
          .select()
          .single(),
    "Monitoring prompt could not be saved."
  );
  const action = !saved.active ? "prompt_disabled" : existing ? "prompt_updated" : "prompt_created";
  await audit(supabase, {
    article_id: saved.article_id,
    prompt_id: saved.id,
    action,
    reason: `Administrator ${action.replaceAll("_", " ")}.`,
    details: {
      previous_prompt_text: existing?.prompt_text || "",
      prompt_text: saved.prompt_text,
      active: saved.active,
    },
  });
  return saved;
}

function validateManualResult(provider, status, promptId, evidence, sourceUrl) {
  if (!PROVIDER_KEYS.has(provider)) throw new ApiError(400, "Unsupported visibility provider.");
  if (!MANUAL_STATUSES.has(status)) throw new ApiError(400, "Unsupported verified result status.");
  if (provider === "google_search_console" && !["indexed", "not_indexed"].includes(status)) {
    throw new ApiError(400, "Google Search Console manual results must be indexed or not indexed.");
  }
  if (AI_PROVIDER_KEYS.has(provider) && ["indexed", "not_indexed"].includes(status)) {
    throw new ApiError(400, "AI-provider results cannot use Google indexing statuses.");
  }
  if (AI_PROVIDER_KEYS.has(provider) && !promptId) {
    throw new ApiError(400, "Select the monitored prompt that produced this AI result.");
  }
  if (DETECTION_STATUSES.has(status) && !clean(evidence)) {
    throw new ApiError(400, "Detected, mentioned and cited results require evidence.");
  }
  if (status === "cited" && !clean(sourceUrl)) {
    throw new ApiError(400, "A cited result requires the verified citation source URL.");
  }
}

async function recordManualResult(supabase, body) {
  const entry = body.result && typeof body.result === "object" ? body.result : {};
  const articleId = clean(entry.article_id, 100);
  const provider = clean(entry.provider, 80);
  const status = clean(entry.result_status, 40);
  const promptId = clean(entry.prompt_id, 100) || null;
  const evidence = clean(entry.evidence_excerpt, 10000);
  validateManualResult(provider, status, promptId, evidence, entry.source_url);
  const article = data(
    await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    "Article could not be found."
  );
  if (!isConfirmedPublishedArticle(article)) {
    throw new ApiError(400, "Confirm the live Wix publication before recording visibility evidence.");
  }
  if (promptId) {
    const prompt = data(
      await supabase.from("knowledge_visibility_prompts").select("*").eq("id", promptId).single(),
      "Monitoring prompt could not be found."
    );
    if (prompt.article_id !== article.id) throw new ApiError(400, "Monitoring prompt does not belong to this article.");
  }
  const checkedAt = new Date(entry.checked_at || "");
  if (Number.isNaN(checkedAt.getTime()) || checkedAt.getTime() > Date.now() + 60000) {
    throw new ApiError(400, "A valid check date is required and cannot be in the future.");
  }
  const sourceUrl = clean(entry.source_url, 2000) || null;
  if (sourceUrl) validatePublishedUrl(sourceUrl);
  const confidenceValue = entry.confidence === "" || entry.confidence == null
    ? null
    : Math.round(Math.max(0, Math.min(100, Number(entry.confidence))));
  const supersedesResultId = clean(entry.supersedes_result_id, 100) || null;
  const saved = data(
    await supabase
      .from("knowledge_visibility_results")
      .insert({
        article_id: article.id,
        prompt_id: promptId,
        provider,
        checked_at: checkedAt.toISOString(),
        result_status: status,
        source_url: sourceUrl,
        evidence_excerpt: evidence,
        structured_evidence:
          entry.structured_evidence && typeof entry.structured_evidence === "object"
            ? entry.structured_evidence
            : {},
        confidence: Number.isFinite(confidenceValue) ? confidenceValue : null,
        response_metadata: {
          entered_by: "administrator",
          public_provider_result: true,
          ranking_position_supplied: false,
        },
        notes: clean(entry.notes, 5000),
        verification_method: "manual",
        manually_verified: true,
        supersedes_result_id: supersedesResultId,
      })
      .select()
      .single(),
    "Verified visibility result could not be saved."
  );
  if (supersedesResultId) {
    await audit(supabase, {
      article_id: article.id,
      result_id: saved.id,
      provider,
      action: "result_superseded",
      reason: "A new manually verified result supersedes an earlier record without deleting it.",
      details: { supersedes_result_id: supersedesResultId },
    });
  }
  await audit(supabase, {
    article_id: article.id,
    prompt_id: promptId,
    result_id: saved.id,
    provider,
    action: "manual_result_recorded",
    reason: "Administrator recorded externally verified visibility evidence.",
    details: {
      result_status: status,
      manually_verified: true,
      source_url_supplied: Boolean(sourceUrl),
      evidence_supplied: Boolean(evidence),
    },
  });
  return saved;
}

async function runCheck(supabase, body) {
  const articleId = clean(body.article_id, 100);
  const provider = clean(body.provider, 80);
  const promptId = clean(body.prompt_id, 100) || null;
  if (!PROVIDER_KEYS.has(provider)) throw new ApiError(400, "Unsupported visibility provider.");
  const article = data(
    await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    "Article could not be found."
  );
  if (!isConfirmedPublishedArticle(article)) {
    throw new ApiError(400, "Confirm the live Wix publication before running visibility checks.");
  }
  if (AI_PROVIDER_KEYS.has(provider) && !promptId) {
    throw new ApiError(400, "Select an active monitoring prompt for this AI-provider check.");
  }
  if (promptId) {
    const prompt = data(
      await supabase
        .from("knowledge_visibility_prompts")
        .select("*")
        .eq("id", promptId)
        .eq("article_id", articleId)
        .single(),
      "Active monitoring prompt could not be found."
    );
    if (!prompt.active) throw new ApiError(400, "Disabled prompts cannot be checked.");
  }
  const previousConnection = data(
    await supabase
      .from("knowledge_visibility_provider_connections")
      .select("*")
      .eq("provider", provider)
      .single(),
    "Provider connection state could not be loaded."
  );
  const adapter = getVisibilityProviderAdapter(provider);
  await audit(supabase, {
    article_id: articleId,
    prompt_id: promptId,
    provider,
    action: "provider_check_started",
    reason: `Administrator requested a ${adapter.label} check.`,
    details: { automated_checks_supported: adapter.automated_checks_supported },
  });
  const outcome = await adapter.check({ article_id: articleId, prompt_id: promptId });
  const now = new Date().toISOString();
  const result = data(
    await supabase
      .from("knowledge_visibility_results")
      .insert({
        article_id: articleId,
        prompt_id: promptId,
        provider,
        checked_at: now,
        result_status: "error",
        error_details: outcome.error_details,
        response_metadata: outcome.response_metadata || {},
        verification_method: "provider",
        manually_verified: false,
      })
      .select()
      .single(),
    "Unavailable provider check could not be recorded."
  );
  data(
    await supabase
      .from("knowledge_visibility_provider_connections")
      .update({
        connection_status: "configuration_required",
        last_error_at: now,
        last_error: outcome.error_details,
        updated_at: now,
      })
      .eq("provider", provider),
    "Provider connection state could not be updated."
  );
  if (
    previousConnection.connection_status !== "configuration_required" ||
    previousConnection.last_error !== outcome.error_details
  ) {
    await audit(supabase, {
      provider,
      action: "connection_changed",
      reason: "Provider adapter reported that configuration is required.",
      details: {
        previous_status: previousConnection.connection_status,
        connection_status: "configuration_required",
        last_error: outcome.error_details,
      },
    });
  }
  await audit(supabase, {
    article_id: articleId,
    prompt_id: promptId,
    result_id: result.id,
    provider,
    action: "provider_check_failed",
    reason: outcome.error_details,
    details: { result_status: "error", visibility_claimed: false },
  });
  return { available: false, result, message: outcome.error_details };
}

async function saveSettings(supabase, body) {
  const attentionDays = Math.max(1, Math.min(365, Number(body.attention_days) || 30));
  return data(
    await supabase
      .from("knowledge_visibility_settings")
      .upsert({
        settings_key: "default",
        attention_days: attentionDays,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single(),
    "AI Visibility settings could not be saved."
  );
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  try {
    const body = parseBody(request);
    const supabase = getSupabase();
    let result;
    switch (body.action) {
      case "load":
        result = await loadVisibility(supabase);
        break;
      case "savePublication":
        result = { article: await savePublication(supabase, body) };
        break;
      case "derivePrompts":
        result = { prompts: await derivePrompts(supabase, body) };
        break;
      case "savePrompt":
        result = { prompt: await savePrompt(supabase, body) };
        break;
      case "recordManualResult":
        result = { result: await recordManualResult(supabase, body) };
        break;
      case "runCheck":
        result = await runCheck(supabase, body);
        break;
      case "saveSettings":
        result = { settings: await saveSettings(supabase, body) };
        break;
      default:
        throw new ApiError(400, "Unsupported AI Visibility action.");
    }
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("AI VISIBILITY ERROR", {
      action: (() => {
        try { return parseBody(request).action || ""; } catch { return ""; }
      })(),
      message: error.message,
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "AI Visibility request failed.",
    });
  }
}
