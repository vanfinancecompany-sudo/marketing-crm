# DealerKit quote freshness: operational release gate

**Status: not approved for customer traffic.** Existing monitoring must not be accelerated without supplier evidence.

## Read-only measurements on 23 October 2026

- Current stock monitor: 15-minute schedule in vercel.json, /api/stock-watch-monitor-agent.
- Trailing 24 hours: **96/96 complete** DealerKit monitoring runs, p95 start interval **900.5 seconds**, average run **5.61 seconds**, maximum duration **17.73 seconds**.
- Draft authoritative pricing snapshot expires **90 seconds** after source inspection, not after Supabase insertion.
- At most **9.99%** theoretical time overlap between 90-second validity and the existing 15-minute monitor schedule. This is not observed customer quote uptime, and does not prove ongoing advertisement status.
- DealerKit detail GET /integrators/stock/{id} can re-read stock, but we have **not** established whether it still returns stock after de-advertising. A successful detail read is not reliable proof the vehicle is still in the advertising-aware listing.

The verified SELECT-only report is docs/sql/rent2buy_quote_stock_readiness_READ_ONLY.sql. Pure readiness tests are in lib/rent2BuyQuoteReadiness.mjs and tests/rent2buy-quote-readiness.test.mjs. Neither triggers provider scans, CRM writes, or price publishing.

## Evidence-based options

1. **Provider-confirmed per-stock advertised check**: Ask DealerKit to document a supported API/response field proving current advertising-feed membership and its guarantees after Reserved, Awaiting Delivery, Sold, de-advertising and stock-ID reuse. Establish request quotas, then test known transitions. Only then consider a low-cost per-vehicle freshness check.
2. **Provider stock change events**: If authenticated webhooks with ordering/retry guarantees exist, use them to invalidate verified versions after state changes while the complete snapshot remains a reconciliation source. This requires a separate security and operations review.
3. **No current-advert proof**: Keep strict 90-second fail-closed quoting, or, with explicit business approval, make the calculator an indicative, availability-dependent enquiry rather than a verified offer. Never silently change the promise or extend TTL.

## Supplier questions to resolve

- Does GET /integrators/stock/{id} return stock after it is Reserved, Awaiting Delivery, Sold, or no longer advertised?
- Is there a documented lightweight per-vehicle active-advertising-membership endpoint or flag, with unambiguous errors/404 semantics?
- Are stock-status/deadvertising webhooks available and authenticated, with ordering and retry guarantees?
- What are the per-minute and hourly quotas for full pagination, individual detail and any status-only checks? What 429 retry guidance applies?
- Can stock IDs be reused and can unadvertised stock reappear under the same ID? Which revision timestamps are authoritative?

Developer portal: https://developers.dealerkit.co.uk ; DealerKit's public Postman Integrator workspace is also discoverable. Neither supplied a verified answer to these particular advertised-status questions in our research.

## Release conditions unchanged

Do not change the 15-minute cron, 90-second TTL, live Wix prices, active Supabase schema, special-deal terms or quote feature flags. Do not invent additional DealerKit endpoints or treat last-known stock rows as current. Existing four specials, VAT basis, contractual terms, preview E2E application/CRM/email testing and inspected desktop/mobile layout must all be approved before production launch.