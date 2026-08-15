import {
  RENT2BUY_ALL_VANS_COLLECTION_ID,
  RENT2BUY_WIX_SITE_ID,
  summarizeMonthlyPriceSync,
} from "../lib/rent2buyMonthlyPriceSync.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

function authorize(request) {
  const authorization = clean(request.headers?.authorization);
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const cronSecret = clean(process.env.CRON_SECRET);
  const marketingKey = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  return Boolean(
    (cronSecret && bearer === cronSecret) ||
    (marketingKey && (clean(request.headers?.[API_KEY_HEADER]) === marketingKey || bearer === marketingKey))
  );
}

function configuration(environment = process.env) {
  const apiKey = clean(environment.WIX_API_KEY);
  if (!apiKey) throw new Error("WIX_API_KEY is not configured.");
  return {
    apiKey,
    siteId: clean(environment.WIX_RENT2BUY_SITE_ID, 500) || RENT2BUY_WIX_SITE_ID,
    apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com",
  };
}

async function wixRequest(config, path, { method = "GET", body } = {}) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: config.apiKey,
      "wix-site-id": config.siteId,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = clean(payload?.message || payload?.details?.applicationError?.description, 1000);
    throw new Error(message || `Wix returned status ${response.status}.`);
  }
  return payload;
}

async function loadAllVans(config) {
  const items = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const payload = await wixRequest(config, "/wix-data/v2/items/query", {
      method: "POST",
      body: {
        dataCollectionId: RENT2BUY_ALL_VANS_COLLECTION_ID,
        query: {
          paging: { limit, offset },
          fields: ["title", "mth", "monthlyPriceNumeric"],
        },
        returnTotalCount: true,
      },
    });
    const page = Array.isArray(payload.dataItems) ? payload.dataItems : [];
    items.push(...page);
    if (page.length < limit || items.length >= Number(payload?.pagingMetadata?.total || 0)) break;
    offset += page.length;
  }

  return items;
}

async function applyPatches(config, patches) {
  const batches = [];
  for (let index = 0; index < patches.length; index += 100) batches.push(patches.slice(index, index + 100));

  let successes = 0;
  const failures = [];
  for (const batch of batches) {
    const payload = await wixRequest(config, "/wix-data/v2/bulk/items/patch", {
      method: "POST",
      body: { dataCollectionId: RENT2BUY_ALL_VANS_COLLECTION_ID, patches: batch },
    });
    successes += Number(payload?.bulkActionMetadata?.totalSuccesses || 0);
    for (const result of payload?.results || []) {
      if (result?.itemMetadata?.success === false) failures.push(result.itemMetadata);
    }
  }
  return { successes, failures };
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });

  try {
    const config = configuration();
    const items = await loadAllVans(config);
    const { patches, skipped } = summarizeMonthlyPriceSync(items);
    const applied = patches.length ? await applyPatches(config, patches) : { successes: 0, failures: [] };

    console.info("RENT2BUY MONTHLY PRICE SYNC", {
      scanned: items.length,
      changes_needed: patches.length,
      updated: applied.successes,
      failures: applied.failures.length,
      unparseable: skipped.length,
    });

    return response.status(applied.failures.length ? 207 : 200).json({
      ok: applied.failures.length === 0,
      scanned: items.length,
      changes_needed: patches.length,
      updated: applied.successes,
      failures: applied.failures,
      unparseable: skipped,
    });
  } catch (error) {
    console.error("RENT2BUY MONTHLY PRICE SYNC ERROR", { message: clean(error?.message, 1000) });
    return response.status(500).json({ ok: false, message: error?.message || "Rent2Buy monthly price sync failed." });
  }
}
