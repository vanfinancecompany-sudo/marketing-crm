import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const SUPPORTED_TYPES = new Set(["topic", "article"]);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanText(value, maximum = 1000) {
  return String(value || "").trim().slice(0, maximum);
}

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers[API_KEY_HEADER] || "";
  const authorization = request.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      throw new ApiError(400, "Invalid JSON body.");
    }
  }
  return request.body;
}

function duplicateSummary(matches = []) {
  const counts = { duplicate: 0, likely_duplicate: 0, related: 0, clear: 0 };
  matches.forEach((match) => {
    if (Object.prototype.hasOwnProperty.call(counts, match.duplicate_risk)) {
      counts[match.duplicate_risk] += 1;
    }
  });
  const highestRisk = matches.find((match) => match.duplicate_risk === "duplicate")
    ? "duplicate"
    : matches.find((match) => match.duplicate_risk === "likely_duplicate")
      ? "likely_duplicate"
      : matches.find((match) => match.duplicate_risk === "related")
        ? "related"
        : "clear";
  return { counts, highest_risk: highestRisk, blocked: highestRisk === "duplicate" };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, message: "Access key not recognised." });
  }

  try {
    const body = parseBody(request);
    const type = cleanText(body.type, 20).toLowerCase();
    if (!SUPPORTED_TYPES.has(type)) {
      throw new ApiError(400, "Duplicate check type must be topic or article.");
    }

    const title = cleanText(body.title, 240);
    const canonicalIntent = cleanText(body.canonical_intent || body.intent || title, 1000);
    const category = cleanText(body.category, 80) || null;
    const excludeId = cleanText(body.exclude_id, 100) || null;
    const limit = Math.max(1, Math.min(50, Number(body.limit) || 10));
    if (!title) throw new ApiError(400, "A title is required for duplicate checking.");

    const functionName = type === "topic"
      ? "find_knowledge_topic_duplicate_candidates"
      : "find_knowledge_article_duplicate_candidates";
    const { data, error } = await getSupabase().rpc(functionName, {
      p_title: title,
      p_canonical_intent: canonicalIntent,
      p_category: category,
      p_exclude_id: excludeId,
      p_limit: limit,
    });
    if (error) {
      const missingMigration = /function .* does not exist|schema cache/i.test(error.message || "");
      throw new ApiError(
        missingMigration ? 503 : 500,
        missingMigration
          ? "Duplicate protection has not been enabled for this environment yet. Apply migration 026 first."
          : "The duplicate check could not be completed."
      );
    }

    const matches = Array.isArray(data) ? data : [];
    return response.status(200).json({
      ok: true,
      type,
      candidate: {
        title,
        canonical_intent: canonicalIntent,
        category,
        exclude_id: excludeId,
      },
      matches,
      summary: duplicateSummary(matches),
    });
  } catch (error) {
    console.error("KNOWLEDGE DUPLICATE CHECK ERROR", { message: error.message });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Knowledge Hub duplicate check failed.",
    });
  }
}
