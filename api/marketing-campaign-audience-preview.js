import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_AUDIENCE_RULES,
  buildAudienceResponse,
  countAudience,
  normalizeAudienceRules,
} from "../lib/marketingCampaignAudience.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CHANNELS = new Set(["email", "sms", "facebook"]);

function json(response, status, payload) {
  response.status(status).json(payload);
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing server Supabase environment variables.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function authorize(request) {
  const expectedSecret = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  if (!expectedSecret) return false;

  const headerSecret = request.headers[API_KEY_HEADER] || "";
  const authHeader = request.headers.authorization || "";
  const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  return headerSecret === expectedSecret || bearerSecret === expectedSecret;
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Marketing Campaign API access denied." });
    return;
  }

  try {
    const body = parseBody(request);
    const channel = String(body.channel || "email").trim().toLowerCase();
    if (!CHANNELS.has(channel)) throw new Error("Unsupported campaign channel.");

    const supabase = getSupabase();
    const rules = normalizeAudienceRules({ ...DEFAULT_AUDIENCE_RULES, ...(body.rules || {}) });
    const eligibleCount = await countAudience(supabase, { channel }, rules);
    const calculatedAt = new Date().toISOString();

    json(response, 200, {
      ok: true,
      audience: buildAudienceResponse(rules, eligibleCount, calculatedAt),
    });
  } catch (error) {
    json(response, 500, { ok: false, message: error?.message || "Marketing Campaign audience preview error." });
  }
}
