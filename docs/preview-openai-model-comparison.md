# Preview-only OpenAI model comparison

This internal evaluation compares the existing `gpt-4.1-mini` default with the allowlisted `gpt-4.1` model. It does not change Production behavior.

## Preview environment

Add these variables to the Vercel **Preview** environment only:

- `OPENAI_API_KEY` — the existing server-side project key.
- `OPENAI_MODEL=gpt-4.1-mini` — optional because this remains the code fallback, but explicit configuration makes the test baseline clear.
- `OPENAI_COMPARISON_MODEL=gpt-4.1` — enables the allowlisted comparison model.

Do not add `OPENAI_COMPARISON_MODEL` to Production. The server also checks `VERCEL_ENV=preview`, so comparison actions return 404 outside Preview even if the variable is accidentally present.

## Fair run

The protected endpoint classifies the message, builds memory, applies the product boundary, resolves deterministic rules, chunks articles in memory, ranks evidence and creates the existing V5 prompt once. The two OpenAI requests differ only by the server-selected model identifier. Results are no-store and model errors are isolated.

Comparison runs are non-mutating snapshots: neither result is appended to the normal simulation transcript or the other model’s history. Controlled scenarios provide a fixed identical history for short and contextual messages.

## Pricing

Reviewed pricing values live in `lib/openAIModelConfiguration.js` and are labelled estimates in the UI. They were reviewed against official OpenAI model pages on 2026-08-06:

- `gpt-4.1-mini`: $0.40 input / $1.60 output per million text tokens; cached input $0.10.
- `gpt-4.1`: $2.00 input / $8.00 output per million text tokens; cached input $0.50.

Update that one reviewed configuration when official pricing changes.

## Project availability

On Preview, the protected configuration action checks both configured identifiers against `GET /v1/models/{model}` using the server-side API key. Failure is reported per model without exposing the key. The repository workspace used to build this change did not contain an API key, so project access must be confirmed after the Preview variables are added.
