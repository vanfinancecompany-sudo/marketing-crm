import { fetchDealerKitStockSnapshot, fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import { createStockImageLookup, createStockImageHandler } from "./_vehicle-image-suite-stock.js";

// Existing Marketing CRM environment and adapter own every DealerKit request.
// No Supabase data or credential fields enter this narrow public response.
const lookup = createStockImageLookup({
  fetchSnapshot: fetchDealerKitStockSnapshot,
  fetchDetail: fetchDealerKitStockDetail,
});
export default createStockImageHandler(lookup);
