import { useEffect, useMemo, useState } from "react";
import { ACTIVITY_LABELS, DAILY_ACTIVITY_TYPES, DEFAULT_DAILY_TARGETS, londonDateKey, londonWeekday } from "../lib/marketingDailyOperations.js";
import {
  getDailyOperationsOverview,
  recordDailyMarketingActivity,
  resetDailyTargetDefaults,
  saveDailyTargetOverride,
  saveDailyTargetSchedule,
  undoDailyMarketingActivity,
} from "../services/marketingDailyOperations.js";
import { getStoredMarketingAccessKey, saveMarketingAccessKey, validateMarketingAccessKey } from "../services/marketingAccess.js";
import StatCard from "../components/StatCard.jsx";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ACTIONS = {
  van_finance_facebook_post: { label: "POST VAN FINANCE NOW", view: "Van Finance Facebook" },
  rent2buy_facebook_post: { label: "POST RENT2BUY NOW", view: "Rent2Buy Facebook" },
  van_finance_reel: { label: "CREATE VAN FINANCE REELS", view: "Reel Factory" },
  rent2buy_reel: { label: "CREATE RENT2BUY REELS", view: "Reel Factory" },
  emails_sent: { label: "SEND NEXT EMAIL BATCH", href: "/campaigns/" },
};

function getCreativeActivityLabel(creative) {
  if (creative.status === "draft") return "Reel created";
  if (creative.status === "ready_to_post") return "Reel saved";
  return "Reel asset";
}

function blankSchedule() {
  return Array.from({ length: 7 }, () => ({ ...DEFAULT_DAILY_TARGETS }));
}

function TargetFields({ value, onChange, compact = false }) {
  return <div className="daily-target-fields">
    {DAILY_ACTIVITY_TYPES.map((type) => <label className="field" key={type}>
      <span className="field__label">{ACTIVITY_LABELS[type]}</span>
      <input className="field__input" type="number" min="0" max="10000" value={value[type]} disabled={value.off_day} onChange={(event) => onChange({ ...value, [type]: Math.max(0, Number(event.target.value || 0)) })} />
    </label>)}
    {!compact ? <label className="toggle-row"><input type="checkbox" checked={Boolean(value.off_day)} onChange={(event) => onChange({ ...value, off_day: event.target.checked })} />Off day â€” no target</label> : null}
  </div>;
}

function MetricCard({ metric, onNavigate, onRecord, onUndo, busy }) {
  const action = ACTIONS[metric.type];
  return <article className={`daily-command-card${metric.remaining === 0 ? " is-complete" : ""}`}>
    <div className="daily-command-card__top"><span>{ACTIVITY_LABELS[metric.type]}</span><strong>{metric.completed} / {metric.target}</strong></div>
    <div className="daily-progress"><span style={{ width: `${metric.percentage}%` }} /></div>
    <div className="daily-command-card__message">{metric.remaining > 0 ? `${metric.remaining} REMAINING TODAY` : "TARGET COMPLETE"}</div>
    <div className="card-actions">
      {action.href ? <a className="button button--primary" href={action.href}>{action.label}</a> : <button className="button button--primary" type="button" onClick={() => onNavigate(action.view)}>{action.label}</button>}
      {metric.type.includes("reel") ? <>
        <button className="button button--ghost" type="button" disabled={busy} onClick={() => onRecord(metric.type)}>MARK ONE POSTED</button>
        <button className="button button--ghost" type="button" disabled={busy || metric.completed < 1} onClick={() => onUndo(metric.type)}>UNDO LAST</button>
      </> : null}
    </div>
  </article>;
}

export default function DashboardPage({ onNavigate, stats = {}, recentCreatives = [], topReels = [] }) {
  const today = londonDateKey();
  const todayWeekday = londonWeekday(new Date());
  const [overview, setOverview] = useState(null);
  const [schedule, setSchedule] = useState(blankSchedule);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [override, setOverride] = useState({ ...DEFAULT_DAILY_TARGETS });
  const [overrideDate, setOverrideDate] = useState(today);
  const [accessKey, setAccessKey] = useState("");
  const [locked, setLocked] = useState(!getStoredMarketingAccessKey());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setError("");
    try {
      const result = await getDailyOperationsOverview(today);
      setOverview(result);
      setSchedule((result.schedule || []).length === 7 ? result.schedule.map((row) => ({ ...row })) : blankSchedule());
      setOverride(result.override ? { ...result.override } : { ...result.day.targets });
      setLocked(false);
    } catch (caught) {
      if (caught?.status === 401) setLocked(true);
      else setError(caught.message || "Could not load today's command centre.");
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
    try { await action(); setOverview(await getDailyOperationsOverview(today)); setMessage(success); }
    catch (caught) { setError(caught.message || "Daily command centre update failed."); }
    finally { setBusy(false); }
  }

  const metrics = useMemo(() => DAILY_ACTIVITY_TYPES.map((type) => overview?.day?.metrics?.[type]).filter(Boolean), [overview]);
  if (locked) return <div className="page-stack"><section className="hero-panel"><div><div className="eyebrow">Daily Marketing Command Centre</div><h2>Unlock today&apos;s targets</h2><p>Use the same access key as the Customer Database.</p></div></section><section className="panel"><form className="field-grid" onSubmit={unlock}><label className="field"><span className="field__label">Access key</span><input className="field__input" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} /></label><div className="card-actions" style={{ alignSelf: "end" }}><button className="button button--primary" disabled={busy}>UNLOCK COMMAND CENTRE</button></div></form>{error ? <div className="notice notice--error">{error}</div> : null}</section></div>;

  return <div className="page-stack daily-command-centre">
    <section className={`hero-panel daily-command-hero${overview?.day?.complete ? " is-complete" : ""}`}>
      <div><div className="eyebrow">TODAY&apos;S REQUIRED ACTIONS Â· UK TIME</div><h2>{overview?.day?.off_day ? "TODAY IS AN OFF DAY" : overview?.day?.complete ? "DAILY TARGET COMPLETE" : "DO NOT STOP YET"}</h2><p>{overview?.day?.off_day ? "No marketing target is scheduled today." : overview?.day?.complete ? "All Facebook posts, reels and email targets have been completed." : `You still have ${overview?.day?.remaining_total || 0} actions remaining today.`}</p></div>
      <div className="daily-score"><strong>{overview?.day?.completion_percentage || 0}%</strong><span>complete</span><a className="button button--ghost" href="/marketing-totals">OPEN TOTALS</a></div>
    </section>
    {error ? <div className="notice notice--error">{error}</div> : null}{message ? <div className="notice notice--success">{message}</div> : null}
    <section className="daily-command-grid">{metrics.map((metric) => <MetricCard key={metric.type} metric={metric} busy={busy} onNavigate={onNavigate} onRecord={(type) => run(() => recordDailyMarketingActivity(type, { activityDate: today }), "Reel marked posted.")} onUndo={(type) => run(() => undoDailyMarketingActivity(type, today), "Last manual reel mark removed.")} />)}</section>
    <section className="panel"><div className="panel__header"><div><h3>Daily target settings</h3><p>Changes are effective-dated, so earlier performance is never rewritten.</p></div></div>
      <div className="field-grid"><label className="field"><span className="field__label">New targets effective from</span><input className="field__input" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label></div>
      <div className="weekday-targets">{schedule.map((day, index) => <details key={WEEKDAYS[index]} open={index === todayWeekday}><summary>{WEEKDAYS[index]}{day.off_day ? " Â· Off day" : ""}</summary><TargetFields value={day} onChange={(next) => setSchedule((rows) => rows.map((row, rowIndex) => rowIndex === index ? next : row))} /></details>)}</div>
      <div className="card-actions"><button className="button button--primary" type="button" disabled={busy} onClick={() => run(() => saveDailyTargetSchedule(effectiveFrom, schedule), "New weekday targets saved.")}>SAVE WEEKDAY TARGETS</button><button className="button button--ghost" type="button" disabled={busy} onClick={() => { const defaults = blankSchedule(); setSchedule(defaults); run(() => resetDailyTargetDefaults(effectiveFrom), "Default targets restored from the effective date."); }}>RESET 10 / 10 / 10 / 10 / 200</button></div>
    </section>
    <section className="panel"><div className="panel__header"><div><h3>One-day override</h3><p>Set a temporary quota or off day without changing the standard weekly schedule.</p></div></div><div className="field-grid"><label className="field"><span className="field__label">Override date</span><input className="field__input" type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} /></label></div><TargetFields value={override} onChange={setOverride} /><button className="button button--primary" type="button" disabled={busy} onClick={() => run(() => saveDailyTargetOverride(overrideDate, override), "One-day target override saved.")}>SAVE ONE-DAY OVERRIDE</button></section>
    <section className="stats-grid" aria-label="Existing content activity">
      <StatCard label="Reel assets created today" value={stats.createdToday || 0} tone="blue" />
      <StatCard label="Stock posts waiting" value={stats.readyToPost || 0} tone="amber" />
      <StatCard label="Stock posts marked posted today" value={stats.postedToday || 0} tone="green" />
      <StatCard label="Finance clicks last 7 days" value={stats.financeClicksToday || 0} tone="blue" />
      <StatCard label="Rent2Buy clicks last 7 days" value={stats.rent2BuyClicksToday || 0} tone="green" />
    </section>
    <section className="panel"><div className="panel__header"><div><h3>Top Performing Reels</h3><p>Tracked reel links ranked by click count across the last 7 days.</p></div></div>{topReels.length === 0 ? <div className="empty-state">No tracked reel clicks yet.</div> : <div className="simple-list">{topReels.map((reel) => <div key={`${reel.type}-${reel.reelId}`} className="simple-list__item"><div><strong>{reel.label || reel.reelId || "Untitled reel"}</strong><div>{reel.type === "rent2buy" ? "Rent2Buy" : "Van Finance"}</div></div><div className="status-pill">{reel.clickCount} clicks</div></div>)}</div>}</section>
    <section className="panel"><div className="panel__header"><div><h3>Recent Reel Activity</h3><p>Fresh reel assets from the existing Reel Studio workflow.</p></div></div>{recentCreatives.length === 0 ? <div className="empty-state">No reel assets generated yet.</div> : <div className="simple-list">{recentCreatives.map((creative) => <div key={creative.id} className="simple-list__item"><div><strong>{creative.vehicle.name}</strong><div>{creative.templateType} | {creative.hookStyle}</div></div><div className="status-pill">{getCreativeActivityLabel(creative)}</div></div>)}</div>}</section>
  </div>;
}

