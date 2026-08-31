import handler from "./marketing-knowledge-hub.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";
import { applyKnowledgeModelOverride } from "../lib/priorityAiModelPolicy.js";

function actionName(request) {
  const body = request?.body;
  if (body && typeof body === "object") return String(body.action || "").trim();
  if (typeof body === "string") {
    try { return String(JSON.parse(body || "{}")?.action || "").trim(); }
    catch { return ""; }
  }
  return "";
}

async function routedKnowledgeHandler(request, response) {
  const action = actionName(request);
  const mode = action === "findTopics"
    ? "topic"
    : action === "reviewArticle"
      ? "review"
      : "generation";
  applyKnowledgeModelOverride(process.env, mode);
  return handler(request, response);
}

export default withKnowledgeHubNoLock(routedKnowledgeHandler);
