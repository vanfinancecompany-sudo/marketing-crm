import { createRoot } from "react-dom/client";
import { loadAiVisibility } from "../services/aiVisibility.js";

const displayDate = (value) =>
  value ? new Date(value).toLocaleString("en-GB") : "—";

function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function GoogleErrorDetails({ article, results }) {
  const googleResults = [...results]
    .filter(
      (result) =>
        result.article_id === article.id &&
        result.provider === "google_search_console",
    )
    .sort((a, b) => new Date(b.checked_at) - new Date(a.checked_at));
  const latest = googleResults[0] || null;

  if (!latest || latest.result_status !== "error") return null;

  const structured = safeObject(latest.structured_evidence);
  const metadata = safeObject(latest.response_metadata);
  const exactError =
    String(latest.error_details || structured.inspection_error || "").trim() ||
    "Google did not return a usable indexing verdict.";

  return (
    <section className="panel" data-ai-visibility-google-error-details>
      <div className="panel__header">
        <div>
          <div className="eyebrow">Google check details</div>
          <h3>Why this page shows Error</h3>
          <p>
            This is the exact stored Google failure for the latest page check.
          </p>
        </div>
        <span className="visibility-status is-negative">Error</span>
      </div>

      <div className="notice notice--error">
        <strong>{exactError}</strong>
        <br />
        <small>Checked: {displayDate(latest.checked_at)}</small>
      </div>

      <details className="operations-drawer" open>
        <summary>VIEW GOOGLE EVIDENCE DETAILS</summary>
        <div className="operations-drawer__body">
          <dl className="field-grid">
            <div className="field">
              <dt className="field__label">Stored result</dt>
              <dd>{latest.result_status}</dd>
            </div>
            <div className="field">
              <dt className="field__label">Page URL</dt>
              <dd>{latest.source_url || article.live_wix_url || "—"}</dd>
            </div>
            <div className="field">
              <dt className="field__label">Google property</dt>
              <dd>{structured.source_property || "—"}</dd>
            </div>
            <div className="field">
              <dt className="field__label">Failure code</dt>
              <dd>{metadata.failure_code || "—"}</dd>
            </div>
            <div className="field">
              <dt className="field__label">Search impressions</dt>
              <dd>{Number(structured.impressions || 0)}</dd>
            </div>
            <div className="field">
              <dt className="field__label">Search clicks</dt>
              <dd>{Number(structured.clicks || 0)}</dd>
            </div>
          </dl>
          {latest.evidence_excerpt ? <p>{latest.evidence_excerpt}</p> : null}
          {latest.source_url ? (
            <a
              className="button button--ghost"
              href={latest.source_url}
              target="_blank"
              rel="noreferrer"
            >
              Open checked page
            </a>
          ) : null}
        </div>
      </details>

      {googleResults.length > 1 ? (
        <details className="operations-drawer">
          <summary>VIEW PREVIOUS GOOGLE ATTEMPTS ({googleResults.length})</summary>
          <div className="operations-drawer__body">
            {googleResults.map((result) => (
              <div className="notice" key={result.id} style={{ marginBottom: 8 }}>
                <strong>
                  {displayDate(result.checked_at)} · {result.result_status}
                </strong>
                <div>
                  {result.error_details ||
                    result.evidence_excerpt ||
                    "No additional detail was stored."}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

const roots = new Map();
let observer;
let scheduled = false;

function currentArticleTitle() {
  const title = document.querySelector(".hero-panel h2")?.textContent?.trim();
  if (!title || title === "AI Visibility Centre" || title === "Unlock visibility evidence") {
    return "";
  }
  return title;
}

function cleanupDisconnectedRoots() {
  for (const [key, entry] of roots.entries()) {
    if (!entry.host.isConnected) {
      entry.root.unmount();
      roots.delete(key);
    }
  }
}

async function mountErrorDetails() {
  cleanupDisconnectedRoots();
  const title = currentArticleTitle();
  if (!title) return;

  const pageStack = document.querySelector(".page-stack");
  const providerHeading = [...document.querySelectorAll(".panel h3")].find(
    (heading) => heading.textContent?.trim() === "Current provider results",
  );
  const providerPanel = providerHeading?.closest(".panel");
  if (!pageStack || !providerPanel) return;

  const data = await loadAiVisibility();
  const article = (data.articles || []).find((item) => item.title === title);
  if (!article) return;

  const existingHost = pageStack.querySelector(
    "[data-ai-visibility-google-error-host]",
  );
  const host = existingHost || document.createElement("div");
  host.dataset.aiVisibilityGoogleErrorHost = article.id;
  if (!existingHost) providerPanel.insertAdjacentElement("afterend", host);

  const key = `google-error:${article.id}`;
  const existing = roots.get(key);
  if (existing?.host === host) {
    existing.root.render(
      <GoogleErrorDetails article={article} results={data.results || []} />,
    );
    return;
  }
  if (existing) existing.root.unmount();
  const root = createRoot(host);
  roots.set(key, { root, host });
  root.render(
    <GoogleErrorDetails article={article} results={data.results || []} />,
  );
}

function scheduleMount() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    mountErrorDetails().catch((error) =>
      console.error("AI VISIBILITY GOOGLE ERROR DETAILS UI ERROR", error),
    );
  });
}

export function installAiVisibilityErrorDetails() {
  if (typeof document === "undefined" || observer) return;
  scheduleMount();
  observer = new MutationObserver(scheduleMount);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("ai-visibility-live-data-updated", scheduleMount);
}
