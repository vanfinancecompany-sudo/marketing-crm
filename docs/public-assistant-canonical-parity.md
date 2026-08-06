# Public Assistant Canonical Parity

## Architectural rule

The Wix widget is a floating display and page-context bridge. It does not own conversational intelligence. Every customer turn after product selection must use the same `simulateCustomerConversation` runner used by the Marketing CRM competence and health systems.

## Public boundary responsibilities

The public endpoint may handle only:

- exact-origin validation and CORS
- anonymous session creation and expiry
- database-backed rate limiting
- sensitive identifier redaction
- page and vehicle context validation
- explicit Finance or Rent2Buy selection supplied by the customer or widget
- safe customer response projection and approved Wix CTA actions

It must not rewrite factual questions, generate product explanations, reduce canonical remembered facts, or maintain a separate journey model.

## Canonical state contract

For every selected-product turn the endpoint passes these fields unchanged into the canonical runner:

- original customer message
- complete bounded conversation history
- selected product context
- complete canonical remembered facts
- complete canonical journey state from the previous result

It then persists the complete returned canonical result as the next journey state and the returned remembered facts as the next memory state.

Transport-only greetings and product-selection acknowledgements are not inserted into canonical history. A pre-selection product comparison is answered by the canonical runner. Choosing Finance or Rent2Buy after a comparison resets pre-selection state before starting the selected-product conversation.

## Deployment gate

The Vercel build runs the public foundation, canonical-state, homepage comparison, and Finance/Rent2Buy parity replay tests. The public route must not be merged while any of these gates fail.

## Remaining acceptance work

Before customer rollout, representative deterministic and live competency scenarios must be replayed through the deployed public endpoint and evaluated against the canonical runner for product separation, retrieval, evidence, memory, confidence, application progression, and safe response behaviour.
