import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";

const FACEBOOK_GROUP_STATE_TABLE = "facebook_group_state";
const FACEBOOK_GROUP_BACKUP_TABLE = "facebook_group_state_backups";
const MAX_GROUPS_PER_SAVE = 2500;
const MASS_REDUCTION_MIN_ROWS = 25;
const MASS_REDUCTION_RATIO = 0.65;

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

function clean(value, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeGroupUrl(value) {
  const raw = clean(value, 3000);
  if (!raw) return "";
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://www.facebook.com/${raw.replace(/^\/+/, "")}`);
    const match = url.pathname.match(/^\/groups\/([^/?#]+)/i);
    if (!match) return raw;
    return `https://www.facebook.com/groups/${match[1]}/`;
  } catch {
    return raw;
  }
}

function stateKey(group = {}) {
  const url = normalizeGroupUrl(group.url || group.groupUrl);
  if (url) return url.toLowerCase();
  return clean(group.name, 500).toLowerCase();
}

function normalizeGroup(group = {}) {
  if (!group || typeof group !== "object" || Array.isArray(group)) return null;
  const key = stateKey(group);
  if (!key) return null;
  const url = normalizeGroupUrl(group.url || group.groupUrl);
  const name = clean(group.name || "Facebook group", 500);
  return {
    key,
    row: {
      group_key: key,
      group_url: url || null,
      group_name: name || null,
      finance: group.finance !== false,
      rent2buy: group.rent2buy !== false,
      state: {
        ...group,
        url: url || group.url || "",
        name: name || group.name || "Facebook group",
      },
      updated_at: new Date().toISOString(),
    },
  };
}

export default async function handler(request, response) {
  try {
    const supabase = getSupabaseServiceAdmin();

    if (request.method === "GET") {
      const { data, error } = await supabase
        .from(FACEBOOK_GROUP_STATE_TABLE)
        .select("group_key,state,updated_at")
        .order("updated_at", { ascending: false })
        .limit(5000);

      if (error) {
        sendJson(response, 500, {
          ok: false,
          message: error.message || "Could not load Facebook group state.",
        });
        return;
      }

      const groups = (data || [])
        .map((row) => row?.state)
        .filter((group) => group && typeof group === "object" && !Array.isArray(group));

      sendJson(response, 200, { ok: true, groups });
      return;
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const input = Array.isArray(body.groups) ? body.groups.slice(0, MAX_GROUPS_PER_SAVE) : [];
      const byKey = new Map();

      for (const group of input) {
        const normalized = normalizeGroup(group);
        if (normalized) byKey.set(normalized.key, normalized.row);
      }

      const rows = [...byKey.values()];
      if (!rows.length) {
        sendJson(response, 200, { ok: true, saved: 0 });
        return;
      }

      const { data: existingRows, error: existingError } = await supabase
        .from(FACEBOOK_GROUP_STATE_TABLE)
        .select("group_key,state,updated_at")
        .limit(5000);

      if (existingError) {
        sendJson(response, 500, {
          ok: false,
          message: existingError.message || "Could not verify existing Facebook group state.",
        });
        return;
      }

      const existing = Array.isArray(existingRows) ? existingRows : [];
      const incomingKeys = new Set(rows.map((row) => row.group_key));
      const missingExisting = existing.filter((row) => !incomingKeys.has(row.group_key));
      const suspiciousReduction =
        existing.length >= MASS_REDUCTION_MIN_ROWS &&
        rows.length < Math.ceil(existing.length * MASS_REDUCTION_RATIO);

      if (suspiciousReduction) {
        sendJson(response, 409, {
          ok: false,
          protected: true,
          message: `Protected Facebook group state from suspicious reduction (${existing.length} stored -> ${rows.length} incoming).`,
          stored: existing.length,
          incoming: rows.length,
        });
        return;
      }

      if (existing.length) {
        const { error: backupError } = await supabase
          .from(FACEBOOK_GROUP_BACKUP_TABLE)
          .insert({
            reason: "before_upsert",
            group_count: existing.length,
            snapshot: existing.map((row) => row.state).filter(Boolean),
          });
        if (backupError) {
          sendJson(response, 500, {
            ok: false,
            message: backupError.message || "Could not back up Facebook group state before saving.",
          });
          return;
        }
      }

      const { error } = await supabase
        .from(FACEBOOK_GROUP_STATE_TABLE)
        .upsert(rows, { onConflict: "group_key" });

      if (error) {
        sendJson(response, 500, {
          ok: false,
          message: error.message || "Could not save Facebook group state.",
        });
        return;
      }

      sendJson(response, 200, { ok: true, saved: rows.length });
      return;
    }

    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { ok: false, message: "Method not allowed." });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "Facebook group state API failed.",
    });
  }
}
