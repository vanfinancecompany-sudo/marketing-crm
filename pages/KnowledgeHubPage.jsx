import { useEffect, useMemo, useRef, useState } from "react";
import {
  KNOWLEDGE_ARTICLE_STATUSES,
  KNOWLEDGE_ARTICLE_TYPES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_TOPIC_STATUSES,
  calculateKnowledgeQualityChecks,
  findKnowledgeTopicDuplicates,
  markdownToKnowledgeHtml,
  slugifyKnowledgeArticle,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";
import {
  bulkUpdateKnowledgeArticles,
  deleteKnowledgeTopic,
  generateKnowledgeArticle,
  loadKnowledgeHub,
  requestKnowledgeHub,
  saveKnowledgeArticle,
  saveKnowledgeTopic,
} from "../services/knowledgeHub.js";
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
      ) : null}
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
  const [selectedArticleIds, setSelectedArticleIds] = useState([]);
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
      setSettings({ ...EMPTY_SETTINGS, ...(result.settings || {}) });
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
        `${topic.title} ${topic.primary_keyword || ""}`.toLowerCase().includes(term)
    );
  }, [topics, search, categoryFilter, statusFilter]);

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
      setMessage("Knowledge Hub settings saved.");
    } catch (saveError) {
      setError(saveError.message || "Knowledge Hub settings could not be saved.");
    } finally {
      setBusy(false);
    }
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
            <div className="eyebrow">AI Knowledge Engine V1</div>
            <h2>Knowledge Hub</h2>
            <p>Create, review and approve useful customer knowledge articles. Nothing publishes automatically.</p>
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
          ["topics", "Topic Library"],
          ["articles", "Article Library"],
          ["settings", "Settings"],
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
                <button className="button button--ghost" onClick={() => navigate("topics")}>Generate Article</button>
                <button className="button button--ghost" onClick={() => navigate("articles")}>View Library</button>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {screen === "topics" ? (
        <section className="panel">
          <div className="panel__header">
            <div><h3>Topic Library</h3><p>Create real customer questions and useful article intents.</p></div>
            <button className="button button--primary" onClick={() => setTopicForm({ ...EMPTY_TOPIC })}>New Topic</button>
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
                <Field label="Notes" wide><textarea className="field__input" rows={5} value={topicForm.notes || ""} onChange={(event) => setTopicForm({ ...topicForm, notes: event.target.value })} /></Field>
              </div>
              <div className="card-actions">
                <button className="button button--primary" disabled={busy || !topicForm.title.trim()} onClick={handleSaveTopic}>{busy ? "Saving..." : "Save Topic"}</button>
                <button className="button button--ghost" onClick={() => setTopicForm(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <Filters search={search} setSearch={setSearch} category={categoryFilter} setCategory={setCategoryFilter} status={statusFilter} setStatus={setStatusFilter} type={typeFilter} setType={setTypeFilter} />
              <div className="knowledge-table-wrap">
                <table className="knowledge-table">
                  <thead><tr><th>Topic</th><th>Category</th><th>Keyword / intent</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredTopics.map((topic) => (
                      <tr key={topic.id}>
                        <td><strong>{topic.title}</strong></td>
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
              <thead><tr><th>Select</th><th>Article</th><th>Category / type</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {filteredArticles.map((item) => (
                  <tr key={item.id}>
                    <td><input type="checkbox" checked={selectedArticleIds.includes(item.id)} onChange={(event) => setSelectedArticleIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td>
                    <td><button className="knowledge-title-button" onClick={() => openArticle(item)}>{item.title}</button><small>{item.knowledge_topics?.title || ""}</small></td>
                    <td>{item.category}<small>{item.article_type}</small></td>
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
        </>
      ) : null}

      {screen === "settings" ? (
        <section className="panel knowledge-form-panel">
          <div className="panel__header"><div><h3>Knowledge Hub Settings</h3><p>Defaults used by article generation. Existing marketing/customer settings are not changed.</p></div></div>
          <div className="field-grid">
            <Field label="Business name"><input className="field__input" value={settings.business_name || ""} onChange={(event) => setSettings({ ...settings, business_name: event.target.value })} /></Field>
            <Field label="Website URL"><input className="field__input" value={settings.website_url || ""} onChange={(event) => setSettings({ ...settings, website_url: event.target.value })} /></Field>
            <Field label="Default tone"><input className="field__input" value={settings.default_tone || ""} onChange={(event) => setSettings({ ...settings, default_tone: event.target.value })} /></Field>
            <Field label="Default audience"><input className="field__input" value={settings.default_audience || ""} onChange={(event) => setSettings({ ...settings, default_audience: event.target.value })} /></Field>
            <Field label="Default CTA" wide><textarea className="field__input" rows={4} value={settings.default_cta || ""} onChange={(event) => setSettings({ ...settings, default_cta: event.target.value })} /></Field>
          </div>
          <div className="card-actions"><button className="button button--primary" disabled={busy} onClick={handleSaveSettings}>{busy ? "Saving..." : "Save Settings"}</button></div>
        </section>
      ) : null}
    </div>
  );
}
