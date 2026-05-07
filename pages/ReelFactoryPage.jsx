import { useMemo, useState, useEffect } from "react";
import FilterBar from "../components/FilterBar.jsx";
import {
  financeReelHooks,
  reelHookModes,
  reelSources,
  reelTypes,
  rentReelHooks,
} from "../data/mockData.js";
import { downloadFacebookMp4Reel } from "../utils/facebookMp4Export.js";

const TRACK_BASE_URL = "https://marketing-crm-six.vercel.app/track?src=reel";
const DEFAULT_FINANCE_DESCRIPTION = `🚐 VAN FINANCE AVAILABLE NOW
💰 From £99 deposit
⚡ Approved in 60 minutes

👇 Apply now
${TRACK_BASE_URL}&type=finance&reel={reelId}&reg={reg}`;
const DEFAULT_RENT_DESCRIPTION = `🚐 RENT TO BUY YOUR VAN
🚫 NO CREDIT CHECK
🔑 RENT IT - DRIVE IT - OWN IT

👇 Apply now
${TRACK_BASE_URL}&type=rent2buy&reel={reelId}`;

const FINANCE_DESCRIPTION_OPTIONS = [
  {
    label: "Finance Default",
    text: DEFAULT_FINANCE_DESCRIPTION,
  },
  {
    label: "Finance Low Deposit",
    text: `🚐 VAN FINANCE AVAILABLE NOW
💰 Low deposit options available
⚡ Fast decision

👇 Apply now
${TRACK_BASE_URL}&type=finance&reel={reelId}&reg={reg}`,
  },
];

const RENT_DESCRIPTION_OPTIONS = [
  {
    label: "Rent2Buy Default",
    text: DEFAULT_RENT_DESCRIPTION,
  },
  {
    label: "Rent2Buy No Credit Check",
    text: `🚐 RENT TO BUY YOUR VAN
🚫 No credit check
🔑 Rent it - drive it - own it

👇 Apply now
${TRACK_BASE_URL}&type=rent2buy&reel={reelId}`,
  },
];

function createDraftReelId() {
  return `reel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDescriptionType({ filters, formValues, selectedVehicle, todayReels }) {
  if (formValues.reelType === "Finance") return "finance";
  if (formValues.reelType === "Rent2Buy") return "rent2buy";
  if (filters.pipeline === "vanFinance") return "finance";
  if (filters.pipeline === "rent2buy") return "rent2buy";
  if (selectedVehicle?.pipeline === "rent2buy") return "rent2buy";
  if (selectedVehicle?.pipeline === "vanFinance") return "finance";
  if (todayReels[0]?.pipeline === "rent2buy") return "rent2buy";
  return "finance";
}

function buildReelDescription(type, reelId) {
  const template = type === "rent2buy" ? DEFAULT_RENT_DESCRIPTION : DEFAULT_FINANCE_DESCRIPTION;
  return template.replaceAll("{reelId}", encodeURIComponent(reelId));
}

function getReelRegistration(reel) {
  return String(
    reel?.registration ||
    reel?.vehicle?.reg ||
    reel?.reg ||
    ""
  )
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function fillDescriptionTemplate(template, reelId, reel = null) {
  const reg = getReelRegistration(reel);

  return template
    .replaceAll("{reelId}", encodeURIComponent(reelId))
    .replaceAll("{reg}", encodeURIComponent(reg));
}

function ReelStoryboardPreview({ creative }) {
  const previewStyles = {
    card: {
      background: "rgba(255,255,255,0.88)",
      border: "1px solid rgba(148, 163, 184, 0.18)",
      boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
      borderRadius: 22,
      overflow: "hidden",
    },
    reel: {
      position: "relative",
      aspectRatio: "9 / 16",
      background: "linear-gradient(180deg, #0f172a 0%, #172554 100%)",
      borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
      overflow: "hidden",
    },
    backgroundImage: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "center",
      filter: "brightness(0.62)",
      transform: "scale(1.02)",
    },
    overlay: {
      position: "absolute",
      inset: 0,
      background:
        "linear-gradient(180deg, rgba(15,23,42,0.24) 0%, rgba(15,23,42,0.38) 26%, rgba(15,23,42,0.72) 100%)",
    },
    safeZone: {
      position: "relative",
      zIndex: 1,
      height: "100%",
      display: "grid",
      gridTemplateRows: "20% 60% 20%",
      padding: 14,
    },
    center: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      gap: 12,
      padding: "0 10px",
    },
    hook: {
      fontSize: 28,
      lineHeight: 1.02,
      fontWeight: 900,
      color: "#ffffff",
      letterSpacing: "-0.03em",
      textTransform: "uppercase",
      textWrap: "balance",
      maxWidth: "92%",
      textShadow: "0 6px 18px rgba(15,23,42,0.35)",
    },
    support: {
      fontSize: 13,
      lineHeight: 1.35,
      fontWeight: 700,
      color: "rgba(255,255,255,0.92)",
      maxWidth: "90%",
      textWrap: "balance",
      textShadow: "0 6px 18px rgba(15,23,42,0.35)",
    },
    ctaWrap: {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      paddingBottom: 8,
    },
    cta: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 42,
      padding: "10px 16px",
      borderRadius: 999,
      background: "rgba(255,255,255,0.16)",
      border: "1px solid rgba(255,255,255,0.22)",
      color: "#ffffff",
      fontSize: 13,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      backdropFilter: "blur(8px)",
    },
    body: {
      padding: 18,
      display: "grid",
      gap: 10,
    },
    tags: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
    },
    tag: {
      display: "inline-flex",
      alignItems: "center",
      padding: "8px 12px",
      borderRadius: 999,
      background: "#eff6ff",
      color: "#1d4ed8",
      fontSize: 13,
      fontWeight: 700,
    },
    title: {
      margin: 0,
      fontSize: 20,
      color: "#122033",
    },
    meta: {
      color: "#5b6b82",
      fontSize: 14,
    },
    caption: {
      whiteSpace: "pre-wrap",
      fontSize: 14,
      lineHeight: 1.55,
      padding: "12px 14px",
      borderRadius: 14,
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      color: "#122033",
    },
    actions: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
    },
    statusPill: {
      display: "inline-flex",
      alignItems: "center",
      padding: "8px 12px",
      borderRadius: 999,
      background: "#eff6ff",
      color: "#1d4ed8",
      fontSize: 13,
      fontWeight: 700,
    },
  };

  return (
    <article style={previewStyles.card}>
      <div style={previewStyles.reel}>
        <img
          src={creative.vehicle.image}
          alt={creative.vehicle.name}
          style={previewStyles.backgroundImage}
        />
        <div style={previewStyles.overlay} />

        <div style={previewStyles.safeZone}>
          <div />

          <div style={previewStyles.center}>
            <div style={previewStyles.hook}>{creative.hookStyle}</div>
            <div style={previewStyles.support}>{creative.vehicle.name}</div>
            <div style={previewStyles.support}>{creative.vehicle.price}</div>
          </div>

          <div style={previewStyles.ctaWrap}>
            <div style={previewStyles.cta}>{creative.cta}</div>
          </div>
        </div>
      </div>

      <div style={previewStyles.body}>
        <div style={previewStyles.tags}>
          <span style={previewStyles.tag}>{creative.vehicle.pipeline}</span>
          <span style={previewStyles.tag}>{creative.vehicle.reg}</span>
          <span style={previewStyles.tag}>{creative.templateType}</span>
        </div>

        <h3 style={previewStyles.title}>{creative.vehicle.name}</h3>
        <div style={previewStyles.meta}>Hook: {creative.hookStyle}</div>
        <div style={previewStyles.meta}>CTA: {creative.cta}</div>
        <div style={previewStyles.caption}>{creative.caption}</div>

        <div style={previewStyles.actions}>
          <span style={previewStyles.statusPill}>Saved to library</span>
        </div>
      </div>
    </article>
  );
}

function ReelStudioHero() {
  return (
    <section className="reel-studio-hero">
      <div className="reel-studio-hero__content">
        <span className="reel-studio-hero__eyebrow">Campaign video workspace</span>
        <h2>Reel Studio</h2>
        <p>Create campaign-ready videos for Van Finance and Rent2Buy stock.</p>
      </div>

      <div className="reel-studio-hero__rail" aria-label="Campaign types">
        <div className="reel-studio-mini reel-studio-mini--finance">
          <span>Van Finance</span>
          <strong>Finance Campaign</strong>
        </div>
        <div className="reel-studio-mini reel-studio-mini--rent">
          <span>Rent2Buy</span>
          <strong>Customer Journey</strong>
        </div>
      </div>
    </section>
  );
}

export function DailyReelFactoryPanel({
  vehicles,
  vehiclesLoading,
  vehiclesError,
  filters,
  onFiltersChange,
  formValues,
  onFormChange,
  onGenerate,
  todayReels,
  generationMessage,
  creativeError,
  uploadedImages,
  selectedVehicle,
  onClearSelectedVehicle,
  onImagesSelected,
  todayReelsCount,
}) {
  const isFinanceTab = filters.pipeline === "vanFinance";
  const isRentTab = filters.pipeline === "rent2buy";
  const isAllTab = !isFinanceTab && !isRentTab;

  return (
    <section
      className={`panel reel-factory-panel ${
        isRentTab ? "reel-factory-panel--rent" : "reel-factory-panel--finance"
      }`}
    >
      <div className="panel__header">
        <div>
          <h3>Daily Reel Factory</h3>
          <p>Generate a batch of daily reels from live stock or uploaded images.</p>
          <p className="creative-card__meta">
            Vehicles used in the last 5 days are skipped for better variety.
          </p>
        </div>
        <span className="status-pill">{todayReelsCount} today</span>
      </div>

      <div className="campaign-card-grid">
        <div className="campaign-card campaign-card--finance">
          <div>
            <span className="campaign-card__label">Van Finance</span>
            <h4>Sharp finance reels</h4>
          </div>
          <div className="campaign-card__chips">
            <span>Finance Campaign</span>
            <span>Low Deposit</span>
            <span>Ready for Reel</span>
          </div>
        </div>

        <div className="campaign-card campaign-card--rent">
          <div>
            <span className="campaign-card__label">Rent2Buy</span>
            <h4>Trust-led journey reels</h4>
          </div>
          <div className="campaign-card__chips">
            <span>Rent2Buy Campaign</span>
            <span>Proof Checklist</span>
            <span>Customer Journey</span>
          </div>
        </div>
      </div>

      <FilterBar filters={filters} onChange={onFiltersChange} />

      {selectedVehicle ? (
        <div className={`selected-reel-stock selected-reel-stock--${selectedVehicle.pipeline === "rent2buy" ? "rent" : "finance"}`}>
          {selectedVehicle.image ? (
            <img src={selectedVehicle.image} alt={selectedVehicle.name} />
          ) : null}
          <div>
            <strong>{selectedVehicle.name || selectedVehicle.reg}</strong>
            <span>{selectedVehicle.pipeline === "rent2buy" ? "Rent2Buy" : "Van Finance"} stock selected</span>
          </div>
          <span className="tag">{selectedVehicle.reg || selectedVehicle.price || "Selected"}</span>
          <button className="button button--ghost" type="button" onClick={onClearSelectedVehicle}>
            Random Pool
          </button>
        </div>
      ) : null}

      <div className="daily-reel-controls">
        <label className="field">
          <span className="field__label">Reel source</span>
          <select
            className="field__input"
            value={formValues.reelSource}
            onChange={(event) => onFormChange("reelSource", event.target.value)}
          >
            {reelSources.map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Quantity</span>
          <input
            className="field__input"
            type="number"
            min="1"
            max="50"
            value={formValues.quantity}
            onChange={(event) => onFormChange("quantity", Number(event.target.value) || 1)}
          />
        </label>

        <label className="field">
          <span className="field__label">Hook mode</span>
          <select
            className="field__input"
            value={formValues.hookMode}
            onChange={(event) => onFormChange("hookMode", event.target.value)}
          >
            {reelHookModes.map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Reel type</span>
          <select
            className="field__input"
            value={formValues.reelType}
            onChange={(event) => onFormChange("reelType", event.target.value)}
          >
            {reelTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>

        {isAllTab ? (
          <div className="selection-summary">
            <strong>Auto mix mode</strong>
            <span>Finance stock uses finance hooks. Rent2Buy stock uses rent hooks.</span>
          </div>
        ) : null}

        {!isRentTab ? (
          <label className="field">
            <span className="field__label">Finance hook</span>
            <select
              className="field__input"
              value={formValues.financeHook}
              onChange={(event) => onFormChange("financeHook", event.target.value)}
            >
              {financeReelHooks.map((hook) => (
                <option key={hook} value={hook}>{hook}</option>
              ))}
            </select>
          </label>
        ) : null}

        {!isFinanceTab ? (
          <label className="field">
            <span className="field__label">Rent hook</span>
            <select
              className="field__input"
              value={formValues.rentHook}
              onChange={(event) => onFormChange("rentHook", event.target.value)}
            >
              {rentReelHooks.map((hook) => (
                <option key={hook} value={hook}>{hook}</option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="field daily-reel-controls__wide">
          <span className="field__label">Custom hook</span>
          <input
            className="field__input"
            value={formValues.customHook}
            onChange={(event) => onFormChange("customHook", event.target.value)}
            placeholder="Optional custom hook"
          />
        </label>

        <label className="field">
          <span className="field__label">Uploaded images: {uploadedImages.length}</span>
          <input className="field__input" type="file" multiple accept="image/*" onChange={onImagesSelected} />
        </label>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={formValues.musicOn}
            onChange={(event) => onFormChange("musicOn", event.target.checked)}
          />
          <span>{formValues.musicOn ? "Music On" : "Music Off"}</span>
        </label>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={Boolean(formValues.ignoreVehicleCooldown)}
            onChange={(event) => onFormChange("ignoreVehicleCooldown", event.target.checked)}
          />
          <span>Ignore 5-day cooldown for this generation</span>
        </label>
      </div>

      <div className="factory-action-row">
        <button
          className="button button--primary"
          onClick={onGenerate}
          disabled={vehiclesLoading || Boolean(vehiclesError)}
        >
          {selectedVehicle ? "Generate Selected Reel" : "Generate Today's Reels"}
        </button>
        <span className="creative-card__meta">
          Pool: {vehicles.length} visible stock vehicles + {uploadedImages.length} uploads
        </span>
      </div>

      {vehiclesError ? <div className="notice notice--error">Unable to load stock: {vehiclesError}</div> : null}
      {generationMessage ? <div className="notice">{generationMessage}</div> : null}
      {creativeError ? <div className="notice notice--error">{creativeError}</div> : null}
    </section>
  );
}

export function TodayReelsSection({
  todayReels,
  onDownloadReel,
  onDownloadAll,
  onDownloadAllFacebookMp4,
  mp4Statuses = {},
  mp4BatchRunning = false,
  mp4ProgressMessage = "",
  onDeleteReel,
  onClearReels,
}) {
  return (
    <section className="panel reel-output-panel">
      <div className="panel__header">
        <div>
          <h3>Today's Reels</h3>
          <p>Generated reel videos stay visible here for this session with preview and download controls.</p>
        </div>
        <div className="card-actions">
          <button
            className="button button--primary"
            onClick={onDownloadAllFacebookMp4}
            disabled={!todayReels.length || mp4BatchRunning}
          >
            Convert All to Facebook MP4
          </button>
          <button className="button button--ghost" onClick={onDownloadAll} disabled={!todayReels.length}>
            Download All
          </button>
          <button className="button button--danger" onClick={onClearReels} disabled={!todayReels.length}>
            Clear Today's Reels
          </button>
        </div>
      </div>

      {mp4ProgressMessage || Object.keys(mp4Statuses).length ? (
        <div className="mp4-batch-status">
          {mp4ProgressMessage ? <div className="mp4-batch-status__summary">{mp4ProgressMessage}</div> : null}
          {todayReels.map((reel) => {
            const status = mp4Statuses[reel.id];
            if (!status) return null;

            return (
              <div className="mp4-batch-status__row" key={`mp4-status-${reel.id}`}>
                <span className="mp4-batch-status__name">{reel.downloadName || reel.fileName || reel.title}</span>
                <span className={`mp4-batch-status__state mp4-batch-status__state--${status.state.toLowerCase()}`}>
                  {status.state}
                </span>
                {status.error ? <span className="mp4-batch-status__error">{status.error}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {todayReels.length === 0 ? (
        <div className="empty-state">No reels generated today.</div>
      ) : (
        <div className="today-reel-grid">
          {todayReels.map((reel) => (
            <article
              className={`creative-card creative-card--${reel.pipeline === "rent2buy" ? "rent" : "finance"} today-reel-card today-reel-card--${reel.pipeline === "rent2buy" ? "rent" : "finance"}`}
              key={reel.id}
            >
              <div className="creative-preview today-reel-preview">
                {reel.url ? (
                  <video
                    className="creative-preview__image today-reel-video"
                    src={reel.url}
                    poster={reel.posterUrl || reel.image}
                    controls
                    playsInline
                  />
                ) : (
                  <div className="reel-frame__safe-zone" style={{ gridRow: "1 / -1", width: "100%" }}>
                    <div className="reel-frame__top-safe" />

                    <div className="reel-frame__center">
                      <div className="reel-frame__vehicle-wrap">
                        {reel.image ? (
                          <img
                            src={reel.image}
                            alt={reel.title}
                            className="reel-frame__vehicle-image"
                          />
                        ) : null}
                      </div>

                      <div className="reel-frame__headline">{reel.headline}</div>

                      <div
                        className={`reel-frame__subtext ${
                          reel.pipeline !== "rent2buy" ? "reel-frame__subtext--price" : ""
                        }`}
                      >
                        {reel.priceLine}
                      </div>

                      <div className="reel-frame__subtext">{reel.ctaLine}</div>
                      <div className="reel-frame__subtext">{reel.domain}</div>
                    </div>

                    <div className="reel-frame__bottom-safe" />
                  </div>
                )}

                <div className="creative-preview__overlay">
                  <div className="creative-preview__chip">{reel.templateName}</div>
                  <div className="creative-preview__headline">{reel.headline}</div>
                  <div className="creative-preview__subline">{reel.priceLine || reel.domain}</div>
                </div>
              </div>

              <div className="creative-card__body">
                <div className="creative-card__tags">
                  <span className={`tag tag--${reel.pipeline === "rent2buy" ? "rent" : "finance"}`}>
                    {reel.pipeline === "rent2buy" ? "Rent2Buy Campaign" : "Finance Campaign"}
                  </span>
                  <span className="tag">{reel.pipeline === "rent2buy" ? "Proof Checklist" : "Low Deposit"}</span>
                  <span className="tag">{reel.pipeline === "rent2buy" ? "Customer Journey" : "Ready for Reel"}</span>
                  <span className="tag">Hook: {reel.hook}</span>
                  <span className="tag">{reel.sourceLabel}</span>
                  {reel.musicOn ? <span className="tag">Music on</span> : null}
                  <span className="tag">{reel.templateName}</span>
                </div>
                <h3>{reel.title}</h3>
                <div className="creative-card__meta">Hook: {reel.headline}</div>
                <div className="creative-card__meta">Content: {reel.subtext}</div>
                <div className="creative-card__meta">Domain: {reel.domain}</div>
                <div className="creative-card__meta">File: {reel.downloadName || reel.fileName}</div>
                <div className="creative-card__meta">Format: {reel.mimeType || "Video file"}</div>
                <div className="card-actions">
                  <button className="button button--primary" onClick={() => onDownloadReel(reel)}>
                    Download Reel
                  </button>
                  <button className="button button--danger" onClick={() => onDeleteReel(reel.id)}>
                    Delete Reel
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ReelDescriptionPanel({
  filters,
  formValues,
  selectedVehicle,
  todayReels,
  financeDescriptions,
  rentDescriptions,
  setFinanceDescriptions,
  setRentDescriptions,
  financeOptions,
  rentOptions,
  selectedFinanceIndex,
  selectedRentIndex,
  onSelectFinance,
  onSelectRent,
}) {
  const [draftReelId] = useState(createDraftReelId);
  const [financeOpen, setFinanceOpen] = useState(true);
  const [rentOpen, setRentOpen] = useState(false);
  const type = getDescriptionType({ filters, formValues, selectedVehicle, todayReels });
  const matchingReel = todayReels.find((reel) =>
    type === "rent2buy" ? reel.pipeline === "rent2buy" : reel.pipeline !== "rent2buy"
  );
  const reelId = matchingReel?.id || todayReels[0]?.id || draftReelId;
  
const financePreview = useMemo(
  () => fillDescriptionTemplate(financeDescriptions[selectedFinanceIndex], reelId, matchingReel),
  [financeDescriptions, selectedFinanceIndex, reelId, matchingReel]
);

const rentPreview = useMemo(
  () => fillDescriptionTemplate(rentDescriptions[selectedRentIndex], reelId, matchingReel),
  [rentDescriptions, selectedRentIndex, reelId, matchingReel]
);
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h3>Reel Descriptions</h3>
          <p>Editable tracked caption text. The matching version auto-copies when a reel is downloaded.</p>
        </div>
      </div>
      <div className="page-stack" style={{ gap: 12 }}>
        <div>
          <button className="button button--ghost" type="button" onClick={() => setFinanceOpen((open) => !open)}>
            {financeOpen ? "Hide" : "Show"} Van Finance Reel Description
          </button>
          {financeOpen ? (
  <>
    <label className="field">
      <span className="field__label">Finance Caption Option</span>
      <select
        className="field__input"
        value={selectedFinanceIndex}
        onChange={(e) => onSelectFinance(Number(e.target.value))}
      >
        {financeOptions.map((option, i) => (
          <option key={i} value={i}>
            {option.label}
          </option>
        ))}
      </select>
    </label>

    <textarea
      className="field__input"
      rows={7}
      value={financeDescriptions[selectedFinanceIndex]}
onChange={(event) => {
  const updated = [...financeDescriptions];
  updated[selectedFinanceIndex] = event.target.value;
  setFinanceDescriptions(updated);
}}
    />
  </>
) : null}
        </div>
        <div>
          <button className="button button--ghost" type="button" onClick={() => setRentOpen((open) => !open)}>
            {rentOpen ? "Hide" : "Show"} Rent2Buy Reel Description
          </button>
        {rentOpen ? (
  <>
    <label className="field">
      <span className="field__label">Rent2Buy Caption Option</span>
      <select
        className="field__input"
        value={selectedRentIndex}
        onChange={(e) => onSelectRent(Number(e.target.value))}
      >
        {rentOptions.map((option, i) => (
          <option key={i} value={i}>
            {option.label}
          </option>
        ))}
      </select>
    </label>

    <textarea
      className="field__input"
      rows={7}
      value={rentDescriptions[selectedRentIndex]}
onChange={(event) => {
  const updated = [...rentDescriptions];
  updated[selectedRentIndex] = event.target.value;
  setRentDescriptions(updated);
}}
    />
  </>
) : null}
        </div>
        <div className="creative-card__meta">
          Active preview: {type === "rent2buy" ? rentPreview : financePreview}
        </div>
      </div>
    </section>
  );
}

export default function ReelFactoryPage(props) {
  const [selectedFinanceDescriptionIndex, setSelectedFinanceDescriptionIndex] = useState(0);
  const [selectedRentDescriptionIndex, setSelectedRentDescriptionIndex] = useState(0);
  const [mp4BatchRunning, setMp4BatchRunning] = useState(false);
  const [mp4Statuses, setMp4Statuses] = useState({});
  const [mp4ProgressMessage, setMp4ProgressMessage] = useState("");

 const [financeDescriptions, setFinanceDescriptions] = useState(() => {
  const saved = localStorage.getItem("financeDescriptions");
  return saved ? JSON.parse(saved) : FINANCE_DESCRIPTION_OPTIONS.map((option) => option.text);
});

const [rentDescriptions, setRentDescriptions] = useState(() => {
  const saved = localStorage.getItem("rentDescriptions");
  return saved ? JSON.parse(saved) : RENT_DESCRIPTION_OPTIONS.map((option) => option.text);
});

  const [copyMessage, setCopyMessage] = useState("");

useEffect(() => {
  localStorage.setItem("financeDescriptions", JSON.stringify(financeDescriptions));
}, [financeDescriptions]);

useEffect(() => {
  localStorage.setItem("rentDescriptions", JSON.stringify(rentDescriptions));
}, [rentDescriptions]);

function handleFinanceDescriptionSelect(index) {
  setSelectedFinanceDescriptionIndex(index);
}

function handleRentDescriptionSelect(index) {
  setSelectedRentDescriptionIndex(index);
}

  async function copyReelDescription(reel) {
    const type = reel.pipeline === "rent2buy" ? "rent2buy" : "finance";
const template =
  type === "rent2buy"
    ? rentDescriptions[selectedRentDescriptionIndex]
    : financeDescriptions[selectedFinanceDescriptionIndex];
  const reelId = reel.creativeId || reel.id || "unknown";
  const text = fillDescriptionTemplate(template, reelId, reel);

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand("copy");
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

async function handleDownloadWithDescription(reel) {
  const copied = await copyReelDescription(reel);

  setCopyMessage(
    copied
      ? "Caption copied. Reel downloaded."
      : "Reel downloaded. Caption could not auto-copy."
  );

  props.onDownloadReel(reel);
}

async function handleDownloadAllFacebookMp4() {
  const reels = [...(props.todayReels || [])];
  if (!reels.length || mp4BatchRunning) return;

  setMp4BatchRunning(true);
  setCopyMessage("");
  setMp4ProgressMessage(`Converting 0 of ${reels.length}`);
  setMp4Statuses(
    reels.reduce((statuses, reel) => {
      statuses[reel.id] = { state: "Queued", error: "" };
      return statuses;
    }, {})
  );

  for (let index = 0; index < reels.length; index += 1) {
    const reel = reels[index];
    setMp4ProgressMessage(`Converting ${index + 1} of ${reels.length}`);
    setMp4Statuses((current) => ({
      ...current,
      [reel.id]: { state: "Converting", error: "" },
    }));

    try {
      await copyReelDescription(reel);
      await downloadFacebookMp4Reel(reel, {
        onDownloading: () => {
          setMp4Statuses((current) => ({
            ...current,
            [reel.id]: { state: "Downloading", error: "" },
          }));
        },
      });
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      setMp4Statuses((current) => ({
        ...current,
        [reel.id]: { state: "Complete", error: "" },
      }));
    } catch (error) {
      setMp4Statuses((current) => ({
        ...current,
        [reel.id]: {
          state: "Failed",
          error: error instanceof Error ? error.message : "Could not convert this reel.",
        },
      }));
    }
  }

  setMp4ProgressMessage(`Converting ${reels.length} of ${reels.length}`);
  setMp4BatchRunning(false);
}

  return (
  <div className="page-stack">
    <ReelStudioHero />

    {copyMessage && (
      <div className="notice notice--success">
        {copyMessage}
      </div>
    )}

    <DailyReelFactoryPanel {...props} todayReelsCount={props.todayReels.length} />

<ReelDescriptionPanel
  {...props}
  financeDescriptions={financeDescriptions}
  rentDescriptions={rentDescriptions}
  setFinanceDescriptions={setFinanceDescriptions}
  setRentDescriptions={setRentDescriptions}  

  financeOptions={FINANCE_DESCRIPTION_OPTIONS}
  rentOptions={RENT_DESCRIPTION_OPTIONS}
  selectedFinanceIndex={selectedFinanceDescriptionIndex}
  selectedRentIndex={selectedRentDescriptionIndex}
  onSelectFinance={handleFinanceDescriptionSelect}
  onSelectRent={handleRentDescriptionSelect}
/>  

    <TodayReelsSection
      {...props}
      onDownloadReel={handleDownloadWithDescription}
      onDownloadAllFacebookMp4={handleDownloadAllFacebookMp4}
      mp4Statuses={mp4Statuses}
      mp4BatchRunning={mp4BatchRunning}
      mp4ProgressMessage={mp4ProgressMessage}
    />
   </div>
);
}
