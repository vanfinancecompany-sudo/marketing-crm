async function callRent2BuyReservedWixStock(payload) {
  const response = await fetch("/api/rent2buy-reserved-wix-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) {
    throw new Error(result?.message || "Could not check Rent2Buy Wix stock.");
  }
  return result;
}

export function previewReservedRent2BuyWixStock(registration) {
  return callRent2BuyReservedWixStock({ action: "preview", registration });
}

export function unpublishReservedRent2BuyWixStock(registration) {
  return callRent2BuyReservedWixStock({ action: "unpublish", registration, confirmed: true });
}
