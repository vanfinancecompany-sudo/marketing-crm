# Website Analytics freshness investigation

On 21 August 2026 the Marketing CRM Website Analytics screen was still reporting `settledThrough: 2026-08-17` even though Wix's Semantic Model API already contained complete traffic data for 18, 19 and 20 August.

The existing browser page bypasses cache and reads the public Wix Velo endpoint `/_functions/marketingWebsiteAnalytics`, so the stale cutoff is upstream of the CRM browser.

This branch first adds a narrow server-side probe using the Marketing CRM's existing `WIX_API_KEY` and `WIX_SITE_ID`. It queries the same Wix traffic semantic model directly. Once production credentials are proven to have Site Analytics read access, the probe will be replaced by the permanent freshness fix and removed.
