import { buildAskMeRequest } from "../../lib/askme/contract.js";
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

const HUMAN = /\b(?:complaint|refund|human|speak to (?:a person|someone|an agent|the team)|my application|application status|personal quote)\b/i;

export async function draftMarketplaceReply({ product, vehicle, message, history }, { requestReply } = {}) {
  const lane = FIXTURES[product];
  if (!lane) return { reason: "No verified product match" };
  if (lane.otherProduct.test(message)) return { reason: "Question crosses the listing's product boundary" };
  if (HUMAN.test(message)) return { reason: "Customer needs the team" };

  const request = buildAskMeRequest({
    channel: "marketplace",
    product,
    message: redactSensitiveCustomerData(message),
    history: history.map(({ role, content }) => ({ role, content: redactSensitiveCustomerData(content) })),
    context: { vehicle },
    capabilities: { buttons: false },
  });
  const timingFollowUp = /^(?:and\s+)?when\s+is\s+(?:that|it)\s+due\??$/i.test(request.message);
  const reference = referencedKnowledgeQuestion(request.message, request.history)
    || (timingFollowUp ? request.history.findLast((item) => item.role === "user")?.content || "" : "");
  const currentTopic = lane.topics.find((source) => source.terms.test(request.message));
  const topic = currentTopic || lane.topics.find((source) => source.terms.test(reference));
  const result = await answerCustomerMessage(request, {
    environment: {},
    links: { contact: lane.domain },
    checkDistance: async () => { throw new Error("Live postcode checks are disabled in this fixture"); },
    retrieve: async ({ product: requestedProduct }) => ({
      passages: requestedProduct === product && topic ? [{ ...topic, heading: topic.title, type: "business_faq" }] : [],
      pages: [],
    }),
    requestReply: requestReply || (async (prompt) => {
      if (!topic || !prompt.evidenceText.includes(topic.passage)) {
        return { reply: "The team can confirm that.", action: "contact" };
      }
      const reply = !currentTopic && reference && topic.followUp ? topic.followUp : topic.answer;
      return { reply, action: "none" };
    }),
  });

  if (result.status !== "ready" || !result.reply || /^(model_error|model_rejected)$/.test(result.diagnostics.path)) {
    return { reason: "Ask Me could not verify a safe answer" };
  }
  if (result.actions.some((action) => action.type === "contact")) return { reason: "Ask Me referred this question to the team" };
  return { text: result.reply };
}
