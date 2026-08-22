import handler from "./buffer-automation-settings.js";
import { withMarketingUiNoLock } from "../lib/marketingUiNoLock.js";

export default withMarketingUiNoLock(handler, "Buffer automation settings");
