import { fetchDealerKitStockSnapshot, fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import {
  defaultDealerKitReviewDecision,
  loadDealerKitReviewDecision,
} from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;

function clean(value, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isAuthorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function localRegistration(value) {
  const text = clean(value, 1000).toUpperCase();
  const direct = normalizeRegistration(text);
  if (direct) return direct;
  const match = text.match(REGISTRATION_PATTERN);
  return normalizeRegistration(match?.[1] || "");
}

async function loadLocalMatches(supabase, registration) {
  const [financeResult, rentResult] = await Promise.all([
    supabase
      .from("facebook_adverts")
      .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
      .eq("is_active", true)
      .limit(1000),
    supabase
      .from("rent_vehicles")
      .select("id,registration,picture,monthly,week,initialRental,vanDescription,vanSpec,webLink,is_active")
      .eq("is_active", true)
      .limit(1000),
  ]);

  if (financeResult.error) throw new Error(`Finance stock read failed: ${financeResult.error.message || financeResult.error}`);
  if (rentResult.error) throw new Error(`Rent2Buy stock read failed: ${rentResult.error.message || rentResult.error}`);

  const finance = (financeResult.data || []).find((row) => localRegistration(row?.title || row?.registration || "") === registration) || null;
  const rent2buy = (rentResult.data || []).find((row) => localRegistration(row?.registration || row?.title || "") === registration) || null;
  return { finance, rent2buy };
}

function boundedSpecs(items, limit = 120) {
  return (Array.isArray(items) ? items : []).slice(0, limit).map((item) => ({
    name: clean(item?.name || item?.label || item?.title, 300),
    value: clean(item?.value || item?.description || item?.text, 1000),
  })).filter((item) => item.name || item.value);
}

function publicVehicle(vehicle) {
  return {
    supplierStockId: clean(vehicle?.supplierStockId, 300),
    registration: clean(vehicle?.registration, 20),
    title: clean(vehicle?.title, 700),
    make: clean(vehicle?.make, 200),
    model: clean(vehicle?.model, 300),
    derivative: clean(vehicle?.derivative, 900),
    trim: clean(vehicle?.trim, 300),
    bodyType: clean(vehicle?.bodyType, 300),
    vehicleType: clean(vehicle?.vehicleType, 100),
    sourceStatus: clean(vehicle?.sourceStatus, 100),
    status: clean(vehicle?.status, 100),
    retailPrice: finiteNumber(vehicle?.retailPrice),
    vatStatus: clean(vehicle?.vatStatus, 50) || "unknown",
    mileage: finiteNumber(vehicle?.mileage),
    year: finiteNumber(vehicle?.year),
    registrationDate: clean(vehicle?.registrationDate, 50),
    fuel: clean(vehicle?.fuel, 120),
    transmission: clean(vehicle?.transmission, 120),
    colour: clean(vehicle?.colour, 200),
    ulezCompliant: typeof vehicle?.ulezCompliant === "boolean" ? vehicle.ulezCompliant : null,
    bhp: finiteNumber(vehicle?.bhp),
    torqueNm: finiteNumber(vehicle?.torqueNm),
    motExpiry: clean(vehicle?.motExpiry, 50),
    insuranceGroup: clean(vehicle?.insuranceGroup, 100),
    description: clean(vehicle?.description, 12000),
    attentionGrabber: clean(vehicle?.attentionGrabber, 1200),
    images: (Array.isArray(vehicle?.images) ? vehicle.images : []).slice(0, 80).map((image) => ({
      id: clean(image?.id, 300),
      url: clean(image?.url, 3000),
      order: finiteNumber(image?.order),
    })).filter((image) => image.url),
    imageCount: Math.max(0, finiteNumber(vehicle?.imageCount) || 0),
    sourceUrl: clean(vehicle?.sourceUrl, 3000),
    specifications: {
      standard: boundedSpecs(vehicle?.specifications?.standard),
      options: boundedSpecs(vehicle?.specifications?.options),
      technical: boundedSpecs(vehicle?.specifications?.technical),
    },
    sourceUpdatedAt: clean(vehicle?.sourceUpdatedAt, 100),
  };
}

function localVehicle(row, pipeline) {
  if (!row) return null;
  return {
    pipeline,
    id: clean(row?.id, 300),
    title: clean(row?.title || row?.registration, 700),
    price: finiteNumber(row?.price),
    vat: clean(row?.vat, 100),
    monthly: finiteNumber(row?.salePrice ?? row?.monthly),
    week: finiteNumber(row?.week),
    initialRental: finiteNumber(row?.initialRental),
    description: clean(row?.vanDescription, 12000),
    spec: clean(row?.vanSpec, 12000),
    imageUrl: clean(row?.picture, 3000),
    url: clean(row?.weblink || row?.webLink, 3000),
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }
  if (!isAuthorised(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    return;
  }

  const registration = normalizeRegistration(request.query?.registration || "");
  const supplierStockId = clean(request.query?.stockId, 300);
  if (!registration && !supplierStockId) {
    response.status(400).json({ ok: false, message: "Registration or DealerKit stock ID is required." });
    return;
  }

  try {
    let vehicle = null;
    if (supplierStockId) {
      vehicle = await fetchDealerKitStockDetail(supplierStockId, { specifications: true });
    } else {
      const snapshot = await fetchDealerKitStockSnapshot({ allowPartial: true });
      const match = (snapshot.vehicles || []).find((item) => item.registration === registration);
      if (match?.supplierStockId) vehicle = await fetchDealerKitStockDetail(match.supplierStockId, { specifications: true });
      else vehicle = match || null;
    }

    if (!vehicle) {
      response.status(404).json({ ok: false, message: "DealerKit vehicle was not found." });
      return;
    }

    const publicSourceVehicle = publicVehicle(vehicle);
    const normalisedRegistration = normalizeRegistration(vehicle.registration || registration);
    const supabase = getSupabaseServiceAdmin();
    const [local, savedDecision] = await Promise.all([
      loadLocalMatches(supabase, normalisedRegistration),
      loadDealerKitReviewDecision(supabase, publicSourceVehicle.supplierStockId),
    ]);
    const reviewDecision = savedDecision || defaultDealerKitReviewDecision(publicSourceVehicle);

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      readOnly: true,
      authoritative: false,
      reviewStateWritable: true,
      vehicle: publicSourceVehicle,
      reviewDecision,
      local: {
        finance: localVehicle(local.finance, "finance"),
        rent2buy: localVehicle(local.rent2buy, "rent2buy"),
      },
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(502).json({ ok: false, message: error?.message || "Could not load DealerKit vehicle detail." });
  }
}
