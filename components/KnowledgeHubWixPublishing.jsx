import { useMemo, useState } from "react";
import { createOrUpdateWixDraft } from "../services/wixPublishing.js";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-GB");
}

function ErrorLabel({ type }) {
  const labels = {
    authentication: "Authentication error",
    configuration: "Configuration error",
    validation: "Validation error",
    api: "Wix API error",
  };
  return <strong>{labels[type] || "Wix API error"}</strong>;
}

export default function KnowledgeHubWixPublishing({
  article,
  linkSuggestions = [],
  hasUnsavedChanges = false,
  onSynced,
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const acceptedCount = useMemo(
    () => linkSuggestions.filter((item) => item.status === "accepted").length,
    [linkSuggestions]
  );
  const unresolvedCount = useMemo(
    () => linkSuggestions.filter((item) => item.status === "pending").length,
    [linkSuggestions]
  );

  if (article?.status !== "approved") return null;

  const isUpdate = Boolean(article.wix_item_id);
  const actionLabel = isUpdate ? "Update Wix Draft" : "Create Wix Draft";

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await createOrUpdateWixDraft(article.id);
      setResult(response.wix);
      setConfirming(false);
      onSynced?.(response.article, response.wix);
    } catch (caught) {
      setError({
        type: caught.type || "api",
        message: caught.message || "Wix draft creation failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel knowledge-wix-publishing">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Wix CMS publishing</div>
          <h3>Knowledge Hub Articles</h3>
          <p>Creates reviewable draft content in collection <strong>Import3</strong>. It never publishes the page.</p>
        </div>
        <div className="card-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={busy || hasUnsavedChanges}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            {actionLabel}
          </button>
        </div>
      </div>

      {hasUnsavedChanges ? (
        <div className="notice">Save the approved article changes before syncing the Wix draft.</div>
      ) : null}

      {confirming ? (
        <div className="knowledge-wix-confirmation">
          <h4>Confirm {actionLabel}</h4>
          <dl className="knowledge-wix-summary">
            <div><dt>Article title</dt><dd>{article.title}</dd></div>
            <div><dt>Proposed slug</dt><dd>{article.slug}</dd></div>
            <div><dt>SEO title</dt><dd>{article.seo_title || "Missing"}</dd></div>
            <div><dt>Meta description</dt><dd>{article.meta_description || "Missing"}</dd></div>
            <div><dt>Content status</dt><dd>Approved in CRM → Draft in Wix</dd></div>
            <div>
              <dt>Internal links</dt>
              <dd>{acceptedCount} accepted; {unresolvedCount} awaiting review. Only accepted links transfer.</dd>
            </div>
            <div><dt>Destination</dt><dd>Wix CMS / Import3 / Knowledge Hub Articles</dd></div>
            {isUpdate ? <div><dt>Existing Wix item</dt><dd>{article.wix_item_id}</dd></div> : null}
          </dl>
          <div className="card-actions">
            <button className="button button--ghost" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            <button className="button button--success" type="button" disabled={busy} onClick={submit}>
              {busy ? "Sending to Wix..." : `Confirm ${actionLabel}`}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="notice notice--success">
          <strong>Wix draft {result.operation === "created" ? "created" : "updated"}</strong>
          <div>Wix item ID: {result.item_id}</div>
          <div>Sync status: {result.sync_status}</div>
          <div>Date and time: {formatDate(result.synced_at)}</div>
          <div>Destination: Wix CMS / {result.collection_id}</div>
          {result.dashboard_url ? (
            <a className="button button--ghost" href={result.dashboard_url} target="_blank" rel="noreferrer">Open in Wix</a>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="notice notice--error">
          <ErrorLabel type={error.type} />
          <div>{error.message}</div>
          <button className="button button--ghost" type="button" disabled={busy} onClick={submit}>Retry</button>
        </div>
      ) : null}

      {article.wix_item_id && !result ? (
        <div className="knowledge-wix-existing">
          <span>Wix item ID: <strong>{article.wix_item_id}</strong></span>
          <span>Sync status: <strong>{article.wix_sync_status || "not configured"}</strong></span>
          <span>Last sync: <strong>{formatDate(article.last_wix_sync_at)}</strong></span>
          {article.wix_draft_url ? (
            <a href={article.wix_draft_url} target="_blank" rel="noreferrer">Open in Wix</a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
