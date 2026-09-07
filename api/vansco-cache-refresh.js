import {
  CACHE_TABLE,
  extractVanscoId,
  getSupabaseAdmin,
  normalizeUrl,
  vehicleTitleFromUrl,
  detectVehicleCategory,
} from "./_vansco-cache-utils.js";
import {
  discoverAllVanscoUrls,
  getPreviousVanscoUrlSnapshot,
  markConfirmedAbsentVanscoRows,
} from "./_vansco-url-snapshot-safety.js";

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const previousSnapshot = await getPreviousVanscoUrlSnapshot(supabase);
    const discovery = await discoverAllVanscoUrls();
    const now = new Date().toISOString();
    const urls = Array.from(new Set(discovery.urls.map(normalizeUrl).filter(Boolean)));

    if (!urls.length) {
      response.status(502).json({
        ok: false,
        message: "Could not find current Vansco vehicle URLs from sitemap. Existing cached stock was left unchanged.",
        discoveryAttempts: discovery.attempts,
      });
      return;
    }

    const rows = urls.map((stockUrl) => {
      const title = vehicleTitleFromUrl(stockUrl);
      return {
        stock_url: stockUrl,
        vansco_id: extractVanscoId(stockUrl) || null,
        title,
        vehicle_type: detectVehicleCategory(title, stockUrl),
        first_seen_at: now,
        last_seen_in_url_list_at: now,
        is_currently_on_vansco: true,
        updated_at: now,
      };
    });

    const { error: upsertError } = await supabase
      .from(CACHE_TABLE)
      .upsert(rows, { onConflict: "stock_url", ignoreDuplicates: false });

    if (upsertError) throw upsertError;

    const stale = await markConfirmedAbsentVanscoRows(supabase, {
      previousSnapshotAt: previousSnapshot.snapshotAt,
      refreshedAt: now,
    });

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      fetchedAt: now,
      sitemapUrl: discovery.sitemapUrl,
      sitemapUrls: discovery.sitemapUrls,
      discoveryAttempts: discovery.attempts,
      urlsFound: urls.length,
      rowsUpserted: rows.length,
      previousActiveCount: previousSnapshot.activeCount,
      staleRowsMarked: stale.staleRowsMarked,
      staleMarkingSkipped: stale.staleMarkingSkipped,
      staleMarkingReason: stale.reason,
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Could not refresh Vansco cache URL list." });
  }
}
