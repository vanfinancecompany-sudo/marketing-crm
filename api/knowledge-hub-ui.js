import handler from "./marketing-knowledge-hub.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";
import { applyKnowledgeModelOverride } from "../lib/priorityAiModelPolicy.js";

applyKnowledgeModelOverride(process.env, "generation");

export default withKnowledgeHubNoLock(handler);
