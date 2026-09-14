import { extractUkLocation } from "./productCoverageRules.js";

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
const SIMPLE_INTENTS = new Set(["greeting", "general_help_request", "thanks", "goodbye"]);
export const CONVERSATION_INTENTS = Object.freeze([
  "greeting", "general_help_request", "thanks", "goodbye", "confusion", "frustration",
  "ready_to_apply", "human_assistance_requested", "product_clarification_required",
  "incomplete_business_question", "knowledge_question", "multi_part_question", "topic_change", "customer_correction", "customer_fact_statement",
]);
export const CONVERSATION_REVIEW_OUTCOMES = Object.freeze([
  "pass", "needs_adjustment", "incorrect", "unsafe", "robotic", "lost_context",
  "asked_unnecessary_clarification", "failed_to_clarify", "wrong_product", "hallucinated_fact",
  "too_long", "too_formal", "too_salesy", "missed_buying_signal", "weak_next_question",
  "repeated_information", "failed_to_use_known_fact", "good_sales_conversation",
  "missed_application_opportunity", "should_have_shown_application", "asked_unnecessary_question",
  "failed_to_recognise_buying_intent", "repeated_itself", "weak_sales_progression",
  "excellent_application_guidance", "natural_closing",
]);
export const CONVERSATION_RATING_FIELDS = Object.freeze([
  "intent_understood", "conversation_naturalness", "context_memory", "clarification_quality", "accuracy",
  "product_separation", "helpfulness", "brevity", "conversion_value", "safety",
]);

const LOCATION_WORDS = ["manchester", "portsmouth", "southampton", "london", "leeds", "birmingham", "bristol", "cardiff", "glasgow", "edinburgh", "liverpool", "newcastle", "nottingham", "sheffield", "plymouth", "bournemouth", "reading", "oxford", "cambridge", "brighton", "leicester", "coventry", "derby", "york"];
const LOCATION_PATTERN = new RegExp(`\\b(${LOCATION_WORDS.join("|")})\\b`, "i");
const PRODUCT_PATTERNS = { rent2buy: /rent\s*(?:2|to)\s*(?:buy|biy)|monthly rental/i, finance: /\bfin(?:ance|ace|nace)\b|hire purchase|lender|apr/i };
const CORRECTION_PATTERN = /\b(?:actually|correction|correct that|i meant|sorry|make that|instead|no longer|now|changed|not (?:any more|anymore))\b/i;
const CUSTOMER_FACT_PROVENANCE = new Set(["customer_explicit", "customer_contextual", "legacy_customer_explicit"]);
const PROVENANCE_PRIORITY = Object.freeze({ inferred: 1, system_context: 2, customer_contextual: 3, legacy_customer_explicit: 4, customer_explicit: 5 });

export function normaliseCustomerMessage(message) {
  return clean(message).toLowerCase()
    .replace(/\brent\s*(?:2|to)\s*(?:biy|buy)\b/g, "rent2buy")
    .replace(/\bfinace\b|\bfinanse\b|\bfinanc\b/g, "finance")
    .replace(/\bself[\s-]*(?:employed|emplyd|emp)\b/g, "self employed")
    .replace(/\bcan\s+u\b/g, "can you")
    .replace(/\bhlp\b/g, "help")
    .replace(/\bexplane\b/g, "explain")
    .replace(/\bned\b/g, "need")
    .replace(/\bquik\b/g, "quickly")
    .replace(/\bdepost\b/g, "deposit")
    .replace(/\bwat\b/g, "what")
    .replace(/\bnxt\b/g, "next")
    .replace(/\bmnths?\b/g, "months")
    .replace(/\baply\b/g, "apply")
    .replace(/\bcredt\b/g, "credit")
    .replace(/\bdeclind\b/g, "declined")
    .replace(/\bstil\b/g, "still")
    .replace(/\bdelivry\b/g, "delivery")
    .replace(/\blng\b/g, "long")
    .replace(/\bdocs?\b/g, "documents")
    .replace(/\bthx\b/g, "thanks")
    .replace(/\bpls\b|\bplz\b/g, "please")
    .replace(/\basap\b/g, "quickly")
    .replace(/\bhow much down\b/g, "how much deposit")
    .replace(/\bown it end\b/g, "own it at the end")
    .replace(/\beu licen[cs]e ok\b/g, "is an eu licence accepted")
    .replace(/\bbeen declined\b/g, "I have been declined")
    .replace(/\b(?:sales\s+)?tax\b/g, "vat")
    .replace(/\binc(?:luding|luded|lusive)?\s+vat\b/g, "vat included")
    .replace(/\bex(?:cluding|cluded|clusive)?\s+vat\b/g, "vat excluded")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(months?|years?)\b/g, (_match, count, unit) => `${({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 })[count]} ${unit}`)
    .replace(/\b(\w+)(?:\s+\1\b)+/g, "$1")
    .replace(/[^a-z0-9£.\s-]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function detectedProduct(text) {
  const finance = PRODUCT_PATTERNS.finance.test(text);
  const rent2buy = PRODUCT_PATTERNS.rent2buy.test(text);
  return finance && rent2buy ? "both" : finance ? "finance" : rent2buy ? "rent2buy" : "unknown";
}

function businessSubIntents(text) {
  const found = [];
  const add = (name, pattern) => { if (pattern.test(text)) found.push(name); };
  add("coverage", /postcode|cover|coverage|available\s+(?:in|near)|live\s+(?:in|near)|based\s+(?:in|near)|distance|miles|nationwide|northern ireland|england|wales|scotland|\b(?:manchester|portsmouth|southampton)\b/);
  add("deposit", /deposit|money down|upfront|initial rental/);
  add("self_employed", /self employed|sole trader/);
  add("trading_history", /trading|business.{0,20}(?:months?|years?)|\b\d+\s*(?:months?|years?)\b/);
  add("poor_credit", /poor credit|bad credit|credit problems?|ccj|declined/);
  add("documents", /documents?|bank statements?|proof|licen[cs]e/);
  add("ownership", /own|ownership|at the end|final payment/);
  add("monthly_cost", /monthly|per month|payment|repayment|cost|budget/);
  add("vat_pricing", /\bvat\b(?!\s+registered)|value added tax|prices?.{0,20}(?:included|inclusive|plus|excluding|exclusive)|payments?.{0,20}(?:included|inclusive|plus|excluding|exclusive)/);
  add("vehicle", /transit|custom|sprinter|crafter|van|vehicle/);
  add("application", /apply|application|start|next step|ready|want this/);
  add("delivery_collection", /deliver|delivery|collect|collection/);
  add("multiple_vehicles", /(?:two|three|four|five|[2-9])\s+(?:vans?|vehicles?)|fleet/);
  add("business_use", /vat registered|limited company|ltd|for my company|business use/);
  return [...new Set(found)];
}

export function classifyMonthlyAmountIntent(message = "") {
  const text = normaliseCustomerMessage(message);
  const amountMatch = text.match(/£\s?([\d,]+)/);
  const amount = Number(amountMatch?.[1]?.replaceAll(",", ""));
  const hasMonthlyMeaning = /\b(?:monthly|month|per month|pcm|payment|payments|repayment|repayments|budget|spend|afford)\b/.test(text);
  const hasPricingMeaning = hasMonthlyMeaning || /\b(?:price|priced|pricing|cost|costs|rental|rentals)\b/.test(text);
  const questionOpening = /^(?:how much|what(?: s| is| are)?|whats|which|can|could|would|will|is|are|do|does|did|have|has)\b/.test(text);
  if (questionOpening && hasPricingMeaning) return { kind: "pricing_question", amount: Number.isFinite(amount) ? amount : null, qualifier: null };
  if (!hasMonthlyMeaning || !Number.isFinite(amount) || amount < 50 || amount > 99999) return { kind: "none", amount: null, qualifier: null };
  const qualifier = /\b(?:under|below|less than|no more than|up to)\b/.test(text) ? "under" : /\b(?:around|about|roughly|approximately)\b/.test(text) ? "around" : "exact";
  return { kind: "budget_statement", amount, qualifier };
}

export function classifyConversationIntent({ message, history = [], productContext = "finance" } = {}) {
  if (!["finance", "rent2buy"].includes(productContext)) throw new Error("Conversation product context must be finance or rent2buy.");
  const original = clean(message);
  const normalised = normaliseCustomerMessage(original);
  const product = detectedProduct(normalised);
  const subIntents = businessSubIntents(normalised);
  const monthlyAmountIntent = classifyMonthlyAmountIntent(original);
  const hasHistory = history.some((item) => item?.role === "user");
  const recentUserContext = normaliseCustomerMessage(history.filter((item) => item?.role === "user").slice(-2).map((item) => item.content).join(" "));
  let primaryIntent = "knowledge_question";
  let retrievalNeeded = true;
  let clarificationNeeded = false;
  let clarificationQuestion = "";
  let confidence = 92;
  let reason = "The message contains a recognisable business-information request.";

  if (/^(hi|hello|hey|hiya|morning|afternoon|evening|anyone there)[!. ]*$/.test(normalised)) {
    primaryIntent = "greeting"; retrievalNeeded = false; reason = "Greeting only; no business fact was requested.";
  } else if (/^(thanks|thank you|cheers|nice one|brilliant)[!. ]*$/.test(normalised)) {
    primaryIntent = "thanks"; retrievalNeeded = false; reason = "Acknowledgement only; retrieval would add no value.";
  } else if (/^(bye|goodbye|see you|speak soon|later)[!. ]*$/.test(normalised)) {
    primaryIntent = "goodbye"; retrievalNeeded = false; reason = "Conversation closing message.";
  } else if (/speak to (?:someone|a person)|need (?:a human|someone)|call me|human please|this hasn'?t helped/.test(normalised)) {
    primaryIntent = "human_assistance_requested"; retrievalNeeded = false; reason = "The visitor explicitly requested human assistance.";
  } else if (/fed up|annoyed|frustrat|useless|not helping|doesn'?t help|this hasn'?t helped|not answering|already told you|stop asking/.test(normalised)) {
    primaryIntent = "frustration"; retrievalNeeded = false; reason = "The visitor is expressing frustration rather than asking for a business fact.";
  } else if (/^(can you help|can you help me|help|need help|need (?:a )?van(?: quickly)?|not sure where to start)[!. ]*$/.test(normalised)) {
    primaryIntent = "general_help_request"; retrievalNeeded = false; reason = "A broad help request should receive a short product-specific invitation.";
  } else if (/^(i'?m confused|confused|not sure|dont understand|don'?t understand)[!. ]*$/.test(normalised)) {
    primaryIntent = "confusion"; retrievalNeeded = false; clarificationNeeded = true; clarificationQuestion = productContext === "finance" ? "Which part of van finance would you like me to explain?" : "Which part of Rent2Buy would you like me to explain?"; reason = "The visitor is confused but has not identified the subject.";
  } else if (/^(transit|monthly)[?!. ]*$/.test(normalised)) {
    const resolvedByHistory = /^transit/.test(normalised) ? /finance|availability|vehicle|choose/.test(recentUserContext) : /cost|deposit|payment|budget|mileage/.test(recentUserContext);
    if (resolvedByHistory) {
      primaryIntent = "knowledge_question"; retrievalNeeded = true; clarificationNeeded = false; reason = "Recent conversation context resolves the otherwise ambiguous short phrase.";
    } else {
      primaryIntent = "incomplete_business_question"; retrievalNeeded = false; clarificationNeeded = true;
      clarificationQuestion = /^transit/.test(normalised) ? "Are you asking about financing a Transit, vehicle availability, or something else?" : "Are you asking about the monthly cost, monthly mileage allowance, or monthly payment process?";
      reason = "The phrase has several plausible business meanings and needs one focused clarification."; confidence = 98;
    }
  } else if (product !== "unknown" && product !== productContext && product !== "both") {
    primaryIntent = "product_clarification_required"; retrievalNeeded = false; clarificationNeeded = true;
    clarificationQuestion = `This simulation is locked to ${productContext === "finance" ? "van finance" : "Rent2Buy"}. What would you like to know about that option?`;
    reason = "The message names the other product, but page context remains locked.";
  } else if (/\b(actually|correction|i meant|sorry i live|moving to|make that)\b/.test(normalised)) {
    primaryIntent = "customer_correction"; retrievalNeeded = subIntents.length > 0; reason = "The visitor is correcting previously supplied context.";
  } else if (monthlyAmountIntent.kind === "budget_statement") {
    primaryIntent = "customer_fact_statement"; retrievalNeeded = false; clarificationNeeded = false; reason = "The visitor supplied a monthly budget rather than asking for a vehicle price.";
  } else if (/^(i\s*m ready|start application|apply now|what\s*s next|i want this van)[!. ]*$/.test(normalised) || /how do i apply/.test(normalised)) {
    primaryIntent = "ready_to_apply"; retrievalNeeded = false; reason = "The visitor has expressed clear application intent.";
  } else if (hasHistory && /^(?:not\s+)?vat registered[!. ]*$/.test(normalised)) {
    primaryIntent = "topic_change"; retrievalNeeded = false; clarificationNeeded = false; reason = "The visitor supplied VAT-registration status as conversation context rather than requesting a business fact.";
  } else if (subIntents.length > 1) {
    primaryIntent = "multi_part_question"; retrievalNeeded = true; reason = "Several business facts or questions were detected in one message.";
  } else if (hasHistory && /^(also|what about|and|actually)\b/.test(normalised)) {
    primaryIntent = "topic_change"; retrievalNeeded = true; reason = "The message changes or extends the active topic.";
  } else if (!subIntents.length && normalised.split(" ").length <= 2) {
    primaryIntent = "incomplete_business_question"; retrievalNeeded = false; clarificationNeeded = true;
    clarificationQuestion = `What would you like to know about ${productContext === "finance" ? "van finance" : "Rent2Buy"} and “${original}”?`;
    reason = "The short phrase is not specific enough to retrieve a reliable business answer."; confidence = 72;
  }

  return {
    original_message: original,
    normalised_message: normalised,
    primary_intent: primaryIntent,
    secondary_intents: subIntents,
    detected_product: product,
    product_context: productContext,
    retrieval_required: retrievalNeeded,
    clarification_required: clarificationNeeded,
    suggested_clarification_question: clarificationQuestion,
    confidence,
    reason,
    monthly_amount_intent: monthlyAmountIntent,
  };
}

function titleCase(value) { return clean(value).replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function explicitEmploymentStatus(text) {
  const selfEmployed = /\b(?:i am|i m|im|my employment(?: status)? is|i work as)\s+(?:currently\s+)?self employed\b|^(?:self employed|sole trader)\b/i.test(text);
  if (selfEmployed) return "self-employed";
  if (/\b(?:i am|i m|im|my employment(?: status)? is|i work as)\s+(?:a\s+)?(?:limited company director|company director)\b|^limited company\b/i.test(text)) return "limited company";
  if (/\b(?:i am|i m|im|my employment(?: status)? is)\s+(?:currently\s+)?employed\b|^employed$/i.test(text)) return "employed";
  return "";
}

function explicitlySuppliedLocation(text) {
  return /\b(?:i live|i am living|i m living|im living|i am based|i m based|im based|my (?:home )?(?:location|town|city|postcode) is)\b|\b(?:i am|i m|im)\s+(?:in|near|at)\b/i.test(text);
}

function explicitlySuppliedCreditConcern(text) {
  return /\bmy credit\s+(?:is poor|is bad|is not great|isn t great|is not good|isn t good)\b|\bi (?:have|ve got)\s+(?:poor|bad) credit\b|\b(?:i have|i ve been|i was)\s+(?:declined|refused|turned down)\b|^(?:(?:poor|bad) credit|(?:declined|refused|turned down)\b.*)$/i.test(text);
}

function monthlyBudgetAmount(text) {
  const monthlyContext = /\b(?:monthly budget|budget(?: is| of| around| roughly| about)?|keep (?:the )?payments?|payments?).{0,35}£\s?[\d,]+|£\s?[\d,]+.{0,35}\b(?:a month|per month|monthly|monthly budget|budget)\b/i.test(text);
  if (!monthlyContext) return null;
  const match = text.match(/£\s?([\d,]+)/);
  const amount = Number(match?.[1]?.replaceAll(",", ""));
  return Number.isFinite(amount) && amount >= 50 && amount <= 99999 ? amount : null;
}

export function extractConversationFacts(message, previousFacts = {}) {
  const text = normaliseCustomerMessage(message);
  const facts = {};
  const postcodeLocation = extractUkLocation(message);
  const knownLocation = text.match(LOCATION_PATTERN)?.[1];
  if (postcodeLocation?.type === "full_postcode") facts.location = postcodeLocation.query;
  else if (postcodeLocation?.type === "town_or_city") facts.location = titleCase(postcodeLocation.query);
  else if (knownLocation) facts.location = titleCase(knownLocation);
  else if (text.split(" ").length <= 3 && LOCATION_WORDS.includes(text)) facts.location = titleCase(text);
  const employmentStatus = explicitEmploymentStatus(text);
  if (employmentStatus) facts.employment_status = employmentStatus;
  const duration = text.match(/\b(\d{1,2})\s*(months?|years?)\b/);
  if (duration && (facts.employment_status === "self-employed" || previousFacts.employment_status === "self-employed" || /trading|business/.test(text) || text === duration[0])) facts.trading_history = `${duration[1]} ${duration[2]}`;
  const vehicle = text.match(/\b(transit customs?|transits?|sprinters?|crafters?|vivaros?|boxers?|relays?|partners?|berlingos?|tippers?|lutons?)\b/);
  if (vehicle) { const singular = vehicle[1].replace(/s$/i, ""); facts.vehicle_type = titleCase(singular); facts.vehicle_interest = titleCase(singular); }
  const budget = monthlyBudgetAmount(text);
  if (budget) { facts.budget = `£${budget}`; facts.budget_monthly_gbp = budget; }
  const quantity = text.match(/\b(two|three|four|five|[2-9])\s+(?:vans?|vehicles?|transit customs?|transits?|sprinters?|crafters?|vivaros?|boxers?|relays?|tippers?|lutons?)\b/);
  if (quantity) facts.quantity_required = Number.isFinite(Number(quantity[1])) ? Number(quantity[1]) : ({ two: 2, three: 3, four: 4, five: 5 })[quantity[1]];
  if (/not vat registered/.test(text)) facts.vat_registered = false;
  else if (/vat registered/.test(text)) facts.vat_registered = true;
  if (/limited company|ltd company|company director|for my company/.test(text)) facts.business_type = "limited company";
  else if (/sole trader/.test(text)) facts.business_type = "sole trader";
  const deposit = text.match(/(?:my (?:deposit|money down|upfront)(?: budget)?(?: is| would be| is around)?|i can (?:put|pay)|i have).{0,24}£\s?([\d,]+)|\bwith\s+£\s?([\d,]+).{0,12}(?:deposit|money down|upfront)|£\s?([\d,]+).{0,12}(?:deposit|money down|upfront)/);
  const depositStatement = !/\?$/.test(clean(message)) && !/^(?:what|how|can|could|do|does|is|are|would|will)\b/.test(text);
  if (deposit && (depositStatement || /\bwith\s+£/.test(text))) { const amount = deposit[1] || deposit[2] || deposit[3]; facts.deposit = `£${amount}`; facts.deposit_budget_gbp = Number(amount.replaceAll(",", "")); }
  if (/deliver|delivery/.test(text)) facts.delivery_interest = true;
  if (/collect|collection/.test(text)) facts.collection_interest = true;
  if (explicitlySuppliedCreditConcern(text) || /\bmy credit\b.{0,30}\bccj\b/i.test(text)) { facts.main_concern = "credit history"; facts.credit_concern = /refused|declined|turned down/.test(text) ? "previous refusal" : "credit history"; }
  else if (/quickly|urgent|how soon|how fast/.test(text)) { facts.main_concern = "speed"; facts.urgency = "high"; }
  else if (/deposit|money down|upfront/.test(text)) facts.main_concern = "upfront cost";
  else if (/cover|coverage|distance|miles|postcode/.test(text) || knownLocation) facts.main_concern = "location coverage";
  const discussed = detectedProduct(text);
  if (discussed === "both") facts.discussed_products = ["finance", "rent2buy"];
  else if (["finance", "rent2buy"].includes(discussed)) facts.discussed_products = [discussed];
  return facts;
}

function contextualFollowUpFacts(message, previousAssistant = "", previousFacts = {}) {
  const text = normaliseCustomerMessage(message);
  const prompt = normaliseCustomerMessage(previousAssistant);
  const facts = {};
  if (!text || !prompt || text.includes("?")) return facts;

  if (/monthly budget|budget.{0,20}(?:month|monthly)|(?:month|monthly).{0,20}budget/.test(prompt)) {
    const bareBudget = text.match(/^(?:about\s+|roughly\s+|around\s+)?£?\s*([1-9]\d{1,3})(?:\s*(?:a|per)\s*month|\s*monthly)?$/);
    if (bareBudget) {
      const amount = Number(bareBudget[1]);
      if (amount >= 50 && amount <= 9999) {
        facts.budget = `£${amount}`;
        facts.budget_monthly_gbp = amount;
      }
    }
  }

  if (/(?:deposit|money down|upfront).{0,30}(?:budget|have|put|pay|prefer)|how much.{0,20}(?:deposit|money down|upfront)/.test(prompt)) {
    const bareDeposit = text.match(/^(?:about\s+|roughly\s+|around\s+)?£?\s*([1-9]\d{1,4})$/);
    if (bareDeposit) {
      const amount = Number(bareDeposit[1]);
      facts.deposit = `£${amount}`;
      facts.deposit_budget_gbp = amount;
    }
  }

  if (/what (?:type|size).{0,20}van|what van.{0,20}(?:type|size)|van are you looking for/.test(prompt)) {
    const directVehicle = text.match(/^(small|medium|large|lwb|mwb|swb|crew(?: van)?|pickup|tipper|luton|low loader|drop ?side|dropside)$/);
    if (directVehicle && !previousFacts.vehicle_interest) {
      const vehicle = titleCase(directVehicle[1].replace(/^crew$/, "crew van").replace(/^dropside$/, "drop side"));
      facts.vehicle_type = vehicle;
      facts.vehicle_interest = vehicle;
    }
  }
  return facts;
}

function normaliseFactMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value && typeof value === "object" && !Array.isArray(value)));
}

function defaultStoredProvenance(field) {
  return ["product_context", "vehicle_interest"].includes(field) ? "system_context" : "legacy_customer_explicit";
}

function factSpecificity(field, value) {
  if (field === "employment_status") return value === "employed" ? 1 : ["self-employed", "limited company"].includes(value) ? 2 : 0;
  if (field === "location") return /\d/.test(clean(value)) ? 2 : 1;
  return 1;
}

function validFactValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean" || typeof value === "number") return true;
  return Boolean(clean(value));
}

function safeLocationValue(value) {
  return !/^(?:me|here|there|home|my (?:area|home|location|place|town|city)|our (?:area|location|place)|where i am)$/i.test(clean(value, 120));
}

function mergeDiscussedProducts(previousValue, nextValue) {
  return [...new Set([...(Array.isArray(previousValue) ? previousValue : []), ...(Array.isArray(nextValue) ? nextValue : [])].filter((item) => ["finance", "rent2buy"].includes(item)))];
}

export function mergeRememberedFacts({ previousFacts = {}, previousMetadata = {}, updates = {}, updateMetadata = {}, correctionFields = [] } = {}) {
  const facts = previousFacts && typeof previousFacts === "object" && !Array.isArray(previousFacts) ? { ...previousFacts } : {};
  const metadata = normaliseFactMetadata(previousMetadata);
  const corrections = [];
  const explicitCorrections = new Set(correctionFields);

  for (const [field, value] of Object.entries(updates && typeof updates === "object" && !Array.isArray(updates) ? updates : {})) {
    if (!validFactValue(value) || (field === "location" && !safeLocationValue(value))) continue;
    if (field === "discussed_products") {
      facts[field] = mergeDiscussedProducts(facts[field], value);
      metadata[field] = updateMetadata[field] || metadata[field] || { provenance: "customer_explicit", confidence: 0.95 };
      continue;
    }

    const nextMetadata = updateMetadata[field] || { provenance: "inferred", confidence: 0.5 };
    const previousValue = facts[field];
    if (!validFactValue(previousValue)) {
      facts[field] = value;
      metadata[field] = nextMetadata;
      continue;
    }
    if (String(previousValue) === String(value)) {
      if ((PROVENANCE_PRIORITY[nextMetadata.provenance] || 0) >= (PROVENANCE_PRIORITY[metadata[field]?.provenance] || 0)) metadata[field] = nextMetadata;
      continue;
    }

    const previousProvenance = metadata[field]?.provenance || defaultStoredProvenance(field);
    const nextProvenance = nextMetadata.provenance || "inferred";
    const strongerSource = (PROVENANCE_PRIORITY[nextProvenance] || 0) > (PROVENANCE_PRIORITY[previousProvenance] || 0);
    const moreSpecific = factSpecificity(field, value) > factSpecificity(field, previousValue);
    const explicitCorrection = explicitCorrections.has(field) && CUSTOMER_FACT_PROVENANCE.has(nextProvenance);
    if (!explicitCorrection && !strongerSource && !moreSpecific) continue;
    if (field === "employment_status" && !explicitCorrection && factSpecificity(field, value) < factSpecificity(field, previousValue)) continue;

    facts[field] = value;
    metadata[field] = nextMetadata;
    corrections.push({ field, previous_value: previousValue, corrected_value: value });
  }
  return { remembered_facts: facts, fact_metadata: metadata, corrections };
}

function metadataForUpdates(updates, message, contextualUpdates, userIndex, messageId = null) {
  const text = normaliseCustomerMessage(message);
  const sourceMessageId = messageId || `user-${userIndex}`;
  return Object.fromEntries(Object.keys(updates).map((field) => {
    let provenance = "customer_explicit";
    if (Object.hasOwn(contextualUpdates, field)) provenance = "customer_contextual";
    else if (field === "location" && !explicitlySuppliedLocation(text) && !CORRECTION_PATTERN.test(text)) provenance = "inferred";
    else if (["vehicle_type", "vehicle_interest"].includes(field) && !/\b(?:i want|i need|i m looking for|im looking for|i am looking for|i m interested in|im interested in|i am interested in|my choice is)\b/.test(text)) provenance = "inferred";
    else if (["delivery_interest", "collection_interest", "main_concern"].includes(field)) provenance = "inferred";
    return [field, { provenance, confidence: provenance === "inferred" ? 0.7 : 0.95, source_message_id: sourceMessageId }];
  }));
}

function correctionFieldsForMessage(message, updates) {
  if (!CORRECTION_PATTERN.test(normaliseCustomerMessage(message))) return [];
  return Object.keys(updates);
}

export function buildConversationMemory(messages = [], suppliedMemory = {}, suppliedFactMetadata = {}) {
  let facts = suppliedMemory && typeof suppliedMemory === "object" && !Array.isArray(suppliedMemory) ? { ...suppliedMemory } : {};
  let factMetadata = normaliseFactMetadata(suppliedFactMetadata);
  for (const field of Object.keys(facts)) {
    if (!factMetadata[field]) factMetadata[field] = { provenance: defaultStoredProvenance(field), confidence: 0.9, source_message_id: null };
  }
  const corrections = [];
  let previousAssistant = "";
  let userIndex = 0;
  for (const item of Array.isArray(messages) ? messages : []) {
    if (item?.role === "assistant") {
      previousAssistant = clean(item.content, 1500);
      continue;
    }
    if (item?.role !== "user") continue;
    userIndex += 1;
    const directUpdates = extractConversationFacts(item.content, facts);
    const contextualUpdates = contextualFollowUpFacts(item.content, previousAssistant, facts);
    const updates = { ...directUpdates, ...contextualUpdates };
    const updateMetadata = metadataForUpdates(updates, item.content, contextualUpdates, userIndex, item.id);
    const merged = mergeRememberedFacts({
      previousFacts: facts,
      previousMetadata: factMetadata,
      updates,
      updateMetadata,
      correctionFields: correctionFieldsForMessage(item.content, updates),
    });
    facts = merged.remembered_facts;
    factMetadata = merged.fact_metadata;
    corrections.push(...merged.corrections.map((correction) => ({ ...correction, message: clean(item.content, 500) })));
    previousAssistant = "";
  }
  return { remembered_facts: facts, fact_metadata: factMetadata, corrections };
}

function trustedCustomerFact(field, facts, factMetadata) {
  if (!validFactValue(facts[field])) return null;
  const provenance = factMetadata[field]?.provenance || defaultStoredProvenance(field);
  return CUSTOMER_FACT_PROVENANCE.has(provenance) ? facts[field] : null;
}

function humanList(items) {
  if (items.length < 2) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function controlledMemoryRecallReply({ message = "", facts = {}, factMetadata = {}, vehicleContext = {} } = {}) {
  const text = normaliseCustomerMessage(message);
  const asksBudget = /\bwhat (?:budget did i tell you|did i (?:say|tell you).{0,20}budget|did you say my budget was|was my budget)\b|\bdo you remember my budget\b/.test(text);
  const asksGeneral = /\bwhat (?:do you remember about (?:me|my circumstances)|did i tell you|have i told you)\b|\bwhat have you remembered\b/.test(text);
  if (!asksBudget && !asksGeneral) return null;

  const budget = trustedCustomerFact("budget_monthly_gbp", facts, factMetadata);
  if (asksBudget) return budget ? `Around £${Number(budget).toLocaleString("en-GB")} a month.` : "You haven’t told me a monthly budget yet.";

  const details = [];
  const employment = trustedCustomerFact("employment_status", facts, factMetadata);
  if (employment === "self-employed") details.push("you’re self-employed");
  else if (employment === "employed") details.push("you’re employed");
  else if (employment === "limited company") details.push("you’re a limited-company director");
  const trading = trustedCustomerFact("trading_history", facts, factMetadata);
  if (trading) details.push(`you’ve been trading for ${trading}`);
  const credit = trustedCustomerFact("credit_concern", facts, factMetadata);
  if (credit === "previous refusal") details.push("you’ve previously been declined or refused credit");
  else if (credit) details.push("your credit isn’t great");
  const location = trustedCustomerFact("location", facts, factMetadata);
  if (location) details.push(`you live in ${location}`);
  if (budget) details.push(`you’d like to keep payments around £${Number(budget).toLocaleString("en-GB")} a month`);
  const deposit = trustedCustomerFact("deposit_budget_gbp", facts, factMetadata);
  if (deposit) details.push(`your preferred deposit is around £${Number(deposit).toLocaleString("en-GB")}`);
  const businessType = trustedCustomerFact("business_type", facts, factMetadata);
  if (businessType && !(employment === "self-employed" && businessType === "sole trader")) details.push(`your business type is ${businessType}`);
  const vatRegistered = trustedCustomerFact("vat_registered", facts, factMetadata);
  if (vatRegistered === true) details.push("you’re VAT registered");
  else if (vatRegistered === false) details.push("you’re not VAT registered");
  const urgency = trustedCustomerFact("urgency", facts, factMetadata);
  if (urgency === "high") details.push("you need the vehicle urgently");

  const vehicle = clean(vehicleContext.title || vehicleContext.registration, 200);
  const remembered = details.length ? `You’ve told me ${humanList(details)}.` : "You haven’t told me much about your circumstances yet.";
  return vehicle ? `${remembered} You’re currently looking at this ${vehicle}.` : remembered;
}

export function controlledAlternativeRecallReply({ message = "", facts = {}, productContext = "finance" } = {}) {
  const text = normaliseCustomerMessage(message);
  if (!/\b(?:what was|remind me (?:of|about)) the other (?:option|route|product)\b|\bthe other (?:option|route|product) you mentioned\b/.test(text)) return null;
  const discussed = Array.isArray(facts.discussed_products) ? facts.discussed_products : [];
  const alternative = discussed.find((product) => product !== productContext);
  if (alternative === "rent2buy") return "The other option we discussed was Rent2Buy.";
  if (alternative === "finance") return "The other option we discussed was Van Finance.";
  return "We haven’t discussed another option in this conversation.";
}

export function naturalConversationReply(intent, productContext, rememberedFacts = {}) {
  const product = productContext === "finance" ? "van finance" : "Rent2Buy";
  const applyAction = productContext === "finance" ? "apply_finance" : "apply_rent2buy";
  const statedBudget = Number(intent?.monthly_amount_intent?.amount || rememberedFacts.budget_monthly_gbp);
  const budgetQualifier = intent?.monthly_amount_intent?.qualifier;
  const budgetAcknowledgement = Number.isFinite(statedBudget)
    ? budgetQualifier === "under"
      ? `Thanks — I’ve noted you want to keep the monthly payments under £${statedBudget.toLocaleString("en-GB")}.`
      : budgetQualifier === "around"
        ? `Thanks — I’ve noted you’d like to keep the monthly payments around £${statedBudget.toLocaleString("en-GB")}.`
        : `Thanks — I’ve noted a monthly budget of £${statedBudget.toLocaleString("en-GB")}.`
    : "Thanks — I’ve noted your monthly budget.";
  const replies = {
    greeting: `Hi. I can help with questions about ${product}. What would you like to know?`,
    general_help_request: productContext === "finance" ? "Of course. I can help with van finance, applications, deposits, documents or available vans. What would you like to know?" : "Of course. I can explain how Rent2Buy works, the application process, documents, collection and eligibility. What would you like to know?",
    thanks: "You’re welcome. Is there anything else you’d like to know?",
    goodbye: "No problem. Thanks for getting in touch.",
    frustration: Object.keys(rememberedFacts).length
      ? `You’re right — I’ll use what you’ve already told me and won’t ask for it again. I can explain the next point more simply or recommend that a member of the team takes over.`
      : "I’m sorry this hasn’t helped. I can explain it more simply or recommend that a member of the team takes over.",
    human_assistance_requested: "Of course. I’ll recommend that a member of the team takes over from here.",
    ready_to_apply: `You can continue with the ${product} application when you’re ready. Acceptance cannot be guaranteed, and the application will still need to be assessed.`,
    customer_fact_statement: budgetAcknowledgement,
  };
  const hasKnownCustomerFact = Object.keys(rememberedFacts).some((key) => key !== "product_context");
  const reply = intent.clarification_required ? intent.suggested_clarification_question : replies[intent.primary_intent] || (hasKnownCustomerFact ? "Thanks — I’ve noted that." : "What would you like help with?");
  return {
    reply,
    insufficient_knowledge: false,
    human_handoff_recommended: ["human_assistance_requested", "frustration"].includes(intent.primary_intent),
    recommended_action: ["human_assistance_requested", "frustration"].includes(intent.primary_intent) ? "human_handoff" : intent.primary_intent === "ready_to_apply" ? applyAction : intent.clarification_required ? "clarify" : "continue",
    confidence: 100,
    confidence_reason: "Handled by the server-side conversation behaviour rules without using business-fact generation.",
  };
}

export function insufficientKnowledgeReply(productContext) {
  return {
    reply: `I don’t have enough verified ${productContext === "finance" ? "van finance" : "Rent2Buy"} information to answer that accurately, and I don’t want to guess. You can ask another question, continue with the application, or leave your details for the team to confirm.`,
    insufficient_knowledge: true,
    human_handoff_recommended: false,
    recommended_action: "none",
    confidence: 20,
    confidence_reason: "No approved evidence or deterministic rule was available for the business question.",
  };
}

export function enforceGroundedConversationReply(reply = {}, { deterministicRuleUsed = false, productContext = "finance" } = {}) {
  if (reply.insufficient_knowledge || deterministicRuleUsed || (Array.isArray(reply.source_ids) && reply.source_ids.length > 0)) return reply;
  return { ...insufficientKnowledgeReply(productContext), source_ids: [] };
}

export function conversationLearningDiagnosis({ intent, coverage, insufficientKnowledge = false } = {}) {
  if (coverage && coverage.diagnostics?.certainty !== "unresolved") return "Deterministic rule handled successfully";
  if (insufficientKnowledge) return "Missing knowledge";
  if (intent?.clarification_required) return "Clarification required";
  if (intent?.normalised_message !== intent?.original_message?.toLowerCase()) return "Normalisation applied successfully";
  if (SIMPLE_INTENTS.has(intent?.primary_intent)) return "Conversational message handled without retrieval";
  return "Approved knowledge retrieval used";
}

export function isSimpleConversationIntent(intent) {
  return SIMPLE_INTENTS.has(intent);
}
