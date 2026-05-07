import { formatDateShort } from "../utils/creativeUtils.js";

export default function CreativeCard({
  creative,
  actions,
}) {
  const vehicle = creative.currentStockVehicle || creative.vehicle || {};
  const pipelineLabel = vehicle.pipeline === "rent2buy" ? "Rent2Buy" : "Van Finance";
  const registration = vehicle.reg || vehicle.registration || creative.vehicle?.reg || "No reg";
  const pipelineClass = vehicle.pipeline === "rent2buy" ? "rent" : "finance";
  const previewImage =
    creative.posterUrl ||
    vehicle.image ||
    vehicle.imageUrl ||
    vehicle.photo ||
    vehicle.picture ||
    creative.vehicle?.image ||
    creative.image ||
    "";
  const cleanTemplateLabel = pipelineLabel;
  const headline = cleanPreviewText(creative.preview?.headline, cleanTemplateLabel);
  const subline = cleanPreviewText(creative.preview?.subline, "");
  const vehicleName = vehicle.name || vehicle.title || creative.vehicle?.name || "Vehicle";

  return (
    <article className={`creative-card creative-card--${pipelineClass}`}>
      <div className="creative-preview">
        {creative.mediaUrl ? (
          <video
            src={creative.mediaUrl}
            poster={previewImage}
            className="creative-preview__image"
            controls
            playsInline
          />
        ) : previewImage ? (
          <img src={previewImage} alt={vehicleName} className="creative-preview__image" />
        ) : null}
        <div className="creative-preview__overlay">
          <div className="creative-preview__chip">{cleanTemplateLabel}</div>
          <div className="creative-preview__headline">{headline}</div>
          <div className="creative-preview__subline">{subline}</div>
        </div>
      </div>

      <div className="creative-card__body">
        <div className="creative-card__tags">
          <span className="tag">{pipelineLabel}</span>
          <span className="tag">{registration}</span>
          <span className="tag">{creative.mediaUrl ? "Saved video" : "Reel record"}</span>
          <span className="tag">{formatDateShort(creative.createdAt)}</span>
        </div>

        <h3>{vehicleName}</h3>
        <div className="creative-card__meta-grid">
          <span>Hook: {creative.hookStyle}</span>
          <span>CTA: {creative.cta}</span>
          <span>File: {creative.downloadName || "Video generated this session"}</span>
        </div>

        <div className="creative-card__caption">{creative.caption}</div>

        <div className="card-actions">{actions}</div>
      </div>
    </article>
  );
}

function cleanPreviewText(value, fallback) {
  const text = String(value || "").trim();
  if (!text || /\b(deal hook|finance - deal hook|rent2buy - deal hook)\b/i.test(text)) {
    return fallback;
  }
  return text;
}
