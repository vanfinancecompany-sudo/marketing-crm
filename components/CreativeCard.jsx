import { formatDateShort } from "../utils/creativeUtils.js";

export default function CreativeCard({
  creative,
  actions,
}) {
  const pipelineLabel = creative.vehicle.pipeline === "rent2buy" ? "Rent2Buy" : "Van Finance";
  const registration = creative.vehicle.reg || "No reg";
  const pipelineClass = creative.vehicle.pipeline === "rent2buy" ? "rent" : "finance";

  return (
    <article className={`creative-card creative-card--${pipelineClass}`}>
      <div className="creative-preview">
        {creative.mediaUrl ? (
          <video
            src={creative.mediaUrl}
            poster={creative.posterUrl || creative.vehicle.image}
            className="creative-preview__image"
            controls
            playsInline
          />
        ) : creative.vehicle.image ? (
          <img src={creative.vehicle.image} alt={creative.vehicle.name} className="creative-preview__image" />
        ) : null}
        <div className="creative-preview__overlay">
          <div className="creative-preview__chip">{creative.templateType}</div>
          <div className="creative-preview__headline">{creative.preview.headline}</div>
          <div className="creative-preview__subline">{creative.preview.subline}</div>
        </div>
      </div>

      <div className="creative-card__body">
        <div className="creative-card__tags">
          <span className="tag">{pipelineLabel}</span>
          <span className="tag">{registration}</span>
          <span className="tag">{creative.mediaUrl ? "Saved video" : "Reel record"}</span>
          <span className="tag">{formatDateShort(creative.createdAt)}</span>
        </div>

        <h3>{creative.vehicle.name}</h3>
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
