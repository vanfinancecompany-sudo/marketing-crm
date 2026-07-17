export const ACTIVE_LIFECYCLE_STATUS = "active";
export const PERMANENT_SUPPRESSION_TYPES = new Set([
  "email_unsubscribed",
  "email_bounced",
  "manual_suppression",
  "global_do_not_contact",
]);
export const DELIVERED_EVENT_TYPE = "delivered";
export const DISQUALIFYING_EVENT_TYPES = new Set([
  "hard_bounce",
  "invalid_email",
  "complaint",
  "unsubscribed",
]);
const RECIPIENT_TERMINAL_EVENTS = [
  { status: "hard_bounced", eventType: "hard_bounce", timestamp: "hard_bounced_at" },
  { status: "complained", eventType: "complaint", timestamp: "complained_at" },
  { status: "unsubscribed", eventType: "unsubscribed", timestamp: "unsubscribed_at" },
];

export function normalizeEmailIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

export function activeSuppressionEntry(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.active !== false);
}

export function contactHasPermanentSuppression(contact = {}) {
  if (String(contact.lifecycle_status || ACTIVE_LIFECYCLE_STATUS) === "suppressed") return true;
  const suppression = contact.suppression && typeof contact.suppression === "object" && !Array.isArray(contact.suppression)
    ? contact.suppression
    : {};
  return [...PERMANENT_SUPPRESSION_TYPES].some((type) => activeSuppressionEntry(suppression[type]));
}

function eventTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function newerEvent(current, candidate) {
  if (!current) return candidate;
  return eventTime(candidate.event_at) >= eventTime(current.event_at) ? candidate : current;
}

export function correlateEmailEvent(event, recipientsById, recipientsByMessageId) {
  return (event.recipient_id && recipientsById.get(event.recipient_id))
    || (event.provider_message_id && recipientsByMessageId.get(event.provider_message_id))
    || null;
}

export function buildPreviouslyDeliveredRows({
  events = [],
  recipients = [],
  campaigns = [],
  contacts = [],
  suppressedEmails = new Set(),
} = {}) {
  const recipientsById = new Map(recipients.map((row) => [row.id, row]));
  const recipientsByMessageId = new Map(recipients.filter((row) => row.provider_message_id).map((row) => [row.provider_message_id, row]));
  const campaignsById = new Map(campaigns.map((row) => [row.id, row]));
  const contactsByCustomerId = new Map(contacts.filter((row) => row.customer_id).map((row) => [String(row.customer_id).toUpperCase(), row]));
  const contactsByEmail = new Map(contacts.map((row) => [normalizeEmailIdentity(row.email_normalized || row.email), row]).filter(([email]) => email));
  const latestDeliveryByEmail = new Map();
  const latestEventByEmail = new Map();
  const disqualifyingByEmail = new Map();

  const recordDisqualifying = (email, event) => {
    const list = disqualifyingByEmail.get(email) || [];
    list.push(event);
    disqualifyingByEmail.set(email, list);
    latestEventByEmail.set(email, newerEvent(latestEventByEmail.get(email), event));
  };

  for (const recipient of recipients) {
    if (recipient.send_type !== "production") continue;
    const email = normalizeEmailIdentity(recipient.email);
    if (!email) continue;
    for (const terminal of RECIPIENT_TERMINAL_EVENTS) {
      const matchesLastEvent = recipient.last_event_type === terminal.eventType
        || (terminal.eventType === "hard_bounce" && recipient.last_event_type === "invalid_email");
      if (recipient.status !== terminal.status && !recipient[terminal.timestamp] && !matchesLastEvent) continue;
      const knownTimestamp = recipient[terminal.timestamp] || (matchesLastEvent ? recipient.last_event_at : "");
      recordDisqualifying(email, {
        event_type: terminal.eventType,
        event_at: knownTimestamp || "9999-12-31T23:59:59.999Z",
        email_normalized: email,
        recipient,
      });
    }
  }

  for (const rawEvent of events) {
    const recipient = correlateEmailEvent(rawEvent, recipientsById, recipientsByMessageId);
    if (!recipient || recipient.send_type !== "production") continue;
    const email = normalizeEmailIdentity(rawEvent.email_normalized || recipient.email);
    if (!email) continue;
    const event = {
      ...rawEvent,
      campaign_id: rawEvent.campaign_id || recipient.campaign_id || null,
      customer_id: rawEvent.customer_id || recipient.customer_id || "",
      email_normalized: email,
      recipient,
    };
    latestEventByEmail.set(email, newerEvent(latestEventByEmail.get(email), event));
    if (event.event_type === DELIVERED_EVENT_TYPE) {
      latestDeliveryByEmail.set(email, newerEvent(latestDeliveryByEmail.get(email), event));
    }
    if (DISQUALIFYING_EVENT_TYPES.has(event.event_type)) {
      recordDisqualifying(email, event);
    }
  }

  const rows = [];
  for (const [email, delivery] of latestDeliveryByEmail.entries()) {
    if (suppressedEmails.has(email)) continue;
    const isDisqualified = (disqualifyingByEmail.get(email) || []).some((event) => {
      if (["complaint", "unsubscribed"].includes(event.event_type)) return true;
      return eventTime(event.event_at) >= eventTime(delivery.event_at);
    });
    if (isDisqualified) continue;

    const customerId = String(delivery.customer_id || delivery.recipient?.customer_id || "").toUpperCase();
    const contact = contactsByCustomerId.get(customerId) || contactsByEmail.get(email) || {};
    if (contactHasPermanentSuppression(contact)) continue;
    const campaign = campaignsById.get(delivery.campaign_id) || {};
    const latestEvent = latestEventByEmail.get(email) || delivery;
    rows.push({
      customer_id: contact.customer_id || customerId,
      first_name: contact.first_name || "",
      last_name: contact.last_name || "",
      email,
      phone: contact.phone || "",
      company: contact.company || "",
      postcode: contact.postcode || "",
      customer_type: contact.pipeline || "unknown",
      classification: contact.pipeline || "unknown",
      pipeline: contact.pipeline || "unknown",
      delivered_date: delivery.event_at || delivery.recipient?.delivered_at || "",
      campaign_name: campaign.name || "",
      last_email_status: latestEvent.event_type || delivery.recipient?.last_event_type || delivery.recipient?.status || "delivered",
    });
  }

  return rows.sort((left, right) => eventTime(right.delivered_date) - eventTime(left.delivered_date));
}

export function campaignRecipientIdentitySets(rows = []) {
  const customerIds = new Set();
  const emails = new Set();
  rows.forEach((row) => {
    const customerId = String(row.customer_id || "").trim().toUpperCase();
    const email = normalizeEmailIdentity(row.email);
    if (customerId) customerIds.add(customerId);
    if (email) emails.add(email);
  });
  return { customerIds, emails };
}
