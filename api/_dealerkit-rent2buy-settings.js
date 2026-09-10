import {
  DEALERKIT_RENT2BUY_SETTINGS_TABLE,
  buildRent2BuySettingsRow,
  normalizeRent2BuyCategories,
  rowToRent2BuySettings,
} from "../lib/dealerKitRent2BuyPlan.js";

const clean = (value, limit = 3000) => String(value ?? "").trim().slice(0, limit);

export function rent2BuyCategoriesFromReview(decision = {}) {
  return normalizeRent2BuyCategories(
    (Array.isArray(decision.financeCategories) ? decision.financeCategories : [])
      .filter((key) => key !== "nine_seater"),
  );
}

export async function loadDealerKitRent2BuySettings(supabase, supplierStockId) {
  const id = clean(supplierStockId, 300);
  if (!id) return null;
  const { data, error } = await supabase
    .from(DEALERKIT_RENT2BUY_SETTINGS_TABLE)
    .select("*")
    .eq("supplier_stock_id", id)
    .limit(1);
  if (error) throw new Error(`DealerKit Rent2Buy settings read failed: ${error.message || error}`);
  return data?.[0] ? rowToRent2BuySettings(data[0]) : null;
}

export async function removeDealerKitRent2BuySettings(supabase, supplierStockId) {
  const id = clean(supplierStockId, 300);
  if (!id) return;
  const { error } = await supabase
    .from(DEALERKIT_RENT2BUY_SETTINGS_TABLE)
    .delete()
    .eq("supplier_stock_id", id);
  if (error) throw new Error(`DealerKit Rent2Buy settings cleanup failed: ${error.message || error}`);
}

export async function saveDerivedDealerKitRent2BuySettings(supabase, vehicle, decision) {
  if (!decision?.rent2buyEnabled) {
    await removeDealerKitRent2BuySettings(supabase, decision?.supplierStockId || vehicle?.supplierStockId);
    return null;
  }

  const row = buildRent2BuySettingsRow({
    vehicle,
    settings: { categories: rent2BuyCategoriesFromReview(decision) },
  });
  const { data, error } = await supabase
    .from(DEALERKIT_RENT2BUY_SETTINGS_TABLE)
    .upsert(row, { onConflict: "supplier_stock_id" })
    .select("*")
    .single();
  if (error) throw new Error(`DealerKit Rent2Buy settings save failed: ${error.message || error}`);
  return rowToRent2BuySettings(data);
}
