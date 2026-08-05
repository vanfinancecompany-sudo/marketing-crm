import { extractUkLocation } from "./productCoverageRules.js";

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
const SIMPLE_INTENTS = new Set(["greeting", "general_help_request", "thanks", "goodbye"]);
export const CONVERSATION_INTENTS = Object.freeze([
  "greeting", "general_help_request", "thanks", "goodbye", "confusion", "frustration",
  "ready_to_apply", "human_assistance_requested", "product_clarification_required",
  "incomplete_business_question", "knowledge_question", "multi_part_question", "topic_change", "customer_correction",
]);
export const CONVERSATION_REVIEW_OUTCOMES = Object.freeze([
  "pass", "needs_adjustment", "incorrect", "unsafe", "robotic", "lost_context",
  "asked_unnecessary_clarification", "failed_to_clarify", "wrong_product", "hallucinated_fact",
]);
export const CONVERSATION_RATING_FIELDS = Object.freeze([
  "intent_understood", "conversation_naturalness", "context_memory", "clarification_quality", "accuracy",
  "product_separation", "helpfulness", "brevity", "conversion_value", "safety",
]);

const LOCATION_WORDS = ["manchester", "portsmouth", "southampton", "london", "leeds", "birmingham", "bristol", "cardiff", "glasgow", "edinburgh", "liverpool", "newcastle", "nottingham", "sheffield", "plymouth", "bournemouth", "reading", "oxford", "cambridge", "brighton", "leicester", "coventry", "derby", "york"];
const LOCATION_PATTERN = new RegExp(`\\b(${LOCATION_WORDS.join("|")})\\b`, "i");
const PRODUCT_PATTERNS = { rent2buy: /rent\s*(?:2|to)\s*(?:buy|biy)|monthly rental/i, finance: /\bfin(?:ance|ace|nace)\b|hire purchase|lender|apr/i };

export function normaliseCustomerMessage(message) {
  return clean(message).toLowerCase()
    .replace(/\brent\s*(?:2|to)\s*(?:biy|buy)\b/g, "rent2buy")
    .replace(/\bfinace\b|\bfinanse\b|\bfinanc\b/g, "finance")
    .replace(/\bself[\s-]*emp\b/g, "self employed")
    .replace(/\bcan\s+u\b/g, "can you")
    .replace(/\bpls\b|\bplz\b/g, "please")
    .replace(/\basap\b/g, "quickly")
    .replace(/\bhow much down\b/g, "how much deposit")
    .replace(/\bown it end\b/g, "own it at the end")
    .replace(/\beu licen[cs]e ok\b/g, "is an eu licence accepted")
    .replace(/\bbeen declined\b/g, "I have been declined")
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
  add("vehicle", /transit|custom|sprinter|crafter|van|vehicle/);
  add("application", /apply|application|start|next step|ready|want this/);
  add("delivery_collection", /deliver|delivery|collect|collection/);
  return [...new Set(found)];
}

export function classifyConversationIntent({ message, history = [], productContext = "finance" } = {}) {
  if (!['finance', 'rent2buy'].includes(productContext)) throw new Error("Conversation product context must be finance or rent2buy.");
  const original = clean(message);
  const normalised = normaliseCustomerMessage(original);
  const product = detectedProduct(normalised);
  const subIntents = businessSubIntents(normalised);
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
  } else if (/fed up|annoyed|frustrat|useless|not helping|this hasn'?t helped/.test(normalised)) {
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
  } else if (/^(i\s*m ready|start application|apply now|what\s*s next|i want this van)[!. ]*$/.test(normalised) || /how do i apply/.test(normalised)) {
    primaryIntent = "ready_to_apply"; retrievalNeeded = false; reason = "The visitor has expressed clear application intent.";
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
  };
}

function titleCase(value) { return clean(value).replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export function extractConversationFacts(message, previousFacts = {}) {
  const text = normaliseCustomerMessage(message);
  const facts = {};
  const postcodeLocation = extractUkLocation(message);
  const knownLocation = text.match(LOCATION_PATTERN)?.[1];
  if (postcodeLocation?.type === "full_postcode") facts.location = postcodeLocation.query;
  else if (postcodeLocation?.type === "town_or_city") facts.location = titleCase(postcodeLocation.query);
  else if (knownLocation) facts.location = titleCase(knownLocation);
  else if (text.split(" ").length <= 3 && LOCATION_WORDS.includes(text)) facts.location = titleCase(text);
  if (/self employed|sole trader/.test(text)) facts.employment_status = "self-employed";
  else if (/limited company|ltd company|company director/.test(text)) facts.employment_status = "limited company";
  else if (/\bemployed\b/.test(text) && !/self employed/.test(text)) facts.employment_status = "employed";
  const duration = text.match(/\b(\d{1,2})\s*(months?|years?)\b/);
  if (duration && (facts.employment_status === "self-employed" || previousFacts.employment_status === "self-employed" || /trading|business/.test(text) || text === duration[0])) facts.trading_history = `${duration[1]} ${duration[2]}`;
  const vehicle = text.match(/\b(transit custom|transit|sprinter|crafter|vivaro|boxer|relay|partner|berlingo|tipper|luton)\b/);
  if (vehicle) facts.vehicle_type = titleCase(vehicle[1]);
  const budget = text.match(/£\s?([\d,]+)(?:\s*(?:a|per)\s*month|\s*monthly)?/);
  if (budget) facts.budget = `£${budget[1]}`;
  if (/poor credit|bad credit|credit problems?|ccj|declined/.test(text)) facts.main_concern = "credit history";
  else if (/quickly|urgent|how soon|how fast/.test(text)) facts.main_concern = "speed";
  else if (/deposit|money down|upfront/.test(text)) facts.main_concern = "upfront cost";
  else if (/cover|coverage|distance|miles|postcode/.test(text) || knownLocation) facts.main_concern = "location coverage";
  return facts;
}

export function buildConversationMemory(messages = [], suppliedMemory = {}) {
  let facts = {};
  const corrections = [];
  for (const item of messages.filter((message) => message?.role === "user")) {
    const updates = extractConversationFacts(item.content, facts);
    for (const [field, value] of Object.entries(updates)) {
      if (facts[field] && facts[field] !== value) corrections.push({ field, previous_value: facts[field], corrected_value: value, message: clean(item.content, 500) });
      facts[field] = value;
    }
  }
  const supplied = suppliedMemory && typeof suppliedMemory === "object" && !Array.isArray(suppliedMemory) ? suppliedMemory : {};
  return { remembered_facts: { ...supplied, ...facts }, corrections };
}

export function naturalConversationReply(intent, productContext) {
  const product = productContext === "finance" ? "van finance" : "Rent2Buy";
  const applyAction = productContext === "finance" ? "apply_finance" : "apply_rent2buy";
  const replies = {
    greeting: `Hi. I can help with questions about ${product}. What would you like to know?`,
    general_help_request: productContext === "finance" ? "Of course. I can help with van finance, applications, deposits, documents or available vans. What would you like to know?" : "Of course. I can explain how Rent2Buy works, the application process, documents, collection and eligibility. What would you like to know?",
    thanks: "You’re welcome. Is there anything else you’d like to know?",
    goodbye: "No problem. Thanks for getting in touch.",
    frustration: "I’m sorry this hasn’t helped. I can recommend that a member of the team takes over.",
    human_assistance_requested: "Of course. I’ll recommend that a member of the team takes over from here.",
    ready_to_apply: `You can continue with the ${product} application when you’re ready. Acceptance cannot be guaranteed, and the application will still need to be assessed.`,
  };
  const reply = intent.clarification_required ? intent.suggested_clarification_question : replies[intent.primary_intent] || "What would you like help with?";
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
