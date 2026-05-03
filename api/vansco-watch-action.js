import {
  WATCH_TABLE,
  cacheRowToActionPayload,
  getSupabaseAdmin,
  normalizeActionRecord,
  normalizeRegistration,
  normalizeUrl,
} from "./_vansco-cache-utils.js";

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const pipeline = String(body.pipeline || "finance").toLowerCase();
    const workflowStatus = String(body.workflowStatus || "new");
    const notes = body.notes || "";
    const record = body.record || {};
    const supabase = getSupabaseAdmin();

    const registration = normalizeRegistration(record.registration);
    const stockUrl = normalizeUrl(record.stockUrl || record.stock_url);
    const payload = cacheRowToActionPayload(pipeline, record, workflowStatus, notes);

    let existing = null;
    if (registration) {
      const { data, error } = await supabase
        .from(WATCH_TABLE)
        .select("*")
        .eq("pipeline", pipeline)
        .eq("registration", registration)
        .maybeSingle();
      if (error) throw error;
      existing = data;
    }

    if (!existing && stockUrl) {
      const { data, error } = await supabase
        .from(WATCH_TABLE)
        .select("*")
        .eq("pipeline", pipeline)
        .eq("stock_url", stockUrl)
        .maybeSingle();
      if (error) throw error;
      existing = data;
    }

    const query = existing
      ? supabase.from(WATCH_TABLE).update(payload).eq("id", existing.id).select("*").single()
      : supabase.from(WATCH_TABLE).insert(payload).select("*").single();

    const { data: saved, error: saveError } = await query;
    if (saveError) throw saveError;

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({ ok: true, record: normalizeActionRecord(saved) });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Could not save Vansco Stock Watch action." });
  }
}
