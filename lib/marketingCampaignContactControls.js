import {
  normalizeCurrentSendCustomerId,
  normalizeCurrentSendEmail,
} from "./marketingCurrentSendEligibility.js";

export const RECENT_CONTACT_DAY_OPTIONS = Object.freeze([0, 3, 7, 14, 30, 60]);
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
  const recentContactDays = Number(values.recent_contact_days ?? 0);
  if (!RECENT_CONTACT_DAY_OPTIONS.includes(recentContactDays)) {
    throw createError("Choose a supported recent-contact period.");
  }

  const rawCampaignIds = Array.isArray(values.exclude_campaign_ids) ? values.exclude_campaign_ids : [];
  const excludeCampaignIds = [...new Set(rawCampaignIds.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  if (excludeCampaignIds.length > 50) throw createError("You can exclude a maximum of 50 previous campaigns.");
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

export async function loadCampaignContactExclusions(supabase, rules = {}, currentCampaignId = "", assertResult = (result) => result) {
  const target = { customerIds: new Set(), emails: new Set() };
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
      target
    );
  }

  if (Number(rules.recent_contact_days || 0) > 0) {
    const cutoff = new Date(Date.now() - Number(rules.recent_contact_days) * 24 * 60 * 60 * 1000).toISOString();
    await loadPagedRecipients(
      () => {
        let query = supabase.from("marketing_email_send_recipients")
          .select("customer_id,email")
          .eq("send_type", "production")
          .in("status", CONTACT_HISTORY_RECIPIENT_STATUSES)
          .gte("created_at", cutoff);
        if (currentCampaignId) query = query.neq("campaign_id", currentCampaignId);
        return query;
      },
      assertResult,
      target
    );
  }

  return target;
}

export function matchesCampaignContactExclusion(row = {}, exclusions = {}) {
  const customerId = normalizeCurrentSendCustomerId(row.customer_id);
  const email = normalizeCurrentSendEmail(row.email_normalized || row.email);
  return Boolean(
    (customerId && exclusions.customerIds?.has(customerId))
    || (email && exclusions.emails?.has(email))
  );
}
