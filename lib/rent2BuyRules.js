const clean = (value) => String(value || "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export const RENT2BUY_SECTION_KEY = "compliance";
export const RENT2BUY_RULE_LABEL = "Permanent Rent2Buy product separation";
export const RENT2BUY_COLLECTION_SENTENCE = "Collection only from Southampton.";
export const RENT2BUY_SEPARATION_SENTENCE = "Rent2Buy is a separate rent-to-own arrangement and is not a finance product.";
export const RENT2BUY_CORE_WORDING = `${RENT2BUY_SEPARATION_SENTENCE} Vehicles are collection only from Southampton. The agreement terms, payment structure, eligibility requirements and ownership conditions should be reviewed before proceeding.`;
export const RENT2BUY_EVIDENCE_GUARDRAIL = "Do not invent or state a fixed reservation or deposit amount, approval or decision time, mandatory document list, agreement length, mileage allowance, tracking-device procedure, ownership-transfer procedure, age threshold, driving-licence requirement or business-type eligibility unless that exact fact is present in current approved Rent2Buy Business Knowledge. If a detail is not evidenced, say the team will confirm the current requirement for the customer's application and chosen vehicle.";
export const RENT2BUY_BUSINESS_KNOWLEDGE_RULE = Object.freeze({ label: RENT2BUY_RULE_LABEL, value: `${RENT2BUY_CORE_WORDING} ${RENT2BUY_EVIDENCE_GUARDRAIL} Prohibited in Rent2Buy content: finance products, van finance, Hire Purchase, PCP, Lease Purchase, APR, interest rates, finance rates, lenders, lender panels, finance approval, finance applications, finance deposits, representative APR, monthly finance repayments, credit-broker wording, test driving before purchase, trying or trialling the van before committing, free UK delivery, home delivery and work-address delivery. Mixed articles must keep Van Finance and Rent2Buy in distinct headed sections.` });

const COMPANY_NAME = "Van Finance Company";
const COMPANY_TOKEN = "[APPROVED COMPANY NAME]";
const SCOPE_VALUES = new Map([
  ["rent2buy", "rent2buy"], ["rent 2 buy", "rent2buy"], ["rent to buy", "rent2buy"], ["rent to own", "rent2buy"],
  ["finance", "finance"], ["van finance", "finance"],
  ["both", "both"], ["mixed", "both"], ["comparison", "both"], ["both comparison", "both"],
]);
const COMPARISON_PATTERN = /rent\s?2\s?buy\s+(?:vs|versus|or|compared\s+(?:with|to))\s+(?:van\s+)?finance|how\s+rent\s?2\s?buy\s+compares?\s+to\s+(?:van\s+)?finance|differences?\s+between\s+rent\s?2\s?buy\s+and\s+(?:van\s+)?finance|rent\s?2\s?buy\s+versus\s+traditional\s+van\s+finance|which\s+is\s+right\s+for\s+you/i;
const FINANCE_CONTEXT = /\bvan finance\b|\btraditional finance\b|\bhire purchase\b|\bpcp\b|\blease purchase\b|\bapr\b|\blender/i;
const R2B_CONTEXT = /rent\s?2\s?buy|rent-to-buy|rent-to-own/i;

const SEMANTIC_PATTERNS = [
  { category: "finance", pattern: /\btraditional\s+finance(?:\s+(?:options?|barriers?|agreements?|products?))?\b/gi },
  { category: "finance", pattern: /\bunlike\s+(?:traditional\s+)?finance\b/gi },
  { category: "finance", pattern: /\bnew\s+to\s+finance\b/gi },
  { category: "finance", pattern: /\blease\s+finance\b/gi },
  { category: "finance", pattern: /\bvan\s+finance\b/gi },
  { category: "finance", pattern: /\bfinance\s+(?:options?|agreements?|products?|rates?|approvals?|applications?|deposits?|repayments?)\b/gi },
  { category: "finance", pattern: /\bmonthly\s+finance\s+repayments?\b/gi },
  { category: "finance", pattern: /\bhire\s+purchase\b/gi }, { category: "finance", pattern: /\blease\s+purchase\b/gi },
  { category: "finance", pattern: /\bpcp\b/gi }, { category: "finance", pattern: /\brepresentative\s+apr\b|\bapr\b/gi },
  { category: "finance", pattern: /\binterest\s+rates?\b/gi }, { category: "finance", pattern: /\blender\s+panels?\b|\blenders?\b/gi },
  { category: "finance", pattern: /\bapproval\s+rates?\b/gi }, { category: "finance", pattern: /\bcredit[- ]broker\b/gi },
  { category: "finance", pattern: /\bfinance\b/gi },
  { category: "trial", pattern: /\btest\s+driv(?:e|ing)\b/gi },
  { category: "trial", pattern: /\btest(?:ing)?\s+(?:whether\s+)?(?:the\s+)?van(?:\s+(?:meets?|suits?)\s+(?:your\s+)?(?:needs?|requirements?))?(?:\s+before\s+buying)?\b/gi },
  { category: "trial", pattern: /\btry(?:ing)?\s+(?:the\s+)?van(?:\s+before\s+(?:buying|committing))?\b/gi },
  { category: "trial", pattern: /\btrial(?:ling)?\s+(?:the\s+)?van\b/gi }, { category: "trial", pattern: /\b(?:try|test)\s+before\s+buying\b/gi },
  { category: "trial", pattern: /\brent\s+before\s+committing\b/gi }, { category: "trial", pattern: /\bsee\s+(?:if|whether)\s+(?:the\s+)?van\s+suits?\s+you(?:\s+before\s+buying)?\b/gi },
  { category: "trial", pattern: /\bdecide\s+after\s+trying\s+it\b/gi }, { category: "trial", pattern: /\bevaluate\s+(?:the\s+)?van\s+before\s+purchase\b/gi },
  { category: "delivery", pattern: /\bfree\s+(?:uk\s+)?delivery\b/gi }, { category: "delivery", pattern: /\buk\s+delivery\b/gi },
  { category: "delivery", pattern: /\bhome\s+delivery\b/gi }, { category: "delivery", pattern: /\bwork(?:place|-address| address)\s+delivery\b/gi },
  { category: "delivery", pattern: /\bdelivery\s+(?:is\s+)?(?:available|unavailable)\b/gi }, { category: "delivery", pattern: /\bno\s+delivery\b/gi },
  { category: "delivery", pattern: /\bdelivery\s+options?\b/gi },
];

function scopeValue(value) {
  const normalized = normalize(value);
  if (SCOPE_VALUES.has(normalized)) return SCOPE_VALUES.get(normalized);
  if (/\bboth\b|comparison|mixed/.test(normalized)) return "both";
  if (/rent2buy|rent 2 buy|rent to buy|rent to own/.test(normalized)) return "rent2buy";
  if (/\bfinance\b/.test(normalized)) return "finance";
  return "";
}

export function classifyArticleProduct(article = {}, intent = {}, explicitOverride = "") {
  const authoritative = [
    explicitOverride,
    intent.product_scope_override,
    intent.primary_product,
    article.generation_metadata?.product_scope_override,
    article.product_scope_override,
    article.primary_product,
    article.topic_product,
  ].map(scopeValue).find(Boolean);
  if (authoritative) return authoritative;

  const structured = [article.article_type, article.category].map(scopeValue).find(Boolean);
  if (structured) return structured;

  const titleText = `${article.title || ""} ${article.seo_title || ""}`;
  const headings = String(article.content_markdown || "").split(/\r?\n/).filter((line) => /^#{1,6}\s+/.test(line)).join(" ");
  if (COMPARISON_PATTERN.test(`${titleText} ${headings}`)) return "both";
  const text = `${titleText} ${headings}`;
  const hasR2b = R2B_CONTEXT.test(text);
  const hasFinance = FINANCE_CONTEXT.test(text);
  return hasR2b && hasFinance ? "both" : hasR2b ? "rent2buy" : hasFinance ? "finance" : "unknown";
}

function sections(markdown = "") {
  const output = []; let current = { heading: "Introduction", text: "", lines: [] };
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (heading) { if (current.lines.length) output.push(current); current = { heading: clean(heading[1]), text: "", lines: [line] }; }
    else { current.text += `${line}\n`; current.lines.push(line); }
  }
  if (current.lines.length) output.push(current);
  return output;
}

function contextFromLabel(label = "") {
  const hasR2b = R2B_CONTEXT.test(label); const hasFinance = FINANCE_CONTEXT.test(label) || /\bfinance\b/i.test(label);
  if (hasR2b && !hasFinance) return "rent2buy";
  if (hasFinance && !hasR2b) return "finance";
  return "neutral_comparison";
}

function tableLocations(section) {
  const rows = section.text.split(/\r?\n/).filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (rows.length < 2) return [];
  const split = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map(clean);
  const headers = split(rows[0]);
  if (headers.length < 2 || !rows[1].includes("---")) return [];
  const output = [];
  rows.slice(2).forEach((row, rowIndex) => split(row).forEach((cell, columnIndex) => {
    if (!cell) return;
    const header = headers[columnIndex] || `Column ${columnIndex + 1}`;
    output.push({ field: "Article body", section: section.heading, column: header, text: cell, product_context: contextFromLabel(header), excerpt_label: `table row ${rowIndex + 1}` });
  }));
  return output;
}

function semanticLocations(article = {}, scope = "rent2buy") {
  const locations = [
    { field: "Article title", section: "Article title", text: article.title || "", product_context: scope === "both" ? "neutral_comparison" : scope },
    { field: "SEO title", section: "SEO title", text: article.seo_title || "", product_context: scope === "both" ? "neutral_comparison" : scope },
    { field: "Meta description", section: "Meta description", text: article.meta_description || "", product_context: scope === "both" ? "neutral_comparison" : scope },
    { field: "Excerpt", section: "Excerpt", text: article.excerpt || "", product_context: scope === "both" ? "neutral_comparison" : scope },
  ];
  sections(article.content_markdown).forEach((section) => {
    const context = scope === "both" ? contextFromLabel(section.heading) : scope;
    locations.push({ field: "Article body", section: section.heading, text: section.heading, product_context: context });
    const tables = tableLocations(section);
    const tableLines = new Set(section.text.split(/\r?\n/).filter((line) => /^\s*\|.*\|\s*$/.test(line)));
    section.text.split(/\r?\n/).forEach((line) => { if (line.trim() && !tableLines.has(line)) locations.push({ field: "Article body", section: section.heading, text: line, product_context: context }); });
    locations.push(...tables);
  });
  (Array.isArray(article.faq_json) ? article.faq_json : []).forEach((item, index) => locations.push({ field: `FAQ ${index + 1}`, section: `FAQ ${index + 1}`, text: `${item?.question || ""} ${item?.answer || ""}`, product_context: scope === "both" ? contextFromLabel(`${item?.question || ""}`) : scope }));
  locations.push({ field: "CTA", section: "CTA", text: article.cta || "", product_context: scope === "both" ? "neutral_comparison" : scope });
  (Array.isArray(article.internal_link_suggestions) ? article.internal_link_suggestions : []).forEach((item, index) => locations.push({ field: `Internal-link anchor ${index + 1}`, section: `Internal-link anchor ${index + 1}`, text: item?.anchor_text || item?.label || "", product_context: scope === "both" ? contextFromLabel(item?.anchor_text || item?.label || "") : scope }));
  return locations;
}

function excerptAround(text, index, length) { const start = Math.max(0, index - 45); const end = Math.min(text.length, index + length + 65); return clean(`${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`); }
function protectApprovedNames(value) { return String(value || "").replaceAll(RENT2BUY_SEPARATION_SENTENCE, "[APPROVED RENT2BUY SEPARATION]").replaceAll(COMPANY_NAME, COMPANY_TOKEN); }

export function validateComparisonStructure(article = {}, options = {}) {
  const scope = classifyArticleProduct(article, options.intent || options.assessment?.effective_intent || {}, options.scopeOverride);
  if (scope !== "both") return { comparison_structure_valid: true, comparison_structure_errors: [] };
  const articleSections = sections(article.content_markdown);
  const hasR2bSection = articleSections.some((section) => contextFromLabel(section.heading) === "rent2buy");
  const hasFinanceSection = articleSections.some((section) => contextFromLabel(section.heading) === "finance");
  const hasSeparatedTable = articleSections.some((section) => { const rows = section.text.split(/\r?\n/).filter((line) => /^\s*\|.*\|\s*$/.test(line)); return rows.length >= 2 && R2B_CONTEXT.test(rows[0]) && /\bfinance\b/i.test(rows[0]); });
  const errors = [];
  if (!(hasSeparatedTable || (hasR2bSection && hasFinanceSection))) errors.push("Comparison requires distinct Rent2Buy and Van Finance sections or clearly labelled table columns.");
  articleSections.forEach((section) => {
    const context = contextFromLabel(section.heading);
    if (context === "neutral_comparison" && R2B_CONTEXT.test(section.text) && FINANCE_CONTEXT.test(section.text) && !tableLocations(section).length) errors.push(`Mixed unlabelled product claims in ${section.heading}.`);
  });
  return { comparison_structure_valid: errors.length === 0, comparison_structure_errors: [...new Set(errors)] };
}

export function validateRent2BuySemantics(article = {}, options = {}) {
  const scope = classifyArticleProduct(article, options.intent || options.assessment?.effective_intent || {}, options.scopeOverride);
  if (scope === "finance" || scope === "unknown") return { product_scope: scope, rent2buy_semantic_valid: true, rent2buy_semantic_errors: [], prohibited_terms_remaining: [] };
  const errors = [];
  semanticLocations(article, scope).forEach((location) => {
    if (scope === "both" && location.product_context !== "rent2buy") return;
    const protectedText = protectApprovedNames(location.text);
    SEMANTIC_PATTERNS.forEach(({ category, pattern }) => {
      pattern.lastIndex = 0;
      for (const match of protectedText.matchAll(pattern)) errors.push({ field: location.field, section: location.section, column: location.column, phrase: match[0], category, excerpt: excerptAround(location.text, match.index || 0, match[0].length), product_context: location.product_context });
    });
  });
  const unique = [...new Map(errors.map((item) => [`${item.category}|${item.field}|${item.section}|${item.column || ""}|${normalize(item.phrase)}`, item])).values()];
  return { product_scope: scope, rent2buy_semantic_valid: unique.length === 0, rent2buy_semantic_errors: unique, prohibited_terms_remaining: [...new Set(unique.map((item) => item.phrase))] };
}

export function validateMarkdownStructure(markdown = "", cta = "") {
  const text = String(markdown || ""); const lines = text.split(/\r?\n/); const errors = [];
  lines.forEach((line, index) => { if (/\b\d+\.\s+\d+\.\s*/.test(line)) errors.push(`Malformed numbering on line ${index + 1}.`); if (/^\s*\d+\.\s*$/.test(line)) errors.push(`Empty numbered item on line ${index + 1}.`); if (/^\s*[-*+]\s+.+\s+[-*+]\s+\S/.test(line)) errors.push(`Multiple bullet items merged on line ${index + 1}.`); if (/\S\s+---\s+\S/.test(line) || (/---/.test(line) && !/^\s*---\s*$/.test(line) && !/^\s*\|/.test(line))) errors.push(`Horizontal rule is not on its own line ${index + 1}.`); if (/^#{1,6}\s+/.test(line) && index + 1 < lines.length && lines[index + 1].trim() !== "") errors.push(`Heading on line ${index + 1} is missing a blank line after it.`); const opens = (line.match(/\[/g) || []).length; const closes = (line.match(/\]\([^)]*\)/g) || []).length; if (opens > closes) errors.push(`Broken Markdown link on line ${index + 1}.`); });
  const numbered = lines.map((line) => line.match(/^\s*(\d+)\.\s+\S/)).filter(Boolean).map((match) => Number(match[1])); for (let i = 1; i < numbered.length; i += 1) if (numbered[i] !== numbered[i - 1] + 1 && numbered[i] !== 1) errors.push("Numbered list is not sequential.");
  if (cta && text.includes(cta)) { const index = lines.findIndex((line) => line.includes(cta)); if (index >= 0 && ((lines[index - 1] || "").trim() || (lines[index + 1] || "").trim())) errors.push("CTA is merged with surrounding content."); }
  return { markdown_structure_valid: errors.length === 0, markdown_structure_errors: [...new Set(errors)] };
}

export function evaluateRent2BuyRule(article = {}, options = {}) {
  const product = classifyArticleProduct(article, options.intent || options.assessment?.effective_intent || {}, options.scopeOverride);
  if (product !== "rent2buy" && product !== "both") return { applies: false, product, violations: [], passed: true, ...validateRent2BuySemantics(article, options), ...validateComparisonStructure(article, options) };
  const semantic = validateRent2BuySemantics(article, options); const comparison = validateComparisonStructure(article, options); const violations = semantic.rent2buy_semantic_errors.map((item) => `prohibited Rent2Buy ${item.category} wording remains in ${item.section}: ${item.phrase}`);
  const rent2buyText = product === "both" ? semanticLocations(article, product).filter((item) => item.product_context === "rent2buy").map((item) => item.text).join("\n") : `${article.title || ""}\n${article.excerpt || ""}\n${article.content_markdown || ""}\n${article.cta || ""}`;
  if (!new RegExp(`(?:^|\\n)\\s*${RENT2BUY_COLLECTION_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:\\n|$)`, "i").test(rent2buyText)) violations.push(`missing exact standalone collection wording: ${RENT2BUY_COLLECTION_SENTENCE}`);
  if (!rent2buyText.includes(RENT2BUY_SEPARATION_SENTENCE)) violations.push("missing Rent2Buy product-separation facts");
  violations.push(...comparison.comparison_structure_errors);
  return { applies: true, product, violations: [...new Set(violations)], passed: violations.length === 0, ...semantic, ...comparison };
}

export function rent2BuyPromptRule(subject = {}, options = {}) {
  const product = classifyArticleProduct(subject, options.intent || {}, options.scopeOverride); if (product !== "rent2buy" && product !== "both") return "";
  if (product === "both") return `\n# Product scope: Both / Comparison\nPreserve legitimate Van Finance comparison content. Keep Van Finance and Rent2Buy in distinct labelled sections or table columns. Finance terminology is allowed only in the Van Finance or neutral comparison context. Correct the Rent2Buy side to follow the permanent rule, include “${RENT2BUY_SEPARATION_SENTENCE}” and “${RENT2BUY_COLLECTION_SENTENCE}”, and remove trial or delivery claims from the Rent2Buy side. ${RENT2BUY_EVIDENCE_GUARDRAIL} Do not let the AI change the product scope.`;
  return `\n# Product scope: Rent2Buy\n${RENT2BUY_CORE_WORDING}\n${RENT2BUY_EVIDENCE_GUARDRAIL}\nCorrect every validated field. Remove substantive finance-comparison sections and all prohibited finance, trial or delivery concepts except the approved clarification. Preserve valid content and Markdown. Place “${RENT2BUY_SEPARATION_SENTENCE}” in the introduction and “${RENT2BUY_COLLECTION_SENTENCE}” before the CTA. Do not let the AI change the product scope.`;
}

export function withPermanentRent2BuyKnowledge(sections = []) { return (Array.isArray(sections) ? sections : []).map((section) => section?.section_key === "compliance" ? { ...section, active: true, entries: [...(section.entries || []).filter((entry) => entry?.label !== RENT2BUY_RULE_LABEL), RENT2BUY_BUSINESS_KNOWLEDGE_RULE] } : section); }
export async function ensureRent2BuyBusinessKnowledge(supabase) { const existing = await supabase.from("knowledge_business_sections").select("*").eq("section_key", "compliance").maybeSingle(); if (existing.error) throw existing.error; const section = existing.data || { section_key: "compliance", title: "Compliance", description: "Confirmed guidance, prohibited claims and facts that require review.", content: "", entries: [], sort_order: 5 }; const payload = { ...section, active: true, entries: [...(section.entries || []).filter((entry) => entry?.label !== RENT2BUY_RULE_LABEL), RENT2BUY_BUSINESS_KNOWLEDGE_RULE], updated_at: new Date().toISOString() }; delete payload.id; const result = await supabase.from("knowledge_business_sections").upsert(payload, { onConflict: "section_key" }).select().single(); if (result.error) throw result.error; return result.data; }
