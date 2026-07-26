import { articleContentHash } from "./editorialIntelligence.js";
import {
  mergeInternalLinkReviewState,
  suggestInternalLinks,
} from "./internalLinking.js";

function data(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

export async function refreshArticleInternalLinks(
  supabase,
  articleId,
  { assessmentId = null, reason = "Article content analysed." } = {}
) {
  const [articleResult, pagesResult, articlesResult, intentResult, settingsResult] =
    await Promise.all([
      supabase
        .from("knowledge_articles")
        .select("*, knowledge_topics(*)")
        .eq("id", articleId)
        .single(),
      supabase
        .from("knowledge_business_pages")
        .select("*")
        .eq("active", true)
        .eq("approval_status", "approved")
        .eq("verified", true),
      supabase
        .from("knowledge_articles")
        .select("id,title,seo_title,meta_description,excerpt,category,status")
        .eq("status", "approved"),
      supabase
        .from("knowledge_article_intents")
        .select("*")
        .eq("article_id", articleId)
        .maybeSingle(),
      supabase
        .from("knowledge_settings")
        .select("website_url")
        .eq("settings_key", "default")
        .maybeSingle(),
    ]);
  [articleResult, pagesResult, articlesResult, intentResult, settingsResult].forEach((result) =>
    data(result, "Internal-link context could not be loaded.")
  );
  const article = articleResult.data;
  const sourceHash = articleContentHash(article);
  const suggestions = suggestInternalLinks({
    article,
    topic: article.knowledge_topics || {},
    intent: intentResult.data || {},
    websitePages: pagesResult.data || [],
    knowledgeArticles: articlesResult.data || [],
    websiteUrl: settingsResult.data?.website_url || "",
    maximumSuggestions: 8,
  });
  const existing = data(
    await supabase
      .from("knowledge_internal_link_suggestions")
      .select("*")
      .eq("article_id", article.id),
    "Existing internal-link suggestions could not be loaded."
  ) || [];
  const decidedPageIds = new Set(
    existing
      .filter((item) => ["accepted", "rejected"].includes(item.status))
      .map((item) => item.website_page_id)
  );
  const currentByPage = new Map(
    existing
      .filter(
        (item) =>
          item.source_content_hash === sourceHash &&
          item.status !== "superseded"
      )
      .map((item) => [item.website_page_id, item])
  );
  const proposedPageIds = new Set(suggestions.map((item) => item.website_page_id));
  const stalePending = existing.filter(
    (item) =>
      item.status === "pending" &&
      (item.source_content_hash !== sourceHash || !proposedPageIds.has(item.website_page_id))
  );
  if (stalePending.length) {
    data(
      await supabase
        .from("knowledge_internal_link_suggestions")
        .update({ status: "superseded", updated_at: new Date().toISOString() })
        .in("id", stalePending.map((item) => item.id)),
      "Outdated internal-link suggestions could not be superseded."
    );
    data(
      await supabase.from("knowledge_internal_link_events").insert(
        stalePending.map((item) => ({
          suggestion_id: item.id,
          article_id: article.id,
          website_page_id: item.website_page_id,
          action: "superseded",
          reason: "Article content or approved destination matching changed.",
          details: { source_content_hash: item.source_content_hash },
        }))
      ),
      "Internal-link supersession history could not be saved."
    );
  }
  const rows = suggestions
    .filter((item) => !decidedPageIds.has(item.website_page_id))
    .filter((item) => !currentByPage.has(item.website_page_id))
    .map((item) => ({
      article_id: article.id,
      assessment_id: assessmentId,
      ...item,
      original_anchor_text: item.anchor_text,
      source_content_hash: sourceHash,
      status: "pending",
    }));
  const created = rows.length
    ? data(
        await supabase
          .from("knowledge_internal_link_suggestions")
          .insert(rows)
          .select(),
        "Internal-link suggestions could not be saved."
      )
    : [];
  if (assessmentId) {
    const currentPendingIds = existing
      .filter(
        (item) =>
          item.source_content_hash === sourceHash &&
          item.status === "pending" &&
          !item.assessment_id
      )
      .map((item) => item.id);
    if (currentPendingIds.length) {
      data(
        await supabase
          .from("knowledge_internal_link_suggestions")
          .update({ assessment_id: assessmentId, updated_at: new Date().toISOString() })
          .in("id", currentPendingIds),
        "Internal-link assessment references could not be updated."
      );
    }
  }
  data(
    await supabase.from("knowledge_internal_link_events").insert({
      article_id: article.id,
      action: existing.length ? "refreshed" : "generated",
      reason,
      details: {
        source_content_hash: sourceHash,
        candidates_created: created.length,
        approved_index_pages: (pagesResult.data || []).length,
        manual_approval_required: true,
        automatic_insertions: 0,
      },
    }),
    "Internal-link generation history could not be saved."
  );
  return mergeInternalLinkReviewState({
    created,
    existing,
    proposedPageIds,
    sourceHash,
  });
}
