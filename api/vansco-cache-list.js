import {
  CACHE_TABLE,
  WATCH_TABLE,
  extractVanscoId,
  getSupabaseAdmin,
  normalizeActionRecord,
  normalizeCacheRow,
  normalizeRegistration,
  normalizeUrl,
  optionalTableReason,
} from "./_vansco-cache-utils.js";

const VAN_KEYWORDS = /\b(transit|transit custom|custom|tipper|dropside|luton|crew van|minibus|panel van|box van|pickup|pick-up|chassis cab|relay|dispatch|scudo|daily|doblo|partner|berlingo|sprinter|crafter|vito|evito|e-vito|vivaro|movano|box-van|kangoo|trafic|traffic|master|ducato|talento|expert|transporter|caddy|maxus|combo|proace|primastar|nv200|nv300|bailey|pegasus|winnebago|motorhome|caravan|camper|townstar|vn5|levc|boxer|relay|jumper|bipper|nemo|vauxhall combo|citroen nemo|peugeot partner|mercedes-benz evito|mercedes evito)\b/i;
const VAN_PHRASES = /\b(l1h1|l2h1|l3h2|panel van|double cab|crew cab|welfare|dropside|tail lift|twin side loading door|high roof|medium roof|long wheelbase|short wheelbase|crew bus|crew van|double cab|commercial vehicle|black cab|city van|leader van|minibus)\b/i;
const CAR_KEYWORDS = /\b(audi|bmw|jaguar|jeep|kia|lexus|mercedes-benz|mercedes|skoda|suzuki|hyundai|tesla|q2|q3|a1|a3|a4|a5|i10|i20|estate|hatchback|cabriolet|suv|coupe|saloon|convertible|sportback|xdrive|petrol|hybrid|electric|mhev)\b/i;
const COMMERCIAL_NEGATIVE_KEYWORDS = /\b(van|minibus|panel|commercial|crew|cab|pickup|pick-up|motorhome|camper|chassis|luton|dropside|taxi|black cab|city van|leader van)\b/i;

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
  const explicitCategory = String(row.vehicle_type || row.vehicleCategory || "").toLowerCase();
  const explicitCar = explicitCategory === "car" || /used-cars/i.test(text);

  if (looksLikeVan(row)) return false;
  if (COMMERCIAL_NEGATIVE_KEYWORDS.test(text)) return false;

  return explicitCar || CAR_KEYWORDS.test(text);
}

function rowMatchesPipeline(row, pipeline) {
  if (pipeline === "cars") return looksLikeCar(row);
  return !looksLikeCar(row);
}

function isReservedLikeStatus(status) {
  return ["reserved", "sold", "deposit_taken"].includes(String(status || "").toLowerCase());
}

function workflowStatusOf(row) {
  return String(row?.workflowStatus || row?.workflow_status || "");
}

function isBlockedAction(row) {
  const status = workflowStatusOf(row);
  return status === "ignored" || status.startsWith("not_listing_");
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

function applyMatchedAction(cacheRecord, action) {
  const normalized = normalizeCacheRow(cacheRecord, action);
  if (!action) return normalized;

  const workflowStatus = workflowStatusOf(action);
  return {
    ...normalized,
    watchActionId: action.id || action.watchActionId || normalized.watchActionId || "",
    workflowStatus,
    workflow_status: workflowStatus,
    notes: action.notes ?? normalized.notes ?? "",
    actionMatched: true,
  };
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

    if (cacheError) {
      response.setHeader("Cache-Control", "no-store, max-age=0");
      response.status(200).json({
        ok: false,
        pipeline,
        records: [],
        summary: {
          currentUrlCount: 0,
          currentPipelineUrlCount: 0,
          cachedRegs: 0,
          usableCachedRegistrations: 0,
          currentNoRegistrationCount: 0,
          currentReservedCount: 0,
          currentAvailableOrUnknownCount: 0,
          currentCheckedCount: 0,
          currentUncheckedCount: 0,
          detailRefreshedToday: 0,
          failedDetailChecks: 0,
          latestUrlListCheckedAt: "",
          warning: optionalTableReason(cacheError),
        },
        message: "Vansco cache is unavailable. Showing saved comparison if available.",
      });
      return;
    }

    const { data: watchRows, error: watchError } = await supabase
      .from(WATCH_TABLE)
      .select("*")
      .eq("pipeline", pipeline)
      .limit(2000);

    if (watchError) {
      response.setHeader("Cache-Control", "no-store, max-age=0");
      response.status(200).json({
        ok: false,
        pipeline,
        records: [],
        summary: {},
        message: "Vansco Stock Watch actions are unavailable. Showing saved comparison if available.",
        warning: optionalTableReason(watchError),
      });
      return;
    }

    const safeWatchRows = watchRows || [];

    const pipelineCacheRows = (cacheRows || []).filter((row) => rowMatchesPipeline(row, pipeline));
    const currentRows = (cacheRows || []).filter((row) => row.is_currently_on_vansco !== false);
    const currentPipelineRows = pipelineCacheRows.filter((row) => row.is_currently_on_vansco !== false);

    const actionByRegistration = new Map();
    const actionByUrl = new Map();
    const actionByVanscoId = new Map();

    safeWatchRows.forEach((row) => {
      const normalized = normalizeActionRecord(row);
      const action = {
        ...normalized,
        workflowStatus: workflowStatusOf(normalized) || workflowStatusOf(row),
        workflow_status: workflowStatusOf(normalized) || workflowStatusOf(row),
        notes: normalized.notes ?? row.notes ?? "",
      };
      const keys = actionKeys(row);
      if (keys.reg) actionByRegistration.set(keys.reg, action);
      if (keys.url) actionByUrl.set(keys.url, action);
      if (keys.vanscoId) actionByVanscoId.set(keys.vanscoId, action);
    });

    const records = pipelineCacheRows.map((row) => {
      const keys = recordKeys(row);
      const action =
        (keys.reg && actionByRegistration.get(keys.reg)) ||
        (keys.url && actionByUrl.get(keys.url)) ||
        (keys.vanscoId && actionByVanscoId.get(keys.vanscoId)) ||
        null;
      return applyMatchedAction(row, action);
    });

    const ignoredOnly = safeWatchRows
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
        return !inCache && isBlockedAction(row);
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
        totalsNote: "Cars tab excludes van, pickup, motorhome, taxi, minibus and commercial keywords. Hidden/Never Show matching uses registration, normalized URL, and Vansco stock ID.",
      },
    });
  } catch (error) {
    response.status(200).json({ ok: false, records: [], summary: {}, message: error?.message || "Could not load Vansco cache records." });
  }
}
