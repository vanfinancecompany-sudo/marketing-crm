import { useEffect, useMemo, useRef, useState } from "react";
import { articleContentHash } from "../lib/editorialIntelligence.js";
import { evaluatePublishingSafety } from "../lib/publishingSafety.js";
import { approveAndCreateWixDraft, saveKnowledgeArticle } from "../services/knowledgeHub.js";
import { analyseEditorialArticle } from "../services/editorialEngine.js";
import { createOrUpdateWixDraft } from "../services/wixPublishing.js";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-GB");
}

export default function KnowledgeHubWixPublishing({
  article,
  linkSuggestions = [],
  hasUnsavedChanges = false,
  assessment = null,
  businessKnowledge = [],
  onSynced,
}) {
  const [currentArticle, setCurrentArticle] = useState(article);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [partial, setPartial] = useState(null);
  const [confirmClaims, setConfirmClaims] = useState(false);
  const running = useRef(false);

  useEffect(() => setCurrentArticle(article), [article]);
  useEffect(() => {
    const saved = sessionStorage.getItem("knowledgeCorrectionFeedback");
    if (!saved) return;
    sessionStorage.removeItem("knowledgeCorrectionFeedback");
    try { setResult(JSON.parse(saved)); } catch { setResult({ correction_saved: true, saved_at: new Date().toISOString() }); }
  }, []);

  const acceptedCount = useMemo(() => linkSuggestions.filter((item) => item.status === "accepted").length, [linkSuggestions]);
  const safety = useMemo(() => evaluatePublishingSafety(currentArticle || {}, {
    assessment,
    businessKnowledge,
  }), [currentArticle, assessment, businessKnowledge]);
  if (!currentArticle) return null;

  const isApproved = currentArticle.status === "approved";
  const isUpdate = Boolean(currentArticle.wix_item_id);
  const combinedLabel = isApproved
    ? (isUpdate ? "Update Wix Draft" : "Create Wix Draft")
    : (isUpdate ? "Approve & Update Wix Draft" : "Approve & Create Wix Draft");

  async function runCombined() {
    if (running.current || busy) return;
    if (hasUnsavedChanges) { setError("Corrections are not saved. Accept corrections before continuing."); return; }
    running.current = true;
    setBusy(true);
    setError(null);
    setPartial(null);
    setResult(null);
    const timers = [
      [0, "Running safety checks…"],
      [700, isApproved ? (isUpdate ? "Updating Wix draft…" : "Creating Wix draft…") : "Approving article…"],
      [1500, isUpdate ? "Updating Wix draft…" : "Creating Wix draft…"],
    ].map(([delay, text]) => setTimeout(() => setStage(text), delay));
    try {
      const response = await approveAndCreateWixDraft(
        currentArticle.id,
        articleContentHash(currentArticle),
        confirmClaims
      );
      setCurrentArticle(response.article);
      onSynced?.(response.article, response.wix);
      if (response.partial) {
        setPartial(response);
        setError(`${response.message} ${response.wix_error || ""}`.trim());
      } else {
        setStage("Complete");
        setResult({
          article_status: "Approved",
          operation: response.wix?.operation,
          wix_status: response.wix?.operation === "updated" ? "Draft updated" : "Draft created",
          timestamp: response.wix?.synced_at || new Date().toISOString(),
          dashboard_url: response.wix?.dashboard_url,
          live_published: false,
        });
      }
    } catch (caught) {
      setError(caught.message || "Safety checks failed. Article was not approved or sent to Wix.");
    } finally {
      timers.forEach(clearTimeout);
      setBusy(false);
      running.current = false;
    }
  }

  async function retryWix() {
    if (running.current || busy) return;
    running.current = true;
    setBusy(true);
    setStage(isUpdate ? "Updating Wix draft…" : "Creating Wix draft…");
    setError(null);
    try {
      const response = await createOrUpdateWixDraft(currentArticle.id);
      setCurrentArticle(response.article);
      onSynced?.(response.article, response.wix);
      setPartial(null);
      setStage("Complete");
      setResult({
        article_status: "Approved",
        operation: response.wix.operation,
        wix_status: response.wix.operation === "updated" ? "Draft updated" : "Draft created",
        timestamp: response.wix.synced_at,
        dashboard_url: response.wix.dashboard_url,
        live_published: false,
      });
    } catch (caught) {
      setError(caught.message || "Wix draft creation failed.");
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  async function approveOnly() {
    if (running.current || busy || hasUnsavedChanges) return;
    running.current = true;
    setBusy(true);
    setStage("Approving article…");
    setError(null);
    try {
      const response = await saveKnowledgeArticle(currentArticle, "approved");
      setCurrentArticle(response.article);
      onSynced?.(response.article, null);
      setResult({ article_status: "Approved", wix_status: "Not created", timestamp: response.article.approved_at, live_published: false });
    } catch (caught) {
      setError(caught.message || "Article approval failed.");
    } finally { setBusy(false); running.current = false; }
  }

  async function reanalyse() {
    if (running.current || busy) return;
    running.current = true;
    setBusy(true);
    setStage("Running safety checks…");
    setError(null);
    try {
      await analyseEditorialArticle(currentArticle.id);
      window.location.reload();
    } catch (caught) {
      setError(caught.message || "Editorial analysis could not be refreshed.");
      setBusy(false);
      running.current = false;
    }
  }

  return (
    <section className="panel knowledge-wix-publishing">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Final approval and Wix draft</div>
          <h3>{combinedLabel}</h3>
          <p>Runs current safety checks, approves when required, and creates a reviewable Wix draft. It never publishes live.</p>
        </div>
        <button className="button button--success" type="button" disabled={busy || hasUnsavedChanges} onClick={runCombined}>
          {busy ? stage || "Working…" : combinedLabel}
        </button>
      </div>

      {hasUnsavedChanges ? <div className="notice notice--error">Corrections are not saved. Accept corrections before continuing.</div> : null}
      {safety.requires_manual_claim_review ? (
        <label className="notice" style={{ display: "block" }}>
          <input type="checkbox" checked={confirmClaims} onChange={(event) => setConfirmClaims(event.target.checked)} /> I have reviewed and confirm the flagged business or financial claim.
        </label>
      ) : null}

      {result?.correction_saved ? (
        <div className="notice notice--success">
          <strong>Corrections accepted and saved as draft.</strong>
          <div>Saved: {formatDate(result.saved_at)}</div>
          <div>Article status: Draft</div>
          <div>Revision created: AI safety correction</div>
          <div>{result.analysis_stale ? "Corrections saved. Reanalyse the article before approval and Wix export." : "Corrections saved. Approve and create the Wix draft when ready."}</div>
        </div>
      ) : null}

      {result && !result.correction_saved ? (
        <div className="notice notice--success">
          <strong>Article approved and Wix draft {result.operation === "updated" ? "updated" : "created"} successfully.</strong>
          <div>Article status: {result.article_status}</div>
          <div>Wix status: {result.wix_status}</div>
          <div>Timestamp: {formatDate(result.timestamp)}</div>
          {result.dashboard_url ? <a className="button button--ghost" href={result.dashboard_url} target="_blank" rel="noreferrer">Open in Wix</a> : null}
        </div>
      ) : null}

      {error ? (
        <div className="notice notice--error">
          <strong>{partial ? "Article approved, but Wix draft creation failed." : "Action could not be completed."}</strong>
          <div>{error}</div>
          {partial?.retry_wix ? <button className="button button--ghost" type="button" disabled={busy} onClick={retryWix}>Retry Wix Draft</button> : null}
        </div>
      ) : null}

      <details style={{ marginTop: 12 }}>
        <summary><strong>Advanced options</strong></summary>
        <div className="card-actions" style={{ marginTop: 10 }}>
          {!isApproved ? <button className="button button--ghost" type="button" disabled={busy || hasUnsavedChanges} onClick={approveOnly}>Approve only</button> : null}
          {isApproved ? <button className="button button--ghost" type="button" disabled={busy || hasUnsavedChanges} onClick={retryWix}>{isUpdate ? "Update Wix Draft" : "Create Wix Draft"}</button> : null}
          <button className="button button--ghost" type="button" disabled={busy || hasUnsavedChanges} onClick={reanalyse}>Reanalyse</button>
        </div>
        <small>{acceptedCount} accepted internal link{acceptedCount === 1 ? "" : "s"} will be included. Wix output remains draft-only.</small>
      </details>
    </section>
  );
}
