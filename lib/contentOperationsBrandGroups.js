// Presentation-only grouping for the Content Operations activity cards.
// No new targets, posting behaviour, or tracking changes.
export const CONTENT_OPERATIONS_BRANDS = Object.freeze([
  { key: "van-finance", name: "Van Finance Company", description: "Finance advertising, social channels and content" },
  { key: "rent2buy", name: "Rent2Buy Vans", description: "Rent2Buy social channels and application marketing" },
  { key: "vansco", name: "Vansco", description: "DealerKit stock, social channels and Google Business" },
  { key: "shared", name: "Shared marketing", description: "Marketing emails and Knowledge Hub" },
]);

export function contentOperationsBrandForType(type) {
  const value = String(type || "");
  if (value.startsWith("van_finance_")) return "van-finance";
  if (value.startsWith("rent2buy_")) return "rent2buy";
  if (value.startsWith("vansco_")) return "vansco";
  return "shared";
}

export function groupContentOperationsMetrics(metrics = []) {
  const items = Array.isArray(metrics) ? metrics : [];
  return CONTENT_OPERATIONS_BRANDS.map(brand => ({
    ...brand,
    metrics: items.filter(metric => contentOperationsBrandForType(metric?.type) === brand.key),
  }));
}
