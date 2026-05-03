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

function uuidOrEmpty(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function storedWorkflowStatus(requestedStatus) {
  const status = String(requestedStatus || "new").toLowerCase();

  // Supabase table constraints already allow the older not_listing_* values.
  // Use not_listing_spec as the stored permanent no-go value and label it
  // as "Never show again" in the UI.
  if (status === "never_show_again" || status === "hard_delete") return "not_listing_spec";
  if (status === "hidden") return "ignored";
  return status;
}

async function findExistingAction({ supabase, pipeline, registration, stockUrl, actionId }) {
  if (actionId) {
    const { data, error } = await supabase
      .from(WATCH_TABLE)
      .select("*")
      .eq("id", actionId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (registration) {
    const { data, error } = await supabase
      .from(WATCH_TABLE)
      .select("*")
      .eq("pipeline", pipeline)
      .eq("registration", registration)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (stockUrl) {
    const { data, error } = await supabase
      .from(WATCH_TABLE)
      .select("*")
      .eq("pipeline", pipeline)
      .eq("stock_url", stockUrl)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  return null;
}

async function removeExistingAction({ supabase, pipeline, registration, stockUrl, actionId }) {
  let deleted = null;

  if (actionId) {
    const { data, error } = await supabase
      .from(WATCH_TABLE)
      .delete()
      .eq("id", actionId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (data) deleted = data;
  }

  if (!deleted && registration) {
    const { data, error } = await supabase
      .from(WATCH_TABLE)
      .delete()
      .eq("pipeline", pipeline)
      .eq("registration", registration)
      .select("*");
    if (error) throw error;
    if (Array.isArray(data) && data[0]) deleted = data[0];
  }

  if (!deleted && stockUrl) {
    const { data, error } = await supabase
      .from(WATCH_TABLE)
      .delete()
      .eq("pipeline", pipeline)
      .eq("stock_url", stockUrl)
      .select("*");
    if (error) throw error;
    if (Array.isArray(data) && data[0]) deleted = data[0];
  }

  return deleted;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const pipeline = String(body.pipeline || "finance").toLowerCase();
    const requestedWorkflowStatus = String(body.workflowStatus || "new").toLowerCase();
    const workflowStatus = storedWorkflowStatus(requestedWorkflowStatus);
    const notes = body.notes || "";
    const record = body.record || {};
    const supabase = getSupabaseAdmin();

    const registration = normalizeRegistration(record.registration);
    const stockUrl = normalizeUrl(record.stockUrl || record.stock_url);
    const actionId = uuidOrEmpty(record.watchActionId || record.watch_action_id || "");
    const payload = cacheRowToActionPayload(pipeline, record, workflowStatus, notes);

    if (requestedWorkflowStatus === "new") {
      await removeExistingAction({ supabase, pipeline, registration, stockUrl, actionId });
      response.setHeader("Cache-Control", "no-store, max-age=0");
      response.status(200).json({
        ok: true,
        record: {
          ...record,
          workflowStatus: "new",
          workflow_status: "new",
          watchActionId: "",
          notes,
        },
      });
      return;
    }

    const existing = await findExistingAction({ supabase, pipeline, registration, stockUrl, actionId });

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
