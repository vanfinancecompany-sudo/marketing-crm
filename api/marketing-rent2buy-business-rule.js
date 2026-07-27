import { createClient } from "@supabase/supabase-js";
import { ensureRent2BuyBusinessKnowledge } from "../lib/rent2BuyRules.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers?.[API_KEY_HEADER] || "";
  const authorization = request.headers?.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}
function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured.");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  try {
    const rule = await ensureRent2BuyBusinessKnowledge(getSupabase());
    return response.status(200).json({ ok: true, rule, migration_required: false });
  } catch (error) {
    return response.status(500).json({ ok: false, message: error.message || "Rent2Buy Business Knowledge rule could not be stored." });
  }
}
