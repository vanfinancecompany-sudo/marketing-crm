import { createClient } from "@supabase/supabase-js";

const SEND_ID = "93bbe921-e706-4f46-86df-e3857b46a954";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false });
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase server configuration.");
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const result = await supabase
      .from("marketing_email_send_recipients")
      .select("status")
      .eq("send_id", SEND_ID)
      .eq("send_type", "production")
      .limit(600);
    if (result.error) throw result.error;
    const distribution = {};
    for (const row of result.data || []) {
      const status = String(row.status || "blank").toLowerCase();
      distribution[status] = (distribution[status] || 0) + 1;
    }
    return response.status(200).json({ ok: true, send_id: SEND_ID, total: (result.data || []).length, distribution });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
