const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

const PRICE_QUESTION = /\b(?:price|priced|pricing|cost|costs|how much|monthly|per month|pcm|payment|payments|finance payment|rental|rentals|initial rental|monthly rental|retail|cash price|purchase price)\b/i;
const MONTHLY_QUESTION = /\b(?:monthly|month|per month|pcm|p\/m|finance payment|monthly payment|monthly payments|monthly rental)\b/i;
const INITIAL_RENTAL_QUESTION = /\b(?:initial rental|initial payment|initial charge|upfront rental|upfront payment)\b/i;
const RETAIL_PRICE_QUESTION = /\b(?:retail|cash price|purchase price|price of (?:this|the) (?:van|vehicle)|how much is (?:this|the) (?:van|vehicle))\b/i;
const RENT2BUY_TERM_QUESTION = /\b(?:number of months|how many months|agreement length|term length|what term|which term|term is|over how many months)\b/i;
const FIXED_CHARGE_QUESTION = /\b(?:reservation(?: fee)?|deposit|admin fee|administration fee|final payment|transfer fee)\b/i;
const DIRECT_VEHICLE_REFERENCE = /\b(?:this|that|the|specific|same)\s+(?:van|vehicle)\b/i;
const COMMON_VEHICLE_REFERENCE = /\b(?:ford|transit|connect|custom|ranger|mercedes|sprinter|vito|citan|volkswagen|vw|crafter|transporter|caddy|vauxhall|vivaro|combo|movano|renault|trafic|master|kangoo|peugeot|partner|expert|boxer|citroen|citro[eë]n|berlingo|dispatch|relay|fiat|ducato|doblo|iveco|daily|toyota|proace|nissan|townstar|interstar|primastar|maxus)\b/i;
const VEHICLE_SPEC_ATTRIBUTE = /\b(?:automatic|auto|manual|gearbox|transmission|fuel(?: type)?|diesel|petrol|electric|hybrid|mileage|miles|engine size|engine capacity|bhp|horsepower|colour|color|euro ?6|wheelbase|lwb|mwb|swb|payload|towing|air ?con|air conditioning|sat ?nav|navigation|parking sensors?|reverse camera|camera|cruise control|bluetooth|tow ?bar|doors?|seats?|spec(?:ification)?|features?|equipment)\b/i;
const VEHICLE_SPEC_QUERY_OPEN = /^\s*(?:is|are|does|do|has|have|what|what's|whats|which|how many|tell me|can you tell me)\b/i;
const VEHICLE_OVERVIEW_QUESTION = /(?:\btell me (?:about|more about) (?:this|the) (?:van|vehicle)\b|\bwhat (?:is|can you tell me about) this (?:van|vehicle)\b|\bdetails? (?:on|about|for) this (?:van|vehicle)\b)/i;
const FINANCE_OR_RENT2BUY_PROCESS = /\b(?:finance|rent2buy|rent ?2 ?buy|rent to buy|apply|application|credit|deposit|vat|afford|monthly|price|cost|payment|agreement|term)\b/i;
const SAFE_PRICE_WORDS = new Set(["from", "vat", "inc", "incl", "including", "inclusive", "ex", "excl", "excluding", "exclusive", "plus", "before", "with", "per", "month", "monthly", "pcm", "pm", "p", "m"]);
const SPEC_LABELS = new Set(["REGISTRATION", "YEAR", "MILEAGE", "EURO", "ENGINE SIZE", "FUEL TYPE", "COLOUR", "COLOR", "TRANSMISSION", "BHP", "MPG"]);

function normalisePrice(value) {
  const text = clean(value, 160).replace(/\s+/g, " ");
  if (!text || !/\d/.test(text) || !/^[£0-9A-Za-z\s,./()+\-:&|]+$/.test(text)) return null;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  return words.some((word) => !SAFE_PRICE_WORDS.has(word)) ? null : text;
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

function displayMonthlyPrice(value) {
  const text = displayPrice(value);
  if (!text) return "";
  return /\b(?:pcm|per month|monthly)\b/i.test(text) ? text : `${text} per month`;
}

function displayVehicleRegistration(value) {
  const original = clean(value, 20).toUpperCase();
  const compact = original.replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(compact)) return `${compact.slice(0, 4)} ${compact.slice(4)}`;
  return original;
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

export function isVehicleSpecificationQuestion(message = "") {
  const text = clean(message, 3000);
  if (!text || !VEHICLE_SPEC_ATTRIBUTE.test(text)) return false;
  if (FINANCE_OR_RENT2BUY_PROCESS.test(text)) return false;
  if (/^\s*(?:automatic|auto|manual)\s*[?.!]*\s*$/i.test(text)) return true;
  return VEHICLE_SPEC_QUERY_OPEN.test(text) || /\b(?:this|that|it)\b/i.test(text);
}

function hasCurrentVehicleContext(pageType, vehicleContext = {}) {
  if (pageType === "finance_vehicle") return true;
  return Boolean(clean(vehicleContext?.registration || vehicleContext?.vehicle_id || vehicleContext?.title, 200));
}

function vehicleSpecificationBoundaryReply(productLock) {
  return productLock === "rent2buy"
    ? "I can help with the Rent2Buy costs and application for this van, but I don’t have a reliable specification for this particular vehicle. Please check the Vehicle Information on this page for details such as transmission, mileage and equipment."
    : "I can help with the finance, pricing and application for this van, but I don’t have a reliable specification for this particular vehicle. Please check the Vehicle Information on this page for details such as transmission, mileage and equipment.";
}

function vehicleText(vehicleContext = {}) {
  return [vehicleContext.description, vehicleContext.highlights, vehicleContext.specification].map((value) => clean(value, 7000)).filter(Boolean).join("\n");
}

function specificationFields(specification = "") {
  const fields = {};
  const lines = clean(specification, 7000).replace(/\r/g, "\n").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([A-Z ]{2,24})\s*:\s*(.+)$/i);
    if (!match) continue;
    const key = match[1].trim().toUpperCase();
    if (SPEC_LABELS.has(key)) fields[key] = clean(match[2], 120).replace(/\s+/g, " ");
  }
  // Some Wix fields can arrive flattened. Recover labelled values without relying on line breaks.
  if (!Object.keys(fields).length) {
    const flat = clean(specification, 7000).replace(/\s+/g, " ");
    for (const key of SPEC_LABELS) {
      const labels = [...SPEC_LABELS].map((label) => label.replace(/ /g, "\\s+")).join("|");
      const match = flat.match(new RegExp(`${key.replace(/ /g, "\\s+")}\\s*:\\s*(.+?)(?=\\s+(?:${labels})\\s*:|$)`, "i"));
      if (match?.[1]) fields[key] = clean(match[1], 120);
    }
  }
  return fields;
}

function compactDescription(value, limit = 320) {
  const text = clean(value, 3000).replace(/\s+/g, " ");
  if (!text || text.length <= limit) return text;
  const shortened = text.slice(0, limit);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > 200 ? lastSpace : limit).trim()}…`;
}

function naturalList(values = []) {
  const items = values.filter(Boolean);
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function listedVehicleFeatures(vehicleContext = {}) {
  const source = vehicleText(vehicleContext).replace(/\s+/g, " ").toLowerCase();
  const definitions = [
    [["air conditioning", "air con", "aircon"], "air conditioning"],
    [["parking sensor", "parking sensors"], "parking sensors"],
    [["cruise control"], "cruise control"],
    [["bluetooth"], "Bluetooth"],
    [["sat nav", "satnav", "navigation"], "sat nav"],
    [["reverse camera", "reversing camera", "parking camera"], "a reversing camera"],
    [["tow bar", "towbar"], "a tow bar"],
  ];
  return definitions
    .filter(([aliases]) => aliases.some((alias) => source.includes(alias)))
    .map(([, label]) => label)
    .slice(0, 5);
}

function vehicleOverviewReply(productLock, vehicleContext = {}) {
  const name = clean(vehicleContext.title, 200) || "This van";
  const registration = displayVehicleRegistration(vehicleContext.registration);
  const year = clean(vehicleContext.year, 80);
  const fields = specificationFields(vehicleContext.specification);
  const mileage = fields.MILEAGE ? `${fields.MILEAGE}${/miles?/i.test(fields.MILEAGE) ? "" : " miles"}` : "";
  const fuel = clean(fields["FUEL TYPE"], 80).toLowerCase();
  const transmission = clean(fields.TRANSMISSION, 80).toLowerCase();
  const engine = clean(fields["ENGINE SIZE"], 80);
  const bhp = clean(fields.BHP, 80);
  const euro = clean(fields.EURO, 80).replace(/^euro\s*/i, "");
  const colour = clean(fields.COLOUR || fields.COLOR, 80).toLowerCase();
  const sentences = [`${name}${registration ? ` (${registration})` : ""}.`];

  if (year && mileage) sentences.push(`It’s a ${year} model with ${mileage}.`);
  else if (year) sentences.push(`It’s a ${year} model.`);
  else if (mileage) sentences.push(`It has ${mileage}.`);

  if (engine || fuel || transmission || bhp || euro) {
    let sentence = "";
    if (engine || fuel) {
      const engineDescription = [engine, fuel].filter(Boolean).join(" ");
      sentence = `It has a ${engineDescription} engine`;
    } else {
      sentence = "It";
    }
    if (transmission) sentence += `${sentence === "It" ? " has" : " with"} a ${transmission} gearbox`;
    if (bhp) sentence += `${sentence === "It" ? " produces" : ", producing"} ${bhp} BHP`;
    if (euro) sentence += `${sentence === "It" ? " is" : ", and is"} Euro ${euro} compliant`;
    sentences.push(`${sentence}.`);
  }

  if (colour) sentences.push(`It’s finished in ${colour}.`);

  const features = listedVehicleFeatures(vehicleContext);
  if (features.length) sentences.push(`It also includes ${naturalList(features)}.`);

  if (sentences.length === 1) {
    const description = compactDescription(vehicleContext.description || vehicleContext.highlights);
    if (description) sentences.push(description.endsWith(".") ? description : `${description}.`);
  }

  const pricing = normalisePublicVehiclePricing(vehicleContext.pricing || {});
  if (productLock === "rent2buy") {
    const initial = displayPrice(pricing.rent2buy_initial);
    const monthly = displayMonthlyPrice(pricing.rent2buy_monthly);
    if (initial && monthly) sentences.push(`The initial rental is ${initial}, with fixed monthly payments of ${monthly}.`);
    else if (initial) sentences.push(`The initial rental is ${initial}.`);
    else if (monthly) sentences.push(`The fixed monthly payment is ${monthly}.`);
  } else {
    const retail = displayPrice(pricing.finance_retail_vat);
    const monthly = displayMonthlyPrice(pricing.finance_monthly);
    if (retail && monthly) sentences.push(`It’s currently priced at ${retail}, with Finance from ${monthly}.`);
    else if (retail) sentences.push(`It’s currently priced at ${retail}.`);
    else if (monthly) sentences.push(`Finance starts from ${monthly}.`);
  }

  return sentences.join(" ").replace(/\.\s*\./g, ".").trim();
}

function attributeReply(message, vehicleContext = {}) {
  const fields = specificationFields(vehicleContext.specification);
  const text = clean(message, 3000).toLowerCase();
  const mileage = fields.MILEAGE ? `${fields.MILEAGE}${/miles?/i.test(fields.MILEAGE) ? "" : " miles"}` : "";
  if (/\bmileage|miles\b/.test(text) && mileage) return `This van has ${mileage}.`;
  if (/\bautomatic|auto|manual|gearbox|transmission\b/.test(text) && fields.TRANSMISSION) return `This van has a ${fields.TRANSMISSION.toLowerCase()} gearbox.`;
  if (/\bfuel|diesel|petrol|electric|hybrid\b/.test(text) && fields["FUEL TYPE"]) return `This van is ${fields["FUEL TYPE"].toLowerCase()}.`;
  if (/\bengine size|engine capacity\b/.test(text) && fields["ENGINE SIZE"]) return `This van has a ${fields["ENGINE SIZE"]} engine.`;
  if (/\bbhp|horsepower\b/.test(text) && fields.BHP) return `This van produces ${fields.BHP} BHP.`;
  if (/\bcolour|color\b/.test(text) && (fields.COLOUR || fields.COLOR)) return `This van is finished in ${(fields.COLOUR || fields.COLOR).toLowerCase()}.`;
  if (/\beuro ?6|\beuro\b/.test(text) && fields.EURO) return `This van is Euro ${String(fields.EURO).replace(/^euro\s*/i, "")} compliant.`;

  const source = vehicleText(vehicleContext).replace(/\s+/g, " ").toLowerCase();
  const featureAliases = [
    [/\bair ?con|air conditioning\b/i, ["air conditioning", "air con", "aircon"], "air conditioning"],
    [/\bsat ?nav|navigation\b/i, ["sat nav", "satnav", "navigation"], "sat nav/navigation"],
    [/\bparking sensors?\b/i, ["parking sensor", "parking sensors"], "parking sensors"],
    [/\breverse camera|camera\b/i, ["reverse camera", "reversing camera", "parking camera", "camera"], "camera"],
    [/\bcruise control\b/i, ["cruise control"], "cruise control"],
    [/\bbluetooth\b/i, ["bluetooth"], "Bluetooth"],
    [/\btow ?bar\b/i, ["tow bar", "towbar"], "tow bar"],
  ];
  for (const [questionPattern, aliases, label] of featureAliases) {
    if (!questionPattern.test(message)) continue;
    if (aliases.some((alias) => source.includes(alias))) return `Yes, this van lists ${label}.`;
    return `I can’t confirm ${label} from the vehicle information for this van, so I won’t guess.`;
  }

  if (/\b(?:spec|specification|features|equipment)\b/i.test(message)) {
    const features = listedVehicleFeatures(vehicleContext);
    if (features.length) return `This van lists ${naturalList(features)}.`;
    const summary = compactDescription(vehicleContext.highlights || vehicleContext.description || vehicleContext.specification, 500);
    return summary ? `The vehicle information lists: ${summary}` : null;
  }
  return null;
}

export function publicVehiclePricingReply({ message = "", pageType = "", productLock = "", vehicleContext = {}, rememberedFacts = {} } = {}) {
  if (!["finance", "rent2buy"].includes(productLock)) return null;
  const text = clean(message, 3000);
  const hasVehicle = hasCurrentVehicleContext(pageType, vehicleContext);

  if (hasVehicle && VEHICLE_OVERVIEW_QUESTION.test(text)) {
    const hasRichDetails = Boolean(clean(vehicleContext.description || vehicleContext.highlights || vehicleContext.specification || vehicleContext.title, 7000));
    if (hasRichDetails) return vehicleOverviewReply(productLock, vehicleContext);
  }

  const pricingQuestion = isSpecificVehiclePricingQuestion({ message: text, pageType, rememberedFacts });
  const termQuestion = productLock === "rent2buy" && RENT2BUY_TERM_QUESTION.test(text) && Boolean(clean(vehicleContext?.title || rememberedFacts.vehicle_interest || rememberedFacts.vehicle_type, 200));
  if (!pricingQuestion && !termQuestion) {
    if (hasVehicle && isVehicleSpecificationQuestion(text)) return attributeReply(text, vehicleContext) || vehicleSpecificationBoundaryReply(productLock);
    return null;
  }

  const pricing = normalisePublicVehiclePricing(vehicleContext?.pricing || {});
  const vehicleName = clean(vehicleContext?.title || rememberedFacts.vehicle_interest || rememberedFacts.vehicle_type, 200);
  const subject = vehicleName ? ` for the ${vehicleName}` : " for that specific van";

  if (productLock === "finance") {
    const monthly = displayPrice(pricing.finance_monthly);
    const retail = displayPrice(pricing.finance_retail_vat);
    const asksMonthly = MONTHLY_QUESTION.test(text);
    const asksRetail = RETAIL_PRICE_QUESTION.test(text) && !asksMonthly;
    if (pageType === "finance_vehicle") {
      if (asksMonthly && monthly) return `The current vehicle page shows Finance from ${monthly}${subject}. Please use the exact pricing and terms shown on this page when deciding whether to apply.`;
      if (asksRetail && retail) return `The current vehicle page shows a retail price of ${retail}${subject}. Please use the exact pricing shown on this page when deciding whether to apply.`;
      if (monthly && retail) return `The current vehicle page shows a retail price of ${retail} and Finance from ${monthly}${subject}. Please use the exact pricing and terms shown on this page when deciding whether to apply.`;
      if (monthly) return `The current vehicle page shows Finance from ${monthly}${subject}. Please use the exact pricing and terms shown on this page when deciding whether to apply.`;
      if (retail) return `The current vehicle page shows a retail price of ${retail}${subject}. Please use the exact pricing shown on this page when deciding whether to apply.`;
    }
    return "For the exact price or monthly Finance cost of a specific van, please check that vehicle’s pricing on the website. The figures vary by vehicle and the terms shown on its page, so I won’t guess or estimate an amount here.";
  }

  if (termQuestion) return null;
  const monthly = displayPrice(pricing.rent2buy_monthly);
  const initial = displayPrice(pricing.rent2buy_initial);
  const asksInitial = INITIAL_RENTAL_QUESTION.test(text);
  const asksMonthly = MONTHLY_QUESTION.test(text) && !asksInitial;
  if (asksInitial && initial) return `The current Rent2Buy vehicle page shows an initial rental of ${initial}${subject}.`;
  if (asksMonthly && monthly) return `The current Rent2Buy vehicle page shows monthly payments of ${monthly}${subject}.`;
  if (monthly && initial) return `The current Rent2Buy vehicle page shows an initial rental of ${initial} and monthly payments of ${monthly}${subject}.`;
  if (monthly) return `The current Rent2Buy vehicle page shows monthly payments of ${monthly}${subject}. Please check the vehicle page for the exact initial rental as well before applying.`;
  if (initial) return `The current Rent2Buy vehicle page shows an initial rental of ${initial}${subject}. Please check the vehicle page for the exact monthly payments as well before applying.`;
  return "For a specific Rent2Buy van, please check the vehicle listing on the website for the exact initial rental and monthly payments. Those figures vary by van, so I won’t invent or estimate them here.";
}
