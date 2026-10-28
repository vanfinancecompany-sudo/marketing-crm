// Exact-match, approved Rent2Buy starter FAQs only.
// No semantic guessing, personalised eligibility or invented vehicle/payment terms.
// This module is invoked only on the first turn of a new, Rent2Buy-locked session.
const normalise = (value) => String(value || "").trim().toLowerCase()
  .replace(/[’‘]/g, "'").replace(/[?!.]+$/g, "").replace(/\s+/g, " ").trim();
const product = "(?:rent\\s*2\\s*buy|rent\\s+to\\s+buy)";
const core = new RegExp("^(?:what is " + product + "|how does " + product + " work|tell me about " + product + ")$");
const credit = new RegExp("^(?:does " + product + " (?:do|use|require|involve) (?:a )?credit check|is there a credit check (?:for|with) " + product + "|do you check (?:my )?credit (?:for|with) " + product + ")$");
const collection = new RegExp("^(?:where do i collect (?:a|my|the) " + product + " van|where are " + product + " vans collected|do i (?:have to|need to) collect (?:a|my|the) " + product + " van)$");

const CORE_REPLY = "Rent2Buy is a rent-to-own arrangement, not a finance product. You choose a van and review its initial rental, monthly rental and term before applying. There is no credit check, but you need your own employment or self-employed income and must provide evidence for affordability and document checks. Vans are collected from Southampton, and applicants normally need to live within 100 miles. After completing the agreement, you can choose whether to buy the van for the stated final purchase option; ownership is not automatic.";

const CREDIT_REPLY = "No. Rent2Buy does not use a credit check. Instead, applicants need their own income from employment or self-employment and must provide the documents needed for an affordability assessment. Meeting the requirements and acceptance are not guaranteed.";

const COLLECTION_REPLY = "Rent2Buy vans are collection only from Southampton, not delivered. Applicants normally need to live within 100 miles of Southampton. The team can confirm whether your postcode is eligible.";

export function verifiedRent2BuyFirstTurnFaq({ message = "", session = {} } = {}) {
  if (session.product_lock !== "rent2buy" || session.page_type !== "rent2buy_general") return null;
  if (Number(session.message_count || 0) !== 0) return null;
  if (Array.isArray(session.conversation_history) && session.conversation_history.length > 0) return null;
  if (session.journey_state?.application_mode_active || session.journey_state?.application_state) return null;
  if (session.vehicle_context?.registration || session.vehicle_context?.title) return null;
  const question = normalise(message);
  if (question.length > 140 || !question) return null;
  if (core.test(question)) return { reply: CORE_REPLY, topic: "core" };
  if (credit.test(question)) return { reply: CREDIT_REPLY, topic: "credit_check" };
  if (collection.test(question)) return { reply: COLLECTION_REPLY, topic: "collection" };
  return null;
}
