export const OPPORTUNITY_STATUSES = Object.freeze([
  "new", "reviewing", "covered_existing", "improve_business_brain", "improve_existing_article",
  "create_faq", "create_article", "dismissed", "completed",
]);

export const OPPORTUNITY_STATUS_LABELS = Object.freeze({
  new: "New",
  reviewing: "Reviewing",
  covered_existing: "Covered by Existing Knowledge",
  improve_business_brain: "Improve Business Brain",
  improve_existing_article: "Improve Existing Article",
  create_faq: "Create FAQ",
  create_article: "Create Article",
  dismissed: "Dismissed",
  completed: "Completed",
});

const STOP_WORDS = new Set("a an and are as at be been but by can could did do does for from get had has have how i if in into is it me my of on or our should so that the their them there they this to van vans was we what when where which who why will with would you your ive im id dont really fairly quite just any".split(" "));
const LOCATION_NAMES = [
  "manchester", "leeds", "portsmouth", "birmingham", "southampton", "scotland", "wales", "england", "london",
  "liverpool", "bristol", "cardiff", "glasgow", "edinburgh", "newcastle", "nottingham", "sheffield", "plymouth",
  "bournemouth", "reading", "oxford", "cambridge", "brighton", "leicester", "coventry", "derby", "york",
];
const LOCATION_PATTERN = new RegExp(`\\b(${LOCATION_NAMES.join("|")})\\b`, "gi");
const clean = (value) => String(value || "").trim();
const tokens = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word));

export function extractLocationReferences(question) {
  return [...new Set([...clean(question).matchAll(LOCATION_PATTERN)].map((match) => match[0].replace(/\b\w/g, (letter) => letter.toUpperCase())))];
}

export function normaliseLearningQuestion(question) {
  return clean(question).toLowerCase()
    .replace(LOCATION_PATTERN, " location ")
    .replace(/rent\s*(?:2|to)\s*buy/g, "rent2buy")
    .replace(/money\s+down|upfront\s+(?:payment|cost)|initial\s+(?:payment|rental)|deposit/g, "initial payment")
    .replace(/credit\s+problems?|poor\s+credit|bad\s+credit|ccjs?/g, "credit difficulty")
    .replace(/how\s+does\s+it\s+work|what\s+is|explain/g, "product explanation")
    .replace(/do\s+you\s+cover|available\s+in|apply\s+from|live\s+(?:in|near)|need\s+to\s+live/g, "location coverage")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function inferOpportunityProduct(result = {}) {
  if (["finance", "rent2buy"].includes(result.product_context)) return result.product_context;
  const text = `${result.question || ""} ${result.answer || ""}`.toLowerCase();
  return /rent\s*(?:2|to)\s*buy|monthly rental|rental agreement/.test(text) ? "rent2buy" : "finance";
}

export function classifyLearningIntent(question, product = "finance") {
  const text = normaliseLearningQuestion(question);
  const has = (pattern) => pattern.test(text);
  if (has(/location|cover|collection|distance|nationwide|deliver/)) return { key: "coverage_collection", title: product === "rent2buy" ? "Rent2Buy coverage, distance and collection" : "Finance delivery and nationwide coverage", category: product === "rent2buy" ? "Rent2Buy" : "Van Finance", intent: "location and service coverage" };
  if (has(/initial payment|deposit|upfront/)) return { key: "upfront_costs", title: product === "rent2buy" ? "Rent2Buy initial rental and upfront costs" : "Finance deposits and upfront costs", category: product === "rent2buy" ? "Rent2Buy" : "Van Finance", intent: "upfront cost" };
  if (has(/product explanation|renting forever|own.*end|how.*work/)) return { key: "product_explanation", title: product === "rent2buy" ? "What Rent2Buy is and how it works" : "How van finance works", category: product === "rent2buy" ? "Rent2Buy" : "Van Finance", intent: "product explanation" };
  if (has(/credit difficulty|declin|credit score|accepted|applying/)) return { key: "credit_eligibility", title: product === "rent2buy" ? "Rent2Buy eligibility and affordability" : "Finance applications with credit difficulties", category: product === "rent2buy" ? "Rent2Buy" : "Van Finance", intent: "eligibility" };
  if (has(/next step|apply|application|start|reserve/)) return { key: "application_next_steps", title: `${product === "rent2buy" ? "Rent2Buy" : "Finance"} application and next steps`, category: product === "rent2buy" ? "Rent2Buy" : "Van Finance", intent: "ready to apply" };
  if (has(/document|bank statement|proof|licence|license/)) return { key: "documents", title: `${product === "rent2buy" ? "Rent2Buy" : "Finance"} documents and evidence`, category: product === "rent2buy" ? "Rent2Buy" : "Van Finance", intent: "application documents" };
  if (has(/monthly|payment|cost|price|repayment/)) return { key: "monthly_costs", title: `${product === "rent2buy" ? "Rent2Buy" : "Finance"} monthly costs and pricing`, category: product === "rent2buy" ? "Rent2Buy" : "Van Finance", intent: "cost and pricing" };
  if (has(/vehicle|transit|custom|sprinter|choose|eligible/)) return { key: "vehicle_eligibility", title: `${product === "rent2buy" ? "Rent2Buy" : "Finance"} vehicle choice and eligibility`, category: product === "rent2buy" ? "Rent2Buy" : "Van Finance", intent: "vehicle choice" };
  const important = [...new Set(tokens(text))].slice(0, 6);
  return { key: important.join("_") || "uncategorised_question", title: `${product === "rent2buy" ? "Rent2Buy" : "Finance"}: ${important.join(" ") || "uncategorised customer question"}`, category: product === "rent2buy" ? "Rent2Buy" : "Van Finance", intent: "customer question" };
}

export function opportunityGroupKey(question, product) {
  return `${product}:${classifyLearningIntent(question, product).key}`;
}

export function assessKnowledgeGapCandidate(result = {}, review = {}, settings = {}) {
  if (["greeting", "general_help_request", "thanks", "goodbye", "human_assistance_requested"].includes(result.conversation_intent)) return { qualifies: false, reasons: [], humanWeak: false, threshold: Number(settings.confidence_threshold ?? 65), excluded_reason: "non_business_conversation" };
  if (result.learning_diagnosis === "Deterministic rule handled successfully" && !["incorrect", "unsafe", "wrong_product", "hallucinated_fact"].includes(review.outcome)) return { qualifies: false, reasons: [], humanWeak: false, threshold: Number(settings.confidence_threshold ?? 65), excluded_reason: "deterministic_rule_success" };
  const threshold = Number(settings.confidence_threshold ?? 65);
  const sources = Array.isArray(result.sources_used) ? result.sources_used : [];
  const articleSources = sources.filter((source) => String(source.type || "").startsWith("article"));
  const humanWeak = ["needs_adjustment", "incorrect", "too_vague", "robotic", "lost_context", "asked_unnecessary_clarification", "failed_to_clarify", "wrong_product", "hallucinated_fact"].includes(review.outcome) || Number(review.accuracy || 5) <= 3 || Number(review.helpfulness || 5) <= 3;
  const reasons = [];
  if (result.knowledge_gap) reasons.push("insufficient_knowledge");
  if (result.conflict_detected) reasons.push("conflict_detected");
  if (Number(result.confidence || 0) < threshold) reasons.push("low_confidence");
  if (humanWeak) reasons.push("human_review_weak");
  if (review.outcome === "robotic") reasons.push("conversation_intent_weakness");
  if (review.outcome === "lost_context") reasons.push("context_memory_failure");
  if (["asked_unnecessary_clarification", "failed_to_clarify"].includes(review.outcome)) reasons.push("clarification_behavior_issue");
  if (review.outcome === "wrong_product") reasons.push("product_separation_failure");
  if (review.outcome === "hallucinated_fact") reasons.push("hallucinated_fact");
  if (humanWeak && result.conversation_diagnostics?.intent_reason && result.conversation_diagnostics?.intent_confidence < 80) reasons.push("conversation_intent_weakness");
  if (humanWeak && result.conversation_diagnostics?.normalised_message && result.conversation_diagnostics.normalised_message !== String(result.question || "").toLowerCase()) reasons.push("misspelling_normalisation_weakness");
  if (!articleSources.length) reasons.push("no_strong_article_source");
  if (sources.length > 0 && sources.every((source) => !String(source.type || "").startsWith("article"))) reasons.push("generic_business_brain_only");
  const questionTerms = new Set(tokens(result.question));
  const answerTerms = new Set(tokens(result.answer));
  const directOverlap = questionTerms.size ? [...questionTerms].filter((word) => answerTerms.has(word)).length / questionTerms.size : 1;
  if (clean(result.answer) && directOverlap < 0.12) reasons.push("answer_not_direct");
  return { qualifies: reasons.length > 0, reasons, humanWeak, threshold };
}

export function calculateOpportunityPriority(metrics = {}, now = new Date()) {
  const frequency = Math.min(25, Number(metrics.unique_result_count || metrics.question_count || 0) * 4);
  const unanswered = Math.min(20, Number(metrics.unanswered_count || 0) * 5);
  const poorReviews = Math.min(20, Number(metrics.weak_answer_count || 0) * 5);
  const conflicts = Math.min(15, Number(metrics.conflict_count || 0) * 5);
  const purchaseIntent = /apply|application|price|cost|deposit|next step|eligibility/i.test(`${metrics.normalised_intent || ""} ${metrics.title || ""}`) ? 10 : 4;
  const lastSeen = metrics.last_seen_at ? new Date(metrics.last_seen_at) : now;
  const days = Math.max(0, (now.getTime() - lastSeen.getTime()) / 86400000);
  const recency = days <= 7 ? 10 : days <= 30 ? 6 : days <= 90 ? 3 : 0;
  const existingCoverage = Number(metrics.existing_article_count || 0) ? -8 : 0;
  const components = { frequency, unanswered, poor_reviews: poorReviews, conflicts, purchase_intent: purchaseIntent, recency, existing_coverage: existingCoverage };
  const score = Math.max(0, Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0)));
  const level = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  return { score, level, components };
}

function overlapScore(question, item = {}) {
  const query = new Set(tokens(question));
  const source = new Set(tokens(`${item.title || ""} ${item.category || ""} ${item.content_markdown || item.content || ""} ${JSON.stringify(item.entries || item.faq_json || [])}`));
  const common = [...query].filter((word) => source.has(word)).length;
  return query.size ? common / query.size : 0;
}

export function diagnoseExistingKnowledge(opportunity, knowledge = {}) {
  const articles = (knowledge.articles || []).map((item) => ({ ...item, match_score: overlapScore(opportunity.title, item) })).filter((item) => item.match_score >= 0.2).sort((a, b) => b.match_score - a.match_score);
  const sections = (knowledge.sections || []).map((item) => ({ ...item, match_score: overlapScore(opportunity.title, item) })).filter((item) => item.match_score >= 0.2).sort((a, b) => b.match_score - a.match_score);
  let diagnosis = "No knowledge exists";
  let recommendedAction = "create_article";
  const reasons = new Set(opportunity.candidate_reasons || []);
  if (reasons.has("context_memory_failure")) { diagnosis = "Context-memory failure"; recommendedAction = "improve_retrieval"; }
  else if (reasons.has("clarification_behavior_issue")) { diagnosis = "Clarification behaviour issue"; recommendedAction = "improve_retrieval"; }
  else if (reasons.has("misspelling_normalisation_weakness")) { diagnosis = "Misspelling/normalisation weakness"; recommendedAction = "improve_retrieval"; }
  else if (reasons.has("conversation_intent_weakness")) { diagnosis = "Conversation-intent weakness"; recommendedAction = "improve_retrieval"; }
  else if (opportunity.conflict_count > 0) { diagnosis = "Sources conflict"; recommendedAction = "improve_business_brain"; }
  else if (articles.length && opportunity.unanswered_count > 0) { diagnosis = "Knowledge exists but retrieval missed it"; recommendedAction = "improve_retrieval"; }
  else if (articles.length) { diagnosis = "Existing article is incomplete"; recommendedAction = "improve_existing_article"; }
  else if (sections.length) { diagnosis = "Business Brain needs clearer guidance"; recommendedAction = "improve_business_brain"; }
  return { diagnosis, recommendedAction, relatedArticles: articles.slice(0, 5), relatedSections: sections.slice(0, 5) };
}

export function recommendOpportunityContent(opportunity) {
  if (opportunity.recommended_action === "improve_retrieval") return { action: "improve_retrieval", reason: "Relevant approved knowledge appears to exist." };
  if (opportunity.recommended_action === "improve_business_brain") return { action: "improve_business_brain", reason: "The business rule needs a clearer source of truth." };
  const broad = Number(opportunity.question_count || 0) >= 3 || ["coverage_collection", "product_explanation", "monthly_costs"].includes(opportunity.normalised_intent);
  return broad
    ? { action: "create_article", reason: "The cluster contains a broad reusable customer intent with several useful variations." }
    : { action: "create_faq", reason: "The gap is narrow enough for a reviewed FAQ rather than a separate article." };
}

export function groupCompetenceCandidates(results = [], reviews = [], settings = {}) {
  const reviewByResult = new Map(reviews.map((review) => [review.result_id, review]));
  const repetition = results.reduce((map, result) => {
    const product = inferOpportunityProduct(result);
    const key = opportunityGroupKey(result.question, product);
    return map.set(key, (map.get(key) || 0) + 1);
  }, new Map());
  const groups = new Map();
  for (const result of results) {
    const review = reviewByResult.get(result.id) || {};
    const assessment = assessKnowledgeGapCandidate(result, review, settings);
    const product = inferOpportunityProduct(result);
    const classified = classifyLearningIntent(result.question, product);
    const key = `${product}:${classified.key}`;
    if ((repetition.get(key) || 0) >= Number(settings.repetition_threshold || 3)) assessment.reasons.push("repeated_question_group");
    if (!assessment.qualifies && !assessment.reasons.length) continue;
    const group = groups.get(key) || { product, ...classified, questions: [], results: [], reviews: [], reasons: [], locations: [] };
    group.questions.push(result.question);
    group.results.push(result);
    if (review.id || review.result_id) group.reviews.push(review);
    group.reasons.push(...assessment.reasons);
    group.locations.push(...extractLocationReferences(result.question));
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const uniqueQuestions = [...new Set(group.questions)];
    const uniqueResults = new Map(group.results.map((result) => [result.id, result]));
    const resultValues = [...uniqueResults.values()];
    const reviewedAccuracy = group.reviews.filter((review) => review.accuracy);
    const reviewedHelpfulness = group.reviews.filter((review) => review.helpfulness);
    const average = (items, field) => items.length ? Number((items.reduce((sum, item) => sum + Number(item[field] || 0), 0) / items.length).toFixed(2)) : null;
    return {
      product: group.product,
      title: group.title,
      normalised_intent: group.key,
      category: group.category,
      summary: `Grouped from ${uniqueQuestions.length} customer question variation${uniqueQuestions.length === 1 ? "" : "s"}.`,
      question_count: uniqueQuestions.length,
      unique_result_count: resultValues.length,
      unanswered_count: resultValues.filter((result) => result.knowledge_gap).length,
      weak_answer_count: resultValues.filter((result) => Number(result.confidence || 0) < Number(settings.confidence_threshold ?? 65) || ["needs_adjustment", "incorrect", "too_vague"].includes(reviewByResult.get(result.id)?.outcome)).length,
      conflict_count: resultValues.filter((result) => result.conflict_detected).length,
      average_confidence: average(resultValues, "confidence") || 0,
      average_accuracy: average(reviewedAccuracy, "accuracy"),
      average_usefulness: average(reviewedHelpfulness, "helpfulness"),
      first_seen_at: resultValues.map((result) => result.created_at).filter(Boolean).sort()[0] || new Date().toISOString(),
      last_seen_at: resultValues.map((result) => result.created_at).filter(Boolean).sort().at(-1) || new Date().toISOString(),
      observed_locations: [...new Set(group.locations)],
      questions: resultValues.map((result) => ({ competence_result_id: result.id, original_question: result.question, normalised_question: normaliseLearningQuestion(result.question), product: group.product, location_reference: extractLocationReferences(result.question).join(", ") || null })),
      results: resultValues,
      candidate_reasons: [...new Set(group.reasons)],
    };
  });
}

export function calculateImprovementMetrics(results = [], linkedAt) {
  const boundary = linkedAt ? new Date(linkedAt).getTime() : Number.POSITIVE_INFINITY;
  const summarise = (items) => ({
    result_count: items.length,
    unanswered_count: items.filter((item) => item.knowledge_gap).length,
    average_confidence: items.length ? Number((items.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / items.length).toFixed(2)) : 0,
    average_accuracy: items.filter((item) => item.review?.accuracy).length ? Number((items.filter((item) => item.review?.accuracy).reduce((sum, item) => sum + Number(item.review.accuracy), 0) / items.filter((item) => item.review?.accuracy).length).toFixed(2)) : null,
    average_usefulness: items.filter((item) => item.review?.helpfulness).length ? Number((items.filter((item) => item.review?.helpfulness).reduce((sum, item) => sum + Number(item.review.helpfulness), 0) / items.filter((item) => item.review?.helpfulness).length).toFixed(2)) : null,
  });
  return { before: summarise(results.filter((item) => new Date(item.created_at).getTime() < boundary)), after: summarise(results.filter((item) => new Date(item.created_at).getTime() >= boundary)) };
}
