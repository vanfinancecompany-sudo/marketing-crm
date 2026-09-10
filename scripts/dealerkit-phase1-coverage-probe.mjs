const API_ORIGIN = "https://api.dealerkit.uk";
const STOCK_PATH = "/integrators/stock";
const TARGET_REGISTRATION = "HT22KJX";
const PER_PAGE = 100;
const MAX_PAGES = 10;

function compact(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function normalizeRegistration(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getJson(url, secret, attempts = 3) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${secret}`,
          "user-agent": "VFC-DealerKit-Phase1-Coverage/1.0",
        },
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      last = { ok: response.ok, status: response.status, payload, bytes: text.length };
      if (response.ok) return last;
      if (response.status < 500) return last;
    } catch (error) {
      last = { ok: false, status: 0, payload: null, bytes: 0, error: error?.name === "AbortError" ? "timeout" : compact(error?.message || "request failed") };
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < attempts) await sleep(350 * attempt);
  }
  return last;
}

function registration(item) { return item?.vehicle?.registration || item?.vehicle?.plate || ""; }
function status(item) { return item?.status || item?.meta?.status || "unknown"; }
function vehicleType(item) { return item?.vehicle?.type || "unknown"; }
function imageCount(item) { return Array.isArray(item?.media?.images) ? item.media.images.length : 0; }

function targetSummary(item) {
  if (!item) return null;
  return {
    idPresent: Boolean(item.id),
    registration: registration(item),
    status: status(item),
    make: item?.vehicle?.manufacturer || "",
    model: item?.vehicle?.model || "",
    derivative: item?.vehicle?.derivative || "",
    mileage: item?.vehicle?.mileage ?? null,
    year: item?.vehicle?.year ?? null,
    fuel: item?.vehicle?.fuel_type || "",
    transmission: item?.vehicle?.transmission_type || "",
    advertisedPrice: item?.prices?.advertised?.amount ?? null,
    advertisedVatStatus: item?.prices?.advertised?.vat_status ?? null,
    cashPrice: item?.prices?.cash?.amount ?? null,
    imageCount: imageCount(item),
    coverImagePresent: Boolean(item?.media?.cover_image?.url),
    websiteLinkPresent: Boolean(item?.links?.website),
    createdAtPresent: Boolean(item?.created_at || item?.meta?.created_at),
    updatedAtPresent: Boolean(item?.updated_at || item?.meta?.updated_at),
  };
}

function safeNext(payload, dealerId) {
  const raw = payload?.links?.next || "";
  if (!raw) return "";
  try {
    const url = new URL(raw, API_ORIGIN);
    if (url.origin !== API_ORIGIN || url.pathname !== STOCK_PATH) return "";
    url.searchParams.set("dealer_id", dealerId);
    url.searchParams.set("per_page", String(PER_PAGE));
    return url.toString();
  } catch { return ""; }
}

function aggregate(items) {
  const statuses = {};
  const types = {};
  const imageCounts = [];
  for (const item of items) {
    const s = String(status(item));
    statuses[s] = (statuses[s] || 0) + 1;
    const t = String(vehicleType(item));
    types[t] = (types[t] || 0) + 1;
    imageCounts.push(imageCount(item));
  }
  return {
    recordsFetched: items.length,
    uniqueRegistrations: new Set(items.map(registration).map(normalizeRegistration).filter(Boolean)).size,
    statusCounts: statuses,
    typeCounts: types,
    imageSummary: {
      zero: imageCounts.filter((n) => n === 0).length,
      one: imageCounts.filter((n) => n === 1).length,
      fiveOrMore: imageCounts.filter((n) => n >= 5).length,
      max: imageCounts.length ? Math.max(...imageCounts) : 0,
    },
  };
}

export async function probeDealerKitCoverageReadOnly() {
  const secret = process.env.DEALERKIT_API_SECRET;
  const dealerId = compact(process.env.DEALERKIT_DEALER_ID);
  console.log("\n[DealerKit Phase 1] Coverage probe starting (GET only, per_page=100).");
  if (!secret || !dealerId) {
    console.log(JSON.stringify({ ok: false, reason: "Preview environment variables missing", secretLogged: false }, null, 2));
    return;
  }

  const first = new URL(`${API_ORIGIN}${STOCK_PATH}`);
  first.searchParams.set("dealer_id", dealerId);
  first.searchParams.set("per_page", String(PER_PAGE));

  let nextUrl = first.toString();
  const items = [];
  const pages = [];
  let target = null;

  for (let page = 1; page <= MAX_PAGES && nextUrl; page += 1) {
    const result = await getJson(nextUrl, secret);
    if (!result?.ok || !result?.payload || typeof result.payload !== "object") {
      console.log(JSON.stringify({
        ok: false,
        partial: true,
        failedPage: page,
        httpStatus: result?.status ?? 0,
        responseBytes: result?.bytes ?? 0,
        pages,
        ...aggregate(items),
        apiReportedTotal: pages[0]?.total ?? null,
        targetFound: Boolean(target),
        target: targetSummary(target),
        secretLogged: false,
        dealerIdLogged: false,
        writeEndpointsCalled: false,
      }, null, 2));
      return;
    }

    const data = Array.isArray(result.payload.data) ? result.payload.data : [];
    items.push(...data);
    if (!target) target = data.find((item) => normalizeRegistration(registration(item)) === TARGET_REGISTRATION) || null;
    const meta = result.payload.meta || {};
    pages.push({
      page: meta.current_page ?? page,
      dataCount: data.length,
      total: meta.total ?? null,
      lastPage: meta.last_page ?? null,
      perPage: meta.per_page ?? null,
    });
    nextUrl = safeNext(result.payload, dealerId);
    if (nextUrl) await sleep(100);
  }

  console.log(JSON.stringify({
    ok: true,
    readOnly: true,
    pages,
    ...aggregate(items),
    apiReportedTotal: pages[0]?.total ?? null,
    targetFound: Boolean(target),
    target: targetSummary(target),
    secretLogged: false,
    dealerIdLogged: false,
    writeEndpointsCalled: false,
  }, null, 2));
  console.log("[DealerKit Phase 1] Coverage probe complete.\n");
}
