import handler from "./youtube-daily-batch.js";
import { withMarketingUiNoLock } from "../lib/marketingUiNoLock.js";

export default withMarketingUiNoLock(handler, "Daily Reels");
