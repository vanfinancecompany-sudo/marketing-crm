import {
  normalizeCurrentSendCustomerId,
  normalizeCurrentSendEmail,
} from "./marketingCurrentSendEligibility.js";

export const MINIMUM_RECENT_CONTACT_DAYS = 7;
export const RECENT_CONTACT_DAY_OPTIONS = Object.freeze([7, 14, 30, 60]);
export const CONTACT_HISTORY_RECIPIENT_STATUSES = Object.freeze([
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
  "submission_unknown",
]);

const CAMPAIGN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCampaignContactControls(values = {}, createError = (message) => new Error(message)) {
  const requestedRecentContactDays = Number(values.recent_contact_days ?? MINIMUM_RECENT_CONTACT_DAYS);
  const recentContactDays = requestedRecentContactDays < MINIMUM_RECENT_CONTACT_DAYS
    ? MINIMUM_RECENT_CONTACT_DAYS
    : requestedRecentContactDays;
  if (!RECENT_CONTACT_DAY_OPTIONS.includes(recentContactDays)) {
    throw createError("Choose a supported recent-contact period.");
  }

  const rawCampaignIds = Array.isArray(values.exclude_campaign_ids) ? values.exclude_campaign_ids : [];
  const excludeCampaignIds = [...new Set(rawCampaignIds.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  if (excludeCampaignIds.length > 4) throw createError("You can exclude a maximum of four previous campaigns.");
  if (excludeCampaignIds.some((value) => !CAMPAIGN_ID_PATTERN.test(value))) {
    throw createError("A selected previous campaign is not valid.");
  }

  return {
    recent_contact_days: recentContactDays,
    exclude_campaign_ids: excludeCampaignIds,
  };
}

function mergeIdentity(target, row) {
  const customerId = normalizeCurrentSendCustomerId(row.customer_id);
  const email = normalizeCurrentSendEmail(row.email);
  if (customerId) target.customerIds.add(customerId);
  if (email) target.emails.add(email);
}

function mergeEmail(target, row) {
  const email = normalizeCurrentSendEmail(row.email);
  if (email) target.add(email);
}

export function recentContactCutoffIso(days = MINIMUM_RECENT_CONTACT_DAYS, now = Date.now()) {
  return new Date(Number(now) - Number(days) * 24 * 60 * 60 * 1000).toISOString();
}

export function acceptedWithinRecentContactWindow(firstSentAt, days = MINIMUM_RECENT_CONTACT_DAYS, now = Date.now()) {
  const acceptedAt = new Date(firstSentAt || 0).getTime();
  return Number.isFinite(acceptedAt) && acceptedAt > new Date(recentContactCutoffIso(days, now)).getTime();
}

export function isGenuineProductionContactWithinWindow(recipient = {}, days = MINIMUM_RECENT_CONTACT_DAYS, now = Date.now()) {
  return recipient.send_type === "production"
    && acceptedWithinRecentContactWindow(recipient.first_sent_at, days, now);
}

async function loadPagedRecipients(makeQuery, assertResult, target) {
  let from = 0;
  while (true) {
    const result = assertResult(await makeQuery().range(from, from + 999), "Could not inspect previous campaign recipients.");
    const rows = result.data || [];
    rows.forEach((row) => mergeIdentity(target, row));
    if (rows.length < 1000) break;
    from += 1000;
  }
}

export async function loadCampaignContactExclusions(supabase, rules = {}, currentCampaignId = "", assertResult = (result) => result, now = Date.now()) {
  const target = {
    customerIds: new Set(),
    emails: new Set(),
    previousCampaignCustomerIds: new Set(),
    previousCampaignEmails: new Set(),
    recentContactEmails: new Set(),
    minimumFrequencyLockEmails: new Set(),
  };
  const selectedCampaignIds = (rules.exclude_campaign_ids || []).filter((id) => id && id !== currentCampaignId);

  for (let index = 0; index < selectedCampaignIds.length; index += 50) {
    const campaignIds = selectedCampaignIds.slice(index, index + 50);
    await loadPagedRecipients(
      () => supabase.from("marketing_email_send_recipients")
        .select("customer_id,email")
        .eq("send_type", "production")
        .in("status", CONTACT_HISTORY_RECIPIENT_STATUSES)
        .in("campaign_id", campaignIds),
      assertResult,
      {
        customerIds: target.previousCampaignCustomerIds,
        emails: target.previousCampaignEmails,
      }
    );
  }

  target.previousCampaignCustomerIds.forEach((value) => target.customerIds.add(value));
  target.previousCampaignEmails.forEach((value) => target.emails.add(value));

  const recentContactDays = Math.max(MINIMUM_RECENT_CONTACT_DAYS, Number(rules.recent_contact_days || MINIMUM_RECENT_CONTACT_DAYS));
  const cutoff = recentContactCutoffIso(recentContactDays, now);
  let from = 0;
  while (true) {
    const result = assertResult(
      await supabase.from("marketing_email_send_recipients")
        .select("email,first_sent_at,send_type")
        .eq("send_type", "production")
        .not("first_sent_at", "is", null)
        .gt("first_sent_at", cutoff)
        .range(from, from + 999),
      "Could not inspect recent production email recipients."
    );
    const rows = result.data || [];
    rows.forEach((row) => {
      if (!isGenuineProductionContactWithinWindow(row, recentContactDays, now)) return;
      mergeEmail(target.recentContactEmails, row);
      if (isGenuineProductionContactWithinWindow(row, MINIMUM_RECENT_CONTACT_DAYS, now)) {
        mergeEmail(target.minimumFrequencyLockEmails, row);
      }
    });
    if (rows.length < 1000) break;
    from += 1000;
  }

  target.recentContactEmails.forEach((value) => target.emails.add(value));

  return target;
}

export function matchesPreviousCampaignContactExclusion(row = {}, exclusions = {}) {
  const customerId = normalizeCurrentSendCustomerId(row.customer_id);
  const email = normalizeCurrentSendEmail(row.email_normalized || row.email);
  return Boolean(
    (customerId && exclusions.previousCampaignCustomerIds?.has(customerId))
    || (email && exclusions.previousCampaignEmails?.has(email))
  );
}

export function matchesRecentContactExclusion(row = {}, exclusions = {}) {
  const email = normalizeCurrentSendEmail(row.email_normalized || row.email);
  return Boolean(email && exclusions.recentContactEmails?.has(email));
}

export function matchesMinimumFrequencyLock(row = {}, exclusions = {}) {
  const email = normalizeCurrentSendEmail(row.email_normalized || row.email);
  return Boolean(email && exclusions.minimumFrequencyLockEmails?.has(email));
}

export function matchesCampaignContactExclusion(row = {}, exclusions = {}) {
  const customerId = normalizeCurrentSendCustomerId(row.customer_id);
  const email = normalizeCurrentSendEmail(row.email_normalized || row.email);
  return Boolean(
    (customerId && exclusions.customerIds?.has(customerId))
    || (email && exclusions.emails?.has(email))
  );
}
