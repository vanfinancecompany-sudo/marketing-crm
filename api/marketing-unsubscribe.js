import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function html(response, status, body) {
  response.status(status).setHeader("Content-Type", "text/html; charset=utf-8");
  response.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marketing unsubscribe</title><style>body{margin:0;background:#eef3f8;color:#172033;font-family:Inter,Arial,sans-serif}.card{max-width:620px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #d9e2ef;border-radius:12px;box-shadow:0 12px 28px rgba(23,32,51,.08)}h1{margin:0 0 10px;font-size:26px}p{color:#667085;line-height:1.55}.ok{color:#0f8f5f}.bad{color:#c2413b}</style></head><body><main class="card">${body}</main></body></html>`);
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables.");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function verifyToken(token) {
  const secret = process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET;
  if (!secret) throw new Error("Unsubscribe is not configured.");
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) throw new Error("Invalid unsubscribe link.");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error("Invalid unsubscribe link.");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload || typeof payload !== "object") throw new Error("Invalid unsubscribe link.");
  if (!payload.exp || Date.now() > Number(payload.exp)) throw new Error("This unsubscribe link has expired.");
  if (!payload.customer_id || !payload.email) throw new Error("Invalid unsubscribe link.");
  return payload;
}

function safeText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET" && request.method !== "POST") {
    html(response, 405, `<h1 class="bad">Method not allowed</h1><p>This unsubscribe link could not be processed.</p>`);
    return;
  }
  try {
    const token = request.method === "GET" ? request.query?.token : request.body?.token;
    const payload = verifyToken(token);
    const supabase = getSupabase();
    const contactResult = await supabase
      .from("marketing_contacts")
      .select("id,customer_id,email,email_normalized")
      .eq("customer_id", safeText(payload.customer_id, 80).toUpperCase())
      .maybeSingle();
    if (contactResult.error) throw new Error(contactResult.error.message || "Could not load contact.");
    const contact = contactResult.data;
    if (!contact) throw new Error("Contact was not found.");
    const storedEmail = String(contact.email_normalized || contact.email || "").trim().toLowerCase();
    if (storedEmail !== String(payload.email || "").trim().toLowerCase()) throw new Error("This unsubscribe link does not match the current contact email.");

    const rpc = await supabase.rpc("marketing_apply_suppression", {
      p_contact_id: contact.id,
      p_type: "email_unsubscribed",
      p_reason: "One-click email unsubscribe",
      p_added_by: "Marketing unsubscribe link",
      p_notes: safeText(`campaign:${payload.campaign_id || ""} send:${payload.send_id || ""} recipient:${payload.recipient_id || ""}`, 500),
    });
    if (rpc.error) throw new Error(rpc.error.message || "Could not apply unsubscribe suppression.");
    if (payload.recipient_id) {
      await supabase
        .from("marketing_email_send_recipients")
        .update({ status: "unsubscribed", last_event_at: new Date().toISOString() })
        .eq("id", payload.recipient_id);
    }
    html(response, 200, `<h1 class="ok">You have been unsubscribed</h1><p>Your email address has been removed from future marketing emails. Your customer record has been retained for normal CRM purposes.</p>`);
  } catch (error) {
    html(response, 400, `<h1 class="bad">Unsubscribe link could not be used</h1><p>${safeText(error.message || "The link is invalid or has expired.", 300)}</p>`);
  }
}
