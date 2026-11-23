export const RENT2BUY_WEBSITE = "https://www.rent2buyvans.co.uk/";

const RENT2BUY = /\brent[\s-]*(?:2|to)[\s-]*buy\b/i;
const FINANCE = /\b(?:van finance|finance application|lenders?|apr|hire purchase|pcp)\b/i;
const HUMAN = /\b(?:complain(?:t|ing)?|dispute|a human|speak to (?:a person|someone|an agent|the team)|application (?:status|decision|reference)|(?:approve|accept) me|(?:will|would) i be (?:approved|accepted)|(?:refund|repay) (?:me|my)|(?:cancel|amend) my (?:agreement|booking|application)|(?:my|our) application\b.{0,40}\b(?:status|decision|progress|update|approved|declined|rejected|refused|denied|turned down|pending))\b/i;

const CURRENT_STOCK = /\b(?:in stock|still available|still for sale|still (?:got|have)|(?:vehicle|van) availability|(?:which|what) vans (?:are available|do you have)|any vans available|(?:do you|have you) (?:still )?(?:have|got) (?:any|a|this|that) (?:\w+ ){0,3}(?:vans?|vehicles?|stock)|what (?:stock|vehicles) (?:do you have|is available)|book a viewing|(?:this|that|the) (?:van|vehicle|one) (?:available|sold|reserved)|(?:reserve|buy|collect) (?:this|that|the) (?:van|vehicle|one))\b/i;
const SPECIFICATION = /\b(?:spec(?:s|ification(?:s)?)|payload|wheelbase|gearbox|transmission|engine size|dimensions|registration(?: number)?|number plate|colour|fuel type|diesel|electric|automatic|manual|odometer|mileage (?:on|of) (?:this|that|the) (?:van|vehicle|one)|(?:what|how many) miles (?:has|on)|fit .{1,60} in (?:it|this van))\b/i;
const LISTED_VEHICLE = /\b(?:(?:this|that|the|advertised|listed) (?:van|vehicle|one|listing)|(?:van|vehicle) (?:in|on) (?:this|that|the) (?:ad|advert|listing))\b/i;
const SPECIFIC_REQUEST = /\b(?:available|availability|price|cost|monthly|pay|payment|rent|rental|quote|mileage|miles|age|year|specs|details|mot)\b/i;
const PERSONAL_PRICE = /\b(?:(?:personal(?:ised|ized)?|my|individual|exact|tailored|specific) (?:price|quote)|quote me|(?:get|give|send|have) (?:me )?(?:a|an) (?:written )?quote|how much (?:would|will|do) i pay|how much does (?:it|this|that) cost|what would (?:i pay|it cost me)|how much (?:would|will) (?:it|this|that) cost|how much (?:is|for) (?:it|this|that))\b/i;

// Found by the live Marketplace check (23 Nov 2026): monthly prices of a van,
// details asked about "it/this", and requests to hold a van reached Ask Me.
// These depend on the individual vehicle, so they go to the website. General
// fee questions (initial rental, deposit, reservation payment) still go to Ask Me.
const VEHICLE_DETAIL = new RegExp([
  String.raw`\bhow much\b(?!.*\b(?:initial rental|deposit|reservation|upfront|purchase option|fee)\b).*\b(?:per|a|each) (?:month|week)\b`,
  String.raw`\b(?:monthly|weekly) (?:price|cost|payment|rental)s? (?:on|for|of) (?:the|this|that|your)\b`,
  String.raw`\b(?:mileage|miles|mot|service history|condition|how old|what year|reg(?:istration)?)\b.{0,30}\b(?:it|this|that|one)\b`,
  String.raw`\b(?:hold|save|put aside|reserve)\b.{0,20}\b(?:it|this|that|one|the van)\b`,
  String.raw`\bkeep (?:it|this|that(?: one)?|the van) (?:for|until|till) (?:me|\w+day|tomorrow|the weekend)\b`,
  // Live pilot (23 Nov 2026): "What's the vehicle's history?"
  String.raw`\b(?:vehicle|van|its|the)['’]?s? (?:service |full |accident )?history\b|\bhistory (?:of|on|for) (?:it|this|that|the (?:van|vehicle))\b|\b(?:any|full) (?:service )?history\b`,
].join("|"), "i");

const WEBSITE_GUIDANCE = "Check the live website for current vans, availability, vehicle details and prices. You can get a quote and apply online there.";
const BROWSE_AND_APPLY = "You can browse current vans and apply online at " + RENT2BUY_WEBSITE;

export function marketplaceProduct(product, message = "") {
  if (product === "finance" || product === "rent2buy") return product;
  return RENT2BUY.test(message) && !FINANCE.test(message) ? "rent2buy" : null;
}

export function marketplaceReplyRoute(product, message) {
  if (HUMAN.test(message)) return { reason: "Customer needs the team" };
  if (!product) return { reason: "No verified listing match" };
  if ((product === "rent2buy" ? FINANCE : RENT2BUY).test(message)) {
    return { reason: "Question crosses the listing's product boundary" };
  }
  if (product === "rent2buy" && (
    CURRENT_STOCK.test(message) || SPECIFICATION.test(message) || PERSONAL_PRICE.test(message) || VEHICLE_DETAIL.test(message)
    || (LISTED_VEHICLE.test(message) && SPECIFIC_REQUEST.test(message))
    || /^(?:(?:what(?:[\x27’]s| is) (?:the )?)?(?:price|mileage|availability|available))\s*\??$/i.test(message.trim())
  )) return { text: WEBSITE_GUIDANCE + "\n\n" + RENT2BUY_WEBSITE };
  if (product === "rent2buy" && /\b(?:how|where) (?:do|can|should) i (?:apply|(?:start|complete|submit) (?:my |an? )?application)\b/i.test(message)) {
    return { text: "You can complete your Rent2Buy application online at " + RENT2BUY_WEBSITE };
  }
  return null;
}

export function rent2BuyWebsiteReply(reply, actions, history) {
  if (/\b(?:currently in stock|is still available|available now|in stock now|(?:this|that|the) (?:van|vehicle) (?:is|has been) (?:available|reserved|sold))\b/i.test(reply)) {
    return WEBSITE_GUIDANCE + "\n\n" + RENT2BUY_WEBSITE;
  }
  if (reply.includes(RENT2BUY_WEBSITE)) return reply;
  if (!history.some((entry) => entry.role === "assistant")
      || actions?.some((action) => ["apply", "browse_stock"].includes(action?.type))) {
    return reply + "\n\n" + BROWSE_AND_APPLY;
  }
  return reply;
}
