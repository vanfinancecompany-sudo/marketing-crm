import {
  CACHE_TABLE,
  SITEMAP_URLS,
  extractVehicleUrls,
  fetchHtml,
  normalizeUrl,
} from "./_vansco-cache-utils.js";

export const VANSCO_URL_DISCOVERY_TIMEOUT_MS = 10000;

export async function discoverAllVanscoUrls() {
  const attempts = [];
  const discovered = new Set();
  const successfulSources = [];

  for (const sitemapUrl of SITEMAP_URLS) {
    try {
      const page = await fetchHtml(sitemapUrl, VANSCO_URL_DISCOVERY_TIMEOUT_MS);
      const urls = page.ok ? extractVehicleUrls(page.html) : [];
      attempts.push({
        sitemapUrl,
        ok: page.ok,
        status: page.status,
        elapsedMs: page.elapsedMs,
        htmlLength: page.htmlLength,
        urlsFound: urls.length,
      });
      if (page.ok && urls.length) successfulSources.push(sitemapUrl);
      for (const url of urls) {
        const normalized = normalizeUrl(url);
        if (normalized) discovered.add(normalized);
      }
    } catch (error) {
      attempts.push({
        sitemapUrl,
        ok: false,
        errorName: error?.name || "Error",
        errorMessage: error?.message || "Fetch failed",
        timeout: error?.name === "AbortError",
      });
    }
  }

  return {
    sitemapUrl: successfulSources[0] || "",
    sitemapUrls: successfulSources,
    attempts,
    urls: [...discovered],
  };
}

export async function getPreviousVanscoUrlSnapshot(supabase) {
  const [{ data: latest, error: latestError }, { count, error: countError }] = await Promise.all([
    supabase
      .from(CACHE_TABLE)
      .select("last_seen_in_url_list_at")
      .eq("is_currently_on_vansco", true)
      .not("last_seen_in_url_list_at", "is", null)
      .order("last_seen_in_url_list_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from(CACHE_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("is_currently_on_vansco", true),
  ]);

  if (latestError) throw latestError;
  if (countError) throw countError;

  return {
    snapshotAt: latest?.last_seen_in_url_list_at || "",
    activeCount: Number(count || 0),
  };
}

export async function markConfirmedAbsentVanscoRows(
  supabase,
  {
    previousSnapshotAt,
    refreshedAt,
  } = {}
) {
  if (!previousSnapshotAt) {
    return {
      staleRowsMarked: 0,
      staleMarkingSkipped: true,
      reason: "No previous successful URL snapshot exists yet.",
    };
  }

  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .update({
      is_currently_on_vansco: false,
      updated_at: refreshedAt,
    })
    .eq("is_currently_on_vansco", true)
    .lt("last_seen_in_url_list_at", previousSnapshotAt)
    .select("id");

  if (error) throw error;

  return {
    staleRowsMarked: Array.isArray(data) ? data.length : 0,
    staleMarkingSkipped: false,
    reason: "Only URLs missing from two consecutive successful snapshots were marked absent.",
  };
}
