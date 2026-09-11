const SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";
const COLLECTION_ID = "ALLRENT2BUYVANS";
const IMPOSSIBLE_ITEM_ID = "__dealerkit_price_write_permission_probe__";

const clean = (value, limit = 1000) => String(value ?? "").trim().slice(0, limit);

async function probe(source, apiKey) {
  const key = clean(apiKey, 5000);
  if (!key) return { source, configured: false };
  let response;
  try {
    response = await fetch(`https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(IMPOSSIBLE_ITEM_ID)}`, {
      method: "PATCH",
      headers: {
        Authorization: key,
        "wix-site-id": SITE_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataCollectionId: COLLECTION_ID,
        patch: {
          dataItemId: IMPOSSIBLE_ITEM_ID,
          fieldModifications: [{ fieldPath: "title", action: "SET_FIELD", setFieldOptions: { value: IMPOSSIBLE_ITEM_ID } }],
        },
      }),
    });
  } catch (error) {
    return { source, configured: true, networkError: clean(error?.message || error, 500) };
  }
  const payload = await response.json().catch(() => ({}));
  return {
    source,
    configured: true,
    status: response.status,
    ok: response.ok,
    message: clean(payload?.message || payload?.details?.applicationError?.description || payload?.details?.validationError?.fieldViolations?.[0]?.description, 500),
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });
  const candidates = [
    ["WIX_RENT2BUY_API_KEY", process.env.WIX_RENT2BUY_API_KEY],
    ["WIX_API_KEY", process.env.WIX_API_KEY],
    ["WIX_FINANCE_API_KEY", process.env.WIX_FINANCE_API_KEY],
  ];
  const results = [];
  for (const [source, key] of candidates) results.push(await probe(source, key));
  return response.status(200).json({ ok: true, siteId: SITE_ID, collectionId: COLLECTION_ID, impossibleItem: true, results });
}
