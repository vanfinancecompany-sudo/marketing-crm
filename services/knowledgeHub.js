import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const KNOWLEDGE_HUB_API = "/api/marketing-knowledge-hub";
const KNOWLEDGE_SAFETY_APPROVAL_API = "/api/marketing-knowledge-safety-approval";
const RENT2BUY_RULE_API = "/api/marketing-rent2buy-business-rule";
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

export async function loadKnowledgeHub() {
  await ensureRent2BuyRule();
  return requestKnowledgeHub("load");
}

export function saveKnowledgeTopic(topic) {
  return requestKnowledgeHub("saveTopic", { topic });
}

export function deleteKnowledgeTopic(topicId) {
  return requestKnowledgeHub("deleteTopic", { topic_id: topicId });
}

export async function generateKnowledgeArticle(topic, generation) {
  await ensureRent2BuyRule();
  return requestKnowledgeHub("generateArticle", { topic, generation });
}

export async function findKnowledgeTopics(categories, quantity, brief) {
  await ensureRent2BuyRule();
  return requestKnowledgeHub("findTopics", { categories, quantity, brief });
}

export function saveKnowledgeTopicIdeas(ideas) {
  return requestKnowledgeHub("saveTopicIdeas", { ideas });
}

export function saveKnowledgeArticle(article, status) {
  if (status === "approved") {
    return requestSafetyApproval("approveArticle", { article });
  }
  return requestKnowledgeHub("saveArticle", { article, status });
}

export function bulkUpdateKnowledgeArticles(articleIds, status) {
  if (status === "approved") {
    return requestSafetyApproval("approveArticles", { article_ids: articleIds });
  }
  return requestKnowledgeHub("bulkUpdateArticles", { article_ids: articleIds, status });
}

export function saveKnowledgeTemplate(template) {
  return requestKnowledgeHub("saveTemplate", { template });
}

export function saveBusinessKnowledgeSection(businessSection) {
  return requestKnowledgeHub("saveBusinessSection", {
    business_section: businessSection,
  });
}

export async function reviewKnowledgeArticle(articleId) {
  await ensureRent2BuyRule();
  return requestKnowledgeHub("reviewArticle", { article_id: articleId });
}

if (typeof window !== "undefined") {
  import("../components/PublishingSafetyCorrections.jsx")
    .then(({ installPublishingSafetyCorrections }) => installPublishingSafetyCorrections())
    .catch((error) => console.error("PUBLISHING SAFETY CORRECTIONS UI ERROR", error));
}
