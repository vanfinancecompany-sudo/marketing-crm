import { normaliseCustomerMessage } from "./conversationIntelligence.js";

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
const wordCount = (value) => clean(value).split(/\s+/).filter(Boolean).length;

export const UNIVERSAL_MESSAGE_TYPES = Object.freeze([
  "greeting", "question", "follow_up_question", "clarification", "agreement", "disagreement",
  "confusion", "frustration", "humour", "positive_feedback", "objection", "buying_signal",
  "ready_to_apply", "random_text", "unknown_intent", "off_topic", "nonsense_input",
]);

export const CUSTOMER_EMOTIONS = Object.freeze([
  "neutral", "confused", "frustrated", "interested", "excited", "ready", "uncertain",
  "price_concern", "credit_concern", "urgency", "trust_concern",
]);

const CONFUSION = /^(?:what|eh|sorry|explain|huh|pardon|what do you mean|i don(?:\s*)?t get it|dont get it|i do not understand|confused|not following|\?+)$/i;
const AGREEMENT = /^(?:yes(?: please)?|yep(?: please)?|yeah(?: please)?|sure(?: please)?|of course|correct|exactly|right|ok(?:ay)?(?: please)?|fine|sounds good|that\s*s right|thats right|please do)$/i;
const DISAGREEMENT = /^(?:no|nope|not really|incorrect|that\s*s wrong|thats wrong|don\s*t agree|dont agree)$/i;
const UNCERTAIN = /^(?:maybe|possibly|not sure|unsure|don\s*t know|dont know|i don\s*t know|whatever|perhaps)$/i;
const THANKS = /^(?:thanks|thank you|cheers|nice one|brilliant|great|perfect|helpful|that helps)[!. ]*$/i;
const HUMOUR = /\b(?:ha+|haha+|lol|rofl|only joking|just kidding|you\s*re funny|thats funny)\b/i;
const FRUSTRATION = /doesn\s*t help|not answering|already told you|stop asking|useless|waste of time|forget it|fed up|annoyed|frustrat|lost confidence|can\s*t trust|dont trust|don\s*t trust/i;
const READY = /ready to apply|let\s*s apply|apply now|can i apply|start (?:the |an )?application|what\s*s next|let\s*s do it|go ahead|send me the application|i want this van|proceed|begin/i;
const BUSINESS = /van|vehicle|finance|rent2buy|rent 2 buy|application|apply|deposit|monthly|budget|credit|declined|rejected|self employed|limited company|documents?|delivery|deliver|collect|postcode|trading|licen[cs]e|ownership|quote|lender|afford/i;
const OFF_TOPIC = /what\s*s my name|what is my name|weather|football|recipe|capital of|tell me a joke|who are you|politics|news today|meaning of life/i;
const PAUSE = /^(?:one sec|hold on|give me a minute|back in a minute|wait a moment)$/i;
const RETURNING = /^(?:back now|i\s*m back|im back|carry on|continue)$/i;
const QUESTION_WORD = /\b(?:what|when|where|why|who|how|can|could|do|does|did|is|are|will|would|should)\b/i;
const CONTINUATION_OFFER = /\b(?:if you(?: would|\s*d)? like|would you like|shall i|i can|can help|want me to|happy to)\b/i;
const EXPLANATION_OFFER = /\b(?:explain|show|talk(?: you)? through|walk(?: you)? through|go through|tell you|outline|break down|help you understand)\b/i;
const FACTUAL_CONTEXT = /\b(?:how|why|what|details?|information|process|works?|difference|requirements?|documents?|bank|account|finance|rent2buy|application|deposit|monthly|payment|credit|delivery|insurance|tax|vat|eligib|lender)\b/i;

function hasLettersOrNumbers(value) { return /[a-z0-9]/i.test(value); }
function nonsenseScore(original, normalised) {
  if (!original || /^\?+$/.test(original)) return /^\?+$/.test(original) ? 0 : 1;
  if (!hasLettersOrNumbers(original)) return 1;
  if (/^(?:asdf|qwerty|zxcv|hjkl)[a-z0-9]*$/i.test(normalised.replace(/\s/g, ""))) return 0.98;
  if (/(.)\1{5,}/.test(normalised.replace(/\s/g, ""))) return 0.95;
  if (/^[bcdfghjklmnpqrstvwxyz]{6,}$/i.test(normalised.replace(/\s/g, ""))) return 0.9;
  return 0;
}

function contextualOfferAnchor(priorAssistant) {
  const raw = clean(priorAssistant, 1500);
  const prior = normaliseCustomerMessage(raw);
  const offeredExplanation = CONTINUATION_OFFER.test(prior) && EXPLANATION_OFFER.test(prior);
  return {
    offeredExplanation,
    anchor: offeredExplanation ? raw : "",
    requiresKnowledge: offeredExplanation && FACTUAL_CONTEXT.test(prior),
  };
}

export function detectCustomerEmotion(message, context = {}) {
  const text = normaliseCustomerMessage(message);
  if (FRUSTRATION.test(text)) return { emotion: /trust|confidence/.test(text) ? "trust_concern" : "frustrated", confidence: 96, reason: "The customer expresses dissatisfaction or loss of trust." };
  if (CONFUSION.test(text)) return { emotion: "confused", confidence: 98, reason: "The customer indicates that the previous point was not understood." };
  if (/too expensive|cost too much|can\s*t afford|price|monthly|budget|deposit/.test(text)) return { emotion: "price_concern", confidence: 90, reason: "The customer is concerned about price or upfront cost." };
  if (/bad credit|poor credit|rejected|declined|turned down/.test(text)) return { emotion: "credit_concern", confidence: 94, reason: "The customer raises a credit-history concern." };
  if (/urgent|quickly|asap|tomorrow|straight away/.test(text)) return { emotion: "urgency", confidence: 94, reason: "The customer needs a vehicle quickly." };
  if (READY.test(text)) return { emotion: "ready", confidence: 96, reason: "The customer expresses readiness to progress." };
  if (/excited|can\s*t wait|great news|brilliant/.test(text)) return { emotion: "excited", confidence: 86, reason: "The customer uses positive high-energy wording." };
  if (UNCERTAIN.test(text) || /not convinced|need to think|maybe later/.test(text)) return { emotion: "uncertain", confidence: 92, reason: "The customer is hesitant or uncertain." };
  if (/interested|like this|seen a|want a|need a/.test(text) || context.buying_intent_level === "Interested") return { emotion: "interested", confidence: 84, reason: "The customer expresses interest in a vehicle or route." };
  return { emotion: "neutral", confidence: 75, reason: "No strong customer emotion was detected." };
}

export function detectObjection(message) {
  const text = normaliseCustomerMessage(message);
  const tokens = new Set(text.replace(/\./g, " ").split(/\s+/).filter(Boolean).map((word) => word.replace(/(?:ing|ed|ly|s)$/i, "")));
  const concepts = {
    price: ["expensive", "cost", "afford", "price", "payment", "repayment", "high", "manage", "stretch"],
    deposit: ["deposit", "upfront", "down", "initial", "cash", "advance"],
    credit: ["credit", "reject", "refus", "declin", "turned", "ccj", "score", "history"],
    urgency: ["urgent", "quick", "tomorrow", "soon", "wait", "immediate", "broke"],
    accounts: ["account", "statement", "book", "record", "paperwork"],
    business_status: ["limited", "company", "self", "employ", "trading", "startup", "business", "sole"],
    uncertainty: ["unsure", "maybe", "think", "convince", "doubt", "hesitant", "risk"],
    trust: ["trust", "confidence", "genuine", "legitimate", "believe", "scam", "honest", "worri", "concern"],
  };
  const ranked = Object.entries(concepts).map(([objection, terms]) => ({ objection, score: terms.filter((term) => [...tokens].some((token) => token === term || token.startsWith(term))).length })).sort((a, b) => b.score - a.score);
  const patterns = [
    ["price", /too expensive|costs? too much|can\s*t afford|monthly too high/],
    ["deposit", /no deposit|need no deposit|deposit (?:is )?(?:too much|problem|concern)|can\s*t afford.{0,20}deposit/],
    ["credit", /bad credit|poor credit|rejected elsewhere|declined|turned down/],
    ["urgency", /need (?:a )?(?:van|vehicle).{0,20}(?:quickly|tomorrow|urgent)|can\s*t wait/],
    ["accounts", /no accounts|don\s*t have accounts|without accounts/],
    ["business_status", /limited company|self employed|new business|only trading/],
    ["uncertainty", /not sure|unsure|need to think|not convinced/],
    ["trust", /lost confidence|don\s*t trust|dont trust|sounds too good|is this genuine/],
  ];
  const matched = patterns.find(([, pattern]) => pattern.test(text));
  const semantic = ranked[0]?.score >= 2 ? ranked[0].objection : null;
  const objection = semantic || matched?.[0] || null;
  return objection ? { objection, detected: true, confidence: semantic ? Math.min(98, 80 + ranked[0].score * 4) : 92, reason: `The overall wording expresses a ${objection.replaceAll("_", " ")} concern.` } : { objection: "none", detected: false, confidence: 75, reason: "No clear objection was detected." };
}

export function classifyUniversalMessage({ message, messages = [], journey = {} } = {}) {
  const original = clean(message, 3000);
  const text = normaliseCustomerMessage(original);
  const priorUser = messages.filter((item) => item?.role === "user").at(-1)?.content || "";
  const priorAssistant = messages.filter((item) => item?.role === "assistant").at(-1)?.content || "";
  const context = contextualOfferAnchor(priorAssistant);
  const emotion = detectCustomerEmotion(original, journey);
  const objection = detectObjection(original);
  const nonsense = nonsenseScore(original, text);
  let messageType = "unknown_intent";
  let confidence = 55;
  let reason = "The message does not contain enough recognisable context for a reliable interpretation.";
  let recoveryRequired = true;
  let contextualAnchor = "";
  let contextualRequiresKnowledge = false;

  if (/^(?:hi|hello|hey|hiya|morning|afternoon|evening|anyone there)[!. ]*$/i.test(text)) { messageType = "greeting"; confidence = 99; reason = "Greeting only."; recoveryRequired = false; }
  else if (CONFUSION.test(text) || /^\?+$/.test(original)) { messageType = "confusion"; confidence = 99; reason = "The customer asks for the prior point to be explained."; }
  else if (FRUSTRATION.test(text)) { messageType = "frustration"; confidence = 97; reason = "The customer expresses frustration or lost confidence."; }
  else if (HUMOUR.test(text)) { messageType = "humour"; confidence = 96; reason = "Light humour or joking response."; recoveryRequired = false; }
  else if (THANKS.test(text)) { messageType = "positive_feedback"; confidence = 98; reason = "Positive acknowledgement or thanks."; recoveryRequired = false; }
  else if (READY.test(text)) { messageType = "ready_to_apply"; confidence = 97; reason = "Explicit application progression wording."; recoveryRequired = false; }
  else if (AGREEMENT.test(text)) {
    messageType = "agreement";
    confidence = context.offeredExplanation ? 98 : 95;
    reason = context.offeredExplanation
      ? "The customer is accepting the assistant's immediately preceding offer, so that offer supplies the meaning of the turn."
      : "Short agreement whose meaning depends on recent context.";
    recoveryRequired = false;
    if (context.offeredExplanation) {
      contextualAnchor = context.anchor;
      contextualRequiresKnowledge = context.requiresKnowledge;
    }
  }
  else if (RETURNING.test(text)) { messageType = "agreement"; confidence = 96; reason = "The customer has returned and wants to continue the existing conversation."; recoveryRequired = false; }
  else if (PAUSE.test(text)) { messageType = "clarification"; confidence = 97; reason = "The customer is briefly pausing the conversation."; }
  else if (DISAGREEMENT.test(text)) { messageType = "disagreement"; confidence = 95; reason = "Short disagreement whose subject comes from recent context."; }
  else if (UNCERTAIN.test(text)) { messageType = "clarification"; confidence = 91; reason = "The customer is uncertain and needs a calm contextual response."; }
  else if (OFF_TOPIC.test(text)) { messageType = "off_topic"; confidence = 98; reason = "The message asks about something outside the assistant's approved business scope."; }
  else if (nonsense >= 0.85) { messageType = "nonsense_input"; confidence = 99; reason = "The input is not interpretable natural language."; }
  else if (objection.detected) { messageType = "objection"; confidence = objection.confidence; reason = objection.reason; recoveryRequired = false; }
  else if (BUSINESS.test(text) && (original.includes("?") || QUESTION_WORD.test(text))) { messageType = messages.length ? "follow_up_question" : "question"; confidence = 94; reason = "Recognisable business question."; recoveryRequired = false; }
  else if (BUSINESS.test(text)) { messageType = /need|want|seen|quote|urgent/.test(text) ? "buying_signal" : "clarification"; confidence = 86; reason = "Recognisable business context without a fully formed question."; recoveryRequired = false; }
  else if (original.includes("?") || QUESTION_WORD.test(text)) {
    const contextual = messages.length > 0;
    messageType = contextual ? "follow_up_question" : "question";
    confidence = contextual ? 84 : 72;
    reason = contextual
      ? "A readable question follows an active conversation, so recent context should be used before asking the customer to rephrase it."
      : "A question is present, but it is not clearly within approved business knowledge.";
    recoveryRequired = !contextual;
  }
  else if (wordCount(text) >= 4) { messageType = "random_text"; confidence = 70; reason = "Readable text with no reliable business intent."; }

  return {
    original_message: original,
    normalised_message: text,
    message_type: messageType,
    confidence,
    reason,
    recovery_required: recoveryRequired || confidence < 65,
    low_confidence: confidence < 65,
    previous_user_message: clean(priorUser, 500),
    previous_assistant_message: clean(priorAssistant, 1000),
    contextual_anchor: contextualAnchor,
    contextual_requires_knowledge: contextualRequiresKnowledge,
    emotion,
    objection,
  };
}

function recentSubject(messages = []) {
  const recent = normaliseCustomerMessage(messages.slice(-6).map((item) => item.content).join(" "));
  if (/deliver|delivery/.test(recent)) return "delivery";
  if (/apply|application|approval/.test(recent)) return "the application process";
  if (/deposit|upfront|money down/.test(recent)) return "the deposit";
  if (/monthly|budget|payment|cost/.test(recent)) return "the monthly cost";
  if (/self employed|trading|business/.test(recent)) return "your trading history";
  if (/credit|declined|rejected/.test(recent)) return "the credit question";
  if (/documents?|paperwork|bank statement/.test(recent)) return "the documents";
  return "that point";
}

export function contextualRecoveryQuestion(message, messages = [], facts = {}, productContext = "finance") {
  const text = normaliseCustomerMessage(message);
  const product = productContext === "finance" ? "finance enquiry" : "Rent2Buy enquiry";
  if (/^(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:days?|weeks?|months?|years?)$/.test(text)) {
    if (facts.employment_status === "self-employed" || /trad|self employed|business/.test(normaliseCustomerMessage(messages.slice(-6).map((item) => item.content).join(" ")))) return `When you said “${clean(message, 80)}”, were you referring to how long you’ve been trading?`;
    if (/deliver|delivery/.test(normaliseCustomerMessage(messages.slice(-6).map((item) => item.content).join(" ")))) return `When you said “${clean(message, 80)}”, were you referring to the delivery time?`;
    return "Were you referring to trading history, the application time or delivery?";
  }
  if (/what\s*s my name|what is my name/.test(text)) return `I don’t actually know your name yet. When you’re ready, we can carry on with your ${product}.`;
  if (/^(?:what|eh|sorry|explain|huh|pardon|\?+)$/.test(text)) return `No problem. Which part of ${recentSubject(messages)} should I explain more simply?`;
  if (/i don\s*t get it|dont get it|confused|not following|do not understand/.test(text)) return `No problem — I can explain ${recentSubject(messages)} more simply. Which part is unclear?`;
  return "I’m not quite sure what you mean. Could you explain that another way?";
}

export function humanRecoveryReply(classification, { messages = [], facts = {}, productContext = "finance", journey = {} } = {}) {
  const type = classification.message_type;
  const product = productContext === "finance" ? "finance" : "Rent2Buy";
  const normalised = classification.normalised_message;
  const subject = recentSubject(messages);
  const previousAssistant = normaliseCustomerMessage(classification.previous_assistant_message || messages.filter((item) => item?.role === "assistant").at(-1)?.content);
  let disagreementReply = `Understood. Which part of ${subject} isn’t right?`;
  if (/budget|monthly/.test(previousAssistant)) disagreementReply = facts.vehicle_interest ? "That’s okay. We can look at the vehicle first and discuss a suitable budget afterwards." : "That’s okay. What type of van are you looking for?";
  else if (/seen|found|chosen|vehicle|van/.test(previousAssistant)) disagreementReply = "That’s fine. What size or type of van do you need?";
  else if (/ready|apply|application|proceed/.test(previousAssistant)) disagreementReply = "No problem. We can keep this as an information conversation until you’re ready.";
  const replies = {
    confusion: contextualRecoveryQuestion(classification.original_message, messages, facts, productContext),
    unknown_intent: "I’m not quite sure what you mean. Could you explain that another way?",
    random_text: `I’m not sure how that relates to your ${product} enquiry. When you’re ready, we can carry on from where we left off.`,
    nonsense_input: "Sorry, I didn’t understand that. Could you try saying it another way?",
    off_topic: contextualRecoveryQuestion(classification.original_message, messages, facts, productContext),
    disagreement: disagreementReply,
    clarification: journey.next_best_question || `That’s okay. What are you unsure about with ${subject}?`,
    frustration: Object.keys(facts).length ? "You’re right — I’ll use what you’ve already told me and keep this simple. I can explain the last point differently or recommend the team takes over." : "I understand. I can explain the last point more simply or recommend the team takes over.",
    humour: "Fair enough. When you’re ready, we can carry on.",
    positive_feedback: journey.application_mode_active ? "You’re welcome. If you need help during the application, just ask." : "You’re welcome.",
    agreement: journey.next_best_question ? `Okay. ${journey.next_best_question}` : "Okay — we can carry on when you’re ready.",
  };
  if (PAUSE.test(normalised)) replies.clarification = "No problem — take your time.";
  if (RETURNING.test(normalised)) replies.agreement = journey.next_best_question ? `Welcome back. ${journey.next_best_question}` : "Welcome back. We can carry on from where we left off.";
  return {
    reply: replies[type] || "I want to make sure I answer correctly. Could you explain that another way?",
    insufficient_knowledge: false,
    human_handoff_recommended: type === "frustration",
    recommended_action: type === "frustration" ? "human_handoff" : "clarify",
    confidence: 100,
    confidence_reason: "Handled by the server-side V5 human conversation and recovery rules.",
    source_ids: [],
  };
}

export function recentAssistantPhraseDiagnostics(messages = [], proposedReply = "") {
  const stop = new Set("the a an and or but to of in on for with is are it this that i you we your our if when can could would should".split(" "));
  const fingerprint = (value) => [...new Set(normaliseCustomerMessage(value).replace(/\./g, " ").split(" ").filter((word) => word.length > 3 && !stop.has(word)))].slice(0, 8);
  const proposed = fingerprint(proposedReply);
  const recent = messages.filter((item) => item?.role === "assistant").slice(-4).map((item) => ({ text: clean(item.content, 500), terms: fingerprint(item.content) }));
  const overlaps = recent.map((item) => ({ phrase: item.text, overlap: proposed.length ? proposed.filter((word) => item.terms.includes(word)).length / proposed.length : 0 })).filter((item) => item.overlap >= 0.7);
  return { repeated_phrase_detected: overlaps.length > 0, recent_phrase_matches: overlaps, recently_used_terms: [...new Set(recent.flatMap((item) => item.terms))].slice(0, 20) };
}
