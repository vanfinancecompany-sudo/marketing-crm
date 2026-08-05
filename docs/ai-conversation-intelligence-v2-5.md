# AI Conversation Intelligence V2.5

V2.5 is an internal simulation layer for testing whether a future website assistant can converse naturally while remaining grounded. It does not add a public endpoint, Wix component, contact form, callback workflow, embeddings, vectors or automatic Knowledge Hub changes.

## Open the simulator

1. Deploy the branch after applying migrations 033, 034 and 035 to the Preview Supabase environment.
2. Open `/ai-customer-simulation` in the Marketing CRM Preview.
3. Unlock it with the existing Marketing CRM access mechanism.
4. Select the locked Finance or Rent2Buy context. Changing product resets the session.

The simulator is for synthetic test wording only. Do not paste real customer personal data into it.

## Request flow

All requests use the existing protected `/api/marketing-ai-assistant-competence` endpoint with `cache: "no-store"`.

1. The server preserves the original message and creates a normalised working copy.
2. A deterministic intent stage returns primary intent, sub-intents, detected product, retrieval/clarification decisions, confidence and reason. It cannot change the locked product.
3. Conversation history is replayed server-side into current facts and explicit correction records.
4. Greetings, general help, thanks, goodbye, handoff, frustration, clarification and application-intent messages use short server-controlled responses without article retrieval.
5. Business-information messages apply the existing product boundary, temporary Markdown sectioning and lexical ranking.
6. Coverage questions reuse the unchanged deterministic Finance/Rent2Buy coverage engine. Its S1 conclusion remains non-overridable.
7. OpenAI composes a reply only when approved business evidence is available. The response uses strict JSON Schema and the server controls intent, memory, product context, deterministic diagnostics and conflicts.
8. Missing approved evidence returns the standard no-guess fallback and can enter the V2 learning workflow.

## Scenario testing

The built-in library contains 152 balanced Finance/Rent2Buy scenarios across 19 categories, including informal wording, misspellings, partial messages, corrections and multi-turn conversations.

- **Run One Scenario** resets the current transcript and processes every message in the selected scenario in order.
- **Run Grouped Scenario Set** runs the selected category for the currently selected product.
- **Edit realistic customer-message library** exposes working JSON for temporary in-browser edits. It does not alter approved business knowledge or persist scenario definitions.
- **Reset Conversation** creates a new session ID and clears transcript, facts, corrections and the previous result.

## Review and learning

Migration `035_ai_conversation_intelligence_v2_5.sql` adds structured conversation diagnostics and simulation session IDs to internal competence results, plus the ten requested reviewer ratings and new conversation outcomes.

The learning engine excludes greetings, thanks, goodbye, broad help and successful deterministic coverage from content opportunities. Eligible failures can be diagnosed as missing knowledge, retrieval weakness, conversation-intent weakness, misspelling/normalisation weakness, context-memory failure or clarification behaviour issue.

## Known limitations

- Intent detection and normalisation are deliberately small and deterministic; unusual slang or locations outside the common-place detector may require clarification.
- Town/city geocoding remains indicative. Only full postcodes can be confirmed, subject to the existing borderline and provider-fallback rules.
- Retrieval remains lexical and uses temporary in-memory Markdown sections.
- The scenario editor is deliberately temporary and browser-local.
- No live customer contact, callback, application submission or Wix frontend is implemented.
