import { createClient } from "@supabase/supabase-js";
import { RUN_TABLE, buildRenewalPlan, londonDay, summarizeRenewalRun } from "../lib/rent2buyGroupRenewals.js";
const PAGE = 500;
async function getGroups(db) {
  const rows = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await db.from("facebook_group_state").select("group_key,group_url,group_name,rent2buy,state").eq("rent2buy", true).order("group_key").range(start, start + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}
export async function runDailyRenewalCheck(db, now = new Date()) {
  const date = londonDay(now);
  const previous = await db.from(RUN_TABLE).select("run_date").eq("run_date", date).maybeSingle();
  if (previous.error) throw previous.error;
  if (previous.data) return { alreadyChecked: true, date };
  const plan = buildRenewalPlan(await getGroups(db), now);
  const saved = await db.from(RUN_TABLE).upsert({ run_date: date, checked_at: now.toISOString(), plan }, { onConflict: "run_date", ignoreDuplicates: true });
  if (saved.error) throw saved.error;
  return { date, due: plan.dueCount, queued: plan.groups.length, needsReview: plan.reviewCount };
}
export async function readRenewals(db, now = new Date()) {
  const { data: runs, error } = await db.from(RUN_TABLE).select("run_date,checked_at,plan").order("run_date", { ascending: false }).limit(14);
  if (error) throw error;
  const entries = runs || [];
  const events = [];
  if (entries.length) {
    for (let start = 0; ; start += PAGE) {
      const result = await db.from("marketing_daily_activity_events").select("id,activity_date,occurred_at,metadata").eq("activity_type", "rent2buy_groups_post").eq("source", "facebook_groups").gte("activity_date", entries.at(-1).run_date).order("id").range(start, start + PAGE - 1);
      if (result.error) throw result.error;
      events.push(...(result.data || []));
      if (!result.data || result.data.length < PAGE) break;
    }
  }
  const history = entries.map(run => summarizeRenewalRun(run, events));
  return { today: londonDay(now), latest: history[0] || null, history: history.map(({groups,...summary}) => summary), enabled: process.env.RENT2BUY_GROUP_RENEWAL_ENABLED === "true" };
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const bearer = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const isRun = req.query?.run === "1";
  const key = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const cron = process.env.CRON_SECRET;
  if (isRun ? !(cron && bearer === cron) : !(key && (req.headers?.["x-marketing-customer-database-key"] === key || bearer === key))) return res.status(401).json({ error: "Unauthorised" });
  if (isRun && (process.env.RENT2BUY_GROUP_RENEWAL_ENABLED !== "true" || process.env.VERCEL_ENV !== "production")) return res.status(200).json({ disabled: true });
  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    return res.status(200).json(isRun ? await runDailyRenewalCheck(db) : await readRenewals(db));
  } catch (error) {
    console.error("Rent2Buy renewal check/read failed", String(error?.message || "").slice(0, 180));
    return res.status(500).json({ error: "Renewal data unavailable" });
  }
}
