import { useEffect, useMemo, useState } from "react";
import {
  VISIBILITY_PROVIDERS,
  buildVisibilitySummary,
  filterVisibilityArticles,
  isConfirmedPublishedArticle,
} from "../lib/aiVisibility.js";
import {
  deriveArticleVisibilityPrompts,
  loadAiVisibility,
  recordManualVisibilityResult,
  runArticleVisibilityCheck,
  saveAiVisibilitySettings,
  saveArticleVisibilityPrompt,
  saveVisibilityPublication,
} from "../services/aiVisibility.js";
import {
  getStoredMarketingAccessKey,
  saveMarketingAccessKey,
  validateMarketingAccessKey,
} from "../services/marketingAccess.js";

const PROVIDER_LABELS = Object.fromEntries(
  VISIBILITY_PROVIDERS.map((provider) => [provider.key, provider.label]),
);
const STATUS_LABELS = {
  visible: "Visible",
  not_checked: "Not checked",
  checking: "Checking",
  indexed: "Indexed",
  not_indexed: "Not indexed",
  performance_found: "Performance data found",
  detected: "Detected",
  mentioned: "Mentioned",
  cited: "Cited",
  not_detected: "Not detected",
  error: "Error",
};
const AI_RESULT_OPTIONS = ["detected", "mentioned", "cited", "not_detected"];
const GOOGLE_RESULT_OPTIONS = ["indexed", "not_indexed"];
const ARTICLE_PAGE_SIZES = [10, 25, 50, 100];
const nowInput = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const dateOnly = () => new Date().toISOString().slice(0, 10);
const displayDate = (value) =>
  value ? new Date(value).toLocaleString("en-GB") : "—";
const tone = (status) =>
  [
    "visible",
    "detected",
    "mentioned",
    "cited",
    "indexed",
    "connected",
  ].includes(status)
    ? "is-positive"
    : ["error", "not_indexed"].includes(status)
      ? "is-negative"
      : "is-neutral";

function filtersForMetric(metric, current) {
  const next = { ...current, provider: "all", status: "all" };
  if (metric === "awaiting_first_check") next.status = "not_checked";
  else if (metric === "needs_attention") next.status = "needs_attention";
  else if (metric === "ai_visible" || metric === "total_verified_detections") {
    next.status = "visible";
    next.sort = "most_visible";
  } else if (metric === "google_indexed") {
    next.provider = "google_search_console";
    next.status = "indexed";
  } else if (metric === "visibility_rate") {
    next.status = "checked";
  } else if (metric === "last_checked") {
    next.sort = "oldest_check";
  } else {
    const providerMetric = {
      chatgpt_detections: "chatgpt",
      gemini_detections: "gemini",
      perplexity_detections: "perplexity",
      google_ai_overview_detections: "google_ai_overviews",
    }[metric];
    if (providerMetric) {
      next.provider = providerMetric;
      next.status = "visible";
      next.sort = "recently_detected";
    }
  }
  return next;
}

function SummaryCards({ summary, onFilter }) {
  const cards = [
    ["published_pages", "Published pages"],
    ["google_indexed", "Google indexed"],
    ["ai_visible", "AI visible"],
    ["total_verified_detections", "Verified detections"],
    ["awaiting_first_check", "Awaiting first check"],
    ["needs_attention", "Needs attention"],
    ["visibility_rate", "Visibility rate"],
  ];
  return (
    <section className="stats-grid">
      {cards.map(([key, label]) => (
        <button
          className="stat-card ai-visibility-summary-card"
          type="button"
          key={key}
          onClick={() => onFilter(key)}
        >
          <span className="stat-card__label">{label}</span>
          <strong className="stat-card__value">
            {key === "visibility_rate" ? `${summary[key]}%` : summary[key]}
          </strong>
          {key === "visibility_rate" ? (
            <small>
              {summary.visibility_rate_denominator} eligible checked
            </small>
          ) : null}
        </button>
      ))}
    </section>
  );
}

function ProviderConnections({ providers }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h3>Provider connections</h3>
          <p>An unavailable adapter never reports a successful check.</p>
        </div>
      </div>
      <div className="card-grid">
        {providers.map((provider) => (
          <article
            className="panel panel--nested"
            style={{ boxShadow: "none" }}
            key={provider.provider}
          >
            <div className="panel__header">
              <div>
                <strong>{provider.label}</strong>
                <p>{provider.configuration_summary}</p>
              </div>
              <span
                className={`visibility-status ${tone(provider.connection_status)}`}
              >
                {provider.connection_status.replaceAll("_", " ")}
              </span>
            </div>
            <small>
              Last successful check:{" "}
              {displayDate(provider.last_successful_check_at)}
            </small>
            {provider.last_error ? (
              <div className="notice notice--error" style={{ marginTop: 8 }}>
                {provider.last_error}
                <br />
                <small>{displayDate(provider.last_error_at)}</small>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function PublicationForm({ articles, onSave, busy }) {
  const eligible = articles.filter((article) =>
    ["approved", "exported"].includes(article.status),
  );
  const [articleId, setArticleId] = useState(eligible[0]?.id || "");
  const article = eligible.find((item) => item.id === articleId);
  const [form, setForm] = useState({
    live_wix_url: "",
    published_at: dateOnly(),
    wix_item_id: "",
    wix_collection_id: "",
    last_wix_sync_at: "",
    notes: "",
  });
  useEffect(() => {
    if (!article) return;
    setForm({
      live_wix_url: article.live_wix_url || "",
      published_at: article.published_at?.slice(0, 10) || dateOnly(),
      wix_item_id: article.wix_item_id || "",
      wix_collection_id: article.wix_collection_id || "",
      last_wix_sync_at: article.last_wix_sync_at?.slice(0, 16) || "",
      notes: article.publication_verification_notes || "",
    });
  }, [articleId]);
  return (
    <details className="operations-drawer">
      <summary>CONFIRM OR UPDATE A WIX PUBLICATION</summary>
      <div className="operations-drawer__body">
        <div className="notice">
          This records a manually verified live page. It does not publish or
          modify Wix.
        </div>
        <div className="field-grid">
          <label className="field">
            <span className="field__label">Approved article</span>
            <select
              className="field__input"
              value={articleId}
              onChange={(event) => setArticleId(event.target.value)}
            >
              <option value="">Select article</option>
              {eligible.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Live Wix URL</span>
            <input
              className="field__input"
              value={form.live_wix_url}
              onChange={(event) =>
                setForm({ ...form, live_wix_url: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span className="field__label">Published date</span>
            <input
              className="field__input"
              type="date"
              value={form.published_at}
              onChange={(event) =>
                setForm({ ...form, published_at: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span className="field__label">Wix item ID</span>
            <input
              className="field__input"
              value={form.wix_item_id}
              onChange={(event) =>
                setForm({ ...form, wix_item_id: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span className="field__label">Wix collection ID</span>
            <input
              className="field__input"
              value={form.wix_collection_id}
              onChange={(event) =>
                setForm({ ...form, wix_collection_id: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span className="field__label">Last Wix sync</span>
            <input
              className="field__input"
              type="datetime-local"
              value={form.last_wix_sync_at}
              onChange={(event) =>
                setForm({ ...form, last_wix_sync_at: event.target.value })
              }
            />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Verification notes</span>
            <textarea
              className="field__input"
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
            />
          </label>
        </div>
        <button
          className="button button--primary"
          type="button"
          disabled={
            busy || !articleId || !form.live_wix_url || !form.published_at
          }
          onClick={() =>
            onSave(articleId, {
              ...form,
              last_wix_sync_at: form.last_wix_sync_at
                ? new Date(form.last_wix_sync_at).toISOString()
                : "",
            })
          }
        >
          Confirm Published Page
        </button>
      </div>
    </details>
  );
}

function PromptManager({ item, onDerive, onSave, onRun, busy }) {
  const [draft, setDraft] = useState("");
  const [provider, setProvider] = useState("chatgpt");
  const activePrompts = item.prompts.filter((prompt) => prompt.active);
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h3>Monitoring prompts</h3>
          <p>Review, edit or disable prompts before using a provider check.</p>
        </div>
        <button
          className="button button--ghost"
          type="button"
          disabled={busy}
          onClick={() => onDerive(item.article.id)}
        >
          Derive Relevant Prompts
        </button>
      </div>
      <div className="field-grid">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span className="field__label">Add prompt</span>
          <input
            className="field__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
      </div>
      <button
        className="button button--primary"
        type="button"
        disabled={busy || draft.trim().length < 5}
        onClick={async () => {
          if (
            await onSave({
              article_id: item.article.id,
              prompt_text: draft,
              active: true,
            })
          )
            setDraft("");
        }}
      >
        Add Prompt
      </button>
      <div className="knowledge-business-grid" style={{ marginTop: 14 }}>
        {item.prompts.map((prompt) => (
          <EditablePrompt
            prompt={prompt}
            busy={busy}
            onSave={onSave}
            key={prompt.id}
          />
        ))}
        {!item.prompts.length ? (
          <div className="notice">
            No monitoring prompts have been prepared.
          </div>
        ) : null}
      </div>
      <div className="field-grid" style={{ marginTop: 14 }}>
        <label className="field">
          <span className="field__label">Provider to check</span>
          <select
            className="field__input"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
          >
            {VISIBILITY_PROVIDERS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        {provider === "google_search_console" ? (
          <div className="field">
            <span className="field__label">Page check</span>
            <button
              className="button button--primary"
              disabled={busy}
              type="button"
              onClick={() => onRun(item.article.id, provider, null)}
            >
              Run Check
            </button>
          </div>
        ) : (
          <label className="field">
            <span className="field__label">Run against prompt</span>
            <select
              className="field__input"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value)
                  onRun(item.article.id, provider, event.target.value);
                event.target.value = "";
              }}
            >
              <option value="">Select prompt and run</option>
              {activePrompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.prompt_text}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <small>
        Unavailable adapters record an error and never create visibility
        evidence.
      </small>
    </section>
  );
}

function EditablePrompt({ prompt, busy, onSave }) {
  const [text, setText] = useState(prompt.prompt_text);
  useEffect(() => setText(prompt.prompt_text), [prompt.id, prompt.prompt_text]);
  return (
    <div className="notice">
      <textarea
        className="field__input"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <small>
        {prompt.prompt_source.replaceAll("_", " ")} ·{" "}
        {prompt.active ? "Active" : "Disabled"}
      </small>
      <div className="card-actions">
        <button
          className="button button--ghost"
          type="button"
          disabled={
            busy ||
            text.trim() === prompt.prompt_text.trim() ||
            text.trim().length < 5
          }
          onClick={() => onSave({ ...prompt, prompt_text: text })}
        >
          Save Edit
        </button>
        <button
          className="button button--ghost"
          type="button"
          disabled={busy}
          onClick={() =>
            onSave({ ...prompt, prompt_text: text, active: !prompt.active })
          }
        >
          {prompt.active ? "Disable" : "Enable"}
        </button>
      </div>
    </div>
  );
}

function ManualResultForm({ item, onSave, busy }) {
  const [form, setForm] = useState({
    provider: "chatgpt",
    prompt_id: "",
    result_status: "not_detected",
    evidence_excerpt: "",
    source_url: "",
    checked_at: nowInput(),
    confidence: "",
    notes: "",
  });
  const statuses =
    form.provider === "google_search_console"
      ? GOOGLE_RESULT_OPTIONS
      : AI_RESULT_OPTIONS;
  const evidenceRequired = ["detected", "mentioned", "cited"].includes(
    form.result_status,
  );
  const sourceRequired = form.result_status === "cited";
  useEffect(() => {
    if (!statuses.includes(form.result_status))
      setForm((current) => ({
        ...current,
        result_status: statuses[0],
        prompt_id: "",
      }));
  }, [form.provider]);
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h3>Record verified result</h3>
          <p>
            Manual evidence remains labelled “Manually verified” in history.
          </p>
        </div>
      </div>
      <div className="field-grid">
        <label className="field">
          <span className="field__label">Provider</span>
          <select
            className="field__input"
            value={form.provider}
            onChange={(event) =>
              setForm({ ...form, provider: event.target.value })
            }
          >
            {VISIBILITY_PROVIDERS.map((provider) => (
              <option value={provider.key} key={provider.key}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        {form.provider !== "google_search_console" ? (
          <label className="field">
            <span className="field__label">Prompt</span>
            <select
              className="field__input"
              value={form.prompt_id}
              onChange={(event) =>
                setForm({ ...form, prompt_id: event.target.value })
              }
            >
              <option value="">Select prompt</option>
              {item.prompts
                .filter((prompt) => prompt.active)
                .map((prompt) => (
                  <option value={prompt.id} key={prompt.id}>
                    {prompt.prompt_text}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span className="field__label">Result status</span>
          <select
            className="field__input"
            value={form.result_status}
            onChange={(event) =>
              setForm({ ...form, result_status: event.target.value })
            }
          >
            {statuses.map((status) => (
              <option value={status} key={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Checked at</span>
          <input
            className="field__input"
            type="datetime-local"
            value={form.checked_at}
            onChange={(event) =>
              setForm({ ...form, checked_at: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span className="field__label">Source URL (where available)</span>
          <input
            className="field__input"
            value={form.source_url}
            onChange={(event) =>
              setForm({ ...form, source_url: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span className="field__label">Confidence (0–100)</span>
          <input
            className="field__input"
            type="number"
            min="0"
            max="100"
            value={form.confidence}
            onChange={(event) =>
              setForm({ ...form, confidence: event.target.value })
            }
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span className="field__label">Evidence</span>
          <textarea
            className="field__input"
            rows={4}
            value={form.evidence_excerpt}
            onChange={(event) =>
              setForm({ ...form, evidence_excerpt: event.target.value })
            }
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span className="field__label">Notes</span>
          <textarea
            className="field__input"
            rows={3}
            value={form.notes}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
          />
        </label>
      </div>
      <button
        className="button button--primary"
        type="button"
        disabled={
          busy ||
          (form.provider !== "google_search_console" && !form.prompt_id) ||
          (evidenceRequired && !form.evidence_excerpt.trim()) ||
          (sourceRequired && !form.source_url.trim())
        }
        onClick={() =>
          onSave({
            ...form,
            checked_at: new Date(form.checked_at).toISOString(),
            article_id: item.article.id,
          })
        }
      >
        Save Manually Verified Result
      </button>
    </section>
  );
}

function ArticleDetail({
  item,
  onClose,
  onDerive,
  onSavePrompt,
  onRun,
  onManual,
  busy,
}) {
  const promptsById = new Map(
    item.prompts.map((prompt) => [prompt.id, prompt]),
  );
  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Article visibility evidence</div>
            <h2>{item.article.title}</h2>
            <p>{item.article.live_wix_url}</p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
          >
            Back to Results
          </button>
        </div>
      </section>
      <section className="stats-grid">
        {[
          ["Publication", displayDate(item.article.published_at)],
          ["Google", STATUS_LABELS[item.google_indexing_status]],
          ["AI visibility", STATUS_LABELS[item.visibility_status]],
          ["Platforms checked", item.platforms_checked.length],
          ["First detected", displayDate(item.first_detected_at)],
          ["Last detected", displayDate(item.last_detected_at)],
          ["Total detections", item.total_detections],
          ["Last checked", displayDate(item.last_checked_at)],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span className="stat-card__label">{label}</span>
            <strong className="stat-card__value" style={{ fontSize: 20 }}>
              {value}
            </strong>
          </div>
        ))}
      </section>
      <div className="notice">
        <strong>Recommended action:</strong> {item.recommended_action}
      </div>
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Current provider results</h3>
            <p>
              Latest non-superseded evidence for each monitored platform and
              prompt.
            </p>
          </div>
        </div>
        <div className="card-grid">
          {VISIBILITY_PROVIDERS.map((provider) => {
            const latest = item.latest_results
              .filter((result) => result.provider === provider.key)
              .sort(
                (a, b) => new Date(b.checked_at) - new Date(a.checked_at),
              )[0];
            return (
              <article
                className="panel panel--nested"
                style={{ boxShadow: "none" }}
                key={provider.key}
              >
                <div className="panel__header">
                  <strong>{provider.label}</strong>
                  <span
                    className={`visibility-status ${tone(latest?.result_status || "not_checked")}`}
                  >
                    {STATUS_LABELS[latest?.result_status || "not_checked"]}
                  </span>
                </div>
                <small>Last checked: {displayDate(latest?.checked_at)}</small>
                {latest?.evidence_excerpt ? (
                  <p>{latest.evidence_excerpt}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
      <PromptManager
        item={item}
        onDerive={onDerive}
        onSave={onSavePrompt}
        onRun={onRun}
        busy={busy}
      />
      <ManualResultForm item={item} onSave={onManual} busy={busy} />
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Visibility history</h3>
            <p>
              Historical evidence is retained and never silently overwritten.
            </p>
          </div>
        </div>
        <div className="knowledge-table-wrap">
          <table className="knowledge-table">
            <thead>
              <tr>
                <th>Checked</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Prompt</th>
                <th>Evidence</th>
                <th>Confidence</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {item.results.map((result) => (
                <tr key={result.id}>
                  <td>{displayDate(result.checked_at)}</td>
                  <td>{PROVIDER_LABELS[result.provider]}</td>
                  <td>
                    <span
                      className={`visibility-status ${tone(result.result_status)}`}
                    >
                      {STATUS_LABELS[result.result_status]}
                    </span>
                  </td>
                  <td>
                    {promptsById.get(result.prompt_id)?.prompt_text ||
                      "Page-level check"}
                  </td>
                  <td>
                    {result.evidence_excerpt ||
                      result.error_details ||
                      "No evidence supplied"}
                    {result.source_url ? (
                      <>
                        <br />
                        <a
                          href={result.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source
                        </a>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {result.confidence == null ? "—" : `${result.confidence}%`}
                  </td>
                  <td>
                    {result.manually_verified
                      ? "Manually verified"
                      : "Provider adapter"}
                  </td>
                </tr>
              ))}
              {!item.results.length ? (
                <tr>
                  <td colSpan="7">No monitoring result has been recorded.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function AIVisibilityPage() {
  const [locked, setLocked] = useState(!getStoredMarketingAccessKey());
  const [accessKey, setAccessKey] = useState("");
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    provider: "all",
    status: "all",
    from: "",
    to: "",
    sort: "needs_attention",
  });
  const [attentionDays, setAttentionDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [articlePage, setArticlePage] = useState(1);
  const [articlePageSize, setArticlePageSize] = useState(25);
  const [articlesOpen, setArticlesOpen] = useState(() => {
    try {
      return sessionStorage.getItem("aiVisibilityArticlesOpen") === "true";
    } catch {
      return false;
    }
  });

  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await loadAiVisibility();
      setData(result);
      setAttentionDays(result.settings?.attention_days || 30);
      setLocked(false);
    } catch (caught) {
      if (caught?.status === 401) setLocked(true);
      else
        setError(caught.message || "AI Visibility Centre could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (locked) return;
    const metric = (() => {
      try {
        const value = sessionStorage.getItem("aiVisibilityMetric");
        sessionStorage.removeItem("aiVisibilityMetric");
        return value;
      } catch {
        return "";
      }
    })();
    if (metric) setFilters((current) => filtersForMetric(metric, current));
    load();
  }, []);

  async function unlock(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await validateMarketingAccessKey(accessKey);
      saveMarketingAccessKey(accessKey);
      setLocked(false);
      await load();
    } catch (caught) {
      setError(caught.message || "Access key not recognised.");
    } finally {
      setBusy(false);
    }
  }
  async function act(action, success) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await load();
      setMessage(success);
      return true;
    } catch (caught) {
      setError(caught.message || "AI Visibility update failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const summary = useMemo(
    () =>
      data
        ? buildVisibilitySummary({
            articles: data.articles,
            results: data.results,
            prompts: data.prompts,
            attentionDays,
          })
        : null,
    [data, attentionDays],
  );
  const rows = useMemo(
    () => (summary ? filterVisibilityArticles(summary.articles, filters) : []),
    [summary, filters],
  );
  const articlePageCount = Math.max(
    1,
    Math.ceil(rows.length / articlePageSize),
  );
  const safeArticlePage = Math.min(articlePage, articlePageCount);
  const pageStart = rows.length ? (safeArticlePage - 1) * articlePageSize : 0;
  const pageRows = rows.slice(pageStart, pageStart + articlePageSize);
  const pageEnd = Math.min(pageStart + articlePageSize, rows.length);
  const selected = summary?.articles.find(
    (item) => item.article.id === selectedId,
  );
  useEffect(
    () => setArticlePage(1),
    [
      filters.search,
      filters.provider,
      filters.status,
      filters.from,
      filters.to,
      filters.sort,
      articlePageSize,
    ],
  );
  useEffect(() => {
    if (articlePage > articlePageCount) setArticlePage(articlePageCount);
  }, [articlePage, articlePageCount]);
  const applyMetric = (metric) => {
    setFilters((current) => filtersForMetric(metric, current));
    setArticlePage(1);
    setArticlesOpen(true);
    try {
      sessionStorage.setItem("aiVisibilityArticlesOpen", "true");
    } catch {}
  };

  if (locked)
    return (
      <div className="page-stack">
        <section className="hero-panel">
          <div>
            <div className="eyebrow">AI Visibility</div>
            <h2>Unlock visibility evidence</h2>
            <p>Use the same access key as the Customer Database.</p>
          </div>
        </section>
        <section className="panel">
          <form className="field-grid" onSubmit={unlock}>
            <label className="field">
              <span className="field__label">Access key</span>
              <input
                className="field__input"
                type="password"
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
              />
            </label>
            <button className="button button--primary" disabled={busy}>
              Unlock
            </button>
          </form>
          {error ? <div className="notice notice--error">{error}</div> : null}
        </section>
      </div>
    );

  if (selected)
    return (
      <ArticleDetail
        item={selected}
        onClose={() => setSelectedId("")}
        onDerive={(articleId) =>
          act(
            () => deriveArticleVisibilityPrompts(articleId),
            "Relevant prompts prepared for review.",
          )
        }
        onSavePrompt={(prompt, silent = false) =>
          act(
            () => saveArticleVisibilityPrompt(prompt),
            silent ? "Prompt saved." : "Monitoring prompt saved.",
          )
        }
        onRun={(articleId, provider, promptId) =>
          act(
            () => runArticleVisibilityCheck(articleId, provider, promptId),
            "Provider response recorded. No visibility was claimed.",
          )
        }
        onManual={(result) =>
          act(
            () => recordManualVisibilityResult(result),
            "Manually verified visibility evidence saved.",
          )
        }
        busy={busy}
      />
    );

  return (
    <div className="page-stack knowledge-hub">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Evidence-based monitoring</div>
          <h2>AI Visibility Centre</h2>
          <p>
            Track verified indexing, mentions and citations without fabricating
            rankings or detections.
          </p>
        </div>
      </section>
      {error ? <div className="notice notice--error">{error}</div> : null}
      {message ? <div className="notice notice--success">{message}</div> : null}
      {!data ? (
        <div className="notice">Loading AI Visibility Centre...</div>
      ) : null}
      {summary ? (
        <SummaryCards summary={summary} onFilter={applyMetric} />
      ) : null}
      <div data-ai-visibility-live-anchor />
      {summary ? (
        <>
          <details
            className="panel"
            open={articlesOpen}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setArticlesOpen(open);
              try {
                sessionStorage.setItem(
                  "aiVisibilityArticlesOpen",
                  String(open),
                );
              } catch {}
            }}
            data-ai-visibility-article-results
          >
            <summary>
              <strong>Published article results</strong> ·{" "}
              {summary.published_pages} published pages ·{" "}
              {summary.checked_pages} checked
            </summary>
            <div className="operations-drawer__body">
              <div className="panel__header">
                <div>
                  <h3>Published article results</h3>
                  <p>
                    Visibility rate excludes unchecked articles and provider
                    errors.
                  </p>
                </div>
                <label className="field" style={{ minWidth: 150 }}>
                  <span className="field__label">Needs-attention period</span>
                  <select
                    className="field__input"
                    value={attentionDays}
                    onChange={(event) =>
                      setAttentionDays(Number(event.target.value))
                    }
                  >
                    {[7, 14, 30, 60, 90].map((days) => (
                      <option value={days} key={days}>
                        {days} days
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={
                    busy || attentionDays === data.settings.attention_days
                  }
                  onClick={() =>
                    act(
                      () => saveAiVisibilitySettings(attentionDays),
                      "Monitoring period saved.",
                    )
                  }
                >
                  Save Period
                </button>
              </div>
              <div className="field-grid">
                <label className="field">
                  <span className="field__label">Search</span>
                  <input
                    className="field__input"
                    value={filters.search}
                    onChange={(event) =>
                      setFilters({ ...filters, search: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Provider</span>
                  <select
                    className="field__input"
                    value={filters.provider}
                    onChange={(event) =>
                      setFilters({ ...filters, provider: event.target.value })
                    }
                  >
                    <option value="all">All providers</option>
                    {VISIBILITY_PROVIDERS.map((provider) => (
                      <option value={provider.key} key={provider.key}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Status</span>
                  <select
                    className="field__input"
                    value={filters.status}
                    onChange={(event) =>
                      setFilters({ ...filters, status: event.target.value })
                    }
                  >
                    <option value="all">All statuses</option>
                    <option value="visible">Visible</option>
                    <option value="indexed">Google indexed</option>
                    <option value="checked">Eligible checked</option>
                    <option value="never_detected">Never detected</option>
                    <option value="not_checked">Not checked</option>
                    <option value="needs_attention">Needs attention</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Published from</span>
                  <input
                    className="field__input"
                    type="date"
                    value={filters.from}
                    onChange={(event) =>
                      setFilters({ ...filters, from: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Published to</span>
                  <input
                    className="field__input"
                    type="date"
                    value={filters.to}
                    onChange={(event) =>
                      setFilters({ ...filters, to: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Sort</span>
                  <select
                    className="field__input"
                    value={filters.sort}
                    onChange={(event) =>
                      setFilters({ ...filters, sort: event.target.value })
                    }
                  >
                    <option value="most_visible">Most visible</option>
                    <option value="never_detected">Never detected</option>
                    <option value="recently_detected">Recently detected</option>
                    <option value="oldest_check">Oldest check</option>
                    <option value="newest_publication">
                      Newest publication
                    </option>
                    <option value="needs_attention">Needs attention</option>
                  </select>
                </label>
              </div>
              <div className="knowledge-table-wrap">
                <table className="knowledge-table">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th>Published</th>
                      <th>Google</th>
                      <th>Platforms checked</th>
                      <th>AI status</th>
                      <th>Detections</th>
                      <th>Last checked</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((item) => (
                      <tr key={item.article.id}>
                        <td>
                          <strong>{item.article.title}</strong>
                          <br />
                          <a
                            href={item.article.live_wix_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {item.article.live_wix_url}
                          </a>
                        </td>
                        <td>{displayDate(item.article.published_at)}</td>
                        <td>
                          <span
                            className={`visibility-status ${tone(item.google_indexing_status)}`}
                          >
                            {STATUS_LABELS[item.google_indexing_status]}
                          </span>
                        </td>
                        <td>
                          {item.platforms_checked
                            .map((provider) => PROVIDER_LABELS[provider])
                            .join(", ") || "None"}
                        </td>
                        <td>
                          <span
                            className={`visibility-status ${tone(item.visibility_status)}`}
                          >
                            {STATUS_LABELS[item.visibility_status]}
                          </span>
                        </td>
                        <td>{item.total_detections}</td>
                        <td>{displayDate(item.last_checked_at)}</td>
                        <td>
                          <button
                            className="button button--ghost"
                            type="button"
                            onClick={() => setSelectedId(item.article.id)}
                          >
                            View Evidence
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!rows.length ? (
                      <tr>
                        <td colSpan="8">
                          No published articles match these evidence filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div
                className="panel__header"
                style={{ marginTop: 14, alignItems: "end" }}
              >
                <div>
                  <strong>
                    Showing {rows.length ? pageStart + 1 : 0}–{pageEnd} of{" "}
                    {rows.length}
                  </strong>
                </div>
                <label className="field" style={{ minWidth: 120 }}>
                  <span className="field__label">Rows per page</span>
                  <select
                    className="field__input"
                    value={articlePageSize}
                    onChange={(event) =>
                      setArticlePageSize(Number(event.target.value))
                    }
                  >
                    {ARTICLE_PAGE_SIZES.map((size) => (
                      <option value={size} key={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="card-actions" aria-label="Article result pages">
                  <button
                    className="button button--ghost"
                    type="button"
                    aria-label="Previous article results page"
                    disabled={safeArticlePage <= 1}
                    onClick={() =>
                      setArticlePage((page) => Math.max(1, page - 1))
                    }
                  >
                    Previous
                  </button>
                  {Array.from(
                    { length: articlePageCount },
                    (_, index) => index + 1,
                  )
                    .filter(
                      (page) =>
                        articlePageCount <= 7 ||
                        page === 1 ||
                        page === articlePageCount ||
                        Math.abs(page - safeArticlePage) <= 1,
                    )
                    .map((page) => (
                      <button
                        className="button button--ghost"
                        type="button"
                        aria-label={`Article results page ${page}`}
                        aria-current={
                          page === safeArticlePage ? "page" : undefined
                        }
                        key={page}
                        onClick={() => setArticlePage(page)}
                      >
                        {page}
                      </button>
                    ))}
                  <button
                    className="button button--ghost"
                    type="button"
                    aria-label="Next article results page"
                    disabled={safeArticlePage >= articlePageCount}
                    onClick={() =>
                      setArticlePage((page) =>
                        Math.min(articlePageCount, page + 1),
                      )
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </details>
          <section className="knowledge-three-column">
            <div className="panel">
              <h3>Latest detections</h3>
              {summary.articles
                .filter((item) => item.last_detected_at)
                .sort(
                  (a, b) =>
                    new Date(b.last_detected_at) - new Date(a.last_detected_at),
                )
                .slice(0, 5)
                .map((item) => (
                  <button
                    className="visibility-quick-row"
                    type="button"
                    key={item.article.id}
                    onClick={() => setSelectedId(item.article.id)}
                  >
                    {item.article.title}
                    <small>{displayDate(item.last_detected_at)}</small>
                  </button>
                ))}
              {!summary.articles.some((item) => item.last_detected_at) ? (
                <div className="notice">No verified detections recorded.</div>
              ) : null}
            </div>
            <div className="panel">
              <h3>Not yet checked</h3>
              {summary.awaiting_first_check ? (
                <div className="notice">
                  {summary.awaiting_first_check} published pages have not yet
                  been checked.
                </div>
              ) : null}
              {summary.articles
                .filter((item) =>
                  summary.unchecked_article_ids.includes(item.article.id),
                )
                .slice(0, 5)
                .map((item) => (
                  <button
                    className="visibility-quick-row"
                    type="button"
                    key={item.article.id}
                    onClick={() => {
                      setFilters((current) => ({
                        ...current,
                        status: "not_checked",
                      }));
                      setArticlePage(1);
                      setArticlesOpen(true);
                    }}
                  >
                    {item.article.title}
                  </button>
                ))}
              {!summary.awaiting_first_check ? (
                <div className="notice">
                  Every published page has a completed check.
                </div>
              ) : null}
            </div>
            <div className="panel">
              <h3>Needs attention</h3>
              {summary.articles
                .filter((item) => item.needs_attention)
                .slice(0, 5)
                .map((item) => (
                  <button
                    className="visibility-quick-row"
                    type="button"
                    key={item.article.id}
                    onClick={() => setSelectedId(item.article.id)}
                  >
                    {item.article.title}
                    <small>{item.recommended_action}</small>
                  </button>
                ))}
              {!summary.needs_attention ? (
                <div className="notice">
                  No verified evidence currently triggers attention.
                </div>
              ) : null}
            </div>
          </section>
          {data ? (
            <PublicationForm
              articles={data.articles}
              busy={busy}
              onSave={(articleId, publication) =>
                act(
                  () => saveVisibilityPublication(articleId, publication),
                  "Verified Wix publication saved.",
                )
              }
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
