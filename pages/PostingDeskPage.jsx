import { useState } from "react";
import { formatDateShort } from "../utils/creativeUtils.js";

function SummaryStrip({ summary, accent }) {
  const items = [
    ["Daily advertised vans", summary.dailyAdvertised],
    ["Weekly advertised vans", summary.weeklyAdvertised],
    ["Total visible vans", summary.totalVisible],
    ["Total hidden vans", summary.totalHidden],
  ];

  return (
    <div className="posting-summary-strip">
      {items.map(([label, value]) => (
        <div className={`posting-summary-card posting-summary-card--${accent}`} key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function getSyncButtonLabel(destination) {
  return destination === "Van Finance Facebook" ? "Sync Finance Vans" : "Sync Rent2Buy Vans";
}

function getPostButtonLabel(destination) {
  return destination === "Facebook Marketplace" ? "Open Marketplace" : "Post to Facebook";
}

function PostingVehicleCard({
  vehicle,
  accent,
  onPreview,
  onPostVehicle,
  onSkip,
  postingDestination,
  caption,
}) {
  return (
    <article className={`posting-card posting-card--${accent}`}>
      <img src={vehicle.image} alt={vehicle.name} className="posting-card__image" />
      <div className="posting-card__body">
        <div className="creative-card__tags">
          <span className="tag">{vehicle.pipeline === "rent2buy" ? "Rent2Buy" : "Finance"}</span>
          <span className="tag">{vehicle.reg || vehicle.name}</span>
        </div>
        <h3>{vehicle.name}</h3>
        <p>{vehicle.description || vehicle.spec || "Ready for today's advert cycle."}</p>
        <div className="posting-card__meta">
          <span>{vehicle.price || "Price on request"}</span>
          <span>{vehicle.monthly || "Monthly available"}</span>
        </div>
        <div className="creative-card__tags">
          <span className={`tag posting-destination-tag posting-destination-tag--${accent}`}>
            {postingDestination}
          </span>
        </div>
        <div className="posting-card__caption">{caption}</div>
        <div className="card-actions">
          <button className="button button--ghost" onClick={() => onPreview(vehicle, postingDestination, caption)}>
            Preview
          </button>
          <button className="button button--primary" onClick={() => onPostVehicle(vehicle, postingDestination, caption)}>
            {getPostButtonLabel(postingDestination)}
          </button>
          <button className="button button--danger" onClick={() => onSkip(vehicle, postingDestination)}>Hide</button>
        </div>
      </div>
    </article>
  );
}

function PostedTodayCard({ item }) {
  const vehicle = item.vehicle;
  const accent = vehicle.pipeline === "rent2buy" ? "rent" : "finance";

  return (
    <article className={`posted-ready-card posted-ready-card--${accent}`}>
      <img src={vehicle.image} alt={vehicle.name} />
      <div className="posted-ready-card__body">
        <div className="creative-card__tags">
          <span className="tag">{vehicle.pipeline === "rent2buy" ? "Rent2Buy posted" : "Finance posted"}</span>
          {item.destination ? <span className="tag">{item.destination}</span> : null}
          <span className="tag">Stock posted</span>
        </div>
        <h3>{vehicle.reg || vehicle.name}</h3>
        <p>{vehicle.description || vehicle.spec || vehicle.name}</p>
        <div className="creative-card__meta">Posted: {formatDateShort(item.postedAt)}</div>
      </div>
    </article>
  );
}

function PostingLane({
  title,
  vehicles,
  summary,
  accent,
  onPreview,
  onPostVehicle,
  onSkip,
  postingDestination,
}) {
  return (
    <section className="panel posting-lane posting-lane--single">
      <div className="panel__header">
        <div>
          <h3>{title}: {vehicles.length} vans today</h3>
          <p>Dense stock-posting cards for this destination only.</p>
        </div>
      </div>

      <SummaryStrip summary={summary} accent={accent} />

      {vehicles.length === 0 ? (
        <div className="empty-state">No eligible vans in this lane right now.</div>
      ) : (
        <div className="posting-card-grid posting-card-grid--dense">
          {vehicles.map((vehicle, index) => (
            <PostingVehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              accent={accent}
              caption={vehicle.caption || ""}
              onPreview={onPreview}
              onPostVehicle={onPostVehicle}
              onSkip={onSkip}
              postingDestination={postingDestination}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function PostingDeskPage({
  title,
  destination,
  vehicles,
  summary,
  postedToday,
  vehiclesLoading,
  vehiclesError,
  onPostVehicle,
  onSkip,
  onRefreshStock,
  onSyncStock,
  onShowHiddenAgain,
}) {
  const [previewItem, setPreviewItem] = useState(null);

  if (vehiclesLoading) {
    return <div className="empty-state">Loading live stock...</div>;
  }

  if (vehiclesError) {
    return <div className="empty-state">Unable to load stock: {vehiclesError}</div>;
  }

  const destinationPostedToday = postedToday.filter((item) => item.destination === destination);

  return (
    <div className="page-stack">
      <section className={`panel posting-destination-hero posting-destination-hero--${summary.accent || "default"}`}>
        <div className="panel__header">
          <div>
            <h3>{title}</h3>
            <p>Dedicated stock posting page for {destination}. Reels stay separate in Reel Factory and Creative Library.</p>
          </div>
          <div className="posting-page-actions">
            <button className="button button--ghost" onClick={onRefreshStock}>
              Refresh
            </button>
            <button className="button button--ghost" onClick={() => onSyncStock(destination)}>
              {getSyncButtonLabel(destination)}
            </button>
            <button className="button button--ghost" onClick={() => onShowHiddenAgain(destination)}>
              Show Hidden Again
            </button>
          </div>
        </div>

        <section className="posted-ready-section">
          <div className="panel__header">
            <div>
              <h3>Posted Today</h3>
              <p>Vehicles marked posted today for this destination.</p>
            </div>
            <span className="status-pill">{destinationPostedToday.length} posted today</span>
          </div>

          {destinationPostedToday.length === 0 ? (
            <div className="empty-state">No vehicles have been marked posted to this destination today.</div>
          ) : (
            <div className="posted-ready-grid">
              {destinationPostedToday.map((item) => (
                <PostedTodayCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
      </section>

      <PostingLane
        title={title}
        vehicles={vehicles}
        summary={summary}
        accent={summary.accent}
        postingDestination={destination}
        onPreview={(vehicle, postingDestination, caption) =>
          setPreviewItem({ vehicle, destination: postingDestination, caption })
        }
        onPostVehicle={onPostVehicle}
        onSkip={onSkip}
      />

      {previewItem ? (
        <div className="preview-modal" role="dialog" aria-modal="true">
          <div className="preview-modal__card">
            <div className="panel__header">
              <div>
                <h3>Preview</h3>
                <p>{previewItem.destination}</p>
              </div>
              <button className="button button--ghost" onClick={() => setPreviewItem(null)}>
                Close
              </button>
            </div>
            <div className="preview-modal__body">
              {previewItem.vehicle.image ? (
                <img
                  src={previewItem.vehicle.image}
                  alt={previewItem.vehicle.name}
                  className="preview-modal__image"
                />
              ) : null}
              <div>
                <h3>{previewItem.vehicle.name}</h3>
                <pre className="preview-modal__caption">{previewItem.caption}</pre>
                <div className="card-actions">
                  <button
                    className="button button--primary"
                    onClick={() => {
                      onPostVehicle(previewItem.vehicle, previewItem.destination, previewItem.caption);
                      setPreviewItem(null);
                    }}
                  >
                    {getPostButtonLabel(previewItem.destination)}
                  </button>
                  <button className="button button--danger" onClick={() => setPreviewItem(null)}>
                    Close Preview
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
