import handler from "./marketing-editorial-engine.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";
import { applyAiOperationModelOverride } from "../lib/priorityAiModelPolicy.js";

applyAiOperationModelOverride(process.env, "editorial");

export default withKnowledgeHubNoLock(handler);
