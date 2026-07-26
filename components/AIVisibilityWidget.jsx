import { useEffect, useState } from "react";
import { loadAiVisibility } from "../services/aiVisibility.js";

const METRICS = [
  ["published_pages", "Published pages"],
  ["google_indexed", "Google indexed"],
  ["ai_visible", "Visible on monitored AI"],
  ["chatgpt_detections", "ChatGPT detections"],
  ["gemini_detections", "Gemini detections"],
  ["perplexity_detections", "Perplexity detections"],
  ["google_ai_overview_detections", "Google AI Overview detections"],
  ["awaiting_first_check", "Awaiting first check"],
  ["needs_attention", "Needs attention"],
  ["total_verified_detections", "Total verified detections"],
  ["visibility_rate", "Visibility rate"],
];

const displayDate = (value) =>
  value ? new Date(value).toLocaleString("en-GB") : "Never checked";

export default function AIVisibilityWidget({ onOpen, compact = false }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadAiVisibility()
      .then((result) => {
        if (active) setSummary(result.summary);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || "AI Visibility evidence could not be loaded.");
      });
    return () => { active = false; };
  }, []);

  function open(metric) {
    try { sessionStorage.setItem("aiVisibilityMetric", metric); } catch {}
    onOpen?.(metric);
  }

  return (
    <section className="panel ai-visibility-widget">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Verified evidence only</div>
          <h3>AI Visibility</h3>
          <p>No ranking or detection is shown unless a stored result supports it.</p>
        </div>
        <button className="button button--ghost" type="button" onClick={() => open("all")}>
          Open Visibility Centre
        </button>
      </div>
      {error ? <div className="notice notice--error">{error}</div> : null}
      {!summary && !error ? <div className="notice">Loading verified visibility evidence...</div> : null}
      {summary ? (
        <>
          <div className={`ai-visibility-metrics${compact ? " is-compact" : ""}`}>
            {METRICS.map(([key, label]) => (
              <button className="ai-visibility-metric" type="button" key={key} onClick={() => open(key)}>
                <span>{label}</span>
                <strong>{key === "visibility_rate" ? `${summary[key]}%` : summary[key]}</strong>
                {key === "visibility_rate" ? (
                  <small>{summary.visibility_rate_numerator}/{summary.visibility_rate_denominator} eligible checked pages</small>
                ) : null}
              </button>
            ))}
          </div>
          <button className="ai-visibility-last-check" type="button" onClick={() => open("last_checked")}>
            Last checked: <strong>{displayDate(summary.last_checked_at)}</strong>
          </button>
        </>
      ) : null}
    </section>
  );
}
