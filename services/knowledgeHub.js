import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const KNOWLEDGE_HUB_API = "/api/marketing-knowledge-hub";
const KNOWLEDGE_DUPLICATES_API = "/api/knowledge-hub-duplicates";
const KNOWLEDGE_SAFETY_APPROVAL_API = "/api/marketing-knowledge-safety-approval";
const RENT2BUY_RULE_API = "/api/marketing-rent2buy-business-rule";
const KNOWLEDGE_GENERATION_MAX_ATTEMPTS = 3;
let rent2BuyRuleReady;

async function ensureRent2BuyRule() {
  if (!rent2BuyRuleReady) {
    rent2BuyRuleReady = fetch(RENT2BUY_RULE_API, {
      method: "POST",
      headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ action: "ensure" }),
    }).then((response) => parseMarketingJsonResponse(response, "Rent2Buy Business Knowledge rule could not be loaded."));
  }
  return rent2BuyRuleReady;
}

export async function requestKnowledgeHub(action, payload = {}) {
  const response = await fetch(KNOWLEDGE_HUB_API, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Knowledge Hub request failed.");
}

async function requestSafetyApproval(action, payload = {}) {
  await ensureRent2BuyRule();
  const response = await fetch(KNOWLEDGE_SAFETY_APPROVAL_API, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Publishing safety approval failed.");
}

function normaliseTopicDuplicateFields(topic = {}) {
  return {
    ...topic,
    canonical_intent: String(topic.canonical_intent || topic.intent || topic.title || "").trim(),
    article_angle: String(topic.article_angle || "").trim(),
    duplicate_override_reason: String(topic.duplicate_override_reason || "").trim(),
  };
}

function normaliseArticleDuplicateFields(article = {}) {
  return {
    ...article,
    canonical_intent: String(article.canonical_intent || article.title || "").trim(),
    article_angle: String(article.article_angle || "").trim(),
    duplicate_override_reason: String(article.duplicate_override_reason || "").trim(),
  };
}

function isSeoLengthValidationError(error) {
  const message = String(error?.message || "");
  return /SEO title should be 20.?70 characters|Meta description should be 80.?180 characters/i.test(message);
}

function withSeoGenerationGuardrails(generation = {}, attempt = 1) {
  const existingInstructions = String(generation.optional_instructions || "").trim();
  const retryNote = attempt > 1
    ? ` This is automatic retry ${attempt}; the previous response was rejected only because an SEO field missed its character limit.`
    : "";
  const seoInstructions = [
    "STRICT SEO OUTPUT LIMITS:",
    "- seo_title must be 30 to 60 characters, and never outside 20 to 70 characters.",
    "- meta_description must be 120 to 160 characters, and never outside 80 to 180 characters.",
    "Count characters before returning the final JSON and rewrite either field until it fits.",
    retryNote,
  ].filter(Boolean).join("\n");

  return {
    ...generation,
    optional_instructions: [existingInstructions, seoInstructions].filter(Boolean).join("\n\n"),
  };
}

export async function checkKnowledgeDuplicate(type, candidate = {}) {
  const response = await fetch(KNOWLEDGE_DUPLICATES_API, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      type,
      title: candidate.title,
      canonical_intent: candidate.canonical_intent || candidate.intent || candidate.title,
      category: candidate.category,
      exclude_id: candidate.id || null,
      limit: 10,
    }),
  });
  return parseMarketingJsonResponse(response, "Duplicate protection could not check this subject.");
}

function closestDuplicateMessage(result, candidateLabel = "subject") {
  const closest = result?.matches?.[0];
  if (!closest) return `This ${candidateLabel} appears to duplicate existing Knowledge Hub coverage.`;
  const archiveNote = closest.status === "archived" ? " The existing item is archived but remains in duplicate history." : "";
  return `Closest existing ${result.type}: “${closest.title}” (${closest.duplicate_risk.replaceAll("_", " ")}).${archiveNote}`;
}

function requireDuplicateDecision(result, candidate, candidateLabel) {
  const risk = result?.summary?.highest_risk || "clear";
  if (risk === "clear" || risk === "related") return candidate;

  const message = closestDuplicateMessage(result, candidateLabel);
  if (typeof window === "undefined") {
    const error = new Error(`${message} Review the canonical intent and article angle before continuing.`);
    error.code = "knowledge_duplicate_review_required";
    throw error;
  }

  if (risk === "duplicate") {
    const reason = window.prompt(
      `${message}\n\nThis is blocked as the same intent. Only continue when it is genuinely a different article angle. Enter the reason for overriding the blocker, or press Cancel.`
    );
    if (!String(reason || "").trim()) {
      const error = new Error(`${message} The duplicate was not saved.`);
      error.code = "knowledge_duplicate_blocked";
      throw error;
    }
    return { ...candidate, duplicate_override_reason: String(reason).trim() };
  }

  const confirmed = window.confirm(
    `${message}\n\nThis looks like a likely duplicate. Continue only when it answers a genuinely different customer question.`
  );
  if (!confirmed) {
    const error = new Error(`${message} The item was not saved.`);
    error.code = "knowledge_duplicate_cancelled";
    throw error;
  }
  const reason = window.prompt(
    "Briefly explain the distinct article angle. This will be stored in the duplicate audit history."
  );
  if (!String(reason || "").trim()) {
    const error = new Error("A distinct article angle or override reason is required for a likely duplicate.");
    error.code = "knowledge_duplicate_reason_required";
    throw error;
  }
  return {
    ...candidate,
    article_angle: candidate.article_angle || String(reason).trim(),
    duplicate_override_reason: String(reason).trim(),
  };
}

async function protectTopic(topic, label = "topic") {
  const candidate = normaliseTopicDuplicateFields(topic);
  const result = await checkKnowledgeDuplicate("topic", candidate);
  return requireDuplicateDecision(result, candidate, label);
}

async function protectArticle(article, label = "article") {
  const candidate = normaliseArticleDuplicateFields(article);
  const result = await checkKnowledgeDuplicate("article", candidate);
  return requireDuplicateDecision(result, candidate, label);
}

export async function loadKnowledgeHub() { await ensureRent2BuyRule(); return requestKnowledgeHub("load"); }

export function approveAndCreateWixDraft(articleId, reviewedContentHash, confirmWarnings = false) {
  return requestSafetyApproval("approveAndCreateWixDraft", {
    article_id: articleId,
    reviewed_content_hash: reviewedContentHash,
    confirm_warnings: Boolean(confirmWarnings),
  });
}

export async function saveKnowledgeTopic(topic) {
  const protectedTopic = await protectTopic(topic, "topic");
  return requestKnowledgeHub("saveTopic", { topic: protectedTopic });
}
export function deleteKnowledgeTopic(topicId) { return requestKnowledgeHub("deleteTopic", { topic_id: topicId }); }
export async function generateKnowledgeArticle(topic, generation) {
  await ensureRent2BuyRule();
  let lastError;
  for (let attempt = 1; attempt <= KNOWLEDGE_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestKnowledgeHub("generateArticle", {
        topic,
        generation: withSeoGenerationGuardrails(generation, attempt),
      });
    } catch (error) {
      lastError = error;
      if (!isSeoLengthValidationError(error) || attempt === KNOWLEDGE_GENERATION_MAX_ATTEMPTS) throw error;
    }
  }
  throw lastError;
}
export async function findKnowledgeTopics(categories, quantity, brief) { await ensureRent2BuyRule(); return requestKnowledgeHub("findTopics", { categories, quantity, brief }); }
export async function saveKnowledgeTopicIdeas(ideas) {
  const accepted = [];
  const skipped = [];
  for (const idea of ideas || []) {
    try {
      accepted.push(await protectTopic(idea, "topic idea"));
    } catch (error) {
      if (error?.code?.startsWith("knowledge_duplicate")) {
        skipped.push({ title: idea?.title || "Untitled topic", reason: error.message });
      } else {
        throw error;
      }
    }
  }
  if (!accepted.length) return { finder: { topics: [], skipped } };
  const result = await requestKnowledgeHub("saveTopicIdeas", { ideas: accepted });
  return {
    ...result,
    finder: {
      ...(result.finder || {}),
      skipped: [...skipped, ...(result.finder?.skipped || [])],
    },
  };
}
export async function saveKnowledgeArticle(article, status, confirmWarnings = false) {
  const protectedArticle = status === "approved"
    ? await protectArticle(article, "article")
    : normaliseArticleDuplicateFields(article);
  if (status === "approved") return requestSafetyApproval("approveArticle", { article: protectedArticle, confirm_warnings: Boolean(confirmWarnings) });
  return requestKnowledgeHub("saveArticle", { article: protectedArticle, status });
}
export function bulkUpdateKnowledgeArticles(articleIds, status) {
  if (status === "approved") {
    throw new Error("Bulk approval is temporarily disabled while full-catalogue duplicate protection is active. Approve each article individually so its subject can be checked.");
  }
  return requestKnowledgeHub("bulkUpdateArticles", { article_ids: articleIds, status });
}
export function saveKnowledgeTemplate(template) { return requestKnowledgeHub("saveTemplate", { template }); }
export function saveBusinessKnowledgeSection(businessSection) { return requestKnowledgeHub("saveBusinessSection", { business_section: businessSection }); }
export async function reviewKnowledgeArticle(articleId) { await ensureRent2BuyRule(); return requestKnowledgeHub("reviewArticle", { article_id: articleId }); }

if (typeof window !== "undefined") {
  import("../components/PublishingSafetyCorrections.jsx").then(({ installPublishingSafetyCorrections }) => installPublishingSafetyCorrections()).catch((error) => console.error("PUBLISHING SAFETY CORRECTIONS UI ERROR", error));
  import("../components/KnowledgeHubApprovalDomFixes.js").then(({ installKnowledgeHubApprovalDomFixes }) => installKnowledgeHubApprovalDomFixes()).catch((error) => console.error("KNOWLEDGE HUB APPROVAL UI ERROR", error));
}
