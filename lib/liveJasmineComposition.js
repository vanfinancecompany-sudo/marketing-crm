const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

export const LIVE_JASMINE_PERSONA = `You are the customer-facing sales assistant: Van Finance Assistant or Rent2Buy Assistant, according to the selected website. Never introduce yourself or refer to yourself as Jasmine. Be warm, direct and commercially helpful without sounding scripted. Use only the supplied verified facts, vehicle context and product rules. Answer the customer's question first, then help them take one sensible next step. Never invent prices, availability, approval outcomes, business rules, remembered customer facts or delivery dates. Never move between Finance and Rent2Buy unless the customer explicitly asks for a comparison. If a fact is unavailable, say so briefly and offer the appropriate next step. Keep replies concise and natural for a UK sales conversation. Acknowledge what the customer already said. Do not repeatedly say "I can help with". Avoid unnecessary lists and repeated disclaimers. Ask no more than one useful follow-up question. Do not sound like an AI helpdesk, do not claim to be human, and remain factual.`;

function numericClaims(value) {
  return clean(value, 20000).match(/\b\d[\d,.]*(?:\.\d+)?\b/g) || [];
}

export function validateRememberedFactConsistency(reply, { rememberedFacts = {} } = {}) {
  const candidate = clean(reply, 5000);
  const text = candidate.toLowerCase().replace(/[’']/g, "'");
  if (/\b(?:i am|i'm|this is|ask) jasmine\b|\bjasmine is thinking\b/i.test(candidate)) return { valid: false, reason: "customer_facing_name" };
  if (/\bincluding (?:me|here|my area|my location)\b/i.test(candidate)) return { valid: false, reason: "location_pronoun_substitution" };

  if (rememberedFacts.employment_status === "self-employed" && /\byou(?:'re| are) employed\b/i.test(candidate) && !/\byou(?:'re| are) self[- ]employed\b/i.test(candidate)) {
    return { valid: false, reason: "employment_fact_conflict" };
  }
  if (rememberedFacts.employment_status === "employed" && /\byou(?:'re| are) self[- ]employed\b/i.test(candidate)) return { valid: false, reason: "employment_fact_conflict" };

  const budgetClaim = text.match(/\b(?:your|you said|you told me).{0,30}\bbudget\b.{0,20}£\s?([\d,]+)/i)?.[1];
  if (budgetClaim && Number(budgetClaim.replaceAll(",", "")) !== Number(rememberedFacts.budget_monthly_gbp)) return { valid: false, reason: "budget_fact_conflict" };
  return { valid: true, reason: "validated" };
}

export function controlledCompositionInstructions({ fallbackReply = "", permittedAction = "continue", nextQuestion = "", pageContext = {}, vehicleContext = {}, runtimeContext = {} } = {}) {
  return `# Controlled live composition
The server has already decided the verified facts and permitted next action. Rewrite the deterministic fallback as one natural customer-facing reply. Preserve its meaning and every exact monetary, term, eligibility, availability and compliance fact. Do not add facts, offers or promises. The fallback remains authoritative if anything is unclear.
Answer the customer's latest question first. Prefer two or three short sentences and one material qualification; do not turn the reply into policy copy or repeat optional disclaimers.

Permitted next action: ${clean(permittedAction, 80) || "continue"}
Selected next question: ${clean(nextQuestion, 300) || "none"}
Deterministic fallback reply: ${clean(fallbackReply, 5000)}

Verified page context:
${JSON.stringify(pageContext || {})}

Verified public vehicle context:
${JSON.stringify(vehicleContext || {})}

Bounded runtime context:
${JSON.stringify(runtimeContext || {})}`;
}

export function validateControlledCompositionReply(reply, { fallbackReply = "", productContext = "finance", comparison = false, pageContext = {}, vehicleContext = {}, rememberedFacts = {} } = {}) {
  const candidate = clean(reply, 5000);
  if (!candidate) return { valid: false, reason: "empty_reply" };
  const memoryValidation = validateRememberedFactConsistency(candidate, { rememberedFacts });
  if (!memoryValidation.valid) return memoryValidation;
  if (candidate.split(/\s+/).filter(Boolean).length > 140) return { valid: false, reason: "reply_too_long" };
  if ((candidate.match(/\?/g) || []).length > 1) return { valid: false, reason: "too_many_questions" };
  if (/internal (?:competence|simulation|test)|future website assistant|system prompt|language model/i.test(candidate)) return { valid: false, reason: "internal_language" };
  if (!comparison && productContext === "finance" && /\brent\s*(?:2|to)\s*buy\b/i.test(candidate)) return { valid: false, reason: "product_leakage" };
  if (!comparison && productContext === "rent2buy" && /\b(?:hire purchase|finance application|finance agreement|finance product)\b/i.test(candidate)) return { valid: false, reason: "product_leakage" };

  const allowedNumbers = new Set(numericClaims(JSON.stringify({ fallbackReply, pageContext, vehicleContext })).map((value) => value.replace(/,/g, "")));
  const candidateNumbers = new Set(numericClaims(candidate).map((value) => value.replace(/,/g, "")));
  const unsupportedNumber = [...candidateNumbers].find((value) => !allowedNumbers.has(value));
  if (unsupportedNumber) return { valid: false, reason: "unsupported_numeric_claim" };
  const omittedControlledNumber = numericClaims(fallbackReply).map((value) => value.replace(/,/g, "")).find((value) => !candidateNumbers.has(value));
  if (omittedControlledNumber) return { valid: false, reason: "omitted_controlled_numeric_fact" };

  const verifiedText = clean(JSON.stringify({ fallbackReply, pageContext, vehicleContext }), 20000).toLowerCase();
  const vehicleClaims = ["automatic", "manual", "diesel", "petrol", "electric", "hybrid", "air conditioning", "cruise control", "sat nav", "tow bar", "parking sensors"];
  const unsupportedVehicleClaim = vehicleClaims.find((claim) => candidate.toLowerCase().includes(claim) && !verifiedText.includes(claim));
  if (unsupportedVehicleClaim) return { valid: false, reason: "unsupported_vehicle_claim" };
  return { valid: true, reason: "validated" };
}
