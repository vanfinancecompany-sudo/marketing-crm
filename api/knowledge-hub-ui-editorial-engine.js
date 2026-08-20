import handler from "./marketing-editorial-engine.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";
import { applyKnowledgeModelOverride } from "../lib/priorityAiModelPolicy.js";

applyKnowledgeModelOverride(process.env, "review");

export default withKnowledgeHubNoLock(handler);
