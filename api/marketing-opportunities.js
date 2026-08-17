import { createClient } from "@supabase/supabase-js";
import { DEFAULT_AUDIENCE_RULES, applySuppressionQuery, normalizeAudienceRules } from "../lib/marketingCampaignAudience.js";
import { prioritiseMarketingOpportunities } from "../lib/marketingOpportunityPriority.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CHANNELS = new Set(["email", "sms", "facebook"]);

function json(response, status, payload) {
  response.status(status).json(payload);
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables.");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function authorize(request) {
  const expectedSecret = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  if (!expectedSecret) return false;
  const headerSecret = request.headers[API_KEY_HEADER] || "";
  const authHeader = request.headers.authorization || "";
  const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return headerSecret === expectedSecret || bearerSecret === expectedSecret;
}

function assertSupabase(result, fallbackMessage) {
  if (result.error) throw new Error(result.error.message || fallbackMessage);
  return result;
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function buildOpportunityRules(overrides = {}) {
  return normalizeAudienceRules({ ...DEFAULT_AUDIENCE_RULES, ...overrides });
}

function buildOpportunityName(channel, title) {
  const month = new Date().toLocaleString("en-GB", { month: "short", year: "numeric" });
  const channelLabel = channel === "sms" ? "SMS" : channel === "facebook" ? "Facebook" : "Email";
  return `${channelLabel} - ${title} - ${month}`;
}

function buildOpportunity({ id, title, description, customerCount, channel, objective, rules, campaignCreationSupported = false, unsupportedReason = "Audience filter not yet available" }) {
  const supported = Boolean(campaignCreationSupported);
  return {
    id,
    title,
    description,
    customer_count: Number(customerCount || 0),
    recommended_channel: channel,
    recommended_objective: objective,
    default_audience_rules: supported ? buildOpportunityRules(rules) : null,
    suggested_name: supported ? buildOpportunityName(channel, title) : "",
    campaign_creation_supported: supported,
    unsupported_reason: supported ? "" : unsupportedReason,
  };
}

async function countContacts(supabase, channel, applyQuery) {
  let query = applySuppressionQuery(
    supabase.from("marketing_contacts").select("id", { count: "exact", head: true }),
    channel
  );
  if (applyQuery) query = applyQuery(query);
  const { count } = assertSupabase(await query, "Could not count marketing opportunity customers.");
  return count || 0;
}

async function getExportedCustomerIdsByChannel(supabase) {
  const exportedByChannel = { email: new Set(), sms: new Set(), facebook: new Set() };

  try {
    const { data: campaigns } = assertSupabase(
      await supabase.from("marketing_campaigns").select("id,channel").in("channel", ["email", "sms", "facebook"]),
      "Could not load exported campaign channels."
    );
    const channelByCampaignId = new Map((campaigns || []).filter((campaign) => CHANNELS.has(campaign.channel)).map((campaign) => [campaign.id, campaign.channel]));
    const campaignIds = [...channelByCampaignId.keys()];
    if (!campaignIds.length) return exportedByChannel;

    const batches = [];
    for (let index = 0; index < campaignIds.length; index += 100) {
      const campaignChunk = campaignIds.slice(index, index + 100);
      const { data } = assertSupabase(
        await supabase.from("marketing_campaign_batches").select("id,campaign_id").in("campaign_id", campaignChunk).eq("status", "exported"),
        "Could not load exported campaign batches."
      );
      batches.push(...(data || []));
    }

    const channelByBatchId = new Map(batches.map((batch) => [batch.id, channelByCampaignId.get(batch.campaign_id)]).filter(([, channel]) => Boolean(channel)));
    const batchIds = [...channelByBatchId.keys()];
    if (!batchIds.length) return exportedByChannel;

    for (let index = 0; index < batchIds.length; index += 100) {
      const batchChunk = batchIds.slice(index, index + 100);
      const { data } = assertSupabase(
        await supabase.from("marketing_campaign_batch_customers").select("batch_id,customer_id").in("batch_id", batchChunk),
        "Could not load exported marketing customer membership."
      );
      (data || []).forEach((row) => {
        const channel = channelByBatchId.get(row.batch_id);
        if (channel && row.customer_id) exportedByChannel[channel].add(row.customer_id);
      });
    }
  } catch (error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (!message.includes("marketing_campaign_batches") && !message.includes("marketing_campaign_batch_customers") && !message.includes("does not exist")) throw error;
  }

  return exportedByChannel;
}

async function countReadyExportedCustomers(supabase, exportedByChannel) {
  const readyColumns = { email: "email_ready", sms: "sms_ready", facebook: "facebook_ready" };
  const counts = { email: 0, sms: 0, facebook: 0 };

  for (const [channel, idsSet] of Object.entries(exportedByChannel)) {
    const ids = [...idsSet];
    const readyColumn = readyColumns[channel];
    if (!ids.length || !readyColumn) continue;

    for (let index = 0; index < ids.length; index += 500) {
      const idChunk = ids.slice(index, index + 500);
      const { count } = assertSupabase(
        await applySuppressionQuery(
          supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).in("id", idChunk).eq(readyColumn, true),
          channel
        ),
        "Could not count exported ready marketing customers."
      );
      counts[channel] += count || 0;
    }
  }

  return counts;
}

async function countUntaggedContacts(supabase) {
  try {
    return await countContacts(supabase, "email", (query) => query.or("tags.is.null,tags.eq.{}"));
  } catch {
    return countContacts(supabase, "email", (query) => query.is("tags", null));
  }
}

async function countMultipleApplications(supabase) {
  try {
    return await countContacts(supabase, "email", (query) => query.gt("application_count", 1));
  } catch {
    return null;
  }
}

async function getMarketingOpportunities(supabase) {
  const [readyCounts, exportedByChannel, dormant, recentImports, untagged, multipleApplications] = await Promise.all([
    Promise.all([
      countContacts(supabase, "email", (query) => query.eq("email_ready", true)),
      countContacts(supabase, "sms", (query) => query.eq("sms_ready", true)),
      countContacts(supabase, "facebook", (query) => query.eq("facebook_ready", true)),
    ]),
    getExportedCustomerIdsByChannel(supabase),
    countContacts(supabase, "email", (query) => query.lt("last_seen_at", daysAgoIso(180)).eq("email_ready", true)),
    countContacts(supabase, "email", (query) => query.gte("created_at", daysAgoIso(7)).eq("email_ready", true)),
    countUntaggedContacts(supabase),
    countMultipleApplications(supabase),
  ]);
  const exportedReadyCounts = await countReadyExportedCustomers(supabase, exportedByChannel);
  const [emailReady, smsReadyTotal, facebookReadyTotal] = readyCounts;

  const opportunities = [
    buildOpportunity({ id: "never_marketed_email", title: "Never Marketed", description: "Email-ready customers who have never been exported in an Email campaign.", customerCount: Math.max(0, emailReady - exportedReadyCounts.email), channel: "email", objective: "re_engagement", rules: {}, unsupportedReason: "Audience filter not yet available" }),
    buildOpportunity({ id: "sms_ready_never_exported", title: "SMS Ready", description: "SMS-ready customers who have never been exported in an SMS campaign.", customerCount: Math.max(0, smsReadyTotal - exportedReadyCounts.sms), channel: "sms", objective: "promotion", rules: {}, unsupportedReason: "Audience filter not yet available" }),
    buildOpportunity({ id: "facebook_ready_never_exported", title: "Facebook Ready", description: "Facebook-ready customers who have never been exported in a Facebook campaign.", customerCount: Math.max(0, facebookReadyTotal - exportedReadyCounts.facebook), channel: "facebook", objective: "promotion", rules: {}, unsupportedReason: "Audience filter not yet available" }),
    buildOpportunity({ id: "dormant_customers", title: "Dormant Customers", description: "Email-ready customers with no recorded activity for more than 180 days.", customerCount: dormant, channel: "email", objective: "re_engagement", rules: { last_seen_period: "more_than_180" }, campaignCreationSupported: true }),
    buildOpportunity({ id: "recent_imports", title: "Recent Imports", description: "Email-ready customers created in the last 7 days.", customerCount: recentImports, channel: "email", objective: "new_stock", rules: { created_period: "last7" }, campaignCreationSupported: true }),
    buildOpportunity({ id: "untagged_customers", title: "Untagged Customers", description: "Customers with no tags, ready for future segmentation cleanup.", customerCount: untagged, channel: "email", objective: "custom", rules: {}, unsupportedReason: "Audience filter not yet available" }),
  ];

  if (multipleApplications !== null) {
    opportunities.push(buildOpportunity({ id: "multiple_applications", title: "Multiple Applications", description: "Customers with more than one recorded application.", customerCount: multipleApplications, channel: "email", objective: "finance_offer", rules: {}, unsupportedReason: "Audience filter not yet available" }));
  }

  return { opportunities: prioritiseMarketingOpportunities(opportunities) };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Marketing Opportunities API access denied." });
    return;
  }

  try {
    json(response, 200, { ok: true, ...(await getMarketingOpportunities(getSupabase())) });
  } catch (error) {
    json(response, 500, { ok: false, message: error?.message || "Marketing Opportunities API error." });
  }
}
