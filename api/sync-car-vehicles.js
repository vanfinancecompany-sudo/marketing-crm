import { getSupabaseAdmin } from "./_vansco-cache-utils.js";

const TARGET_TABLE = "car_adverts";
const REGISTRATION_FIELDS = [
  "registration",
  "reg",
  "vehicleRegistration",
  "vehicleReg",
  "numberPlate",
];

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeRegistration(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getRegistration(row) {
  for (const field of REGISTRATION_FIELDS) {
    const value = normalizeRegistration(row?.[field]);
    if (value) return value;
  }
  return "";
}

function getTitle(row) {
  return clean(row?.title || row?.name || row?.vehicle || row?.carTitle || row?.makeModel || "");
}

function mapCarRow(row) {
  const title = getTitle(row);
  const registration = getRegistration(row);

  if (!title || !registration) {
    return {
      ok: false,
      reason: !title ? "missing title" : "missing registration",
      registration,
      title,
    };
  }

  return {
    ok: true,
    payload: {
      title,
      registration,
      picture: clean(row?.picture || row?.image || row?.imageUrl || row?.image_url || ""),
      price: clean(row?.price || row?.cashPrice || row?.vehiclePrice || ""),
      salePrice: clean(row?.salePrice || row?.monthly || row?.financeMonthly || ""),
      description: clean(row?.description || row?.descriptionText || row?.carDescription || ""),
      spec: clean(row?.spec || row?.carSpec || row?.vehicleSpec || ""),
      weblink: clean(row?.weblink || row?.webLink || row?.link || ""),
      is_active: true,
    },
  };
}

async function upsertCarByRegistration(supabase, payload) {
  const { data: existing, error: readError } = await supabase
    .from(TARGET_TABLE)
    .select("registration")
    .eq("registration", payload.registration)
    .limit(1)
    .maybeSingle();

  if (readError) throw readError;

  if (existing?.registration) {
    const { data, error } = await supabase
      .from(TARGET_TABLE)
      .update(payload)
      .eq("registration", payload.registration)
      .select("registration")
      .single();
    if (error) throw error;
    return { action: "updated", row: data };
  }

  const { data, error } = await supabase
    .from(TARGET_TABLE)
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
    const body = await readJsonBody(request);
    const rows = Array.isArray(body) ? body : Array.isArray(body?.vehicles) ? body.vehicles : [];

    if (!rows.length) {
      response.status(400).json({ ok: false, message: "Expected a JSON array of Cars vehicles." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const results = [];
    const skipped = [];

    for (const row of rows) {
      const mapped = mapCarRow(row);
      if (!mapped.ok) {
        skipped.push({
          registration: mapped.registration || clean(row?.registration || row?.reg || ""),
          title: mapped.title || getTitle(row),
          reason: mapped.reason,
        });
        continue;
      }

      try {
        const result = await upsertCarByRegistration(supabase, mapped.payload);
        results.push({
          registration: mapped.payload.registration,
          title: mapped.payload.title,
          action: result.action,
        });
      } catch (error) {
        skipped.push({
          registration: mapped.payload.registration,
          title: mapped.payload.title,
          reason: error?.message || "upsert failed",
        });
      }
    }

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      table: TARGET_TABLE,
      received: rows.length,
      synced: results.length,
      inserted: results.filter((item) => item.action === "inserted").length,
      updated: results.filter((item) => item.action === "updated").length,
      skipped: skipped.length,
      results,
      skippedDetails: skipped,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: error?.message || "Could not sync Cars vehicles.",
    });
  }
}
