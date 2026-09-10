const API = "https://api.dealerkit.uk/integrators/stock";
const START_ITEM = 226;
const END_ITEM = 248;
const TARGET_REGISTRATION = "HT22KJX";

function compact(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function reg(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchOne(page, dealerId, secret) {
  const url = new URL(API);
  url.searchParams.set("dealer_id", dealerId);
  url.searchParams.set("per_page", "1");
  url.searchParams.set("page", String(page));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json", authorization: `Bearer ${secret}`, "user-agent": "VFC-DealerKit-Gap-Probe/1.0" },
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    const item = Array.isArray(payload?.data) ? payload.data[0] : null;
    return {
      page,
      ok: response.ok,
      status: response.status,
      bytes: text.length,
      registration: item?.vehicle?.registration || item?.vehicle?.plate || "",
      stockStatus: item?.status || item?.meta?.status || "",
      vehicleType: item?.vehicle?.type || "",
      imageCount: Array.isArray(item?.media?.images) ? item.media.images.length : 0,
      id: item?.id || "",
    };
  } catch (error) {
    return { page, ok: false, status: 0, bytes: 0, error: error?.name === "AbortError" ? "timeout" : compact(error?.message || "request failed") };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeDealerKitPaginationGapReadOnly() {
  const dealerId = compact(process.env.DEALERKIT_DEALER_ID);
  const secret = process.env.DEALERKIT_API_SECRET;
  console.log("\n[DealerKit Phase 1] Pagination gap probe starting (GET only).");
  if (!dealerId || !secret) {
    console.log(JSON.stringify({ ok: false, reason: "Preview environment variables missing" }, null, 2));
    return;
  }

  const results = [];
  let target = null;
  for (let page = START_ITEM; page <= END_ITEM; page += 1) {
    const result = await fetchOne(page, dealerId, secret);
    results.push(result);
    if (result.ok && reg(result.registration) === TARGET_REGISTRATION) target = result;
    await sleep(60);
  }

  const failed = results.filter((item) => !item.ok).map((item) => ({ page: item.page, status: item.status, bytes: item.bytes, error: item.error || "" }));
  const successful = results.filter((item) => item.ok);
  const statuses = {};
  const types = {};
  for (const item of successful) {
    statuses[item.stockStatus || "unknown"] = (statuses[item.stockStatus || "unknown"] || 0) + 1;
    types[item.vehicleType || "unknown"] = (types[item.vehicleType || "unknown"] || 0) + 1;
  }

  console.log(JSON.stringify({
    ok: failed.length === 0,
    readOnly: true,
    range: { start: START_ITEM, end: END_ITEM },
    successfulItems: successful.length,
    failedItems: failed.length,
    failed,
    statusCounts: statuses,
    typeCounts: types,
    targetFound: Boolean(target),
    target: target ? {
      page: target.page,
      registration: target.registration,
      stockStatus: target.stockStatus,
      vehicleType: target.vehicleType,
      imageCount: target.imageCount,
      idPresent: Boolean(target.id),
    } : null,
    adjacentSuccesses: successful.slice(0, 3).map((item) => ({ page: item.page, registration: item.registration })).concat(successful.slice(-3).map((item) => ({ page: item.page, registration: item.registration }))),
    secretLogged: false,
    dealerIdLogged: false,
    writeEndpointsCalled: false,
  }, null, 2));
  console.log("[DealerKit Phase 1] Pagination gap probe complete.\n");
}
