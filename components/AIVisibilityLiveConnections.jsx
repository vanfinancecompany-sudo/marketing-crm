import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  checkGoogleForArticle,
  checkGoogleForPublishedPages,
  checkWixPublicationStatus,
  loadAiVisibility,
  loadGoogleSearchConsoleConnection,
  syncLiveWixArticles,
} from "../services/aiVisibility.js";

function displaySummary(summary = {}) {
  return [
    `Wix items checked: ${summary.wix_items_checked || 0}`,
    `Live articles matched: ${summary.live_articles_matched || 0}`,
    `New published pages added: ${summary.new_published_pages_added || 0}`,
    `Existing records updated: ${summary.existing_records_updated || 0}`,
    `Drafts ignored: ${summary.drafts_ignored || 0}`,
    `Unmatched CRM articles: ${summary.unmatched_crm_articles?.length || 0}`,
    `Unmatched Wix items: ${summary.unmatched_wix_items?.length || 0}`,
    `Ambiguous matches skipped: ${summary.ambiguous_matches?.length || 0}`,
    `Errors: ${summary.errors?.length || 0}`,
  ].join(" · ");
}

function LiveConnectionsPanel() {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [google, setGoogle] = useState(null);

  useEffect(() => {
    loadGoogleSearchConsoleConnection()
      .then((result) => setGoogle(result.connection))
      .catch((caught) => setGoogle({ connection_status: "configuration_required", last_error: caught.message }));
  }, []);

  async function run(label, action, success) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const result = await action();
      setMessage(success(result));
      window.dispatchEvent(new CustomEvent("ai-visibility-live-data-updated"));
    } catch (caught) {
      setError(caught.message || "Provider request failed.");
    } finally {
      setBusy("");
    }
  }

  const googleLabel = google?.connection_status === "connected"
    ? "Connected"
    : google?.last_error
      ? "Check failed"
      : "Configuration required";

  return (
    <section className="panel" data-ai-visibility-live-connections>
      <div className="panel__header">
        <div>
          <div className="eyebrow">Live provider connections</div>
          <h3>Wix publishing and Google Search Console</h3>
          <p>Wix drafts are ignored. AI-provider evidence remains manual only.</p>
        </div>
        <div className="card-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run("wix", syncLiveWixArticles, (result) => displaySummary(result.summary))}
          >
            {busy === "wix" ? "Syncing…" : "Sync Live Wix Articles"}
          </button>
          <button
            className="button button--ghost"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run(
              "google",
              () => checkGoogleForPublishedPages(crypto.randomUUID()),
              (result) => `Google checks complete: ${result.summary.successful} successful, ${result.summary.failed} failed.`,
            )}
          >
            {busy === "google" ? "Checking…" : "Check Google for Published Pages"}
          </button>
        </div>
      </div>
      <div className="notice">
        <strong>Google Search Console: {googleLabel}</strong>
        <div>{google?.configuration_summary || "Secure server configuration has not been checked."}</div>
        <small>Last checked: {google?.last_successful_check_at ? new Date(google.last_successful_check_at).toLocaleString("en-GB") : "Never"}</small>
      </div>
      {message ? <div className="notice notice--success">{message}</div> : null}
      {error ? <div className="notice notice--error">{error}</div> : null}
    </section>
  );
}

function ArticleConnectionActions({ article }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
        <div><h3>Page actions</h3><p>Checks do not change the CRM article or publish Wix content.</p></div>
        <div className="card-actions">
          {article.live_wix_url ? <a className="button button--ghost" href={article.live_wix_url} target="_blank" rel="noreferrer">Open live page</a> : null}
          <button className="button button--ghost" type="button" disabled={Boolean(busy)} onClick={() => run("wix", () => checkWixPublicationStatus(article.id), "Wix publication status checked.")}>Check Wix status</button>
          <button className="button button--primary" type="button" disabled={Boolean(busy) || !article.live_wix_url} onClick={() => run("google", () => checkGoogleForArticle(article.id, crypto.randomUUID()), "Google evidence stored.")}>Check Google now</button>
        </div>
      </div>
      <small>ChatGPT, Gemini, Perplexity and Google AI Overview remain manual evidence only.</small>
      {message ? <div className="notice notice--success">{message}</div> : null}
      {error ? <div className="notice notice--error">{error}</div> : null}
    </section>
  );
}

const roots = new Map();
let observer;

async function findCurrentArticle() {
  const title = document.querySelector(".hero-panel h2")?.textContent?.trim();
  if (!title || title === "AI Visibility Centre" || title === "Unlock visibility evidence") return null;
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
    const heading = [...document.querySelectorAll(".hero-panel h2")].find((item) => item.textContent?.trim() === "AI Visibility Centre");
    if (heading) {
      const stack = heading.closest(".page-stack");
      if (stack && !stack.querySelector("[data-ai-visibility-live-host]")) {
        const host = document.createElement("div");
        host.dataset.aiVisibilityLiveHost = "true";
        heading.closest(".hero-panel")?.insertAdjacentElement("afterend", host);
        mountRoot("centre", host, <LiveConnectionsPanel />);
      }
    }
    const article = await findCurrentArticle();
    if (article) {
      const detailStack = document.querySelector(".page-stack");
      if (detailStack && !detailStack.querySelector("[data-ai-visibility-article-host]")) {
        const host = document.createElement("div");
        host.dataset.aiVisibilityArticleHost = article.id;
        detailStack.querySelector(".hero-panel")?.insertAdjacentElement("afterend", host);
        mountRoot(`article:${article.id}`, host, <ArticleConnectionActions article={article} />);
      }
    }
  };
  mount();
  if (!observer) {
    observer = new MutationObserver(() => mount());
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
