# AI Assistant Phase 1 — Wix Customer Integration Foundation

This phase exposes the existing AI Sales Assistant through a narrow server endpoint for the Van Finance Company Wix website. It does not include a Wix widget and does not support the separate Rent2Buy website.

## Endpoint

`POST /api/ai-assistant-customer`

Every request must originate from an allowed Van Finance Company Wix origin and must include `page_context.pageType` as one of:

- `finance_vehicle`
- `finance_general`
- `rent2buy_general`
- `homepage`

Responses contain only:

```json
{
  "reply": "Customer-facing text",
  "cta": null,
  "conversation_id": "opaque anonymous token",
  "status": "ready"
}
```

No Business Brain content, retrieval sources, prompts, diagnostics, scores, model information, or API keys are returned.

### Start a conversation

```json
{
  "action": "start",
  "page_context": {
    "pageType": "finance_vehicle",
    "vehicle": {
      "registration": "AB12 CDE",
      "vehicle_id": "optional Wix item identifier",
      "title": "Ford Transit Custom"
    }
  }
}
```

### Send a message

```json
{
  "action": "message",
  "conversation_id": "value returned by start",
  "page_context": {
    "pageType": "finance_vehicle",
    "vehicle": {
      "registration": "AB12 CDE"
    }
  },
  "message": "Can I apply for this van?"
}
```

On `homepage`, Wix may pass `product_choice` as `finance` or `rent2buy` after the visitor chooses. Without an explicit choice, the server uses the existing product detector and asks the visitor to choose whenever the result is unclear. Once set, the product is locked in the anonymous session.

## CTA contract

| Page context | Label | Behaviour |
| --- | --- | --- |
| `finance_vehicle` | Apply for this van | `open_current_page_finance_application`; remain on the current page |
| `finance_general` | Start Finance Application | Same-window navigation to `https://www.vanfinancecompany.co.uk/apply-by-reg-finance/application-form` |
| `rent2buy_general` | Start Rent2Buy Application | Same-window navigation to `https://www.vanfinancecompany.co.uk/rent2buy-application` |
| `homepage` | Product-specific application label | Same-window navigation after product lock |

The future Wix widget owns the DOM action for `open_current_page_finance_application`. It must open or scroll to the existing application already embedded on the vehicle page; the assistant endpoint never submits an application and never navigates away from that page.

## Server configuration

Required server-only environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (already used by the existing assistant)
- `OPENAI_MODEL` (optional existing override)
- `AI_ASSISTANT_SESSION_SECRET` — a new high-entropy secret used to hash anonymous conversation tokens and IP rate-limit keys
- `AI_ASSISTANT_ALLOWED_ORIGINS` — optional comma-separated exact origins; defaults to `https://www.vanfinancecompany.co.uk,https://vanfinancecompany.co.uk`

No environment values are exposed to Wix or returned by the endpoint.

## Security and storage

- Origin validation is exact; lookalike domains are rejected.
- Responses and CORS preflights use no-store behaviour.
- Database-backed limits allow 15 requests per minute and 200 per day per hashed network address.
- Each anonymous session expires after 24 hours and is capped at 100 customer messages.
- Public conversation tokens are stored only as keyed hashes.
- Common email, phone, payment-card, bank and National Insurance patterns are redacted before conversation persistence.
- Browser roles receive no table or rate-limit-function permissions; the endpoint uses the existing server-side Supabase service role.
- Prompt-leakage requests receive a fixed customer-safe response and do not enter the AI engine.

The session stores only conversation state needed by the assistant: history, product lock, vehicle context, application readiness, budget, employment, remembered facts and journey state. It does not create a CRM customer or application record.

## Existing behaviour reused unchanged

The endpoint calls `simulateCustomerConversation` from the existing competence/simulation backend. That preserves the current conversation prompts, V6 orchestration, Business Brain, Knowledge Hub retrieval, product separation, deterministic rules, model selection, Learning Engine capture and Knowledge Opportunities analysis.
