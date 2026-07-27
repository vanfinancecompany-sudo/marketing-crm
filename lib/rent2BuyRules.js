const clean = (value) => String(value || "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export const RENT2BUY_SECTION_KEY = "rent2buy_rules";
export const RENT2BUY_CORE_WORDING = "Rent2Buy is a separate rent-to-own arrangement and is not a finance product. Vehicles are collection only from Southampton. The agreement terms, payment structure, eligibility requirements and ownership conditions should be reviewed before proceeding.";

export const RENT2BUY_BUSINESS_KNOWLEDGE_RULE = Object.freeze({
  section_key: RENT2BUY_SECTION_KEY,
  title: "Rent2Buy Product Separation",
  description: "Permanent product-scoped facts and prohibited wording for all Rent2Buy content.",
  content: RENT2BUY_CORE_WORDING,
  entries: [
    { label: "Product classification", value: "Rent2Buy is not finance and must never be described as a finance product." },
    { label: "Arrangement", value: "Rent2Buy is a separate rent-to-own arrangement." },
    { label: "Collection", value: "Collection only from Southampton." },
    { label: "Customer review", value: "Agreement terms, payment structure, eligibility requirements and ownership conditions must be reviewed before proceeding." },
    { label: "Prohibited concepts", value: "Finance products; van finance; Hire Purchase; PCP; Lease Purchase; APR; interest rates; finance rates; lenders; lender panels; finance approval; finance applications; finance deposits; representative APR; monthly finance repayments; credit-broker wording; test driving before purchase; trying or trialling the van before committing; free UK delivery; home delivery; work-address delivery." },
  ],
  sort_order: 35,
  active: true,
});

const PROHIBITED = [
  /\bfinance products?\b/i,
  /\bvan finance\b/i,
  /\bhire purchase\b/i,
  /\bpcp\b/i,
  /\blease purchase\b/i,
  /\brepresentative apr\b/i,
  /\bapr\b/i,
  /\binterest rates?\b/i,
  /\bfinance rates?\b/i,
  /\blender panels?\b/i,
  /\blenders?\b/i,
  /\bfinance approvals?\b/i,
  /\bfinance applications?\b/i,
  /\bfinance deposits?\b/i,
  /\bmonthly finance repayments?\b/i,
  /\bcredit broker\b|\bcredit-broker\b/i,
  /\btest driv(?:e|ing) before purchase\b/i,
  /\btry(?:ing)? (?:the )?van before (?:buying|committing)\b/i,
  /\btrial(?:ling)? (?:the )?van\b/i,
  /\bfree uk delivery\b/i,
  /\bhome delivery\b/i,
  /\bwork(?:place|-address| address) delivery\b/i,
];

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

function sections(markdown = "") {
  const output = [];
  let current = { heading: "Introduction", text: "" };
  for (const line of clean(markdown).split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      if (current.text.trim()) output.push(current);
      current = { heading: clean(heading[1]), text: "" };
    } else current.text += `${line}\n`;
  }
  if (current.text.trim()) output.push(current);
  return output;
}

export function evaluateRent2BuyRule(article = {}, options = {}) {
  const product = classifyArticleProduct(article, options.intent || options.assessment?.effective_intent || {});
  const fullText = `${article.title || ""}\n${article.excerpt || ""}\n${article.content_markdown || ""}\n${article.cta || ""}`;
  const inspected = product === "both"
    ? sections(article.content_markdown).filter((section) => /rent2buy|rent\s?2\s?buy|rent-to-buy|rent-to-own/i.test(section.heading)).map((section) => `${section.heading}\n${section.text}`).join("\n")
    : fullText;
  if (product !== "rent2buy" && product !== "both") return { applies: false, product, violations: [], passed: true };
  const violations = PROHIBITED.filter((pattern) => pattern.test(inspected)).map((pattern) => pattern.source);
  const hasCollection = /collection only from southampton/i.test(inspected);
  const hasCoreFacts = /not (?:a )?finance product/i.test(inspected) && /rent-to-own arrangement/i.test(inspected);
  if (!hasCollection) violations.push("missing exact collection wording: Collection only from Southampton.");
  if (!hasCoreFacts) violations.push("missing Rent2Buy product-separation facts");
  return { applies: true, product, violations: [...new Set(violations)], passed: violations.length === 0 };
}

export function rent2BuyPromptRule(subject = {}) {
  const product = classifyArticleProduct(subject);
  if (product !== "rent2buy" && product !== "both") return "";
  return `\n# Permanent Rent2Buy product rule\n${RENT2BUY_CORE_WORDING}\nRent2Buy must never be described as finance. Do not use finance products, van finance, Hire Purchase, PCP, Lease Purchase, APR, interest rates, finance rates, lenders, lender panels, finance approval/application/deposit/repayment or credit-broker wording in a Rent2Buy section. Do not promise test drives, try-before-buy, free UK delivery, home delivery or work-address delivery. Use the exact sentence “Collection only from Southampton.” Mixed content must keep Van Finance and Rent2Buy in clearly separate headed sections.`;
}

export function withPermanentRent2BuyKnowledge(sections = []) {
  const filtered = (Array.isArray(sections) ? sections : []).filter((item) => item?.section_key !== RENT2BUY_SECTION_KEY);
  return [...filtered, RENT2BUY_BUSINESS_KNOWLEDGE_RULE];
}

export async function ensureRent2BuyBusinessKnowledge(supabase) {
  if (!supabase) return RENT2BUY_BUSINESS_KNOWLEDGE_RULE;
  const result = await supabase.from("knowledge_business_sections").upsert({
    ...RENT2BUY_BUSINESS_KNOWLEDGE_RULE,
    updated_at: new Date().toISOString(),
  }, { onConflict: "section_key" }).select().single();
  if (result.error) throw result.error;
  return result.data;
}
