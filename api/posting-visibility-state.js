import { getSupabaseAdmin } from "./_vansco-cache-utils.js";

const POSTING_VISIBILITY_TABLE = "posting_visibility_state";
const VALID_PAGE_KEYS = new Set([
  "vanFinanceFacebook",
  "rent2BuyFacebook",
  "marketplace",
]);

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function normalizePageKey(value) {
  const pageKey = String(value || "").trim();
  return VALID_PAGE_KEYS.has(pageKey) ? pageKey : "";
}

function normalizeHiddenIds(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

export default async function handler(request, response) {
  try {
    const supabase = getSupabaseAdmin();

    if (request.method === "GET") {
      const result = await supabase
        .from(POSTING_VISIBILITY_TABLE)
        .select("page_key, hidden_ids, updated_at")
        .in("page_key", [...VALID_PAGE_KEYS]);

      if (result.error) {
        sendJson(response, 500, {
          ok: false,
          message: result.error.message || "Could not load posting visibility state.",
        });
        return;
      }

      const state = {
        vanFinanceFacebook: [],
        rent2BuyFacebook: [],
        marketplace: [],
      };

      for (const row of result.data || []) {
        const pageKey = normalizePageKey(row.page_key);
        if (pageKey) state[pageKey] = normalizeHiddenIds(row.hidden_ids);
      }

      sendJson(response, 200, { ok: true, state });
      return;
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const pageKey = normalizePageKey(body.pageKey);

      if (!pageKey) {
        sendJson(response, 400, { ok: false, message: "Invalid posting page key." });
        return;
      }

      const hiddenIds = normalizeHiddenIds(body.hiddenIds);
      const now = new Date().toISOString();

      const result = await supabase
        .from(POSTING_VISIBILITY_TABLE)
        .upsert(
          {
            page_key: pageKey,
            hidden_ids: hiddenIds,
            updated_at: now,
          },
          { onConflict: "page_key" }
        )
        .select("page_key, hidden_ids, updated_at")
        .single();

      if (result.error) {
        sendJson(response, 500, {
          ok: false,
          message: result.error.message || "Could not save posting visibility state.",
        });
        return;
      }

      sendJson(response, 200, { ok: true, state: result.data });
      return;
    }

    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { ok: false, message: "Method not allowed." });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "Posting visibility API failed.",
    });
  }
}
