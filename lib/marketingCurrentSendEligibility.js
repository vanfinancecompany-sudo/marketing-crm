const EMAIL_SUPPRESSION_TYPES = ["email_unsubscribed", "email_bounced", "manual_suppression", "global_do_not_contact"];
export const CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES = Object.freeze([
  "pending",
  "accepted",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "submission_unknown",
]);

export function normalizeCurrentSendEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function normalizeCurrentSendCustomerId(value) {
  return String(value || "").trim().toUpperCase().slice(0, 80);
}

function activeSuppressionEntry(value) {
  return value && typeof value === "object" && value.active !== false;
}

export function contactIsSuppressedForCurrentSend(row = {}, permanentlySuppressedEmails = new Set()) {
  const email = normalizeCurrentSendEmail(row.email_normalized || row.email);
  const suppression = row.suppression && typeof row.suppression === "object" ? row.suppression : {};
  return String(row.marketing_status || "active") !== "active"
    || EMAIL_SUPPRESSION_TYPES.some((type) => activeSuppressionEntry(suppression[type]))
    || Boolean(email && permanentlySuppressedEmails.has(email));
}

export function createCurrentSendEligibilityState(processed = {}) {
  return {
    processedCustomerIds: processed.customerIds || new Set(),
    processedEmails: processed.emails || new Set(),
    seenCustomerIds: new Set(),
    seenEmails: new Set(),
  };
}

export function evaluateCurrentSendEligibility(row = {}, options = {}) {
  const state = options.state || createCurrentSendEligibilityState();
  const customerId = normalizeCurrentSendCustomerId(row.customer_id);
  const email = normalizeCurrentSendEmail(row.email_normalized || row.email);

  if (String(row.lifecycle_status || "") !== "active") return { eligible: false, reason: "inactive", customerId, email };
  if (!row.email_ready || !email) return { eligible: false, reason: "invalid_email", customerId, email };
  if (contactIsSuppressedForCurrentSend(row, options.permanentlySuppressedEmails)) return { eligible: false, reason: "suppressed", customerId, email };
  if (state.processedCustomerIds.has(customerId) || state.processedEmails.has(email)) return { eligible: false, reason: "previously_processed", customerId, email };
  if (!customerId || state.seenCustomerIds.has(customerId) || state.seenEmails.has(email)) return { eligible: false, reason: "duplicate", customerId, email };

  state.seenCustomerIds.add(customerId);
  state.seenEmails.add(email);
  return { eligible: true, reason: "eligible", customerId, email };
}

export async function loadCurrentSendProcessedIdentities(supabase, campaignId, assertResult = (result) => result) {
  const customerIds = new Set();
  const emails = new Set();
  let uniqueRecipientCount = 0;
  let from = 0;
  while (true) {
    // A stable order is mandatory when the campaign has more than one Supabase page
    // of historical recipients. Without it, offset pagination can repeat/skip rows,
    // allowing an already-processed customer to be selected again and making the
    // recipient reservation fail on the database uniqueness guard.
    const result = assertResult(await supabase
      .from("marketing_email_send_recipients")
      .select("id,customer_id,email")
      .eq("campaign_id", campaignId)
      .eq("send_type", "production")
      .in("status", CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES)
      .order("id", { ascending: true })
      .range(from, from + 999), "Could not inspect previously processed campaign recipients.");
    const rows = result.data || [];
    for (const row of rows) {
      const customerId = normalizeCurrentSendCustomerId(row.customer_id);
      const email = normalizeCurrentSendEmail(row.email);
      const duplicate = Boolean((customerId && customerIds.has(customerId)) || (email && emails.has(email)));
      if (!duplicate && (customerId || email)) uniqueRecipientCount += 1;
      if (customerId) customerIds.add(customerId);
      if (email) emails.add(email);
    }
    if (rows.length < 1000) break;
    from += 1000;
  }
  return { customerIds, emails, uniqueRecipientCount };
}

export async function loadPermanentCurrentSendSuppressions(supabase, emails, assertResult = (result) => result) {
  const normalized = [...new Set((emails || []).map(normalizeCurrentSendEmail).filter(Boolean))];
  if (!normalized.length) return new Set();
  const suppressed = new Set();
  for (let index = 0; index < normalized.length; index += 200) {
    const result = assertResult(await supabase
      .from("marketing_suppression_identities")
      .select("email_normalized")
      .in("email_normalized", normalized.slice(index, index + 200)), "Could not inspect permanent email suppressions.");
    for (const row of result.data || []) {
      const email = normalizeCurrentSendEmail(row.email_normalized);
      if (email) suppressed.add(email);
    }
  }
  return suppressed;
}
