import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { auditPublishedArticles, evaluatePublishingSafety } from "../lib/publishingSafety.js";
import { classifyArticleProduct } from "../lib/rent2BuyRules.js";
import {
  dispatchKnowledgeCorrectionState,
  verifyAcceptedCorrection,
  writeKnowledgeCorrectionState,
} from "../lib/knowledgeCorrectionState.js";
import { loadKnowledgeHub } from "../services/knowledgeHub.js";
import { loadEditorialEngine, recordArticleRevision } from "../services/editorialEngine.js";
import {
  acceptPublishingCorrection,
  proposeBulkPublishingCorrections,
  proposePublishingCorrection,
  savePublishingCorrectionScope,
} from "../services/publishingCorrections.js";

const SCOPE_LABELS = { rent2buy: "Rent2Buy", finance: "Van Finance", both: "Both / Comparison" };
const STATUS_LABELS = { ready: "Ready to accept", review: "Review and confirm", blocked: "Blocked — material corrections required" };
const ACCEPT_BUTTON_SELECTOR = "button[data-knowledge-accept-corrections='true']";

function articleTitleFromPage() {
  const editor = [...document.querySelectorAll(".panel")].find(
    (panel) => panel.querySelector(".eyebrow")?.textContent?.trim() === "Article Editor"
  );
  return editor?.querySelector("h3")?.textContent?.trim() || "";
}

function displayItem(item) {
  if (typeof item === "string") return item;
  const location = [item?.field, item?.section, item?.column].filter(Boolean).join(" · ") || "Article";
  return `${location}: ${item?.phrase || item?.message || item?.error_type || item?.type || "Issue"}${item?.excerpt ? ` — ${item.excerpt}` : ""}`;
}

function ListNotice({ title, items }) {
  if (!items?.length) return null;
  return <div className="notice" style={{ marginTop: 10 }}><strong>{title}</strong><ul>{items.map((item, index) => <li key={`${displayItem(item)}-${index}`}>{displayItem(item)}</li>)}</ul></div>;
}

function DiffColumn({ title, article }) {
  const faqText = (article?.faq_json || []).map((item, index) => `${index + 1}. ${item?.question || ""}\n${item?.answer || ""}`).join("\n\n");
  return <div className="notice"><h4>{title}</h4><pre style={{ whiteSpace: "pre-wrap" }}>{[article?.title, article?.seo_title, article?.meta_description, article?.excerpt, article?.content_markdown, faqText, article?.cta].filter(Boolean).join("\n\n")}</pre></div>;
}

function afterTwoFrames() {
  return new Promise((resolve) => {
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 0);
    frame(() => frame(resolve));
  });
}

export function PublishingSafetyCorrectionPanel({ initialArticle = null, initialAssessment = null, mountKey = "" }) {
  const [article, setArticle] = useState(initialArticle);
  const [assessment, setAssessment] = useState(initialAssessment);
  const [businessKnowledge, setBusinessKnowledge] = useState([]);
  const [scope, setScope] = useState("rent2buy");
  const [savedScope, setSavedScope] = useState("rent2buy");
  const [proposal, setProposal] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progressMessage, setProgressMessage] = useState("");
  const [acceptError, setAcceptError] = useState("");
  const [diagnostic, setDiagnostic] = useState("Idle");
  const [contentLossConfirmed, setContentLossConfirmed] = useState(false);
  const [claimsConfirmed, setClaimsConfirmed] = useState(false);
  const acceptingRef = useRef(false);
  const acceptButtonRef = useRef(null);

  useEffect(() => {
    let active = true;
    Promise.all([loadKnowledgeHub(), loadEditorialEngine()]).then(([hub, editorial]) => {
      if (!active) return;
      const found = initialArticle || (hub.articles || []).find((item) => item.title === articleTitleFromPage());
      const latestAssessment = initialAssessment || (editorial.assessments || []).filter((item) => item.article_id === found?.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
      const detectedScope = classifyArticleProduct(found || {}, latestAssessment?.effective_intent || {});
      setArticle(found || null);
      setAssessment(latestAssessment);
      setBusinessKnowledge(hub.business_sections || []);
      setScope(detectedScope);
      setSavedScope(detectedScope);
    }).catch((error) => setAcceptError(error.message || "Correction context could not be loaded."));
    return () => { active = false; };
  }, [initialArticle?.id, initialAssessment?.id, mountKey]);

  const safety = useMemo(() => evaluatePublishingSafety(article || {}, { assessment, businessKnowledge, scopeOverride: savedScope }), [article, assessment, businessKnowledge, savedScope]);
  const needsCorrection = safety.hard_blocked || safety.requires_manual_claim_review || safety.review_warnings?.length || Object.values(safety.checks || {}).some((value) => value !== "passed");

  async function saveScope() {
    if (!article || scope === savedScope || status !== "idle") return;
    setStatus("working");
    try {
      const result = await savePublishingCorrectionScope(article.id, scope);
      setArticle((current) => ({ ...current, generation_metadata: result.article?.generation_metadata || { ...(current?.generation_metadata || {}), product_scope_override: scope } }));
      setSavedScope(scope);
      setProposal(null);
      setProgressMessage("Product scope saved.");
    } catch (error) {
      setScope(savedScope);
      setAcceptError(error.message || "Product scope could not be saved.");
    } finally {
      setStatus("idle");
    }
  }

  async function propose(reasons = []) {
    if (!article || status === "working" || status === "accepting") return;
    setStatus("working");
    setProgressMessage("Running AI correction, targeted repair, Markdown normalisation and full validation…");
    setAcceptError("");
    setContentLossConfirmed(false);
    setClaimsConfirmed(false);
    try {
      const result = await proposePublishingCorrection(article.id, reasons, savedScope);
      setProposal(result.proposal);
      setStatus("ready");
      setProgressMessage(STATUS_LABELS[result.proposal.review_status || "blocked"]);
    } catch (error) {
      setStatus("idle");
      setAcceptError(error.message || "AI correction could not be prepared.");
    }
  }

  async function handleAcceptCorrections(event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (!proposal?.correction_complete || acceptingRef.current) return;

    acceptingRef.current = true;
    setStatus("accepting");
    setAcceptError("");
    setProgressMessage("Saving and verifying corrections…");
    setDiagnostic("Click received");

    try {
      setDiagnostic("Handler started");
      await afterTwoFrames();
      setDiagnostic("API request started");
      await recordArticleRevision(article.id, "ai_safety_correction", "Original article preserved before accepted AI safety corrections.");
      await acceptPublishingCorrection(proposal, { contentLoss: contentLossConfirmed, claims: claimsConfirmed });
      setDiagnostic("API response received");

      setDiagnostic("Verification started");
      const [hub, editorial] = await Promise.all([loadKnowledgeHub(), loadEditorialEngine()]);
      const saved = (hub.articles || []).find((item) => item.id === article.id);
      const acceptedLinks = (editorial.link_suggestions || []).filter((item) => item.article_id === article.id && item.status === "accepted");
      const verification = verifyAcceptedCorrection(saved, proposal.after, acceptedLinks);
      if (!saved || !verification.correction_save_verified) {
        const failedState = { article_id: article.id, status: "verification_failed", correction_save_verified: false, verification_errors: verification.correction_save_verification_errors };
        writeKnowledgeCorrectionState(failedState);
        dispatchKnowledgeCorrectionState(failedState);
        setStatus("ready");
        setAcceptError("Corrections could not be verified after saving.");
        setDiagnostic("Verification failed");
        return;
      }

      const latestAssessment = (editorial.assessments || []).filter((item) => item.article_id === article.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
      const analysisStale = !latestAssessment || new Date(latestAssessment.created_at || 0) < new Date(saved.updated_at || 0);
      const successState = { article_id: article.id, status: "saved", correction_saved: true, correction_save_verified: true, visible_success_displayed: false, saved_at: saved.updated_at, article_status: "Draft", revision: "AI safety correction", analysis_stale: analysisStale, article: { ...saved, internal_link_suggestions: acceptedLinks } };
      writeKnowledgeCorrectionState(successState);
      dispatchKnowledgeCorrectionState(successState);
      setArticle(successState.article);
      setAssessment(latestAssessment);
      setProposal(null);
      setProgressMessage("");
      setStatus("accepted");
      setDiagnostic("Complete");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      const message = error?.message || String(error) || "Accepted corrections could not be saved.";
      const failedState = { article_id: article?.id, status: "api_failed", correction_save_verified: false, message };
      writeKnowledgeCorrectionState(failedState);
      dispatchKnowledgeCorrectionState(failedState);
      setStatus("ready");
      setAcceptError(message);
      setDiagnostic("Error");
    } finally {
      acceptingRef.current = false;
    }
  }

  useEffect(() => {
    const button = acceptButtonRef.current;
    if (!button) return undefined;
    const listener = (event) => handleAcceptCorrections(event);
    button.addEventListener("click", listener);
    return () => button.removeEventListener("click", listener);
  }, [proposal, article?.id, contentLossConfirmed, claimsConfirmed]);

  if (!article || status === "accepted" || !needsCorrection) return null;
  const accepting = status === "accepting";
  const acceptDisabled = status === "working" || accepting || !proposal?.correction_complete || !proposal?.markdown_structure_valid || proposal?.rent2buy_semantic_valid === false || proposal?.comparison_structure_valid === false || proposal?.protected_values_valid === false || proposal?.targeted_repair_text_valid === false || (proposal?.content_loss_confirmation_required && !contentLossConfirmed) || (proposal?.claim_confirmation_required && !claimsConfirmed);

  return <div data-knowledge-correction-panel={mountKey || article.id} style={{ marginTop: 16 }}>
    <div className="notice"><strong>Product scope: {SCOPE_LABELS[savedScope] || savedScope}</strong><div className="card-actions" style={{ marginTop: 8 }}><select value={scope} disabled={status !== "idle"} onChange={(event) => setScope(event.target.value)}><option value="rent2buy">Rent2Buy</option><option value="finance">Van Finance</option><option value="both">Both / Comparison</option></select><button type="button" className="button button--ghost" disabled={status !== "idle" || scope === savedScope} onClick={saveScope}>Save Product Scope</button></div></div>
    {!proposal ? <button type="button" className="button button--primary" disabled={status !== "idle" || scope !== savedScope} onClick={() => propose()}>Fix with AI</button> : null}
    {progressMessage ? <div className="notice" aria-live="polite" style={{ marginTop: 12 }}><strong>{progressMessage}</strong></div> : null}
    {proposal ? <>
      <div className={`notice ${proposal.review_status === "blocked" ? "notice--error" : ""}`} style={{ marginTop: 12 }}><strong>{STATUS_LABELS[proposal.review_status || "blocked"]}</strong></div>
      {proposal.claim_confirmation_required ? <label className="notice" style={{ display: "block", marginTop: 12 }}><input type="checkbox" checked={claimsConfirmed} disabled={accepting} onChange={(event) => setClaimsConfirmed(event.target.checked)} /> I have reviewed and confirm the flagged business or financial claim.</label> : null}
      {proposal.content_loss_confirmation_required ? <label className="notice" style={{ display: "block", marginTop: 12 }}><input type="checkbox" checked={contentLossConfirmed} disabled={accepting} onChange={(event) => setContentLossConfirmed(event.target.checked)} /> I have reviewed and confirm the proposed content reduction.</label> : null}
      <details><summary><strong>Show technical details</strong></summary><ListNotice title="Material blocks" items={proposal.remaining_hard_blocks} /><ListNotice title="Review warnings" items={proposal.review_warnings} /><ListNotice title="Protected-value errors" items={proposal.protected_value_errors} /></details>
      <details style={{ marginTop: 12 }}><summary><strong>Show before and after comparison</strong></summary><div className="knowledge-two-column"><DiffColumn title="Before" article={proposal.before} /><DiffColumn title="After" article={proposal.after} /></div></details>
      <div className="card-actions" style={{ marginTop: 12 }}>
        <button ref={acceptButtonRef} data-knowledge-accept-corrections="true" type="button" className="button button--success" disabled={acceptDisabled}>{accepting ? "Accepting…" : "Accept Corrections"}</button>
        {proposal.review_status === "blocked" ? <button type="button" className="button button--primary" disabled={status === "working" || accepting} onClick={() => propose(proposal.remaining_hard_blocks || [])}>Regenerate Correction</button> : null}
        <button type="button" className="button button--ghost" disabled={status === "working" || accepting} onClick={() => { setProposal(null); setStatus("idle"); setProgressMessage("Corrections discarded. The article was not changed."); setAcceptError(""); }}>Discard Corrections</button>
      </div>
      {acceptError ? <div className="notice notice--error" role="alert" style={{ marginTop: 10 }}><strong>{acceptError}</strong></div> : null}
      <details data-acceptance-diagnostics="true" style={{ marginTop: 10 }}><summary>Acceptance diagnostics</summary><div>{diagnostic}</div><div>Button selector: {ACCEPT_BUTTON_SELECTOR}</div></details>
    </> : null}
  </div>;
}

function BulkCorrectionPanel() {
  const [flagged, setFlagged] = useState([]);
  const [selected, setSelected] = useState([]);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  async function audit() { setBusy(true); try { const [hub, editorial] = await Promise.all([loadKnowledgeHub(), loadEditorialEngine()]); setFlagged(auditPublishedArticles({ articles: hub.articles || [], assessments: editorial.assessments || [], businessKnowledge: hub.business_sections || [] })); } finally { setBusy(false); } }
  async function runBulk() { setBusy(true); try { const response = await proposeBulkPublishingCorrections(selected.slice(0, 5)); setResults(response.results || []); } finally { setBusy(false); } }
  return <div style={{ marginTop: 12 }}><div className="card-actions"><button type="button" className="button button--ghost" disabled={busy} onClick={audit}>Select Published Articles for AI Fix</button>{flagged.length ? <button type="button" className="button button--primary" disabled={busy || !selected.length} onClick={runBulk}>Fix Flagged Articles with AI ({selected.length})</button> : null}</div>{flagged.map((item) => <label key={item.article.id} className="notice"><input type="checkbox" checked={selected.includes(item.article.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.article.id].slice(0, 5) : current.filter((id) => id !== item.article.id))} />{item.article.title}</label>)}{results.map((item) => <div className="notice" key={item.article_id}>{item.proposal?.review_status || item.status || "blocked"}</div>)}</div>;
}

const roots = new Map();
let observer;

function cleanupRoots() {
  for (const [key, entry] of roots.entries()) {
    if (!entry.host.isConnected) {
      entry.root.unmount();
      roots.delete(key);
    }
  }
}

export function installPublishingSafetyCorrections() {
  if (typeof document === "undefined") return;
  const mount = () => {
    cleanupRoots();
    const title = articleTitleFromPage();
    [...document.querySelectorAll(".panel h3")].filter((heading) => heading.textContent?.trim() === "Publishing Safety Checks").forEach((heading, index) => {
      const panel = heading.closest(".panel");
      if (!panel) return;
      const key = `article:${title || "unknown"}:${index}`;
      let host = panel.querySelector(":scope > [data-knowledge-correction-root]");
      if (!host) {
        host = document.createElement("div");
        host.dataset.knowledgeCorrectionRoot = key;
        panel.appendChild(host);
      }
      const existing = roots.get(key);
      if (existing?.host === host) return;
      if (existing) existing.root.unmount();
      const root = createRoot(host);
      roots.set(key, { root, host });
      root.render(<PublishingSafetyCorrectionPanel mountKey={key} />);
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
  if (!observer) {
    observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
