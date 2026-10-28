// Preview-only exact-match public FAQ routing. Answers come from the active
// approved Business Brain FAQ entries, never from hard-coded financing terms.
// On missing, conflicting or incomplete policy, return null and use normal AI.
const clean = (value) => String(value ?? "").trim().toLowerCase()
  .replace(/[’‘]/g, "'")
  .replace(/[?!.,]+$/g, "")
  .replace(/\s+/g, " ");
const EXACT = Object.freeze([
  {
    id: "finance_guarantee",
    product: "finance",
    label: "Does Van Finance guarantee approval?",
    pattern: /^(?:does (?:van finance|van finance company) guarantee approval|is (?:van )?finance approval guaranteed|can you guarantee (?:van )?finance approval)$/,
    required: [/^no\b/i, /subject to lender criteria/i, /credit checks/i, /affordability/i, /approval/i],
  },
  {
    id: "finance_deposit",
    product: "finance",
    label: "Is the Van Finance deposit always £99?",
    pattern: /^(?:is (?:the )?(?:van finance )?deposit always £?99|is (?:the )?(?:van finance )?deposit guaranteed (?:to be )?£?99|is (?:the )?£?99 deposit guaranteed)$/,
    required: [/^no\b/i, /£99/i, /varies/i],
  },
  {
    id: "finance_vat",
    product: "finance",
    label: "Can VAT be included in van finance?",
    pattern: /^(?:can (?:the )?vat be (?:included|financed) in (?:my )?(?:van )?finance|can i finance (?:the )?vat)$/,
    required: [/may be possible/i, /lender/i, /agreement/i],
  },
  {
    id: "rent2buy_guarantee",
    product: "rent2buy",
    label: "Is Rent2Buy guaranteed?",
    pattern: /^(?:is rent2buy (?:approval|acceptance )?guaranteed|does rent2buy guarantee acceptance)$/,
    required: [/^no\b/i, /reviewed individually/i, /not guaranteed/i],
  },
  {
    id: "rent2buy_documents",
    product: "rent2buy",
    label: "What documents are needed for Rent2Buy?",
    pattern: /^(?:what documents (?:are|do i) need(?:ed)? (?:for|to apply for) rent2buy|what (?:proofs|paperwork) do i need for rent2buy)$/,
    required: [/three recent full bank statements/i, /two proofs of address/i, /full uk or eu driving licence/i],
  },
  {
    id: "rent2buy_geography",
    product: "rent2buy",
    label: "Is Rent2Buy available everywhere in the UK?",
    pattern: /^(?:is rent2buy available (?:everywhere in the uk|nationwide|across the uk)|do you offer rent2buy nationwide)$/,
    required: [/100 miles/i, /southampton/i],
  },
  {
    id: "rent2buy_insurance",
    product: "rent2buy",
    label: "Does Rent2Buy include insurance?",
    pattern: /^(?:does rent2buy include insurance|is insurance included (?:with|in) rent2buy)$/,
    required: [/^no\b/i, /fully comprehensive insurance/i, /before collection/i],
  },
  {
    id: "warranty_variation",
    product: "both",
    label: "Are warranty terms the same on every van?",
    pattern: /^(?:are warranty terms the same on every van|is the warranty the same on every van|do all vans have the same warranty)$/,
    required: [/^no\b/i, /individual vehicle/i],
  },
]);

export function matchApprovedFirstTurnFaq({ message = "", session = {} } = {}) {
  if (!["finance","rent2buy"].includes(session.product_lock)) return null;
  if (!["finance_general","rent2buy_general"].includes(session.page_type)) return null;
  if (Number(session.message_count || 0) !== 0) return null;
  if ((session.conversation_history || []).length > 0) return null;
  if (session.vehicle_context?.registration || session.vehicle_context?.title) return null;
  if (session.journey_state?.application_mode_active || session.journey_state?.application_state) return null;
  const question = clean(message);
  if (!question || question.length > 130) return null;
  return EXACT.find((rule) => (rule.product === session.product_lock || rule.product === "both") && rule.pattern.test(question)) || null;
}

export function approvedFaqReply(rule, entries) {
  if (!rule || !Array.isArray(entries)) return null;
  // Do not resolve from merged website imports: exact labelled authoritative FAQ only.
  const matched = entries.filter((entry) => String(entry?.label || "").trim() === rule.label && String(entry?.value || "").trim());
  if (matched.length !== 1) return null;
  const value = String(matched[0].value).trim();
  if (!value || value.length > 750 || rule.required.some((pattern) => !pattern.test(value))) return null;
  // Customer-facing clarity only; every contractual/eligibility fact remains
  // the current approved FAQ. No term, number or promise is introduced.
  if (rule.id === "rent2buy_geography" && !/^no\b/i.test(value)) return `No. ${value}`;
  if (rule.id === "rent2buy_insurance") {
    return value.replace(/^No\. The customer must arrange /i, "No. You need to arrange ");
  }
  return value;
}

export async function loadApprovedFaqReply(supabase, rule) {
  if (!rule) return null;
  // Read only the current approved FAQ, never outdated website text.
  try {
    const { data, error } = await supabase.from("knowledge_business_sections")
      .select("entries").eq("section_key","faqs").eq("active",true).maybeSingle();
    if (error) return null;
    return approvedFaqReply(rule, data?.entries);
  } catch {
    return null;
  }
}
