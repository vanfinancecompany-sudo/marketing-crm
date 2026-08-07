const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

const PRICE_QUESTION = /\b(?:price|priced|pricing|cost|costs|how much|monthly|per month|pcm|payment|payments|finance payment|rental|rentals|initial rental|monthly rental)\b/i;
const DIRECT_VEHICLE_REFERENCE = /\b(?:this|that|the|specific|same)\s+(?:van|vehicle)\b/i;
const COMMON_VEHICLE_REFERENCE = /\b(?:ford|transit|connect|custom|ranger|mercedes|sprinter|vito|citan|volkswagen|vw|crafter|transporter|caddy|vauxhall|vivaro|combo|movano|renault|trafic|master|kangoo|peugeot|partner|expert|boxer|citroen|citro[eë]n|berlingo|dispatch|relay|fiat|ducato|doblo|iveco|daily|toyota|proace|nissan|townstar|interstar|primastar)\b/i;

function normalisePrice(value) {
  const text = clean(value, 80).replace(/\s+/g, " ");
  if (!text) return null;
  // Page context is presentation data, not free-form assistant knowledge. Keep it tightly bounded to money-like display values.
  if (!/^(?:from\s+)?£?\s*\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?(?:\s*(?:\+|plus|inc(?:luding)?|incl\.?|excl\.?|excluding)?\s*vat)?(?:\s*(?:per month|pcm|p\/m|monthly))?$/i.test(text)) return null;
  return text;
}

function gbp(value) {
  const text = clean(value, 80);
  if (!text) return "";
  return text.includes("£") ? text : `£${text}`;
}

export function normalisePublicVehiclePricing(input = {}) {
  return {
    finance_monthly: normalisePrice(input.finance_monthly ?? input.monthly_finance ?? input.monthlyFinance),
    rent2buy_monthly: normalisePrice(input.rent2buy_monthly ?? input.monthly_rental ?? input.monthlyRental),
    rent2buy_initial: normalisePrice(input.rent2buy_initial ?? input.initial_rental ?? input.initialRental),
  };
}

export function isSpecificVehiclePricingQuestion({ message = "", pageType = "", rememberedFacts = {} } = {}) {
  const text = clean(message, 3000);
  if (!PRICE_QUESTION.test(text)) return false;
  if (pageType === "finance_vehicle") return true;
  if (DIRECT_VEHICLE_REFERENCE.test(text) || COMMON_VEHICLE_REFERENCE.test(text)) return true;
  return Boolean(clean(rememberedFacts.vehicle_interest ?? rememberedFacts.vehicle_type, 200));
}

export function publicVehiclePricingReply({
  message = "",
  pageType = "",
  productLock = "",
  vehicleContext = {},
  rememberedFacts = {},
} = {}) {
  if (!["finance", "rent2buy"].includes(productLock)) return null;
  if (!isSpecificVehiclePricingQuestion({ message, pageType, rememberedFacts })) return null;

  const pricing = normalisePublicVehiclePricing(vehicleContext?.pricing || {});
  const vehicleName = clean(vehicleContext?.title || rememberedFacts.vehicle_interest || rememberedFacts.vehicle_type, 200);
  const subject = vehicleName ? ` for the ${vehicleName}` : " for that specific van";

  if (productLock === "finance") {
    if (pageType === "finance_vehicle" && pricing.finance_monthly) {
      return `The current vehicle page shows a Finance figure of ${gbp(pricing.finance_monthly)}${subject}. Please check the pricing and terms shown on this page for the exact current figure before applying.`;
    }
    return "For the exact monthly Finance cost of a specific van, please check that vehicle’s pricing on the website. The monthly figure varies by vehicle and the terms shown on its page, so I won’t guess or estimate an amount here.";
  }

  if (pricing.rent2buy_monthly && pricing.rent2buy_initial) {
    return `The current vehicle page shows an initial rental of ${gbp(pricing.rent2buy_initial)} and a monthly rental of ${gbp(pricing.rent2buy_monthly)}${subject}. Please check the pricing shown on the page for the exact current figures before applying.`;
  }
  if (pricing.rent2buy_monthly) {
    return `The current vehicle page shows a monthly Rent2Buy rental of ${gbp(pricing.rent2buy_monthly)}${subject}. Please check the vehicle page for the exact initial rental as well before applying.`;
  }
  if (pricing.rent2buy_initial) {
    return `The current vehicle page shows an initial Rent2Buy rental of ${gbp(pricing.rent2buy_initial)}${subject}. Please check the vehicle page for the exact monthly rental as well before applying.`;
  }
  return "For a specific Rent2Buy van, please check the vehicle listing on the website for the exact initial rental and monthly rental. Those figures vary by van, so I won’t invent or estimate them here.";
}
