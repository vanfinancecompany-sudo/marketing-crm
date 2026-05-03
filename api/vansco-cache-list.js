import {
  CACHE_TABLE,
  WATCH_TABLE,
  extractVanscoId,
  getSupabaseAdmin,
  normalizeActionRecord,
  normalizeCacheRow,
  normalizeRegistration,
  normalizeUrl,
} from "./_vansco-cache-utils.js";

const VAN_KEYWORDS = /\b(transit|transit custom|custom|tipper|dropside|luton|crew van|minibus|panel van|box van|pickup|pick-up|chassis cab|relay|dispatch|scudo|daily|doblo|partner|berlingo|sprinter|crafter|vito|vivaro|movano|box-van|kangoo|trafic|traffic|master|ducato|talento|expert|transporter|caddy|maxus|combo|proace|primastar|nv200|nv300|bailey|pegasus|winnebago|motorhome|caravan|camper)\b/i;
const VAN_PHRASES = /\b(l1h1|l2h1|l3h2|panel van|double cab|crew cab|welfare|dropside|tail lift|twin side loading door|high roof|medium roof|long wheelbase|short wheelbase)\b/i;
const CAR_KEYWORDS = /\b(audi|bmw|jaguar|jeep|kia|lexus|mercedes-benz|mercedes|skoda|suzuki|hyundai|tesla|q2|q3|a1|a3|a4|a5|i10|i20|estate|hatchback|cabriolet|suv|coupe|saloon|convertible|sportback|xdrive|petrol|hybrid|electric|mhev)\b/i;

function rowCategoryText(row) {
  return [
    row.title,
    row.stock_url,
    row.stockUrl,
    row.vansco_id,
    row.vehicle_type,
    row.vehicleCategory,
  ].filter(Boolean).join(" ");
}

function looksLikeVan(row) {
  const text = rowCategoryText(row);
  return VAN_KEYWORDS.test(text) || VAN_PHRASES.test(text) || /used-vans|no-vat-vans/i.test(text);
}

function looksLikeCar(row) {
  const text = rowCategoryText(row);
  if (looksLikeVan(row)) return false;
  return CAR_KEYWORDS.test(text) || /used-cars/i.test(text) || String(row.vehicle_type || row.vehicleCategory || "").toLowerCase() === "car";
}

function rowMatchesPipeline(row, pipeline) {
  if (pipeline === "cars") return looksLikeCar(row);
  return !looksLikeCar(row);
}

function isReservedLikeStatus(status) {
  return ["reserved", "sold", "deposit_taken"].includes(String(status || "").toLowerCase());
}

function actionKeys(row) {
  const reg = normalizeRegistration(row.registration);
  const url = normalizeUrl(row.stock_url || row.stockUrl || row.stock_url_raw || "");
  const vanscoId = String(row.vansco_id || row.vanscoId || extractVanscoId(url) || "").toLowerCase();
  return { reg, url, vanscoId };
}

function recordKeys(row) {
  const reg = normalizeRegistration(row.registration);
  const url = normalizeUrl(row.stock_url || row.stockUrl || "");
  const vanscoId = String(row.vansco_id || row.vanscoId || extractVanscoId(url) || "").toLowerCase();
  return { reg, url, vanscoId };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const pipeline = String(request.query?.pipeline || "finance").toLowerCase();
    const supabase = getSupabaseAdmin();

    const { data: cacheRows, error: cacheError } = await supabase
      .from(CACHE_TABLE)
      .select("*")
      .order("last_seen_in_url_list_at", { ascending: false })
      .limit(2000);

    if (cacheError) throw cacheError;

    const { data: watchRows, error: watchError } = await supabase
      .from(WATCH_TABLE)
      .select("*")
      .eq("pipeline", pipeline)
      .limit(2000);

    if (watchError) throw watchError;

    const pipelineCacheRows = (cacheRows || []).filter((row) => rowMatchesPipeline(row, pipeline));
    const currentRows = (cacheRows || []).filter((row) => row.is_currently_on_vansco !== false);
    const currentPipelineRows = pipelineCacheRows.filter((row) => row.is_currently_on_vansco !== false);

    const actionByRegistration = new Map();
    const actionByUrl = new Map();
    const actionByVanscoId = new Map();

    (watchRows || []).forEach((row) => {
      const normalized = normalizeActionRecord(row);
      const keys = actionKeys(row);
      if (keys.reg) actionByRegistration.set(keys.reg, normalized);
      if (keys.url) actionByUrl.set(keys.url, normalized);
      if (keys.vanscoId) actionByVanscoId.set(keys.vanscoId, normalized);
    });

    const records = pipelineCacheRows.map((row) => {
      const keys = recordKeys(row);
      const action =
        (keys.reg && actionByRegistration.get(keys.reg)) ||
        (keys.url && actionByUrl.get(keys.url)) ||
        (keys.vanscoId && actionByVanscoId.get(keys.vanscoId)) ||
        null;
      return normalizeCacheRow(row, action);
    });

    const ignoredOnly = (watchRows || [])
      .map(normalizeActionRecord)
      .filter((row) => {
        const keys = actionKeys(row);
        const inCache = records.some((record) => {
          const recordKey = recordKeys(record);
          return Boolean(
            (keys.reg && recordKey.reg === keys.reg) ||
            (keys.url && recordKey.url === keys.url) ||
            (keys.vanscoId && recordKey.vanscoId === keys.vanscoId)
          );
        });
        return !inCache && (row.workflowStatus === "ignored" || String(row.workflowStatus || "").startsWith("not_listing_"));
      });

    const allRecords = [...records, ...ignoredOnly];
    const cachedRegs = currentPipelineRows.filter((row) => normalizeRegistration(row.registration)).length;
    const currentNoRegistrationCount = currentPipelineRows.filter((row) => !normalizeRegistration(row.registration)).length;
    const currentReservedCount = currentPipelineRows.filter((row) => isReservedLikeStatus(row.source_status)).length;
    const currentAvailableOrUnknownCount = currentPipelineRows.filter((row) => !isReservedLikeStatus(row.source_status)).length;
    const currentCheckedCount = currentPipelineRows.filter((row) => row.last_successfully_checked_at || row.last_attempted_at).length;
    const currentUncheckedCount = Math.max(0, currentPipelineRows.length - currentCheckedCount);

    const detailRefreshedToday = currentPipelineRows.filter((row) => {
      if (!row.last_successfully_checked_at) return false;
      const checked = new Date(row.last_successfully_checked_at);
      const now = new Date();
      return checked.toDateString() === now.toDateString();
    }).length;

    const latestUrlListCheckedAt = currentRows.reduce((latest, row) => {
      const value = row.last_seen_in_url_list_at ? new Date(row.last_seen_in_url_list_at).getTime() : 0;
      return Math.max(latest, value || 0);
    }, 0);

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      pipeline,
      records: allRecords,
      summary: {
        currentUrlCount: currentRows.length,
        currentPipelineUrlCount: currentPipelineRows.length,
        hiddenOtherTabTypeCount: Math.max(0, currentRows.length - currentPipelineRows.length),
        cachedRegs,
        usableCachedRegistrations: cachedRegs,
        currentNoRegistrationCount,
        currentReservedCount,
        currentAvailableOrUnknownCount,
        currentCheckedCount,
        currentUncheckedCount,
        detailRefreshedToday,
        failedDetailChecks: currentPipelineRows.filter((row) => Number(row.fail_count || 0) > 0).length,
        latestUrlListCheckedAt: latestUrlListCheckedAt ? new Date(latestUrlListCheckedAt).toISOString() : "",
        totalsNote: "Cars tab excludes van, pickup, motorhome and commercial keywords. Ignore/Delete-Block matching uses registration, normalized URL, and Vansco stock ID so blocks persist after reload.",
      },
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Could not load Vansco cache records." });
  }
}
