import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const KNOWLEDGE_HUB_API = "/api/marketing-knowledge-hub";

export async function requestKnowledgeHub(action, payload = {}) {
  const response = await fetch(KNOWLEDGE_HUB_API, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Knowledge Hub request failed.");
}

export function loadKnowledgeHub() {
  return requestKnowledgeHub("load");
}

export function saveKnowledgeTopic(topic) {
  return requestKnowledgeHub("saveTopic", { topic });
}

export function deleteKnowledgeTopic(topicId) {
  return requestKnowledgeHub("deleteTopic", { topic_id: topicId });
}

export function generateKnowledgeArticle(topic, generation) {
  return requestKnowledgeHub("generateArticle", { topic, generation });
}

export function saveKnowledgeArticle(article, status) {
  return requestKnowledgeHub("saveArticle", { article, status });
}

export function bulkUpdateKnowledgeArticles(articleIds, status) {
  return requestKnowledgeHub("bulkUpdateArticles", { article_ids: articleIds, status });
}
