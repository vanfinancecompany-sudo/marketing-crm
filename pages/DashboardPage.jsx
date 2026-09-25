import { useEffect, useMemo, useState } from "react";
import {
  ACTIVITY_LABELS,
  DAILY_ACTIVITY_TYPES,
  DEFAULT_DAILY_TARGETS,
  londonDateKey,
  londonWeekday,
} from "../lib/marketingDailyOperations.js";
import {
  DAILY_OPERATIONS_REFRESH_EVENT,
  getDailyOperationsOverview,
  getDailyOperationsTotals,
  resetDailyTargetDefaults,
  saveDailyTargetOverride,
  saveDailyTargetSchedule,
} from "../services/marketingDailyOperations.js";
import {
  buildMarketingAccessHeaders,
  getStoredMarketingAccessKey,
  saveMarketingAccessKey,
  validateMarketingAccessKey,
} from "../services/marketingAccess.js";
import AIVisibilityWidget from "../components/AIVisibilityWidget.jsx";
import Ga4PipelinePanel from "../components/Ga4PipelinePanel.jsx";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const ACTIVITY_UNITS = {
  van_finance_facebook_post: "posted",
  rent2buy_facebook_post: "posted",
  van_finance_groups_post: "posted",
  rent2buy_groups_post: "posted",
  van_finance_marketplace_post: "advertised",
  rent2buy_marketplace_post: "advertised",
  van_finance_reel: "generated",
  rent2buy_reel: "generated",
  emails_sent: "sent",
  knowledge_hub_article: "sent to Wix",
};

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount, 12))
    .toISOString()
    .slice(0, 10);
}

function blankSchedule() {
  return Array.from({ length: 7 }, () => ({ ...DEFAULT_DAILY_TARGETS }));
}

function TargetFields({ value, onChange }) {
  return (
    <div className="operations-target-fields">
      {DAILY_ACTIVITY_TYPES.map((type) => (
        <label className="field" key={type}>
          <span className="field__label">{ACTIVITY_LABELS[type]}</span>
          <input
            className="field__input"
            type="number"
            min="0"
            max="10000"
            value={value[type]}
            disabled={value.off_day}
            onChange={(event) =>
              onChange({
                ...value,
                [type]: Math.max(0, Number(event.target.value || 0)),
              })
            }
          />
        </label>
      ))}
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={Boolean(value.off_day)}
          onChange={(event) =>
            onChange({ ...value, off_day: event.target.checked })
          }
        />
        Off day — no target
      </label>
    </div>
  );
}

const ACTIVITY_NAVIGATION = {
  van_finance_groups_post: "Van Finance Groups & Classifieds",
  rent2buy_groups_post: "Rent2Buy Facebook Groups",
  van_finance_marketplace_post: "Van Finance Marketplace",
  rent2buy_marketplace_post: "Rent2Buy Marketplace",
};

function ActivityCard({ metric, onOpen }) {
  const linked = Boolean(onOpen);
  return (
    <article
      className={`operations-activity-card${metric.remaining === 0 ? " is-complete" : ""}${linked ? " is-linked" : ""}`}
      role={linked ? "button" : undefined}
      tabIndex={linked ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={linked ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      } : undefined}
    >
      <div className="operations-activity-card__heading">
        <span>{ACTIVITY_LABELS[metric.type]}</span>
        <b>
          {metric.remaining === 0 ? "COMPLETE" : `${metric.remaining} LEFT`}
        </b>
      </div>
      <div className="operations-activity-card__numbers">
        <strong>{metric.completed}</strong>
        <span>{ACTIVITY_UNITS[metric.type]}</span>
        <em>Target {metric.target}</em>
      </div>
      <div
        className="operations-progress"
        aria-label={`${metric.percentage}% complete`}
      >
        <span style={{ width: `${metric.percentage}%` }} />
      </div>
    </article>
  );
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
  const [vanscoPreview, setVanscoPreview] = useState(null);
  const [vanscoPreviewBusy, setVanscoPreviewBusy] = useState(false);
  const [vanscoPreviewError, setVanscoPreviewError] = useState("");
  const [vanscoBuffer, setVanscoBuffer] = useState(null);
  const [vanscoBufferBusy, setVanscoBufferBusy] = useState(false);
  const [vanscoBufferError, setVanscoBufferError] = useState("");
  const [vanscoStatus, setVanscoStatus] = useState(null);
  const [vanscoStatusBusy, setVanscoStatusBusy] = useState(false);
  const [vanscoStatusError, setVanscoStatusError] = useState("");

  function periodRange(nextPeriod = period) {
    if (nextPeriod === "seven")
      return { start: addDays(today, -6), end: today };
    if (nextPeriod === "thirty")
      return { start: addDays(today, -29), end: today };
    if (nextPeriod === "search") return { start: customStart, end: customEnd };
    return { start: today, end: today };
  }

  async function loadTotals(nextPeriod = period) {
    const range = periodRange(nextPeriod);
    setTotals(await getDailyOperationsTotals(range.start, range.end));
  }

  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await getDailyOperationsOverview(today);
      setOverview(result);
      setSchedule(
        (result.schedule || []).length === 7
          ? result.schedule.map((row) => ({ ...row }))
          : blankSchedule(),
      );
      setOverride(
        result.override ? { ...result.override } : { ...result.day.targets },
      );
      setLocked(false);
      await loadTotals("today");
      await loadVanscoStatus();
    } catch (caught) {
      if (caught?.status === 401) setLocked(true);
      else
        setError(
          caught.message || "Could not load today's content operations.",
        );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!locked) load();
    const refresh = () => {
      if (!locked) load();
    };
    window.addEventListener(DAILY_OPERATIONS_REFRESH_EVENT, refresh);
    return () =>
      window.removeEventListener(DAILY_OPERATIONS_REFRESH_EVENT, refresh);
  }, [locked]);

  async function unlock(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await validateMarketingAccessKey(accessKey);
      saveMarketingAccessKey(accessKey);
      setLocked(false);
      await load();
    } catch (caught) {
      setError(caught.message || "Access key not recognised.");
    } finally {
      setBusy(false);
    }
  }

  async function run(action, success) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setOverview(await getDailyOperationsOverview(today));
      await loadTotals(period);
      setMessage(success);
    } catch (caught) {
      setError(caught.message || "Content Operations update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function selectPeriod(nextPeriod) {
    setPeriod(nextPeriod);
    setBusy(true);
    setError("");
    try {
      await loadTotals(nextPeriod);
    } catch (caught) {
      setError(caught.message || "Could not load totals.");
    } finally {
      setBusy(false);
    }
  }

  async function loadVanscoStatus() {
    setVanscoStatusBusy(true);
    setVanscoStatusError("");
    try {
      const result = await fetch("/api/vansco-facebook-automation-status", {
        method: "GET",
        headers: buildMarketingAccessHeaders(),
        cache: "no-store",
      });
      const payload = await result.json();
      if (!result.ok || !payload.ok) throw new Error(payload.error || "Could not load Vansco Facebook status.");
      setVanscoStatus(payload);
    } catch (caught) {
      setVanscoStatusError(caught?.message || "Could not load Vansco Facebook status.");
    } finally {
      setVanscoStatusBusy(false);
    }
  }

  async function previewVanscoFacebook() {
    setVanscoPreviewBusy(true);
    setVanscoPreviewError("");
    try {
      const result = await fetch("/api/vansco-facebook-automation-worker?dryRun=true", {
        method: "GET",
        headers: buildMarketingAccessHeaders(),
        cache: "no-store",
      });
      const payload = await result.json();
      if (!result.ok || !payload.ok) throw new Error(payload.error || "Could not build Vansco Facebook previews.");
      setVanscoPreview(payload);
    } catch (caught) {
      setVanscoPreviewError(caught?.message || "Could not build Vansco Facebook previews.");
    } finally {
      setVanscoPreviewBusy(false);
    }
  }

  async function verifyVanscoBuffer() {
    setVanscoBufferBusy(true);
    setVanscoBufferError("");
    try {
      const result = await fetch("/api/vansco-buffer-setup", {
        method: "GET",
        headers: buildMarketingAccessHeaders(),
        cache: "no-store",
      });
      const payload = await result.json();
      if (!result.ok || !payload.ok) throw new Error(payload.error || "Could not verify Vansco Buffer.");
      setVanscoBuffer(payload);
    } catch (caught) {
      setVanscoBufferError(caught?.message || "Could not verify Vansco Buffer.");
    } finally {
      setVanscoBufferBusy(false);
    }
  }

  const metrics = useMemo(
    () =>
      DAILY_ACTIVITY_TYPES.map((type) => overview?.day?.metrics?.[type]).filter(
        Boolean,
      ),
    [overview],
  );

  if (locked)
    return (
      <div className="page-stack">
        <section className="hero-panel">
          <div>
            <div className="eyebrow">Content Operations</div>
            <h2>Unlock today&apos;s marketing plan</h2>
            <p>Use the same access key as the Customer Database.</p>
          </div>
        </section>
        <section className="panel">
          <form className="field-grid" onSubmit={unlock}>
            <label className="field">
              <span className="field__label">Access key</span>
              <input
                className="field__input"
                type="password"
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
              />
            </label>
            <div className="card-actions" style={{ alignSelf: "end" }}>
              <button className="button button--primary" disabled={busy}>
                UNLOCK
              </button>
            </div>
          </form>
          {error ? <div className="notice notice--error">{error}</div> : null}
        </section>
      </div>
    );

  return (
    <div className="page-stack content-operations-page">
      <section
        className={`operations-summary${overview?.day?.complete ? " is-complete" : ""}`}
      >
        <div>
          <div className="eyebrow">TODAY · UK TIME</div>
          <h2>
            {overview?.day?.off_day
              ? "No target today"
              : overview?.day?.complete
                ? "Today’s target is complete"
                : "What you need to do today"}
          </h2>
          <p>
            {overview?.day?.off_day
              ? "This is set as an off day."
              : `${overview?.day?.remaining_total || 0} remaining across today’s marketing activity.`}
          </p>
        </div>
        <div className="operations-summary__score">
          <strong>{overview?.day?.completion_percentage || 0}%</strong>
          <span>complete</span>
        </div>
      </section>
      {error ? <div className="notice notice--error">{error}</div> : null}
      {message ? <div className="notice notice--success">{message}</div> : null}
      <section className="operations-activity-grid">
        {metrics.map((metric) => {
          const destination = ACTIVITY_NAVIGATION[metric.type];
          return (
            <ActivityCard
              key={metric.type}
              metric={metric}
              onOpen={destination ? () => onNavigate?.(destination) : undefined}
            />
          );
        })}
      </section>
      <AIVisibilityWidget onOpen={() => onNavigate?.("AI Visibility")} />
      <Ga4PipelinePanel />

      <section className="panel">
        <div className="eyebrow">VANSCO · FACEBOOK STOCK AUTOMATION</div>
        <h3>DealerKit → branch-specific Facebook posts → Buffer</h3>
        <p>
          DealerKit Meta catalogue is the retail stock source. Branch-specific copy is created only when the vehicle location can be resolved safely, then queued to the dedicated Vansco Limited Buffer channel.
        </p>
        <div className="notice" style={{ marginBottom: 12 }}>
          <strong>Posting flow:</strong> DealerKit retail stock to branch match to post builder to Buffer to Vansco Limited Facebook.
        </div>
        <div className="card-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={vanscoPreviewBusy}
            onClick={previewVanscoFacebook}
          >
            {vanscoPreviewBusy ? "BUILDING PREVIEW…" : "PREVIEW 5 VANSCO POSTS"}
          </button>
          <button
            className="button button--ghost"
            type="button"
            disabled={vanscoBufferBusy}
            onClick={verifyVanscoBuffer}
          >
            {vanscoBufferBusy ? "VERIFYING…" : "VERIFY VANSCO BUFFER"}
          </button>
        </div>
        {vanscoPreviewError ? <div className="notice notice--error">{vanscoPreviewError}</div> : null}
        {vanscoBufferError ? <div className="notice notice--error">{vanscoBufferError}</div> : null}
        {vanscoBuffer ? (
          <>
            <div className={`notice ${vanscoBuffer.connected ? "notice--success" : ""}`}>
              {vanscoBuffer.connected
                ? `${vanscoBuffer.channelName} connected · daily network limit ${vanscoBuffer.dailyPostingLimit ?? "not reported"} · queue limit ${vanscoBuffer.scheduledPostsLimit}`
                : vanscoBuffer.message}
            </div>
            {!vanscoBuffer.connected && vanscoBuffer.accessibleOrganizations?.length ? (
              <div style={{ marginTop: 12 }}>
                {vanscoBuffer.accessibleOrganizations.map((organization, index) => (
                  <details className="operations-drawer" key={`${organization.organizationName}-${index}`}>
                    <summary>
                      Buffer workspace: {organization.organizationName || "(unnamed)"} · queue limit {organization.scheduledPostsLimit ?? "not reported"}
                    </summary>
                    <div className="operations-drawer__body">
                      {(organization.channels || []).length ? (
                        <ul>
                          {organization.channels.map((channel, channelIndex) => (
                            <li key={`${channel.name}-${channelIndex}`}>
                              {channel.name || "(unnamed channel)"} · {channel.service || "unknown service"}
                              {channel.isDisconnected ? " · disconnected" : ""}
                              {channel.isLocked ? " · locked" : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No channels visible to this Buffer token.</p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        {vanscoPreview ? (
          <div style={{ marginTop: 16 }}>
            <p>
              <strong>{vanscoPreview.eligibleVehicleCount}</strong> eligible of{" "}
              <strong>{vanscoPreview.metaVehicleCount}</strong> DealerKit Meta vehicles.
            </p>
            {(vanscoPreview.preview || []).map((item, index) => (
              <details className="operations-drawer" key={item.vehicleKey || item.vehicleUrl || index}>
                <summary>
                  {index + 1}. {item.title} · {item.branchKey || "branch unresolved"}
                </summary>
                <div className="operations-drawer__body">
                  <p>
                    <strong>Branch:</strong> {item.branchKey} ({item.branchSource})<br />
                    <strong>Price:</strong> {item.price} {item.vatLabel}<br />
                    <strong>Vehicle:</strong> {item.vehicleUrl}
                  </p>
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      style={{ width: "100%", maxWidth: 520, borderRadius: 12 }}
                    />
                  ) : null}
                  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 12 }}>
                    {item.caption}
                  </pre>
                </div>
              </details>
            ))}
            {vanscoPreview.held?.length ? (
              <div className="notice notice--warning">
                {vanscoPreview.held.length} candidate(s) were held because the branch could not be resolved safely.
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <details className="operations-drawer">
        <summary>VIEW TOTALS AND HISTORY</summary>
        <div className="operations-drawer__body">
          <div className="operations-period-tabs">
            {[
              ["today", "Today"],
              ["seven", "7 Days"],
              ["thirty", "30 Days"],
              ["search", "Search"],
            ].map(([id, label]) => (
              <button
                className={period === id ? "is-active" : ""}
                type="button"
                key={id}
                onClick={() => selectPeriod(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {period === "search" ? (
            <div className="field-grid operations-search">
              <label className="field">
                <span className="field__label">From</span>
                <input
                  className="field__input"
                  type="date"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">To</span>
                <input
                  className="field__input"
                  type="date"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                />
              </label>
              <button
                className="button button--primary"
                type="button"
                onClick={() => selectPeriod("search")}
              >
                SEARCH
              </button>
            </div>
          ) : null}
          {totals ? (
            <div className="operations-table-wrap">
              <table className="operations-table">
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Done</th>
                    <th>Target</th>
                    <th>Shortfall</th>
                    <th>Daily average</th>
                    <th>Complete</th>
                  </tr>
                </thead>
                <tbody>
                  {DAILY_ACTIVITY_TYPES.map((type) => (
                    <tr key={type}>
                      <td>{ACTIVITY_LABELS[type]}</td>
                      <td>{totals.totals[type].completed}</td>
                      <td>{totals.totals[type].target}</td>
                      <td>{totals.totals[type].shortfall}</td>
                      <td>{totals.totals[type].daily_average}</td>
                      <td>{totals.totals[type].completion_percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </details>

      <details className="operations-drawer">
        <summary>EDIT DAILY TARGETS</summary>
        <div className="operations-drawer__body">
          <div className="field-grid">
            <label className="field">
              <span className="field__label">Targets effective from</span>
              <input
                className="field__input"
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </label>
          </div>
          <div className="weekday-targets">
            {schedule.map((day, index) => (
              <details key={WEEKDAYS[index]} open={index === todayWeekday}>
                <summary>
                  {WEEKDAYS[index]}
                  {day.off_day ? " · Off day" : ""}
                </summary>
                <TargetFields
                  value={day}
                  onChange={(next) =>
                    setSchedule((rows) =>
                      rows.map((row, rowIndex) =>
                        rowIndex === index ? next : row,
                      ),
                    )
                  }
                />
              </details>
            ))}
          </div>
          <div className="card-actions">
            <button
              className="button button--primary"
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () => saveDailyTargetSchedule(effectiveFrom, schedule),
                  "Weekday targets saved.",
                )
              }
            >
              SAVE TARGETS
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                const defaults = blankSchedule();
                setSchedule(defaults);
                run(
                  () => resetDailyTargetDefaults(effectiveFrom),
                  "Default targets restored.",
                );
              }}
            >
              RESET DEFAULTS
            </button>
          </div>
          <hr className="operations-divider" />
          <h3>One-day override</h3>
          <div className="field-grid">
            <label className="field">
              <span className="field__label">Date</span>
              <input
                className="field__input"
                type="date"
                value={overrideDate}
                onChange={(event) => setOverrideDate(event.target.value)}
              />
            </label>
          </div>
          <TargetFields value={override} onChange={setOverride} />
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => saveDailyTargetOverride(overrideDate, override),
                "One-day override saved.",
              )
            }
          >
            SAVE ONE-DAY OVERRIDE
          </button>
        </div>
      </details>
    </div>
  );
}
