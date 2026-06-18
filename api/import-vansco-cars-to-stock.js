import {
  detectVehicleCategory,
  getSupabaseAdmin,
  normalizeRegistration,
  normalizeUrl,
} from "./_vansco-cache-utils.js";

const CARS_STOCK_TABLE = process.env.VITE_CARS_STOCK_TABLE || "car_adverts";
const RESERVED_STATUSES = new Set(["reserved", "sold", "deposit_taken"]);

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isPlaceholderRegistration(value) {
  return /^REG\d+HERE$/i.test(String(value || ""));
}

function sourceStatusOf(record) {
  return String(record?.sourceStatus || record?.source_status || "").toLowerCase();
}

function isCurrentOnVansco(record) {
  if (record?.isCurrentlyOnVansco === false) return false;
  if (record?.is_currently_on_vansco === false) return false;
  return true;
}

function isCarsRecord(record) {
  const explicitCategory = String(record?.vehicleCategory || record?.vehicle_category || "").toLowerCase();
  if (explicitCategory === "car") return true;

  const detected = detectVehicleCategory(
    record?.title || "",
    record?.stockUrl || record?.stock_url || ""
  );
  return detected === "car";
}

function mapImportPayload(record, registration) {
  return {
    title: compactWhitespace(record?.title || `Car ${registration}`),
    registration,
    picture: compactWhitespace(record?.imageUrl || record?.image_url || record?.picture || ""),
    price: compactWhitespace(record?.price || ""),
    salePrice: compactWhitespace(record?.salePrice || record?.sale_price || ""),
    description: compactWhitespace(record?.description || record?.carDescription || ""),
    spec: compactWhitespace(record?.spec || record?.carSpec || ""),
    weblink: normalizeUrl(record?.stockUrl || record?.stock_url || record?.weblink || record?.webLink || ""),
    is_active: true,
  };
}

function validateRecord(record) {
  const registration = normalizeRegistration(record?.registration || record?.reg || "");
  if (!registration || isPlaceholderRegistration(registration)) {
    return { ok: false, reason: "missing registration", registration: registration || "" };
  }

  if (!isCarsRecord(record)) {
    return { ok: false, reason: "not cars", registration };
  }

  if (!isCurrentOnVansco(record)) {
    return { ok: false, reason: "not currently on Vansco", registration };
  }

  const sourceStatus = sourceStatusOf(record);
  if (RESERVED_STATUSES.has(sourceStatus)) {
    return { ok: false, reason: "reserved/sold", registration };
  }

  return { ok: true, registration };
}

async function upsertCarByRegistration(supabase, payload) {
  const { data: existing, error: readError } = await supabase
    .from(CARS_STOCK_TABLE)
    .select("registration")
    .eq("registration", payload.registration)
    .limit(1)
    .maybeSingle();

  if (readError) throw readError;

  if (existing?.registration) {
    const { data, error } = await supabase
      .from(CARS_STOCK_TABLE)
      .update(payload)
      .eq("registration", payload.registration)
      .select("registration")
      .single();
    if (error) throw error;
    return { action: "updated", row: data };
  }

  const { data, error } = await supabase
    .from(CARS_STOCK_TABLE)
    .insert(payload)
    .select("registration")
    .single();
  if (error) throw error;
  return { action: "inserted", row: data };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    if (!CARS_STOCK_TABLE) {
      response.status(400).json({ ok: false, message: "Cars stock table is not configured." });
      return;
    }

    const body = await readJsonBody(request);
    const records = Array.isArray(body.records) ? body.records : [];
    if (!records.length) {
      response.status(400).json({ ok: false, message: "No Cars records were supplied." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const results = [];
    const skipped = [];

    for (const record of records) {
      const validation = validateRecord(record);
      if (!validation.ok) {
        skipped.push({
          registration: validation.registration || compactWhitespace(record?.registration || ""),
          title: compactWhitespace(record?.title || ""),
          reason: validation.reason,
        });
        continue;
      }

      try {
        const payload = mapImportPayload(record, validation.registration);
        const result = await upsertCarByRegistration(supabase, payload);
        results.push({
          registration: payload.registration,
          title: payload.title,
          action: result.action,
        });
      } catch (error) {
        skipped.push({
          registration: validation.registration,
          title: compactWhitespace(record?.title || ""),
          reason: error?.message || "upsert failed",
        });
      }
    }

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      table: CARS_STOCK_TABLE,
      imported: results.length,
      inserted: results.filter((item) => item.action === "inserted").length,
      updated: results.filter((item) => item.action === "updated").length,
      skipped: skipped.length,
      results,
      skippedDetails: skipped,
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Could not import Vansco Cars to stock." });
  }
}
