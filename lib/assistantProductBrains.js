import { BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS, normalizeBusinessKnowledgeSections } from "./businessIntelligence.js";
import {
  RENT2BUY_BUSINESS_KNOWLEDGE_RULE,
  RENT2BUY_COLLECTION_SENTENCE,
  RENT2BUY_RULE_LABEL,
  validateRent2BuySemantics,
  withPermanentRent2BuyKnowledge,
} from "./rent2BuyRules.js";

export const ASSISTANT_PRODUCT_CONTEXTS = Object.freeze(["finance", "rent2buy"]);
export const RENT2BUY_ARTICLE_CATEGORY = "Rent2Buy";

const clean = (value) => String(value || "").trim();
const normalizedCategory = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
const isRent2BuyCategory = (value) => normalizedCategory(value) === normalizedCategory(RENT2BUY_ARTICLE_CATEGORY);
const isPermanentRent2BuyRule = (entry = {}) => clean(entry.label) === RENT2BUY_RULE_LABEL;

// These cues are deliberately asymmetric. They stop an unlabelled product-specific fact from
// becoming "shared" just because the sentence omitted the product name.
const RENT2BUY_ONLY_CUES = /\brent\s*(?:2|to)\s*buy\b|rent-to-buy|rent-to-own|monthly rental|initial rental|collection only from southampton|vehicles? are collection only from southampton|within 100 miles|so40\s*2nn|no credit check/i;
const RENT2BUY_STATUS_CONTAMINATION = /\bsubject(?:\s+|-)to(?:\s+|-)status\b|\bsubject(?:\s+|-)to(?:\s+|-)(?:finance|lender|credit)(?:\s+|-)approval\b/i;
const EXPLICIT_FINANCE_STATUS_CONTEXT = /\b(?:van\s+)?finance\b|hire purchase|lease purchase|\blender\b/i;
const EXPLICIT_RENT2BUY_STATUS_CONTEXT = /\brent\s*(?:2|to)\s*buy\b|rent-to-buy|rent-to-own|\bthis\s+(?:option|route|product|arrangement)\b|\bit\b/i;
const FINANCE_ONLY_CUES = /\b(?:van\s+)?finance\b|hire purchase|lease purchase|\blender\b|\bapr\b|representative apr|interest rate|finance repayment|finance deposit|subject(?:\s+|-)to(?:\s+|-)status|subject(?:\s+|-)to(?:\s+|-)(?:finance|lender|credit)(?:\s+|-)approval|free (?:uk )?delivery|home delivery|work(?:place| address|-address) delivery|7[–-]10 working days|£100 reservation deposit/i;
const RENT2BUY_PERMANENTLY_PROHIBITED = /\b(?:van\s+)?finance\b|hire purchase|lease purchase|\bpcp\b|\blender\b|\bapr\b|interest rate|finance repayment|finance deposit|subject(?:\s+|-)to(?:\s+|-)status|subject(?:\s+|-)to(?:\s+|-)(?:finance|lender|credit)(?:\s+|-)approval|test driv|trial(?:ling)?|free (?:uk )?delivery|home delivery|work(?:place| address|-address) delivery|\buk delivery\b/i;
// Articles may discuss these topics generally, but they must not become the authority for a fixed
// operational/contractual claim. Exact current facts must come from approved Rent2Buy Business Knowledge.
const RENT2BUY_ARTICLE_EVIDENCE_ONLY = /fully comprehensive insurance|insurance (?:is |must be |is currently )?(?:required|mandatory)|must (?:arrange|have) (?:fully comprehensive )?insurance|mileage limits? (?:apply|applies)|mileage allowance (?:is|of)|early returns?|upgrade(?:s|d| option)? (?:depend|are|is|available)|optional final (?:amount|payment)|final (?:amount|payment) (?:is|of|to)|agreement length (?:is|of)|tracking device (?:is|must|will)|tracker (?:is|must|will)|ownership transfer (?:is|happens|occurs)|driving licence (?:is|must|required)|business-type eligibility (?:is|depends)/i;
const RENT2BUY_RUNTIME_RESTRICTED_CLAIMS = "Never describe Rent2Buy as subject to status, subject to Finance/lender/credit approval, or use those Finance-style qualification phrases. Rent2Buy has no credit check; affordability and the required supporting information are assessed instead. Do not state an insurance requirement, early-return condition, upgrade option, optional or final payment, end-of-agreement ownership mechanic, mileage allowance, agreement length, tracking-device procedure, ownership-transfer procedure, age threshold, driving-licence requirement or business-type eligibility unless that exact fact is present in current approved Rent2Buy Business Knowledge.";
const RENT2BUY_STATUS_SAFE_REPLY = "Rent2Buy does not use a credit check; affordability and the required supporting information are assessed instead.";

export function businessKnowledgeProductScope(value) {
  const text = clean(value);
  const rent2buy = RENT2BUY_ONLY_CUES.test(text);
  const finance = FINANCE_ONLY_CUES.test(text);
  return rent2buy && finance ? "both" : rent2buy ? "rent2buy" : finance ? "finance" : "shared";
}

function rent2BuyStatusSentenceIsContaminated(value) {
  const sentence = clean(value);
  if (!RENT2BUY_STATUS_CONTAMINATION.test(sentence)) return false;
  const finance = EXPLICIT_FINANCE_STATUS_CONTEXT.test(sentence);
  const rent2buy = EXPLICIT_RENT2BUY_STATUS_CONTEXT.test(sentence);
  return !(finance && !rent2buy);
}

export function enforceRent2BuyReplyBoundary(value) {
  const text = clean(value);
  if (!text) return text;
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  if (!sentences.some(rent2BuyStatusSentenceIsContaminated)) return text;
  const kept = sentences.filter((sentence) => !rent2BuyStatusSentenceIsContaminated(sentence)).map((sentence) => sentence.trim()).filter(Boolean);
  return [RENT2BUY_STATUS_SAFE_REPLY, ...kept].join(" ").replace(/\s+/g, " ").trim();
}

function rent2BuyTextIsPermanentlySafe(value) {
  const text = clean(value);
  if (!text) return true;
  return !RENT2BUY_PERMANENTLY_PROHIBITED.test(text);
}

function rent2BuyArticleIsSafe(article = {}) {
  if (!isRent2BuyCategory(article.category)) return false;
  const semantic = validateRent2BuySemantics(article, { scopeOverride: "rent2buy" });
  const articleText = `${article.title || ""}\n${article.content_markdown || ""}\n${JSON.stringify(article.faq_json || [])}`;
  return semantic.rent2buy_semantic_valid && rent2BuyTextIsPermanentlySafe(articleText);
}

function financeTextIsSafe(value) {
  return !RENT2BUY_ONLY_CUES.test(clean(value));
}

function allowedBusinessEntry(entry, productContext) {
  if (productContext === "rent2buy" && isPermanentRent2BuyRule(entry)) return true;
  if (productContext === "finance" && isPermanentRent2BuyRule(entry)) return false;
  const text = `${clean(entry?.label)} ${clean(entry?.value)}`;
  const scope = businessKnowledgeProductScope(text);
  if (![productContext, "shared"].includes(scope)) return false;
  return productContext === "rent2buy" ? rent2BuyTextIsPermanentlySafe(text) : financeTextIsSafe(text);
}

function allowedBusinessContent(value, productContext) {
  const scope = businessKnowledgeProductScope(value);
  if (![productContext, "shared"].includes(scope)) return false;
  return productContext === "rent2buy" ? rent2BuyTextIsPermanentlySafe(value) : financeTextIsSafe(value);
}

function normalisedForProduct(sections, settings, productContext) {
  const normalized = normalizeBusinessKnowledgeSections(sections, settings);
  const productReady = productContext === "rent2buy" ? withPermanentRent2BuyKnowledge(normalized) : normalized;
  return productReady.map((section) => ({
    ...section,
    content: allowedBusinessContent(section.content, productContext) ? section.content : "",
    entries: (Array.isArray(section.entries) ? section.entries : []).filter((entry) => allowedBusinessEntry(entry, productContext)),
  }));
}

function ensureSectionDefinitions(sections) {
  const output = [...sections];
  const presentKeys = new Set(output.map((section) => section.section_key));
  for (const definition of BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS) {
    if (!presentKeys.has(definition.key)) output.push({ section_key: definition.key, title: definition.title, content: "", entries: [], active: false });
  }
  return output;
}

function singleProductArticles(articles, productContext) {
  if (productContext === "rent2buy") return articles.filter(rent2BuyArticleIsSafe);
  return articles.filter((article) => !isRent2BuyCategory(article.category) && financeTextIsSafe(`${article.title || ""}\n${article.content_markdown || ""}\n${JSON.stringify(article.faq_json || [])}`));
}

function mergeComparisonSections(financeSections, rent2BuySections) {
  const byKey = new Map();
  for (const source of [financeSections, rent2BuySections]) {
    for (const section of source) {
      const current = byKey.get(section.section_key) || { ...section, content: "", entries: [] };
      const contents = [...new Set([current.content, section.content].map(clean).filter(Boolean))];
      const entries = [...current.entries, ...(section.entries || [])];
      const seen = new Set();
      current.content = contents.join("\n\n");
      current.entries = entries.filter((entry) => {
        const key = `${clean(entry?.label).toLowerCase()}\u0000${clean(entry?.value).toLowerCase()}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      current.active = current.active !== false || section.active !== false;
      byKey.set(section.section_key, current);
    }
  }
  return ensureSectionDefinitions([...byKey.values()]);
}

export function buildAssistantProductBrain({ sections = [], articles = [], settings = {} } = {}, productContext, { comparison = false } = {}) {
  if (!ASSISTANT_PRODUCT_CONTEXTS.includes(productContext)) throw new Error("Product context must be finance or rent2buy.");

  if (comparison) {
    const financeSections = normalisedForProduct(sections, settings, "finance");
    const rent2BuySections = normalisedForProduct(sections, settings, "rent2buy");
    const financeArticles = singleProductArticles(articles, "finance");
    const rent2BuyArticles = singleProductArticles(articles, "rent2buy");
    const seen = new Set();
    return {
      sections: mergeComparisonSections(financeSections, rent2BuySections),
      articles: [...financeArticles, ...rent2BuyArticles].filter((article) => {
        const key = clean(article.id) || `${clean(article.title)}\u0000${clean(article.category)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
      productContext,
      comparison: true,
      brainId: "comparison",
      categoryFilter: "Controlled comparison: both product categories allowed only through sealed Finance and Rent2Buy evidence",
    };
  }

  return {
    sections: ensureSectionDefinitions(normalisedForProduct(sections, settings, productContext)),
    articles: singleProductArticles(articles, productContext),
    productContext,
    comparison: false,
    brainId: productContext,
    categoryFilter: productContext === "rent2buy"
      ? "Sealed Rent2Buy brain: approved Rent2Buy evidence only"
      : "Sealed Finance brain: approved Finance evidence only; exclude Rent2Buy",
  };
}

export function retrievalSourceAllowedForProduct(source, productContext, comparison = false) {
  if (!ASSISTANT_PRODUCT_CONTEXTS.includes(productContext)) return true;
  const sourceType = clean(source?.type).toLowerCase();
  const category = source?.category || source?.product;
  const text = `${clean(source?.title)} ${clean(source?.heading)} ${clean(source?.passage)}`;

  if (sourceType === "coverage_rule") {
    if (comparison) return ASSISTANT_PRODUCT_CONTEXTS.includes(clean(source?.product).toLowerCase());
    return clean(source?.product).toLowerCase() === productContext;
  }

  // The permanent Rent2Buy rule is control-plane policy, not customer-answer evidence. Keeping it
  // out of lexical retrieval prevents a guardrail sentence from becoming Jasmine's actual reply.
  if (clean(source?.heading) === RENT2BUY_RULE_LABEL) return false;

  if (comparison) {
    if (sourceType.startsWith("article") && isRent2BuyCategory(category)) {
      if (!rent2BuyTextIsPermanentlySafe(text)) return false;
      if (RENT2BUY_ARTICLE_EVIDENCE_ONLY.test(text)) return false;
      return true;
    }
    if (sourceType.startsWith("article")) return financeTextIsSafe(text);
    const scope = businessKnowledgeProductScope(text);
    if (scope === "both") return false;
    return scope === "rent2buy" ? rent2BuyTextIsPermanentlySafe(text) : financeTextIsSafe(text);
  }

  if (productContext === "finance") {
    if (sourceType.startsWith("article") && isRent2BuyCategory(category)) return false;
    return financeTextIsSafe(text);
  }

  if (sourceType.startsWith("article")) {
    if (!isRent2BuyCategory(category)) return false;
    if (!rent2BuyTextIsPermanentlySafe(text)) return false;
    // Operational contract details may be repeated in an article, but the live assistant may only
    // state them when the exact fact exists in approved Rent2Buy Business Knowledge.
    if (RENT2BUY_ARTICLE_EVIDENCE_ONLY.test(text)) return false;
    return true;
  }
  const scope = businessKnowledgeProductScope(text);
  return ["rent2buy", "shared"].includes(scope) && rent2BuyTextIsPermanentlySafe(text);
}

export function permanentRent2BuyRuntimeEvidence() {
  return `${RENT2BUY_BUSINESS_KNOWLEDGE_RULE.value}\n${RENT2BUY_COLLECTION_SENTENCE}\n${RENT2BUY_RUNTIME_RESTRICTED_CLAIMS}`;
}
