import { useEffect, useState } from "react";
import {
  MARKETING_ACCESS_DENIED_EVENT,
  clearMarketingAccessKey,
  getStoredMarketingAccessKey,
  isMarketingAccessDenied,
  saveMarketingAccessKey,
  validateMarketingAccessKey,
} from "../services/marketingAccess.js";

export default function MarketingAccessBoundary({ children }) {
  const [status, setStatus] = useState(() => getStoredMarketingAccessKey() ? "checking" : "locked");
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const stored = getStoredMarketingAccessKey();
    if (!stored) {
      setStatus("locked");
      return () => { active = false; };
    }
    validateMarketingAccessKey(stored)
      .then(() => { if (active) { setStatus("unlocked"); setError(""); } })
      .catch((caught) => {
        clearMarketingAccessKey();
        if (active) {
          setStatus("locked");
          setError(isMarketingAccessDenied(caught) ? "Your saved Marketing CRM access is no longer valid." : caught.message);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const relock = (event) => {
      setStatus("locked");
      setAccessKey("");
      setError(event?.detail?.message || "Your saved access has expired. Please unlock again.");
    };
    window.addEventListener(MARKETING_ACCESS_DENIED_EVENT, relock);
    return () => window.removeEventListener(MARKETING_ACCESS_DENIED_EVENT, relock);
  }, []);

  async function unlock(event) {
    event.preventDefault();
    const key = accessKey.trim();
    if (!key) return;
    setStatus("checking");
    setError("");
    try {
      await validateMarketingAccessKey(key);
      if (!saveMarketingAccessKey(key)) throw new Error("Your browser could not save the Marketing CRM access key.");
      setAccessKey("");
      setStatus("unlocked");
    } catch (caught) {
      clearMarketingAccessKey();
      setStatus("locked");
      setError(isMarketingAccessDenied(caught) ? "Access key not recognised." : caught.message || "Could not unlock Marketing CRM.");
    }
  }

  if (status === "unlocked") return children;

  return (
    <div className="page-stack">
      <section className="operations-summary competence-hero">
        <div>
          <div className="eyebrow">Protected Marketing CRM</div>
          <h2>One unlock for AI & Knowledge</h2>
          <p>Unlock once, then move between Knowledge Hub, AI Visibility, Assistant Health, testing and Knowledge Opportunities without entering the same key again.</p>
        </div>
      </section>
      <section className="panel">
        {status === "checking" ? (
          <div className="notice">Validating saved Marketing CRM access…</div>
        ) : (
          <form className="field-grid" onSubmit={unlock}>
            <label className="field">
              <span className="field__label">Marketing CRM access key</span>
              <input
                className="field__input"
                type="password"
                autoComplete="current-password"
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
                required
              />
            </label>
            <div className="card-actions" style={{ alignSelf: "end" }}>
              <button className="button button--primary" type="submit">Unlock Marketing CRM</button>
            </div>
          </form>
        )}
        {error ? <div className="notice notice--error" style={{ marginTop: 12 }}>{error}</div> : null}
      </section>
    </div>
  );
}
