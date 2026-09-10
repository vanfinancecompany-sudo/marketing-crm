const API_ORIGIN = "https://api.dealerkit.uk";
const STOCK_PATH = "/integrators/stock";
const TARGET_REGISTRATION = "HT22KJX";
const MAX_PAGES = 30;
const MAX_ITEMS = 2000;

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeNextUrl(value, dealerId) {
  if (!value) return "";
  try {
    const url = new URL(value, API_ORIGIN);
    if (url.origin !== API_ORIGIN || url.pathname !== STOCK_PATH) return "";
    if (!url.searchParams.has("dealer_id")) url.searchParams.set("dealer_id", dealerId);
    return url.toString();
  } catch {
    return "";
  }
}

async function getJson(url, secret) {
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
        "user-agent": "VFC-DealerKit-Phase1-ReadOnly/1.0",
      },
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    return { ok: response.ok, status: response.status, contentType: response.headers.get("content-type") || "", payload, textLength: text.length };
  } finally {
    clearTimeout(timeout);
  }
}

function collectFieldPaths(value, prefix = "", depth = 0, paths = new Set()) {
  if (depth > 5 || value === null || value === undefined) return paths;
  if (Array.isArray(value)) {
    paths.add(`${prefix}[]`);
    if (value[0] !== undefined) collectFieldPaths(value[0], `${prefix}[]`, depth + 1, paths);
    return paths;
  }
  if (typeof value !== "object") {
    paths.add(`${prefix}:${typeof value}`);
    return paths;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child === null) paths.add(`${next}:null`);
    else if (Array.isArray(child)) collectFieldPaths(child, next, depth + 1, paths);
    else if (typeof child === "object") collectFieldPaths(child, next, depth + 1, paths);
    else paths.add(`${next}:${typeof child}`);
  }
  return paths;
}

function findRegistration(item) {
  const queue = [item];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    if (!Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (/^(registration|reg|registration_number)$/i.test(key) && typeof child === "string") return child;
        if (child && typeof child === "object") queue.push(child);
      }
    }
  }
  return "";
}

function countImages(item) {
  let best = 0;
  const queue = [item];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      queue.push(...value.slice(0, 20));
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      if (/images?/i.test(key) && Array.isArray(child)) best = Math.max(best, child.length);
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return best;
}

function findScalar(item, keyPattern) {
  const queue = [item];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (keyPattern.test(key) && ["string", "number", "boolean"].includes(typeof child)) return child;
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return null;
}

function targetSummary(item) {
  if (!item) return null;
  return {
    registration: findRegistration(item),
    status: findScalar(item, /^status$/i),
    price: findScalar(item, /^(price|retail_price|sale_price|selling_price)$/i),
    vat: findScalar(item, /vat/i),
    make: findScalar(item, /^(make|manufacturer)$/i),
    model: findScalar(item, /^model$/i),
    derivative: findScalar(item, /^derivative$/i),
    mileage: findScalar(item, /^mileage$/i),
    year: findScalar(item, /^year$/i),
    fuel: findScalar(item, /^fuel(_type)?$/i),
    transmission: findScalar(item, /^transmission(_type)?$/i),
    imageCount: countImages(item),
    hasDescription: findScalar(item, /description/i) !== null,
  };
}

function linkNext(payload) {
  const links = payload?.links;
  if (!links || typeof links !== "object") return "";
  return links.next || links.next_page_url || links.nextPage || "";
}

export async function probeDealerKitStockReadOnly() {
  const secret = process.env.DEALERKIT_API_SECRET;
  const dealerId = compact(process.env.DEALERKIT_DEALER_ID);
  console.log("\n[DealerKit Phase 1] Authenticated read-only stock probe starting.");

  if (!secret || !dealerId) {
    console.log(JSON.stringify({ ok: false, reason: "DealerKit Preview environment variables are not configured." }, null, 2));
    return;
  }

  let url = new URL(`${API_ORIGIN}${STOCK_PATH}`);
  url.searchParams.set("dealer_id", dealerId);

  const items = [];
  const pageMeta = [];
  let firstItemFieldPaths = [];
  let targetItem = null;
  let page = 0;
  let stoppedReason = "complete";

  while (url && page < MAX_PAGES && items.length < MAX_ITEMS) {
    page += 1;
    const result = await getJson(url.toString(), secret);
    if (!result.ok || !result.payload || typeof result.payload !== "object") {
      console.log(JSON.stringify({
        ok: false,
        phase: "stock-list",
        page,
        httpStatus: result.status,
        contentType: result.contentType,
        responseBytes: result.textLength,
        secretLogged: false,
      }, null, 2));
      return;
    }

    const pageItems = Array.isArray(result.payload.data) ? result.payload.data : [];
    if (page === 1 && pageItems[0]) firstItemFieldPaths = Array.from(collectFieldPaths(pageItems[0])).sort();
    for (const item of pageItems) {
      items.push(item);
      if (!targetItem && normalizeRegistration(findRegistration(item)) === TARGET_REGISTRATION) targetItem = item;
      if (items.length >= MAX_ITEMS) break;
    }

    const meta = result.payload.meta || {};
    pageMeta.push({
      page,
      dataCount: pageItems.length,
      currentPage: meta.current_page ?? meta.currentPage ?? null,
      lastPage: meta.last_page ?? meta.lastPage ?? null,
      perPage: meta.per_page ?? meta.perPage ?? null,
      total: meta.total ?? null,
      hasNext: Boolean(linkNext(result.payload)),
    });

    const next = safeNextUrl(linkNext(result.payload), dealerId);
    if (!next) break;
    url = new URL(next);
    await sleep(75);
  }

  if (page >= MAX_PAGES) stoppedReason = "page_guard";
  if (items.length >= MAX_ITEMS) stoppedReason = "item_guard";

  const registrations = new Set(items.map(findRegistration).map(normalizeRegistration).filter(Boolean));
  const statusCounts = {};
  const typeCounts = {};
  const imageCounts = [];
  for (const item of items) {
    const status = String(findScalar(item, /^status$/i) ?? "unknown");
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const type = String(findScalar(item, /^type$/i) ?? "unknown");
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    imageCounts.push(countImages(item));
  }

  const knownTotal = pageMeta.find((entry) => Number.isFinite(Number(entry.total)))?.total ?? null;
  const imageSummary = imageCounts.length ? {
    zero: imageCounts.filter((count) => count === 0).length,
    one: imageCounts.filter((count) => count === 1).length,
    fiveOrMore: imageCounts.filter((count) => count >= 5).length,
    max: Math.max(...imageCounts),
  } : { zero: 0, one: 0, fiveOrMore: 0, max: 0 };

  console.log(JSON.stringify({
    ok: true,
    readOnly: true,
    pagesFetched: page,
    recordsFetched: items.length,
    uniqueRegistrations: registrations.size,
    apiReportedTotal: knownTotal,
    stoppedReason,
    pageMeta,
    statusCounts,
    typeCounts,
    imageSummary,
    targetRegistration: TARGET_REGISTRATION,
    targetFound: Boolean(targetItem),
    target: targetSummary(targetItem),
    firstItemFieldPaths,
    secretLogged: false,
    dealerIdLogged: false,
    writeEndpointsCalled: false,
  }, null, 2));
  console.log("[DealerKit Phase 1] Authenticated read-only stock probe complete.\n");
}
