const PLACEHOLDER_CAR_TEXT_PATTERNS = [
  /\bcar title here\b/i,
  /\breg\d+here\b/i,
  /\bregistration here\b/i,
  /\bexample\b/i,
  /\bplaceholder\b/i,
];

export function convertWixImage(url) {
  if (!url) return "";

  const value = String(url).trim();
  if (!value) return "";

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const match = value.match(/wix:image:\/\/v1\/([^/]+)/);
  if (!match) return value;

  return `https://static.wixstatic.com/media/${match[1]}`;
}

export function extractRegistration(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";

  const ukRegMatch = text.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/
  );

  return ukRegMatch ? ukRegMatch[1].replace(/\s+/g, " ").trim() : "";
}

export function valueOrFallback(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

export function normalizeRegistrationKey(value) {
  return extractRegistration(value).replace(/\s+/g, "").toUpperCase();
}

export function isActiveMarketingRow(row) {
  if (row?.is_active === false) return false;
  if (row?.active === false) return false;
  if (String(row?.status || "").toLowerCase() === "inactive") return false;
  if (String(row?.archived || "").toLowerCase() === "true") return false;
  if (String(row?.hidden || "").toLowerCase() === "true") return false;
  return true;
}

function normalizeRegistrationForValidation(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isLikelyRealRegistration(value) {
  const rawValue = String(value || "");
  if (PLACEHOLDER_CAR_TEXT_PATTERNS.some((pattern) => pattern.test(rawValue))) return false;

  const registration = normalizeRegistrationForValidation(extractRegistration(value) || value);
  if (!registration || registration.length < 5 || registration.length > 8) return false;
  if (PLACEHOLDER_CAR_TEXT_PATTERNS.some((pattern) => pattern.test(registration))) return false;

  return (
    /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(registration) ||
    /^[A-Z][0-9]{1,3}[A-Z]{3}$/.test(registration) ||
    /^[A-Z]{3}[0-9]{1,3}[A-Z]$/.test(registration) ||
    /^[0-9]{1,4}[A-Z]{1,3}$/.test(registration)
  );
}

function isPlaceholderCarRow(row) {
  const text = [
    row?.title,
    row?.name,
    row?.vehicle,
    row?.make_model,
    row?.description,
    row?.registration,
    row?.reg,
    row?.vehicle_reg,
    row?.number_plate,
  ]
    .filter(Boolean)
    .join(" ");

  return PLACEHOLDER_CAR_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

export function isUsableCarRow(row) {
  if (!isActiveMarketingRow(row)) return false;
  if (isPlaceholderCarRow(row)) return false;

  const registration = valueOrFallback(row.registration, row.reg, row.vehicle_reg, row.number_plate, extractRegistration(row.title || row.name || row.vehicle || ""));
  const imageUrl = convertWixImage(row.picture || row.image || row.image_url || row.imageUrl);

  return isLikelyRealRegistration(registration) && Boolean(imageUrl);
}

export function getPrimaryVehicleImage(vehicle) {
  return valueOrFallback(
    vehicle?.image,
    vehicle?.picture,
    vehicle?.photo,
    vehicle?.mainImage,
    vehicle?.imageUrl,
    vehicle?.image_url
  );
}

function uniqueImages(values) {
  const seen = new Set();
  return values
    .map(convertWixImage)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function mapFinanceVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture);
  const title = valueOrFallback(row.title, `finance-${index + 1}`);

  return {
    id: row.id || title || `finance-${index}`,
    title,
    name: title,
    // Protected legacy behaviour: Finance registration is extracted from title only.
    reg: extractRegistration(title),
    picture: imageUrl,
    image: imageUrl,
    price: row.price || "",
    vat: row.vat || "",
    monthly: row.salePrice || "",
    salePrice: row.salePrice || "",
    vanDescription: row.vanDescription || "",
    description: row.vanDescription || "",
    vanSpec: row.vanSpec || "",
    spec: row.vanSpec || "",
    weblink: row.weblink || "",
    link: row.weblink || "",
    pipeline: "vanFinance",
    vehicleType: "van",
    originalPipeline: "vanFinance",
    source: "vanFinance",
    rent2buyEligible: false,
    rent2buyData: null,
    createdAt: row.created_at || row.createdAt || "",
    importedAt: row.imported_at || row.importedAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

export function mapRentVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture);
  const registration = valueOrFallback(row.registration, `rent-${index + 1}`);

  return {
    id: row.id || registration || `rent-${index}`,
    title: registration,
    name: registration,
    reg: registration,
    picture: imageUrl,
    image: imageUrl,
    price: row.initialRental || "",
    monthly: row.monthly || "",
    week: row.week || "",
    initialRental: row.initialRental || "",
    vanDescription: row.vanDescription || "",
    description: row.vanDescription || "",
    vanSpec: row.vanSpec || "",
    spec: row.vanSpec || "",
    weblink: row.webLink || "",
    link: row.webLink || "",
    pipeline: "rent2buy",
    createdAt: row.created_at || row.createdAt || "",
    importedAt: row.imported_at || row.importedAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

export function mapCarVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture || row.image || row.image_url || row.imageUrl);
  const title = valueOrFallback(row.title, row.name, row.vehicle, row.make_model, row.description, `car-${index + 1}`);
  const registration = valueOrFallback(row.registration, row.reg, row.vehicle_reg, row.number_plate, extractRegistration(title));
  const cashPrice = valueOrFallback(
    row.price,
    row.cashPrice,
    row.cash_price,
    row.vehiclePrice,
    row.vehicle_price,
    row.salePrice,
    row.saleprice,
    row.sale_price,
    row.priceText,
    row.price_text
  );
  const monthlyPrice = valueOrFallback(
    row.monthly,
    row.financeMonthly,
    row.finance_monthly,
    row.monthlyPrice,
    row.monthly_price,
    row.payment,
    row.paymentText,
    row.payment_text
  );

  return {
    id: row.id || registration || title || `car-${index}`,
    title,
    name: title,
    reg: registration,
    registration,
    picture: imageUrl,
    image: imageUrl,
    price: cashPrice,
    monthly: monthlyPrice,
    salePrice: valueOrFallback(row.salePrice, row.saleprice, row.sale_price, monthlyPrice, cashPrice),
    description: row.description || row.carDescription || row.vanDescription || "",
    spec: row.spec || row.carSpec || row.vanSpec || "",
    weblink: row.weblink || row.webLink || row.link || "",
    link: row.weblink || row.webLink || row.link || "",
    pipeline: "cars",
    createdAt: row.created_at || row.createdAt || "",
    importedAt: row.imported_at || row.importedAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

export function composeFinanceVehicleWithRent2Buy(vehicle, rentMatch) {
  return {
    ...vehicle,
    pipeline: vehicle.pipeline,
    vehicleType: vehicle.vehicleType || "van",
    originalPipeline: "vanFinance",
    rent2buyEligible: Boolean(rentMatch),
    rent2buyData: rentMatch,
  };
}

function financeProfileForVehicle(vehicle) {
  const eligible = vehicle?.pipeline === "vanFinance" || vehicle?.originalPipeline === "vanFinance";

  return {
    eligible,
    price: eligible ? vehicle?.price || "" : "",
    vat: eligible ? vehicle?.vat || "" : "",
    monthly: eligible ? valueOrFallback(vehicle?.salePrice, vehicle?.monthly) : "",
    url: eligible ? valueOrFallback(vehicle?.weblink, vehicle?.link) : "",
  };
}

function rentProfileForVehicle(vehicle) {
  const rentData = vehicle?.rent2buyData || (vehicle?.pipeline === "rent2buy" ? vehicle : null);
  const eligible = Boolean(vehicle?.rent2buyEligible || vehicle?.pipeline === "rent2buy");

  return {
    eligible,
    monthly: eligible ? rentData?.monthly || "" : "",
    initialRental: eligible ? valueOrFallback(rentData?.initialRental, rentData?.price) : "",
    term: eligible ? valueOrFallback(rentData?.week, rentData?.term) : "",
    url: eligible ? valueOrFallback(rentData?.weblink, rentData?.webLink, rentData?.link) : "",
  };
}

export function toMarketingVehicleSelectionContract(vehicle) {
  const registration = valueOrFallback(
    vehicle?.registration,
    vehicle?.reg,
    extractRegistration(vehicle?.title || vehicle?.name || "")
  );
  const title = valueOrFallback(vehicle?.title, vehicle?.name, registration);
  const primaryImageUrl = getPrimaryVehicleImage(vehicle);
  const rentData = vehicle?.rent2buyData || null;

  return {
    id: String(vehicle?.id || registration || title || ""),
    registration,
    title,
    description: valueOrFallback(vehicle?.vanDescription, vehicle?.description),
    spec: valueOrFallback(vehicle?.vanSpec, vehicle?.spec),
    primaryImageUrl,
    images: uniqueImages([primaryImageUrl]),
    finance: financeProfileForVehicle(vehicle),
    rent2buy: rentProfileForVehicle(vehicle),
    source: {
      financeRowId: vehicle?.originalPipeline === "vanFinance" || vehicle?.pipeline === "vanFinance" ? String(vehicle?.financeId || vehicle?.id || "") : "",
      rentRowId: rentData?.id ? String(rentData.id) : vehicle?.pipeline === "rent2buy" ? String(vehicle?.id || "") : "",
      sourceType: vehicle?.pipeline || vehicle?.source || "",
    },
  };
}
