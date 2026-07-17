const ACCEPTED_STATUSES = new Set([
  "accepted",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "soft_bounced",
  "hard_bounced",
  "blocked",
  "complained",
  "unsubscribed",
]);

const TEMPORARY_OUTCOMES = new Set(["accepted", "deferred", "soft_bounced"]);
const DELIVERY_EVENT_TYPES = new Set(["delivered", "opened", "clicked"]);
const NON_ACCEPTED_OPERATIONAL_STATUSES = new Set([
  "pending",
  "failed",
  "submission_unknown",
  "skipped_suppressed",
  "skipped_duplicate",
]);

function hasAcceptanceEvidence(recipient) {
  return Boolean(
    recipient.first_sent_at
    || String(recipient.provider_message_id || "").trim()
    || ACCEPTED_STATUSES.has(recipient.status)
  );
}

function timestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function percent(part, total) {
  const numerator = Number(part || 0);
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function outcomeRank(status) {
  return {
    accepted: 0,
    deferred: 1,
    soft_bounced: 2,
    delivered: 3,
    blocked: 4,
    hard_bounced: 5,
  }[status] ?? -1;
}

function chooseOutcome(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;

  // A provider-classified permanent address failure is terminal. Complaint and
  // unsubscribe are tracked separately because they are not delivery outcomes.
  if (current.status === "hard_bounced") return current;
  if (candidate.status === "hard_bounced") return candidate;

  // Delivery is a successful terminal outcome for temporary failures, even if a
  // delayed lower-precedence webhook is received afterwards.
  if (current.status === "delivered" && TEMPORARY_OUTCOMES.has(candidate.status)) return current;
  if (candidate.status === "delivered" && TEMPORARY_OUTCOMES.has(current.status)) return candidate;

  // Within non-terminal provider progress, a lower-precedence event cannot
  // regress a higher-precedence outcome merely because webhooks arrived late.
  if (TEMPORARY_OUTCOMES.has(current.status) && TEMPORARY_OUTCOMES.has(candidate.status)
    && outcomeRank(current.status) !== outcomeRank(candidate.status)) {
    return outcomeRank(candidate.status) > outcomeRank(current.status) ? candidate : current;
  }

  if (candidate.at !== current.at) return candidate.at > current.at ? candidate : current;
  return outcomeRank(candidate.status) > outcomeRank(current.status) ? candidate : current;
}

function eventOutcome(eventType) {
  if (DELIVERY_EVENT_TYPES.has(eventType)) return "delivered";
  if (["hard_bounce", "invalid_email"].includes(eventType)) return "hard_bounced";
  if (eventType === "soft_bounce") return "soft_bounced";
  if (eventType === "blocked") return "blocked";
  if (eventType === "deferred") return "deferred";
  if (eventType === "accepted") return "accepted";
  return "";
}

function recipientOutcomeCandidates(recipient) {
  const rows = [];
  const add = (status, value) => {
    if (value) rows.push({ status, at: timestamp(value) });
  };
  if (hasAcceptanceEvidence(recipient)) {
    add("accepted", recipient.first_sent_at || recipient.last_event_at || recipient.updated_at || recipient.created_at);
  }
  add("deferred", recipient.deferred_at);
  add("soft_bounced", recipient.soft_bounced_at);
  add("delivered", recipient.delivered_at);
  add("delivered", recipient.opened_at);
  add("delivered", recipient.clicked_at);
  add("blocked", recipient.blocked_at);
  add("hard_bounced", recipient.hard_bounced_at);

  if (ACCEPTED_STATUSES.has(recipient.status)) {
    const status = {
      soft_bounced: "soft_bounced",
      hard_bounced: "hard_bounced",
      blocked: "blocked",
      delivered: "delivered",
      opened: "delivered",
      clicked: "delivered",
    }[recipient.status] || "accepted";
    rows.push({ status, at: timestamp(recipient.last_event_at || recipient.updated_at || recipient.created_at) });
  }
  return rows;
}

function createIdentityIndex(recipients) {
  const outcomes = new Map();
  const recipientAliases = new Map();
  const messageAliases = new Map();
  const sendEmailAliases = new Map();

  for (const recipient of recipients) {
    if (recipient.send_type && recipient.send_type !== "production") continue;
    const providerMessageId = String(recipient.provider_message_id || "").trim();
    const key = providerMessageId
      ? `message:${providerMessageId}`
      : `recipient:${recipient.id || `${recipient.send_id || recipient.campaign_id || "unknown"}:${String(recipient.email || "").toLowerCase()}`}`;
    const existing = outcomes.get(key) || {
      identity: key,
      recipient_ids: new Set(),
      campaign_ids: new Set(),
      send_ids: new Set(),
      outcome: null,
      opened: false,
      clicked: false,
      unsubscribed: false,
      complained: false,
      accepted: false,
      operational_status: null,
      temporary_failure_before_delivery: false,
      temporary_event_times: [],
    };
    if (recipient.id) {
      existing.recipient_ids.add(recipient.id);
      recipientAliases.set(recipient.id, key);
    }
    if (recipient.campaign_id) existing.campaign_ids.add(recipient.campaign_id);
    if (recipient.send_id) existing.send_ids.add(recipient.send_id);
    if (providerMessageId) messageAliases.set(providerMessageId, key);
    if (recipient.send_id && recipient.email) sendEmailAliases.set(`${recipient.send_id}:${String(recipient.email).trim().toLowerCase()}`, key);
    const accepted = hasAcceptanceEvidence(recipient);
    existing.accepted = existing.accepted || accepted;
    if (!accepted && NON_ACCEPTED_OPERATIONAL_STATUSES.has(recipient.status)) {
      existing.operational_status = recipient.status;
    }
    existing.opened = existing.opened || Boolean(recipient.opened_at || ["opened", "clicked"].includes(recipient.status));
    existing.clicked = existing.clicked || Boolean(recipient.clicked_at || recipient.status === "clicked");
    existing.unsubscribed = existing.unsubscribed || Boolean(recipient.unsubscribed_at || recipient.status === "unsubscribed");
    existing.complained = existing.complained || Boolean(recipient.complained_at || recipient.status === "complained");
    recipientOutcomeCandidates(recipient).forEach((candidate) => { existing.outcome = chooseOutcome(existing.outcome, candidate); });
    outcomes.set(key, existing);
  }

  return { outcomes, recipientAliases, messageAliases, sendEmailAliases };
}

function eventIdentity(event, index) {
  if (event.recipient_id && index.recipientAliases.has(event.recipient_id)) return index.recipientAliases.get(event.recipient_id);
  if (event.provider_message_id && index.messageAliases.has(event.provider_message_id)) return index.messageAliases.get(event.provider_message_id);
  const sendEmail = event.send_id && event.email_normalized
    ? `${event.send_id}:${String(event.email_normalized).trim().toLowerCase()}`
    : "";
  return sendEmail ? index.sendEmailAliases.get(sendEmail) : null;
}

export function resolveProductionRecipientReporting(recipients = [], events = []) {
  const productionRecipients = recipients.filter((recipient) => !recipient.send_type || recipient.send_type === "production");
  const index = createIdentityIndex(productionRecipients);
  let openEvents = 0;
  let clickEvents = 0;

  const sortedEvents = events.slice().sort((left, right) => timestamp(left.event_at || left.created_at) - timestamp(right.event_at || right.created_at));
  for (const event of sortedEvents) {
    const key = eventIdentity(event, index);
    const recipient = key ? index.outcomes.get(key) : null;
    if (!recipient) continue;
    const eventAt = timestamp(event.event_at || event.created_at);
    const outcome = eventOutcome(event.event_type);
    if (outcome) {
      recipient.accepted = true;
      recipient.outcome = chooseOutcome(recipient.outcome, { status: outcome, at: eventAt });
      if (["deferred", "soft_bounced"].includes(outcome)) recipient.temporary_event_times.push(eventAt);
    }
    if (event.event_type === "opened") {
      openEvents += 1;
      recipient.opened = true;
    }
    if (event.event_type === "clicked") {
      clickEvents += 1;
      recipient.clicked = true;
    }
    if (event.event_type === "unsubscribed") {
      recipient.accepted = true;
      recipient.unsubscribed = true;
    }
    if (event.event_type === "complaint") {
      recipient.accepted = true;
      recipient.complained = true;
    }
  }

  const recipientOutcomes = Array.from(index.outcomes.values()).map((entry) => {
    const deliveredAt = entry.outcome?.status === "delivered" ? entry.outcome.at : 0;
    const hadEarlierTemporaryFailure = entry.temporary_event_times.some((eventAt) => eventAt <= deliveredAt);
    return {
      identity: entry.identity,
      recipient_ids: Array.from(entry.recipient_ids),
      campaign_ids: Array.from(entry.campaign_ids),
      send_ids: Array.from(entry.send_ids),
      accepted: entry.accepted,
      status: entry.outcome?.status || (entry.accepted ? "accepted" : entry.operational_status || "pending"),
      outcome_at: entry.outcome?.at || 0,
      opened: entry.opened,
      clicked: entry.clicked,
      unsubscribed: entry.unsubscribed,
      complained: entry.complained,
      temporary_failure_before_delivery: Boolean(deliveredAt && hadEarlierTemporaryFailure),
    };
  });

  const accepted = recipientOutcomes.filter((row) => row.accepted);
  const finalDelivered = accepted.filter((row) => row.status === "delivered");
  const uniqueOpened = finalDelivered.filter((row) => row.opened).length;
  const uniqueClicked = finalDelivered.filter((row) => row.clicked).length;
  const counts = {
    recipients: recipientOutcomes.length,
    accepted: accepted.length,
    delivered: finalDelivered.length,
    opens: Math.max(openEvents, uniqueOpened),
    open_events: openEvents,
    click_events: clickEvents,
    unique_opens: uniqueOpened,
    opened: uniqueOpened,
    clicked: uniqueClicked,
    soft_bounced: accepted.filter((row) => row.status === "soft_bounced").length,
    hard_bounced: accepted.filter((row) => row.status === "hard_bounced").length,
    deferred: accepted.filter((row) => row.status === "deferred").length,
    blocked: accepted.filter((row) => row.status === "blocked").length,
    complained: accepted.filter((row) => row.complained).length,
    unsubscribed: accepted.filter((row) => row.unsubscribed).length,
    temporary_failures_before_delivery: accepted.filter((row) => row.temporary_failure_before_delivery).length,
    failed: recipientOutcomes.filter((row) => row.status === "failed").length,
    submission_unknown: recipientOutcomes.filter((row) => row.status === "submission_unknown").length,
    skipped_suppressed: recipientOutcomes.filter((row) => row.status === "skipped_suppressed").length,
    skipped_duplicate: recipientOutcomes.filter((row) => row.status === "skipped_duplicate").length,
  };

  return {
    ...counts,
    delivery_rate: percent(counts.delivered, counts.accepted),
    open_rate: percent(counts.unique_opens, counts.delivered),
    click_rate: percent(counts.clicked, counts.delivered),
    click_to_open_rate: percent(counts.clicked, counts.unique_opens),
    bounce_rate: percent(counts.soft_bounced + counts.hard_bounced + counts.blocked, counts.accepted),
    unsubscribe_rate: percent(counts.unsubscribed, counts.accepted),
    recipient_outcomes: recipientOutcomes,
  };
}

export function resolvedRecipientStatus(recipient = {}) {
  if (recipient.status === "unsubscribed" || recipient.unsubscribed_at) return "unsubscribed";
  if (recipient.status === "complained" || recipient.complained_at) return "complained";
  if (recipient.status === "hard_bounced" || recipient.hard_bounced_at) return "hard_bounced";
  const reporting = resolveProductionRecipientReporting([{ ...recipient, send_type: "production" }], []);
  const outcome = reporting.recipient_outcomes[0]?.status;
  if (outcome === "delivered") {
    if (recipient.status === "clicked" || recipient.clicked_at) return "clicked";
    if (recipient.status === "opened" || recipient.opened_at) return "opened";
    return "delivered";
  }
  return outcome || recipient.status || "accepted";
}
