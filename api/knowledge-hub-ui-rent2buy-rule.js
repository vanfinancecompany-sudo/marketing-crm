import handler from "./marketing-rent2buy-business-rule.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";

export default withKnowledgeHubNoLock(handler);
