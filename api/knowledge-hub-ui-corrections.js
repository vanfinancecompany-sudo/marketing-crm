import handler from "./marketing-knowledge-corrections.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";

export default withKnowledgeHubNoLock(handler);
