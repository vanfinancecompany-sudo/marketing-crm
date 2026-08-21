function clean(value) {
  return String(value ?? "")
    .replace(/Â£/g, "£")
    .replace(/â€“/g, "–")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function registrationOf(vehicle) {
  const text = clean(vehicle?.registration || vehicle?.reg || vehicle?.title || vehicle?.name).toUpperCase();
  const match = text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);
  return String(match?.[1] || text).replace(/[^A-Z0-9]/g, "");
}

function titleOf(vehicle) {
  return clean(vehicle?.vanDescription || vehicle?.description || vehicle?.name || vehicle?.title || registrationOf(vehicle));
}

function specText(vehicle) {
  return clean(vehicle?.vanSpec || vehicle?.spec || "");
}

function money(value) {
  const text = clean(value).replace(/,/g, "");
  const match = text.match(/[0-9]+(?:\.[0-9]+)?/);
  if (!match) return "";
  return `£${Number(match[0]).toLocaleString("en-GB")}`;
}

function financePriceLine(vehicle) {
  const price = money(vehicle?.price);
  const monthly = money(vehicle?.salePrice || vehicle?.monthly);
  if (price && monthly) return `FROM £99 DEPOSIT - ${price} + VAT | FROM ${monthly} MTH`;
  if (price) return `FROM £99 DEPOSIT - ${price} + VAT | Finance monthly options available`;
  if (monthly) return `FROM £99 DEPOSIT | FROM ${monthly} MTH`;
  return "FROM £99 DEPOSIT | Finance monthly options available";
}

function rentPriceLine(vehicle) {
  const monthly = clean(vehicle?.monthly);
  const initial = clean(vehicle?.initialRental || vehicle?.price);
  return [monthly, initial].filter(Boolean).join(" | ") || "Rent2Buy available";
}

function extractSpecValue(vehicle, label) {
  const source = [vehicle?.year, vehicle?.mileage, vehicle?.euro, vehicle?.vanSpec, vehicle?.spec, vehicle?.vanDescription, vehicle?.description]
    .filter(Boolean)
    .join("\n");
  if (label === "YEAR") return clean(vehicle?.year || source.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || "");
  if (label === "MILEAGE") return clean(vehicle?.mileage || source.match(/\bMILEAGE\s*:?\s*([0-9][0-9,.\s]*)/i)?.[1] || source.match(/\b([0-9][0-9,.\s]*)\s*MILES\b/i)?.[1] || "");
  if (label === "EURO") return clean(vehicle?.euro || source.match(/\bEURO\s*:?\s*([0-9A-Z]+)/i)?.[1] || "");
  return "";
}

function vehicleDetails(vehicle) {
  const lines = [titleOf(vehicle)];
  const registration = registrationOf(vehicle);
  const year = extractSpecValue(vehicle, "YEAR");
  const mileage = extractSpecValue(vehicle, "MILEAGE");
  const euro = extractSpecValue(vehicle, "EURO");
  if (registration) lines.push(`REGISTRATION: ${registration}`);
  if (year) lines.push(`YEAR: ${year}`);
  if (mileage) lines.push(`MILEAGE: ${mileage}`);
  if (euro) lines.push(`EURO: ${euro}`);
  const spec = specText(vehicle);
  if (spec && !lines.some((line) => line === spec)) lines.push(spec);
  return [...new Set(lines.filter(Boolean))].join("\n");
}

export function facebookHomepage(productKey) {
  return productKey === "rent2buy"
    ? "https://www.rent2buyvans.co.uk/"
    : "https://www.vanfinancecompany.co.uk/";
}

export function buildDefaultFacebookPostCaption(vehicle, productKey, { url, index = 0 } = {}) {
  const finalUrl = clean(url) || facebookHomepage(productKey);
  if (productKey === "rent2buy") {
    const term = clean(vehicle?.week || vehicle?.term).match(/\d+/)?.[0] || "36";
    return clean(`NO CREDIT CHECK | ${clean(vehicle?.monthly) || "Monthly options available"}

RENT IT! - DRIVE IT! - OWN IT!

${rentPriceLine(vehicle)}

Over x${term} months / initial rental charges apply.

${vehicleDetails(vehicle)}

Get on the road fast - no hassle.

* No credit check
* Apply in 60 seconds
* Drive away fast
* Own your van from £99

Join 5,000+ drivers already driving today.

Apply now and get approved today.
JUST £99 FINAL PAYMENT.
IT'S YOURS!

${finalUrl}`);
  }

  const hooks = ["£99 DEPOSIT OPTIONS", "BAD CREDIT CONSIDERED", "SELF-EMPLOYED WELCOME", "FINANCE THE VAT"];
  const hook = hooks[Math.abs(Number(index) || 0) % hooks.length];
  return clean(`${financePriceLine(vehicle)}

VAN FINANCE COMPANY | ${hook}

${vehicleDetails(vehicle)}

Van finance from just £99 deposit.
Get your next van without tying up your cash.

* Finance the VAT
* £99 deposit options
* 200+ vans in stock
* Free UK delivery

All credit profiles considered - been declined elsewhere? We can help.
Built for businesses, sole traders and individuals who want to keep cash flow strong.

Apply now - takes 60 seconds.

FAST, SIMPLE APPLICATION, APPROVED IN JUST 60 MINUTES - APPLY TODAY

${finalUrl}`);
}

export function buildDefaultReelCaption(vehicle, productKey, { url, hook = "" } = {}) {
  const finalUrl = clean(url);
  if (!finalUrl) throw new Error("A live vehicle page URL is required for an automated Reel.");
  const title = titleOf(vehicle);
  const registration = registrationOf(vehicle);
  if (productKey === "rent2buy") {
    const term = clean(vehicle?.week || vehicle?.term).match(/\d+/)?.[0];
    return clean(`${clean(hook) || "RENT IT - DRIVE IT - OWN IT"}

${title}
REGISTRATION: ${registration}
${rentPriceLine(vehicle)}${term ? `\nOver x${term} months / initial rental charges apply.` : ""}

Rent2Buy this van | No credit checks | Own the van at the end

APPLY TODAY
${finalUrl}`);
  }
  return clean(`${clean(hook) || "VAN FINANCE"}

${title}
REGISTRATION: ${registration}
${financePriceLine(vehicle)}

Low deposit options | Bad credit considered | Self-employed welcome

APPLY NOW
${finalUrl}`);
}
