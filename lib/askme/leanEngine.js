// Ask Me lean answer engine (channel-independent).
//
// Customer question -> verified facts and context -> one model call when needed
// -> narrow, evidence-based checks -> answer + verified actions.
//
// Replaces, for flagged traffic only, the legacy chain of regex classifiers,
// keyword retrieval, citation-or-discard grounding and "reword a canned reply"
// model calls. The legacy engine is untouched and remains the default.

import { buildAssistantResponseModelParameters } from "../aiAssistantModelRouter.js";
import { resolvePriorityAiModels } from "../priorityAiModelPolicy.js";
import { publicVehiclePricingReply } from "../publicVehiclePricing.js";
import { businessFactsText, ASKME_BUSINESS_FACTS_VERSION } from "./businessFacts.js";
import { vehicleContextText } from "./vehicleContext.js";
import { selectedQuoteText } from "./selectedQuote.js";
import { sanitiseActions } from "./contract.js";
import { knowledgeText, referencedKnowledgeQuestion } from "./knowledgeRetrieval.js";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);
const now = () => performance.now();
const ms = (start) => Math.round(now() - start);

const LEAN_REPLY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["reply", "action"],
  properties: {
    reply: { type: "string" },
    action: { type: "string", enum: ["none", "apply", "browse_stock", "contact"] },
  },
});

const PRODUCT_COPY = {
  finance: { assistant: "Van Finance Assistant", brand: "Van Finance Company", noun: "van finance" },
  rent2buy: { assistant: "Rent to Buy Assistant", brand: "Rent2Buy Vans", noun: "Rent2Buy" },
};

// ---- Narrow, evidence-based safety checks -------------------------------------------

const APPROVAL_PROMISE = /\b(?:you(?:'ll| will| are going to)? (?:definitely |certainly )?(?:be|get) (?:approved|accepted)|guaranteed (?:approval|acceptance|to be (?:approved|accepted))|(?:approval|acceptance) is guaranteed|100% (?:approval|acceptance)|everyone (?:is|gets) (?:approved|accepted))\b/i;
const RENT2BUY_WORDS = /\brent\s?2\s?buy\b|\brent[- ]to[- ](?:buy|own)\b/i;
const FINANCE_WORDS = /\b(?:apr|lenders?|lender panel|hire purchase|pcp|lease purchase|credit approval|finance (?:application|approval|agreement|deal|options?)|interest rate)\b/i;
const MONEY = /£\s?(\d[\d,]*(?:\.\d{1,2})?)/g;

const amountsIn = (text) => [...clean(text, 20000).matchAll(MONEY)].map((match) => Number(match[1].replace(/,/g, ""))).filter(Number.isFinite);

const KNOWLEDGE_TOPIC = /\b(?:warrant\w*|guarantee\w*|insur\w*|cover(?:ed|age)?|breakdown|servic\w*|repair\w*|fault\w*|deliver\w*|collect\w*|documents?|paperwork|agreement|contract|cancel\w*|terminat\w*|end (?:it|the|my) (?:early|agreement)|return\w*|refund\w*|part[- ]?exchange|mot|reservation(?: payment| fee)?|holding deposit)\b/i;

export function checkLeanReply(reply, { product, evidenceText }) {
  const problems = [];
  if (!clean(reply)) problems.push("empty_reply");
  if (APPROVAL_PROMISE.test(reply)) problems.push("approval_promise");
  if (product === "finance" && RENT2BUY_WORDS.test(reply)) problems.push("cross_product_rent2buy");
  if (product === "rent2buy" && FINANCE_WORDS.test(reply)) problems.push("cross_product_finance");
  const allowed = new Set(amountsIn(evidenceText));
  const unverified = amountsIn(reply).filter((amount) => !allowed.has(amount));
  if (unverified.length) problems.push(`unverified_figure:${unverified.slice(0, 3).join(",")}`);
  return { ok: problems.length === 0, problems };
}

// ---- Verified actions (never model-invented URLs) -----------------------------------

const UNAVAILABLE = new Set(["reserved", "unavailable", "sold"]);

export function buildLeanActions({ product, vehicle = {}, selectedQuote = {}, quoteToken = null, links = {}, choice = "none" }) {
  const hasVehicle = Boolean(clean(vehicle.registration, 20));
  const available = hasVehicle && !UNAVAILABLE.has(clean(vehicle.stock_status, 40).toLowerCase());
  const kind = vehicle.vehicle_kind === "car" ? "car" : "van";
  const browse = links.browse_stock ? { type: "browse_stock", label: product === "rent2buy" ? "View Rent2Buy vans" : "Browse vans", url: links.browse_stock } : null;
  const contact = links.contact ? { type: "contact", label: "Contact the team", url: links.contact } : null;
  let apply = null;
  if (available && vehicle.apply_link) {
    const verifiedQuote = product === "rent2buy" && selectedQuote.status === "verified" && quoteToken;
    const url = verifiedQuote
      ? `${vehicle.apply_link}${vehicle.apply_link.includes("?") ? "&" : "?"}r2b_quote=${encodeURIComponent(quoteToken)}`
      : vehicle.apply_link;
    apply = { type: "apply", label: verifiedQuote ? "Apply with my selected quote" : `Apply for this ${kind}`, url };
  } else if (!hasVehicle && links.apply) {
    apply = { type: "apply", label: product === "rent2buy" ? "Start a Rent2Buy application" : "Start a finance application", url: links.apply };
  }
  let actions = [];
  if (choice === "apply") actions = [apply || browse];
  else if (choice === "browse_stock") actions = [browse];
  else if (choice === "contact") actions = [contact];
  // A reserved or sold vehicle can never be applied for; offer other stock instead.
  if (hasVehicle && !available) actions = actions.map((action) => (action?.type === "apply" ? browse : action));
  return sanitiseActions(actions.filter(Boolean));
}

// ---- Prompt -------------------------------------------------------------------------

export function buildLeanPrompt(request, knowledge = null) {
  const { product, context, history, facts, message } = request;
  const retrieved = knowledge ? knowledgeText(knowledge) : "";
  const copy = PRODUCT_COPY[product];
  const vehicleText = vehicleContextText(context.vehicle, product);
  const quoteText = selectedQuoteText(context.selected_quote);
  const boundary = product === "finance"
    ? "Only discuss van finance. Never mention Rent2Buy or rent-to-buy."
    : "Only discuss Rent2Buy. Rent2Buy is not finance: never mention lenders, APR, interest, hire purchase, PCP or credit approval.";
  const instructions = [
    `You are the ${copy.assistant} for ${copy.brand}, chatting with a customer${request.channel?.startsWith("website") ? " on the website" : ""}.`,
    "Write plain text only (no markdown, lists or links). Be warm, clear and direct: usually 2-4 short sentences, under 90 words.",
    "Answer the customer's actual question first, using the verified information below. It is approved and current, so state it confidently.",
    "For business facts, figures, terms and vehicle details use only the information below, in this order of authority: (1) verified facts, (2) the live vehicle and the customer's calculator quote, (3) approved knowledge passages [K], (4) related website pages. If a lower source conflicts with a higher one, follow the higher one and say the team can confirm the detail. Use the knowledge passages to answer detailed questions (warranty, insurance, documents, agreements, delivery and similar), answering every part of a multi-part question. If nothing below covers the question, say the team will confirm it; never guess.",
    "This is a continuing conversation, not a sequence of unrelated FAQs. Answer the latest question naturally, build on what the customer has already told you, and do not ask them to repeat a detail they have supplied. If they correct or change a requirement, use their newest answer. Resolve 'it', 'that one', 'those' and similar follow-ups from the conversation. Ask only one useful follow-up at a time.",
    "Give general requirements first when the customer’s employment or business type is unknown. Treat specialised requirements as conditional.",
    "Do not repeat a customer's budget as a price. When helping them find stock, acknowledge their budget without repeating its amount. Only quote £ figures that appear in verified evidence. Describe listing figures as advertised illustrations, not the customer's confirmed figures.",
    "Never promise approval, acceptance or that a vehicle is available.",
    boundary,
    "Do not force a question at the end of every reply. If the customer changes topic or leaves your earlier question unanswered, focus on their new message rather than repeating the same question. Ask one useful follow-up only when it genuinely helps the current goal. When helping find a vehicle, gather use, size and budget naturally, then offer Browse; do not recommend a specific van unless verified available stock is supplied.",
    'Set "action": "apply" when they ask about applying, their eligibility, or what they would pay; "browse_stock" when they want to see vehicles; "contact" when the team must confirm something; otherwise "none".',
  ].join("\n");
  const sections = [
    `# Verified ${copy.noun} facts (v${ASKME_BUSINESS_FACTS_VERSION})\n${businessFactsText(product)}`,
    vehicleText ? `# Vehicle on the customer's current page\n${vehicleText}` : "# Vehicle\nNo specific vehicle is in view.",
    quoteText ? `# Customer's calculator quote\n${quoteText}` : "",
    retrieved ? `# Approved knowledge (authority 3-4; never overrides the sections above)\n${retrieved}` : "",
    Object.keys(facts || {}).length ? `# What the customer has told us\n${JSON.stringify(facts)}` : "",
    history.length ? `# Conversation so far (recent turns; newest correction takes precedence)\n${history.slice(-16).map((item) => `${item.role}: ${clean(item.content, 450)}`).join("\n")}` : "",
    `# Customer message\n${message}`,
  ].filter(Boolean);
  return { instructions, input: sections.join("\n\n"), evidenceText: [businessFactsText(product), vehicleText, quoteText, retrieved].join("\n") };
}

// ---- Model call ---------------------------------------------------------------------

export async function requestLeanReply({ instructions, input }, route, environment = process.env, fetchImplementation = fetch) {
  const apiKey = clean(environment.OPENAI_API_KEY);
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const parameters = buildAssistantResponseModelParameters(route);
  const response = await fetchImplementation("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...parameters,
      instructions,
      input,
      store: false,
      text: { format: { type: "json_schema", name: "askme_lean_reply", strict: true, schema: LEAN_REPLY_SCHEMA } },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`OpenAI request failed (${response.status}).`);
  const output = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  const parsed = JSON.parse(output || "{}");
  return { reply: clean(parsed.reply, 2000), action: clean(parsed.action, 20) || "none", model: parameters.model, usage: payload.usage || {} };
}

// ---- Engine -------------------------------------------------------------------------

function safeFallbackReply(product) {
  return product === "rent2buy"
    ? "I want to make sure I give you accurate Rent2Buy information, so I'll leave that one for the team to confirm. Is there anything else I can help with?"
    : "I want to make sure I give you accurate information, so I'll leave that one for the team to confirm. Is there anything else I can help with?";
}

const UPFRONT = /\b(?:upfront|up front|up-front|deposit|pay first|initial)\b/i;

/**
 * @param {object} request AskMeRequest (lib/askme/contract.js)
 * @param {object} options { environment, links, requestReply, now }
 */
export async function answerCustomerMessage(request, options = {}) {
  const started = now();
  const environment = options.environment || process.env;
  const links = options.links || {};
  const { product, context } = request;
  const timings = {};

  // 1. Exact vehicle pricing is data, not prose: answer it directly from verified
  //    figures (fast, and immune to model rounding or substitution).
  let stage = now();
  // The direct (no-model) answer is only for plain price/spec questions. A question that
  // also asks about warranty, insurance, delivery, documents or the agreement goes to the
  // model with the same verified figures plus retrieved knowledge, so no part is dropped
  // ("does the warranty cover the gearbox?" is not a gearbox-spec question).
  const priorQuestion = referencedKnowledgeQuestion(request.message, request.history);
  const needsKnowledge = KNOWLEDGE_TOPIC.test(request.message) || KNOWLEDGE_TOPIC.test(priorQuestion);
  const pricingReply = !needsKnowledge && (context.vehicle?.registration || context.vehicle?.title)
    ? publicVehiclePricingReply({
      message: request.message,
      pageType: context.page_type || (product === "finance" ? "finance_vehicle" : "rent2buy_general"),
      productLock: product,
      vehicleContext: context.vehicle,
      rememberedFacts: request.facts,
      selectedQuote: context.selected_quote,
    })
    : null;
  timings.context_ms = ms(stage);
  if (pricingReply && !/won.t guess|won.t invent|check (?:that|the) vehicle/i.test(pricingReply)) {
    const deposit = product === "finance" && UPFRONT.test(request.message)
      ? " Deposits can start from £99 on qualifying applications; the lender confirms your actual deposit and payment after you apply."
      : "";
    const actions = buildLeanActions({ product, vehicle: context.vehicle, selectedQuote: context.selected_quote, quoteToken: context.quote_token, links, choice: "apply" });
    timings.total_ms = ms(started);
    return { reply: `${pricingReply}${deposit}`, actions, status: "ready", diagnostics: { engine: "lean", path: "verified_pricing", model: null, timings_ms: timings, tokens: null, checks: [] } };
  }

  // 2. On-demand knowledge retrieval: in-memory ranking over the cached approved corpus
  //    (Business Brain, Knowledge Hub, business pages). No extra model call; passages are
  //    only included above a relevance floor, so simple questions stay compact.
  let knowledge = null;
  let retrievalDiagnostics = null;
  if (typeof options.retrieve === "function") {
    stage = now();
    try {
      knowledge = await options.retrieve({ product, message: request.message, history: request.history });
      retrievalDiagnostics = {
        passages: (knowledge.passages || []).map((item) => ({ title: item.title, heading: item.heading, type: item.type, score: item.score })),
        pages: (knowledge.pages || []).map((page) => page.title),
        corpus_size: knowledge.corpus_size,
        cache_hit: knowledge.cache_hit,
        timings_ms: knowledge.timings_ms,
      };
    } catch (error) {
      retrievalDiagnostics = { error: clean(error?.message, 200) };
    }
    timings.retrieval_ms = ms(stage);
  }

  // 3. One model call with the verified facts, live context and any relevant knowledge.
  stage = now();
  const prompt = buildLeanPrompt(request, knowledge);
  timings.prompt_ms = ms(stage);
  const models = resolvePriorityAiModels(environment);
  const route = { model: models.wix_main, reasoning_effort: "low", temperature: 0.2 };
  stage = now();
  let generated;
  try {
    generated = await (options.requestReply || requestLeanReply)(prompt, route, environment);
  } catch (error) {
    timings.model_ms = ms(stage);
    timings.total_ms = ms(started);
    return { reply: safeFallbackReply(product), actions: buildLeanActions({ product, vehicle: context.vehicle, links, choice: "contact" }), status: "ready", diagnostics: { engine: "lean", path: "model_error", model: route.model, timings_ms: timings, tokens: null, checks: [clean(error?.message, 200)] } };
  }
  timings.model_ms = ms(stage);

  // 4. Narrow checks: no approval promises, no cross-product leakage, no unverified £ figures.
  stage = now();
  const check = checkLeanReply(generated.reply, { product, evidenceText: prompt.evidenceText });
  timings.checks_ms = ms(stage);
  const reply = check.ok ? generated.reply : safeFallbackReply(product);
  const actions = buildLeanActions({
    product, vehicle: context.vehicle, selectedQuote: context.selected_quote, quoteToken: context.quote_token, links,
    choice: check.ok ? generated.action : "contact",
  });
  timings.total_ms = ms(started);
  return {
    reply,
    actions,
    status: "ready",
    diagnostics: {
      engine: "lean",
      path: check.ok ? (knowledge?.passages?.length ? "model_with_knowledge" : "model") : "model_rejected",
      retrieval: retrievalDiagnostics,
      model: generated.model,
      timings_ms: timings,
      tokens: { input: Number(generated.usage?.input_tokens) || 0, output: Number(generated.usage?.output_tokens) || 0 },
      checks: check.problems,
    },
  };
}
