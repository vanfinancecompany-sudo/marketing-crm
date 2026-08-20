import { createClient } from "@supabase/supabase-js";

const ACCESS_HEADER = "x-marketing-customer-database-key";
const ACTIVITY_TYPES = ["van_finance_facebook_post", "rent2buy_facebook_post"];

function authorize(request) {
  const expected = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "");
  const supplied = String(request.headers[ACCESS_HEADER] || "");
  const authorization = String(request.headers.authorization || "");
  return Boolean(
    expected &&
      (supplied === expected || authorization === `Bearer ${expected}`),
  );
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
    return;
  }

  try {
    const days = Math.max(1, Math.min(365, Number(request.body?.days || 180)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await getSupabase()
      .from("marketing_daily_activity_events")
      .select("id,activity_date,activity_type,source,source_id,metadata,occurred_at")
      .in("activity_type", ACTIVITY_TYPES)
      .eq("source", "buffer_automation")
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(2500);
    if (result.error) throw result.error;
    response.status(200).json({ ok: true, history: result.data || [] });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error?.message || "Could not load Buffer posting history.",
    });
  }
}
