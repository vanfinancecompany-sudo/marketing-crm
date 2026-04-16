import FilterBar from "../components/FilterBar.jsx";
import {
  financeReelHooks,
  reelHookModes,
  reelSources,
  reelTypes,
  rentReelHooks,
} from "../data/mockData.js";

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
    <section className="panel reel-factory-panel">
      <div className="panel__header">
        <div>
          <h3>Daily Reel Factory</h3>
          <p>Generate a batch of daily reels from live stock or uploaded images.</p>
        </div>
        <span className="status-pill">{todayReelsCount} today</span>
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
  onDeleteReel,
  onClearReels,
}) {
  return (
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Today's Reels</h3>
            <p>Generated reel videos stay visible here for this session with preview and download controls.</p>
          </div>
          <div className="card-actions">
            <button className="button button--ghost" onClick={onDownloadAll} disabled={!todayReels.length}>
              Download All
            </button>
            <button className="button button--danger" onClick={onClearReels} disabled={!todayReels.length}>
              Clear Today's Reels
            </button>
          </div>
        </div>

        {todayReels.length === 0 ? (
          <div className="empty-state">No reels generated today.</div>
        ) : (
          <div className="today-reel-grid">
            {todayReels.map((reel) => (
              <article
                className={`creative-card creative-card--${reel.pipeline === "rent2buy" ? "rent" : "finance"} today-reel-card`}
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
                        <div className="reel-frame__subtext">{reel.priceLine}</div>
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
                    <span className="tag">{reel.pipeline === "rent2buy" ? "Rent2Buy reel" : "Finance reel"}</span>
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

export default function ReelFactoryPage(props) {
  return (
    <div className="page-stack">
      <DailyReelFactoryPanel {...props} todayReelsCount={props.todayReels.length} />
      <TodayReelsSection {...props} />
    </div>
  );
}
