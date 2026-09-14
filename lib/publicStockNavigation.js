import { extractVehiclePreference, normaliseCustomerMessage } from "./conversationIntelligence.js";

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

const ROUTES = Object.freeze({
  finance: Object.freeze({
    all: "https://www.vanfinancecompany.co.uk/vans-on-finance",
    small: "https://www.vanfinancecompany.co.uk/vans-on-finance?type=Small",
    medium: "https://www.vanfinancecompany.co.uk/vans-on-finance?type=Medium",
    large: "https://www.vanfinancecompany.co.uk/vans-on-finance?type=Large",
  }),
  rent2buy: Object.freeze({
    all: "https://www.rent2buyvans.co.uk/view-all-vans",
    small: "https://www.rent2buyvans.co.uk/view-small-vans",
    medium: "https://www.rent2buyvans.co.uk/view-medium-vans",
    large: "https://www.rent2buyvans.co.uk/view-lwb-vans",
  }),
});

const MODEL_CATEGORIES = Object.freeze({
  medium: /\b(?:transit custom|custom|vivaro|trafic|expert|dispatch|primastar|proace)\b/i,
  large: /\b(?:transit|sprinter|crafter|boxer|relay|master|movano|ducato)\b/i,
  small: /\b(?:transit connect|connect|partner|berlingo|caddy|combo|kangoo|doblo)\b/i,
});

export function isStockBrowsingRequest(message = "") {
  const text = normaliseCustomerMessage(message);
  return /\b(?:do you have|have you got|got) any\b|\bshow me (?:some|any|them|the vans?)\b|\bwhat (?:vans? |vehicles? )?have you got\b|\bcan i see (?:them|some|any|the vans?)\b|\bwhat(?: is| s) available\b|^(?:yes\s+)?any\b|\bany (?:swb|mwb|lwb|small|medium|large|vans?|customs?|transits?|sprinters?|crafters?|vivaros?)\b/.test(text);
}

function categoryFromFacts(message, facts = {}) {
  const current = extractVehiclePreference(message);
  if (current.size) return current.size;
  const combined = `${clean(current.vehicle_type, 200)} ${clean(current.vehicle_interest, 300)} ${clean(facts.vehicle_type, 200)} ${clean(facts.vehicle_interest, 300)}`;
  if (/\b(?:short wheelbase|swb|small)\b/i.test(combined)) return "small";
  if (/\b(?:medium wheelbase|mwb|medium)\b/i.test(combined)) return "medium";
  if (/\b(?:long wheelbase|lwb|large)\b/i.test(combined)) return "large";
  if (MODEL_CATEGORIES.medium.test(combined)) return "medium";
  if (MODEL_CATEGORIES.small.test(combined)) return "small";
  if (MODEL_CATEGORIES.large.test(combined)) return "large";
  return "all";
}

export function buildPublicStockNavigation({ message = "", productContext = "finance", facts = {} } = {}) {
  if (!["finance", "rent2buy"].includes(productContext) || !isStockBrowsingRequest(message)) return null;
  const category = categoryFromFacts(message, facts);
  const label = category === "small" ? "View Small Vans" : category === "medium" ? "View Medium Vans" : category === "large" ? "View LWB Vans" : "View All Vans";
  const categoryDescription = category === "small" ? "small-van" : category === "medium" ? "medium-van" : category === "large" ? "long-wheelbase" : "current";
  const productDescription = productContext === "rent2buy" ? "Rent2Buy stock" : "Van Finance stock";
  return {
    category,
    reply: `The best place to see what we currently have is our ${categoryDescription} ${productDescription}.`,
    cta: {
      label,
      action: "navigate",
      action_key: `browse_${productContext}_${category}_stock`,
      behavior: "same_window",
      url: ROUTES[productContext][category],
    },
  };
}

export const PUBLIC_STOCK_ROUTES = ROUTES;
