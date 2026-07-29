import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  checkGoogleForArticle,
  checkGoogleForPublishedPages,
  checkWixPublicationStatus,
  loadAiVisibility,
  loadGoogleSearchConsoleConnection,
  recordManualVisibilityResult,
  syncLiveWixArticles,
} from "../services/aiVisibility.js";
import { isConfirmedPublishedArticle } from "../lib/aiVisibility.js";
import {
  MANUAL_AI_PROVIDER_URLS,
  MANUAL_PROVIDER_EXPLANATION,
  manualProviderStatus,
  suggestedVisibilityQuery,
} from "../lib/aiVisibilityProviders.js";

const MANUAL_PROVIDERS = [
  "chatgpt",
  "gemini",
  "perplexity",
  "google_ai_overviews",
];
const PROVIDER_LABELS = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  google_ai_overviews: "Google AI Overviews",
};
const RESULT_OPTIONS = [
  ["detected", "Detected"],
  ["not_detected", "Not detected"],
  ["inconclusive", "Inconclusive"],
];
const nowInput = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

function displaySummary(summary = {}) {
  return [
    `Wix items checked: ${summary.wix_items_checked || 0}`,
    `Wix LIVE items matched: ${summary.wix_live_items_matched || 0}`,
    `Active records updated: ${summary.active_records_updated || 0}`,
    `Previously live records deactivated: ${summary.previously_live_records_deactivated || 0}`,
    `Reactivated: ${summary.reactivated_records || 0}`,
    `Errors: ${summary.errors?.length || 0}`,
  ].join(" · ");
}

function SyncErrors({ summary }) {
  if (!summary?.errors?.length) return null;
  return (
    <details className="notice notice--error">
      <summary>Show sync error details ({summary.errors.length})</summary>
      <div className="knowledge-table-wrap" style={{ marginTop: 10 }}>
        <table className="knowledge-table">
          <thead>
            <tr>
              <th>CRM article ID</th>
              <th>Article title</th>
              <th>Wix item ID</th>
              <th>Slug</th>
              <th>Dynamic link fields found</th>
              <th>Exact error</th>
            </tr>
          </thead>
          <tbody>
            {summary.errors.map((item, index) => (
              <tr
                key={`${item.article_id || "unknown"}-${item.wix_item_id || index}`}
              >
                <td>{item.article_id || "—"}</td>
                <td>{item.article_title || "—"}</td>
                <td>{item.wix_item_id || "—"}</td>
                <td>{item.slug || "—"}</td>
                <td>
                  {item.dynamic_link_fields?.length
                    ? item.dynamic_link_fields
                        .map((field) => `${field.key}: ${field.value}`)
                        .join(" | ")
                    : "None returned"}
                </td>
                <td>{item.error || "Unknown error"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function latestProviderResult(results, provider, articleId = "") {
  return (
    [...(results || [])]
      .filter(
        (result) =>
          result.provider === provider &&
          (!articleId || result.article_id === articleId),
      )
      .sort(
        (a, b) => new Date(b.checked_at || 0) - new Date(a.checked_at || 0),
      )[0] || null
  );
}

function ManualCheckWorkflow({ provider, data, onClose, onSaved }) {
  const published = (data?.articles || []).filter(isConfirmedPublishedArticle);
  const [articleId, setArticleId] = useState(published[0]?.id || "");
  const article = published.find((item) => item.id === articleId) || null;
  const [query, setQuery] = useState(suggestedVisibilityQuery(article?.title));
  const [showEvidence, setShowEvidence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    result_status: "not_detected",
    checked_at: nowInput(),
    evidence_excerpt: "",
    source_url: "",
    notes: "",
    detection_verified: false,
  });

  useEffect(
    () => setQuery(suggestedVisibilityQuery(article?.title)),
    [articleId],
  );

  async function copyQuery() {
    await navigator.clipboard.writeText(query);
    setMessage("Query copied.");
  }

  async function saveEvidence() {
    if (!article) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await recordManualVisibilityResult({
        article_id: article.id,
        provider,
        result_status: form.result_status,
        checked_at: new Date(form.checked_at).toISOString(),
        evidence_excerpt: form.evidence_excerpt,
        source_url: form.source_url,
        notes: form.notes,
        structured_evidence: {
          query_used: query,
          public_manual_check: true,
          detection_verified:
            form.result_status === "detected" ? form.detection_verified : false,
          detection_basis:
            form.result_status === "detected"
              ? "administrator_observed_public_result"
              : "",
        },
      });
      setMessage("Verified manual evidence saved.");
      await onSaved();
    } catch (caught) {
      setError(caught.message || "Manual evidence could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const detectedInvalid =
    form.result_status === "detected" &&
    (!form.detection_verified || !form.evidence_excerpt.trim());

  return (
    <div
      className="panel panel--nested"
      style={{ marginTop: 14 }}
      data-manual-ai-workflow
    >
      <div className="panel__header">
        <div>
          <div className="eyebrow">Manual public check</div>
          <h3>{PROVIDER_LABELS[provider]}</h3>
        </div>
        <button
          className="button button--ghost"
          type="button"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="field-grid">
        <label className="field">
          <span className="field__label">Knowledge Hub article</span>
          <select
            className="field__input"
            value={articleId}
            onChange={(event) => setArticleId(event.target.value)}
          >
            <option value="">Select article</option>
            {published.map((item) => (
              <option value={item.id} key={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span className="field__label">Suggested query</span>
          <textarea
            className="field__input"
            rows={3}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {article ? (
        <div className="notice">
          <strong>{article.title}</strong>
          <br />
          <a href={article.live_wix_url} target="_blank" rel="noreferrer">
            {article.live_wix_url}
          </a>
        </div>
      ) : null}
      <div className="card-actions">
        <button
          className="button button--ghost"
          type="button"
          disabled={!query.trim()}
          onClick={copyQuery}
        >
          Copy Query
        </button>
        <a
          className="button button--ghost"
          href={MANUAL_AI_PROVIDER_URLS[provider]}
          target="_blank"
          rel="noreferrer"
        >
          Open Provider
        </a>
        <button
          className="button button--primary"
          type="button"
          disabled={!article}
          onClick={() => setShowEvidence(true)}
        >
          Add Evidence
        </button>
      </div>
      {showEvidence ? (
        <div className="field-grid" style={{ marginTop: 14 }}>
          <label className="field">
            <span className="field__label">Result status</span>
            <select
              className="field__input"
              value={form.result_status}
              onChange={(event) =>
                setForm({ ...form, result_status: event.target.value })
              }
            >
              {RESULT_OPTIONS.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Checked date and time</span>
            <input
              className="field__input"
              type="datetime-local"
              value={form.checked_at}
              onChange={(event) =>
                setForm({ ...form, checked_at: event.target.value })
              }
            />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Evidence excerpt or notes</span>
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
            <span className="field__label">Source URL, when available</span>
            <input
              className="field__input"
              value={form.source_url}
              onChange={(event) =>
                setForm({ ...form, source_url: event.target.value })
              }
            />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Additional notes</span>
            <textarea
              className="field__input"
              rows={2}
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
            />
          </label>
          {form.result_status === "detected" ? (
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <input
                type="checkbox"
                checked={form.detection_verified}
                onChange={(event) =>
                  setForm({ ...form, detection_verified: event.target.checked })
                }
              />{" "}
              I verified that the public result mentions Van Finance Company,
              links to vanfinancecompany.co.uk, cites the relevant article, or
              clearly identifies the company as the source.
            </label>
          ) : null}
          <div className="notice" style={{ gridColumn: "1 / -1" }}>
            A generic answer on the same subject is not a detection. Save only
            what you actually observed.
          </div>
          <button
            className="button button--primary"
            type="button"
            disabled={busy || !article || !query.trim() || detectedInvalid}
            onClick={saveEvidence}
          >
            {busy ? "Saving…" : "Save Evidence"}
          </button>
        </div>
      ) : null}
      {message ? <div className="notice notice--success">{message}</div> : null}
      {error ? <div className="notice notice--error">{error}</div> : null}
    </div>
  );
}

function LiveConnectionsPanel() {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncSummary, setSyncSummary] = useState(null);
  const [google, setGoogle] = useState(null);
  const [data, setData] = useState(null);
  const [manualProvider, setManualProvider] = useState("");

  async function refresh() {
    const [visibility, googleResult] = await Promise.all([
      loadAiVisibility(),
      loadGoogleSearchConsoleConnection(),
    ]);
    setData(visibility);
    setGoogle(googleResult.connection);
  }

  useEffect(() => {
    refresh().catch((caught) => setError(caught.message));
  }, []);

  async function run(label, action, success) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (label === "wix") setSyncSummary(result.summary || null);
      setMessage(success(result));
      await refresh();
      window.dispatchEvent(new CustomEvent("ai-visibility-live-data-updated"));
    } catch (caught) {
      setError(caught.message || "Provider request failed.");
    } finally {
      setBusy("");
    }
  }

  const googleLabel =
    google?.connection_status === "connected"
      ? "Connected"
      : google?.last_error
        ? "Check failed"
        : "Configuration required";
  const publishedIds = useMemo(
    () =>
      new Set(
        (data?.articles || [])
          .filter(isConfirmedPublishedArticle)
          .map((article) => article.id),
      ),
    [data],
  );

  return (
    <section className="panel" data-ai-visibility-live-connections>
      <div className="panel__header">
        <div>
          <div className="eyebrow">Live provider connections</div>
          <h3>Wix publishing and visibility checks</h3>
          <p>
            Wix drafts are ignored. AI-provider evidence is recorded only after
            a manual public search.
          </p>
        </div>
        <div className="card-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run("wix", syncLiveWixArticles, (result) =>
                displaySummary(result.summary),
              )
            }
          >
            {busy === "wix" ? "Syncing…" : "Sync Live Wix Articles"}
          </button>
          <button
            className="button button--ghost"
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run(
                "google",
                () => checkGoogleForPublishedPages(crypto.randomUUID()),
                (result) =>
                  `Google checks complete: ${result.summary.successful} successful, ${result.summary.failed} failed.`,
              )
            }
          >
            {busy === "google"
              ? "Checking…"
              : "Check Google for Published Pages"}
          </button>
        </div>
      </div>
      <div className="notice">
        <strong>Google Search Console: {googleLabel}</strong>
        <div>
          {google?.configuration_summary ||
            "Secure server configuration has not been checked."}
        </div>
        <small>
          Last checked:{" "}
          {google?.last_successful_check_at
            ? new Date(google.last_successful_check_at).toLocaleString("en-GB")
            : "Never"}
        </small>
      </div>
      <details
        className="panel panel--nested"
        style={{ boxShadow: "none" }}
        data-manual-ai-checks
      >
        <summary>
          <strong>Manual AI checks</strong> · 4 manual providers available
        </summary>
        <div className="operations-drawer__body">
          <div className="notice">
            Google Search Console is checked automatically when requested.
            ChatGPT, Gemini, Perplexity and Google AI Overviews require a manual
            public search and verified evidence.
          </div>
          <details className="notice">
            <summary>How to run a manual check</summary>
            <ol>
              <li>Select an article.</li>
              <li>Copy the suggested query.</li>
              <li>Open the public provider.</li>
              <li>Run the search in a clean session.</li>
              <li>Record Detected, Not detected or Inconclusive.</li>
              <li>Save only what you actually observed.</li>
            </ol>
          </details>
          <div className="card-grid">
            {MANUAL_PROVIDERS.map((provider) => {
              const latest = latestProviderResult(
                (data?.results || []).filter((result) =>
                  publishedIds.has(result.article_id),
                ),
                provider,
              );
              return (
                <article
                  className="panel panel--nested"
                  style={{ boxShadow: "none" }}
                  key={provider}
                >
                  <div className="panel__header">
                    <div>
                      <strong>{PROVIDER_LABELS[provider]}</strong>
                      <p>{MANUAL_PROVIDER_EXPLANATION}</p>
                    </div>
                    <span className="visibility-status is-neutral">
                      {manualProviderStatus(latest)}
                    </span>
                  </div>
                  <small>
                    Last checked:{" "}
                    {latest?.checked_at
                      ? new Date(latest.checked_at).toLocaleString("en-GB")
                      : "Never"}
                  </small>
                  {latest ? (
                    <div className="card-actions">
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => setManualProvider(provider)}
                      >
                        View Evidence
                      </button>
                    </div>
                  ) : null}
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => setManualProvider(provider)}
                  >
                    Run Manual Check
                  </button>
                </article>
              );
            })}
          </div>
          {manualProvider ? (
            <ManualCheckWorkflow
              provider={manualProvider}
              data={data}
              onClose={() => setManualProvider("")}
              onSaved={async () => {
                await refresh();
                setManualProvider("");
                window.dispatchEvent(
                  new CustomEvent("ai-visibility-live-data-updated"),
                );
              }}
            />
          ) : null}
        </div>
      </details>
      {message ? <div className="notice notice--success">{message}</div> : null}
      <SyncErrors summary={syncSummary} />
      {error ? <div className="notice notice--error">{error}</div> : null}
    </section>
  );
}

function ArticleConnectionActions({ article }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isLive = isConfirmedPublishedArticle(article);
  async function run(label, action, success) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      window.dispatchEvent(new CustomEvent("ai-visibility-live-data-updated"));
    } catch (caught) {
      setError(caught.message || "Provider request failed.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel" data-ai-visibility-article-actions>
      <div className="panel__header">
        <div>
          <h3>Page actions</h3>
          <p>Checks do not change the CRM article or publish Wix content.</p>
        </div>
        <div className="card-actions">
          {isLive ? (
            <a
              className="button button--ghost"
              href={article.live_wix_url}
              target="_blank"
              rel="noreferrer"
            >
              Open live page
            </a>
          ) : null}
          <button
            className="button button--ghost"
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run(
                "wix",
                () => checkWixPublicationStatus(article.id),
                "Wix publication status checked.",
              )
            }
          >
            Check Wix status
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={Boolean(busy) || !isLive}
            onClick={() =>
              run(
                "google",
                () => checkGoogleForArticle(article.id, crypto.randomUUID()),
                "Google evidence stored.",
              )
            }
          >
            Check Google now
          </button>
        </div>
      </div>
      <small>
        ChatGPT, Gemini, Perplexity and Google AI Overview remain verified
        manual evidence only.
      </small>
      {message ? <div className="notice notice--success">{message}</div> : null}
      {error ? <div className="notice notice--error">{error}</div> : null}
    </section>
  );
}

const roots = new Map();
let observer;
async function findCurrentArticle() {
  const title = document.querySelector(".hero-panel h2")?.textContent?.trim();
  if (
    !title ||
    title === "AI Visibility Centre" ||
    title === "Unlock visibility evidence"
  )
    return null;
  const result = await loadAiVisibility();
  return result.articles?.find((article) => article.title === title) || null;
}
function mountRoot(key, host, element) {
  const existing = roots.get(key);
  if (existing?.host === host) return;
  if (existing) existing.root.unmount();
  const root = createRoot(host);
  roots.set(key, { root, host });
  root.render(element);
}
export function installAiVisibilityLiveConnections() {
  if (typeof document === "undefined") return;
  const mount = async () => {
    for (const [key, entry] of roots.entries()) {
      if (!entry.host.isConnected) {
        entry.root.unmount();
        roots.delete(key);
      }
    }
    const heading = [...document.querySelectorAll(".hero-panel h2")].find(
      (item) => item.textContent?.trim() === "AI Visibility Centre",
    );
    if (heading) {
      const stack = heading.closest(".page-stack");
      const anchor = stack?.querySelector("[data-ai-visibility-live-anchor]");
      if (anchor && !stack.querySelector("[data-ai-visibility-live-host]")) {
        const host = document.createElement("div");
        host.dataset.aiVisibilityLiveHost = "true";
        anchor.insertAdjacentElement("afterend", host);
        mountRoot("centre", host, <LiveConnectionsPanel />);
      }
    }
    const article = await findCurrentArticle();
    if (article) {
      const detailStack = document.querySelector(".page-stack");
      if (
        detailStack &&
        !detailStack.querySelector("[data-ai-visibility-article-host]")
      ) {
        const host = document.createElement("div");
        host.dataset.aiVisibilityArticleHost = article.id;
        detailStack
          .querySelector(".hero-panel")
          ?.insertAdjacentElement("afterend", host);
        mountRoot(
          `article:${article.id}`,
          host,
          <ArticleConnectionActions article={article} />,
        );
      }
    }
  };
  mount();
  if (!observer) {
    observer = new MutationObserver(() => mount());
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
