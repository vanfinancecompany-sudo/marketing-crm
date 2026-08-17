import handler from "./marketing-knowledge-safety-approval.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";

export default withKnowledgeHubNoLock(handler);
