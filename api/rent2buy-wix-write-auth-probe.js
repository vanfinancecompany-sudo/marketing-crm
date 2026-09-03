const WIX_TASKS_URL = "https://www.wixapis.com/cms/v1/tasks";
const RENT2BUY_WIX_SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";
const COLLECTION_ID = "ALLRENT2BUYVANS";
const IMPOSSIBLE_ITEM_ID = "__stock_watch_permission_probe_no_match__";

function clean(value) {
  return String(value ?? "").trim();
}

async function probeKey(name, value) {
  const apiKey = clean(value);
  if (!apiKey) return { name, configured: false, taskAccepted: false, status: null, error: "not configured" };

  const response = await fetch(WIX_TASKS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
      "wix-site-id": RENT2BUY_WIX_SITE_ID,
    },
    body: JSON.stringify({
      task: {
        type: "UPDATE_PUBLISH_STATUS",
        updatePublishStatusOptions: {
          dataCollectionId: COLLECTION_ID,
          environment: "LIVE",
          filter: { _id: { $eq: IMPOSSIBLE_ITEM_ID } },
          operation: "SET_DRAFT_STATUS",
        },
      },
    }),
    cache: "no-store",
  });

  const raw = clean(await response.text());
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  return {
    name,
    configured: true,
    taskAccepted: response.ok && Boolean(payload?.task?.id),
    status: response.status,
    error: response.ok ? "" : clean(payload?.message || payload?.details?.applicationError?.description || raw).slice(0, 300),
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const candidates = [
    ["WIX_RENT2BUY_API_KEY", process.env.WIX_RENT2BUY_API_KEY],
    ["WIX_API_KEY", process.env.WIX_API_KEY],
    ["WIX_FINANCE_API_KEY", process.env.WIX_FINANCE_API_KEY],
  ];
  const results = [];
  for (const [name, value] of candidates) results.push(await probeKey(name, value));

  return response.status(200).json({
    ok: true,
    siteId: RENT2BUY_WIX_SITE_ID,
    collectionId: COLLECTION_ID,
    zeroMatchProbe: true,
    results,
  });
}
