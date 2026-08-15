const SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";
const COLLECTION_ID = "Import3";
const productionUrl = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "").toLowerCase();
const isTargetProduction = process.env.VERCEL_ENV === "production"
  && productionUrl.includes("marketing-crm-github-work.vercel.app");

if (!isTargetProduction) {
  console.log("RENT2BUY_PUBLIC_WIX_READ_SKIPPED", {
    vercel_env: process.env.VERCEL_ENV || null,
    project_production_url: productionUrl || null,
  });
  process.exit(0);
}

try {
  const response = await fetch("https://www.wixapis.com/wix-data/v2/items/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "wix-site-id": SITE_ID,
    },
    body: JSON.stringify({
      dataCollectionId: COLLECTION_ID,
      query: {
        paging: { limit: 100 },
        fields: ["title", "slug", "excerpt", "_publishStatus", "link-knowledge-hub-articles-title"],
      },
      returnTotalCount: true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const items = Array.isArray(payload?.dataItems) ? payload.dataItems : [];
  console.log("RENT2BUY_PUBLIC_WIX_READ_RESULT", {
    status: response.status,
    ok: response.ok,
    returned_items: items.length,
    reported_total: Number(payload?.pagingMetadata?.total || 0),
    usable: response.ok && items.length === 52,
    error_code: String(payload?.details?.applicationError?.code || payload?.errorCode || "").slice(0, 100) || null,
  });
} catch (error) {
  console.log("RENT2BUY_PUBLIC_WIX_READ_RESULT", {
    ok: false,
    usable: false,
    exception_type: error?.name || "Error",
    message: String(error?.message || "Anonymous Wix read failed").slice(0, 300),
  });
}
