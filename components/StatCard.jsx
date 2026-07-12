import { useEffect, useState } from "react";
import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";

export default function StatCard({ label, value, tone = "default" }) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    if (label !== "Suppressed") {
      setDisplayValue(value);
      return;
    }

    let cancelled = false;
    async function loadSuppressedCount() {
      try {
        const response = await fetch("/api/marketing-suppressions", {
          method: "POST",
          headers: buildMarketingAccessHeaders({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ action: "overview" }),
        });
        const result = await parseMarketingJsonResponse(response, "Could not load suppression totals.");
        const count = result?.overview?.suppressed_contacts ?? 0;
        if (!cancelled) setDisplayValue(Number(count || 0).toLocaleString("en-GB"));
      } catch {
        if (!cancelled) setDisplayValue(value);
      }
    }

    loadSuppressedCount();
    return () => { cancelled = true; };
  }, [label, value]);

  return (
    <div className={`stat-card stat-card--${tone}`}>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{displayValue}</div>
    </div>
  );
}
