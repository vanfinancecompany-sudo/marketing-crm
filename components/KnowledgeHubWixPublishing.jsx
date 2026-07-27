import { useEffect, useMemo, useRef, useState } from "react";
import { articleContentHash } from "../lib/editorialIntelligence.js";
import { evaluatePublishingSafety } from "../lib/publishingSafety.js";
import {
  KNOWLEDGE_CORRECTION_STATE_EVENT,
  KNOWLEDGE_CORRECTION_STATE_STORAGE,
  correctionSaveEligibility,
  publishKnowledgeCorrectionState,
  readKnowledgeCorrectionState,
  verifyAcceptedCorrection,
} from "../lib/knowledgeCorrectionState.js";
import { approveAndCreateWixDraft, loadKnowledgeHub, saveKnowledgeArticle } from "../services/knowledgeHub.js";
import { analyseEditorialArticle, loadEditorialEngine, recordArticleRevision } from "../services/editorialEngine.js";
import { acceptPublishingCorrection } from "../services/publishingCorrections.js";
import { createOrUpdateWixDraft } from "../services/wixPublishing.js";

function formatDate(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-GB"); }
function verificationErrorText(errors = []) { return errors.map((item) => item?.field || String(item)).filter(Boolean).join(", "); }

export default function KnowledgeHubWixPublishing({ article, linkSuggestions = [], hasUnsavedChanges = false, assessment = null, businessKnowledge = [], onSynced }) {
  const [currentArticle, setCurrentArticle] = useState(article);
  const [correctionState, setCorrectionState] = useState(() => readKnowledgeCorrectionState());
  const [busy, setBusy] = useState(false);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [partial, setPartial] = useState(null);
  const [warningsConfirmed, setWarningsConfirmed] = useState(false);
  const running = useRef(false);

  useEffect(() => setCurrentArticle(article), [article]);
  useEffect(() => {
    const handleCorrectionState = (event) => {
      const next = event.detail || null;
      setCorrectionState(next);
      if (next?.article?.id && next.article.id === currentArticle?.id) setCurrentArticle(next.article);
    };
    window.addEventListener(KNOWLEDGE_CORRECTION_STATE_EVENT, handleCorrectionState);
    return () => window.removeEventListener(KNOWLEDGE_CORRECTION_STATE_EVENT, handleCorrectionState);
  }, [currentArticle?.id]);

  const acceptedCount = useMemo(() => linkSuggestions.filter((item) => item.status === "accepted").length, [linkSuggestions]);
  const safety = useMemo(() => evaluatePublishingSafety(currentArticle || {}, { assessment, businessKnowledge }), [currentArticle, assessment, businessKnowledge]);
  if (!currentArticle) return null;

  const correctionApplies = correctionState?.article_id === currentArticle.id;
  const activeProposal = correctionApplies ? correctionState?.proposal : null;
  const saveEligibility = correctionSaveEligibility(correctionState || {}, currentArticle);
  const correctionVerificationFailed = correctionApplies && correctionState?.status === "verification_failed";
  const correctionSaveVerified = correctionApplies && correctionState?.correction_save_verified === true;
  const hasWarnings = safety.review_warnings?.length > 0;
  const isApproved = currentArticle.status === "approved";
  const isUpdate = Boolean(currentArticle.wix_item_id);
  const combinedLabel = isApproved ? (isUpdate ? "Update Wix Draft" : "Create Wix Draft") : (isUpdate ? "Approve & Update Wix Draft" : "Approve & Create Wix Draft");
  const technicalBlocked = safety.hard_blocked || correctionVerificationFailed;
  const actionDisabled = busy || savingCorrection || hasUnsavedChanges || technicalBlocked || (hasWarnings && !warningsConfirmed);
  const statusLabel = technicalBlocked ? "Technical error — action required" : hasWarnings ? "Warnings — review before sending" : "Ready to send to Wix";

  function clearVerifiedCorrectionState() { if (!correctionApplies) return; sessionStorage.removeItem(KNOWLEDGE_CORRECTION_STATE_STORAGE); setCorrectionState(null); }

  async function saveCorrectedDraft() {
    if (running.current || savingCorrection) return;
    const eligibility = correctionSaveEligibility(correctionState || {}, currentArticle);
    if (!eligibility.eligible) { setError(eligibility.reason); return; }
    running.current = true; setSavingCorrection(true); setError(null); setResult(null); setStage("Saving corrected draft…");
    publishKnowledgeCorrectionState({ ...correctionState, status: "saving_corrected_draft", correction_save_verified: false, visible_success_displayed: false });
    try {
      await recordArticleRevision(currentArticle.id, "ai_safety_correction", "Original article preserved before accepted AI safety corrections.");
      await acceptPublishingCorrection(activeProposal, { contentLoss: correctionState.content_loss_confirmed === true, claims: correctionState.claims_confirmed === true });
      const [hub, editorial] = await Promise.all([loadKnowledgeHub(), loadEditorialEngine()]);
      const saved = (hub.articles || []).find((item) => item.id === currentArticle.id);
      const acceptedLinks = (editorial.link_suggestions || []).filter((item) => item.article_id === currentArticle.id && item.status === "accepted");
      const verification = verifyAcceptedCorrection(saved, activeProposal.after, acceptedLinks);
      if (!saved || !verification.correction_save_verified) {
        const failedState = { ...correctionState, status: "verification_failed", correction_save_verified: false, visible_success_displayed: false, verification_errors: verification.correction_save_verification_errors };
        publishKnowledgeCorrectionState(failedState); setCorrectionState(failedState); setError(`Corrected draft could not be verified. Mismatched fields: ${verificationErrorText(verification.correction_save_verification_errors) || "unknown"}.`); return;
      }
      const successState = { article_id: currentArticle.id, status: "main_editor_saved", proposal_id: correctionState.proposal_id, proposal: null, correction_saved: true, correction_save_verified: true, visible_success_displayed: true, saved_at: saved.updated_at, revision: "AI safety correction", article: { ...saved, internal_link_suggestions: acceptedLinks }, verification_errors: [] };
      publishKnowledgeCorrectionState(successState); setCorrectionState(successState); setCurrentArticle(successState.article); onSynced?.(successState.article, null); setStage("Complete");
    } catch (caught) { const message = caught?.message || "Corrected draft could not be saved."; const failedState={...correctionState,status:"save_failed",correction_save_verified:false,visible_success_displayed:false,message}; publishKnowledgeCorrectionState(failedState); setCorrectionState(failedState); setError(message); }
    finally { setSavingCorrection(false); running.current=false; }
  }

  async function runCombined() {
    if (running.current || busy) return;
    if (technicalBlocked) { setError(safety.hard_block_reasons.join(" ") || "Corrected draft verification is unresolved."); return; }
    if (hasWarnings && !warningsConfirmed) { setError("Review the warnings and confirm that you want to continue."); return; }
    if (hasUnsavedChanges) { setError("Unsaved editor changes must be saved before continuing."); return; }
    running.current=true; setBusy(true); setError(null); setPartial(null); setResult(null);
    const timers=[[0,"Running technical checks…"],[700,isApproved?(isUpdate?"Updating Wix draft…":"Creating Wix draft…"):"Approving article…"],[1500,isUpdate?"Updating Wix draft…":"Creating Wix draft…"]].map(([delay,text])=>setTimeout(()=>setStage(text),delay));
    try {
      const response=await approveAndCreateWixDraft(currentArticle.id,articleContentHash(currentArticle),warningsConfirmed);
      setCurrentArticle(response.article); onSynced?.(response.article,response.wix);
      if(response.partial){setPartial(response);setError(`${response.message} ${response.wix_error||""}`.trim());}
      else{clearVerifiedCorrectionState();setStage("Complete");setResult({article_status:"Approved",operation:response.wix?.operation,wix_status:response.wix?.operation==="updated"?"Draft updated":"Draft created",timestamp:response.wix?.synced_at||new Date().toISOString(),dashboard_url:response.wix?.dashboard_url,warnings_acknowledged:response.warnings_acknowledged,warnings_acknowledged_at:response.warnings_acknowledged_at,content_source:response.content_source,live_published:false});}
    } catch(caught){setError(caught.message||"Technical checks failed. Article was not approved or sent to Wix.");}
    finally{timers.forEach(clearTimeout);setBusy(false);running.current=false;}
  }

  async function retryWix(){if(running.current||busy||technicalBlocked)return;running.current=true;setBusy(true);setStage(isUpdate?"Updating Wix draft…":"Creating Wix draft…");setError(null);try{const response=await createOrUpdateWixDraft(currentArticle.id);setCurrentArticle(response.article);onSynced?.(response.article,response.wix);clearVerifiedCorrectionState();setPartial(null);setStage("Complete");setResult({article_status:"Approved",operation:response.wix.operation,wix_status:response.wix.operation==="updated"?"Draft updated":"Draft created",timestamp:response.wix.synced_at,dashboard_url:response.wix.dashboard_url,content_source:"current_saved_article",live_published:false});}catch(caught){setError(caught.message||"Wix draft creation failed.");}finally{setBusy(false);running.current=false;}}
  async function approveOnly(){if(running.current||busy||actionDisabled)return;running.current=true;setBusy(true);setStage("Approving article…");setError(null);try{const response=await saveKnowledgeArticle(currentArticle,"approved",warningsConfirmed);setCurrentArticle(response.article);onSynced?.(response.article,null);setResult({article_status:"Approved",wix_status:"Not created",timestamp:response.article.approved_at,warnings_acknowledged_at:response.warnings_acknowledged_at,live_published:false});}catch(caught){setError(caught.message||"Article approval failed.");}finally{setBusy(false);running.current=false;}}
  async function reanalyse(){if(running.current||busy)return;running.current=true;setBusy(true);setStage("Analysing…");setError(null);try{await analyseEditorialArticle(currentArticle.id);window.location.reload();}catch(caught){setError(caught.message||"Editorial analysis could not be refreshed.");setBusy(false);running.current=false;}}

  return <>
    {activeProposal ? <section className="panel main-editor-correction-save"><div className="panel__header"><div><div className="eyebrow">Optional AI improvement</div><h3>Save Corrected Draft</h3><p>This is optional. You may ignore the proposal and send the current saved article to Wix.</p>{!saveEligibility.eligible?<small>{saveEligibility.reason}</small>:null}</div><button type="button" className="button button--ghost" disabled={savingCorrection||!saveEligibility.eligible} onClick={saveCorrectedDraft}>{savingCorrection?"Saving corrected draft…":"Save Corrected Draft"}</button></div></section>:null}
    {correctionApplies&&correctionState?.status==="main_editor_saved"&&correctionSaveVerified?<section className="notice notice--success" role="status" aria-live="polite"><strong>Corrected article saved successfully.</strong><div>Article status: Draft</div><div>Saved: {formatDate(correctionState.saved_at)}</div><div>Saved content verified: Yes</div></section>:null}
    <section className="panel knowledge-wix-publishing">
      <div className="panel__header"><div><div className="eyebrow">Final approval and Wix draft</div><h3>{statusLabel}</h3><p>Content being sent: current saved article</p><p>{combinedLabel} creates or updates a Wix draft only. It never publishes live.</p></div><button className="button button--success" type="button" disabled={actionDisabled} onClick={runCombined}>{busy?stage||"Working…":combinedLabel}</button></div>
      {hasWarnings?<div className="notice"><strong>{safety.warning_count} warning{safety.warning_count===1?"":"s"}</strong><div>{safety.review_warnings.slice(0,3).join(" ")}</div><label style={{display:"block",marginTop:8}}><input type="checkbox" checked={warningsConfirmed} onChange={(event)=>setWarningsConfirmed(event.target.checked)} /> I have reviewed the warnings and want to continue.</label><details style={{marginTop:8}}><summary>Show technical details</summary><ul>{safety.review_warnings.map((warning)=><li key={warning}>{warning}</li>)}</ul></details></div>:null}
      {technicalBlocked?<div className="notice notice--error"><strong>Technical error — action required</strong><div>{correctionVerificationFailed?`Corrected draft verification mismatch: ${verificationErrorText(correctionState.verification_errors)}`:safety.hard_block_reasons.join(" ")}</div></div>:null}
      {hasUnsavedChanges?<div className="notice notice--error">Unsaved editor changes must be saved before continuing.</div>:null}
      {result?<div className="notice notice--success"><strong>{result.operation?`Article approved and Wix draft ${result.operation==="updated"?"updated":"created"} successfully.`:"Article approved successfully."}</strong><div>Article status: {result.article_status}</div><div>Wix status: {result.wix_status}</div><div>Content sent: current saved article</div>{result.warnings_acknowledged?<div>Warnings acknowledged: {formatDate(result.warnings_acknowledged_at)}</div>:null}<div>Timestamp: {formatDate(result.timestamp)}</div>{result.dashboard_url?<a className="button button--ghost" href={result.dashboard_url} target="_blank" rel="noreferrer">Open in Wix</a>:null}</div>:null}
      {error?<div className="notice notice--error"><strong>{partial?"Article approved, but Wix draft creation failed.":"Action could not be completed."}</strong><div>{error}</div>{partial?.retry_wix?<button className="button button--ghost" type="button" disabled={busy||technicalBlocked} onClick={retryWix}>Retry Wix Draft</button>:null}</div>:null}
      <details style={{marginTop:12}}><summary><strong>Advanced options</strong></summary><div className="card-actions" style={{marginTop:10}}>{!isApproved?<button className="button button--ghost" type="button" disabled={actionDisabled} onClick={approveOnly}>Approve only</button>:null}{isApproved?<button className="button button--ghost" type="button" disabled={busy||technicalBlocked||(hasWarnings&&!warningsConfirmed)} onClick={retryWix}>{isUpdate?"Update Wix Draft":"Create Wix Draft"}</button>:null}<button className="button button--ghost" type="button" disabled={busy} onClick={reanalyse}>Analyse again</button></div><small>{acceptedCount} accepted internal link{acceptedCount===1?"":"s"} will be included. Wix output remains draft-only.</small></details>
    </section>
  </>;
}
