export async function fetchStockWatchWixListingPresence(pipeline) {
  const response = await fetch(`/api/stock-watch-wix-listing-presence?pipeline=${encodeURIComponent(pipeline)}`, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Could not load live Wix listing presence.");
  }
  return payload;
}
