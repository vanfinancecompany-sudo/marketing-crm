const clean = (value) => String(value || "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export const RENT2BUY_SECTION_KEY = "compliance";
export const RENT2BUY_RULE_LABEL = "Permanent Rent2Buy product separation";
export const RENT2BUY_COLLECTION_SENTENCE = "Collection only from Southampton.";
export const RENT2BUY_CORE_WORDING = `Rent2Buy is a separate rent-to-own arrangement and is not a finance product. Vehicles are collection only from Southampton. The agreement terms, payment structure, eligibility requirements and ownership conditions should be reviewed before proceeding.`;
export const RENT2BUY_BUSINESS_KNOWLEDGE_RULE = Object.freeze({ label: RENT2BUY_RULE_LABEL, value: `${RENT2BUY_CORE_WORDING} Prohibited in Rent2Buy content: finance products, van finance, Hire Purchase, PCP, Lease Purchase, APR, interest rates, finance rates, lenders, lender panels, finance approval, finance applications, finance deposits, representative APR, monthly finance repayments, credit-broker wording, test driving before purchase, trying or trialling the van before committing, free UK delivery, home delivery and work-address delivery. Mixed articles must keep Van Finance and Rent2Buy in distinct headed sections.` });

const PROHIBITED = [
  /\btraditional finance options?\b/i, /\bfinance agreements?\b/i, /\bfinance products?\b/i, /\bvan finance\b/i,
  /\bhire purchase\b/i, /\bpcp\b/i, /\blease purchase\b/i, /\brepresentative apr\b/i, /\bapr\b/i,
  /\binterest rates?\b/i, /\bfinance rates?\b/i, /\blender panels?\b/i, /\blenders?\b/i,
  /\bfinance approvals?\b/i, /\bapproval rates?\b/i, /\bfinance applications?\b/i, /\bfinance deposits?\b/i,
  /\bmonthly finance repayments?\b/i, /\bcredit broker\b|\bcredit-broker\b/i,
  /\btest(?:ing)? (?:the )?van\b/i, /\btry(?:ing)? (?:the )?van\b/i, /\btry before buy(?:ing)?\b/i,
  /\brent before committing\b/i, /\bsee whether (?:the )?van suits you before buying\b/i, /\btrial(?:ling)? (?:the )?van\b/i,
  /\bfree uk delivery\b/i, /\bhome delivery\b/i, /\bwork(?:place|-address| address) delivery\b/i, /\bdelivery is (?:not )?available\b/i,
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
  if (cta && text.includes(cta)) {
    const ctaLine = lines.findIndex((line) => line.includes(cta));
    if (ctaLine >= 0 && ((lines[ctaLine - 1] || "").trim() || (lines[ctaLine + 1] || "").trim())) errors.push("CTA is merged with surrounding content.");
  }
  return { markdown_structure_valid: errors.length === 0, markdown_structure_errors: [...new Set(errors)] };
}

export function evaluateRent2BuyRule(article = {}, options = {}) {
  const product = classifyArticleProduct(article, options.intent || options.assessment?.effective_intent || {});
  const fullText = `${article.title || ""}\n${article.excerpt || ""}\n${article.content_markdown || ""}\n${article.cta || ""}`;
  const inspected = product === "both" ? sections(article.content_markdown).filter((section) => /rent2buy|rent\s?2\s?buy|rent-to-buy|rent-to-own/i.test(section.heading)).map((section) => `${section.heading}\n${section.text}`).join("\n") : fullText;
  if (product !== "rent2buy" && product !== "both") return { applies: false, product, violations: [], passed: true };
  const violations = PROHIBITED.filter((pattern) => pattern.test(inspected)).map((pattern) => `prohibited Rent2Buy wording remains: ${pattern.source}`);
  if (!new RegExp(`(?:^|\\n)\\s*${RENT2BUY_COLLECTION_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:\\n|$)`, "i").test(inspected)) violations.push(`missing exact standalone collection wording: ${RENT2BUY_COLLECTION_SENTENCE}`);
  if (!/not (?:a )?finance product/i.test(inspected) || !/rent-to-own arrangement/i.test(inspected)) violations.push("missing Rent2Buy product-separation facts");
  if (product === "both") { const headings = sections(article.content_markdown).map((section) => section.heading); if (!headings.some((heading) => /finance/i.test(heading)) || !headings.some((heading) => /rent2buy|rent\s?2\s?buy|rent-to-buy/i.test(heading))) violations.push("mixed article products are not separated into distinct headed sections"); }
  return { applies: true, product, violations: [...new Set(violations)], passed: violations.length === 0 };
}

export function rent2BuyPromptRule(subject = {}) {
  const product = classifyArticleProduct(subject); if (product !== "rent2buy" && product !== "both") return "";
  return `\n# Permanent Rent2Buy product rule\n${RENT2BUY_CORE_WORDING}\nFor pure Rent2Buy content, remove prohibited finance, delivery and trial references completely, including negative or comparison wording. Remove whole finance-comparison sections and tables. Preserve all unrelated headings, paragraphs, bullet lists, numbered lists, horizontal rules, bold text, links, permitted tables and CTA placement. Never flatten lists or merge paragraphs. Insert the exact standalone sentence “${RENT2BUY_COLLECTION_SENTENCE}” naturally within Key Features and Benefits, Practical Next Steps, or a dedicated Collection section—not after the CTA. Mixed content may retain separate Finance and Rent2Buy sections only when explicitly classified as both.`;
}

export function withPermanentRent2BuyKnowledge(sections = []) { return (Array.isArray(sections) ? sections : []).map((section) => section?.section_key === "compliance" ? { ...section, active: true, entries: [...(section.entries || []).filter((entry) => entry?.label !== RENT2BUY_RULE_LABEL), RENT2BUY_BUSINESS_KNOWLEDGE_RULE] } : section); }
export async function ensureRent2BuyBusinessKnowledge(supabase) { const existing = await supabase.from("knowledge_business_sections").select("*").eq("section_key", "compliance").maybeSingle(); if (existing.error) throw existing.error; const section = existing.data || { section_key: "compliance", title: "Compliance", description: "Confirmed guidance, prohibited claims and facts that require review.", content: "", entries: [], sort_order: 5 }; const payload = { ...section, active: true, entries: [...(section.entries || []).filter((entry) => entry?.label !== RENT2BUY_RULE_LABEL), RENT2BUY_BUSINESS_KNOWLEDGE_RULE], updated_at: new Date().toISOString() }; delete payload.id; const result = await supabase.from("knowledge_business_sections").upsert(payload, { onConflict: "section_key" }).select().single(); if (result.error) throw result.error; return result.data; }
