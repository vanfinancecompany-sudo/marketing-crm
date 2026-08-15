import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const ARTICLE_IDS = [
  "5c8659ad-f5d0-42f0-b9fb-7202da78002b",
  "f6d1b83f-0b7e-4df9-a40c-b73e442fd96a",
  "f02f7e40-7476-446d-89c0-7f1610c2a812",
];
const CHUNK_SIZE = 2800;

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "production"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === "main";
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the read-only draft review.`);
  return value;
}

function firstPresent(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null) return row[name];
  }
  return null;
}

function text(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value); } catch { return String(value); }
}

function logChunks(articleId, field, value) {
  const source = text(value);
  const total = Math.max(1, Math.ceil(source.length / CHUNK_SIZE));
  for (let index = 0; index < total; index += 1) {
    marker("OPPORTUNITY_DRAFT_REVIEW_CHUNK", {
      article_id: articleId,
      field,
      index: index + 1,
      total,
      text: source.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
    });
  }
}

async function main() {
  if (!shouldRun()) {
    marker("OPPORTUNITY_DRAFT_REVIEW_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  const supabase = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const result = await supabase.from("knowledge_articles").select("*").in("id", ARTICLE_IDS);
  if (result.error) throw result.error;
  const rows = Array.isArray(result.data) ? result.data : [];

  marker("OPPORTUNITY_DRAFT_REVIEW_SUMMARY", {
    requested: ARTICLE_IDS.length,
    found: rows.length,
    database_writes: 0,
    openai_calls: 0,
    publishing_actions: 0,
  });

  for (const id of ARTICLE_IDS) {
    const row = rows.find((item) => item.id === id);
    if (!row) {
      marker("OPPORTUNITY_DRAFT_REVIEW_MISSING", { article_id: id });
      continue;
    }
    marker("OPPORTUNITY_DRAFT_REVIEW_META", {
      id: row.id,
      title: firstPresent(row, ["title"]),
      category: firstPresent(row, ["category"]),
      status: firstPresent(row, ["status"]),
      slug: firstPresent(row, ["slug"]),
      seo_title: firstPresent(row, ["seo_title", "seoTitle"]),
      meta_description: firstPresent(row, ["meta_description", "metaDescription"]),
      excerpt: firstPresent(row, ["excerpt"]),
      cta: firstPresent(row, ["cta", "call_to_action"]),
      created_at: firstPresent(row, ["created_at"]),
      updated_at: firstPresent(row, ["updated_at"]),
      source_keys: Object.keys(row).sort(),
    });
    logChunks(row.id, "content_markdown", firstPresent(row, ["content_markdown", "content", "body_markdown", "article_markdown"]));
    logChunks(row.id, "faq_json", firstPresent(row, ["faq_json", "faq", "faqs"]));
    logChunks(row.id, "quality_checks", firstPresent(row, ["quality_checks", "quality_check", "quality_results"]));
  }
}

main().catch((error) => {
  console.error("OPPORTUNITY_DRAFT_REVIEW_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
  }));
  process.exitCode = 1;
});
