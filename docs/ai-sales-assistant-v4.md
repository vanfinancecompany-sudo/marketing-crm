# AI Sales Assistant V4

V4 adds conversion and application-journey intelligence to the protected internal customer simulation. It does not create a public chatbot or submit an application.

## Additive journey layer

Conversation intent still describes the current message. V4 separately tracks buying intent, the customer's overall goal, lead completeness, journey stage, progression and the single best next action.

Buying-intent levels are Research, Comparing, Interested, High Intent, Ready To Apply, Application Started and Application Complete. The last state is diagnostic-only for future use.

## Application Mode

An explicit readiness phrase activates Application Mode. The server returns a concise product-specific response and a CTA abstraction:

```json
{
  "type": "application",
  "product": "finance",
  "label": "Start Finance Application",
  "action_key": "start_finance_application",
  "url": null,
  "configured": false
}
```

Rent2Buy uses its own locked product label and action key. URLs are deliberately unconfigured until a separately reviewed Wix design exists.

## Safety

V1–V3 grounding, deterministic coverage and delivery rules, lexical retrieval, Learning Engine logging and strict product locking remain in place. V4 does not collect personal information, calculate approval likelihood, submit an application or create a public endpoint.
