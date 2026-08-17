import handler from "./marketing-knowledge-hub.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";

export default withKnowledgeHubNoLock(handler);
