export const VISIBILITY_PROVIDERS = Object.freeze([
  {
    key: "google_search_console",
    label: "Google Search Console",
    kind: "search",
  },
  { key: "chatgpt", label: "ChatGPT", kind: "ai" },
  { key: "gemini", label: "Gemini", kind: "ai" },
  { key: "perplexity", label: "Perplexity", kind: "ai" },
  { key: "google_ai_overviews", label: "Google AI Overviews", kind: "ai" },
]);

export const VISIBILITY_RESULT_STATUSES = Object.freeze([
  "not_checked",
  "checking",
  "indexed",
  "not_indexed",
  "performance_found",
  "detected",
  "mentioned",
  "cited",
  "not_detected",
  "inconclusive",
  "error",
]);

export const COMPLETED_RESULT_STATUSES = new Set([
  "indexed",
  "not_indexed",
  "performance_found",
  "detected",
  "mentioned",
  "cited",
  "not_detected",
  "inconclusive",
]);
export const DETECTION_STATUSES = new Set(["detected", "mentioned", "cited"]);
export const AI_PROVIDER_KEYS = new Set(
  VISIBILITY_PROVIDERS.filter((provider) => provider.kind === "ai").map(
    (provider) => provider.key,
  ),
);

const clean = (value) => String(value || "").trim();
const normalized = (value) => clean(value).toLowerCase().replace(/\s+/g, " ");
const timestamp = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

export function isConfirmedPublishedArticle(article = {}) {
  return Boolean(
    article.is_active !== false &&
      clean(article.live_wix_url) &&
      article.published_at &&
      article.publication_verified_at &&
      ["live", "synced"].includes(article.wix_sync_status) &&
      (!article.wix_publication_status ||
        article.wix_publication_status === "live"),
  );
}

export function latestVisibilityResults(results = []) {
  const supersededIds = new Set(
    results.map((result) => result.supersedes_result_id).filter(Boolean),
  );
  const latest = new Map();
  [...results]
    .filter((result) => !supersededIds.has(result.id))
    .sort(
      (first, second) =>
        timestamp(second.checked_at) - timestamp(first.checked_at),
    )
    .forEach((result) => {
      const key = `${result.article_id}:${result.provider}:${result.prompt_id || "page"}`;
      if (!latest.has(key)) latest.set(key, result);
    });
  return [...latest.values()];
}

function daysSince(value, now) {
  return Math.max(0, (timestamp(now) - timestamp(value)) / 86400000);
}

export function publishedCheckCoverage(articleResults = []) {
  const checkedArticleIds = new Set(
    articleResults
      .filter((item) => !item.awaiting_first_check)
      .map((item) => item.article.id),
  );
  const publishedArticleIds = new Set(
    articleResults.map((item) => item.article.id),
  );
  const uncheckedArticleIds = new Set(
    [...publishedArticleIds].filter(
      (articleId) => !checkedArticleIds.has(articleId),
    ),
  );
  return {
    published_article_ids: publishedArticleIds,
    checked_article_ids: checkedArticleIds,
    unchecked_article_ids: uncheckedArticleIds,
    published_count: publishedArticleIds.size,
    checked_count: checkedArticleIds.size,
    unchecked_count: uncheckedArticleIds.size,
  };
}

export function buildArticleVisibility({
  article,
  results = [],
  prompts = [],
  attentionDays = 30,
  now = new Date(),
} = {}) {
  const articleResults = results
    .filter((result) => result.article_id === article.id)
    .sort(
      (first, second) =>
        timestamp(second.checked_at) - timestamp(first.checked_at),
    );
  const latest = latestVisibilityResults(articleResults);
  const completed = latestVisibilityResults(
    articleResults.filter((result) =>
      COMPLETED_RESULT_STATUSES.has(result.result_status),
    ),
  );
  const supersededIds = new Set(
    articleResults.map((result) => result.supersedes_result_id).filter(Boolean),
  );
  const effectiveResults = articleResults.filter(
    (result) => !supersededIds.has(result.id),
  );
  const aiCompleted = completed.filter((result) =>
    AI_PROVIDER_KEYS.has(result.provider),
  );
  const detections = effectiveResults.filter((result) =>
    DETECTION_STATUSES.has(result.result_status),
  );
  const currentDetections = completed.filter((result) =>
    DETECTION_STATUSES.has(result.result_status),
  );
  const googleAttempts = articleResults.filter(
    (result) => result.provider === "google_search_console",
  );
  const latestGoogleAttempt = googleAttempts[0] || null;
  const google = completed
    .filter((result) => result.provider === "google_search_console")
    .sort(
      (first, second) =>
        timestamp(second.checked_at) - timestamp(first.checked_at),
    )[0];
  const aiAttempts = articleResults.filter((result) =>
    AI_PROVIDER_KEYS.has(result.provider),
  );
  const repeatedGoogleFailures =
    googleAttempts.slice(0, 2).length === 2 &&
    googleAttempts.slice(0, 2).every((item) => item.result_status === "error");
  const lastChecked = articleResults[0]?.checked_at || null;
  const lastGoogleChecked = latestGoogleAttempt?.checked_at || null;
  const lastAiProviderChecked = aiAttempts[0]?.checked_at || null;
  const oldEnough =
    daysSince(article.published_at, now) >= Number(attentionDays || 30);
  const visible = currentDetections.length > 0;
  const checkedSuccessfully = completed.length > 0;
  const googleAttempted = Boolean(latestGoogleAttempt);
  const latestStatuses = latest.map((result) => result.result_status);
  const visibilityStatus = visible
    ? "visible"
    : latestStatuses.includes("checking")
      ? "checking"
      : !checkedSuccessfully && latestStatuses.includes("error")
        ? "error"
        : completed.length === 0
          ? "not_checked"
          : "not_detected";
  const urlMismatch = Boolean(
    article.wix_publication_status && article.wix_publication_status !== "live",
  );
  const needsAttention = Boolean(
    repeatedGoogleFailures ||
      urlMismatch ||
      (oldEnough &&
        (google?.result_status === "not_indexed" ||
          !googleAttempted ||
          (aiCompleted.length > 0 && !visible))),
  );
  let recommendedAction = "Run the first verified visibility check.";
  if (urlMismatch)
    recommendedAction =
      "Recheck Wix publication status and the saved live URL.";
  else if (repeatedGoogleFailures)
    recommendedAction =
      "Review the Google Search Console connection and retry.";
  else if (latestGoogleAttempt?.result_status === "error")
    recommendedAction =
      "The latest Google check failed. Review the stored error and connection permissions before retrying.";
  else if (google?.result_status === "not_indexed")
    recommendedAction =
      "Review Google indexing evidence and the published page.";
  else if (google?.result_status === "inconclusive")
    recommendedAction =
      "Google completed with limited evidence. Review the stored URL Inspection details before retrying.";
  else if (visible)
    recommendedAction = "Continue monitoring; retain the evidence history.";
  else if (checkedSuccessfully)
    recommendedAction =
      "No AI detection is verified; retain the stored provider evidence.";

  return {
    article,
    results: articleResults,
    prompts: prompts.filter((prompt) => prompt.article_id === article.id),
    latest_results: latest,
    google_indexing_status:
      latestGoogleAttempt?.result_status === "error"
        ? "error"
        : google?.result_status === "indexed" ||
            google?.result_status === "not_indexed" ||
            google?.result_status === "performance_found" ||
            google?.result_status === "inconclusive"
          ? google.result_status
          : "not_checked",
    platforms_checked: [
      ...new Set(
        latest
          .filter((result) => result.result_status !== "not_checked")
          .map((result) => result.provider),
      ),
    ],
    visibility_status: visibilityStatus,
    visible,
    ai_eligible: aiCompleted.length > 0,
    checked_successfully: checkedSuccessfully,
    google_check_attempted: googleAttempted,
    awaiting_first_check: !googleAttempted,
    needs_attention: needsAttention,
    first_detected_at: detections.length
      ? [...detections].sort(
          (a, b) => timestamp(a.checked_at) - timestamp(b.checked_at),
        )[0].checked_at
      : null,
    last_detected_at: detections[0]?.checked_at || null,
    total_detections: detections.length,
    last_checked_at: lastChecked,
    last_google_checked_at: lastGoogleChecked,
    last_ai_provider_checked_at: lastAiProviderChecked,
    last_wix_synced_at: article.last_wix_sync_at || null,
    recommended_action: recommendedAction,
  };
}

export function buildVisibilitySummary({
  articles = [],
  results = [],
  prompts = [],
  attentionDays = 30,
  now = new Date(),
} = {}) {
  const published = articles.filter(isConfirmedPublishedArticle);
  const articleResults = published.map((article) =>
    buildArticleVisibility({ article, results, prompts, attentionDays, now }),
  );
  const coverage = publishedCheckCoverage(articleResults);
  const aiEligible = articleResults.filter((item) => item.ai_eligible);
  const visible = articleResults.filter((item) => item.visible);
  const supersededIds = new Set(
    results.map((result) => result.supersedes_result_id).filter(Boolean),
  );
  const providerDetections = Object.fromEntries(
    ["chatgpt", "gemini", "perplexity", "google_ai_overviews"].map(
      (provider) => [
        provider,
        results.filter(
          (result) =>
            provider === result.provider &&
            DETECTION_STATUSES.has(result.result_status) &&
            !supersededIds.has(result.id) &&
            published.some((article) => article.id === result.article_id),
        ).length,
      ],
    ),
  );
  const lastChecked =
    results
      .filter((result) =>
        published.some((article) => article.id === result.article_id),
      )
      .sort(
        (first, second) =>
          timestamp(second.checked_at) - timestamp(first.checked_at),
      )[0]?.checked_at || null;
  return {
    published_pages: coverage.published_count,
    checked_pages: coverage.checked_count,
    unchecked_pages: coverage.unchecked_count,
    checked_article_ids: [...coverage.checked_article_ids],
    unchecked_article_ids: [...coverage.unchecked_article_ids],
    google_indexed: articleResults.filter(
      (item) => item.google_indexing_status === "indexed",
    ).length,
    ai_visible: visible.length,
    chatgpt_detections: providerDetections.chatgpt,
    gemini_detections: providerDetections.gemini,
    perplexity_detections: providerDetections.perplexity,
    google_ai_overview_detections: providerDetections.google_ai_overviews,
    awaiting_first_check: coverage.unchecked_count,
    needs_attention: articleResults.filter((item) => item.needs_attention)
      .length,
    total_verified_detections: Object.values(providerDetections).reduce(
      (total, count) => total + count,
      0,
    ),
    visibility_rate: aiEligible.length
      ? Math.round((visible.length / aiEligible.length) * 100)
      : 0,
    visibility_rate_numerator: visible.length,
    visibility_rate_denominator: aiEligible.length,
    last_checked_at: lastChecked,
    articles: articleResults,
  };
}

function fingerprint(value) {
  let hash = 2166136261;
  for (const character of normalized(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function visibilityPromptFingerprint(value) {
  return fingerprint(value);
}

export function deriveVisibilityPrompts({
  article = {},
  topic = {},
  businessSections = [],
  maximum = 8,
} = {}) {
  const candidates = [
    { prompt_text: clean(article.title), prompt_source: "article_title" },
    {
      prompt_text: clean(topic.primary_keyword || topic.intent)
        ? `What should a UK customer know about ${clean(topic.primary_keyword || topic.intent)}?`
        : "",
      prompt_source: "search_intent",
    },
    {
      prompt_text: clean(article.generation_metadata?.target_audience)
        ? `What does ${clean(article.generation_metadata.target_audience)} need to know about ${clean(article.title)}?`
        : "",
      prompt_source: "customer_question",
    },
    ...(Array.isArray(article.faq_json) ? article.faq_json : []).map((faq) => ({
      prompt_text: clean(faq?.question),
      prompt_source: "faq",
    })),
  ];
  businessSections
    .filter((section) =>
      ["business_vocabulary", "customer_personas", "products"].includes(
        section.section_key,
      ),
    )
    .flatMap((section) =>
      Array.isArray(section.entries) ? section.entries : [],
    )
    .map((entry) => clean(entry.label || entry.value))
    .filter(Boolean)
    .slice(0, 2)
    .forEach((term) =>
      candidates.push({
        prompt_text: `How does ${term} help a customer choosing a van?`,
        prompt_source: "business_brain",
      }),
    );
  const seen = new Set();
  return candidates
    .map((candidate) => ({
      ...candidate,
      prompt_text: candidate.prompt_text.slice(0, 500),
      prompt_fingerprint: fingerprint(candidate.prompt_text),
    }))
    .filter((candidate) => {
      if (
        candidate.prompt_text.length < 5 ||
        seen.has(candidate.prompt_fingerprint)
      )
        return false;
      seen.add(candidate.prompt_fingerprint);
      return true;
    })
    .slice(0, Math.max(1, Math.min(25, Number(maximum) || 8)));
}

export function filterVisibilityArticles(
  items = [],
  {
    search = "",
    provider = "all",
    status = "all",
    from = "",
    to = "",
    sort = "needs_attention",
  } = {},
) {
  const query = normalized(search);
  const fromTime = timestamp(from);
  const toTime = to ? timestamp(`${to}T23:59:59.999Z`) : 0;
  const filtered = items.filter((item) => {
    const article = item.article || {};
    if (
      query &&
      !normalized(`${article.title} ${article.live_wix_url}`).includes(query)
    )
      return false;
    const providerResults = item.latest_results.filter(
      (result) => result.provider === provider,
    );
    if (provider !== "all" && !providerResults.length) return false;
    if (
      status === "visible" &&
      !(provider === "all"
        ? item.visible
        : providerResults.some((result) =>
            DETECTION_STATUSES.has(result.result_status),
          ))
    )
      return false;
    if (status === "indexed" && item.google_indexing_status !== "indexed")
      return false;
    if (status === "checked" && item.awaiting_first_check) return false;
    if (
      status === "never_detected" &&
      (item.visible || !item.checked_successfully)
    )
      return false;
    if (status === "not_checked" && !item.awaiting_first_check) return false;
    if (status === "needs_attention" && !item.needs_attention) return false;
    const published = timestamp(article.published_at);
    if (fromTime && published < fromTime) return false;
    if (toTime && published > toTime) return false;
    return true;
  });
  const comparators = {
    most_visible: (a, b) => b.total_detections - a.total_detections,
    never_detected: (a, b) =>
      Number(a.visible) - Number(b.visible) ||
      timestamp(a.last_checked_at) - timestamp(b.last_checked_at),
    recently_detected: (a, b) =>
      timestamp(b.last_detected_at) - timestamp(a.last_detected_at),
    oldest_check: (a, b) =>
      timestamp(a.last_checked_at) - timestamp(b.last_checked_at),
    newest_publication: (a, b) =>
      timestamp(b.article.published_at) - timestamp(a.article.published_at),
    needs_attention: (a, b) =>
      Number(b.needs_attention) - Number(a.needs_attention) ||
      timestamp(a.last_checked_at) - timestamp(b.last_checked_at),
  };
  return filtered.sort(comparators[sort] || comparators.needs_attention);
}
