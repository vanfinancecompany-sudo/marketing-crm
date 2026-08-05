# Deterministic product coverage rules

This change extends the internal AI Assistant Competence Test and the reusable server-side assistant evidence path. It does not add a public endpoint, Wix chatbot, embeddings, vectors or stored chunks.

## Approved settings

The Knowledge Hub **Business Settings** screen edits the approved values stored on the `knowledge_settings` default row:

- `finance_covered_nations`: England, Wales and Scotland by default.
- `rent2buy_base_postcode`: `SO40 2NN` by default.
- `rent2buy_max_radius_miles`: 100 by default.
- `coverage_borderline_tolerance_miles`: 10 by default, making 90–110 miles inclusive borderline.
- `coverage_distance_method`: `straight_line` (Haversine) only.

Migration `supabase/migrations/034_product_coverage_settings.sql` adds these settings and the competence-result diagnostics JSON field.

## Resolution and evidence priority

Finance coverage is resolved directly from the approved nation list and does not call a geocoder. Rent2Buy extracts a full UK postcode first, otherwise a supplied town/city, and resolves both the configured base postcode and customer location through Postcodes.io. Every provider request is server-side, has `cache: "no-store"`, and is aborted after the configured timeout.

The resulting deterministic fact is inserted as source `S1` with score `1000`. The prompt marks that conclusion as non-overridable and places it above Business Brain, article evidence and model inference. Retrieved knowledge that contradicts the approved radius/nation rule or the calculated result is recorded in `coverage_diagnostics.conflicting_sources`; backend result persistence forces `conflict_detected` to true independently of the model response.

## Provider and configuration

Provider: [Postcodes.io](https://postcodes.io/), using `GET /postcodes/:postcode` and `GET /places?q=...&limit=1`.

Required environment variables: none. The public Postcodes.io API requires no API key.

Optional server-only environment variables:

- `POSTCODES_IO_BASE_URL` — defaults to `https://api.postcodes.io` and permits a self-hosted compatible service.
- `COVERAGE_GEOCODING_TIMEOUT_MS` — defaults to 4000 ms and is clamped to 500–10000 ms.

Postcodes.io is documented as free and open source. Its public documentation does not publish a requests-per-second quota for the hosted endpoint; the place query returns 10 results by default and supports at most 100, while this implementation requests one. For predictable high-volume production traffic, the provider documents self-hosting as an option.

## Failure behaviour

If the location is absent, invalid, unmatched, the base postcode cannot resolve, the provider times out, returns a non-success status, or returns malformed coordinates:

1. no distance is calculated or inferred;
2. diagnostics return `coverage_result: "unresolved"` and `certainty: "unresolved"`;
3. deterministic evidence tells the assistant to ask for the customer's full home postcode and not confirm coverage;
4. the competence request continues gracefully to answer generation.

Town/city matches are always `indicative`, even when clearly inside or outside the normal area, and require a full home postcode before confirmation. Full postcode matches are `confirmed` except that any distance in the inclusive borderline band is `borderline` and requires manual confirmation.
