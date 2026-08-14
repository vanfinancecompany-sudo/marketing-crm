import { buildApplicationCta } from "./applicationJourneyEngine.js";
import { normaliseCustomerMessage } from "./conversationIntelligence.js";

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
const words = (value) => normaliseCustomerMessage(value).split(/\s+/).filter((word) => word.length > 2);
const STOP_WORDS = new Set("the and that this with from your you our are was were have has had can could would should when what where which into about for but not just then than".split(" "));
const DECIMAL_POINT_TOKEN = "\uE000";
const UNSUPPORTED_ACTION_OFFER = /\b(?:i can|i['’]?ll|i will|let me|we can)\s+(?:check|search|look up|calculate|work out|prepare|request|arrange|book|reserve|contact|call|email|message|submit|send|place|hold)\b/i;

export const CONVERSATION_POLISH_REVIEW_FIELDS = Object.freeze([
  "sales_flow_quality",
  "transition_quality",
  "knowledge_integration",
  "conversation_smoothness",
  "cta_timing",
  "conversation_confidence",
  "redundancy_score",
  "human_feel_rating",
]);

const FACT_PATTERNS = Object.freeze({
  self_employed: /\bself[ -]?employed|sole trader\b/i,
  budget: /£\s?[\d,]+|\b(?:monthly )?budget\b/i,
  location: /\b(?:postcode|based in|live in|manchester|portsmouth|southampton|birmingham|glasgow|cardiff|edinburgh|london)\b/i,
  trading_history: /\b(?:trading|in business).{0,24}(?:days?|weeks?|months?|years?)|\b\d+\s*(?:days?|weeks?|months?|years?)\b/i,
  insurance: /\b(?:insurance|insured|insure|fully comprehensive)\b/i,
  taxation: /\b(?:tax|road tax|vehicle tax|taxed|taxation)\b/i,
  documents: /\b(?:documents?|paperwork|bank statements?|driving licen[cs]e|proof of)\b/i,
  delivery: /\b(?:deliver|delivery)\b/i,
  collection: /\b(?:collect|collection)\b/i,
  warranty: /\b(?:warranty|warranties)\b/i,
  mileage: /\b(?:mileage|miles per year|miles per month)\b/i,
  application_instructions: /\b(?:start|continue|submit|complete).{0,24}\bapplication\b|\bapplication (?:below|form|process)\b/i,
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function communicatedFactKeys(value) {
  const text = clean(value);
  return Object.entries(FACT_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
}

function tokenSet(value) {
  return new Set(words(value).filter((word) => !STOP_WORDS.has(word)));
}

function similarity(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function sentences(value) {
  const protectedValue = clean(value).replace(/(\d)\.(\d)/g, `$1${DECIMAL_POINT_TOKEN}$2`);
  return protectedValue.match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((item) => item.replaceAll(DECIMAL_POINT_TOKEN, ".").trim())
    .filter(Boolean) || [];
}

function sentenceKey(value) {
  return normaliseCustomerMessage(value).replace(/\s+/g, " ");
}

function removeInternalDuplicateSentences(value) {
  const seen = new Set();
  return sentences(value).filter((sentence) => {
    const key = sentenceKey(sentence);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" ");
}

function removeArticleLeadIn(value) {
  return clean(value).replace(/^(?:according to|as explained in)\s+(?:the\s+)?(?:approved\s+)?(?:knowledge hub|business brain|article|source)(?:\s+article)?\s*[:,–—-]?\s*/i, "");
}

function conciseClarification(value, clarificationRequired) {
  if (!clarificationRequired) return value;
  const awkward = /what would you like to know about .+ and [“'\"].+[”'\"]\??/i;
  if (awkward.test(value)) return "Could you tell me a little more about what you mean?";
  const parts = sentences(value);
  if (parts.filter((item) => item.includes("?")).length <= 1) return value;
  const firstQuestion = parts.find((item) => item.includes("?"));
  return firstQuestion || value;
}

function removeTrailingQuestions(value) {
  const parts = sentences(value);
  if (parts.length <= 1) return value;
  while (parts.length > 1 && /\?\s*$/.test(parts.at(-1))) parts.pop();
  return parts.join(" ").trim() || value;
}

function removeUnsupportedActionOffers(value) {
  const parts = sentences(value);
  if (parts.length <= 1) return UNSUPPORTED_ACTION_OFFER.test(value) ? "" : value;
  return parts.filter((sentence) => !UNSUPPORTED_ACTION_OFFER.test(sentence)).join(" ").trim();
}

function selectedFollowUpQuestion({ intent = {}, journey = {}, orchestration = {}, insufficientKnowledge = false } = {}) {
  if (insufficientKnowledge || journey.application_mode_active || orchestration.recovery_required || orchestration.product_boundary_blocked) return "";
  if (intent.primary_intent === "product_clarification_required") return "";
  if (intent.clarification_required) return clean(intent.suggested_clarification_question, 500);
  return clean(journey.next_best_question, 500);
}

export function enforceAnswerableFollowUp(value, { intent = {}, journey = {}, orchestration = {}, insufficientKnowledge = false } = {}) {
  if (orchestration.recovery_required || intent.primary_intent === "product_clarification_required") {
    return { reply: value, supported_question: "", guard_applied: false, unsupported_offer_removed: false };
  }

  const withoutUnsupportedOffer = removeUnsupportedActionOffers(value);
  const unsupportedOfferRemoved = withoutUnsupportedOffer !== value;
  const supportedQuestion = selectedFollowUpQuestion({ intent, journey, orchestration, insufficientKnowledge });
  const withoutClosingQuestions = removeTrailingQuestions(withoutUnsupportedOffer).trim();

  if (!supportedQuestion) {
    return {
      reply: withoutClosingQuestions || withoutUnsupportedOffer || value,
      supported_question: "",
      guard_applied: withoutClosingQuestions !== value || unsupportedOfferRemoved,
      unsupported_offer_removed: unsupportedOfferRemoved,
    };
  }

  const supportedKey = sentenceKey(supportedQuestion);
  const existingParts = sentences(withoutUnsupportedOffer);
  const existingSupported = existingParts.some((sentence) => /\?\s*$/.test(sentence) && sentenceKey(sentence) === supportedKey);
  const base = removeTrailingQuestions(withoutUnsupportedOffer).trim();
  const reply = existingSupported && /\?\s*$/.test(withoutUnsupportedOffer)
    ? withoutUnsupportedOffer
    : [base, supportedQuestion].filter(Boolean).join(" ").trim();

  return {
    reply: reply || supportedQuestion,
    supported_question: supportedQuestion,
    guard_applied: reply !== value || unsupportedOfferRemoved,
    unsupported_offer_removed: unsupportedOfferRemoved,
  };
}

function stableIndex(value, length) {
  let hash = 0;
  for (const character of clean(value)) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return length ? hash % length : 0;
}

function transitionFor({ question, messages, productContext, insufficientKnowledge = false, proactiveCta = false }) {
  const product = productContext === "rent2buy" ? "Rent2Buy" : "Finance";
  const candidates = insufficientKnowledge
    ? [
      `The team can confirm that point, and your ${product} application remains ready below if you want to continue.`,
      `That point needs confirming, but you can still continue with your ${product} application below whenever you’re ready.`,
      `We’ll need the team to confirm that detail. Your ${product} application is still available below when you’re ready.`,
    ]
    : proactiveCta
      ? [
        `Based on what you’ve told me, you can start your ${product} application below whenever you’re ready.`,
        `You’ve already covered the main details, so your ${product} application is ready to start below when it suits you.`,
        `That gives us the main information we need at this stage. You can start your ${product} application below whenever you’re ready.`,
      ]
      : [
        `With that covered, you can continue with your ${product} application below whenever you’re ready.`,
        `That answers that point. Your ${product} application is ready to continue below when you are.`,
        `That’s covered. You can carry on with your ${product} application below whenever you’re ready.`,
      ];
  const recentAssistant = messages.filter((item) => item?.role === "assistant").slice(-4).map((item) => clean(item.content).toLowerCase());
  const available = candidates.filter((candidate) => !recentAssistant.some((reply) => similarity(reply, candidate) >= 0.65));
  const pool = available.length ? available : candidates;
  return pool[stableIndex(`${question}:${messages.length}:${productContext}`, pool.length)];
}

const V6_RESUME = /(?:\s*\n+\s*)?When you’re ready, you can continue with your (?:Finance|Rent2Buy) application below\.?\s*$/i;

export function assessCtaTiming({ journey = {}, facts = {}, productContext = "finance", insufficientKnowledge = false, conflictDetected = false } = {}) {
  if (journey.application_cta) return { cta: journey.application_cta, generated_early: false, eligible: true, reason: "The existing Application Mode CTA remains authoritative." };
  const fields = journey.lead_completeness?.fields || {};
  const required = ["vehicle", "budget", "employment", "product", ...(productContext === "rent2buy" ? ["location"] : [])];
  const missing = required.filter((key) => !fields[key]?.known);
  const enoughKnown = Number(journey.lead_completeness?.known_count || 0) >= 5;
  const eligible = journey.buying_intent_level === "High Intent"
    && journey.application_readiness === "Potentially ready to apply"
    && enoughKnown
    && !missing.length
    && !insufficientKnowledge
    && !conflictDetected;
  return {
    cta: eligible ? buildApplicationCta(productContext) : null,
    generated_early: eligible,
    eligible,
    missing_required_facts: missing,
    reason: eligible
      ? "High buying intent, high application readiness and sufficient known lead facts support a non-binding application CTA."
      : `CTA held back${missing.length ? `; missing ${missing.join(", ")}` : " until intent and readiness are both high"}.`,
  };
}

export function conversationPolishDiagnostics({ reply, question, messages = [], transitionApplied = false } = {}) {
  const currentFacts = communicatedFactKeys(reply);
  const requestedFacts = new Set(communicatedFactKeys(question));
  const recentFacts = unique(messages.filter((item) => item?.role === "assistant").slice(-6).flatMap((item) => communicatedFactKeys(item.content)));
  const repeatedFacts = currentFacts.filter((fact) => recentFacts.includes(fact) && !requestedFacts.has(fact));
  const repeatedFactScore = currentFacts.length ? Math.round(repeatedFacts.length / currentFacts.length * 100) : 0;
  const recentReplies = messages.filter((item) => item?.role === "assistant").slice(-4).map((item) => item.content);
  const phraseSimilarity = recentReplies.length ? Math.round(Math.max(...recentReplies.map((item) => similarity(reply, item))) * 100) : 0;
  const repeatedOpening = /^(?:that.s a good question|no problem|based on what you.ve told me|everything you.ve told me)/i.test(clean(reply))
    && recentReplies.some((item) => /^(?:that.s a good question|no problem|based on what you.ve told me|everything you.ve told me)/i.test(clean(item)));
  const conversationVariety = Math.max(0, 100 - phraseSimilarity - (repeatedOpening ? 15 : 0));
  const redundancyScore = Math.round((repeatedFactScore + phraseSimilarity) / 2);
  const sentenceCount = sentences(reply).length;
  const articleLike = /\b(?:according to the article|the article states|knowledge hub|business brain|source s\d)\b/i.test(reply);
  const humanFeel = Math.max(0, Math.min(100, 100 - Math.round(redundancyScore * 0.55) - (articleLike ? 25 : 0) - (sentenceCount > 5 ? 10 : 0) + (transitionApplied ? 5 : 0)));
  return {
    repeated_fact_score: repeatedFactScore,
    repeated_fact_keys: repeatedFacts,
    recently_communicated_facts: recentFacts,
    recent_phrase_similarity: phraseSimilarity,
    conversation_variety_score: Math.min(100, conversationVariety),
    redundancy_score: redundancyScore,
    human_feel_rating: humanFeel,
    response_sentence_count: sentenceCount,
    preferred_sentence_range_met: sentenceCount >= 2 && sentenceCount <= 5,
  };
}

export function polishConversationPresentation({
  reply,
  question,
  messages = [],
  productContext = "finance",
  orchestration = {},
  intent = {},
  journey = {},
  ctaTiming = {},
  insufficientKnowledge = false,
} = {}) {
  const originalReply = clean(reply);
  const answerOnlyTurn = Boolean(
    intent.retrieval_required
    && !intent.clarification_required
    && !orchestration.recovery_required
    && !orchestration.product_boundary_blocked
  );
  let polished = conciseClarification(removeInternalDuplicateSentences(removeArticleLeadIn(originalReply)), intent.clarification_required);
  let transitionApplied = false;
  const shouldResume = Boolean(orchestration.application_mode_resumed);
  const shouldOfferEarly = Boolean(ctaTiming.generated_early && intent.retrieval_required);

  if (answerOnlyTurn) {
    polished = removeTrailingQuestions(polished.replace(V6_RESUME, "").trim());
  } else if (shouldResume || shouldOfferEarly) {
    polished = polished.replace(V6_RESUME, "").trim();
    const transition = transitionFor({ question, messages, productContext, insufficientKnowledge, proactiveCta: shouldOfferEarly && !shouldResume });
    const alreadyBridged = /\b(?:start|continue|carry on with)\b.{0,45}\b(?:finance|rent2buy)?\s*application\b/i.test(polished);
    if (!alreadyBridged) {
      polished = `${polished}\n\n${transition}`.trim();
      transitionApplied = true;
    }
  }

  const followUp = enforceAnswerableFollowUp(polished, { intent, journey, orchestration, insufficientKnowledge });
  polished = followUp.reply;
  const diagnostics = conversationPolishDiagnostics({ reply: polished, question, messages, transitionApplied });
  return {
    reply: polished,
    factual_reply_preserved: originalReply.replace(V6_RESUME, "").trim().includes(polished.split(/\n\n/)[0].trim()),
    transition_applied: transitionApplied,
    transition_type: answerOnlyTurn ? "answer_only" : shouldResume ? "resume_application" : shouldOfferEarly ? "offer_application" : transitionApplied ? "resume_sales_conversation" : "none",
    supported_follow_up_question: followUp.supported_question,
    follow_up_guard_applied: followUp.guard_applied,
    unsupported_offer_removed: followUp.unsupported_offer_removed,
    ...diagnostics,
  };
}

export function serialisePolishReviewRatings(reviewerNotes = "", ratings = {}) {
  const marker = "[Conversation polish ratings]";
  const base = clean(reviewerNotes, 5000).split(marker)[0].trim();
  const lines = CONVERSATION_POLISH_REVIEW_FIELDS.map((field) => {
    const raw = Number(ratings[field]);
    if (!Number.isFinite(raw) || raw < 1 || raw > 5) return "";
    return `${field}: ${Math.round(raw)}/5`;
  }).filter(Boolean);
  return clean([base, lines.length ? `${marker}\n${lines.join("\n")}` : ""].filter(Boolean).join("\n\n"), 5000);
}
