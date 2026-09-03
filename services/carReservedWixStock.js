async function callCarReservedWixStock(payload) {
  const response = await fetch("/api/car-reserved-wix-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) {
    throw new Error(result?.message || "Could not check car Wix stock.");
  }
  return result;
}

export function previewReservedCarWixStock(registration) {
  return callCarReservedWixStock({ action: "preview", registration });
}

export function unpublishReservedCarWixStock(registration) {
  return callCarReservedWixStock({ action: "unpublish", registration, confirmed: true });
}
