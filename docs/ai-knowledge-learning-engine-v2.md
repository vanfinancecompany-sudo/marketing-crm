# AI Knowledge Learning Engine V2

## Purpose

V2 converts weak, unanswered, conflicting, and repeated AI Assistant Competence Test results into grouped internal knowledge opportunities. It improves the evidence base rather than hiding missing knowledge with prompt engineering. It does not provide a public assistant.

## Candidate assessment

Each saved competence result is assessed server-side. A candidate can be created from an explicit knowledge gap, conflict, confidence below `knowledge_settings.assistant_confidence_threshold`, weak human review, low accuracy/helpfulness, no article source, or generic Business Brain-only evidence. Confidence alone is not proof. `Needs Adjustment`, `Incorrect`, `Too Vague`, low accuracy, and low helpfulness carry explicit human-review weight.

The protected **Analyse Existing Competence Results** action performs the same assessment for historical results. It is manual and idempotent: `(product, normalised_intent)` uniquely identifies an opportunity and each competence result can be linked only once.

## Deterministic grouping

Grouping uses normalised text, product context, known phrase variants, important terms, intent rules, and the existing Knowledge Hub category boundary. It does not use embeddings or AI classification.

Finance and Rent2Buy always have different group keys. The dedicated `Rent2Buy` Knowledge Hub category remains the Rent2Buy article boundary. Other relevant categories remain Finance.

Common variants such as `deposit`, `upfront payment`, `initial rental`, and `money down` are reduced to one concept before grouping. Broad product-explanation and application phrases are handled similarly.

## Location abstraction

Known UK place wording is extracted for examples and replaced with a location token for grouping. Manchester, Leeds, Portsmouth, Birmingham, Scotland, and Wales therefore remain visible under `observed_locations`, while the opportunity describes the general coverage or collection rule. The system does not create one article per town.

## Transparent priority

Priority is a bounded 0–100 sum of visible components:

- Frequency: up to 25
- Unanswered results: up to 20
- Poor reviews: up to 20
- Conflicts: up to 15
- Purchase/application intent: up to 10
- Recency: up to 10
- Existing article coverage: minus 8

Levels are Critical (75+), High (50+), Medium (25+), and Low. The UI displays every component.

## Diagnosis types

- **Knowledge gap:** no sufficiently related approved Business Brain or article evidence exists.
- **Retrieval problem:** related approved knowledge exists but the competence result did not use it.
- **Answer-quality problem:** human review says the answer was inaccurate, unhelpful, vague, or otherwise weak even when sources existed.
- **Business Brain problem:** a business rule exists but is incomplete or unclear.
- **Article problem:** an approved article is related but incomplete.
- **Conflict:** relevant sources disagree.

These are recommendations for administrator review, never automatic decisions.

## Review workflow

Open `/ai-knowledge-opportunities`, unlock it with the existing Marketing CRM key, and run the historical analysis when required. Open a grouped opportunity to inspect all original questions, results, answers, sources, reviews, related articles, Business Brain guidance, suggested content, priority components, and audit history.

Status and notes changes are manual and create audit events. Linking or generating an article does not mark an opportunity completed.

## Draft actions

**Create Knowledge Hub Draft** creates a normal Knowledge Hub topic with grouped evidence, then calls the existing article-generation workflow. Product determines the existing Finance or Rent2Buy template and category. The resulting `knowledge_articles` record remains `draft`; it is neither approved nor sent to Wix.

**Create FAQ Draft** writes only to `knowledge_assistant_faq_drafts`. The administrator chooses Business Knowledge Centre, existing article, or new article as the intended destination. It does not alter active FAQs.

## Improvement tracking

When an article is manually linked, `linked_at` forms the before/after boundary. Later competence results display unanswered count, confidence, accuracy, and helpfulness on each side. V2 does not claim causation; administrators must confirm whether later results retrieved the linked article.

## Future Wix assistant extension

A future authenticated server ingestion endpoint may write anonymous public-assistant question results into the same candidate pipeline. It should supply a product context and non-identifying question text, then use the same deterministic grouping functions. V2 deliberately includes no public endpoint, conversation store, customer identity, Wix component, or conversion tracking.

## Out of scope

- Public Wix assistant or chatbot
- Embeddings, pgvector, or semantic retrieval
- Changes to V1 lexical retrieval
- Automatic article/FAQ approval or Wix publishing
- Automatic Business Brain edits
- Customer communications or personal data
- Automatic completion of opportunities
