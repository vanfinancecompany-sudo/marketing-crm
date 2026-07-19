import { useEffect, useMemo, useState } from "react";
import { ACTIVITY_LABELS, DAILY_ACTIVITY_TYPES, londonDateKey } from "../lib/marketingDailyOperations.js";
import { getDailyOperationsTotals } from "../services/marketingDailyOperations.js";
import { getStoredMarketingAccessKey } from "../services/marketingAccess.js";

const TABS = [
  { id: "today", label: "Today", days: 1 },
  { id: "seven", label: "Last 7 Days", days: 7 },
  { id: "thirty", label: "Last 30 Days", days: 30 },
  { id: "search", label: "Search" },
];

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount, 12)).toISOString().slice(0, 10);
}

export default function MarketingTotalsPage({ onNavigate }) {
  const today = londonDateKey();
  const [tab, setTab] = useState("today");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const selected = useMemo(() => TABS.find((item) => item.id === tab), [tab]);

  async function load(activeTab = tab) {
    if (!getStoredMarketingAccessKey()) {
      setError("Unlock Content Operations first to view marketing totals.");
      return;
    }
    const choice = TABS.find((item) => item.id === activeTab);
    const rangeEnd = choice.days ? today : endDate;
    const rangeStart = choice.days ? addDays(today, -(choice.days - 1)) : startDate;
    setLoading(true); setError("");
    try { setResult(await getDailyOperationsTotals(rangeStart, rangeEnd)); }
    catch (caught) { setError(caught.message || "Could not load marketing totals."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(tab); }, [tab]);

  return <div className="page-stack marketing-totals-page">
    <section className="hero-panel"><div><div className="eyebrow">Marketing Totals Â· UK time</div><h2>What you actually completed</h2><p>Compare real posted activity and provider-submitted email recipients with the targets active on each day.</p></div><button className="button button--ghost" type="button" onClick={() => onNavigate("Dashboard")}>OPEN TODAY&apos;S COMMANDS</button></section>
    <nav className="totals-tabs" aria-label="Marketing totals period">{TABS.map((item) => <button className={tab === item.id ? "is-active" : ""} type="button" key={item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {selected?.id === "search" ? <section className="panel"><div className="field-grid"><label className="field"><span className="field__label">From</span><input className="field__input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="field"><span className="field__label">To</span><input className="field__input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><div className="card-actions" style={{ alignSelf: "end" }}><button className="button button--primary" type="button" onClick={() => load("search")}>SEARCH TOTALS</button></div></div></section> : null}
    {error ? <div className="notice notice--error">{error}</div> : null}
    {loading ? <section className="panel">Loading totalsâ€¦</section> : null}
    {result ? <>
      <section className="totals-grid">{DAILY_ACTIVITY_TYPES.map((type) => { const item = result.totals[type]; return <article className="totals-card" key={type}><span>{ACTIVITY_LABELS[type]}</span><strong>{item.completed}</strong><dl><div><dt>Target</dt><dd>{item.target}</dd></div><div><dt>Shortfall</dt><dd>{item.shortfall}</dd></div><div><dt>Daily average</dt><dd>{item.daily_average}</dd></div><div><dt>Completion</dt><dd>{item.completion_percentage}%</dd></div></dl></article>; })}</section>
      <section className="panel"><div className="panel__header"><div><h3>Daily history</h3><p>{result.start_date} to {result.end_date}</p></div></div><div className="totals-table-wrap"><table className="totals-table"><thead><tr><th>Date</th>{DAILY_ACTIVITY_TYPES.map((type) => <th key={type}>{ACTIVITY_LABELS[type]}</th>)}<th>Complete</th></tr></thead><tbody>{[...result.days].reverse().map((day) => <tr key={day.date}><td>{day.date}{day.off_day ? " Â· Off" : ""}</td>{DAILY_ACTIVITY_TYPES.map((type) => <td key={type}>{day.metrics[type].completed} / {day.metrics[type].target}</td>)}<td>{day.completion_percentage}%</td></tr>)}</tbody></table></div></section>
    </> : null}
  </div>;
}

