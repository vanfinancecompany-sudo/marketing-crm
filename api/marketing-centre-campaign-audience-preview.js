import audiencePreviewHandler from "./marketing-campaign-audience-preview.js";
import { withMarketingCentreNoLock } from "../lib/marketingCentreNoLock.js";

export default withMarketingCentreNoLock(audiencePreviewHandler);
