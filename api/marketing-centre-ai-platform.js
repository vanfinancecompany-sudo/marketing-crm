import aiMarketingPlatformHandler from "./marketing-ai-platform.js";
import { withMarketingCentreNoLock } from "../lib/marketingCentreNoLock.js";
import { applyAiOperationModelOverride } from "../lib/priorityAiModelPolicy.js";

function actionName(request) {
  const body = request?.body;
  if (body && typeof body === "object") return String(body.action || "").trim();
  if (typeof body === "string") {
    try { return String(JSON.parse(body || "{}")?.action || "").trim(); }
    catch { return ""; }
  }
  return "";
}

async function routedMarketingHandler(request, response) {
  const action = actionName(request);
  const operation = action === "analyseWebsite"
    ? "website_intelligence"
    : action === "reviewAsset"
      ? "marketing_review"
      : "marketing_content";
  applyAiOperationModelOverride(process.env, operation);
  return aiMarketingPlatformHandler(request, response);
}

export default withMarketingCentreNoLock(routedMarketingHandler);
