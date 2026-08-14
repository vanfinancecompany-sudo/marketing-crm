import { BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS, buildAiPlatformPrompt } from "./businessIntelligence.js";
import { normaliseCustomerMessage } from "./conversationIntelligence.js";

export const COMPETENCE_REVIEW_OUTCOMES = ["pass", "needs_adjustment", "incorrect", "unsafe", "too_long", "too_vague"];
export const COMPETENCE_RATING_FIELDS = ["accuracy", "helpfulness", "conversion", "brevity"];

export const AI_ASSISTANT_TEST_LIBRARY = Object.freeze([
  ["finance", "Can I get a van if I have poor credit?"],
  ["finance", "How does van finance work?"],
  ["finance", "Am I guaranteed to be accepted for finance?"],
  ["finance", "What finance options do you offer?"],
  ["finance", "Will applying affect my credit score?"],
  ["finance", "Can I settle my van finance early?"],
  ["finance", "How quickly can finance be arranged?"],
  ["finance", "Can I finance a van for a new business?"],
  ["poor_credit", "I have a CCJ. Can I still apply?"],
  ["poor_credit", "I was declined elsewhere. Can you help?"],
  ["poor_credit", "Do you only help customers with good credit?"],
  ["rent2buy", "What is Rent2Buy?"],
  ["rent2buy", "Does Rent2Buy require a credit check?"],
  ["rent2buy", "When do I own the Rent2Buy van?"],
  ["rent2buy", "Can I cancel a Rent2Buy agreement?"],
  ["rent2buy", "Is servicing included with Rent2Buy?"],
  ["rent2buy", "What happens at the end of Rent2Buy?"],
  ["rent2buy", "Can I upgrade my Rent2Buy van?"],
  ["rent2buy", "Is there a mileage limit on Rent2Buy?"],
  ["self_employed", "Can I apply if I am self-employed?"],
  ["self_employed", "What proof of income does a sole trader need?"],
  ["self_employed", "I have only just become self-employed. Can I apply?"],
  ["limited_company", "Can a limited company apply for a van?"],
  ["limited_company", "Does the director need to give a personal guarantee?"],
  ["limited_company", "Can a new limited company get a van?"],
  ["documents", "What documents do I need to apply?"],
  ["documents", "Do I need bank statements?"],
  ["documents", "Can I apply with an EU driving licence?"],
  ["delivery", "Do you deliver vans anywhere in the UK?"],
  ["delivery", "How much does van delivery cost?"],
  ["delivery", "Can you deliver to Northern Ireland?"],
  ["delivery", "Where do I collect a Rent2Buy van?"],
  ["deposit", "How much deposit do I need?"],
  ["deposit", "Can I get a van with no deposit?"],
  ["deposit", "Can I use my old van as the deposit?"],
  ["application", "How do I apply?"],
  ["application", "How long does an application take?"],
  ["application", "What happens after I submit my application?"],
  ["application", "Can I speak to someone before applying?"],
  ["vehicle", "Can I choose any van for finance?"],
  ["vehicle", "Are your vans inspected before delivery?"],
  ["vehicle", "Can I finance an electric van?"],
  ["vehicle", "Can I use the van for courier work?"],
  ["unknown", "Can you insure the van for me?"],
  ["unknown", "Can you guarantee my business will make money?"],
  ["unknown", "What will diesel cost next year?"],
  ["unknown", "Can you give me legal advice about my agreement?"],
  ["conversation", "I have poor credit. Which option might I look at?"],
  ["conversation", "Does that option need a credit check?"],
  ["conversation", "What would I need to do next?"],
]).map(([category, question], index) => ({ id: `CT-${String(index + 1).padStart(2, "0")}`, category, question }));

const STOP_WORDS = new Set("a an and are as at be been but by can could did do does for from get had has have how i if in into is it me my of on or our should so that the their them there they this to was we what when where which who why will with would you your".split(" "));
const clean = (value) => String(value || "").trim();
const RETRIEVAL_ALIASES = Object.freeze({
  accounts: ["account", "documents", "statements"],
  accepted: ["approval", "application", "eligibility"],
  afford: ["affordability", "cost", "budget", "monthly"],
  applying: ["apply", "application"],
  apply: ["application"],
  declined: ["credit", "rejected", "refused"],
  deposit: ["deposits", "upfront"],
  expensive: ["cost", "affordability", "budget", "monthly"],
  genuine: ["company", "business", "team", "trust"],
  insured: ["insurance"],
  insure: ["insurance"],
  business: ["company", "trading"],
  licence: ["licences", "license", "licenses"],
  licences: ["licence", "license", "licenses"],
  license: ["licence", "licences", "licenses"],
  licenses: ["licence", "licences", "license"],
  new: ["startup", "trading"],
  payments: ["payment", "monthly"],
  rejected: ["credit", "declined", "refused"],
  refused: ["credit", "declined", "rejected"],
  tax: ["taxed", "taxation"],
  taxed: ["tax", "taxation"],
  taxation: ["tax", "taxed"],
  vehicles: ["vehicle", "van"],
  vans: ["van", "vehicle"],
});
const RETRIEVAL_FOCUS_TERMS = new Set([
  "insurance", "insured", "tax", "taxed", "taxation", "vat", "warranty", "servicing", "service", "mileage",
  "documents", "document", "statements", "statement", "bank", "delivery", "deliver", "collection", "collect",
  "deposit", "deposits", "upfront", "credit", "declined", "rejected", "refused", "eligibility", "lender",
  "approval", "licence", "licences", "license", "licenses",
]);
const words = (value) => {
  const tokens = normaliseCustomerMessage(value).replace(/[^a-z0-9£]+/g, " ").split(/\s+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  return [...new Set(tokens.flatMap((word) => [word, ...(RETRIEVAL_ALIASES[word] || [])]))];
};
function retrievalQueryPlan(question, messages = []) {
  const priorUserWords = new Set(words(messages.filter((message) => message?.role === "user").slice(-6).map((message) => message.content).join(" ")));
  const queryWords = words(question);
  const novel = queryWords.filter((word) => !priorUserWords.has(word));
  const focused = novel.filter((word) => RETRIEVAL_FOCUS_TERMS.has(word));
  return {
    primary: focused.length ? focused : novel.length ? novel : queryWords,
    fallback: focused.length ? [] : queryWords,
  };
}
export const RENT2BUY_ARTICLE_CATEGORY = "Rent2Buy";
export const COMPETENCE_PRODUCT_CONTEXTS = Object.freeze(["finance", "rent2buy"]);
const normalizedCategory = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
const isRent2BuyCategory = (value) => normalizedCategory(value) === normalizedCategory(RENT2BUY_ARTICLE_CATEGORY);

function explicitProductMentions(value) {
  const text = clean(value).toLowerCase();
  return {
    rent2buy: /\brent\s*(?:2|to)\s*buy\b|rent-to-buy|monthly rental|rental agreement/.test(text),
    finance: /\b(?:van\s+)?finance\b|hire purchase|lease purchase/.test(text),
  };
}

export function isExplicitProductComparison(question, messages = []) {
  const current = clean(question).toLowerCase();
  const history = messages.map((message) => message.content).join(" ").toLowerCase();
  const text = `${history} ${current}`.trim();
  const wording = /\b(compare|comparison|difference|different|versus|vs\.?|both|which (?:option|one)|alternative)\b/.test(text);
  const currentProducts = explicitProductMentions(current);
  const allProducts = explicitProductMentions(text);
  const naturalComparison = /\bbetter(?:\s+than)?\b/.test(text) && allProducts.finance && allProducts.rent2buy;
  const directBothProducts = currentProducts.finance && currentProducts.rent2buy;
  return wording || naturalComparison || directBothProducts;
}

function businessPassageScope(value) {
  const text = clean(value).toLowerCase();
  const rent = /rent\s*2\s*buy|rent\s*to\s*buy|rent-to-buy|monthly rental|rental agreement/.test(text);
  const finance = /van finance|\bfinance\b|\blender|\bapr\b|hire purchase|lease purchase/.test(text);
  return rent && finance ? "both" : rent ? "rent2buy" : finance ? "finance" : "shared";
}

function retrievalSourceAllowedForProduct(source, productContext, comparison = false) {
  if (comparison) return true;
  const sourceType = clean(source?.type).toLowerCase();
  if (sourceType === "coverage_rule") return clean(source?.product).toLowerCase() === productContext;
  if (sourceType.startsWith("article")) {
    if (productContext === "rent2buy" && !isRent2BuyCategory(source?.category || source?.product)) return false;
    if (productContext === "finance" && isRent2BuyCategory(source?.category || source?.product)) return false;
  }
  const text = `${clean(source?.title)} ${clean(source?.heading)} ${clean(source?.passage)}`.replace(/\bvan finance company\b/gi, "");
  if (productContext === "finance") return !/\brent\s*(?:2|to)\s*buy\b|rent-to-buy|monthly rental|rental agreement/i.test(text);
  return !/\b(?:van\s+)?finance\b|hire purchase|lease purchase|\blender\b|\bapr\b/i.test(text);
}

export function filterKnowledgeForProduct({ sections = [], articles = [] } = {}, productContext, { comparison = false } = {}) {
  if (!COMPETENCE_PRODUCT_CONTEXTS.includes(productContext)) throw new Error("Product context must be finance or rent2buy.");
  const allowedScope = (value) => comparison || [productContext, "shared"].includes(businessPassageScope(value));
  const filteredSections = sections.map((section) => ({
    ...section,
    content: allowedScope(section.content) ? section.content : "",
    entries: (Array.isArray(section.entries) ? section.entries : []).filter((entry) => allowedScope(`${entry?.label || ""} ${entry?.value || ""}`)),
  }));
  const presentKeys = new Set(filteredSections.map((section) => section.section_key));
  for (const definition of BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS) {
    if (!presentKeys.has(definition.key)) filteredSections.push({ section_key: definition.key, title: definition.title, content: "", entries: [], active: false });
  }
  const filteredArticles = articles.filter((article) => comparison || (productContext === "rent2buy" ? isRent2BuyCategory(article.category) : !isRent2BuyCategory(article.category)));
  return {
    sections: filteredSections,
    articles: filteredArticles,
    productContext,
    comparison,
    categoryFilter: comparison
      ? `${productContext === "finance" ? "Finance" : RENT2BUY_ARTICLE_CATEGORY} primary; both product categories allowed for explicit comparison`
      : productContext === "rent2buy"
        ? `${RENT2BUY_ARTICLE_CATEGORY} only`
        : `All approved Finance categories; exclude ${RENT2BUY_ARTICLE_CATEGORY}`,
  };
}

export function splitArticleMarkdown(article = {}) {
  const lines = clean(article.content_markdown).replace(/\r/g, "").split("\n");
  const passages = [];
  let heading = "Article overview";
  let buffer = [];
  const flush = () => {
    const passage = buffer.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (passage) passages.push({ type: "article", source_id: article.id, title: article.title, heading, passage, public_url: article.live_wix_url || "", product: article.category || "", category: article.category || "" });
    buffer = [];
  };
  for (const line of lines) {
    const match = line.match(/^#{1,4}\s+(.+)$/);
    if (match) { flush(); heading = match[1].trim(); continue; }
    if (!line.trim() && buffer.join(" ").length > 900) flush();
    else buffer.push(line);
  }
  flush();
  return passages;
}

export function buildRetrievalCorpus({ sections = [], articles = [], productContext = null, comparison = false } = {}) {
  const brain = sections.filter((section) => section.active !== false).flatMap((section) => {
    const sources = [];
    if (clean(section.content)) sources.push({ type: "business_brain", source_id: section.id, section_key: section.section_key, title: section.title, heading: section.title, passage: clean(section.content), public_url: "" });
    for (const entry of Array.isArray(section.entries) ? section.entries : []) {
      const passage = [clean(entry.label), clean(entry.value)].filter(Boolean).join(": ");
      if (passage) sources.push({ type: section.section_key === "faqs" ? "business_faq" : "business_brain", source_id: section.id, section_key: section.section_key, title: section.title, heading: clean(entry.label) || section.title, passage, public_url: "" });
    }
    return sources;
  });
  const articlePassages = articles.flatMap((article) => [
    ...splitArticleMarkdown(article),
    ...(Array.isArray(article.faq_json) ? article.faq_json : []).map((faq) => ({ type: "article_faq", source_id: article.id, title: article.title, heading: clean(faq.question) || "Article FAQ", passage: [clean(faq.question), clean(faq.answer)].filter(Boolean).join(": "), public_url: article.live_wix_url || "", product: article.category || "", category: article.category || "" })),
  ]);
  const corpus = [...brain, ...articlePassages];
  if (!COMPETENCE_PRODUCT_CONTEXTS.includes(productContext)) return corpus;
  return corpus.filter((source) => retrievalSourceAllowedForProduct(source, productContext, comparison));
}

export function detectProduct(question, messages = []) {
  const text = `${messages.map((message) => message.content).join(" ")} ${question}`.toLowerCase();
  const rent = /rent\s*2\s*buy|rent\s*to\s*buy|no credit check|monthly rental|rental agreement/.test(text);
  const finance = /finance|credit|ccj|declin|loan|hire purchase|lease purchase|lender|apr/.test(text);
  return rent && finance ? "both" : rent ? "rent2buy" : finance ? "finance" : "unknown";
}

export function rankKnowledge(question, corpus = [], { messages = [], limit = 8 } = {}) {
  const plan = retrievalQueryPlan(question, messages);
  const product = detectProduct(question, messages.filter((message) => message?.role === "user"));
  const rankWithWords = (queryWords) => {
    const querySet = new Set(queryWords);
    return corpus.map((source, index) => {
      const sourceWords = words(`${source.title} ${source.heading} ${source.passage}`);
      const frequency = sourceWords.reduce((map, word) => map.set(word, (map.get(word) || 0) + 1), new Map());
      const matched = [...querySet].filter((word) => frequency.has(word));
      const coverage = querySet.size ? matched.length / querySet.size : 0;
      const termScore = matched.reduce((sum, word) => sum + Math.min(3, frequency.get(word)), 0);
      const phraseBonus = clean(source.passage).toLowerCase().includes(clean(question).toLowerCase()) ? 12 : 0;
      const authorityBonus = source.type === "business_brain" || source.type === "business_faq" ? 4 : 0;
      const faqBonus = source.type.includes("faq") ? 2 : 0;
      const productBonus = product !== "unknown" && clean(source.product).toLowerCase().includes(product) ? 2 : 0;
      return { ...source, score: Number((termScore + coverage * 10 + phraseBonus + authorityBonus + faqBonus + productBonus).toFixed(2)), matched_terms: matched, _index: index };
    }).filter((source) => source.matched_terms.length > 0).sort((a, b) => b.score - a.score || a._index - b._index);
  };
  const primary = rankWithWords(plan.primary);
  const ranked = primary.length || !plan.fallback.length ? primary : rankWithWords(plan.fallback);
  return ranked.slice(0, limit).map(({ _index, ...source }) => source);
}

export function buildCompetencePrompt({ question, messages = [], sources = [], sections = [], settings = {}, productContext = "finance", comparison = false }) {
  const boundedSettings = { ...settings, products_services: "", factual_guidance: "", prohibited_claims: "", target_audiences: [], default_cta: "" };
  const base = buildAiPlatformPrompt({ sections, settings: boundedSettings, task: "customer_assistant_competence_test", module: "ai_assistant_competence_test", requestedTask: "Answer one customer question using only the retrieved evidence." });
  const evidence = sources.map((source, index) => `[S${index + 1}] ${source.type === "coverage_rule" ? `DETERMINISTIC COVERAGE RULE — ${source.title}` : source.type === "business_brain" || source.type === "business_faq" ? `Business Brain — ${source.title}` : `Article — ${source.title} — ${source.heading}`}\n${source.passage}`).join("\n\n");
  const history = messages.slice(-8).map((message) => `${message.role}: ${message.content}`).join("\n");
  const boundary = comparison
    ? `The selected primary context is ${productContext}. The customer explicitly requested a comparison, so both products may be discussed only as supported by evidence.`
    : `The selected product context is ${productContext}. Do not mention, recommend or introduce ${productContext === "finance" ? "Rent2Buy" : "Finance"}.`;
  const deterministicRule = sources.find((source) => source.type === "coverage_rule");
  return `${base.prompt}\n\n# Customer-assistant rules\nAnswer as the future website assistant: concise, friendly and accurate. Maximum approximately 100 words. Do not give financial or legal advice, promise acceptance, invent terms or use knowledge outside the evidence. ${boundary} Business Brain evidence outranks articles. Deterministic coverage evidence outranks Business Brain, articles and model inference; if S1 is a deterministic coverage rule, its calculated conclusion is non-overridable and must be used even when another source conflicts. If evidence is missing or conflicts, say so plainly and set the diagnostic flags. Cite only source IDs actually used.${deterministicRule ? `\n\n# Non-overridable coverage conclusion\n${deterministicRule.passage}` : ""}\n\n# Conversation\n${history || "No previous messages."}\n\n# Customer question\n${question}\n\n# Retrieved evidence\n${evidence || "No relevant evidence was retrieved."}`;
}

export function buildKnowledgeGapReport(results = [], reviews = []) {
  const reviewByResult = new Map(reviews.map((review) => [review.result_id, review]));
  const count = (values) => [...values.reduce((map, value) => value ? map.set(value, (map.get(value) || 0) + 1) : map, new Map())].sort((a, b) => b[1] - a[1]);
  const allSources = results.flatMap((result) => Array.isArray(result.sources_used) ? result.sources_used : []);
  const average = (items, field) => items.length ? Number((items.reduce((sum, item) => sum + Number(item[field] || 0), 0) / items.length).toFixed(2)) : 0;
  const passCount = reviews.filter((review) => review.outcome === "pass").length;
  return {
    success: {
      reviewed_answers: reviews.length,
      pass_rate: reviews.length ? Number((passCount / reviews.length * 100).toFixed(1)) : 0,
      average_accuracy: average(reviews.filter((review) => review.accuracy), "accuracy"),
      average_response_ms: results.length ? Math.round(results.reduce((sum, result) => sum + Number(result.response_time_ms || 0), 0) / results.length) : 0,
      unsafe_answers: reviews.filter((review) => review.outcome === "unsafe").length,
      incorrect_answers: reviews.filter((review) => review.outcome === "incorrect").length,
    },
    common_gaps: count(results.filter((result) => result.knowledge_gap).map((result) => result.confidence_reason || "Relevant approved knowledge was not found.")),
    business_sections: count(allSources.filter((source) => source.section_key).map((source) => source.title || source.section_key)),
    articles: count(allSources.filter((source) => source.type?.startsWith("article")).map((source) => source.title)),
    unanswered: results.filter((result) => result.knowledge_gap || !clean(result.answer)),
    conflicts: results.filter((result) => result.conflict_detected),
    lowest_rated: results.map((result) => ({ ...result, review: reviewByResult.get(result.id) })).filter((result) => result.review).sort((a, b) => Number(a.review.accuracy || 0) - Number(b.review.accuracy || 0)).slice(0, 10),
  };
}
