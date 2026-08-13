import { articleContentHash } from "./editorialIntelligence.js";
import {
  mergeInternalLinkReviewState,
  suggestInternalLinks,
} from "./internalLinking.js";
import {
  classifyKnowledgeLinkProduct,
  filterInternalLinkCandidates,
  selectFocusedInternalLinkSuggestions,
} from "./internalLinkStrategy.js";
import { ensureKnowledgeArticleWebsiteIndex } from "./knowledgeArticleWebsiteIndex.js";

function data(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

export function planInternalLinkSuggestionWrites({ suggestions = [], existing = [], sourceHash = "" } = {}) {
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
  const supersededByPage = new Map(
    existing
      .filter(
        (item) =>
          item.source_content_hash === sourceHash &&
          item.status === "superseded"
      )
      .map((item) => [item.website_page_id, item])
  );

  const revive = [];
  const insert = [];
  for (const item of suggestions) {
    if (decidedPageIds.has(item.website_page_id)) continue;
    if (currentByPage.has(item.website_page_id)) continue;
    const superseded = supersededByPage.get(item.website_page_id);
    if (superseded) revive.push({ existing: superseded, suggestion: item });
    else insert.push(item);
  }

  return { decidedPageIds, currentByPage, revive, insert };
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
        .select("*"),
      supabase
        .from("knowledge_articles")
        .select("id,title,slug,seo_title,meta_description,excerpt,category,article_type,status,is_active,wix_item_id,wix_publication_status"),
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
  const topic = article.knowledge_topics || {};
  const intent = intentResult.data || {};
  const allKnowledgeArticles = articlesResult.data || [];
  const knowledgeArticles = allKnowledgeArticles.filter((item) => item.status === "approved");
  const allIndexPages = pagesResult.data || [];
  const indexSync = await ensureKnowledgeArticleWebsiteIndex({
    supabase,
    articles: allKnowledgeArticles,
    existingPages: allIndexPages,
  });
  const websitePages = (indexSync.rows || []).filter(
    (page) =>
      page.active !== false &&
      page.approval_status === "approved" &&
      page.verified === true
  );

  const sourceHash = articleContentHash(article);
  const linkProduct = classifyKnowledgeLinkProduct({ article, topic, intent });
  const eligiblePages = filterInternalLinkCandidates({
    article,
    topic,
    intent,
    websitePages,
    knowledgeArticles,
  });
  const rankedSuggestions = suggestInternalLinks({
    article,
    topic,
    intent,
    websitePages: eligiblePages,
    knowledgeArticles,
    websiteUrl: settingsResult.data?.website_url || "",
    maximumSuggestions: 8,
  });
  const suggestions = selectFocusedInternalLinkSuggestions(rankedSuggestions, {
    maximumKnowledgeLinks: 2,
    maximumCommercialLinks: 2,
    minimumKnowledgeConfidence: 45,
  });

  const existing = data(
    await supabase
      .from("knowledge_internal_link_suggestions")
      .select("*")
      .eq("article_id", article.id),
    "Existing internal-link suggestions could not be loaded."
  ) || [];
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

  const writePlan = planInternalLinkSuggestionWrites({ suggestions, existing, sourceHash });
  const revived = [];
  for (const { existing: superseded, suggestion } of writePlan.revive) {
    const revivedRows = data(
      await supabase
        .from("knowledge_internal_link_suggestions")
        .update({
          assessment_id: assessmentId,
          target_type: suggestion.target_type,
          target_article_id: suggestion.target_article_id,
          destination_title: suggestion.destination_title,
          destination_url: suggestion.destination_url,
          anchor_text: suggestion.anchor_text,
          original_anchor_text: suggestion.anchor_text,
          confidence_score: suggestion.confidence_score,
          reason: suggestion.reason,
          context: suggestion.context || "",
          status: "pending",
          decided_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", superseded.id)
        .select(),
      "Superseded internal-link suggestion could not be revived."
    ) || [];
    revived.push(...revivedRows);
  }

  const rows = writePlan.insert.map((item) => ({
    article_id: article.id,
    assessment_id: assessmentId,
    ...item,
    original_anchor_text: item.anchor_text,
    source_content_hash: sourceHash,
    status: "pending",
  }));
  const inserted = rows.length
    ? data(
        await supabase
          .from("knowledge_internal_link_suggestions")
          .insert(rows)
          .select(),
        "Internal-link suggestions could not be saved."
      )
    : [];
  const created = [...revived, ...inserted];

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
        candidates_created: inserted.length,
        candidates_revived: revived.length,
        approved_index_pages: websitePages.length,
        knowledge_article_index_rows_created: indexSync.created.length,
        eligible_strategy_pages: eligiblePages.length,
        ranked_strategy_candidates: rankedSuggestions.length,
        focused_suggestions: suggestions.length,
        link_product: linkProduct,
        strategy_version: "focused-v2-live-knowledge-index",
        maximum_knowledge_links: 2,
        maximum_commercial_links: 2,
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
