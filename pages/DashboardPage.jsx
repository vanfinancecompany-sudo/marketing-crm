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
  getVanscoEmailToday,
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
import { groupContentOperationsMetrics } from "../lib/contentOperationsBrandGroups.js";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const VANSCO_FACEBOOK_DAILY_TARGET = 30;
const FACEBOOK_STORY_DAILY_MAX = 3;
const INSTAGRAM_STORY_DAILY_MAX = 3;
const VANSCO_FACEBOOK_STORY_DAILY_TARGET = 5;
const VANSCO_GOOGLE_BUSINESS_DAILY_TARGET = 10;

const ACTIVITY_UNITS = {
  van_finance_facebook_post: "posted",
  van_finance_facebook_story: "posted",
  van_finance_instagram_post: "posted",
  van_finance_instagram_story: "posted",
  van_finance_instagram_reel: "published",
  rent2buy_facebook_story: "posted",
  vansco_facebook_post: "posted",
  vansco_instagram_post: "posted",
  vansco_facebook_story: "posted",
  vansco_333_google_business_post: "posted",
  vansco_airport_google_business_post: "posted",
  vansco_new_forest_google_business_post: "posted",
  rent2buy_facebook_post: "posted",
  van_finance_google_business_post: "posted",
  rent2buy_google_business_post: "posted",
  van_finance_groups_post: "posted",
  rent2buy_groups_post: "posted",
  van_finance_marketplace_post: "advertised",
  rent2buy_marketplace_post: "advertised",
  van_finance_reel: "generated",
  rent2buy_reel: "generated",
  emails_sent: "sent",
  vansco_emails_sent: "sent",
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

// Publishing is finished at 21:00 UK, but the final Buffer reconciliation
// runs at about 23:05 UK. Do not mistake an evening refill for today's result.
function londonMinutesAt(value) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function londonTimeLabel(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function vanscoDayProgress({ completed, target, confirmed, checkedAt, now = new Date() }) {
  const minutes = londonMinutesAt(now);
  const check = checkedAt ? new Date(checkedAt) : null;
  const finalChecked = Boolean(
    confirmed && check && Number.isFinite(check.getTime())
    && londonDateKey(check) === londonDateKey(now)
    && londonMinutesAt(check) >= (23 * 60 + 5),
  );
  const shortBy = Math.max(0, target - completed);
  if (minutes < (21 * 60)) {
    return {
      label: shortBy === 0 ? "TARGET MET" : shortBy + " LEFT",
      detail: "Publishing 08:00–21:00 UK",
    };
  }
  if (finalChecked) {
    return {
      label: shortBy === 0 ? "DAY COMPLETE" : "DAY SHORT",
      detail: "Final Buffer check " + londonTimeLabel(check) + " UK"
        + (shortBy ? " · short by " + shortBy : ""),
    };
  }
  if (minutes >= (23 * 60 + 5)) {
    return {
      label: "FINAL CHECK PENDING",
      detail: "Publishing ended 21:00 UK · waiting for Buffer confirmation",
    };
  }
  return {
    label: shortBy === 0 ? "TARGET MET" : "POSTING FINISHED",
    detail: "Publishing ended 21:00 UK · final Buffer check due 23:05",
  };
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
  const isVansco = String(metric.type || "").startsWith("vansco_");
  const trackingOnly = metric.type === "vansco_emails_sent" && Number(metric.target || 0) === 0;
  const label = metric.label
    || (metric.type === "vansco_facebook_post" ? "Vansco Facebook posts" : ACTIVITY_LABELS[metric.type])
    || metric.type;
  const statusLabel = metric.statusLabel
    || (trackingOnly ? "SENT TODAY" : metric.remaining === 0 ? "COMPLETE" : `${metric.remaining} LEFT`);
  const completedLabel = metric.displayCompleted ?? metric.completed;
  return (
    <article
      className={`operations-activity-card${metric.remaining === 0 && !trackingOnly ? " is-complete" : ""}${linked ? " is-linked" : ""}${isVansco ? " is-vansco" : ""}`}
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
        <span>{label}</span>
        <b>{statusLabel}</b>
      </div>
      <div className="operations-activity-card__numbers">
        <strong>{completedLabel}</strong>
        <span>{ACTIVITY_UNITS[metric.type] || "posted"}</span>
        <em>{trackingOnly ? "Production sends · no daily target" : `Target ${metric.target}`}</em>
      </div>
      {!trackingOnly ? (
        <div
          className="operations-progress"
          aria-label={`${metric.percentage}% complete`}
        >
          <span style={{ width: `${metric.percentage}%` }} />
        </div>
      ) : null}
      {metric.statusDetail ? (
        <small style={{ marginTop: 7, color: "#52657f", fontSize: 11, lineHeight: 1.35 }}>
          {metric.statusDetail}
        </small>
      ) : null}
    </article>
  );
}


// This is an inventory snapshot, not a daily posting target or an estimate
// of Merchant Center approvals. Keep it outside the daily completion maths.
function GoogleVehicleAdsCard({ inventory, onOpen }) {
  const count = Number.isInteger(inventory?.count) ? inventory.count : null;
  const status = count === null ? (inventory?.error ? "UNAVAILABLE" : "CHECKING") : "LIVE FEED";
  return (
    <article
      className="operations-activity-card is-vansco is-linked"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.();
        }
      }}
      aria-label="Open Vansco Google Vehicle Ads inventory"
    >
      <div className="operations-activity-card__heading">
        <span>Vansco Google Vehicle Ads</span>
        <b>{status}</b>
      </div>
      <div className="operations-activity-card__numbers">
        <strong>{count === null ? "—" : count.toLocaleString("en-GB")}</strong>
        <span>vehicles in feed</span>
        <em>{inventory?.mode === "selected" ? "Manual selection" : "Automatic stock"}</em>
      </div>
      <small style={{ color: "#52657f", fontSize: 11, lineHeight: 1.35 }}>
        {inventory?.error || (inventory?.checkedAt
          ? `DealerKit feed checked ${londonTimeLabel(inventory.checkedAt)} UK`
          : "Checking the live CRM feed")}
      </small>
    </article>
  );
}

export default function DashboardPage({ onNavigate }) {
  const today = londonDateKey();
  const todayWeekday = londonWeekday(new Date());
  const [overview, setOverview] = useState(null);
  const [vanscoEmailToday, setVanscoEmailToday] = useState(null);
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
  const [instagramCheck, setInstagramCheck] = useState(null);
  const [instagramCheckBusy, setInstagramCheckBusy] = useState(false);
  const [instagramCheckError, setInstagramCheckError] = useState("");
  const [vanscoStatus, setVanscoStatus] = useState(null);
  const [vanscoStatusBusy, setVanscoStatusBusy] = useState(false);
  const [vanscoStatusError, setVanscoStatusError] = useState("");
  const [bufferLiveStatus, setBufferLiveStatus] = useState(null);
  const [googleVehicleInventory, setGoogleVehicleInventory] = useState({ count: null, mode: "all", checkedAt: null, error: "" });

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

  async function loadGoogleVehicleInventory() {
    try {
      const response = await fetch("/api/vansco-google-vehicle-selection", {
        method: "GET",
        headers: buildMarketingAccessHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !Array.isArray(data.vehicles)) {
        throw new Error(data.message || "Google feed count unavailable");
      }
      const ids = new Set(data.selectedIds || []);
      const count = data.vehicles.filter(vehicle =>
        !vehicle.missingFromFeed
        && !vehicle.feedExclusion
        && (data.mode !== "selected" || ids.has(vehicle.id))
      ).length;
      setGoogleVehicleInventory({
        count,
        mode: data.mode === "selected" ? "selected" : "all",
        checkedAt: new Date().toISOString(),
        error: "",
      });
    } catch {
      // Never label an old or failed count as live inventory.
      setGoogleVehicleInventory({ count: null, mode: "all", checkedAt: null, error: "Feed count unavailable" });
    }
  }

  // Lightweight live refresh: real Vansco production sends only, no Buffer or other CRM changes.
  useEffect(() => {
    if (locked) return undefined;
    let active = true;
    async function refreshVanscoEmailCount() {
      try {
        const result = await getVanscoEmailToday(today);
        if (active && result.date === today && Number.isFinite(Number(result.sent))) {
          setVanscoEmailToday(Math.max(0, Number(result.sent)));
        }
      } catch {
        // Keep the last confirmed figure rather than showing a misleading zero.
      }
    }
    refreshVanscoEmailCount();
    const timer = window.setInterval(refreshVanscoEmailCount, 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [locked, today]);

  useEffect(() => {
    if (locked) return undefined;
    loadGoogleVehicleInventory();
    const interval = window.setInterval(loadGoogleVehicleInventory, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [locked]);

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

  useEffect(() => {
    const receiveBufferLiveStatus = (event) => {
      if (event?.detail?.today) setBufferLiveStatus(event.detail);
      if (!locked) loadVanscoStatus();
    };
    window.addEventListener("buffer-facebook-live-status", receiveBufferLiveStatus);
    return () => window.removeEventListener("buffer-facebook-live-status", receiveBufferLiveStatus);
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

  async function inspectInstagramBuffer({ refill = false } = {}) {
    if (refill && !window.confirm("Queue up to six Vansco Instagram stock posts in Buffer now?")) return;
    setInstagramCheckBusy(true);
    setInstagramCheckError("");
    try {
      const result = await fetch(
        "/api/vansco-instagram-automation-worker?" + (refill ? "force=true" : "dryRun=true&verifyBuffer=true"),
        {method:refill ? "POST" : "GET",headers:buildMarketingAccessHeaders(),cache:"no-store"}
      );
      const payload = await result.json().catch(() => ({}));
      if (!result.ok || !payload.ok) throw new Error(
        (payload.stage ? `Buffer step: ${payload.stage.replaceAll("_"," ")}. ` : "")
        + (payload.error || "Could not check Vansco Instagram.")
      );
      if (payload.deferred) {
        throw new Error("Buffer is in API cooldown. The next normal run will retry.");
      }
      setInstagramCheck(payload);
    } catch (caught) {
      setInstagramCheckError(caught?.message || "Instagram status is currently unavailable.");
    } finally {
      setInstagramCheckBusy(false);
    }
  }

  const baseMetric = (type) => overview?.day?.metrics?.[type] || null;
  const targetFor = (type) => Math.max(
    0,
    Number(
      overview?.day?.targets?.[type]
      ?? baseMetric(type)?.target
      ?? DEFAULT_DAILY_TARGETS[type]
      ?? 0,
    ),
  );

  const metrics = useMemo(
    () =>
      DAILY_ACTIVITY_TYPES
        .map((type) => overview?.day?.metrics?.[type])
        .filter(Boolean),
    [overview],
  );

  const facebookStoryMetrics = useMemo(() => {
    const storyMetric = ({ type, label, productKey }) => {
      const stored = baseMetric(type);
      const target = targetFor(type);
      const hasLiveStatus = Boolean(bufferLiveStatus?.today);
      const liveCompleted = Math.max(
        0,
        Number(bufferLiveStatus?.today?.[productKey]?.stories || 0),
      );
      const completed = hasLiveStatus
        ? liveCompleted
        : Math.max(0, Number(stored?.completed || 0));
      return {
        type,
        label,
        target,
        completed,
        displayCompleted: hasLiveStatus ? completed : stored ? completed : "—",
        remaining: Math.max(0, target - completed),
        percentage: target > 0
          ? Math.min(100, Math.round((completed / target) * 100))
          : 100,
        statusLabel: !hasLiveStatus && !stored
          ? "CHECKING"
          : completed >= target
            ? "COMPLETE"
            : `${Math.max(0, target - completed)} LEFT`,
      };
    };

    return [
      storyMetric({
        type: "van_finance_facebook_story",
        label: "Van Finance Facebook Stories",
        productKey: "vanFinance",
      }),
      storyMetric({
        type: "rent2buy_facebook_story",
        label: "Rent2Buy Facebook Stories",
        productKey: "rent2buy",
      }),
    ];
  }, [bufferLiveStatus, overview]);

  const instagramMetrics = useMemo(() => {
    const live = bufferLiveStatus?.today?.vanFinanceInstagram;
    const hasLiveStatus = Boolean(bufferLiveStatus?.today && live);
    const definitions = [
      {
        type: "van_finance_instagram_post",
        label: "Van Finance Instagram posts",
        completed: Math.max(0, Number(live?.posts || 0)),
      },
      {
        type: "van_finance_instagram_story",
        label: "Van Finance Instagram Stories",
        completed: Math.max(0, Number(live?.stories || 0)),
      },
      {
        type: "van_finance_instagram_reel",
        label: "Van Finance Instagram Reels",
        completed: Math.max(0, Number(live?.reels || 0)),
      },
    ];

    return definitions.map((item) => {
      const stored = baseMetric(item.type);
      const target = targetFor(item.type);
      const completed = hasLiveStatus
        ? item.completed
        : Math.max(0, Number(stored?.completed || 0));
      return {
        ...item,
        target,
        completed,
        displayCompleted: hasLiveStatus ? completed : stored ? completed : "—",
        remaining: Math.max(0, target - completed),
        percentage: target > 0
          ? Math.min(100, Math.round((completed / target) * 100))
          : 100,
        statusLabel: !hasLiveStatus && !stored
          ? "CHECKING"
          : completed >= target
            ? "COMPLETE"
            : `${Math.max(0, target - completed)} LEFT`,
      };
    });
  }, [bufferLiveStatus, overview]);

  const vanscoMetric = useMemo(() => {
    const stored = baseMetric("vansco_facebook_post");
    const liveAvailable = vanscoStatus?.buffer?.sentCountConfirmed === true;
    const completed = liveAvailable
      ? Math.max(0, Number(vanscoStatus?.buffer?.sentToday || 0))
      : Math.max(0, Number(stored?.completed || 0));
    const target = targetFor("vansco_facebook_post");
    const unavailable = Boolean(vanscoStatusError) && !vanscoStatus && !stored;
    const checking = vanscoStatusBusy && !vanscoStatus && !stored;
    const dayProgress = vanscoDayProgress({
      completed, target, confirmed: liveAvailable,
      checkedAt: vanscoStatus?.providerCheckedAt,
    });
    return {
      type: "vansco_facebook_post",
      target,
      completed,
      displayCompleted: unavailable || checking ? "—" : completed,
      remaining: Math.max(0, target - completed),
      percentage: target > 0
        ? Math.min(100, Math.round((completed / target) * 100))
        : 100,
      statusLabel: unavailable
        ? "UNAVAILABLE"
        : checking
          ? "CHECKING"
          : dayProgress.label,
      statusDetail: unavailable || checking ? "" : dayProgress.detail,
    };
  }, [vanscoStatus, vanscoStatusBusy, vanscoStatusError, overview]);

  const vanscoInstagramMetric = useMemo(() => {
    const data = vanscoStatus?.instagram;
    const recorded = Number.isFinite(Number(data?.sentToday)) && data?.sentToday !== null;
    const completed = recorded ? Math.max(0, Number(data.sentToday)) : 0;
    const target = 20;
    const lastCheck = data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString("en-GB",{
      timeZone:"Europe/London",hour:"2-digit",minute:"2-digit"
    }) : "";
    return {
      type:"vansco_instagram_post",label:"Vansco Instagram posts",target,completed,
      displayCompleted:recorded?completed:"—",
      remaining:Math.max(0,target-completed),
      percentage:recorded?Math.min(100,Math.round(completed/target*100)):0,
      statusLabel:!data || data.state==="awaiting_first_run"?"CHECKING":
        data.state==="failed"?"NEEDS ATTENTION":data.state==="cooldown"?"BUFFER COOLDOWN":
        completed>=target?"COMPLETE":`${target-completed} LEFT`,
      statusDetail:recorded?`Buffer-confirmed at ${lastCheck} UK · ${data.scheduledToday||0} scheduled`:
        (data?.error ? `${data.stage ? data.stage.replaceAll("_"," ") + ": " : ""}${data.error}` :
          "Waiting for first Buffer confirmation")
    };
  },[vanscoStatus]);

  const vanscoStoryMetric = useMemo(() => {
    const stored = baseMetric("vansco_facebook_story");
    const liveAvailable = vanscoStatus?.buffer?.sentCountConfirmed === true && Boolean(vanscoStatus?.stories);
    const completed = liveAvailable
      ? Math.max(0, Number(vanscoStatus?.stories?.sentToday || 0))
      : Math.max(0, Number(stored?.completed || 0));
    const target = targetFor("vansco_facebook_story");
    const unavailable = Boolean(vanscoStatusError) && !vanscoStatus && !stored;
    const checking = vanscoStatusBusy && !vanscoStatus && !stored;
    const dayProgress = vanscoDayProgress({
      completed, target, confirmed: liveAvailable,
      checkedAt: vanscoStatus?.providerCheckedAt,
    });
    return {
      type: "vansco_facebook_story",
      label: "Vansco Facebook Stories",
      target,
      completed,
      displayCompleted: unavailable || checking ? "—" : completed,
      remaining: Math.max(0, target - completed),
      percentage: target > 0
        ? Math.min(100, Math.round((completed / target) * 100))
        : 100,
      statusLabel: unavailable
        ? "UNAVAILABLE"
        : checking
          ? "CHECKING"
          : dayProgress.label,
      statusDetail: unavailable || checking ? "" : dayProgress.detail,
    };
  }, [vanscoStatus, vanscoStatusBusy, vanscoStatusError, overview]);

  const vanscoGoogleMetrics = useMemo(() => {
    const checking = vanscoStatusBusy && !vanscoStatus;
    const statusUnavailable = Boolean(vanscoStatusError) && !vanscoStatus;
    const google = vanscoStatus?.googleBusiness;
    const definitions = [
      {
        type: "vansco_333_google_business_post",
        label: "Vansco 333 Google Business",
        branchKey: "vansco333",
      },
      {
        type: "vansco_airport_google_business_post",
        label: "Vansco Airport Google Business",
        branchKey: "southamptonAirport",
      },
      {
        type: "vansco_new_forest_google_business_post",
        label: "Vansco New Forest Google Business",
        branchKey: "newForest",
      },
    ];

    return definitions.map(({ type, label, branchKey }) => {
      const stored = baseMetric(type);
      const branchStatus = google?.branches?.[branchKey];
      const unavailable = statusUnavailable
        || (Boolean(vanscoStatus) && (!google?.connected || !branchStatus));
      const liveAvailable = Boolean(branchStatus);
      const completed = liveAvailable
        ? Math.max(0, Number(branchStatus?.sentToday || 0))
        : Math.max(0, Number(stored?.completed || 0));
      const target = targetFor(type);
      return {
        type,
        label,
        target,
        completed,
        displayCompleted: (unavailable || checking) && !stored ? "—" : completed,
        remaining: Math.max(0, target - completed),
        percentage: target > 0
          ? Math.min(100, Math.round((completed / target) * 100))
          : 100,
        statusLabel: (unavailable || checking) && !stored
          ? unavailable ? "UNAVAILABLE" : "CHECKING"
          : completed >= target
            ? "COMPLETE"
            : `${Math.max(0, target - completed)} LEFT`,
      };
    });
  }, [vanscoStatus, vanscoStatusBusy, vanscoStatusError, overview]);

  const displayMetrics = useMemo(() => {
    const live = new Map([
      ...facebookStoryMetrics.map((metric) => [metric.type, metric]),
      ...instagramMetrics.map((metric) => [metric.type, metric]),
      [vanscoMetric.type, vanscoMetric],
      [vanscoInstagramMetric.type, vanscoInstagramMetric],
      [vanscoStoryMetric.type, vanscoStoryMetric],
      ...vanscoGoogleMetrics.map((metric) => [metric.type, metric]),
    ]);
    return [...DAILY_ACTIVITY_TYPES, "vansco_instagram_post"]
      .map((type) => live.get(type) || overview?.day?.metrics?.[type])
      .filter(Boolean)
      .map((metric) => {
        if (metric.type !== "vansco_emails_sent") return metric;
        const completed = vanscoEmailToday ?? metric.completed;
        return {
          ...metric,
          completed,
          displayCompleted: Number(completed).toLocaleString("en-GB"),
          remaining: Math.max(0, metric.target - completed),
          percentage: metric.target > 0 ? Math.min(100, Math.round(100 * completed / metric.target)) : 100,
          statusLabel: "SENT TODAY",
          statusDetail: "Confirmed SendGrid submissions · UK today",
        };
      });
  }, [
    overview,
    facebookStoryMetrics,
    instagramMetrics,
    vanscoMetric,
    vanscoInstagramMetric,
    vanscoStoryMetric,
    vanscoGoogleMetrics,
    vanscoEmailToday,
  ]);


  const groupedMetrics = useMemo(() => groupContentOperationsMetrics(displayMetrics), [displayMetrics]);

  const operationsSummary = useMemo(() => {
    const active = displayMetrics.filter((metric) => Number(metric?.target || 0) > 0);
    const targetTotal = active.reduce((sum, metric) => sum + Number(metric.target || 0), 0);
    const completedTowardTarget = active.reduce(
      (sum, metric) => sum + Math.min(
        Number(metric.target || 0),
        Math.max(0, Number(metric.completed || 0)),
      ),
      0,
    );
    const remainingTotal = active.reduce(
      (sum, metric) => sum + Math.max(0, Number(metric.remaining || 0)),
      0,
    );
    return {
      targetTotal,
      remainingTotal,
      complete: targetTotal === 0 || remainingTotal === 0,
      completionPercentage: targetTotal > 0
        ? Math.min(100, Math.round((completedTowardTarget / targetTotal) * 100))
        : 100,
    };
  }, [displayMetrics]);

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
        className={`operations-summary${operationsSummary.complete ? " is-complete" : ""}`}
      >
        <div>
          <div className="eyebrow">TODAY · UK TIME</div>
          <h2>
            {overview?.day?.off_day
              ? "No target today"
              : operationsSummary.complete
                ? "Today’s target is complete"
                : "What you need to do today"}
          </h2>
          <p>
            {overview?.day?.off_day
              ? "This is set as an off day."
              : `${operationsSummary.remainingTotal} remaining across today’s marketing activity.`}
          </p>
        </div>
        <div className="operations-summary__score">
          <strong>{operationsSummary.completionPercentage}%</strong>
          <span>complete</span>
        </div>
      </section>
      {error ? <div className="notice notice--error">{error}</div> : null}
      {message ? <div className="notice notice--success">{message}</div> : null}
      <div className="operations-brand-sections">
        {groupedMetrics.map((group) => (
          <section
            key={group.key}
            className={`operations-brand-group operations-brand-group--${group.key}`}
            aria-labelledby={`operations-brand-${group.key}`}
          >
            <div className="operations-brand-group__heading">
              <div>
                <h3 id={`operations-brand-${group.key}`}>{group.name}</h3>
                <p>{group.description}</p>
              </div>
              <span className="operations-brand-group__count">
                {group.metrics.length + (group.key === "vansco" ? 1 : 0)} cards
              </span>
            </div>
            <div className="operations-activity-grid">
              {group.metrics.map((metric) => {
                const destination = ACTIVITY_NAVIGATION[metric.type];
                return (
                  <ActivityCard
                    key={metric.type}
                    metric={metric}
                    onOpen={metric.type === "vansco_emails_sent"
                      ? () => window.location.assign("/vansco-email-studio/")
                      : destination ? () => onNavigate?.(destination) : undefined}
                  />
                );
              })}
              {group.key === "vansco" ? (
                <GoogleVehicleAdsCard
                  inventory={googleVehicleInventory}
                  onOpen={() => onNavigate?.("Vansco Google Vehicle Ads")}
                />
              ) : null}
            </div>
          </section>
        ))}
      </div>
      <AIVisibilityWidget onOpen={() => onNavigate?.("AI Visibility")} />
      <Ga4PipelinePanel />

      <section className="panel">
        <div className="eyebrow">VANSCO · BUFFER STOCK AUTOMATION</div>
        <h3>DealerKit → branch-specific social and Google Business posts → Buffer</h3>
        <p>
          DealerKit Meta catalogue is the retail stock source. Facebook uses the Vansco Limited channel, while each Google Business page receives only vehicles assigned to its own branch.
        </p>
        <div className="notice" style={{ marginBottom: 12 }}>
          <strong>Vansco Facebook: {vanscoMetric.displayCompleted}/{vanscoMetric.target} Buffer-sent posts.</strong>{" "}
          {vanscoMetric.statusLabel}. {vanscoMetric.statusDetail || "Verified history unavailable."}
          {" "}Tomorrow’s queue is tracked separately and cannot reset today’s total.
        </div>
        <div className="notice" style={{ marginBottom: 12 }}>
          <strong>Google Business routing:</strong> Vansco 333 → 333 stock · Southampton Airport → Airport stock · New Forest → New Forest stock.
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
          <button className="button button--ghost" type="button"
            disabled={instagramCheckBusy} onClick={() => inspectInstagramBuffer()}>
            {instagramCheckBusy ? "CHECKING…" : "CHECK VANSCO INSTAGRAM"}
          </button>
          <button className="button button--primary" type="button"
            disabled={instagramCheckBusy} onClick={() => inspectInstagramBuffer({refill:true})}>
            QUEUE UP TO 6 INSTAGRAM POSTS
          </button>
        </div>
        {vanscoPreviewError ? <div className="notice notice--error">{vanscoPreviewError}</div> : null}
        {vanscoBufferError ? <div className="notice notice--error">{vanscoBufferError}</div> : null}
        {instagramCheckError ? <div className="notice notice--error" role="alert">{instagramCheckError}</div> : null}
        {instagramCheck ? (
          <div className="notice" role="status" style={{marginTop:10}}>
            <strong>Vansco Instagram · {instagramCheck.channelName || "Channel checking"}</strong>
            {" "} {instagramCheck.deferred ? "Buffer cooldown" :
              instagramCheck.dryRun
                ? `Buffer queue: ${instagramCheck.queueNow ?? "—"} · Sent today: ${instagramCheck.sentToday ?? "—"} · Can schedule now: ${instagramCheck.availableToQueue ?? "—"}`
                : `Added ${instagramCheck.created ?? 0} post(s) · Queue: ${instagramCheck.queued ?? "—"}`}.
            <span style={{display:"block",fontSize:12,marginTop:5}}>
              {instagramCheck.dryRun ? "This check did not publish or queue anything." :
                "Posts accepted into the queue still need Buffer to publish at their scheduled times."}
            </span>
          </div>
        ) : null}
        {vanscoBuffer ? (
          <>
            <div className={`notice ${vanscoBuffer.connected ? "notice--success" : ""}`}>
              {vanscoBuffer.connected
                ? `${vanscoBuffer.channelName} connected · sent today ${vanscoBuffer.sentToday ?? 0} · queued now ${vanscoBuffer.queuedNow ?? 0} · daily limit ${vanscoBuffer.dailyPostingLimit ?? "not reported"} · queue limit ${vanscoBuffer.scheduledPostsLimit}`
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

      <details className="operations-drawer" onToggle={(event) => {
        if (event.currentTarget.open) loadTotals(period).catch(() => {});
      }}>
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
                  {DAILY_ACTIVITY_TYPES.map((type) => {
                    const row = totals.totals[type];
                    const vanscoTrackingOnly = type === "vansco_emails_sent" && row.target === 0;
                    return (
                      <tr key={type}>
                        <td>{ACTIVITY_LABELS[type]}</td>
                        <td>{row.completed.toLocaleString("en-GB")}</td>
                        <td>{vanscoTrackingOnly ? "—" : row.target}</td>
                        <td>{vanscoTrackingOnly ? "—" : row.shortfall}</td>
                        <td>{row.daily_average}</td>
                        <td>{vanscoTrackingOnly ? "Tracking" : `${row.completion_percentage}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <section className="operations-vansco-email-history" aria-label="Vansco Email Studio daily history" style={{ marginTop: 20 }}>
                <h3>Vansco Email Studio · Daily history</h3>
                <p style={{ fontSize: 12, color: "#52657f" }}>
                  Confirmed production emails submitted to SendGrid, by UK date. Tests and skipped recipients are excluded.
                </p>
                <table className="operations-table">
                  <thead><tr><th>UK date</th><th>Emails sent</th></tr></thead>
                  <tbody>
                    {(totals.days || []).slice().reverse().map((day) => (
                      <tr key={day.date}>
                        <td>{day.date}</td>
                        <td>{Number(day.metrics?.vansco_emails_sent?.completed || 0).toLocaleString("en-GB")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          ) : null}
          <section style={{ marginTop: 18, borderTop: "1px solid #dbe3ef", paddingTop: 14 }}>
            <h3 style={{ margin: "0 0 8px" }}>Vansco Google Vehicle Ads</h3>
            <p style={{ margin: "0 0 10px", color: "#52657f", fontSize: 13 }}>
              Current DealerKit Google feed stock, separate from the daily publishing targets above.
              This is a live snapshot, not a historical advertisement or approval count.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 22 }}>
                {Number.isInteger(googleVehicleInventory.count) ? googleVehicleInventory.count.toLocaleString("en-GB") : "—"} vehicles
              </strong>
              <span>{googleVehicleInventory.mode === "selected" ? "Manual selection" : "Automatic available stock"}</span>
              <button type="button" className="button button--ghost" onClick={() => onNavigate?.("Vansco Google Vehicle Ads")}>
                Open Vehicle Ads
              </button>
            </div>
            {googleVehicleInventory.error ? (
              <p role="status" style={{ marginTop: 7, color: "#b91c1c" }}>{googleVehicleInventory.error}</p>
            ) : googleVehicleInventory.checkedAt ? (
              <p style={{ marginTop: 7, fontSize: 12, color: "#52657f" }}>
                CRM feed count checked {londonTimeLabel(googleVehicleInventory.checkedAt)} UK.
                Merchant Center approval and actual advertising impressions are reported separately in Google.
              </p>
            ) : null}
          </section>
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
