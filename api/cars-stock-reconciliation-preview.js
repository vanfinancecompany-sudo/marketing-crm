import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { controlledCarWixConfiguration } from "./_dealerkit-car-controlled-publish-state.js";
import { controlledWixRequest } from "./_dealerkit-controlled-publish-state.js";
import { loadCompleteWixStockSnapshot } from "../lib/wixStockSnapshot.js";
import {
  buildCarStockReconciliationPreview,
  publishedCarsFromWixRows,
} from "../lib/carStockReconciliation.js";

const CAR_COLLECTION = "CARFINANCE";
const TARGET_TABLE = "car_adverts";
const PAGE_SIZE = 100;
const MAX_ROWS = 1000;

async function queryWixPage(configuration, offset) {
  return controlledWixRequest(configuration, "/wix-data/v2/items/query", {
    method: "POST",
    body: {
      dataCollectionId: CAR_COLLECTION,
      query: { paging: { limit: PAGE_SIZE, offset } },
      consistentRead: true,
      returnTotalCount: true,
    },
  });
}

async function loadPublishedCars() {
  const configuration = controlledCarWixConfiguration();
  const { items, total } = await loadCompleteWixStockSnapshot({
    queryPage: (offset) => queryWixPage(configuration, offset),
    source: "Cars Wix CARFINANCE",
    pageSize: PAGE_SIZE,
    maxRows: MAX_ROWS,
  });
  const parsed = publishedCarsFromWixRows(items);
  return {
    siteId: configuration.siteId,
    collection: CAR_COLLECTION,
    wixRows: total,
    ...parsed,
  };
}

async function loadExistingCars() {
  const supabase = getSupabaseServiceAdmin();
  const { data, error } = await supabase
    .from(TARGET_TABLE)
    .select("id,registration,title,picture,price,salePrice,description,spec,weblink,is_active,created_at,updated_at")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not read Marketing CRM Cars stock: ${error.message || error}`);
  return data || [];
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, message: "This preview is read-only. Use GET." });
  }

  try {
    const [source, existingRows] = await Promise.all([
      loadPublishedCars(),
      loadExistingCars(),
    ]);

    const preview = buildCarStockReconciliationPreview(source.vehicles, existingRows);
    const warnings = [
      ...(source.duplicatePublishedRegistrations.length
        ? [`Wix CARFINANCE contains duplicate published registrations: ${source.duplicatePublishedRegistrations.join(", ")}.`]
        : []),
      ...preview.warnings,
    ];

    return response.status(200).json({
      ok: true,
      readOnly: true,
      source: {
        kind: "wix-cms",
        siteId: source.siteId,
        collection: source.collection,
        wixRows: source.wixRows,
        uniquePublished: source.vehicles.length,
      },
      target: {
        table: TARGET_TABLE,
        rows: existingRows.length,
      },
      preview: {
        ...preview,
        safeToApply:
          preview.safeToApply &&
          source.duplicatePublishedRegistrations.length === 0,
        warnings,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[cars-stock-reconciliation-preview] failed", error);
    return response.status(502).json({
      ok: false,
      readOnly: true,
      message: error?.message || "Could not build Cars stock reconciliation preview.",
    });
  }
}
