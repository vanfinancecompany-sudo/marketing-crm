import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { auditPublishedArticles, evaluatePublishingSafety } from "../lib/publishingSafety.js";
import { loadKnowledgeHub } from "../services/knowledgeHub.js";
import { loadEditorialEngine, analyseEditorialArticle, recordArticleRevision } from "../services/editorialEngine.js";
import {
  acceptPublishingCorrection,
  proposeBulkPublishingCorrections,
  proposePublishingCorrection,
} from "../services/publishingCorrections.js";

function articleTitleFromPage() {
  const panels = [...document.querySelectorAll(".panel")];
  const editor = panels.find((panel) => panel.querySelector(".eyebrow")?.textContent?.trim() === "Article Editor");
  return editor?.querySelector("h3")?.textContent?.trim() || "";
}

function DiffColumn({ title, article }) {
  return (
    <div className="notice">
      <strong>{title}</strong>
      <h4>{article?.title}</h4>
      <pre className="knowledge-v5-proposal" style={{ whiteSpace: "pre-wrap", maxHeight: 420, overflow: "auto" }}>
        {article?.content_markdown || ""}
      </pre>
    </div>
  );
}

function CorrectionSummary({ proposal }) {
  const removedPercent = Math.max(0, -(proposal.word_count_change_percent || 0));
  return (
    <div className="notice" style={{ marginTop: 12 }}>
      <strong>Correction summary</strong>
      <div className="knowledge-breakdown-grid" style={{ marginTop: 8 }}>
        <div><strong>Issues repaired</strong><span>{proposal.changes?.length || 0}</span></div>
        <div><strong>Content retained</strong><span>{proposal.content_retained_percent ?? 100}%</span></div>
        <div><strong>Original words</strong><span>{proposal.original_word_count || 0}</span></div>
        <div><strong>Proposed words</strong><span>{proposal.proposed_word_count || 0}</span></div>
      </div>
      {proposal.changes?.length ? <ul>{proposal.changes.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      {proposal.removed_sections?.length ? (
        <>
          <strong>Removed sections</strong>
          <ul>{proposal.removed_sections.map((section, index) => <li key={`${section}-${index}`}>{section} — {proposal.removal_reasons?.[index] || "Reason not supplied"}</li>)}</ul>
        </>
      ) : null}
      {proposal.excessive_content_loss ? <small>{removedPercent}% of the original article is proposed for removal.</small> : null}
    </div>
  );
}

function CorrectionPanel({ articleTitle }) {
  const [article, setArticle] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [businessKnowledge, setBusinessKnowledge] = useState([]);
  const [proposal, setProposal] = useState(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [confirmLargeReduction, setConfirmLargeReduction] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadKnowledgeHub(), loadEditorialEngine()])
      .then(([hub, editorial]) => {
        if (!active) return;
        const found = (hub.articles || []).find((item) => item.title === articleTitle);
        setArticle(found || null);
        setBusinessKnowledge(hub.business_sections || []);
        setAssessment(
          (editorial.assessments || [])
            .filter((item) => item.article_id === found?.id)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null
        );
      })
      .catch((error) => setMessage(error.message || "Correction context could not be loaded."));
    return () => { active = false; };
  }, [articleTitle]);

  const safety = useMemo(
    () => evaluatePublishingSafety(article || {}, { assessment, businessKnowledge }),
    [article, assessment, businessKnowledge]
  );
  const needsCorrection = safety.hard_blocked || Object.values(safety.checks || {}).some((value) => value !== "passed");

  async function propose() {
    setStatus("working");
    setMessage("Correction in progress");
    setConfirmLargeReduction(false);
    try {
      const result = await proposePublishingCorrection(article.id);
      setProposal(result.proposal);
      setStatus("ready");
      setMessage("Proposed correction ready");
    } catch (error) {
      setStatus("idle");
      setMessage(error.message || "AI correction could not be prepared.");
    }
  }

  async function accept() {
    setStatus("working");
    setMessage("Saving accepted corrections and refreshing analysis…");
    try {
      await recordArticleRevision(article.id, "ai_safety_correction", "Original article preserved before accepted AI safety corrections.");
      await acceptPublishingCorrection(proposal, confirmLargeReduction);
      await analyseEditorialArticle(article.id);
      setMessage("Corrections accepted. Safety checks and editorial analysis refreshed.");
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setStatus("ready");
      setMessage(error.message || "Accepted corrections could not be saved.");
    }
  }

  if (!article || !needsCorrection) return null;
  const acceptanceBlocked = status === "working" || (proposal?.excessive_content_loss && !confirmLargeReduction);
  return (
    <div style={{ marginTop: 16 }}>
      <div className="card-actions">
        {!proposal ? (
          <button type="button" className="button button--primary" disabled={status === "working"} onClick={propose}>
            {status === "working" ? "Correction in progress" : "Fix with AI"}
          </button>
        ) : null}
      </div>
      {message ? <div className="notice" style={{ marginTop: 12 }}>{message}</div> : null}
      {proposal ? (
        <>
          <CorrectionSummary proposal={proposal} />
          {proposal.excessive_content_loss ? (
            <div className="notice notice--error" style={{ marginTop: 12 }}>
              <strong>Large content reduction — review required</strong>
              <p>Original: {proposal.original_word_count} words. Proposed: {proposal.proposed_word_count} words. Removed: {Math.max(0, -(proposal.word_count_change_percent || 0))}%.</p>
              <label className="toggle-row">
                <input type="checkbox" checked={confirmLargeReduction} onChange={(event) => setConfirmLargeReduction(event.target.checked)} />
                I have reviewed the removed sections and explicitly confirm this large reduction.
              </label>
            </div>
          ) : null}
          {proposal.manual_confirmation_required?.length ? (
            <div className="notice notice--error" style={{ marginTop: 12 }}>
              <strong>Manual confirmation required</strong>
              <ul>{proposal.manual_confirmation_required.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
          {proposal.removed_links?.length ? (
            <div className="notice" style={{ marginTop: 12 }}>
              <strong>Broken links removed because no confirmed destination existed</strong>
              <ul>{proposal.removed_links.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
          <div className="knowledge-two-column" style={{ marginTop: 12 }}>
            <DiffColumn title="Before" article={proposal.before} />
            <DiffColumn title="After" article={proposal.after} />
          </div>
          {proposal.safety_after?.hard_block_reasons?.length ? (
            <div className="notice notice--error" style={{ marginTop: 12 }}>
              <strong>Remaining manual checks</strong>
              <ul>{proposal.safety_after.hard_block_reasons.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
          <div className="card-actions" style={{ marginTop: 12 }}>
            <button type="button" className="button button--success" disabled={acceptanceBlocked} onClick={accept}>Accept Corrections</button>
            <button type="button" className="button button--ghost" disabled={status === "working"} onClick={() => { setProposal(null); setStatus("idle"); setConfirmLargeReduction(false); setMessage("Corrections discarded. The article was not changed."); }}>Discard Corrections</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function BulkCorrectionPanel() {
  const [flagged, setFlagged] = useState([]);
  const [selected, setSelected] = useState([]);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function audit() {
    setBusy(true);
    try {
      const [hub, editorial] = await Promise.all([loadKnowledgeHub(), loadEditorialEngine()]);
      const items = auditPublishedArticles({
        articles: hub.articles || [],
        assessments: editorial.assessments || [],
        businessKnowledge: hub.business_sections || [],
      });
      setFlagged(items);
      setSelected([]);
      setMessage(`${items.length} flagged published article(s). Select up to 5 for AI correction proposals.`);
    } catch (error) {
      setMessage(error.message || "Published article audit could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function runBulk() {
    const ids = selected.slice(0, 5);
    setBusy(true);
    setMessage(`Correction in progress for ${ids.length} selected article(s)…`);
    try {
      const response = await proposeBulkPublishingCorrections(ids);
      setResults(response.results || []);
      setMessage("Proposals prepared individually. Nothing was approved, accepted or sent to Wix.");
    } catch (error) {
      setMessage(error.message || "Bulk correction proposals could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="card-actions">
        <button type="button" className="button button--ghost" disabled={busy} onClick={audit}>Select Published Articles for AI Fix</button>
        {flagged.length ? (
          <button type="button" className="button button--primary" disabled={busy || !selected.length} onClick={runBulk}>
            Fix Flagged Articles with AI ({selected.length})
          </button>
        ) : null}
      </div>
      {message ? <div className="notice" style={{ marginTop: 8 }}>{message}</div> : null}
      {flagged.length ? (
        <div className="knowledge-review-findings" style={{ marginTop: 8 }}>
          {flagged.map((item) => (
            <label key={item.article.id} className="notice">
              <input
                type="checkbox"
                checked={selected.includes(item.article.id)}
                disabled={!selected.includes(item.article.id) && selected.length >= 5}
                onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.article.id].slice(0, 5) : current.filter((id) => id !== item.article.id))}
              />
              <strong>{item.article.title}</strong>
              <small>{item.safety.hard_block_reasons.join(" ")}</small>
            </label>
          ))}
        </div>
      ) : null}
      {results.map((item) => (
        <div className={`notice ${item.status === "failed" ? "notice--error" : ""}`} key={item.article_id} style={{ marginTop: 8 }}>
          <strong>{item.status === "ready" ? "Proposed correction ready" : "Correction failed"}</strong>
          <p>{item.status === "ready" ? `${item.proposal.safety_after?.hard_block_reasons?.length || 0} remaining block(s). ${item.proposal.excessive_content_loss ? "Large content reduction requires review. " : ""}Open the article to review and accept.` : item.message}</p>
        </div>
      ))}
    </div>
  );
}

const mounted = new WeakSet();

export function installPublishingSafetyCorrections() {
  if (typeof document === "undefined") return;
  const mount = () => {
    [...document.querySelectorAll(".panel h3")]
      .filter((heading) => heading.textContent?.trim() === "Publishing Safety Checks")
      .forEach((heading) => {
        const panel = heading.closest(".panel");
        if (!panel || mounted.has(panel)) return;
        const host = document.createElement("div");
        host.dataset.publishingCorrectionHost = "article";
        panel.appendChild(host);
        mounted.add(panel);
        createRoot(host).render(<CorrectionPanel articleTitle={articleTitleFromPage()} />);
      });

    const auditButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Audit Published Articles");
    const container = auditButton?.closest(".knowledge-table-wrap");
    if (container && !container.querySelector("[data-publishing-correction-host='bulk']")) {
      const host = document.createElement("div");
      host.dataset.publishingCorrectionHost = "bulk";
      container.insertBefore(host, container.firstChild);
      createRoot(host).render(<BulkCorrectionPanel />);
    }
  };
  mount();
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
}
