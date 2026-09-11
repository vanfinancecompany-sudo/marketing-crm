import {
  calculateFivePercentFlatMonthly,
  formatRetailPrice,
  normalizeFinanceRegistration,
  parseRetailPrice,
} from "./vanscoWixPrice.js";

const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function displayRegistration(value) {
  const registration = normalizeFinanceRegistration(value || "");
  return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(registration)
    ? `${registration.slice(0, 4)} ${registration.slice(4)}`
    : registration;
}

function displayYear(vehicle = {}, registration = "") {
  const year = finite(vehicle.year);
  if (year === null) return "";
  const match = normalizeFinanceRegistration(registration).match(/^[A-Z]{2}(\d{2})[A-Z]{3}$/);
  return match ? `${Math.trunc(year)}/${match[1]}` : String(Math.trunc(year));
}

function displayMileage(value) {
  const mileage = finite(value);
  return mileage === null ? "" : Math.round(mileage).toLocaleString("en-GB");
}

function normaliseLabel(value) {
  return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function technicalValue(vehicle = {}, labels = []) {
  const wanted = labels.map(normaliseLabel).filter(Boolean);
  for (const item of Array.isArray(vehicle.specifications?.technical) ? vehicle.specifications.technical : []) {
    const label = normaliseLabel(item?.name || item?.label || item?.title);
    if (!label || !wanted.some((value) => label === value || label.startsWith(`${value} `))) continue;
    const value = clean(item?.value ?? item?.text ?? item?.content, 300);
    if (value) return value;
  }
  return "";
}

function euroValue(vehicle = {}) {
  let value = technicalValue(vehicle, ["Euro Status", "Euro", "Emission Standard", "Emissions Standard", "Euro Emissions"]);
  if (!value) value = [vehicle.title, vehicle.derivative].filter(Boolean).join(" ").match(/\bEuro\s*([4567](?:[a-z])?)\b/i)?.[1] || "";
  const match = clean(value, 60).match(/([4567](?:[a-z])?)/i);
  return match ? match[1].toUpperCase() : clean(value, 60).replace(/^EURO\s*/i, "").toUpperCase();
}

function mpgValue(vehicle = {}) {
  return technicalValue(vehicle, ["Combined MPG", "MPG Combined", "Fuel Consumption Combined"]).replace(/\s*mpg$/i, "").trim();
}

function engineValue(vehicle = {}) {
  const raw = technicalValue(vehicle, ["Engine Size", "Engine Capacity", "Engine CC"]);
  if (!raw) return "";
  const number = finite(String(raw).replace(/[^0-9.]/g, ""));
  if (number !== null && number >= 500) return `${(number / 1000).toFixed(1)}`;
  return clean(raw, 80).replace(/\s*cc$/i, "");
}

function topSpeedValue(vehicle = {}) {
  return technicalValue(vehicle, ["Top Speed", "Maximum Speed"]);
}

function accelerationValue(vehicle = {}) {
  return technicalValue(vehicle, ["0-62mph", "0 - 62 mph", "0-62 mph", "Acceleration 0-62", "0 to 62 mph"]);
}

function featureText(item) {
  if (!item) return "";
  if (typeof item === "string") return clean(item, 500);
  const name = clean(item.name || item.label || item.title, 500);
  const value = clean(item.value, 500);
  if (!name) return value;
  if (!value || /^(yes|included|standard)$/i.test(value)) return name;
  return `${name}: ${value}`;
}

function allFeatures(vehicle = {}) {
  const result = [];
  for (const group of [vehicle.specifications?.options, vehicle.specifications?.standard]) {
    for (const item of Array.isArray(group) ? group : []) {
      const text = featureText(item);
      if (text && !result.includes(text)) result.push(text);
    }
  }
  return result;
}

const SECTION_RULES = Object.freeze([
  ["safetyAndSecurity", /\b(?:airbag|abs\b|alarm|immobil|isofix|stability|traction|seat ?belt|child lock|collision|emergency|brake assist|hill hold|security|central lock)/i],
  ["illumination", /\b(?:headlight|headlamp|fog light|daytime running|rear light|tail light|lighting|led\b|xenon|high beam|low beam)/i],
  ["audioAndCommunications", /\b(?:bluetooth|dab\b|radio|audio|speaker|stereo|usb\b|aux\b|carplay|android auto|navigation|sat nav|media|telephone|touchscreen)/i],
  ["driversAssistance", /\b(?:cruise|parking|camera|sensor|lane|driver assist|traffic|speed limiter|tpms|tyre pressure|trip computer|blind spot|attention|drive mode)/i],
  ["exterior", /\b(?:alloy|wheel|mirror|window|roof rail|roof rack|bumper|privacy glass|tinted|exhaust|spoiler|door handle|windscreen|tyre repair)/i],
  ["performance", /\b(?:suspension|power steering|steering assistance|charging cable|limited slip|four wheel drive|4wd|awd)/i],
]);

function featureSections(vehicle = {}) {
  const sections = {
    audioAndCommunications: [], driversAssistance: [], exterior: [], illumination: [], interior: [], performance: [], safetyAndSecurity: [],
  };
  for (const feature of allFeatures(vehicle)) {
    const rule = SECTION_RULES.find(([, pattern]) => pattern.test(feature));
    (sections[rule?.[0] || "interior"]).push(feature);
  }
  return Object.fromEntries(Object.entries(sections).map(([key, values]) => [key, values.join("\n")]));
}

function headline(vehicle = {}) {
  const descriptionLead = clean(vehicle.description, 1200).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const identity = [vehicle.make, vehicle.model].map((value) => clean(value, 120)).filter(Boolean).join(" ");
  if (descriptionLead && descriptionLead.length <= 140 && identity && descriptionLead.toLowerCase().startsWith(identity.toLowerCase()) && !/[.!?]$/.test(descriptionLead)) return descriptionLead;
  return clean(vehicle.title, 700) || [vehicle.make, vehicle.model, vehicle.derivative].map((value) => clean(value, 250)).filter(Boolean).join(" ");
}

function listingSpec(vehicle = {}, registration = "") {
  return [
    ["REGISTRATION", displayRegistration(registration)],
    ["YEAR", displayYear(vehicle, registration)],
    ["MILEAGE", displayMileage(vehicle.mileage)],
    ["EURO", euroValue(vehicle)],
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n") + "\n________________________";
}

function detailSpec(vehicle = {}, registration = "") {
  const bhp = finite(vehicle.bhp);
  return [
    ["REGISTRATION", displayRegistration(registration)],
    ["YEAR", displayYear(vehicle, registration)],
    ["MILEAGE", displayMileage(vehicle.mileage)],
    ["EURO", euroValue(vehicle)],
    ["ENGINE SIZE", engineValue(vehicle)],
    ["FUEL TYPE", clean(vehicle.fuel, 120).toUpperCase()],
    ["COLOUR", clean(vehicle.colour, 160).toUpperCase()],
    ["TRANSMISSION", clean(vehicle.transmission, 120).toUpperCase().replace("AUTOMATIC", "AUTO")],
    ["BHP", bhp !== null && bhp > 0 ? String(Math.round(bhp)) : ""],
    ["MPG", mpgValue(vehicle)],
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n") + "\n";
}

function keyVehicleInformation(vehicle = {}) {
  const engine = technicalValue(vehicle, ["Engine Size", "Engine Capacity", "Engine CC"]);
  const topSpeed = topSpeedValue(vehicle);
  const acceleration = accelerationValue(vehicle);
  const bhp = finite(vehicle.bhp);
  return [
    engine ? `Engine Size\n${engine}` : "",
    topSpeed ? `Top Speed\n${topSpeed}` : "",
    acceleration ? `0-62mph\n${acceleration}` : "",
    bhp !== null && bhp > 0 ? `Power\n${Math.round(bhp)} bhp` : "",
  ].filter(Boolean).join("\n");
}

export function buildDealerKitCarWixPlan({ vehicle = {}, decision = {}, imageSet = {}, carListingRows = [], carDetailRows = [] } = {}) {
  const registration = normalizeFinanceRegistration(vehicle.registration || decision.registration || "");
  const retailPrice = parseRetailPrice(vehicle.retailPrice);
  const monthlyPrice = calculateFivePercentFlatMonthly(retailPrice);
  const blockers = [];

  if (!registration) blockers.push({ code: "missing_registration", message: "A valid registration is required for Cars publishing." });
  if (!decision.persisted || decision.reviewStatus !== "reviewed") blockers.push({ code: "review_not_approved", message: "Save the Cars review before publishing." });
  if (vehicle.sourceUpdatedAt && decision.reviewedSourceUpdatedAt && new Date(vehicle.sourceUpdatedAt).getTime() !== new Date(decision.reviewedSourceUpdatedAt).getTime()) blockers.push({ code: "stale_review", message: "DealerKit changed after the saved Cars review. Re-save the review first." });
  if (retailPrice === null || monthlyPrice === null) blockers.push({ code: "invalid_retail", message: "A valid DealerKit retail price is required." });
  if (!["available", "in_stock", "due_in"].includes(clean(vehicle.status || vehicle.sourceStatus, 100).toLowerCase().replace(/[\s-]+/g, "_"))) blockers.push({ code: "source_status", message: "DealerKit no longer shows this car as available for advertising." });
  if (!imageSet.ready || !imageSet.mainUrl || !imageSet.galleryUrls?.length) blockers.push({ code: "car_media_not_ready", message: "The reviewed Cars images must be READY in Wix Media before publishing." });
  if ((carListingRows || []).length) blockers.push({ code: "car_already_listed", message: `CARFINANCE already contains ${(carListingRows || []).length} published listing row(s) for ${registration}.` });
  if ((carDetailRows || []).length > 1) blockers.push({ code: "car_detail_ambiguous", message: `CARPAGES contains ${(carDetailRows || []).length} published historical rows for ${registration}. Resolve the duplicate detail pages before publishing.` });

  const sections = featureSections(vehicle);
  const description = clean(vehicle.description, 10000) || headline(vehicle);
  const targets = [];
  if (registration && retailPrice !== null && monthlyPrice !== null && imageSet.mainUrl) {
    targets.push({
      product: "cars", collectionId: "CARFINANCE", kind: "listing", operation: "create",
      data: {
        title: registration,
        picture: imageSet.mainUrl,
        price: formatRetailPrice(retailPrice),
        salePrice: `FROM £${monthlyPrice} P/M`,
        vanDescription: headline(vehicle),
        vanSpec: listingSpec(vehicle, registration),
        webLink: `https://www.vanfinancecompany.co.uk/van-finance/${registration}`,
        buttonText: "VIEW CAR",
        applicationForm: `https://www.vanfinancecompany.co.uk/apply-by-reg-finance/${registration}`,
      },
    });
  }
  if (registration && retailPrice !== null && monthlyPrice !== null && imageSet.galleryUrls?.length) {
    const existing = (carDetailRows || [])[0] || null;
    const detail = {
      product: "cars", collectionId: "CARPAGES", kind: "detail",
      operation: existing?.id ? "update" : "create",
      ...(existing?.id ? { itemId: existing.id, previousData: existing.data || {} } : {}),
      data: {
        title: registration,
        titleText: headline(vehicle),
        priceVat: formatRetailPrice(retailPrice),
        year: displayYear(vehicle, registration),
        vanFinanceTitle: description,
        mainImages: imageSet.galleryUrls,
        backLink: "https://www.vanfinancecompany.co.uk/cars",
        descriptionLine: detailSpec(vehicle, registration),
        vehicleDescriptionTextClick: description,
        vehicleSpecificationText: allFeatures(vehicle).join("\n"),
        applyLink: `https://www.vanfinancecompany.co.uk/apply-by-reg-finance/${registration}`,
        audioAndCommunications: [keyVehicleInformation(vehicle), sections.audioAndCommunications].filter(Boolean).join("\n\n"),
        driversAssistance: sections.driversAssistance,
        exterior: sections.exterior,
        illumination: sections.illumination,
        interior: sections.interior,
        performance: sections.performance,
        safetyAndSecurity: sections.safetyAndSecurity,
        salePrice: `£${monthlyPrice}`,
        numberOfImages: String(imageSet.galleryUrls.length),
      },
    };
    targets.push(detail);
  }

  return {
    version: 1,
    mode: "cars",
    registration,
    retailPrice,
    monthlyPrice,
    imageSets: { cars: imageSet },
    targets,
    blockers,
    canPublish: blockers.length === 0 && targets.some((target) => target.collectionId === "CARFINANCE") && targets.some((target) => target.collectionId === "CARPAGES"),
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, stable(nested)]));
  return value;
}

export function buildCarPublishConfirmation(plan = {}) {
  return {
    version: plan.version || 1,
    mode: "cars",
    registration: plan.registration,
    targetPayloads: (plan.targets || []).map((target) => ({
      collectionId: target.collectionId,
      kind: target.kind,
      operation: target.operation || "create",
      itemId: target.itemId || null,
      data: stable(target.data || {}),
    })).sort((a, b) => a.collectionId.localeCompare(b.collectionId)),
    carMainImage: clean(plan.imageSets?.cars?.mainUrl, 3000) || null,
    dealerKitImageIds: [...(plan.imageSets?.cars?.dealerKitImageIds || [])].sort(),
    retailPrice: plan.retailPrice,
    monthlyPrice: plan.monthlyPrice,
  };
}

export function carPublishConfirmationMatches(confirmation, plan) {
  return Boolean(confirmation && JSON.stringify(confirmation) === JSON.stringify(buildCarPublishConfirmation(plan)));
}
