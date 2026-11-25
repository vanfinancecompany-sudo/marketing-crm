import { buildAskMeRequest } from "../../lib/askme/contract.js";
import { businessFactsFor } from "../../lib/askme/businessFacts.js";
import { financeWebsiteReply, marketplaceProduct, marketplaceReplyRoute, rent2BuyWebsiteReply } from "./reply-policy.mjs";
import { referencedKnowledgeQuestion } from "../../lib/askme/knowledgeRetrieval.js";
import { answerCustomerMessage } from "../../lib/askme/leanEngine.js";
import { redactSensitiveCustomerData } from "../../lib/publicAssistantFoundation.js";

const FIXTURES = {
  finance: {
    domain: "https://www.vanfinancecompany.co.uk",
    otherProduct: /\brent[\s-]*(?:2|to)[\s-]*buy\b/i,
    topics: [{
      terms: /\bwarrant(?:y|ies)\b/i,
      title: "Finance fixture: warranty",
      passage: "For this simulated van, the warranty covers the gearbox during normal use, subject to its terms.",
      answer: "The simulated van has a warranty. Coverage is subject to its terms.",
      followUp: "The simulated warranty covers the gearbox during normal use, subject to its terms.",
    }, {
      terms: /\b(?:documents|paperwork)\b/i,
      title: "Finance fixture: documents",
      passage: "The simulated finance application normally asks for proof of identity and address.",
      answer: "For this simulated application, the usual documents are proof of identity and address.",
    }],
  },
  rent2buy: {
    domain: "https://www.rent2buyvans.co.uk",
    otherProduct: /\b(?:van finance|finance application|lenders?|apr|hire purchase|pcp)\b/i,
    topics: [{
      terms: /\b(?:payment|rental|upfront)\b/i,
      title: "Rent2Buy fixture: initial rental",
      passage: "For this simulated listing, an initial rental is due before collection and monthly rental payments follow.",
      answer: "In this simulated example, an initial rental is due before collection, followed by monthly rental payments.",
      followUp: "In the simulated example, the initial rental is due before collection.",
    }, {
      terms: /\b(?:documents|proof|paperwork)\b/i,
      title: "Rent2Buy fixture: proof documents",
      passage: "The simulated application asks for proof of identity, address and income.",
      answer: "For this simulated application, the usual documents are proof of identity, address and income.",
    }],
  },
};

export async function draftMarketplaceReply({ product: knownProduct, vehicle, message, history = [] }, { requestReply, respond, onAdapterTime } = {}) {
  const started = performance.now();
  const finish = (result, engineMs = 0) => {
    onAdapterTime?.(performance.now() - started - engineMs);
    return result;
  };
  const product = marketplaceProduct(knownProduct, message);
  const localReply = marketplaceReplyRoute(product, message);
  if (localReply) return finish(localReply);
  const lane = FIXTURES[product];

  const request = buildAskMeRequest({
    channel: "marketplace",
    product,
    message: redactSensitiveCustomerData(message),
    history: history.map(({ role, content }) => ({ role, content: redactSensitiveCustomerData(content) })),
    context: product === "rent2buy" ? {} : { vehicle },
    capabilities: { buttons: false },
  });
  const engineStarted = performance.now();
  const result = respond ? await respond(request) : await fixtureAnswer(request, lane, requestReply);
  const engineMs = performance.now() - engineStarted;

  if (result?.status !== "ready" || !result.reply || /^(model_error|model_rejected)$/.test(result.diagnostics?.path)
      || lane.otherProduct.test(result.reply)) {
    return finish({ reason: "Ask Me could not verify a safe answer" }, engineMs);
  }
  if (result.actions?.some((action) => action.type === "contact")) {
    return finish({ reason: "Ask Me referred this question to the team" }, engineMs);
  }
  const text = product === "rent2buy" ? rent2BuyWebsiteReply(result.reply, result.actions, request.history) : financeWebsiteReply(result.reply);
  if (!text) return finish({ reason: "Finance reply mentioned approval, rates, payments or availability" }, engineMs);
  return finish({ text }, engineMs);
}

async function fixtureAnswer(request, lane, requestReply) {
  const timingFollowUp = /^(?:and\s+)?when\s+is\s+(?:that|it)\s+due\??$/i.test(request.message);
  const reference = referencedKnowledgeQuestion(request.message, request.history)
    || (timingFollowUp ? request.history.findLast((item) => item.role === "user")?.content || "" : "");
  const currentTopic = lane.topics.find((source) => source.terms.test(request.message));
  const topic = currentTopic || lane.topics.find((source) => source.terms.test(reference));
  const fact = request.product === "rent2buy" ? fixturePolicyFact(request.message) : null;
  return answerCustomerMessage(request, {
    environment: {},
    links: { contact: lane.domain },
    checkDistance: async () => { throw new Error("Live postcode checks are disabled in this fixture"); },
    retrieve: async ({ product: requestedProduct }) => ({
      passages: requestedProduct === request.product && topic ? [{ ...topic, heading: topic.title, type: "business_faq" }] : [],
      pages: [],
    }),
    requestReply: requestReply || (async (prompt) => {
      if (fact && prompt.evidenceText.includes(fact.text)) return { reply: fact.text, action: "none" };
      if (!topic || !prompt.evidenceText.includes(topic.passage)) {
        return { reply: "The team can confirm that.", action: "contact" };
      }
      const reply = !currentTopic && reference && topic.followUp ? topic.followUp : topic.answer;
      return { reply, action: "none" };
    }),
  });
}

function fixturePolicyFact(message) {
  const topic = [
    [/\b(?:return(?:ing)?|termination)\b/i, "early_return"],
    [/\b(?:eligib\w*|self.employed|credit check|qualif\w*|guarantor)\b|^\s*can i apply\b/i, "self_employed"],
    [/\b(?:holding deposit|reservation(?: payment)?)\b/i, "reservation"],
    [/\b(?:minimum initial rental|deposit|how much upfront)\b/i, "initial_rental"],
    [/\b(?:mileage|allowance|monthly)\b/i, "pricing"],
    [/\bhow does rent[\s-]*(?:2|to)[\s-]*buy work\b/i, "product"],
  ].find(([pattern]) => pattern.test(message));
  return topic && businessFactsFor("rent2buy").find(({ id }) => id === "rent2buy." + topic[1]);
}
