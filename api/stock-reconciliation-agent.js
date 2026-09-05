import { createClient } from "@supabase/supabase-js";
import { loadLiveWixListingPresence } from "./stock-watch-wix-listing-presence.js";

const MAX_AI_EXCEPTIONS = 90;
const SOURCE_FRESH_MS = 36 * 60 * 60 * 1000;
const SUPPRESSED_WORKFLOWS = new Set([
  "ignored",
  "hidden",
  "never_show_again",
  "not_listing_mileage",
  "not_listing_price",
  "not_listing_spec",
]);

function clean(value, max = 500) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function normaliseRegistration(value) {
  const text = clean(value, 80).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!text || text.length < 5 || text.length > 8) return "";
  if (!/[A-Z]/.test(text) || !/[0-9]/.test(text)) return "";
  return text;
}

function parsePrice(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function sameOrigin(request) {
  const origin = clean(request.headers.origin, 500);
  const host = clean(request.headers["x-forwarded-host"] || request.headers.host, 300).toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured for stock reconciliation.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function assertResult(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data || [];
}

function financeRegistration(row) {
  return normaliseRegistration(row?.registration || row?.reg || row?.title);
}

function localRecord(row, pipeline) {
  return {
    pipeline,
    registration: pipeline === "finance" ? financeRegistration(row) : normaliseRegistration(row?.registration),
    title: clean(row?.title || row?.registration || "", 180),
    price: parsePrice(row?.price),
    web_link: clean(row?.weblink || row?.webLink || "", 500),
  };
}

function watchRecord(row) {
  return {
    id: row.id,
    pipeline: clean(row.pipeline, 30).toLowerCase(),
    registration: normaliseRegistration(row.registration),
    title: clean(row.title, 180),
    mileage: clean(row.mileage, 40),
    year: clean(row.year, 10),
    category: clean(row.vehicle_category, 40),
    workflow_status: clean(row.workflow_status, 60).toLowerCase(),
    match_status: clean(row.match_status, 60).toLowerCase(),
    last_seen_at: row.last_seen_at || null,
    last_checked_at: row.last_checked_at || null,
  };
}

function cacheRecord(row) {
  return {
    registration: normaliseRegistration(row.registration),
    title: clean(row.title, 180),
    price: parsePrice(row.advertised_price ?? row.advertised_price_text),
    source_status: clean(row.source_status, 40).toLowerCase(),
    last_seen_at: row.last_seen_in_url_list_at || null,
    last_checked_at: row.last_successfully_checked_at || row.updated_at || null,
  };
}

function recordTime(row) {
  const stamp = new Date(row?.last_checked_at || row?.last_seen_at || 0).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

function latestWatchRows(rows) {
  const latest = new Map();
  for (const raw of rows) {
    const row = watchRecord(raw);
    if (!row.pipeline || !row.registration) continue;
    const key = `${row.pipeline}:${row.registration}`;
    const existing = latest.get(key);
    if (!existing || recordTime(row) >= recordTime(existing)) latest.set(key, row);
  }
  return Array.from(latest.values());
}

function buildCurrentSourceRows(watchRows, cacheRows) {
  const currentCache = new Map(
    cacheRows
      .map(cacheRecord)
      .filter((row) => row.registration)
      .map((row) => [row.registration, row])
  );

  return latestWatchRows(watchRows).flatMap((watch) => {
    const current = currentCache.get(watch.registration);
    if (!current) return [];
    return [{
      id: watch.id,
      pipeline: watch.pipeline,
      registration: watch.registration,
      title: current.title || watch.title,
      price: current.price,
      mileage: watch.mileage,
      year: watch.year,
      category: watch.category,
      source_status: current.source_status,
      workflow_status: watch.workflow_status,
      match_status: watch.match_status,
      last_seen_at: current.last_seen_at,
      last_checked_at: current.last_checked_at,
    }];
  });
}

function isReserved(row) {
  return ["reserved", "sold", "deposit_taken"].includes(row.source_status);
}

function isStale(row) {
  const stamp = recordTime(row);
  return !stamp || Date.now() - stamp > SOURCE_FRESH_MS;
}

function websiteRecord(row, pipeline) {
  return {
    pipeline,
    registration: normaliseRegistration(row?.registration),
    title: clean(row?.title || row?.registration || "", 180),
    price: parsePrice(row?.price),
    web_link: "",
  };
}

function wixSettledResult(result, pipeline) {
  if (result.status === "fulfilled") return result.value;
  return {
    ok: false,
    pipeline,
    complete: false,
    registrations: [],
    vehicles: [],
    registrationCount: 0,
    authority: "Wix check failed",
    errors: [{ error: clean(result.reason?.message || result.reason || "Wix listing check failed.") }],
  };
}

function deterministicReconciliation(sourceRows, comparisonByPipeline, crmByPipeline, wixState) {
  const exceptions = [];
  const metrics = {};

  for (const pipeline of ["finance", "rent2buy", "cars"]) {
    const allSource = sourceRows.filter((row) => row.pipeline === pipeline);
    const stale = allSource.filter(isStale);
    const source = allSource.filter((row) =>
      row.registration &&
      !isStale(row) &&
      !isReserved(row) &&
      !SUPPRESSED_WORKFLOWS.has(row.workflow_status)
    );
    const comparison = comparisonByPipeline[pipeline] || [];
    const crm = crmByPipeline[pipeline] || [];
    const wix = wixState[pipeline] || { complete: false, authority: "Marketing CRM fallback" };

    const sourceRegs = new Set(source.map((row) => row.registration).filter(Boolean));
    const comparisonRegs = new Set(comparison.map((row) => row.registration).filter(Boolean));
    const crmRegs = new Set(crm.map((row) => row.registration).filter(Boolean));

    const missingFromComparison = source.filter((row) => row.registration && !comparisonRegs.has(row.registration));
    const comparisonNotSource = comparison.filter((row) => row.registration && !sourceRegs.has(row.registration));
    const crmNotWebsite = wix.complete ? crm.filter((row) => row.registration && !comparisonRegs.has(row.registration)) : [];
    const websiteNotCrm = wix.complete ? comparison.filter((row) => row.registration && !crmRegs.has(row.registration)) : [];

    const priceDifferences = pipeline === "finance"
      ? source.flatMap((row) => {
          if (!row.registration || row.price === null) return [];
          const websiteRow = comparison.find((item) => item.registration === row.registration && item.price !== null);
          if (!websiteRow || websiteRow.price === row.price) return [];
          return [{ source: row, local: websiteRow }];
        })
      : [];

    metrics[pipeline] = {
      source_records: source.length,
      source_registrations: sourceRegs.size,
      local_records: comparison.length,
      local_registrations: comparisonRegs.size,
      missing_from_local: missingFromComparison.length,
      local_not_source: comparisonNotSource.length,
      duplicate_source_rows: 0,
      no_registration: 0,
      stale_source_rows: stale.length,
      price_differences: priceDifferences.length,
      crm_records: crm.length,
      crm_registrations: crmRegs.size,
      crm_not_wix: crmNotWebsite.length,
      wix_not_crm: websiteNotCrm.length,
      wix_complete: Boolean(wix.complete),
      comparison_authority: wix.complete ? wix.authority : "Marketing CRM fallback because Wix could not be read completely",
    };

    const missingType = wix.complete ? "missing_from_wix" : "missing_from_local_fallback";
    const extraType = wix.complete ? "wix_not_source" : "local_not_source_fallback";

    missingFromComparison.slice(0, 35).forEach((row) => exceptions.push({
      type: missingType,
      pipeline,
      registration: row.registration,
      title: row.title,
      source_status: row.source_status,
      workflow_status: row.workflow_status,
      source_price: row.price,
      authority: metrics[pipeline].comparison_authority,
    }));
    comparisonNotSource.slice(0, 25).forEach((row) => exceptions.push({
      type: extraType,
      pipeline,
      registration: row.registration,
      title: row.title,
      local_price: row.price,
      authority: metrics[pipeline].comparison_authority,
    }));
    priceDifferences.slice(0, 20).forEach(({ source: row, local }) => exceptions.push({
      type: "price_difference",
      pipeline,
      registration: row.registration,
      title: row.title || local.title,
      source_price: row.price,
      local_price: local.price,
      difference: Math.abs(local.price - row.price),
      authority: metrics[pipeline].comparison_authority,
    }));

    if (wix.complete) {
      crmNotWebsite.slice(0, 10).forEach((row) => exceptions.push({
        type: "crm_not_wix",
        pipeline,
        registration: row.registration,
        title: row.title,
        local_price: row.price,
        authority: wix.authority,
      }));
      websiteNotCrm.slice(0, 10).forEach((row) => exceptions.push({
        type: "wix_not_crm",
        pipeline,
        registration: row.registration,
        title: row.title,
        local_price: row.price,
        authority: wix.authority,
      }));
    }
  }

  return { metrics, exceptions };
}

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "priority_exceptions", "patterns", "next_steps"],
  properties: {
    summary: { type: "string" },
    priority_exceptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["registration", "pipeline", "reason", "review"],
        properties: {
          registration: { type: "string" },
          pipeline: { type: "string" },
          reason: { type: "string" },
          review: { type: "string" },
        },
      },
    },
    patterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pattern", "evidence"],
        properties: {
          pattern: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    next_steps: { type: "array", items: { type: "string" } },
  },
};

async function aiReview(reconciliation) {
  const apiKey = clean(process.env.OPENAI_API_KEY, 10000);
  if (!apiKey) return null;
  const model = clean(process.env.OPENAI_MODEL, 200) || "gpt-4.1-mini";
  const input = JSON.stringify({
    metrics: reconciliation.metrics,
    exceptions: reconciliation.exceptions.slice(0, MAX_AI_EXCEPTIONS),
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            "You are a read-only stock reconciliation analyst for a UK vehicle dealer.",
            "The source side has already been restricted to vehicles still present in the current Vansco/Dragon cache and current source prices have replaced historical Stock Watch prices.",
            "When wix_complete is true, local/comparison metrics and price differences use the canonical published Wix listing collection for that pipeline. The CRM counts are supplied separately as a secondary mirror check.",
            "Never revive a stale or historical Stock Watch row and never treat a full-page SEO/detail collection as active listing authority.",
            "Review only the supplied exception sample and metrics. Find repeated data-quality patterns, likely false positives and the highest-value records for a human to inspect.",
            "Be conservative. Never recommend deleting, publishing, hiding, repricing or editing a vehicle automatically.",
            "The only allowed recommendation is a human review or a specific data check.",
            "Use British English and keep the report operational and concise.",
          ].join(" "),
        },
        { role: "user", content: input },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "stock_reconciliation_report",
          strict: true,
          schema: REPORT_SCHEMA,
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `AI service returned ${response.status}.`);
  const output = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new Error("The reconciliation agent returned no report.");
  return JSON.parse(output);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(request)) {
    return response.status(403).json({ ok: false, error: "Stock reconciliation only accepts requests from this Marketing CRM." });
  }

  try {
    const supabase = getSupabase();
    const [watchResult, cacheResult, financeResult, rentResult, carsResult, wixSettled] = await Promise.all([
      supabase
        .from("vansco_stock_watch")
        .select("id,pipeline,title,registration,mileage,year,vehicle_category,source_status,match_status,workflow_status,last_seen_at,last_checked_at")
        .limit(3000),
      supabase
        .from("vansco_vehicle_cache")
        .select("registration,title,advertised_price,advertised_price_text,source_status,is_currently_on_vansco,last_seen_in_url_list_at,last_successfully_checked_at,updated_at")
        .eq("is_currently_on_vansco", true)
        .limit(3000),
      supabase.from("facebook_adverts").select("title,price,weblink,is_active").eq("is_active", true).limit(2000),
      supabase.from("rent_vehicles").select("registration,monthly,webLink,is_active").eq("is_active", true).limit(2000),
      supabase.from("car_adverts").select("title,registration,price,weblink,is_active").eq("is_active", true).limit(1000),
      Promise.allSettled([
        loadLiveWixListingPresence("finance"),
        loadLiveWixListingPresence("rent2buy"),
        loadLiveWixListingPresence("cars"),
      ]),
    ]);

    const sourceRows = buildCurrentSourceRows(
      assertResult(watchResult, "Stock Watch could not be read"),
      assertResult(cacheResult, "Current Vansco cache could not be read")
    );

    const crmByPipeline = {
      finance: assertResult(financeResult, "Finance stock could not be read").map((row) => localRecord(row, "finance")).filter((row) => row.registration),
      rent2buy: assertResult(rentResult, "Rent2Buy stock could not be read").map((row) => ({
        pipeline: "rent2buy",
        registration: normaliseRegistration(row.registration),
        title: normaliseRegistration(row.registration),
        price: parsePrice(row.monthly),
        web_link: clean(row.webLink, 500),
      })).filter((row) => row.registration),
      cars: assertResult(carsResult, "Car stock could not be read").map((row) => localRecord(row, "cars")).filter((row) => row.registration),
    };

    const wixState = {
      finance: wixSettledResult(wixSettled[0], "finance"),
      rent2buy: wixSettledResult(wixSettled[1], "rent2buy"),
      cars: wixSettledResult(wixSettled[2], "cars"),
    };

    const comparisonByPipeline = Object.fromEntries(
      ["finance", "rent2buy", "cars"].map((pipeline) => [
        pipeline,
        wixState[pipeline].complete
          ? (wixState[pipeline].vehicles || []).map((row) => websiteRecord(row, pipeline)).filter((row) => row.registration)
          : crmByPipeline[pipeline],
      ])
    );

    const reconciliation = deterministicReconciliation(sourceRows, comparisonByPipeline, crmByPipeline, wixState);
    let report = null;
    let aiError = "";
    try {
      report = await aiReview(reconciliation);
    } catch (error) {
      aiError = error?.message || "The AI review could not complete.";
    }

    if (!report) {
      const totalMissing = Object.values(reconciliation.metrics).reduce((sum, item) => sum + Number(item.missing_from_local || 0), 0);
      const totalPriceDifferences = Object.values(reconciliation.metrics).reduce((sum, item) => sum + Number(item.price_differences || 0), 0);
      const incompleteWix = Object.entries(reconciliation.metrics).filter(([, item]) => !item.wix_complete).map(([pipeline]) => pipeline);
      report = {
        summary: `Current-source reconciliation completed. ${totalMissing} current source vehicle${totalMissing === 1 ? " is" : "s are"} missing from the comparison authority and ${totalPriceDifferences} current price difference${totalPriceDifferences === 1 ? " was" : "s were"} detected.${incompleteWix.length ? ` Wix could not be read completely for: ${incompleteWix.join(", ")}; the Marketing CRM mirror was used as fallback.` : " Live Wix listing collections were checked for all pipelines."}`,
        priority_exceptions: reconciliation.exceptions.slice(0, 12).map((item) => ({
          registration: item.registration || "No registration",
          pipeline: item.pipeline || "unknown",
          reason: item.type.replaceAll("_", " "),
          review: `Confirm the current source and ${item.authority || "comparison"} record before taking any action.`,
        })),
        patterns: [],
        next_steps: ["Review the priority exceptions. No stock or Wix records have been changed."],
      };
    }

    return response.status(200).json({
      ok: true,
      read_only: true,
      checked_at: new Date().toISOString(),
      source_authority: "Current vansco_vehicle_cache rows intersected with the latest Stock Watch workflow classification",
      wix_authority: Object.fromEntries(Object.entries(wixState).map(([pipeline, state]) => [pipeline, {
        complete: Boolean(state.complete),
        authority: state.authority,
        registration_count: Number(state.registrationCount || 0),
        errors: state.errors || [],
      }])),
      metrics: reconciliation.metrics,
      exception_count: reconciliation.exceptions.length,
      sample_size: Math.min(reconciliation.exceptions.length, MAX_AI_EXCEPTIONS),
      ai_available: Boolean(clean(process.env.OPENAI_API_KEY, 10000)),
      ai_error: aiError,
      report,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      read_only: true,
      error: error?.message || "Stock reconciliation could not complete.",
    });
  }
}
