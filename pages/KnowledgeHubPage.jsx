import { useEffect, useMemo, useRef, useState } from "react";
import {
  KNOWLEDGE_ARTICLE_STATUSES,
  KNOWLEDGE_ARTICLE_TYPES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_TOPIC_STATUSES,
  buildKnowledgeAnalytics,
  calculateKnowledgeQualityChecks,
  findKnowledgeTopicDuplicates,
  markdownToKnowledgeHtml,
  slugifyKnowledgeArticle,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";
import {
  normalizeBusinessKnowledgeSections,
} from "../lib/businessIntelligence.js";
import {
  bulkUpdateKnowledgeArticles,
  deleteKnowledgeTopic,
  findKnowledgeTopics,
  generateKnowledgeArticle,
  loadKnowledgeHub,
  requestKnowledgeHub,
  reviewKnowledgeArticle,
  saveKnowledgeArticle,
  saveBusinessKnowledgeSection,
  saveKnowledgeTemplate,
  saveKnowledgeTopic,
  saveKnowledgeTopicIdeas,
} from "../services/knowledgeHub.js";
import {
  BatchGenerationPanel,
  BusinessSettingsPanel,
  ContentIntelligenceDashboard,
  PriorityStars,
  TopicFinderPanel,
} from "../components/KnowledgeHubV2Panels.jsx";
import {
  ArticleQualityScore,
  BusinessKnowledgeCentre,
  PromptBuilderNotice,
} from "../components/KnowledgeHubV3Panels.jsx";
import {
  MARKETING_ACCESS_DENIED_EVENT,
  clearMarketingAccessKey,
  getStoredMarketingAccessKey,
  isMarketingAccessDenied,
  saveMarketingAccessKey,
  validateMarketingAccessKey,
} from "../services/marketingAccess.js";

const EMPTY_TOPIC = {
  title: "",
  category: "Van Finance",
  primary_keyword: "",
  secondary_keywords: [],
  intent: "",
  notes: "",
  status: "idea",
  priority: 3,
  source: "manual",
};

const EMPTY_GENERATION = {
  templateKey: "faq",
  targetAudience: "UK van buyers",
  tone: "Helpful, clear and factual",
  instructions: "",
  approximateLength: 1000,
};

const EMPTY_SETTINGS = {
  business_name: "Van Finance Company",
  website_url: "https://www.vanfinancecompany.co.uk",
  default_cta: "View available vans and apply when you are ready.",
  default_tone: "Helpful, clear and factual",
  default_audience: "UK van buyers",
  business_description: "",
  products_services: "",
  factual_guidance: "",
  prohibited_claims: "",
  target_audiences: [],
  content_goals: [],
  freshness_days: 180,
};

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-GB");
}

function Field({ label, error, children, wide = false }) {
  return (
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="knowledge-field-error">{error}</span> : null}
    </label>
  );
}

function StatusPill({ value }) {
  const positive = ["ready", "generated", "approved", "exported"].includes(value);
  const tone = positive ? "green" : value === "archived" ? "default" : "amber";
  return <span className={`status-pill stat-card--${tone}`}>{value}</span>;
}

function AccessGate({ checking, apiKey, setApiKey, error, onUnlock }) {
  return (
    <section className="panel knowledge-access-panel">
      <div className="eyebrow">Protected Marketing Tool</div>
      <h3>{checking ? "Checking saved access..." : "Unlock Knowledge Hub"}</h3>
      <p>Knowledge Hub uses the same protected access as Customer Database and Marketing Centre.</p>
      {!checking ? (
        <form onSubmit={onUnlock} className="field-grid">
          <Field label="Marketing access key" wide>
            <input
              className="field__input"
              type="password"
              autoComplete="current-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              required
            />
          </Field>
          <div className="card-actions">
            <button type="submit" className="button button--primary">Unlock</button>
          </div>
        </form>
      ) : null}
      {error ? <div className="notice notice--error">{error}</div> : null}
    </section>
  );
}

function Filters({
  search,
  setSearch,
  category,
  setCategory,
  status,
  setStatus,
  type,
  setType,
  priority,
  setPriority,
  articleMode = false,
}) {
  return (
    <div className="knowledge-filters">
      <input
        className="field__input"
        placeholder="Search title, topic or keyword..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <select className="field__input" value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="all">All categories</option>
        {KNOWLEDGE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
      </select>
      <select className="field__input" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="all">All statuses</option>
        {(articleMode ? KNOWLEDGE_ARTICLE_STATUSES : KNOWLEDGE_TOPIC_STATUSES).map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
      {articleMode ? (
        <select className="field__input" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="all">All article types</option>
          {KNOWLEDGE_ARTICLE_TYPES.map((item) => <option key={item}>{item}</option>)}
        </select>
      ) : (
        <select className="field__input" value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="all">All priorities</option>
          {[5, 4, 3, 2, 1].map((item) => <option value={item} key={item}>{item} star{item === 1 ? "" : "s"}</option>)}
        </select>
      )}
    </div>
  );
}

export default function KnowledgeHubPage() {
  const [accessStatus, setAccessStatus] = useState(() => (getStoredMarketingAccessKey() ? "checking" : "locked"));
  const [apiKey, setApiKey] = useState("");
  const [screen, setScreen] = useState("dashboard");
  const [topics, setTopics] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [articles, setArticles] = useState([]);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [businessSections, setBusinessSections] = useState(() =>
    normalizeBusinessKnowledgeSections([], EMPTY_SETTINGS)
  );
  const [articleReviews, setArticleReviews] = useState([]);
  const [aiConfiguration, setAiConfiguration] = useState(null);
  const [topicForm, setTopicForm] = useState(null);
  const [generationTopic, setGenerationTopic] = useState(null);
  const [generation, setGeneration] = useState(EMPTY_GENERATION);
  const [article, setArticle] = useState(null);
  const [faqDraft, setFaqDraft] = useState("[]");
  const [originalArticle, setOriginalArticle] = useState("");
  const [editorErrors, setEditorErrors] = useState({});
  const [preview, setPreview] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [selectedTopicIds, setSelectedTopicIds] = useState([]);
  const [selectedArticleIds, setSelectedArticleIds] = useState([]);
  const [finderCategories, setFinderCategories] = useState(["Van Finance", "Rent2Buy"]);
  const [finderQuantity, setFinderQuantity] = useState(12);
  const [finderBrief, setFinderBrief] = useState("");
  const [finderIdeas, setFinderIdeas] = useState([]);
  const [finderSelectedIndexes, setFinderSelectedIndexes] = useState([]);
  const [finderDuplicateCount, setFinderDuplicateCount] = useState(0);
  const [batchProgress, setBatchProgress] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = useRef(false);

  async function loadData() {
    setBusy(true);
    setError("");
    try {
      const result = await loadKnowledgeHub();
      setTopics(result.topics || []);
      setTemplates(result.templates || []);
      setArticles(result.articles || []);
      const loadedSettings = { ...EMPTY_SETTINGS, ...(result.settings || {}) };
      setSettings(loadedSettings);
      setBusinessSections(
        normalizeBusinessKnowledgeSections(result.business_sections || [], loadedSettings)
      );
      setArticleReviews(result.article_reviews || []);
      setAiConfiguration(result.ai_configuration || null);
      setAccessStatus("unlocked");
    } catch (loadError) {
      if (isMarketingAccessDenied(loadError)) setAccessStatus("locked");
      setError(loadError.message || "Knowledge Hub could not load.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function validateStoredAccess() {
      const stored = getStoredMarketingAccessKey();
      if (!stored) {
        if (active) setAccessStatus("locked");
        return;
      }
      try {
        await validateMarketingAccessKey(stored);
        if (active) await loadData();
      } catch (accessError) {
        if (!active) return;
        clearMarketingAccessKey();
        setAccessStatus("locked");
        setError(accessError.message || "Your saved access is no longer valid.");
      }
    }
    validateStoredAccess();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleAppNavigation(event) {
      if (
        dirty.current &&
        !window.confirm("You have unsaved article changes. Leave without saving?")
      ) {
        event.preventDefault();
      }
    }
    window.addEventListener("marketing-before-navigate", handleAppNavigation);
    return () => window.removeEventListener("marketing-before-navigate", handleAppNavigation);
  }, []);

  useEffect(() => {
    function handleDenied(event) {
      setAccessStatus("locked");
      setError(event.detail?.message || "Your saved access is no longer valid.");
    }
    window.addEventListener(MARKETING_ACCESS_DENIED_EVENT, handleDenied);
    return () => window.removeEventListener(MARKETING_ACCESS_DENIED_EVENT, handleDenied);
  }, []);

  useEffect(() => {
    function warn(event) {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function handleUnlock(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await validateMarketingAccessKey(apiKey);
      saveMarketingAccessKey(apiKey);
      setApiKey("");
      await loadData();
    } catch (accessError) {
      clearMarketingAccessKey();
      setAccessStatus("locked");
      setError(accessError.message || "Access key not recognised.");
    } finally {
      setBusy(false);
    }
  }

  function resetFilters() {
    setSearch("");
    setCategoryFilter("all");
    setStatusFilter("all");
    setTypeFilter("all");
    setPriorityFilter("all");
  }

  function navigate(nextScreen) {
    if (dirty.current && !window.confirm("You have unsaved article changes. Leave without saving?")) return;
    dirty.current = false;
    setArticle(null);
    setPreview(false);
    setError("");
    setMessage("");
    resetFilters();
    setScreen(nextScreen);
  }

  const filteredTopics = useMemo(() => {
    const term = search.toLowerCase();
    return topics.filter(
      (topic) =>
        (categoryFilter === "all" || topic.category === categoryFilter) &&
        (statusFilter === "all" || topic.status === statusFilter) &&
        (priorityFilter === "all" || Number(topic.priority || 3) === Number(priorityFilter)) &&
        `${topic.title} ${topic.primary_keyword || ""}`.toLowerCase().includes(term)
    ).sort((first, second) => Number(second.priority || 3) - Number(first.priority || 3));
  }, [topics, search, categoryFilter, statusFilter, priorityFilter]);

  const filteredArticles = useMemo(() => {
    const term = search.toLowerCase();
    return articles.filter(
      (item) =>
        (categoryFilter === "all" || item.category === categoryFilter) &&
        (statusFilter === "all" || item.status === statusFilter) &&
        (typeFilter === "all" || item.article_type === typeFilter) &&
        `${item.title} ${item.knowledge_topics?.title || ""} ${
          item.knowledge_topics?.primary_keyword || ""
        }`
          .toLowerCase()
          .includes(term)
    );
  }, [articles, search, categoryFilter, statusFilter, typeFilter]);

  const analytics = useMemo(
    () =>
      buildKnowledgeAnalytics({
        topics,
        articles,
        freshnessDays: settings.freshness_days,
      }),
    [topics, articles, settings.freshness_days]
  );
  const latestReviewByArticle = useMemo(() => {
    const latest = new Map();
    articleReviews.forEach((review) => {
      if (!latest.has(review.article_id)) latest.set(review.article_id, review);
    });
    return latest;
  }, [articleReviews]);

  async function handleSaveTopic() {
    const duplicates = findKnowledgeTopicDuplicates(topicForm, topics);
    if (duplicates[0]?.exact) {
      setError(`A topic named "${duplicates[0].topic.title}" already exists.`);
      return;
    }
    if (
      duplicates.length &&
      !window.confirm(
        `A similar topic exists: "${duplicates[0].topic.title}". Save this topic anyway?`
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await saveKnowledgeTopic(topicForm);
      setTopics((current) =>
        topicForm.id
          ? current.map((item) => (item.id === result.topic.id ? result.topic : item))
          : [result.topic, ...current]
      );
      setTopicForm(null);
      setMessage("Topic saved.");
    } catch (saveError) {
      setError(saveError.message || "Topic could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteTopic(topic) {
    if (!window.confirm(`Delete "${topic.title}"? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteKnowledgeTopic(topic.id);
      setTopics((current) => current.filter((item) => item.id !== topic.id));
      setMessage("Topic deleted.");
    } catch (deleteError) {
      setError(deleteError.message || "Topic could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  function beginGeneration(topic) {
    const existingArticle = articles.find(
      (item) => item.topic_id === topic.id && item.status !== "archived"
    );
    if (existingArticle) {
      setError(`This topic already has an active article: "${existingArticle.title}".`);
      return;
    }
    const duplicates = findKnowledgeTopicDuplicates(topic, topics).filter(
      (match) => match.topic.id !== topic.id
    );
    if (
      duplicates.length &&
      !window.confirm(
        `This topic is similar to "${duplicates[0].topic.title}". Generate an article anyway?`
      )
    ) {
      return;
    }
    setGenerationTopic(topic);
    setGeneration({
      ...EMPTY_GENERATION,
      targetAudience: settings.default_audience || EMPTY_GENERATION.targetAudience,
      tone: settings.default_tone || EMPTY_GENERATION.tone,
    });
    setScreen("generate");
    setError("");
    setMessage("");
  }

  function openArticle(item) {
    const editable = { ...item, faq_json: item.faq_json || [] };
    setArticle(editable);
    setFaqDraft(JSON.stringify(editable.faq_json, null, 2));
    setOriginalArticle(JSON.stringify(editable));
    setEditorErrors({});
    setPreview(false);
    dirty.current = false;
    setScreen("editor");
  }

  async function handleGenerateArticle() {
    setBusy(true);
    setError("");
    try {
      const result = await generateKnowledgeArticle(generationTopic, generation);
      const generated = result.article;
      setArticles((current) => [generated, ...current]);
      setTopics((current) =>
        current.map((item) =>
          item.id === generationTopic.id ? { ...item, status: "generated" } : item
        )
      );
      openArticle(generated);
      setMessage("Article generated and saved as a draft.");
    } catch (generationError) {
      setError(generationError.message || "Article generation failed. Your inputs have been kept.");
    } finally {
      setBusy(false);
    }
  }

  function updateArticle(field, value) {
    setArticle((current) => {
      const next = { ...current, [field]: value };
      if (
        field === "title" &&
        (!current.slug || current.slug === slugifyKnowledgeArticle(current.title))
      ) {
        next.slug = slugifyKnowledgeArticle(value);
      }
      dirty.current = JSON.stringify(next) !== originalArticle;
      return next;
    });
  }

  async function handleSaveArticle(nextStatus = article.status) {
    const nextArticle = {
      ...article,
      status: nextStatus,
      content_html: markdownToKnowledgeHtml(article.content_markdown),
      quality_checks: calculateKnowledgeQualityChecks(
        article,
        article.generation_metadata?.approximate_length
      ),
    };
    const validation = validateKnowledgeArticle(nextArticle);
    setEditorErrors(validation);
    if (Object.keys(validation).length) return;
    setBusy(true);
    setError("");
    try {
      const result = await saveKnowledgeArticle(nextArticle, nextStatus);
      setArticle(result.article);
      setFaqDraft(JSON.stringify(result.article.faq_json || [], null, 2));
      setOriginalArticle(JSON.stringify(result.article));
      dirty.current = false;
      setArticles((current) =>
        current.map((item) => (item.id === result.article.id ? result.article : item))
      );
      setMessage(
        nextStatus === "approved"
          ? "Article approved."
          : nextStatus === "archived"
            ? "Article archived."
            : "Draft saved."
      );
    } catch (saveError) {
      setError(saveError.message || "Article could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkUpdate(nextStatus) {
    if (!selectedArticleIds.length) return;
    if (
      nextStatus === "approved" &&
      !window.confirm(`Approve ${selectedArticleIds.length} selected article(s)?`)
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await bulkUpdateKnowledgeArticles(selectedArticleIds, nextStatus);
      setArticles((current) =>
        current.map((item) =>
          result.update.ids.includes(item.id) ? { ...item, ...result.update } : item
        )
      );
      setSelectedArticleIds([]);
      setMessage(
        nextStatus === "approved" ? "Selected articles approved." : "Selected articles archived."
      );
    } catch (updateError) {
      setError(updateError.message || "Articles could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings() {
    setBusy(true);
    setError("");
    try {
      const result = await requestKnowledgeHub("saveSettings", { settings });
      setSettings({ ...EMPTY_SETTINGS, ...result.settings });
      setMessage("Business Settings saved.");
    } catch (saveError) {
      setError(saveError.message || "Knowledge Hub settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function updateTemplate(index, field, value) {
    setTemplates((current) =>
      current.map((template, templateIndex) =>
        templateIndex === index ? { ...template, [field]: value } : template
      )
    );
  }

  async function handleSaveTemplate(template) {
    setBusy(true);
    setError("");
    try {
      const result = await saveKnowledgeTemplate(template);
      setTemplates((current) =>
        current.map((item) => (item.key === result.template.key ? result.template : item))
      );
      setMessage(`${result.template.name} saved.`);
    } catch (templateError) {
      setError(templateError.message || "Specialist template could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function updateBusinessSection(index, field, value) {
    setBusinessSections((current) =>
      current.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, [field]: value } : section
      )
    );
  }

  async function handleSaveBusinessSection(section) {
    setBusy(true);
    setError("");
    try {
      const result = await saveBusinessKnowledgeSection(section);
      setBusinessSections((current) =>
        current.map((item) =>
          item.section_key === result.business_section.section_key
            ? {
                ...item,
                ...result.business_section,
                entryLabel: item.entryLabel,
              }
            : item
        )
      );
      setMessage(`${result.business_section.title} saved to Business Intelligence.`);
    } catch (sectionError) {
      setError(sectionError.message || "Business Knowledge section could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReviewArticle() {
    if (!article?.id || article.status !== "draft") {
      setError("Only a saved draft can be sent to the AI Reviewer.");
      return;
    }
    if (dirty.current) {
      setError("Save the draft before running AI Reviewer so it scores the current content.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await reviewKnowledgeArticle(article.id);
      setArticleReviews((current) => [
        result.review,
        ...current.filter((review) => review.id !== result.review.id),
      ]);
      setMessage(
        `AI review saved. Article Quality Score: ${result.review.overall_score}/100. No content was changed.`
      );
    } catch (reviewError) {
      setError(reviewError.message || "AI Reviewer could not score this draft.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFindTopics() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await findKnowledgeTopics(
        finderCategories,
        Number(finderQuantity),
        finderBrief
      );
      const ideas = result.finder.ideas || [];
      setFinderIdeas(ideas);
      setFinderSelectedIndexes(ideas.map((_, index) => index));
      setFinderDuplicateCount(result.finder.duplicate_count || 0);
      if (!ideas.length) setMessage("No distinct topic gaps were returned. Try a narrower brief.");
    } catch (finderError) {
      setError(finderError.message || "AI Topic Finder could not generate suggestions.");
    } finally {
      setBusy(false);
    }
  }

  function updateFinderIdea(index, field, value) {
    setFinderIdeas((current) =>
      current.map((idea, ideaIndex) =>
        ideaIndex === index ? { ...idea, [field]: value } : idea
      )
    );
  }

  async function handleSaveTopicIdeas() {
    const selected = finderIdeas.filter((_, index) => finderSelectedIndexes.includes(index));
    if (!selected.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await saveKnowledgeTopicIdeas(selected);
      setTopics((current) => [...(result.finder.topics || []), ...current]);
      setFinderIdeas([]);
      setFinderSelectedIndexes([]);
      const skipped = result.finder.skipped?.length || 0;
      setMessage(
        `${result.finder.topics?.length || 0} topic idea(s) saved${
          skipped ? `; ${skipped} duplicate(s) skipped` : ""
        }.`
      );
    } catch (saveError) {
      setError(saveError.message || "Selected topic ideas could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function beginBatchGeneration() {
    const requested = topics.filter((topic) => selectedTopicIds.includes(topic.id));
    const eligible = requested.filter(
      (topic) =>
        !articles.some(
          (item) => item.topic_id === topic.id && item.status !== "archived"
        )
    );
    const selected = eligible.slice(0, 10);
    if (!selected.length) {
      setError("Every selected topic already has an active article.");
      return;
    }
    const notes = [];
    if (eligible.length < requested.length) notes.push("topics with an active article were excluded");
    if (eligible.length > 10) notes.push("the batch was limited to the first 10 eligible topics");
    setMessage(notes.length ? `${notes.join("; ")}.` : "");
    setSelectedTopicIds(selected.map((topic) => topic.id));
    setGeneration({
      ...EMPTY_GENERATION,
      templateKey: templates.some((template) => template.key === "faq")
        ? "faq"
        : templates[0]?.key || "faq",
      targetAudience: settings.default_audience || EMPTY_GENERATION.targetAudience,
      tone: settings.default_tone || EMPTY_GENERATION.tone,
    });
    setBatchProgress(
      selected.map((topic) => ({ topic_id: topic.id, status: "waiting", message: "Waiting" }))
    );
    setScreen("batch");
    setError("");
  }

  async function handleBatchGeneration() {
    const selected = topics
      .filter((topic) => selectedTopicIds.includes(topic.id))
      .slice(0, 10);
    setBusy(true);
    setError("");
    let completed = 0;
    let failed = 0;
    for (const topic of selected) {
      setBatchProgress((current) =>
        current.map((item) =>
          item.topic_id === topic.id
            ? { ...item, status: "running", message: "Generating..." }
            : item
        )
      );
      try {
        const result = await generateKnowledgeArticle(topic, generation);
        const generated = result.article;
        completed += 1;
        setArticles((current) => [generated, ...current]);
        setTopics((current) =>
          current.map((item) =>
            item.id === topic.id ? { ...item, status: "generated" } : item
          )
        );
        setBatchProgress((current) =>
          current.map((item) =>
            item.topic_id === topic.id
              ? { ...item, status: "complete", message: "Draft saved" }
              : item
          )
        );
      } catch (batchError) {
        failed += 1;
        setBatchProgress((current) =>
          current.map((item) =>
            item.topic_id === topic.id
              ? {
                  ...item,
                  status: "failed",
                  message: batchError.message || "Generation failed",
                }
              : item
          )
        );
      }
    }
    setBusy(false);
    setMessage(`${completed} draft(s) generated${failed ? `; ${failed} failed` : ""}.`);
  }

  if (accessStatus !== "unlocked") {
    return (
      <AccessGate
        checking={accessStatus === "checking"}
        apiKey={apiKey}
        setApiKey={setApiKey}
        error={error}
        onUnlock={handleUnlock}
      />
    );
  }

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const stats = [
    ["Topics", topics.length],
    ["Draft articles", articles.filter((item) => item.status === "draft").length],
    ["Approved articles", articles.filter((item) => item.status === "approved").length],
    [
      "Generated this month",
      articles.filter((item) => new Date(item.created_at) >= monthStart).length,
    ],
  ];

  return (
    <div className="page-stack knowledge-hub">
      <section className="hero-panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Business Intelligence V3 · Content Intelligence V2</div>
            <h2>Knowledge Hub</h2>
            <p>Build from confirmed business knowledge, review drafts and approve manually. Nothing publishes automatically.</p>
          </div>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              clearMarketingAccessKey();
              setAccessStatus("locked");
            }}
          >
            Lock
          </button>
        </div>
      </section>

      <div className="knowledge-tabs">
        {[
          ["dashboard", "Dashboard"],
          ["topics", "Topic Planner"],
          ["finder", "AI Topic Finder"],
          ["articles", "Article Library"],
          ["business", "Business Knowledge"],
          ["settings", "Settings & Specialists"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={screen === key ? "button button--primary" : "button button--ghost"}
            onClick={() => navigate(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}
      {message ? <div className="notice knowledge-notice-success">{message}</div> : null}
      {aiConfiguration && !aiConfiguration.configured ? (
        <div className="notice notice--error">
          OPENAI_API_KEY is missing from this {aiConfiguration.environment} deployment
          {aiConfiguration.deployment_host ? ` (${aiConfiguration.deployment_host})` : ""}. Add
          it to the Vercel project that owns this URL and redeploy before generating articles.
        </div>
      ) : null}
      {busy && screen === "dashboard" ? <div className="notice">Loading Knowledge Hub...</div> : null}

      {screen === "dashboard" ? (
        <>
          <section className="stats-grid knowledge-stats-grid">
            {stats.map(([label, value]) => (
              <div className="stat-card" key={label}>
                <div className="stat-card__label">{label}</div>
                <div className="stat-card__value">{value}</div>
              </div>
            ))}
          </section>
          <section className="knowledge-two-column">
            <div className="panel">
              <div className="panel__header"><div><h3>Recent articles</h3><p>Latest saved drafts and approvals.</p></div></div>
              <div className="knowledge-list">
                {articles.slice(0, 6).map((item) => (
                  <button type="button" key={item.id} className="knowledge-list__item" onClick={() => openArticle(item)}>
                    <span><strong>{item.title}</strong><small>{item.category} · {formatDate(item.updated_at)}</small></span>
                    <StatusPill value={item.status} />
                  </button>
                ))}
                {!articles.length ? <div className="notice">No articles yet.</div> : null}
              </div>
            </div>
            <div className="panel">
              <div className="panel__header"><div><h3>Quick actions</h3><p>Start the next content task.</p></div></div>
              <div className="knowledge-quick-actions">
                <button className="button button--primary" onClick={() => { setTopicForm({ ...EMPTY_TOPIC }); setScreen("topics"); }}>New Topic</button>
                <button className="button button--ghost" onClick={() => navigate("finder")}>Find Topic Ideas</button>
                <button className="button button--ghost" onClick={() => navigate("articles")}>View Library</button>
                <button className="button button--ghost" onClick={() => navigate("business")}>Business Knowledge</button>
              </div>
            </div>
          </section>
          <ContentIntelligenceDashboard
            analytics={analytics}
            onOpenArticle={openArticle}
            onNavigate={navigate}
          />
        </>
      ) : null}

      {screen === "topics" ? (
        <section className="panel">
          <div className="panel__header">
            <div><h3>Topic Planner</h3><p>The V1 Topic Library with priorities, coverage planning and safe draft generation.</p></div>
            <div className="card-actions">
              <button className="button button--primary" onClick={() => setTopicForm({ ...EMPTY_TOPIC })}>New Topic</button>
              <button className="button button--ghost" disabled={!selectedTopicIds.length || busy} onClick={beginBatchGeneration}>Batch Generate</button>
            </div>
          </div>
          {topicForm ? (
            <>
              <div className="field-grid">
                <Field label="Title"><input className="field__input" value={topicForm.title} onChange={(event) => setTopicForm({ ...topicForm, title: event.target.value })} /></Field>
                <Field label="Category"><select className="field__input" value={topicForm.category} onChange={(event) => setTopicForm({ ...topicForm, category: event.target.value })}>{KNOWLEDGE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Primary keyword"><input className="field__input" value={topicForm.primary_keyword || ""} onChange={(event) => setTopicForm({ ...topicForm, primary_keyword: event.target.value })} /></Field>
                <Field label="Secondary keywords"><input className="field__input" value={(topicForm.secondary_keywords || []).join(", ")} onChange={(event) => setTopicForm({ ...topicForm, secondary_keywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></Field>
                <Field label="Customer/search intent"><input className="field__input" value={topicForm.intent || ""} onChange={(event) => setTopicForm({ ...topicForm, intent: event.target.value })} /></Field>
                <Field label="Status"><select className="field__input" value={topicForm.status} onChange={(event) => setTopicForm({ ...topicForm, status: event.target.value })}>{KNOWLEDGE_TOPIC_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Priority"><PriorityStars value={topicForm.priority || 3} onChange={(priority) => setTopicForm({ ...topicForm, priority })} /></Field>
                <Field label="Notes" wide><textarea className="field__input" rows={5} value={topicForm.notes || ""} onChange={(event) => setTopicForm({ ...topicForm, notes: event.target.value })} /></Field>
              </div>
              <div className="card-actions">
                <button className="button button--primary" disabled={busy || !topicForm.title.trim()} onClick={handleSaveTopic}>{busy ? "Saving..." : "Save Topic"}</button>
                <button className="button button--ghost" onClick={() => setTopicForm(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <Filters search={search} setSearch={setSearch} category={categoryFilter} setCategory={setCategoryFilter} status={statusFilter} setStatus={setStatusFilter} type={typeFilter} setType={setTypeFilter} priority={priorityFilter} setPriority={setPriorityFilter} />
              <div className="knowledge-table-wrap">
                <table className="knowledge-table">
                  <thead><tr><th>Select</th><th>Topic</th><th>Priority</th><th>Category</th><th>Keyword / intent</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredTopics.map((topic) => (
                      <tr key={topic.id}>
                        <td><input type="checkbox" checked={selectedTopicIds.includes(topic.id)} onChange={(event) => setSelectedTopicIds((current) => event.target.checked ? [...new Set([...current, topic.id])] : current.filter((id) => id !== topic.id))} /></td>
                        <td><strong>{topic.title}</strong><small>{topic.source === "ai_topic_finder" ? "AI Topic Finder" : "Manual"}</small></td>
                        <td><PriorityStars value={topic.priority || 3} readOnly /></td>
                        <td>{topic.category}</td>
                        <td>{topic.primary_keyword || "-"}<small>{topic.intent || ""}</small></td>
                        <td><StatusPill value={topic.status} /></td>
                        <td><div className="card-actions"><button className="button button--primary" onClick={() => beginGeneration(topic)}>Generate</button><button className="button button--ghost" onClick={() => setTopicForm({ ...topic })}>Edit</button><button className="button button--danger" onClick={() => handleDeleteTopic(topic)}>Delete</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}

      {screen === "finder" ? (
        <TopicFinderPanel
          categories={finderCategories}
          setCategories={setFinderCategories}
          quantity={finderQuantity}
          setQuantity={setFinderQuantity}
          brief={finderBrief}
          setBrief={setFinderBrief}
          ideas={finderIdeas}
          selectedIndexes={finderSelectedIndexes}
          toggleSelected={(index) =>
            setFinderSelectedIndexes((current) =>
              current.includes(index)
                ? current.filter((item) => item !== index)
                : [...current, index]
            )
          }
          updateIdea={updateFinderIdea}
          onFind={handleFindTopics}
          onSave={handleSaveTopicIdeas}
          busy={busy}
          duplicateCount={finderDuplicateCount}
        />
      ) : null}

      {screen === "batch" ? (
        <>
          <PromptBuilderNotice
            sections={businessSections}
            specialist={templates.find((template) => template.key === generation.templateKey)}
          />
          <BatchGenerationPanel
            topics={topics.filter((topic) => selectedTopicIds.includes(topic.id)).slice(0, 10)}
            generation={generation}
            setGeneration={setGeneration}
            templates={templates}
            progress={batchProgress}
            busy={busy}
            onRun={handleBatchGeneration}
          />
        </>
      ) : null}

      {screen === "generate" && generationTopic ? (
        <section className="panel knowledge-form-panel">
          <div className="panel__header"><div><div className="eyebrow">Generate Article</div><h3>{generationTopic.title}</h3><p>{generationTopic.intent || generationTopic.primary_keyword}</p></div></div>
          <div className="field-grid">
            <Field label="Article type / template"><select className="field__input" value={generation.templateKey} onChange={(event) => setGeneration({ ...generation, templateKey: event.target.value })}>{templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}</select></Field>
            <Field label="Approximate length"><select className="field__input" value={generation.approximateLength} onChange={(event) => setGeneration({ ...generation, approximateLength: Number(event.target.value) })}>{[600, 1000, 1500, 2000].map((length) => <option key={length} value={length}>About {length.toLocaleString()} words</option>)}</select></Field>
            <Field label="Target audience"><input className="field__input" value={generation.targetAudience} onChange={(event) => setGeneration({ ...generation, targetAudience: event.target.value })} /></Field>
            <Field label="Tone"><input className="field__input" value={generation.tone} onChange={(event) => setGeneration({ ...generation, tone: event.target.value })} /></Field>
            <Field label="Optional instructions" wide><textarea className="field__input" rows={6} value={generation.instructions} onChange={(event) => setGeneration({ ...generation, instructions: event.target.value })} /></Field>
          </div>
          <PromptBuilderNotice
            sections={businessSections}
            specialist={templates.find((template) => template.key === generation.templateKey)}
          />
          <div className="notice">Generated content always starts as a draft and must be reviewed before approval.</div>
          <div className="card-actions"><button className="button button--primary" disabled={busy} onClick={handleGenerateArticle}>{busy ? "Generating..." : "Generate Draft"}</button><button className="button button--ghost" onClick={() => navigate("topics")}>Cancel</button></div>
        </section>
      ) : null}

      {screen === "articles" ? (
        <section className="panel">
          <div className="panel__header">
            <div><h3>Article Library</h3><p>Search, edit, approve and archive generated knowledge.</p></div>
            <div className="card-actions"><button className="button button--primary" disabled={!selectedArticleIds.length || busy} onClick={() => handleBulkUpdate("approved")}>Approve Selected</button><button className="button button--ghost" disabled={!selectedArticleIds.length || busy} onClick={() => handleBulkUpdate("archived")}>Archive Selected</button></div>
          </div>
          <Filters search={search} setSearch={setSearch} category={categoryFilter} setCategory={setCategoryFilter} status={statusFilter} setStatus={setStatusFilter} type={typeFilter} setType={setTypeFilter} articleMode />
          <div className="knowledge-table-wrap">
            <table className="knowledge-table">
              <thead><tr><th>Select</th><th>Article</th><th>Category / type</th><th>Quality</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {filteredArticles.map((item) => (
                  <tr key={item.id}>
                    <td><input type="checkbox" checked={selectedArticleIds.includes(item.id)} onChange={(event) => setSelectedArticleIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td>
                    <td><button className="knowledge-title-button" onClick={() => openArticle(item)}>{item.title}</button><small>{item.knowledge_topics?.title || ""}</small></td>
                    <td>{item.category}<small>{item.article_type}</small></td>
                    <td>
                      {latestReviewByArticle.has(item.id)
                        ? `${latestReviewByArticle.get(item.id).overall_score}/100`
                        : "Not reviewed"}
                    </td>
                    <td><StatusPill value={item.status} /></td>
                    <td>{formatDate(item.updated_at || item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {screen === "editor" && article ? (
        <>
          <section className="panel">
            <div className="panel__header">
              <div><div className="eyebrow">Article Editor</div><h3>{article.title}</h3><p>{dirty.current ? "Unsaved changes" : "All changes saved"}</p></div>
              <div className="card-actions"><button className="button button--ghost" onClick={() => setPreview((current) => !current)}>{preview ? "Edit" : "Preview"}</button><button className="button button--primary" disabled={busy} onClick={() => handleSaveArticle("draft")}>Save Draft</button><button className="button button--success" disabled={busy} onClick={() => handleSaveArticle("approved")}>Approve</button><button className="button button--danger" disabled={busy} onClick={() => handleSaveArticle("archived")}>Archive</button></div>
            </div>
          </section>
          {preview ? (
            <article className="panel knowledge-preview">
              <h1>{article.title}</h1>
              <p className="knowledge-preview__excerpt">{article.excerpt}</p>
              <div dangerouslySetInnerHTML={{ __html: markdownToKnowledgeHtml(article.content_markdown) }} />
              {(article.faq_json || []).length ? <><h2>Frequently asked questions</h2>{article.faq_json.map((entry, index) => <div key={`${entry.question}-${index}`}><h3>{entry.question}</h3><p>{entry.answer}</p></div>)}</> : null}
              <div className="knowledge-preview__cta">{article.cta}</div>
            </article>
          ) : (
            <section className="knowledge-editor-grid">
              <div className="panel">
                <div className="field-grid knowledge-editor-fields">
                  <Field label="Title" error={editorErrors.title} wide><input className="field__input" value={article.title} onChange={(event) => updateArticle("title", event.target.value)} /></Field>
                  <Field label="Slug" error={editorErrors.slug} wide><input className="field__input" value={article.slug} onChange={(event) => updateArticle("slug", event.target.value)} /></Field>
                  <Field label="SEO title" error={editorErrors.seo_title} wide><input className="field__input" value={article.seo_title || ""} onChange={(event) => updateArticle("seo_title", event.target.value)} /></Field>
                  <Field label="Meta description" error={editorErrors.meta_description} wide><textarea className="field__input" rows={4} value={article.meta_description || ""} onChange={(event) => updateArticle("meta_description", event.target.value)} /></Field>
                  <Field label="Excerpt" wide><textarea className="field__input" rows={4} value={article.excerpt || ""} onChange={(event) => updateArticle("excerpt", event.target.value)} /></Field>
                  <Field label="Category"><select className="field__input" value={article.category || ""} onChange={(event) => updateArticle("category", event.target.value)}>{KNOWLEDGE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Status"><select className="field__input" value={article.status} onChange={(event) => updateArticle("status", event.target.value)}>{KNOWLEDGE_ARTICLE_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></Field>
                </div>
              </div>
              <div className="panel">
                <Field label="Article body (Markdown)" error={editorErrors.content_markdown}><textarea className="field__input knowledge-markdown-editor" value={article.content_markdown || ""} onChange={(event) => updateArticle("content_markdown", event.target.value)} /></Field>
                <Field label="CTA"><textarea className="field__input" rows={4} value={article.cta || ""} onChange={(event) => updateArticle("cta", event.target.value)} /></Field>
                <Field label="FAQ entries (JSON)" error={editorErrors.faq_json}><textarea className="field__input knowledge-faq-editor" value={faqDraft} onChange={(event) => { const nextValue = event.target.value; setFaqDraft(nextValue); dirty.current = true; try { updateArticle("faq_json", JSON.parse(nextValue)); setEditorErrors((current) => ({ ...current, faq_json: "" })); } catch { setEditorErrors((current) => ({ ...current, faq_json: "FAQ JSON is invalid." })); } }} /></Field>
              </div>
              <div className="panel knowledge-quality-panel">
                <div className="panel__header"><div><h3>Quality checklist</h3><p>Transparent checks only — not a guaranteed SEO or AI-visibility score.</p></div></div>
                <div className="knowledge-quality-grid">{calculateKnowledgeQualityChecks(article, article.generation_metadata?.approximate_length).map((check) => <div key={check.key} className={check.pass ? "knowledge-check is-pass" : "knowledge-check is-warning"}>{check.pass ? "✓" : "⚠"} {check.label}</div>)}</div>
              </div>
            </section>
          )}
          <ArticleQualityScore
            review={latestReviewByArticle.get(article.id)}
            onReview={handleReviewArticle}
            busy={busy}
            canReview={article.status === "draft" && !dirty.current}
            blockedReason={
              article.status !== "draft"
                ? "AI Reviewer is available for saved drafts. The approval workflow remains manual."
                : dirty.current
                  ? "Save the current draft before reviewing so the score matches the editor."
                  : ""
            }
          />
        </>
      ) : null}

      {screen === "business" ? (
        <BusinessKnowledgeCentre
          sections={businessSections}
          updateSection={updateBusinessSection}
          onSave={handleSaveBusinessSection}
          busy={busy}
        />
      ) : null}

      {screen === "settings" ? (
        <BusinessSettingsPanel
          settings={settings}
          setSettings={setSettings}
          templates={templates}
          updateTemplate={updateTemplate}
          onSaveSettings={handleSaveSettings}
          onSaveTemplate={handleSaveTemplate}
          busy={busy}
        />
      ) : null}
    </div>
  );
}
