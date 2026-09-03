async function callFinanceReservedWixStock(payload) {
  const response = await fetch("/api/finance-reserved-wix-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) {
    throw new Error(result?.message || "Could not check Van Finance Wix stock.");
  }
  return result;
}

export function previewReservedFinanceWixStock(registration) {
  return callFinanceReservedWixStock({ action: "preview", registration });
}

export function unpublishReservedFinanceWixStock(registration) {
  return callFinanceReservedWixStock({ action: "unpublish", registration, confirmed: true });
}
