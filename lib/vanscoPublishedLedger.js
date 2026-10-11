import { createClient } from "@supabase/supabase-js";

export const VANSCO_PUBLISHED_TYPES = Object.freeze([
  "vansco_facebook_post",
  "vansco_facebook_story",
  "vansco_333_google_business_post",
  "vansco_airport_google_business_post",
  "vansco_new_forest_google_business_post",
]);

const VANSCO_BRANCH_TYPES = Object.freeze({
  vansco333: "vansco_333_google_business_post",
  southamptonAirport: "vansco_airport_google_business_post",
  newForest: "vansco_new_forest_google_business_post",
});

export function summarizeVanscoPublishedLedger(rows, dateKey) {
  const counts = Object.fromEntries(VANSCO_PUBLISHED_TYPES.map((type) => [type, 0]));
  const seen = new Set();
  let lastPublishedAt = null;

  for (const row of rows || []) {
    if (row?.activity_date !== dateKey || row?.source !== "buffer_publish") continue;
    if (!Object.hasOwn(counts, row.activity_type)) continue;
    if (row?.metadata?.buffer_status !== "sent") continue;
    const id = String(row?.source_id || "").trim();
    if (!id.startsWith("vansco-buffer:") || seen.has(id)) continue;
    seen.add(id);
    counts[row.activity_type] += 1;
    const when = String(row?.occurred_at || "");
    if (when && (!lastPublishedAt || when > lastPublishedAt)) lastPublishedAt = when;
  }

  return {
    date: dateKey,
    facebookPosts: counts.vansco_facebook_post,
    facebookStories: counts.vansco_facebook_story,
    googleBusiness: Object.fromEntries(
      Object.entries(VANSCO_BRANCH_TYPES).map(([branch, type]) => [branch, counts[type]]),
    ),
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    lastPublishedAt,
    source: "buffer_sent_activity_ledger",
  };
}

export async function loadVanscoPublishedLedger(dateKey) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Vansco Buffer publication ledger is not configured.");
  }
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabase
    .from("marketing_daily_activity_events")
    .select("activity_date,activity_type,source,source_id,metadata,occurred_at")
    .eq("activity_date", dateKey)
    .eq("source", "buffer_publish")
    .in("activity_type", VANSCO_PUBLISHED_TYPES)
    .limit(500);
  if (error) throw error;
  if ((data || []).length >= 500) {
    throw new Error("Vansco published-history limit reached; cannot confirm the daily total.");
  }
  return summarizeVanscoPublishedLedger(data || [], dateKey);
}
