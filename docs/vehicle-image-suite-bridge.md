# Vehicle Image Suite DealerKit bridge

GET /api/vehicle-image-suite-stock?registration=CP16AZW returns only ok, exact registration, supplierStockId, primaryImage and ordered images ({ url, order }). Other methods return 405.

Uses the existing _dealerkit-stock-adapter.js and Marketing CRM's DEALERKIT_API_SECRET / DEALERKIT_DEALER_ID. No new credentials, Supabase reads, stock mutations or internal CRM fields. Only available/reserved/deposit_taken stock is returned. Exact identity is checked again against detail; duplicates and unstable snapshots fail closed. Known unreadable baseline rows are accepted only under the existing adapter's baselineOnly diagnostic.

Stock snapshots are shared for five minutes per warm instance, with concurrent requests coalesced and failed snapshot reads backed off for 30 seconds. Detail galleries are cached for five minutes (max 300 entries), also coalesced. Cold/serverless instances may each read a snapshot; this is not a global distributed cache.

Vehicle Image Suite calls this from its server-side /api/dealerkit-images route, so CORS/browser credentials are unnecessary. Its optional server environment DEALERKIT_BRIDGE_URL must point to this endpoint; the default is https://marketing-crm-six.vercel.app/api/vehicle-image-suite-stock.

This PR does not merge or deploy. The feature branch disables automatic Vercel deployments. Live use remains unavailable until the bridge is separately approved and deployed to the configured CRM origin. Tests use injected stock/detail fixtures and do not contact DealerKit.
