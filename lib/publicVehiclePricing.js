const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

const PRICE_QUESTION = /\b(?:price|priced|pricing|cost|costs|how much|monthly|per month|pcm|payment|payments|finance payment|rental|rentals|initial rental|monthly rental|retail|cash price|purchase price)\b/i;
const MONTHLY_QUESTION = /\b(?:monthly|month|per month|pcm|p\/m|finance payment|monthly payment|monthly payments|monthly rental)\b/i;
const INITIAL_RENTAL_QUESTION = /\b(?:initial rental|initial payment|initial charge|upfront rental|upfront payment)\b/i;
const RETAIL_PRICE_QUESTION = /\b(?:retail|cash price|purchase price|price of (?:this|the) (?:van|vehicle)|how much is (?:this|the) (?:van|vehicle))\b/i;
const RENT2BUY_TERM_QUESTION = /\b(?:number of months|how many months|agreement length|term length|what term|which term|term is|over how many months)\b/i;
const FIXED_CHARGE_QUESTION = /\b(?:reservation(?: fee)?|deposit|admin fee|administration fee|final payment|transfer fee)\b/i;
const DIRECT_VEHICLE_REFERENCE = /\b(?:this|that|the|specific|same)\s+(?:van|vehicle)\b/i;
const COMMON_VEHICLE_REFERENCE = /\b(?:ford|transit|connect|custom|ranger|mercedes|sprinter|vito|citan|volkswagen|vw|crafter|transporter|caddy|vauxhall|vivaro|combo|movano|renault|trafic|master|kangoo|peugeot|partner|expert|boxer|citroen|citro[eë]n|berlingo|dispatch|relay|fiat|ducato|doblo|iveco|daily|toyota|proace|nissan|townstar|interstar|primastar)\b/i;
const SAFE_PRICE_WORDS = new Set([
  "from", "vat", "inc", "incl", "including", "inclusive", "ex", "excl", "excluding", "exclusive",
  "plus", "before", "with", "per", "month", "monthly", "pcm", "pm", "p", "m",
]);

function normalisePrice(value) {
  const text = clean(value, 160).replace(/\s+/g, " ");
  if (!text || !/\d/.test(text)) return null;
  // Wix pricing is display text. Allow numbers, GBP punctuation and a small VAT/month vocabulary only.
  // This supports fields that contain both ex-VAT and inc-VAT figures while rejecting arbitrary free text/HTML.
  if (!/^[£0-9A-Za-z\s,./()+\-:&|]+$/.test(text)) return null;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  if (words.some((word) => !SAFE_PRICE_WORDS.has(word))) return null;
  return text;
}

export function normaliseVehicleTermMonths(value) {
  const text = clean(value, 40).replace(/\s+/g, " ");
  if (!text || !/^\d{1,3}(?:\s*months?)?$/i.test(text)) return null;
  const months = Number.parseInt(text, 10);
  return months >= 1 && months <= 120 ? months : null;
}

function displayPrice(value) {
  const text = clean(value, 160);
  if (!text) return "";
  return /^\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?$/.test(text) ? `£${text}` : text;
}

export function normalisePublicVehiclePricing(input = {}) {
  return {
    finance_monthly: normalisePrice(input.finance_monthly ?? input.monthly_finance ?? input.monthlyFinance),
    finance_retail_vat: normalisePrice(input.finance_retail_vat ?? input.retail_price_vat ?? input.retailPriceVat),
    rent2buy_monthly: normalisePrice(input.rent2buy_monthly ?? input.monthly_rental ?? input.monthlyRental),
    rent2buy_initial: normalisePrice(input.rent2buy_initial ?? input.initial_rental ?? input.initialRental),
  };
}

export function isSpecificVehiclePricingQuestion({ message = "", pageType = "", rememberedFacts = {} } = {}) {
  const text = clean(message, 3000);
  if (!PRICE_QUESTION.test(text) || FIXED_CHARGE_QUESTION.test(text)) return false;
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

  const text = clean(message, 3000);
  const pricingQuestion = isSpecificVehiclePricingQuestion({ message: text, pageType, rememberedFacts });
  const termQuestion = productLock === "rent2buy" && RENT2BUY_TERM_QUESTION.test(text)
    && Boolean(clean(vehicleContext?.title || rememberedFacts.vehicle_interest || rememberedFacts.vehicle_type, 200));
  if (!pricingQuestion && !termQuestion) return null;

  const pricing = normalisePublicVehiclePricing(vehicleContext?.pricing || {});
  const termMonths = normaliseVehicleTermMonths(vehicleContext?.term_months ?? vehicleContext?.termMonths);
  const vehicleName = clean(vehicleContext?.title || rememberedFacts.vehicle_interest || rememberedFacts.vehicle_type, 200);
  const subject = vehicleName ? ` for the ${vehicleName}` : " for that specific van";

  if (productLock === "finance") {
    const monthly = displayPrice(pricing.finance_monthly);
    const retail = displayPrice(pricing.finance_retail_vat);
    const asksMonthly = MONTHLY_QUESTION.test(text);
    const asksRetail = RETAIL_PRICE_QUESTION.test(text) && !asksMonthly;

    if (pageType === "finance_vehicle") {
      if (asksMonthly && monthly) {
        return `The current vehicle page shows a Finance monthly figure of ${monthly}${subject}. Please use the exact pricing and terms shown on this page when deciding whether to apply.`;
      }
      if (asksRetail && retail) {
        return `The current vehicle page shows a retail price of ${retail}${subject}. Please use the exact pricing shown on this page when deciding whether to apply.`;
      }
      if (monthly && retail) {
        return `The current vehicle page shows a retail price of ${retail} and a Finance monthly figure of ${monthly}${subject}. Please use the exact pricing and terms shown on this page when deciding whether to apply.`;
      }
      if (monthly) {
        return `The current vehicle page shows a Finance monthly figure of ${monthly}${subject}. Please use the exact pricing and terms shown on this page when deciding whether to apply.`;
      }
      if (retail) {
        return `The current vehicle page shows a retail price of ${retail}${subject}. Please use the exact pricing shown on this page when deciding whether to apply.`;
      }
    }

    return "For the exact price or monthly Finance cost of a specific van, please check that vehicle’s pricing on the website. The figures vary by vehicle and the terms shown on its page, so I won’t guess or estimate an amount here.";
  }

  if (termQuestion) {
    if (termMonths) return `The current Rent2Buy vehicle page shows this agreement over ${termMonths} months${subject}.`;
    return "Please check the vehicle listing on the website for the exact number of months for that Rent2Buy van. I won’t guess the term if it is not available from the current vehicle page.";
  }

  const monthly = displayPrice(pricing.rent2buy_monthly);
  const initial = displayPrice(pricing.rent2buy_initial);
  const asksInitial = INITIAL_RENTAL_QUESTION.test(text);
  const asksMonthly = MONTHLY_QUESTION.test(text) && !asksInitial;
  const termSuffix = termMonths ? ` The page shows the agreement over ${termMonths} months.` : "";

  if (asksInitial && initial) {
    return `The current Rent2Buy vehicle page shows an initial rental of ${initial}${subject}.${termSuffix}`.trim();
  }
  if (asksMonthly && monthly) {
    return `The current Rent2Buy vehicle page shows monthly payments of ${monthly}${subject}.${termSuffix}`.trim();
  }
  if (monthly && initial) {
    return `The current Rent2Buy vehicle page shows an initial rental of ${initial} and monthly payments of ${monthly}${subject}.${termSuffix}`.trim();
  }
  if (monthly) {
    return `The current Rent2Buy vehicle page shows monthly payments of ${monthly}${subject}. Please check the vehicle page for the exact initial rental as well before applying.${termSuffix}`.trim();
  }
  if (initial) {
    return `The current Rent2Buy vehicle page shows an initial rental of ${initial}${subject}. Please check the vehicle page for the exact monthly payments as well before applying.${termSuffix}`.trim();
  }
  return "For a specific Rent2Buy van, please check the vehicle listing on the website for the exact initial rental and monthly payments. Those figures vary by van, so I won’t invent or estimate them here.";
}
