import handler from "./buffer-publish-status.js";
import { withMarketingUiNoLock } from "../lib/marketingUiNoLock.js";

export default withMarketingUiNoLock(handler, "Buffer status");
