
export function filterCreatives(creatives, filters) {
  const query = String(filters.search || "").trim().toLowerCase();
  const minPrice = parseMoney(filters.minPrice);
  const maxPrice = parseMoney(filters.maxPrice);

  return creatives.filter((creative) => {
    if (filters.pipeline !== "all" && creative.vehicle?.pipeline !== filters.pipeline) {
      return false;
    }
      if (
        filters.status === "reel_asset" &&
        !["reel_asset", "draft", "ready_to_post", "posted"].includes(creative.status)
      ) {
        return false;
      }

      if (
        filters.status !== "all" &&
        filters.status !== "reel_asset" &&
        creative.status !== filters.status
      ) {
        return false;
      }
    if (filters.destination !== "all" && creative.postingChannel !== filters.destination) {
      return false;
    }

    if (query) {
      const haystack = [
        creative.vehicle?.reg,
        creative.vehicle?.name,
        creative.vehicle?.description,
        creative.vehicle?.spec,
        creative.templateType,
        creative.hookStyle,
        creative.cta,
        creative.caption,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) return false;
    }

    const price = parseMoney(creative.vehicle?.price);
    if (minPrice !== null && price !== null && price < minPrice) return false;
    if (maxPrice !== null && price !== null && price > maxPrice) return false;

    return true;
  });
}
