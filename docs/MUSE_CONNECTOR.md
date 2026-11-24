# Meta Muse connector (read-only)

Lets Meta Muse for Small Business explore the Marketing CRM and suggest
commercial opportunities, using aggregated or redacted data only.

## Connection details (Muse → Custom Connector)

| Setting | Value |
|---|---|
| Base URL | `https://marketing-crm-six.vercel.app` (production, after merge and promotion) |
| Auth type | API key in header |
| Header name | `x-muse-api-key` (or `Authorization: Bearer <key>`) |
| Key | `MUSE_API_KEY`, a sensitive Vercel env var. Given to the owner privately, never committed. |
| OpenAPI | `https://marketing-crm-six.vercel.app/api/muse/openapi` (public, describes the endpoints but returns no data) and `docs/muse-connector.openapi.json` |

To rotate the key, change `MUSE_API_KEY` in Vercel (Production and Preview), redeploy, and update Muse.
To cut Muse off at once, delete the env var and redeploy: every request then gets 401.

## Endpoints (all `GET`)

| Path | What Muse gets |
|---|---|
| `/api/muse/index` | List of resources |
| `/api/muse/overview` | Counts across stock, contacts (counts only), campaigns, email, content, knowledge, AI visibility, Vansco stock watch |
| `/api/muse/stock?q=&limit=` | Advertised Finance and Rent2Buy vans: price, monthly, spec, link, 30-day page views, top viewed |
| `/api/muse/website-analytics` | Traffic for the last 7 settled days vs previous 7, and today's finance application funnel (step counts) |
| `/api/muse/ask-me?days=` | Ask Me engagement: opens, conversations, CTA clicks, knowledge gaps, Knowledge Hub searches |
| `/api/muse/conversations?days=` | Enquiry volumes by channel, product and day (counts only) |
| `/api/muse/opportunities?product=&limit=` | Customer demand themes and content gaps learned by Ask Me, with priority |
| `/api/muse/campaigns?limit=` | Campaigns with production email send totals |
| `/api/muse/capabilities` | What the CRM can do today (for planning) |

Every response is `{ resource, generatedAt, readOnly: true, data }`.

Example (`/api/muse/stock?limit=1`, values illustrative):

```json
{
  "resource": "stock",
  "readOnly": true,
  "data": {
    "counts": { "finance": 42, "rent2buy": 18 },
    "top_viewed_30d": [{ "registration": "AB12CDE", "views_30d": 57 }],
    "vehicles": {
      "finance": [{ "product": "finance", "title": "Ford Transit Custom", "price": 15995, "spec": "L1H1", "url": "https://..." }],
      "rent2buy": [{ "product": "rent2buy", "registration": "AB12CDE", "monthly": 499, "views_30d": 57, "url": "https://..." }]
    }
  }
}
```

Example (`/api/muse/opportunities`):

```json
{
  "resource": "opportunities",
  "data": {
    "count": 2,
    "items": [
      { "product": "finance", "theme": "credit_eligibility", "topic": "Finance applications with credit difficulties", "priority_level": "high", "questions": 12, "unanswered": 3, "recommended_actions": ["create_faq"] },
      { "product": "rent2buy", "theme": "other", "topic": "Rent2Buy: other customer questions", "questions": 5 }
    ]
  }
}
```

## Privacy and safety

- Dedicated key. The CRM's internal key (`MARKETING_CUSTOMER_DATABASE_API_KEY`) does not work here, and Muse never sees it.
- GET only (any other method gets 405). There are no write, send, publish or campaign actions.
- Never returned: names, emails, phone numbers, addresses or postcodes, customer, session or visitor IDs, application or finance details, conversation text or excerpts.
- Each loader selects only safe columns. Every response then goes through `scrubForMuse` (drops sensitive field names, redacts emails, phones, postcodes and long numbers) and a final privacy check that withholds the response if contact details still appear.
- Rate limit: 60 requests per minute per client (per serverless instance).
- Tests: `tests/muse-connector.test.mjs` (auth, read-only, no PII from PII-laden fixtures).

Theme titles: Muse only ever sees titles from a fixed, business-written list of
eight themes per product (coverage, upfront costs, how it works, credit,
applying, documents, monthly costs, vehicle choice). Intents that the learning
engine built from a customer's own words are merged into "other customer
questions". Knowledge Hub search text is replaced the same way (`no_result_themes`).
Action and status fields are passed through only if they match a fixed list of values.

The Muse key is used only by `/api/muse/*`. Every other CRM endpoint checks its own key, and refuses the Muse key.
