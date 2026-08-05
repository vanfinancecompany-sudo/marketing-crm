# AI Sales Conversation Engine V3

V3 extends the protected `/ai-customer-simulation` competence tester. It remains an internal synthetic-testing tool and does not expose a Wix assistant or public chat endpoint.

## Conversation behaviour

- Product context remains locked to Finance or Rent2Buy.
- Short messages target no more than 45 words; normal questions no more than 90; complex questions no more than 130.
- The assistant asks at most one useful follow-up question.
- Buying signals guide a next action without implying eligibility or approval.
- Structured memory stores current customer facts, correction history, extraction confidence and source message identifiers.
- Unsupported business claims continue to use the verified-information fallback and feed the V2 Learning Engine.

## Deterministic delivery rules

- Qualifying Finance vehicle purchases receive free delivery across England, Wales and Scotland. Timing depends on approval, vehicle preparation and scheduling and is never guaranteed.
- Rent2Buy vehicles are collected from Southampton and must never be described as having free nationwide delivery. Its 100-mile home-address rule remains unchanged.

Delivery evidence is inserted at score 1000 and a server-owned reply overrides model wording for direct delivery questions.

## Testing

Apply migration `036_ai_sales_conversation_engine_v3.sql` to the intended Preview database, open `/ai-customer-simulation`, lock a product and run individual messages or the V3 scenario groups. Use synthetic wording only.
