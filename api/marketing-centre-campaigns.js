import marketingCampaignsHandler from "./marketing-campaigns.js";
import { withMarketingCentreNoLock } from "../lib/marketingCentreNoLock.js";

export default withMarketingCentreNoLock(marketingCampaignsHandler);
