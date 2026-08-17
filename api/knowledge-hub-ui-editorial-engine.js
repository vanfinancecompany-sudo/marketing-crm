import handler from "./marketing-editorial-engine.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";

export default withKnowledgeHubNoLock(handler);
