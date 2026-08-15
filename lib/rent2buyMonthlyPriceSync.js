const clean = (value, limit = 200) => String(value ?? "").trim().slice(0, limit);

export const RENT2BUY_ALL_VANS_COLLECTION_ID = "ALLRENT2BUYVANS";
export const RENT2BUY_WIX_SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";

export function parseRent2BuyMonthlyPrice(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text) return null;

  // The live CMS field is display text such as "£575 PM" or "£559 P/M".
  // Take the first GBP amount only and keep the visible field untouched.
  const match = text.match(/£\s*(\d{1,5}(?:\.\d{1,2})?)/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) return null;
  return amount;
}

export function buildMonthlyPriceSyncPatch(item = {}) {
  const data = item?.data || {};
  const numeric = parseRent2BuyMonthlyPrice(data.mth);
  if (numeric === null || !item?.id) return null;

  const current = Number(data.monthlyPriceNumeric);
  if (Number.isFinite(current) && current === numeric) return null;

  return {
    dataItemId: item.id,
    fieldModifications: [
      {
        fieldPath: "monthlyPriceNumeric",
        action: "SET_FIELD",
        setFieldOptions: { value: numeric },
      },
    ],
  };
}

export function summarizeMonthlyPriceSync(items = []) {
  const patches = [];
  const skipped = [];

  for (const item of items) {
    const patch = buildMonthlyPriceSyncPatch(item);
    if (patch) {
      patches.push(patch);
      continue;
    }

    const data = item?.data || {};
    if (parseRent2BuyMonthlyPrice(data.mth) === null) {
      skipped.push({ id: item?.id || null, registration: clean(data.title, 40) || null, mth: clean(data.mth, 80) || null });
    }
  }

  return { patches, skipped };
}
