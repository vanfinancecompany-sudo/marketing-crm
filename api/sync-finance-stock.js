import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";

const WIX_QUERY_URL = "https://www.wixapis.com/wix-data/v2/items/query";
const DEFAULT_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const DEFAULT_COLLECTION = "VANFINANCE-ALLVANS";
const TARGET_TABLE = "facebook_adverts";
const PAGE_SIZE = 100;
const MAX_ROWS = 2000;
const WRITE_CONCURRENCY = 12;

function clean(value) {
  return String(value || "").trim();
}

function normalizeRegistration(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function wixImageUrl(value) {
  const raw = clean(typeof value === "object" ? value?.src || value?.url || "" : value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const slug = raw.match(/^wix:image:\/\/v1\/([^/]+)/i)?.[1] || "";
  return slug ? `https://static.wixstatic.com/media/${slug}` : raw;
}

function wixHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "wix-site-id": clean(process.env.WIX_FINANCE_SITE_ID) || DEFAULT_WIX_SITE_ID,
  };
  const apiKey = clean(process.env.WIX_FINANCE_API_KEY || process.env.WIX_API_KEY);
  if (apiKey) headers.Authorization = apiKey;
  return headers;
}

async function queryWixPage(offset) {
  const response = await fetch(WIX_QUERY_URL, {
    method: "POST",
    headers: wixHeaders(),
    body: JSON.stringify({
      dataCollectionId: clean(process.env.WIX_FINANCE_STOCK_COLLECTION) || DEFAULT_COLLECTION,
      query: { paging: { limit: PAGE_SIZE, offset } },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = clean(await response.text()).slice(0, 500);
    throw new Error(`Wix stock query failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.dataItems) ? payload.dataItems : [];
}

async function fetchPublishedFinanceStock() {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const page = await queryWixPage(offset);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const byRegistration = new Map();
  for (const item of rows) {
    const data = item?.data || {};
    if (clean(data?._publishStatus).toUpperCase() !== "PUBLISHED") continue;

    const registration = normalizeRegistration(data.title);
    if (!registration) continue;

    const updatedAt = Date.parse(data?._updatedDate?.$date || data?._updatedDate || "") || 0;
    const current = byRegistration.get(registration);
    if (current && current.updatedAt > updatedAt) continue;

    byRegistration.set(registration, {
      updatedAt,
      payload: {
        title: registration,
        picture: wixImageUrl(data.picture),
        price: clean(data.price),
        vat: clean(data.vat),
        salePrice: clean(data.salePrice || data.from116Month),
        vanDescription: clean(data.vanDescription),
        vanSpec: clean(data.vanSpec),
        weblink:
          clean(data.webLink || data.weblink) ||
          `https://www.vanfinancecompany.co.uk/van-finance/${registration}`,
        is_active: true,
      },
    });
  }

  return {
    rawCount: rows.length,
    vehicles: [...byRegistration.values()].map((entry) => entry.payload),
  };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function runWithConcurrency(items, worker, concurrency = WRITE_CONCURRENCY) {
  const batches = chunk(items, Math.max(1, concurrency));
  const results = [];
  for (const batch of batches) {
    const settled = await Promise.allSettled(batch.map(worker));
    results.push(...settled);
  }
  return results;
}

async function deactivateIds(supabase, ids) {
  let changed = 0;
  for (const idBatch of chunk(ids, 100)) {
    if (!idBatch.length) continue;
    const { data, error } = await supabase
      .from(TARGET_TABLE)
      .update({ is_active: false })
      .in("id", idBatch)
      .select("id");
    if (error) throw error;
    changed += data?.length || 0;
  }
  return changed;
}

async function syncFinanceStock() {
  const { rawCount, vehicles } = await fetchPublishedFinanceStock();
  if (!vehicles.length) {
    throw new Error("Wix returned no published Van Finance stock. Existing Supabase stock was left unchanged.");
  }

  const supabase = getSupabaseServiceAdmin();
  const { data: existingRows, error: existingError } = await supabase
    .from(TARGET_TABLE)
    .select("id,title,is_active")
    .order("id", { ascending: false });
  if (existingError) throw existingError;

  const existingByRegistration = new Map();
  for (const row of existingRows || []) {
    const registration = normalizeRegistration(row.title);
    if (!registration) continue;
    const group = existingByRegistration.get(registration) || [];
    group.push(row);
    existingByRegistration.set(registration, group);
  }

  const currentRegistrations = new Set(vehicles.map((row) => row.title));
  const updates = [];
  const inserts = [];
  const duplicateIds = [];

  for (const vehicle of vehicles) {
    const group = existingByRegistration.get(vehicle.title) || [];
    const keeper = group[0];
    if (keeper?.id != null) {
      updates.push({ id: keeper.id, payload: vehicle });
      duplicateIds.push(
        ...group
          .slice(1)
          .filter((row) => row.is_active !== false)
          .map((row) => row.id)
          .filter((id) => id != null)
      );
    } else {
      inserts.push(vehicle);
    }
  }

  const staleIds = (existingRows || [])
    .filter((row) => row?.id != null && row.is_active !== false)
    .filter((row) => {
      const registration = normalizeRegistration(row.title);
      return registration && !currentRegistrations.has(registration);
    })
    .map((row) => row.id);

  const updateResults = await runWithConcurrency(updates, async ({ id, payload }) => {
    const { error } = await supabase.from(TARGET_TABLE).update(payload).eq("id", id);
    if (error) throw error;
    return id;
  });
  const failedUpdates = updateResults.filter((result) => result.status === "rejected");
  if (failedUpdates.length) {
    throw new Error(`Supabase update failed for ${failedUpdates.length} current vehicle(s). Stale rows were not deactivated.`);
  }

  let inserted = 0;
  for (const insertBatch of chunk(inserts, 100)) {
    if (!insertBatch.length) continue;
    const { data, error } = await supabase.from(TARGET_TABLE).insert(insertBatch).select("id");
    if (error) {
      throw new Error(`Supabase insert failed. Stale rows were not deactivated: ${error.message || error}`);
    }
    inserted += data?.length || insertBatch.length;
  }

  const idsToDeactivate = [...new Set([...staleIds, ...duplicateIds])];
  const deactivated = await deactivateIds(supabase, idsToDeactivate);

  const { count: activeCount, error: countError } = await supabase
    .from(TARGET_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (countError) throw countError;

  return {
    ok: true,
    source: "wix-cms",
    collection: clean(process.env.WIX_FINANCE_STOCK_COLLECTION) || DEFAULT_COLLECTION,
    wixRows: rawCount,
    uniquePublished: vehicles.length,
    updated: updates.length,
    inserted,
    deactivated,
    active: activeCount ?? vehicles.length,
  };
}

function htmlResponse(result, status = 200) {
  const ok = Boolean(result?.ok);
  const count = Number(result?.active ?? result?.uniquePublished ?? 0);
  const message = ok ? `Synced ✅ ${count}` : "Error ❌";
  const detail = ok
    ? `${result.updated || 0} updated · ${result.inserted || 0} added · ${result.deactivated || 0} removed from active stock`
    : clean(result?.message || "Van Finance stock could not be synced.");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Van Finance Stock Sync</title><style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111}.wrap{min-height:68vh;display:grid;place-items:center;padding:36px}.panel{text-align:center;max-width:720px;width:100%}.brand{font-weight:900;font-size:30px;letter-spacing:-1px;margin-bottom:36px}.brand span{color:#e50914}.status{background:${ok ? "#e50914" : "#d90914"};color:#fff;border-radius:10px;padding:18px 24px;font-size:22px;font-weight:800;box-shadow:0 4px 15px rgba(0,0,0,.25)}.detail{margin:18px auto 0;color:#555;font-size:14px;line-height:1.5}.foot{background:#050505;color:#fff;text-align:center;padding:34px 20px;font-weight:800}.foot span{color:#e50914}</style></head><body><main class="wrap"><section class="panel"><div class="brand"><span>VAN</span> FINANCE COMPANY</div><div class="status">${message}</div><div class="detail">${detail}</div></section></main><footer class="foot">THE <span>VAN FINANCE</span> COMPANY</footer></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method || "")) {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const result = await syncFinanceStock();
    const wantsHtml = request.method === "GET" && !String(request.headers?.accept || "").includes("application/json");
    if (wantsHtml) {
      const rendered = htmlResponse(result, 200);
      response.status(200);
      rendered.headers.forEach((value, key) => response.setHeader(key, value));
      response.send(await rendered.text());
      return;
    }
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json(result);
  } catch (error) {
    const payload = { ok: false, message: error?.message || "Could not sync Van Finance stock." };
    const wantsHtml = request.method === "GET" && !String(request.headers?.accept || "").includes("application/json");
    if (wantsHtml) {
      const rendered = htmlResponse(payload, 500);
      response.status(500);
      rendered.headers.forEach((value, key) => response.setHeader(key, value));
      response.send(await rendered.text());
      return;
    }
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(500).json(payload);
  }
}
