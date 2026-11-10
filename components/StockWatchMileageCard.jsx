import { useState } from "react";
import { buildMarketingAccessHeaders } from "../services/marketingAccess.js";

const display = (value) => Number.isFinite(value) ? Number(value).toLocaleString("en-GB") + " miles" : "Not readable";

export default function StockWatchMileageCard({ record, onApplied }) {
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const [typedReg, setTypedReg] = useState("");
  const [acceptLower, setAcceptLower] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function requestMileage(action, options = {}) {
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/dealerkit-mileage-update", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildMarketingAccessHeaders() },
        body: JSON.stringify({
          action, pipeline: record.pipeline, registration: record.registration,
          supplierStockId: record.supplierStockId, ...options,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Wix mileage request failed.");
      if (action === "preview") {
        setPreview(payload);
        setTypedReg("");
        setAcceptLower(false);
      } else {
        setSuccess("Wix mileage verified in " + payload.changedRecords + " collection(s).");
        setPreview(null);
        if (onApplied) onApplied();
      }
    } catch (cause) {
      setError(cause.message || "Mileage update failed.");
      if (action === "apply") setPreview(null);
    } finally {
      setBusy("");
    }
  }

  const difference = record.difference;
  return (
    <article className="vansco-card" data-mileage-pipeline={record.pipeline} data-mileage-registration={record.registration}>
      <div className="vansco-card__image-wrap">
        {record.imageUrl
          ? <img src={record.imageUrl} alt={record.title || "Vehicle"} className="vansco-card__image" />
          : <div className="vansco-card__image vansco-card__image--placeholder">No image</div>}
      </div>
      <div className="vansco-card__body">
        <div className="vansco-card__badges"><span className="status-pill">Mileage review</span></div>
        <h3>{record.title || "Vehicle"}</h3>
        <div className="vehicle-card__meta">Registration: <strong>{record.registration}</strong></div>
        <div className="vehicle-card__meta">DealerKit: <strong>{display(record.dealerMileage)}</strong></div>
        <div className="vehicle-card__meta">Published Wix: <strong>{display(record.wixMileage)}</strong></div>
        <div className="vehicle-card__meta"><strong>{difference === null ? "Wix mileage needs checking" : (difference >= 0 ? "Increase" : "Decrease") + ": " + display(Math.abs(difference))}</strong></div>
        {record.localStockUrl ? <a className="button button--ghost" href={record.localStockUrl} target="_blank" rel="noreferrer">View published vehicle</a> : null}
        {!success && <button className="button button--primary" type="button" disabled={Boolean(busy)} onClick={() => requestMileage("preview")}>{busy === "preview" ? "Checking DealerKit and Wix..." : "Preview mileage update"}</button>}
        {preview && (
          <div style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: 10, display: "grid", gap: 8, fontSize: 12 }}>
            <strong>Fresh Wix mileage-only preview</strong>
            <div>DealerKit: {display(preview.dealerMileage)}</div>
            <div>{preview.changedRecords} Wix collection(s) require a change.</div>
            {(preview.targets || []).map((target) => (
              <div key={target.collectionId}>
                <strong>{target.collectionId}</strong>: {display(target.previousMileage)} to {display(preview.dealerMileage)}
                <div>Fields: {(target.changedFields || []).join(", ")}{target.conflicts ? " (existing fields disagree)" : ""}</div>
                {target.missingMileage && <div style={{ color: "#92400e" }}>Wix detail mileage field is empty; will populate it using the verified specification and DealerKit mileage.</div>}
              </div>
            ))}
            <div>{preview.warning}</div>
            {preview.lowered && <label><input type="checkbox" checked={acceptLower} onChange={(event) => setAcceptLower(event.target.checked)} /> I approve this mileage reduction.</label>}
            {preview.canApply && preview.writesEnabled ? (
              <>
                <label>Type the full registration to approve
                  <input className="field__input" value={typedReg} onChange={(event) => setTypedReg(event.target.value.toUpperCase())} placeholder={record.registration} />
                </label>
                <button className="button button--primary" type="button"
                  disabled={Boolean(busy) || typedReg.replace(/[^A-Z0-9]/g, "") !== record.registration || (preview.lowered && !acceptLower)}
                  onClick={() => requestMileage("apply", { fingerprint: preview.fingerprint, confirmRegistration: typedReg, acceptLowerMileage: acceptLower })}>
                  {busy === "apply" ? "Updating and verifying..." : "Confirm Wix mileage update"}
                </button>
              </>
            ) : preview.canApply ? (
              <div role="status" style={{ padding: "9px 11px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, color: "#9a3412", fontWeight: 700 }}>
                Preview only. Live Wix mileage updates remain disabled until rollout checks are complete.
              </div>
            ) : <div>Wix already matches DealerKit across verified fields. No update is required.</div>}
          </div>
        )}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {success && <div className="success-banner" role="status">{success}</div>}
      </div>
    </article>
  );
}
