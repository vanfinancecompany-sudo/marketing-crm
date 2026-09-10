const API_ORIGIN = "https://api.dealerkit.uk";
const DEALERKIT_STOCK = `${API_ORIGIN}/integrators/stock`;
const TARGET_PAGE = 243;
const EXPECTED_REGISTRATION = "HT22KJX";

function compact(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function normaliseReg(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

async function getJson(url, secret) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json", authorization: `Bearer ${secret}`, "user-agent": "VFC-DealerKit-Phase1-Target/1.0" },
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    return { ok: response.ok, status: response.status, payload, bytes: text.length };
  } finally { clearTimeout(timeout); }
}

function specificationCounts(vehicle) {
  const specs = vehicle?.specifications || {};
  return {
    standard: Array.isArray(specs?.standard?.items) ? specs.standard.items.length : 0,
    options: Array.isArray(specs?.options?.items) ? specs.options.items.length : 0,
    technical: Array.isArray(specs?.technical?.items) ? specs.technical.items.length : 0,
    optionCountReported: specs?.options?.count ?? null,
    optionValueReported: specs?.options?.value ?? null,
  };
}

function summary(item) {
  const vehicle = item?.vehicle || {};
  const images = Array.isArray(item?.media?.images) ? item.media.images : [];
  const videos = Array.isArray(item?.media?.videos) ? item.media.videos : [];
  return {
    idPresent: Boolean(item?.id),
    registration: vehicle.registration || vehicle.plate || "",
    stockStatus: item?.status || item?.meta?.status || "",
    vehicleType: vehicle.type || "",
    make: vehicle.manufacturer || "",
    model: vehicle.model || "",
    derivative: vehicle.derivative || "",
    trim: vehicle.trim || "",
    bodyType: vehicle.body_type || "",
    mileage: vehicle.mileage ?? null,
    year: vehicle.year ?? null,
    registrationDate: vehicle.registration_date || "",
    fuelType: vehicle.fuel_type || "",
    transmissionType: vehicle.transmission_type || "",
    colour: vehicle.colour || "",
    manufacturerColour: vehicle.manufacturer_colour || "",
    ulezCompliant: vehicle.ulez_compliant ?? null,
    bhp: vehicle.bhp ?? null,
    torqueNm: vehicle.torque_nm ?? null,
    motExpiry: vehicle.mot_expiry || "",
    insuranceGroup: vehicle.insurance_group || "",
    advertisedPrice: item?.prices?.advertised?.amount ?? null,
    advertisedVatStatus: item?.prices?.advertised?.vat_status ?? null,
    previousAdvertisedPrice: item?.prices?.advertised?.previous_amount ?? null,
    cashPrice: item?.prices?.cash?.amount ?? null,
    cashVatAmount: item?.prices?.cash?.vat_amount ?? null,
    dealerMonthlyPrice: item?.prices?.monthly?.amount ?? null,
    financeExamples: Array.isArray(item?.prices?.monthly?.examples) ? item.prices.monthly.examples.length : 0,
    imageCount: images.length,
    everyImageHasStableId: images.length > 0 && images.every((image) => Boolean(image?.id)),
    everyImageHasUrl: images.length > 0 && images.every((image) => Boolean(image?.url)),
    coverImagePresent: Boolean(item?.media?.cover_image?.url),
    coverImageHasStableId: Boolean(item?.media?.cover_image?.id),
    videoCount: videos.length,
    spinPresent: Boolean(item?.media?.spin?.url),
    websiteLinkPresent: Boolean(item?.links?.website),
    reservationLinkPresent: Boolean(item?.links?.reservation),
    advertisingCommentsPresent: Boolean(compact(item?.advertising?.comments)),
    advertisingCommentsLength: compact(item?.advertising?.comments).length,
    attentionGrabberPresent: Boolean(compact(item?.advertising?.attention_grabber)),
    specificationCounts: specificationCounts(vehicle),
    createdAtPresent: Boolean(item?.created_at || item?.meta?.created_at),
    updatedAtPresent: Boolean(item?.updated_at || item?.meta?.updated_at),
  };
}

export async function probeKnownDealerKitVehicleReadOnly() {
  const dealerId = compact(process.env.DEALERKIT_DEALER_ID);
  const secret = process.env.DEALERKIT_API_SECRET;
  console.log("\n[DealerKit Phase 1] Known vehicle detail probe starting (GET only).");
  if (!dealerId || !secret) {
    console.log(JSON.stringify({ ok: false, reason: "Preview environment variables missing" }, null, 2));
    return;
  }

  const listUrl = new URL(DEALERKIT_STOCK);
  listUrl.searchParams.set("dealer_id", dealerId);
  listUrl.searchParams.set("per_page", "1");
  listUrl.searchParams.set("page", String(TARGET_PAGE));
  const list = await getJson(listUrl.toString(), secret);
  const listItem = Array.isArray(list?.payload?.data) ? list.payload.data[0] : null;
  if (!list.ok || !listItem?.id || normaliseReg(listItem?.vehicle?.registration) !== EXPECTED_REGISTRATION) {
    console.log(JSON.stringify({ ok: false, stage: "locate-target", httpStatus: list.status, expectedRegistration: EXPECTED_REGISTRATION, actualRegistration: listItem?.vehicle?.registration || "", secretLogged: false }, null, 2));
    return;
  }

  const detailUrl = new URL(`${DEALERKIT_STOCK}/${encodeURIComponent(listItem.id)}`);
  detailUrl.searchParams.set("dealer_id", dealerId);
  detailUrl.searchParams.set("specifications", "true");
  const detail = await getJson(detailUrl.toString(), secret);
  const item = detail?.payload?.data;

  console.log(JSON.stringify({
    ok: Boolean(detail.ok && item),
    readOnly: true,
    httpStatus: detail.status,
    expectedRegistration: EXPECTED_REGISTRATION,
    listingSummary: summary(listItem),
    detailSummary: item ? summary(item) : null,
    secretLogged: false,
    dealerIdLogged: false,
    stockIdLogged: false,
    writeEndpointsCalled: false,
  }, null, 2));
  console.log("[DealerKit Phase 1] Known vehicle detail probe complete.\n");
}
