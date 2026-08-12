import { createClient } from "@supabase/supabase-js";
import { DEFAULT_MAIN_CRM_EVENT_URL, forwardApplicationReceivedCrmEvent } from "../lib/applicationReceivedEventForwarder.js";
import {
  normalizeSendGridEvent,
  processSendGridEvent,
  readRawRequestBody,
  verifySendGridRecipientHints,
  verifySendGridSignature,
} from "../lib/emailProviders/sendgridWebhook.js";

export const config = { api: { bodyParser: false } };

function json(response, status, payload) {
  response.status(status).json(payload);
}

function safeText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCustomerId(value) {
  return safeText(value, 80).toUpperCase();
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables.");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function duplicateError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "23505" || message.includes("duplicate") || message.includes("unique");
}

function uuid(value) {
  const text = safeText(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function createSendGridRepository(supabase) {
  return {
    async findRecipient(event) {
      const hints = event.hints || {};
      if (hints.recipient_id) {
        const recipientId = uuid(hints.recipient_id);
        if (!recipientId) return null;
        const result = await supabase.from("marketing_email_send_recipients").select("*").eq("id", recipientId).maybeSingle();
        if (result.error) throw new Error(result.error.message || "Could not load SendGrid recipient.");
        return verifySendGridRecipientHints(result.data, hints) ? result.data : null;
      }
      return null;
    },

    async insertEvent(event, recipient) {
      const result = await supabase.from("marketing_email_events").insert({
        provider: "sendgrid",
        provider_event_id: event.provider_event_id,
        provider_message_id: event.provider_message_id,
        event_type: event.event_type,
        event_at: event.event_at,
        email_normalized: event.email_normalized,
        link_url: event.link_url,
        reason: event.reason,
        metadata: {
          ...(event.metadata || {}),
          correlated: Boolean(recipient),
          uncorrelated_reason: recipient ? "" : "No verified SendGrid recipient match for supplied hints.",
        },
        campaign_id: recipient?.campaign_id || null,
        send_id: recipient?.send_id || null,
        recipient_id: recipient?.id || null,
        customer_id: normalizeCustomerId(recipient?.customer_id) || null,
      }).select("id").maybeSingle();
      if (result.error) {
        if (duplicateError(result.error)) return { duplicate: true };
        throw new Error(result.error.message || "Could not record SendGrid event.");
      }
      return { duplicate: false };
    },

    async updateRecipient(recipientId, updates) {
      const result = await supabase.from("marketing_email_send_recipients").update(updates).eq("id", recipientId);
      if (result.error) throw new Error(result.error.message || "Could not update SendGrid recipient status.");
    },

    async applySuppression(recipient, event, suppression) {
      const customerId = normalizeCustomerId(recipient.customer_id);
      const email = normalizeEmail(recipient.email || event.email_normalized);
      const [contact, identity] = await Promise.all([
        customerId
          ? supabase.from("marketing_contacts").select("id,lifecycle_status").eq("customer_id", customerId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        email
          ? supabase.from("marketing_suppression_identities").select("id").eq("email_normalized", email).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (contact.error) throw new Error(contact.error.message || "Could not load contact for SendGrid suppression.");
      if (identity.error) throw new Error(identity.error.message || "Could not check permanent SendGrid suppression identity.");
      if (identity.data?.id) {
        if (contact.data?.id && contact.data.lifecycle_status !== "suppressed") {
          const hidden = await supabase.from("marketing_contacts").update({ lifecycle_status: "suppressed", lifecycle_changed_at: new Date().toISOString() }).eq("id", contact.data.id);
          if (hidden.error) throw new Error(hidden.error.message || "Could not hide SendGrid-suppressed contact.");
        }
        return;
      }
      if (!contact.data?.id) {
        if (!email) return;
        const inserted = await supabase.from("marketing_suppression_identities").insert({
          email_normalized: email,
          suppression_type: suppression.type,
          reason: suppression.reason,
          provider: "SendGrid webhook",
          campaign_id: recipient.campaign_id || null,
          contact_id: null,
          suppressed_at: event.event_at,
          metadata: { orphaned_recipient_id: recipient.id || "", provider_message_id: event.provider_message_id || "" },
        });
        if (inserted.error && !duplicateError(inserted.error)) throw new Error(inserted.error.message || "Could not retain orphaned SendGrid suppression identity.");
        return;
      }
      const rpc = await supabase.rpc("marketing_apply_suppression", {
        p_contact_id: contact.data.id,
        p_type: suppression.type,
        p_reason: suppression.reason,
        p_added_by: "SendGrid webhook",
        p_notes: safeText(`campaign:${recipient.campaign_id || ""} send:${recipient.send_id || ""} recipient:${recipient.id || ""} message:${event.provider_message_id || ""} email:${recipient.email || event.email_normalized || ""}`, 500),
      });
      if (rpc.error) throw new Error(rpc.error.message || "Could not apply suppression from SendGrid event.");
    },
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return json(response, 405, { ok: false, message: "Method not allowed." });
  try {
    const rawBody = await readRawRequestBody(request);
    const signature = request.headers["x-twilio-email-event-webhook-signature"];
    const timestamp = request.headers["x-twilio-email-event-webhook-timestamp"];
    const verified = verifySendGridSignature({
      rawBody,
      signature,
      timestamp,
      verificationKey: process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY,
    });
    if (!verified) return json(response, 401, { ok: false, message: "SendGrid webhook signature verification failed." });

    let parsed;
    try { parsed = JSON.parse(rawBody.toString("utf8")); }
    catch { return json(response, 400, { ok: false, message: "SendGrid webhook body is not valid JSON." }); }
    const payloads = Array.isArray(parsed) ? parsed : [parsed];
    const repository = createSendGridRepository(getSupabase());
    const summary = {
      received: payloads.length,
      recorded: 0,
      duplicates: 0,
      correlated: 0,
      uncorrelated: 0,
      suppressed: 0,
      unknown: 0,
      crm_forwarded: 0,
      crm_forward_failed: 0,
    };
    for (const payload of payloads) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        summary.unknown += 1;
        continue;
      }
      const event = normalizeSendGridEvent(payload);
      const result = await processSendGridEvent(repository, event);
      if (result.duplicate) summary.duplicates += 1;
      else summary.recorded += 1;
      if (result.correlated) summary.correlated += 1;
      else summary.uncorrelated += 1;
      if (result.suppressed) summary.suppressed += 1;
      if (event.event_type === "unknown") summary.unknown += 1;

      if (!result.duplicate) {
        try {
          const forwarded = await forwardApplicationReceivedCrmEvent({
            payload,
            event,
            endpoint: process.env.MAIN_CRM_APPLICATION_EMAIL_EVENT_URL || DEFAULT_MAIN_CRM_EVENT_URL,
            apiKey: process.env.MARKETING_CUSTOMER_DATABASE_API_KEY,
          });
          if (forwarded.forwarded) summary.crm_forwarded += 1;
          else if (!forwarded.skipped) {
            summary.crm_forward_failed += 1;
            console.warn("APPLICATION RECEIVED EVENT FORWARD FAILED:", forwarded.reason);
          }
        } catch (error) {
          summary.crm_forward_failed += 1;
          console.warn("APPLICATION RECEIVED EVENT FORWARD FAILED:", error?.message || "forward_failed");
        }
      }
    }
    return json(response, 200, { ok: true, ...summary });
  } catch {
    return json(response, 500, { ok: false, message: "SendGrid webhook processing failed." });
  }
}
