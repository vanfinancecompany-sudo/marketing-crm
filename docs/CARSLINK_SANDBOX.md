# Carslink.ai sandbox stock sync

This integration is sandbox-only until Carslink production access is approved.

## Source of truth

- Current live stock: `facebook_adverts` rows where `is_active = true`
- Vehicle enrichment / galleries: Wix `VANFINANCEPAGES`, matched by registration
- Customer destination URLs: `https://vanfinance.co` using the Wix vehicle page path where available

## Endpoint

`/api/carslink-sandbox-sync`

### Preview only

`GET /api/carslink-sandbox-sync?limit=10`

Builds and returns the Carslink payload without sending anything externally.

### Send to Carslink sandbox

`POST /api/carslink-sandbox-sync`

JSON body:

```json
{
  "confirmSandbox": true,
  "limit": 10
}
```

The endpoint always uses `mode: full_replace`. During the controlled sandbox test keep the limit fixed to the complete sandbox test set so listings absent from a later batch are not unexpectedly removed.

## Required environment variables

Existing Marketing CRM variables:

- `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `VITE_SUPABASE_ANON_KEY`)
- `WIX_API_KEY`
- `WIX_SITE_ID`

Carslink:

- `CARSLINK_SANDBOX_API_KEY` — sandbox key from the Carslink developer portal. Do not commit this value.

Optional dealer overrides:

- `CARSLINK_PARTNER_DEALER_ID` (defaults to `vanfinance-company`)
- `CARSLINK_DEALER_NAME` (defaults to `Van Finance Company`)
- `CARSLINK_DEALER_POSTCODE` (defaults to `SO40 2NN`)
- `CARSLINK_DEALER_PHONE`
- `CARSLINK_DEALER_EMAIL`
- `CARSLINK_DEALER_WEBSITE` (defaults to `https://vanfinance.co`)

## Carslink rules handled

- `vehicle_type = van`
- minimum 4 HTTPS images; up to 8 are sent
- `source_id` is the normalized registration for stable dedupe/update behavior
- required make/model/year/mileage/price/registration are validated locally before send
- transmissions are normalized to Carslink's accepted enum values
- optional van fields are populated only where existing source text supports them
- descriptions and listing URLs point customers back to VanFinance.co

## Safety

The API key previously shown in a screenshot should be rotated before configuring the deployment environment. The integration never embeds an API key in source control.
