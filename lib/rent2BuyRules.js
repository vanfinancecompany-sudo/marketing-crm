const clean = (value) => String(value || "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export const RENT2BUY_SECTION_KEY = "compliance";
export const RENT2BUY_RULE_LABEL = "Permanent Rent2Buy product separation";
export const RENT2BUY_COLLECTION_SENTENCE = "Collection only from Southampton.";
export const RENT2BUY_SEPARATION_SENTENCE = "Rent2Buy is a separate rent-to-own arrangement and is not a finance product.";
export const RENT2BUY_CORE_WORDING = `${RENT2BUY_SEPARATION_SENTENCE} Vehicles are collection only from Southampton. The agreement terms, payment structure, eligibility requirements and ownership conditions should be reviewed before proceeding.`;
export const RENT2BUY_BUSINESS_KNOWLEDGE_RULE = Object.freeze({ label: RENT2BUY_RULE_LABEL, value: `${RENT2BUY_CORE_WORDING} Prohibited in Rent2Buy content: finance products, van finance, Hire Purchase, PCP, Lease Purchase, APR, interest rates, finance rates, lenders, lender panels, finance approval, finance applications, finance deposits, representative APR, monthly finance repayments, credit-broker wording, test driving before purchase, trying or trialling the van before committing, free UK delivery, home delivery and work-address delivery. Mixed articles must keep Van Finance and Rent2Buy in distinct headed sections.` });

const SEMANTIC_PATTERNS = [
  { category: "finance", pattern: /\btraditional\s+finance(?:\s+(?:options?|barriers?|agreements?|products?))?\b/gi },
  { category: "finance", pattern: /\bunlike\s+(?:traditional\s+)?finance\b/gi },
  { category: "finance", pattern: /\bnew\s+to\s+finance\b/gi },
  { category: "finance", pattern: /\blease\s+finance\b/gi },
  { category: "finance", pattern: /\bvan\s+finance\b/gi },
  { category: "finance", pattern: /\bfinance\s+(?:options?|agreements?|products?|rates?|approvals?|applications?|deposits?|repayments?)\b/gi },
  { category: "finance", pattern: /\bmonthly\s+finance\s+repayments?\b/gi },
  { category: "finance", pattern: /\bhire\s+purchase\b/gi },
  { category: "finance", pattern: /\blease\s+purchase\b/gi },
  { category: "finance", pattern: /\bpcp\b/gi },
  { category: "finance", pattern: /\brepresentative\s+apr\b|\bapr\b/gi },
  { category: "finance", pattern: /\binterest\s+rates?\b/gi },
  { category: "finance", pattern: /\blender\s+panels?\b|\blenders?\b/gi },
  { category: "finance", pattern: /\bapproval\s+rates?\b/gi },
  { category: "finance", pattern: /\bcredit[- ]broker\b/gi },
  { category: "finance", pattern: /\bfinance\b/gi },
  { category: "trial", pattern: /\btest\s+driv(?:e|ing)\b/gi },
  { category: "trial", pattern: /\btest(?:ing)?\s+(?:whether\s+)?(?:the\s+)?van(?:\s+(?:meets?|suits?)\s+(?:your\s+)?(?:needs?|requirements?))?(?:\s+before\s+buying)?\b/gi },
  { category: "trial", pattern: /\btry(?:ing)?\s+(?:the\s+)?van(?:\s+before\s+(?:buying|committing))?\b/gi },
  { category: "trial", pattern: /\btrial(?:ling)?\s+(?:the\s+)?van\b/gi },
  { category: "trial", pattern: /\b(?:try|test)\s+before\s+buying\b/gi },
  { category: "trial", pattern: /\brent\s+before\s+committing\b/gi },
  { category: "trial", pattern: /\bsee\s+(?:if|whether)\s+(?:the\s+)?van\s+suits?\s+you(?:\s+before\s+buying)?\b/gi },
  { category: "trial", pattern: /\bdecide\s+after\s+trying\s+it\b/gi },
  { category: "trial", pattern: /\bevaluate\s+(?:the\s+)?van\s+before\s+purchase\b/gi },
  { category: "delivery", pattern: /\bfree\s+(?:uk\s+)?delivery\b/gi },
  { category: "delivery", pattern: /\buk\s+delivery\b/gi },
  { category: "delivery", pattern: /\bhome\s+delivery\b/gi },
  { category: "delivery", pattern: /\bwork(?:place|-address| address)\s+delivery\b/gi },
  { category: "delivery", pattern: /\bdelivery\s+(?:is\s+)?(?:available|unavailable)\b/gi },
  { category: "delivery", pattern: /\bno\s+delivery\b/gi },
  { category: "delivery", pattern: /\bdelivery\s+options?\b/gi },
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
  const output = []; let current = { heading: "Introduction", text: "", raw: [] };
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (heading) { if (current.raw.length) output.push(current); current = { heading: clean(heading[1]), text: "", raw: [line] }; }
    else { current.text += `${line}\n`; current.raw.push(line); }
  }
  if (current.raw.length) output.push(current);
  return output;
}

function semanticLocations(article = {}) {
  const locations = [
    { section: "Article title", text: article.title || "" },
    { section: "SEO title", text: article.seo_title || "" },
    { section: "Meta description", text: article.meta_description || "" },
    { section: "Excerpt", text: article.excerpt || "" },
  ];
  sections(article.content_markdown).forEach((section) => {
    locations.push({ section: section.heading, text: section.heading });
    section.text.split(/\r?\n/).forEach((line, index) => {
      if (line.trim()) locations.push({ section: section.heading, text: line, line: index + 1 });
    });
  });
  (Array.isArray(article.faq_json) ? article.faq_json : []).forEach((item, index) => {
    locations.push({ section: `FAQ ${index + 1}`, text: `${item?.question || ""} ${item?.answer || ""}` });
  });
  locations.push({ section: "CTA", text: article.cta || "" });
  (Array.isArray(article.internal_link_suggestions) ? article.internal_link_suggestions : []).forEach((item, index) => {
    locations.push({ section: `Link ${index + 1}`, text: item?.anchor_text || item?.label || "" });
  });
  return locations;
}

function excerptAround(text, index, length) {
  const start = Math.max(0, index - 45); const end = Math.min(text.length, index + length + 65);
  return clean(`${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`);
}

export function validateRent2BuySemantics(article = {}, options = {}) {
  const product = classifyArticleProduct(article, options.intent || options.assessment?.effective_intent || {});
  if (product !== "rent2buy") return { rent2buy_semantic_valid: true, rent2buy_semantic_errors: [], prohibited_terms_remaining: [] };
  const errors = [];
  semanticLocations(article).forEach((location) => {
    const protectedText = String(location.text || "").replaceAll(RENT2BUY_SEPARATION_SENTENCE, "[APPROVED RENT2BUY SEPARATION]");
    SEMANTIC_PATTERNS.forEach(({ category, pattern }) => {
      pattern.lastIndex = 0;
      for (const match of protectedText.matchAll(pattern)) {
        errors.push({ phrase: match[0], section: location.section, category, excerpt: excerptAround(location.text, match.index || 0, match[0].length) });
      }
    });
  });
  const unique = [...new Map(errors.map((item) => [`${item.category}|${item.section}|${normalize(item.phrase)}|${item.excerpt}`, item])).values()];
  return { rent2buy_semantic_valid: unique.length === 0, rent2buy_semantic_errors: unique, prohibited_terms_remaining: [...new Set(unique.map((item) => item.phrase))] };
}

export function validateMarkdownStructure(markdown = "", cta = "") {
  const text = String(markdown || ""); const lines = text.split(/\r?\n/); const errors = [];
  lines.forEach((line, index) => {
    if (/\b\d+\.\s+\d+\.\s*/.test(line)) errors.push(`Malformed numbering on line ${index + 1}.`);
    if (/^\s*\d+\.\s*$/.test(line)) errors.push(`Empty numbered item on line ${index + 1}.`);
    if (/^\s*[-*+]\s+.+\s+[-*+]\s+\S/.test(line)) errors.push(`Multiple bullet items merged on line ${index + 1}.`);
    if (/\S\s+---\s+\S/.test(line) || (/---/.test(line) && !/^\s*---\s*$/.test(line))) errors.push(`Horizontal rule is not on its own line ${index + 1}.`);
    if (/^#{1,6}\s+/.test(line) && index + 1 < lines.length && lines[index + 1].trim() !== "") errors.push(`Heading on line ${index + 1} is missing a blank line after it.`);
    const linkOpens = (line.match(/\[/g) || []).length; const linkCloses = (line.match(/\]\([^)]*\)/g) || []).length;
    if (linkOpens > linkCloses && /\[/.test(line)) errors.push(`Broken Markdown link on line ${index + 1}.`);
  });
  const numbered = lines.map((line) => line.match(/^\s*(\d+)\.\s+\S/)).filter(Boolean).map((match) => Number(match[1]));
  for (let i = 1; i < numbered.length; i += 1) if (numbered[i] !== numbered[i - 1] + 1 && numbered[i] !== 1) errors.push("Numbered list is not sequential.");
  if (cta && text.includes(cta)) { const ctaLine = lines.findIndex((line) => line.includes(cta)); if (ctaLine >= 0 && ((lines[ctaLine - 1] || "").trim() || (lines[ctaLine + 1] || "").trim())) errors.push("CTA is merged with surrounding content."); }
  return { markdown_structure_valid: errors.length === 0, markdown_structure_errors: [...new Set(errors)] };
}

export function evaluateRent2BuyRule(article = {}, options = {}) {
  const product = classifyArticleProduct(article, options.intent || options.assessment?.effective_intent || {});
  const fullText = `${article.title || ""}\n${article.excerpt || ""}\n${article.content_markdown || ""}\n${article.cta || ""}`;
  const inspected = product === "both" ? sections(article.content_markdown).filter((section) => /rent2buy|rent\s?2\s?buy|rent-to-buy|rent-to-own/i.test(section.heading)).map((section) => `${section.heading}\n${section.text}`).join("\n") : fullText;
  if (product !== "rent2buy" && product !== "both") return { applies: false, product, violations: [], passed: true, ...validateRent2BuySemantics(article, options) };
  const semantic = validateRent2BuySemantics(article, options);
  const violations = semantic.rent2buy_semantic_errors.map((item) => `prohibited Rent2Buy ${item.category} wording remains in ${item.section}: ${item.phrase}`);
  if (!new RegExp(`(?:^|\\n)\\s*${RENT2BUY_COLLECTION_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:\\n|$)`, "i").test(inspected)) violations.push(`missing exact standalone collection wording: ${RENT2BUY_COLLECTION_SENTENCE}`);
  if (!inspected.includes(RENT2BUY_SEPARATION_SENTENCE) || !/rent-to-own arrangement/i.test(inspected)) violations.push("missing Rent2Buy product-separation facts");
  if (product === "both") { const headings = sections(article.content_markdown).map((section) => section.heading); if (!headings.some((heading) => /finance/i.test(heading)) || !headings.some((heading) => /rent2buy|rent\s?2\s?buy|rent-to-buy/i.test(heading))) violations.push("mixed article products are not separated into distinct headed sections"); }
  return { applies: true, product, violations: [...new Set(violations)], passed: violations.length === 0, ...semantic };
}

export function rent2BuyPromptRule(subject = {}) {
  const product = classifyArticleProduct(subject); if (product !== "rent2buy" && product !== "both") return "";
  return `\n# Permanent Rent2Buy product rule\n${RENT2BUY_CORE_WORDING}\nFor pure Rent2Buy content, perform a final full-text semantic scan across the title, headings, paragraphs, bullets, numbered items, tables, notes, summary, CTA and link anchors before returning the proposal. Do not return any prohibited finance, trial or delivery concept, even in a contrast, denial or explanation. Rewrite affected sentences naturally into Rent2Buy-only language using agreement, rental payments, eligibility, application, ownership conditions, vehicle availability, collection and Southampton. Preserve at least 80% of valid non-prohibited content and all valid Markdown structure. Do not summarise. Remove whole finance-comparison sections only when necessary. Preserve the exact sentence “${RENT2BUY_SEPARATION_SENTENCE}” and place the exact standalone sentence “${RENT2BUY_COLLECTION_SENTENCE}” naturally near the introduction, Key Features or Collection section—not after the CTA. Mixed content may retain separate Finance and Rent2Buy sections only when explicitly classified as both.`;
}

export function withPermanentRent2BuyKnowledge(sections = []) { return (Array.isArray(sections) ? sections : []).map((section) => section?.section_key === "compliance" ? { ...section, active: true, entries: [...(section.entries || []).filter((entry) => entry?.label !== RENT2BUY_RULE_LABEL), RENT2BUY_BUSINESS_KNOWLEDGE_RULE] } : section); }
export async function ensureRent2BuyBusinessKnowledge(supabase) { const existing = await supabase.from("knowledge_business_sections").select("*").eq("section_key", "compliance").maybeSingle(); if (existing.error) throw existing.error; const section = existing.data || { section_key: "compliance", title: "Compliance", description: "Confirmed guidance, prohibited claims and facts that require review.", content: "", entries: [], sort_order: 5 }; const payload = { ...section, active: true, entries: [...(section.entries || []).filter((entry) => entry?.label !== RENT2BUY_RULE_LABEL), RENT2BUY_BUSINESS_KNOWLEDGE_RULE], updated_at: new Date().toISOString() }; delete payload.id; const result = await supabase.from("knowledge_business_sections").upsert(payload, { onConflict: "section_key" }).select().single(); if (result.error) throw result.error; return result.data; }
