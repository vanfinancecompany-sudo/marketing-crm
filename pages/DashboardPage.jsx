import { useEffect, useMemo, useState } from "react";
import { ACTIVITY_LABELS, DAILY_ACTIVITY_TYPES, DEFAULT_DAILY_TARGETS, londonDateKey, londonWeekday } from "../lib/marketingDailyOperations.js";
import {
  getDailyOperationsOverview,
  getDailyOperationsTotals,
  resetDailyTargetDefaults,
  saveDailyTargetOverride,
  saveDailyTargetSchedule,
} from "../services/marketingDailyOperations.js";
import { getStoredMarketingAccessKey, saveMarketingAccessKey, validateMarketingAccessKey } from "../services/marketingAccess.js";
import AIVisibilityWidget from "../components/AIVisibilityWidget.jsx";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ACTIVITY_UNITS = {
  van_finance_facebook_post: "posted",
  rent2buy_facebook_post: "posted",
  van_finance_reel: "generated",
  rent2buy_reel: "generated",
  emails_sent: "sent",
};

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount, 12)).toISOString().slice(0, 10);
}

function blankSchedule() {
  return Array.from({ length: 7 }, () => ({ ...DEFAULT_DAILY_TARGETS }));
}

function TargetFields({ value, onChange }) {
  return <div className="operations-target-fields">
    {DAILY_ACTIVITY_TYPES.map((type) => <label className="field" key={type}>
      <span className="field__label">{ACTIVITY_LABELS[type]}</span>
      <input className="field__input" type="number" min="0" max="10000" value={value[type]} disabled={value.off_day} onChange={(event) => onChange({ ...value, [type]: Math.max(0, Number(event.target.value || 0)) })} />
    </label>)}
    <label className="toggle-row"><input type="checkbox" checked={Boolean(value.off_day)} onChange={(event) => onChange({ ...value, off_day: event.target.checked })} />Off day — no target</label>
  </div>;
}

function ActivityCard({ metric }) {
  return <article className={`operations-activity-card${metric.remaining === 0 ? " is-complete" : ""}`}>
    <div className="operations-activity-card__heading"><span>{ACTIVITY_LABELS[metric.type]}</span><b>{metric.remaining === 0 ? "COMPLETE" : `${metric.remaining} LEFT`}</b></div>
    <div className="operations-activity-card__numbers"><strong>{metric.completed}</strong><span>{ACTIVITY_UNITS[metric.type]}</span><em>Target {metric.target}</em></div>
    <div className="operations-progress" aria-label={`${metric.percentage}% complete`}><span style={{ width: `${metric.percentage}%` }} /></div>
  </article>;
}

export default function DashboardPage({ onNavigate }) {
  const today = londonDateKey();
  const todayWeekday = londonWeekday(new Date());
  const [overview, setOverview] = useState(null);
  const [totals, setTotals] = useState(null);
  const [period, setPeriod] = useState("today");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [schedule, setSchedule] = useState(blankSchedule);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [override, setOverride] = useState({ ...DEFAULT_DAILY_TARGETS });
  const [overrideDate, setOverrideDate] = useState(today);
  const [accessKey, setAccessKey] = useState("");
  const [locked, setLocked] = useState(!getStoredMarketingAccessKey());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function periodRange(nextPeriod = period) {
    if (nextPeriod === "seven") return { start: addDays(today, -6), end: today };
    if (nextPeriod === "thirty") return { start: addDays(today, -29), end: today };
    if (nextPeriod === "search") return { start: customStart, end: customEnd };
    return { start: today, end: today };
  }

  async function loadTotals(nextPeriod = period) {
    const range = periodRange(nextPeriod);
    setTotals(await getDailyOperationsTotals(range.start, range.end));
  }

  async function load() {
    setBusy(true); setError("");
    try {
      const result = await getDailyOperationsOverview(today);
      setOverview(result);
      setSchedule((result.schedule || []).length === 7 ? result.schedule.map((row) => ({ ...row })) : blankSchedule());
      setOverride(result.override ? { ...result.override } : { ...result.day.targets });
      setLocked(false);
      await loadTotals("today");
    } catch (caught) {
      if (caught?.status === 401) setLocked(true);
      else setError(caught.message || "Could not load today's content operations.");
    } finally { setBusy(false); }
  }

  useEffect(() => { if (!locked) load(); }, []);

  async function unlock(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await validateMarketingAccessKey(accessKey); saveMarketingAccessKey(accessKey); setLocked(false); await load(); }
    catch (caught) { setError(caught.message || "Access key not recognised."); }
    finally { setBusy(false); }
  }

  async function run(action, success) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); setOverview(await getDailyOperationsOverview(today)); await loadTotals(period); setMessage(success); }
    catch (caught) { setError(caught.message || "Content Operations update failed."); }
    finally { setBusy(false); }
  }

  async function selectPeriod(nextPeriod) {
    setPeriod(nextPeriod); setBusy(true); setError("");
    try { await loadTotals(nextPeriod); } catch (caught) { setError(caught.message || "Could not load totals."); }
    finally { setBusy(false); }
  }

  const metrics = useMemo(() => DAILY_ACTIVITY_TYPES.map((type) => overview?.day?.metrics?.[type]).filter(Boolean), [overview]);

  if (locked) return <div className="page-stack"><section className="hero-panel"><div><div className="eyebrow">Content Operations</div><h2>Unlock today&apos;s marketing plan</h2><p>Use the same access key as the Customer Database.</p></div></section><section className="panel"><form className="field-grid" onSubmit={unlock}><label className="field"><span className="field__label">Access key</span><input className="field__input" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} /></label><div className="card-actions" style={{ alignSelf: "end" }}><button className="button button--primary" disabled={busy}>UNLOCK</button></div></form>{error ? <div className="notice notice--error">{error}</div> : null}</section></div>;

  return <div className="page-stack content-operations-page">
    <section className={`operations-summary${overview?.day?.complete ? " is-complete" : ""}`}>
      <div><div className="eyebrow">TODAY · UK TIME</div><h2>{overview?.day?.off_day ? "No target today" : overview?.day?.complete ? "Today’s target is complete" : "What you need to do today"}</h2><p>{overview?.day?.off_day ? "This is set as an off day." : `${overview?.day?.remaining_total || 0} remaining across today’s marketing activity.`}</p></div>
      <div className="operations-summary__score"><strong>{overview?.day?.completion_percentage || 0}%</strong><span>complete</span></div>
    </section>
    {error ? <div className="notice notice--error">{error}</div> : null}{message ? <div className="notice notice--success">{message}</div> : null}
    <section className="operations-activity-grid">{metrics.map((metric) => <ActivityCard key={metric.type} metric={metric} />)}</section>
    <AIVisibilityWidget onOpen={() => onNavigate?.("AI Visibility")} />

    <details className="operations-drawer">
      <summary>VIEW TOTALS AND HISTORY</summary>
      <div className="operations-drawer__body">
        <div className="operations-period-tabs">{[["today", "Today"], ["seven", "7 Days"], ["thirty", "30 Days"], ["search", "Search"]].map(([id, label]) => <button className={period === id ? "is-active" : ""} type="button" key={id} onClick={() => selectPeriod(id)}>{label}</button>)}</div>
        {period === "search" ? <div className="field-grid operations-search"><label className="field"><span className="field__label">From</span><input className="field__input" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label className="field"><span className="field__label">To</span><input className="field__input" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label><button className="button button--primary" type="button" onClick={() => selectPeriod("search")}>SEARCH</button></div> : null}
        {totals ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Activity</th><th>Done</th><th>Target</th><th>Shortfall</th><th>Daily average</th><th>Complete</th></tr></thead><tbody>{DAILY_ACTIVITY_TYPES.map((type) => <tr key={type}><td>{ACTIVITY_LABELS[type]}</td><td>{totals.totals[type].completed}</td><td>{totals.totals[type].target}</td><td>{totals.totals[type].shortfall}</td><td>{totals.totals[type].daily_average}</td><td>{totals.totals[type].completion_percentage}%</td></tr>)}</tbody></table></div> : null}
      </div>
    </details>

    <details className="operations-drawer">
      <summary>EDIT DAILY TARGETS</summary>
      <div className="operations-drawer__body">
        <div className="field-grid"><label className="field"><span className="field__label">Targets effective from</span><input className="field__input" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label></div>
        <div className="weekday-targets">{schedule.map((day, index) => <details key={WEEKDAYS[index]} open={index === todayWeekday}><summary>{WEEKDAYS[index]}{day.off_day ? " · Off day" : ""}</summary><TargetFields value={day} onChange={(next) => setSchedule((rows) => rows.map((row, rowIndex) => rowIndex === index ? next : row))} /></details>)}</div>
        <div className="card-actions"><button className="button button--primary" type="button" disabled={busy} onClick={() => run(() => saveDailyTargetSchedule(effectiveFrom, schedule), "Weekday targets saved.")}>SAVE TARGETS</button><button className="button button--ghost" type="button" disabled={busy} onClick={() => { const defaults = blankSchedule(); setSchedule(defaults); run(() => resetDailyTargetDefaults(effectiveFrom), "Default targets restored."); }}>RESET DEFAULTS</button></div>
        <hr className="operations-divider" />
        <h3>One-day override</h3><div className="field-grid"><label className="field"><span className="field__label">Date</span><input className="field__input" type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} /></label></div><TargetFields value={override} onChange={setOverride} /><button className="button button--primary" type="button" disabled={busy} onClick={() => run(() => saveDailyTargetOverride(overrideDate, override), "One-day override saved.")}>SAVE ONE-DAY OVERRIDE</button>
      </div>
    </details>
  </div>;
}
