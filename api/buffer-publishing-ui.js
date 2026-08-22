import handler from "./buffer-publishing.js";
import { withMarketingUiNoLock } from "../lib/marketingUiNoLock.js";

export default withMarketingUiNoLock(handler, "Buffer publishing");
