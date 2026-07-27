const clean = (value) => String(value || "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export const RENT2BUY_SECTION_KEY = "compliance";
export const RENT2BUY_RULE_LABEL = "Permanent Rent2Buy product separation";
export const RENT2BUY_COLLECTION_SENTENCE = "Collection only from Southampton.";
export const RENT2BUY_CORE_WORDING = `Rent2Buy is a separate rent-to-own arrangement and is not a finance product. ${RENT2BUY_COLLECTION_SENTENCE} The agreement terms, payment structure, eligibility requirements and ownership conditions should be reviewed before proceeding.`;

export const RENT2BUY_BUSINESS_KNOWLEDGE_RULE = Object.freeze({
  label: RENT2BUY_RULE_LABEL,
  value: `${RENT2BUY_CORE_WORDING} Pure Rent2Buy content must remove finance comparisons, finance terminology, delivery references and all try/test/trial-before-commitment wording rather than retaining them negatively. Mixed articles may use finance terminology only in a separately headed Van Finance section.`,
});

const PROHIBITED = [
  /\bfinance products?\b/i, /\bvan finance\b/i, /\bhire purchase\b/i, /\bpcp\b/i,
  /\blease purchase\b/i, /\brepresentative apr\b/i, /\bapr\b/i, /\binterest rates?\b/i,
  /\bfinance rates?\b/i, /\blender panels?\b/i, /\blenders?\b/i, /\bfinance approvals?\b/i,
  /\bapproval rates?\b/i, /\bfinance applications?\b/i, /\bfinance deposits?\b/i,
  /\bmonthly finance repayments?\b/i, /\bcredit broker\b|\bcredit-broker\b/i,
  /\bfree uk delivery\b/i, /\bhome delivery\b/i, /\bwork(?:place|-address| address) delivery\b/i,
  /\bdelivery (?:is not|isn't|is unavailable|is unavailable|options? vary|may apply)\b/i,
];
const TRIAL_WORDING = [
  /\btest(?:ing)? (?:the |a )?van\b/i,
  /\btest driv(?:e|ing)\b/i,
  /\btry(?:ing)? (?:the |a )?van\b/i,
  /\btry before buy(?:ing)?\b/i,
  /\brent before committing\b/i,
  /\btrial(?:ling|ing)? (?:the |a )?van\b/i,
  /\bsee whether (?:the |a )?van suits you before (?:buying|committing)\b/i,
  /\bsee if (?:the |a )?van suits you before (?:buying|committing)\b/i,
  /\b(?:suits?|suitable) (?:your|the) needs before (?:buying|committing)\b/i,
];
const COMPARISON_HEADING = /(?:compare|comparison|versus|vs\.?|traditional finance|finance options?|apr|lender|approval)/i;

export function classifyArticleProduct(article = {}, intent = {}) {
  const explicit = normalize(intent.primary_product || article.primary_product || article.product || article.category || article.article_type);
  if (/\bboth\b|mixed/.test(explicit)) return "both";
  if (/rent2buy|rent 2 buy|rent to buy|rent to own/.test(explicit)) return "rent2buy";
  if (/finance/.test(explicit)) return "finance";
  const text = normalize(`${article.title || ""} ${article.seo_title || ""} ${article.content_markdown || ""}`);
  const hasR2b = /rent2buy|rent 2 buy|rent to buy|rent to own/.test(text);
  const hasFinance = /van finance|hire purchase|\bpcp\b|lease purchase/.test(text);
  return hasR2b && hasFinance ? "both" : hasR2b ? "rent2buy" : hasFinance ? "finance" : "unknown";
}

function splitSections(markdown = "") {
  const output = [];
  let current = { heading: "Introduction", level: 0, lines: [] };
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      if (current.lines.join("\n").trim() || current.level) output.push(current);
      current = { heading: clean(heading[2]), level: heading[1].length, lines: [] };
    } else current.lines.push(line);
  }
  if (current.lines.join("\n").trim() || current.level) output.push(current);
  return output;
}

function renderSections(items = []) {
  return items.map((item) => `${item.level ? `${"#".repeat(item.level)} ${item.heading}\n\n` : ""}${item.lines.join("\n").trim()}`).filter(Boolean).join("\n\n");
}

function textForRule(article = {}, product = "unknown") {
  const full = `${article.title || ""}\n${article.excerpt || ""}\n${article.content_markdown || ""}\n${article.cta || ""}`;
  if (product !== "both") return full;
  return splitSections(article.content_markdown)
    .filter((section) => /rent2buy|rent\s?2\s?buy|rent-to-buy|rent-to-own/i.test(section.heading))
    .map((section) => `${section.heading}\n${section.lines.join("\n")}`).join("\n");
}

function stripApprovedCoreException(value = "") {
  return String(value || "").replace(/Rent2Buy is a separate rent-to-own arrangement and is not a finance product\.?/gi, "");
}

export function rent2BuyViolations(article = {}, options = {}) {
  const product = classifyArticleProduct(article, options.intent || options.assessment?.effective_intent || {});
  if (product !== "rent2buy" && product !== "both") return { applies: false, product, violations: [] };
  const inspected = textForRule(article, product);
  const checked = stripApprovedCoreException(inspected);
  const violations = PROHIBITED.filter((pattern) => pattern.test(checked)).map((pattern) => `prohibited Rent2Buy wording: ${pattern.source}`);
  TRIAL_WORDING.filter((pattern) => pattern.test(checked)).forEach((pattern) => violations.push(`prohibited Rent2Buy trial wording: ${pattern.source}`));
  if (!new RegExp(`(?:^|\\n)\\s*${RENT2BUY_COLLECTION_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:$|\\n)`, "i").test(inspected)) {
    violations.push(`missing exact standalone collection wording: ${RENT2BUY_COLLECTION_SENTENCE}`);
  }
  if (!/rent-to-own arrangement/i.test(inspected)) violations.push("missing Rent2Buy rent-to-own arrangement wording");
  if (product === "rent2buy" && splitSections(article.content_markdown).some((section) => COMPARISON_HEADING.test(section.heading) && /finance|apr|lender|approval|pcp|hire purchase|lease purchase/i.test(`${section.heading} ${section.lines.join(" ")}`))) {
    violations.push("pure Rent2Buy article contains a finance-comparison section");
  }
  if (product === "both") {
    const headings = splitSections(article.content_markdown).map((section) => section.heading);
    if (!headings.some((heading) => /finance/i.test(heading)) || !headings.some((heading) => /rent2buy|rent\s?2\s?buy|rent-to-buy/i.test(heading))) violations.push("mixed article products are not separated into distinct headed sections");
  }
  return { applies: true, product, violations: [...new Set(violations)] };
}

export function evaluateRent2BuyRule(article = {}, options = {}) {
  const result = rent2BuyViolations(article, options);
  return { ...result, passed: result.violations.length === 0 };
}

function removeProhibitedSentences(value = "") {
  return String(value || "").split(/(?<=[.!?])\s+|\n+/).filter((sentence) => {
    const checked = stripApprovedCoreException(sentence);
    return !PROHIBITED.some((pattern) => pattern.test(checked)) && !TRIAL_WORDING.some((pattern) => pattern.test(checked));
  }).join(" ").replace(/\s{2,}/g, " ").trim();
}

export function autoCorrectPureRent2BuyArticle(article = {}, options = {}) {
  if (classifyArticleProduct(article, options.intent || {}) !== "rent2buy") return { ...article };
  const kept = splitSections(article.content_markdown).filter((section) => {
    const text = `${section.heading} ${section.lines.join(" ")}`;
    return !(COMPARISON_HEADING.test(section.heading) && /finance|apr|lender|approval|pcp|hire purchase|lease purchase/i.test(text));
  }).map((section) => ({ ...section, lines: removeProhibitedSentences(section.lines.join("\n")).split("\n") }));
  let content = renderSections(kept).trim();
  content = content.replace(new RegExp(RENT2BUY_COLLECTION_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
  const coreWithoutCollection = "Rent2Buy is a separate rent-to-own arrangement and is not a finance product.";
  if (!content.includes(coreWithoutCollection)) content = `${coreWithoutCollection}\n\n${content}`.trim();
  content = `${content}\n\n${RENT2BUY_COLLECTION_SENTENCE}`.trim();
  return {
    ...article,
    excerpt: removeProhibitedSentences(article.excerpt),
    cta: removeProhibitedSentences(article.cta),
    content_markdown: content,
  };
}

export function rent2BuyPromptRule(subject = {}) {
  const product = classifyArticleProduct(subject);
  if (product !== "rent2buy" && product !== "both") return "";
  const pure = product === "rent2buy";
  return `\n# Permanent Rent2Buy product rule\n${RENT2BUY_CORE_WORDING}\n${pure ? "This is a pure Rent2Buy article. Remove all prohibited terminology completely, including negative or contrast wording. Delete finance-comparison sections and tables rather than rewriting them. Never mention finance, APR, rates, lenders, approvals, deposits, PCP, Hire Purchase, Lease Purchase, delivery, test, try or trial concepts outside the single approved core sentence above. Use Rent2Buy application, agreement, rental payments, eligibility, ownership conditions and collection. Insert the exact standalone sentence: Collection only from Southampton." : "This is mixed content. Keep Van Finance and Rent2Buy in clearly separate headed sections; apply all Rent2Buy restrictions inside the Rent2Buy section only."}`;
}

export function withPermanentRent2BuyKnowledge(sections = []) {
  return (Array.isArray(sections) ? sections : []).map((section) => section?.section_key === "compliance"
    ? { ...section, active: true, entries: [...(section.entries || []).filter((entry) => entry?.label !== RENT2BUY_RULE_LABEL), RENT2BUY_BUSINESS_KNOWLEDGE_RULE] }
    : section);
}

export async function ensureRent2BuyBusinessKnowledge(supabase) {
  const existing = await supabase.from("knowledge_business_sections").select("*").eq("section_key", "compliance").maybeSingle();
  if (existing.error) throw existing.error;
  const section = existing.data || { section_key: "compliance", title: "Compliance", description: "Confirmed guidance, prohibited claims and facts that require review.", content: "", entries: [], sort_order: 5 };
  const payload = { ...section, active: true, entries: [...(section.entries || []).filter((entry) => entry?.label !== RENT2BUY_RULE_LABEL), RENT2BUY_BUSINESS_KNOWLEDGE_RULE], updated_at: new Date().toISOString() };
  delete payload.id;
  const result = await supabase.from("knowledge_business_sections").upsert(payload, { onConflict: "section_key" }).select().single();
  if (result.error) throw result.error;
  return result.data;
}