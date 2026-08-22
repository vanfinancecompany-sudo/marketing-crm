import handler from "./marketing-daily-operations.js";
import { withMarketingUiNoLock } from "../lib/marketingUiNoLock.js";

export default withMarketingUiNoLock(handler, "Marketing operations");
