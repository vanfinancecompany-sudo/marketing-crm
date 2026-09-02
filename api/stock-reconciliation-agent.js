import { createClient } from "@supabase/supabase-js";

const MAX_AI_EXCEPTIONS = 90;
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

function sourceRecord(row) {
  return {
    id: row.id,
    pipeline: clean(row.pipeline, 30),
    registration: normaliseRegistration(row.registration),
    title: clean(row.title, 180),
    price: parsePrice(row.price),
    mileage: clean(row.mileage, 40),
    year: clean(row.year, 10),
    category: clean(row.vehicle_category, 40),
    source_status: clean(row.source_status, 40).toLowerCase(),
    workflow_status: clean(row.workflow_status, 60).toLowerCase(),
    match_status: clean(row.match_status, 60).toLowerCase(),
    last_seen_at: row.last_seen_at || null,
    last_checked_at: row.last_checked_at || null,
  };
}

function isReserved(row) {
  return ["reserved", "sold", "deposit_taken"].includes(row.source_status);
}

function deterministicReconciliation(sourceRows, localByPipeline) {
  const exceptions = [];
  const metrics = {};

  for (const pipeline of ["finance", "rent2buy", "cars"]) {
    const source = sourceRows.filter((row) => row.pipeline === pipeline);
    const local = localByPipeline[pipeline] || [];
    const localRegs = new Set(local.map((row) => row.registration).filter(Boolean));
    const sourceRegs = new Set(source.map((row) => row.registration).filter(Boolean));
    const sourceCounts = new Map();

    for (const row of source) {
      if (row.registration) sourceCounts.set(row.registration, (sourceCounts.get(row.registration) || 0) + 1);
    }

    const missingFromLocal = source.filter((row) =>
      row.registration &&
      !localRegs.has(row.registration) &&
      !isReserved(row) &&
      !SUPPRESSED_WORKFLOWS.has(row.workflow_status)
    );
    const localNotSource = local.filter((row) => row.registration && !sourceRegs.has(row.registration));
    const duplicates = source.filter((row) => row.registration && (sourceCounts.get(row.registration) || 0) > 1);
    const noRegistration = source.filter((row) => !row.registration);
    const stale = source.filter((row) => {
      const stamp = new Date(row.last_checked_at || row.last_seen_at || 0).getTime();
      return !stamp || Date.now() - stamp > 36 * 60 * 60 * 1000;
    });
    const priceDifferences = pipeline === "finance"
      ? source.flatMap((row) => {
          if (!row.registration || row.price === null) return [];
          const localRow = local.find((item) => item.registration === row.registration && item.price !== null);
          if (!localRow || localRow.price === row.price) return [];
          return [{ source: row, local: localRow }];
        })
      : [];

    metrics[pipeline] = {
      source_records: source.length,
      source_registrations: sourceRegs.size,
      local_records: local.length,
      local_registrations: localRegs.size,
      missing_from_local: missingFromLocal.length,
      local_not_source: localNotSource.length,
      duplicate_source_rows: duplicates.length,
      no_registration: noRegistration.length,
      stale_source_rows: stale.length,
      price_differences: priceDifferences.length,
    };

    missingFromLocal.slice(0, 35).forEach((row) => exceptions.push({
      type: "missing_from_local",
      pipeline,
      registration: row.registration,
      title: row.title,
      source_status: row.source_status,
      workflow_status: row.workflow_status,
      source_price: row.price,
    }));
    localNotSource.slice(0, 25).forEach((row) => exceptions.push({
      type: "local_not_source",
      pipeline,
      registration: row.registration,
      title: row.title,
      local_price: row.price,
    }));
    [...new Map(duplicates.map((row) => [row.registration, row])).values()].slice(0, 15).forEach((row) => exceptions.push({
      type: "duplicate_source_registration",
      pipeline,
      registration: row.registration,
      title: row.title,
      duplicate_count: sourceCounts.get(row.registration),
    }));
    priceDifferences.slice(0, 20).forEach(({ source: row, local }) => exceptions.push({
      type: "price_difference",
      pipeline,
      registration: row.registration,
      title: row.title || local.title,
      source_price: row.price,
      local_price: local.price,
      difference: Math.abs(local.price - row.price),
    }));
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
            "Deterministic registration matching has already been performed. Do not override exact matches and do not pretend to change any system.",
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
    const [watchResult, financeResult, rentResult, carsResult] = await Promise.all([
      supabase
        .from("vansco_stock_watch")
        .select("id,pipeline,title,registration,price,mileage,year,vehicle_category,source_status,match_status,workflow_status,last_seen_at,last_checked_at")
        .limit(3000),
      supabase.from("facebook_adverts").select("title,price,weblink,is_active").eq("is_active", true).limit(2000),
      supabase.from("rent_vehicles").select("registration,monthly,webLink,is_active").eq("is_active", true).limit(2000),
      supabase.from("car_adverts").select("title,registration,price,weblink,is_active").eq("is_active", true).limit(1000),
    ]);

    const sourceRows = assertResult(watchResult, "Stock Watch could not be read").map(sourceRecord);
    const localByPipeline = {
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

    const reconciliation = deterministicReconciliation(sourceRows, localByPipeline);
    let report = null;
    let aiError = "";
    try {
      report = await aiReview(reconciliation);
    } catch (error) {
      aiError = error?.message || "The AI review could not complete.";
    }

    if (!report) {
      const totalMissing = Object.values(reconciliation.metrics).reduce((sum, item) => sum + Number(item.missing_from_local || 0), 0);
      const totalDuplicates = Object.values(reconciliation.metrics).reduce((sum, item) => sum + Number(item.duplicate_source_rows || 0), 0);
      report = {
        summary: `Deterministic reconciliation completed. ${totalMissing} source vehicle${totalMissing === 1 ? " is" : "s are"} missing from local stock and ${totalDuplicates} duplicate source row${totalDuplicates === 1 ? " was" : "s were"} detected.`,
        priority_exceptions: reconciliation.exceptions.slice(0, 12).map((item) => ({
          registration: item.registration || "No registration",
          pipeline: item.pipeline || "unknown",
          reason: item.type.replaceAll("_", " "),
          review: "Open this record and confirm the source/local data before taking any action.",
        })),
        patterns: [],
        next_steps: ["Review the priority exceptions. No stock records have been changed."],
      };
    }

    return response.status(200).json({
      ok: true,
      read_only: true,
      checked_at: new Date().toISOString(),
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
