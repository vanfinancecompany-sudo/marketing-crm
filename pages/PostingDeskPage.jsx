import { useEffect, useMemo, useState } from "react";
import { londonDateKey } from "../lib/marketingDailyOperations.js";
import {
  getRecentPostingHistory,
  recordDailyMarketingActivity,
} from "../services/marketingDailyOperations.js";
import { formatDateShort } from "../utils/creativeUtils.js";

const POSTING_HISTORY_DAYS = 180;
const FACEBOOK_URLS = {
  "Van Finance Facebook": "https://www.facebook.com/VanFinance",
  "Rent2Buy Facebook": "https://www.facebook.com/profile.php?id=100076904157939",
};

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
  return destination === "Facebook Marketplace" ? "Open Marketplace" : "Prepare + Open Facebook";
}

function getPostingPipelineLabel(destination, vehicle) {
  if (destination === "Van Finance Facebook") return "Finance";
  if (destination === "Rent2Buy Facebook" || destination === "Facebook Marketplace") return "Rent2Buy";
  return vehicle.pipeline === "rent2buy" ? "Rent2Buy" : "Finance";
}

function isRentPostingDestination(destination) {
  return destination === "Rent2Buy Facebook" || destination === "Facebook Marketplace";
}

function isFacebookPageDestination(destination) {
  return destination === "Van Finance Facebook" || destination === "Rent2Buy Facebook";
}

function getActivityType(destination) {
  if (destination === "Van Finance Facebook") return "van_finance_facebook_post";
  if (destination === "Rent2Buy Facebook") return "rent2buy_facebook_post";
  return "";
}

function getPostingPriceFields(vehicle, destination) {
  if (isRentPostingDestination(destination)) {
    const rentData = vehicle.rent2buyData || vehicle;
    return [
      rentData.initialRental || rentData.price || "Initial rental available",
      rentData.monthly || "Monthly rental available",
    ];
  }

  return [
    vehicle.price || "Finance price available",
    vehicle.salePrice || "Finance monthly options available",
  ];
}

function postingAdvertImageUrl(vehicle, postingDestination) {
  const rentData = vehicle.rent2buyData || vehicle;
  const imageVehicle = isRentPostingDestination(postingDestination) ? rentData : vehicle;
  return (
    imageVehicle.image ||
    imageVehicle.picture ||
    imageVehicle.photo ||
    imageVehicle.mainImage ||
    imageVehicle.imageUrl ||
    ""
  );
}

function PostingAdvertImage({ vehicle, postingDestination }) {
  const imageSrc = postingAdvertImageUrl(vehicle, postingDestination);

  if (imageSrc) {
    return <img src={imageSrc} alt={vehicle.name || vehicle.reg || "Vehicle"} className="posting-card__image" />;
  }

  return <div className="posting-card__image posting-card__image--empty">No vehicle image</div>;
}

function normalizeRegistration(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function vehiclePostingKey(vehicle) {
  const registration = normalizeRegistration(
    vehicle?.registration || vehicle?.reg || vehicle?.title || vehicle?.name,
  );
  if (registration) return `reg:${registration}`;
  const id = String(vehicle?.id || vehicle?.vehicle_id || "").trim();
  return id ? `id:${id}` : "";
}

function historyPostingKey(row) {
  const metadata = row?.metadata || {};
  const registration = normalizeRegistration(metadata.registration || metadata.reg);
  if (registration) return `reg:${registration}`;
  const id = String(metadata.vehicle_id || "").trim();
  return id ? `id:${id}` : "";
}

function historyDestination(row) {
  const explicit = String(row?.metadata?.destination || "").trim();
  if (explicit) return explicit;
  if (row?.activity_type === "van_finance_facebook_post") return "Van Finance Facebook";
  if (row?.activity_type === "rent2buy_facebook_post") return "Rent2Buy Facebook";
  return "";
}

function dateKeyDaysAgo(days) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function daysSince(value) {
  const timestamp = new Date(value || 0).getTime();
  if (!timestamp) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)));
}

function recommendationReason(lastPostedAt) {
  if (!lastPostedAt) return "Never posted to this Facebook page";
  const elapsed = daysSince(lastPostedAt);
  if (elapsed === 0) return "Posted today";
  if (elapsed === 1) return "Last posted yesterday";
  return `Last posted ${elapsed} days ago`;
}

function historyRowToPostedItem(row) {
  const metadata = row?.metadata || {};
  const registration = normalizeRegistration(metadata.registration || metadata.reg);
  return {
    id: row?.id || row?.source_id || `${registration}-${row?.occurred_at}`,
    destination: historyDestination(row),
    postedAt: row?.occurred_at || row?.activity_date,
    vehicle: {
      id: metadata.vehicle_id || registration,
      reg: registration,
      registration,
      name: metadata.vehicle_name || metadata.title || registration || "Posted vehicle",
      description: metadata.vehicle_description || metadata.vehicle_name || registration || "",
      image: metadata.image_url || "",
      picture: metadata.image_url || "",
      pipeline: row?.activity_type === "rent2buy_facebook_post" ? "rent2buy" : "vanFinance",
    },
  };
}

async function copyCaption(caption) {
  if (!navigator.clipboard?.writeText) {
    window.prompt("Copy caption", caption);
    return;
  }
  await navigator.clipboard.writeText(caption).catch(() => {
    window.prompt("Copy caption", caption);
  });
}

async function downloadAdvertImage(vehicle, destination) {
  const imageUrl = postingAdvertImageUrl(vehicle, destination);
  if (!imageUrl) return;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Image returned HTTP ${response.status}`);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${String(vehicle.description || vehicle.name || vehicle.reg || "van")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "van"}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(imageUrl, "_blank", "noopener,noreferrer");
  }
}

function PostingVehicleCard({
  vehicle,
  accent,
  onPreview,
  onPostVehicle,
  onPrepareFacebook,
  onConfirmPosted,
  onSkip,
  postingDestination,
  caption,
  prepared,
  confirming,
  recommendationRank = 0,
  recommendationText = "",
}) {
  const [primaryPrice, secondaryPrice] = getPostingPriceFields(vehicle, postingDestination);
  const facebookPage = isFacebookPageDestination(postingDestination);

  return (
    <article className={`posting-card posting-card--${accent}`}>
      <PostingAdvertImage vehicle={vehicle} postingDestination={postingDestination} />
      <div className="posting-card__body">
        <div className="creative-card__tags">
          <span className="tag">{getPostingPipelineLabel(postingDestination, vehicle)}</span>
          <span className="tag">{vehicle.reg || vehicle.name}</span>
          {recommendationRank ? <span className="tag">Recommended #{recommendationRank}</span> : null}
        </div>
        <h3>{vehicle.name}</h3>
        <p>{vehicle.description || vehicle.spec || "Ready for today's advert cycle."}</p>
        {recommendationText ? <div className="notice">{recommendationText}</div> : null}
        <div className="posting-card__meta">
          <span>{primaryPrice}</span>
          <span>{secondaryPrice}</span>
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
          {facebookPage ? (
            <>
              <button
                className="button button--primary"
                onClick={() => onPrepareFacebook(vehicle, postingDestination, caption)}
                disabled={confirming}
              >
                {prepared ? "Prepared - Open Facebook Again" : getPostButtonLabel(postingDestination)}
              </button>
              {prepared ? (
                <button
                  className="button button--primary"
                  onClick={() => onConfirmPosted(vehicle, postingDestination)}
                  disabled={confirming}
                >
                  {confirming ? "Confirming..." : "Confirm Posted"}
                </button>
              ) : null}
            </>
          ) : (
            <button className="button button--primary" onClick={() => onPostVehicle(vehicle, postingDestination, caption)}>
              {getPostButtonLabel(postingDestination)}
            </button>
          )}
          <button className="button button--danger" onClick={() => onSkip(vehicle, postingDestination)} disabled={confirming}>
            Hide
          </button>
        </div>
      </div>
    </article>
  );
}

function PostedTodayCard({ item }) {
  const vehicle = item.vehicle;
  const accent = item.destination === "Rent2Buy Facebook" || item.destination === "Facebook Marketplace"
    ? "rent"
    : "finance";
  const pipelineLabel = getPostingPipelineLabel(item.destination, vehicle);
  const image = postingAdvertImageUrl(vehicle, item.destination);

  return (
    <article className={`posted-ready-card posted-ready-card--${accent}`}>
      {image ? <img src={image} alt={vehicle.name || vehicle.reg || "Posted vehicle"} /> : null}
      <div className="posted-ready-card__body">
        <div className="creative-card__tags">
          <span className="tag">{pipelineLabel} posted</span>
          {item.destination ? <span className="tag">{item.destination}</span> : null}
          <span className="tag">Confirmed</span>
        </div>
        <h3>{vehicle.reg || vehicle.name}</h3>
        <p>{vehicle.description || vehicle.spec || vehicle.name}</p>
        <div className="creative-card__meta">Posted: {formatDateShort(item.postedAt)}</div>
      </div>
    </article>
  );
}

function RecommendationsPanel({
  destination,
  vehicles,
  recommendationByKey,
  preparedKeys,
  confirmingKey,
  onPrepareFacebook,
  onConfirmPosted,
}) {
  if (!isFacebookPageDestination(destination) || !vehicles.length) return null;

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h3>Recommended Next 5</h3>
          <p>Never-posted vans first, then the vans that have gone longest without a Facebook post.</p>
        </div>
        <span className="status-pill">Smart rotation</span>
      </div>
      <div className="posted-ready-grid">
        {vehicles.map((vehicle) => {
          const key = vehiclePostingKey(vehicle);
          const recommendation = recommendationByKey.get(key);
          const prepared = preparedKeys.has(key);
          return (
            <article className="posted-ready-card" key={`recommend-${key}`}>
              <PostingAdvertImage vehicle={vehicle} postingDestination={destination} />
              <div className="posted-ready-card__body">
                <div className="creative-card__tags">
                  <span className="tag">#{recommendation?.rank || "-"}</span>
                  <span className="tag">{vehicle.reg || vehicle.name}</span>
                </div>
                <h3>{vehicle.name || vehicle.reg}</h3>
                <p>{recommendation?.reason || "Recommended for today's rotation"}</p>
                <div className="card-actions">
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => onPrepareFacebook(vehicle, destination, vehicle.caption || "")}
                    disabled={confirmingKey === key}
                  >
                    {prepared ? "Open Facebook Again" : "Prepare This Van"}
                  </button>
                  {prepared ? (
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => onConfirmPosted(vehicle, destination)}
                      disabled={confirmingKey === key}
                    >
                      {confirmingKey === key ? "Confirming..." : "Confirm Posted"}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PostingLane({
  title,
  vehicles,
  summary,
  accent,
  onPreview,
  onPostVehicle,
  onPrepareFacebook,
  onConfirmPosted,
  onSkip,
  postingDestination,
  recommendationByKey,
  preparedKeys,
  confirmingKey,
}) {
  return (
    <section className="panel posting-lane posting-lane--single">
      <div className="panel__header">
        <div>
          <h3>{title}: {vehicles.length} vans available today</h3>
          <p>Facebook pages are ranked by posting history. Confirmed posts leave today's list automatically.</p>
        </div>
      </div>

      <SummaryStrip summary={summary} accent={accent} />

      {vehicles.length === 0 ? (
        <div className="empty-state">No eligible vans in this lane right now.</div>
      ) : (
        <div className="posting-card-grid posting-card-grid--dense">
          {vehicles.map((vehicle) => {
            const key = vehiclePostingKey(vehicle);
            const recommendation = recommendationByKey.get(key);
            return (
              <PostingVehicleCard
                key={vehicle.id || key}
                vehicle={vehicle}
                accent={accent}
                caption={vehicle.caption || ""}
                onPreview={onPreview}
                onPostVehicle={onPostVehicle}
                onPrepareFacebook={onPrepareFacebook}
                onConfirmPosted={onConfirmPosted}
                onSkip={onSkip}
                postingDestination={postingDestination}
                prepared={preparedKeys.has(key)}
                confirming={confirmingKey === key}
                recommendationRank={recommendation?.rank || 0}
                recommendationText={recommendation?.reason || ""}
              />
            );
          })}
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
  const [postingHistory, setPostingHistory] = useState([]);
  const [historyError, setHistoryError] = useState("");
  const [preparedKeys, setPreparedKeys] = useState(() => new Set());
  const [confirmingKey, setConfirmingKey] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    let active = true;
    if (!isFacebookPageDestination(destination)) {
      setPostingHistory([]);
      setHistoryError("");
      return undefined;
    }

    getRecentPostingHistory(POSTING_HISTORY_DAYS)
      .then((result) => {
        if (!active) return;
        setPostingHistory(Array.isArray(result?.history) ? result.history : []);
        setHistoryError("");
      })
      .catch((error) => {
        if (!active) return;
        setPostingHistory([]);
        setHistoryError(error.message || "Could not load Facebook posting history.");
      });

    return () => {
      active = false;
    };
  }, [destination]);

  const destinationHistory = useMemo(
    () => postingHistory.filter((row) => historyDestination(row) === destination),
    [postingHistory, destination],
  );

  const lastPostedByKey = useMemo(() => {
    const latest = new Map();
    for (const row of destinationHistory) {
      const key = historyPostingKey(row);
      if (!key) continue;
      const timestamp = new Date(row.occurred_at || row.activity_date || 0).getTime();
      if (!timestamp) continue;
      if (!latest.has(key) || timestamp > latest.get(key)) latest.set(key, timestamp);
    }
    return latest;
  }, [destinationHistory]);

  const todayKey = londonDateKey();
  const todayPostedKeys = useMemo(() => {
    const keys = new Set(
      destinationHistory
        .filter((row) => row.activity_date === todayKey)
        .map(historyPostingKey)
        .filter(Boolean),
    );
    for (const item of postedToday || []) {
      if (item.destination !== destination) continue;
      const key = vehiclePostingKey(item.vehicle);
      if (key) keys.add(key);
    }
    return keys;
  }, [destinationHistory, destination, postedToday, todayKey]);

  const rankedVehicles = useMemo(() => {
    if (!isFacebookPageDestination(destination)) return vehicles;
    return [...vehicles]
      .filter((vehicle) => !todayPostedKeys.has(vehiclePostingKey(vehicle)))
      .sort((first, second) => {
        const firstLast = lastPostedByKey.get(vehiclePostingKey(first)) || 0;
        const secondLast = lastPostedByKey.get(vehiclePostingKey(second)) || 0;
        if (!firstLast && secondLast) return -1;
        if (firstLast && !secondLast) return 1;
        if (firstLast !== secondLast) return firstLast - secondLast;
        return String(first.reg || first.name || "").localeCompare(String(second.reg || second.name || ""));
      });
  }, [destination, vehicles, todayPostedKeys, lastPostedByKey]);

  const recommendations = useMemo(
    () => (isFacebookPageDestination(destination) ? rankedVehicles.slice(0, 5) : []),
    [destination, rankedVehicles],
  );

  const recommendationByKey = useMemo(() => {
    const result = new Map();
    recommendations.forEach((vehicle, index) => {
      const key = vehiclePostingKey(vehicle);
      const lastPosted = lastPostedByKey.get(key) || 0;
      result.set(key, {
        rank: index + 1,
        reason: recommendationReason(lastPosted),
      });
    });
    return result;
  }, [recommendations, lastPostedByKey]);

  const effectiveSummary = useMemo(() => {
    if (!isFacebookPageDestination(destination)) {
      return { ...summary, totalVisible: rankedVehicles.length };
    }
    const weekStart = dateKeyDaysAgo(6);
    const dailyKeys = new Set();
    const weeklyRows = [];
    for (const row of destinationHistory) {
      if (row.activity_date === todayKey) {
        dailyKeys.add(row.source_id || row.id || `${historyPostingKey(row)}:${row.activity_date}`);
      }
      if (row.activity_date >= weekStart && row.activity_date <= todayKey) weeklyRows.push(row);
    }
    for (const item of postedToday || []) {
      if (item.destination === destination) {
        dailyKeys.add(`legacy:${vehiclePostingKey(item.vehicle)}`);
      }
    }
    return {
      ...summary,
      dailyAdvertised: dailyKeys.size,
      weeklyAdvertised: weeklyRows.length,
      totalVisible: rankedVehicles.length,
    };
  }, [destination, destinationHistory, postedToday, rankedVehicles.length, summary, todayKey]);

  const destinationPostedToday = useMemo(() => {
    if (!isFacebookPageDestination(destination)) {
      return (postedToday || []).filter((item) => item.destination === destination);
    }

    const items = destinationHistory
      .filter((row) => row.activity_date === todayKey)
      .map(historyRowToPostedItem);
    const seen = new Set(items.map((item) => vehiclePostingKey(item.vehicle)).filter(Boolean));
    for (const item of postedToday || []) {
      if (item.destination !== destination) continue;
      const key = vehiclePostingKey(item.vehicle);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      items.push(item);
    }
    return items;
  }, [destination, destinationHistory, postedToday, todayKey]);

  async function prepareFacebookVehicle(vehicle, postingDestination, caption) {
    const key = vehiclePostingKey(vehicle);
    setActionMessage("");
    try {
      await copyCaption(caption || "");
      await downloadAdvertImage(vehicle, postingDestination);
      window.open(FACEBOOK_URLS[postingDestination], "_blank", "noopener,noreferrer");
      setPreparedKeys((current) => new Set([...current, key]));
      setActionMessage(
        `${vehicle.reg || vehicle.name || "Vehicle"} prepared. Post it on Facebook, then press Confirm Posted here.`,
      );
    } catch (error) {
      window.open(FACEBOOK_URLS[postingDestination], "_blank", "noopener,noreferrer");
      setPreparedKeys((current) => new Set([...current, key]));
      setActionMessage(error.message || "Facebook opened. Confirm here only after the post is live.");
    }
  }

  async function confirmFacebookPosted(vehicle, postingDestination) {
    const activityType = getActivityType(postingDestination);
    const key = vehiclePostingKey(vehicle);
    if (!activityType || !key || confirmingKey) return;

    const registration = normalizeRegistration(vehicle.registration || vehicle.reg || vehicle.title || vehicle.name);
    const sourceId = `${todayKey}::${key}::${postingDestination}`;
    const occurredAt = new Date().toISOString();
    const metadata = {
      vehicle_id: vehicle.id || null,
      registration,
      destination: postingDestination,
      vehicle_name: vehicle.name || vehicle.vanDescription || vehicle.description || registration,
      vehicle_description: vehicle.description || vehicle.vanDescription || vehicle.spec || "",
      image_url: postingAdvertImageUrl(vehicle, postingDestination),
    };

    setConfirmingKey(key);
    setActionMessage("");
    try {
      await recordDailyMarketingActivity(activityType, {
        activityDate: todayKey,
        source: "posting_desk",
        sourceId,
        metadata,
      });
      const localRow = {
        id: `confirmed-${sourceId}`,
        activity_date: todayKey,
        activity_type: activityType,
        source: "posting_desk",
        source_id: sourceId,
        metadata,
        occurred_at: occurredAt,
      };
      setPostingHistory((current) => [
        localRow,
        ...current.filter((row) => row.source_id !== sourceId),
      ]);
      setPreparedKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setActionMessage(
        `${registration || vehicle.name || "Vehicle"} confirmed posted. It will stay out of today's list and return to the rotation later.`,
      );
    } catch (error) {
      setActionMessage(
        `${error.message || "Could not confirm the post."} The van has not been removed from today's list.`,
      );
    } finally {
      setConfirmingKey("");
    }
  }

  if (vehiclesLoading) {
    return <div className="empty-state">Loading live stock...</div>;
  }

  if (vehiclesError) {
    return <div className="empty-state">Unable to load stock: {vehiclesError}</div>;
  }

  return (
    <div className="page-stack">
      <section className={`panel posting-destination-hero posting-destination-hero--${summary.accent || "default"}`}>
        <div className="panel__header">
          <div>
            <h3>{title}</h3>
            <p>
              {isFacebookPageDestination(destination)
                ? "Prepare the advert, post it on Facebook, then confirm it here. Only confirmed posts count towards your daily total."
                : `Dedicated stock posting page for ${destination}.`}
            </p>
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

        {historyError ? <div className="notice notice--error">{historyError}</div> : null}
        {actionMessage ? <div className="notice">{actionMessage}</div> : null}
        {isFacebookPageDestination(destination) ? (
          <div className="notice">
            Confirmed posts are no longer permanently hidden. The separate Hide button is only for vans you deliberately want removed from this posting lane.
          </div>
        ) : null}

        <section className="posted-ready-section">
          <div className="panel__header">
            <div>
              <h3>Posted Today</h3>
              <p>Only posts you have explicitly confirmed are counted here.</p>
            </div>
            <span className="status-pill">{destinationPostedToday.length} posted today</span>
          </div>

          {destinationPostedToday.length === 0 ? (
            <div className="empty-state">No confirmed posts to this destination today.</div>
          ) : (
            <div className="posted-ready-grid">
              {destinationPostedToday.map((item) => (
                <PostedTodayCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
      </section>

      <RecommendationsPanel
        destination={destination}
        vehicles={recommendations}
        recommendationByKey={recommendationByKey}
        preparedKeys={preparedKeys}
        confirmingKey={confirmingKey}
        onPrepareFacebook={prepareFacebookVehicle}
        onConfirmPosted={confirmFacebookPosted}
      />

      <PostingLane
        title={title}
        vehicles={rankedVehicles}
        summary={effectiveSummary}
        accent={summary.accent}
        postingDestination={destination}
        onPreview={(vehicle, postingDestination, caption) =>
          setPreviewItem({ vehicle, destination: postingDestination, caption })
        }
        onPostVehicle={onPostVehicle}
        onPrepareFacebook={prepareFacebookVehicle}
        onConfirmPosted={confirmFacebookPosted}
        onSkip={onSkip}
        recommendationByKey={recommendationByKey}
        preparedKeys={preparedKeys}
        confirmingKey={confirmingKey}
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
              <PostingAdvertImage
                vehicle={previewItem.vehicle}
                postingDestination={previewItem.destination}
              />
              <div>
                <h3>{previewItem.vehicle.name}</h3>
                <div className="posting-card__meta">
                  {getPostingPriceFields(previewItem.vehicle, previewItem.destination).map((value) => (
                    <span key={value}>{value}</span>
                  ))}
                </div>
                <pre className="preview-modal__caption">{previewItem.caption}</pre>
                <div className="card-actions">
                  <button
                    className="button button--primary"
                    onClick={() => {
                      if (isFacebookPageDestination(previewItem.destination)) {
                        prepareFacebookVehicle(previewItem.vehicle, previewItem.destination, previewItem.caption);
                      } else {
                        onPostVehicle(previewItem.vehicle, previewItem.destination, previewItem.caption);
                      }
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
