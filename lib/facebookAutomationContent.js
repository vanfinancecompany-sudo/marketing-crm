function clean(value) {
  return String(value ?? "")
    .replace(/Â£/g, "£")
    .replace(/â€“/g, "–")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function registrationOf(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatMoneyNumber(value) {
  const match = clean(value).replace(/,/g, "").match(/[0-9]+(?:\.[0-9]+)?/);
  if (!match) return "";
  return Number(match[0]).toLocaleString("en-GB");
}

function formatMonthlyMth(value) {
  const amount = formatMoneyNumber(value);
  return amount
    ? `£${amount} MTH`
    : clean(value).replace(/\b(P\/M|PM|PER MONTH|MTH)\b/gi, "").trim();
}

function vehicleTitle(vehicle) {
  return clean(
    vehicle?.vanDescription ||
      vehicle?.description ||
      vehicle?.name ||
      vehicle?.title ||
      registrationOf(vehicle?.registration || vehicle?.reg),
  );
}

function vehicleSpec(vehicle) {
  return clean(vehicle?.vanSpec || vehicle?.spec || "");
}

function splitVehicleName(vehicle) {
  const registration = registrationOf(vehicle?.registration || vehicle?.reg || vehicle?.title);
  const raw = vehicleTitle(vehicle)
    .replace(registration ? new RegExp(registration, "i") : /$^/, "")
    .replace(/\bREGISTRATION\s*:?\s*[A-Z0-9 ]+/gi, "")
    .replace(/\bYEAR\s*:?\s*\d{4}/gi, "")
    .replace(/\bMILEAGE\s*:?\s*[0-9,.\s]+/gi, "")
    .replace(/\bEURO\s*:?\s*[0-9A-Z]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = raw.split(/\s+-\s+|\s{2,}/).map((part) => part.trim()).filter(Boolean);
  return {
    model: parts[0] || raw || vehicle?.name || "Van",
    variant: parts.slice(1).join(" ") || clean(vehicle?.variant || ""),
  };
}

function vehicleNameBlock(vehicle) {
  const { model, variant } = splitVehicleName(vehicle);
  return [model, variant].filter(Boolean).join("\n");
}

function extractSpecValue(vehicle, label) {
  const text = clean([
    vehicle?.year,
    vehicle?.euro,
    vehicle?.mileage,
    vehicle?.vanSpec,
    vehicle?.spec,
    vehicle?.vanDescription,
    vehicle?.description,
    vehicle?.title,
    vehicle?.name,
  ].filter(Boolean).join("\n"));

  if (label === "YEAR") {
    return String(vehicle?.year || text.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || "").trim();
  }
  if (label === "MILEAGE") {
    const explicit = text.match(/\bMILEAGE\s*:?\s*([0-9][0-9,.\s]*)/i)?.[1];
    const miles = text.match(/\b([0-9][0-9,.\s]*)\s*(?:MILES|MILEAGE)\b/i)?.[1];
    return clean(vehicle?.mileage || explicit || miles || "");
  }
  if (label === "EURO") {
    return clean(vehicle?.euro || text.match(/\bEURO\s*:?\s*([0-9A-Z]+)/i)?.[1] || "");
  }
  return "";
}

function vehicleSpecsBlock(vehicle) {
  const lines = [];
  const registration = registrationOf(vehicle?.registration || vehicle?.reg || vehicle?.title);
  const year = extractSpecValue(vehicle, "YEAR");
  const mileage = extractSpecValue(vehicle, "MILEAGE");
  const euro = extractSpecValue(vehicle, "EURO");
  const spec = vehicleSpec(vehicle);

  if (registration) lines.push(`REGISTRATION: ${registration}`);
  if (year) lines.push(`YEAR: ${year}`);
  if (mileage) lines.push(`MILEAGE: ${mileage}`);
  if (euro) lines.push(`EURO: ${euro}`);
  if (spec && !lines.some((line) => spec.includes(line))) lines.push(spec);
  return lines.join("\n");
}

function financePriceLine(vehicle) {
  const price = formatMoneyNumber(vehicle?.price || "");
  const monthly = formatMoneyNumber(vehicle?.salePrice || vehicle?.monthly || "");
  if (price && monthly) return `FROM £99 DEPOSIT - £${price} + VAT | FROM £${monthly} MTH`;
  if (price) return `FROM £99 DEPOSIT - £${price} + VAT | Finance monthly options available`;
  if (monthly) return `FROM £99 DEPOSIT | FROM £${monthly} MTH`;
  return "FROM £99 DEPOSIT | Finance monthly options available";
}

function rentTermLine(vehicle) {
  const term = clean(vehicle?.week || vehicle?.term || "").match(/\d+/)?.[0] || "36";
  return `Over x${term} months / initial rental charges apply.`;
}

function absoluteOrFallback(value, fallback, origin) {
  const url = clean(value);
  if (!url) return fallback;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${origin}${url}`;
  return fallback;
}

export function automatedVehicleUrl(vehicle, productKey) {
  if (productKey === "rent2buy") {
    return absoluteOrFallback(
      vehicle?.webLink || vehicle?.weblink || vehicle?.link,
      "https://www.rent2buyvans.co.uk/",
      "https://www.rent2buyvans.co.uk",
    );
  }
  return absoluteOrFallback(
    vehicle?.weblink || vehicle?.webLink || vehicle?.link,
    "https://www.vanfinancecompany.co.uk/",
    "https://www.vanfinancecompany.co.uk",
  );
}

export function buildAutomatedFacebookCaption(vehicle, productKey) {
  const url = automatedVehicleUrl(vehicle, productKey);

  if (productKey === "rent2buy") {
    return `NO CREDIT CHECK | ${formatMonthlyMth(vehicle?.monthly || "available")}

RENT IT! - DRIVE IT! - OWN IT!

${rentTermLine(vehicle)}

${vehicleNameBlock(vehicle)}

${vehicleSpecsBlock(vehicle)}

Get on the road fast - no hassle.

* No credit check
* Apply in 60 seconds
* Drive away fast
* Own your van from £99

Join 5,000+ drivers already driving today.

Apply now and get approved today.
JUST £99 FINAL PAYMENT.
IT'S YOURS!

${url}`.replace(/\n{3,}/g, "\n\n").trim();
  }

  return `${financePriceLine(vehicle)}

VAN FINANCE COMPANY | £99 DEPOSIT OPTIONS

${vehicleNameBlock(vehicle)}

${vehicleSpecsBlock(vehicle)}

Van finance from just £99 deposit.
Get your next van without tying up your cash.

* Finance the VAT
* £99 deposit options
* 200+ vans in stock
* Free UK delivery

All credit profiles considered - been declined elsewhere? We can help.
Built for businesses, sole traders and individuals who want to keep cash flow strong.

Apply now - takes 60 seconds.

FAST, SIMPLE APPLICATION, APPROVED IN JUST 60 MINUTES – APPLY TODAY

${url}`.replace(/\n{3,}/g, "\n\n").trim();
}

export function buildAutomatedReelCaption({ productKey, vehicle, registration, title }) {
  const source = vehicle || {
    registration,
    reg: registration,
    title,
    name: title,
    vanDescription: title,
  };
  return buildAutomatedFacebookCaption(source, productKey);
}

const FRAME_PACKS = {
  vanFinance: [
    [
      { headline: "FROM £99 DEPOSIT", support: "VAN FINANCE COMPANY" }, {}, {},
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "APPROVED IN 60 MINUTES", support: "FAST ONLINE APPLICATION" },
      { headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING" },
      { headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED" },
      { headline: "SELF-EMPLOYED WELCOME", support: "FLEXIBLE VAN FINANCE" },
      { headline: "200+ VANS AVAILABLE", support: "READY TO GO" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "FAST VAN FINANCE", support: "APPROVED IN 60 MINUTES" }, {}, {},
      { headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED" },
      { headline: "FROM £99 DEPOSIT", support: "LOW DEPOSIT OPTIONS" },
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "SELF-EMPLOYED WELCOME", support: "FLEXIBLE FINANCE OPTIONS" },
      { headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING" },
      { headline: "200+ VANS AVAILABLE", support: "CHOOSE YOUR NEXT VAN" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "FINANCE YOUR NEXT WORK VAN", support: "KEEP YOUR CASH FLOW MOVING" }, {}, {},
      { headline: "FINANCE THE VAT", support: "BUSINESS-FRIENDLY VAN FINANCE" },
      { headline: "SELF-EMPLOYED WELCOME", support: "FLEXIBLE FINANCE OPTIONS" },
      { headline: "FROM £99 DEPOSIT", support: "LOW DEPOSIT OPTIONS" },
      { headline: "APPROVED IN 60 MINUTES", support: "FAST ONLINE APPLICATION" },
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "200+ VANS AVAILABLE", support: "READY TO GO" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "YOUR NEXT VAN IS HERE", support: "200+ VANS AVAILABLE" }, {}, {},
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "FROM £99 DEPOSIT", support: "LOW DEPOSIT OPTIONS" },
      { headline: "APPROVED IN 60 MINUTES", support: "FAST ONLINE APPLICATION" },
      { headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED" },
      { headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING" },
      { headline: "VANS READY TO GO", support: "CHOOSE YOUR NEXT VAN TODAY" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
  ],
  rent2buy: [
    [
      { headline: "NO CREDIT CHECK VANS", support: "RENT IT - DRIVE IT - OWN IT" }, {}, {},
      { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE CHECK" },
      { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
      { headline: "VANS READY TO GO", support: "PICKUPS, LUTONS AND PANEL VANS" },
      { headline: "NO CREDIT CHECK", support: "CHECK IF YOU QUALIFY" },
      { headline: "DRIVE IT, THEN OWN IT", support: "FLEXIBLE RENT2BUY" },
      { headline: "GET BACK TO WORK FAST", support: "CHOOSE YOUR VAN TODAY" },
      { headline: "CHECK IF YOU QUALIFY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "DRIVE IT, THEN OWN IT", support: "RENT2BUY VANS" }, {}, {},
      { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
      { headline: "NO CREDIT CHECK", support: "SIMPLE QUALIFYING CHECK" },
      { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE APPLICATION" },
      { headline: "FLEXIBLE RENT2BUY", support: "RENT IT - DRIVE IT - OWN IT" },
      { headline: "VANS READY TO GO", support: "PICK YOUR NEXT VAN" },
      { headline: "CHECK IF YOU QUALIFY", support: "START ONLINE TODAY" },
      { headline: "APPLY TODAY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "GET BACK ON THE ROAD", support: "APPLY IN 60 SECONDS" }, {}, {},
      { headline: "NO CREDIT CHECK", support: "FAST ONLINE CHECK" },
      { headline: "CHECK IF YOU QUALIFY", support: "SIMPLE ONLINE APPLICATION" },
      { headline: "VANS READY TO GO", support: "CHOOSE YOUR VEHICLE TODAY" },
      { headline: "RENT IT - DRIVE IT - OWN IT", support: "FLEXIBLE RENT2BUY" },
      { headline: "FINAL PAYMENT IT'S YOURS", support: "WORK TOWARDS OWNERSHIP" },
      { headline: "FAST ONLINE APPLICATION", support: "GET STARTED TODAY" },
      { headline: "CHECK IF YOU QUALIFY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "YOUR NEXT VAN IS READY", support: "FLEXIBLE RENT2BUY OPTIONS" }, {}, {},
      { headline: "NO CREDIT CHECK VANS", support: "SIMPLE QUALIFYING CHECK" },
      { headline: "VANS READY TO GO", support: "PANEL VANS, LUTONS AND PICKUPS" },
      { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE APPLICATION" },
      { headline: "DRIVE IT, THEN OWN IT", support: "RENT IT - DRIVE IT - OWN IT" },
      { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
      { headline: "CHECK IF YOU QUALIFY", support: "START ONLINE TODAY" },
      { headline: "APPLY TODAY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
    ],
  ],
};

export function automatedReelFrameSpecs(productKey, index = 0) {
  const packs = FRAME_PACKS[productKey] || FRAME_PACKS.vanFinance;
  const selected = packs[Math.abs(Number(index) || 0) % packs.length];
  return Array.from({ length: 10 }, (_, frameIndex) => ({ ...(selected[frameIndex] || {}) }));
}
