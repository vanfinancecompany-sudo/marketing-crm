export default function VehicleCard({
  vehicle,
  onGenerateReel,
  onViewCreatives,
  onSelect,
  selected = false,
  selectable = false,
  compact = false,
  reelActionLock = null,
  displayMode,
}) {
  const resolvedDisplayMode = displayMode || (vehicle.pipeline === "rent2buy" ? "rent2buy" : "finance");
  const isRentDisplay = resolvedDisplayMode === "rent2buy";
  const pipelineLabel = isRentDisplay ? "Rent2Buy" : "Van Finance";
  const displayReg = vehicle.reg || "No reg";
  const priceLabel = isRentDisplay ? "Initial rental" : "Price";
  const monthlyLabel = isRentDisplay ? "Monthly rental" : "Finance monthly";
  const displayPrice = isRentDisplay
    ? vehicle.initialRental || vehicle.price || "Initial rental available"
    : vehicle.pipeline === "rent2buy" ? "Finance price available" : vehicle.price || "Finance price available";
  const displayMonthly = isRentDisplay
    ? vehicle.monthly || "Monthly rental available"
    : vehicle.salePrice || "Finance monthly options available";
  const imageSrc =
    vehicle.image ||
    vehicle.picture ||
    vehicle.photo ||
    vehicle.mainImage ||
    vehicle.imageUrl ||
    "";
  const reelLocked = Boolean(reelActionLock?.locked);
  const lockUntil = reelActionLock?.until ? new Date(reelActionLock.until) : null;
  const lockLabel = lockUntil
    ? `Reel locked until ${lockUntil.toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
    : "Reel locked for 72 hours";

  return (
    <article
      className={selected ? "vehicle-card is-selected" : "vehicle-card"}
      onClick={selectable ? () => onSelect?.(vehicle) : undefined}
    >
      {selectable ? (
        <button
          className={selected ? "vehicle-select is-selected" : "vehicle-select"}
          type="button"
          disabled={reelLocked}
          onClick={(event) => {
            event.stopPropagation();
            if (reelLocked) return;
            onSelect?.(vehicle);
          }}
          aria-label={selected ? "Deselect vehicle" : "Select vehicle"}
          title={reelLocked ? lockLabel : undefined}
        >
          {reelLocked ? "Locked" : selected ? "Selected" : "Select"}
        </button>
      ) : null}

      {imageSrc ? (
        <img src={imageSrc} alt={vehicle.name} className="vehicle-card__image" />
      ) : (
        <div className="vehicle-card__image vehicle-card__image--empty" aria-label={vehicle.name}>
          No vehicle image
        </div>
      )}

      <div className="vehicle-card__body">
        <div className="vehicle-card__pipeline">{pipelineLabel}</div>
        <h3>{vehicle.name}</h3>
        <div className="vehicle-card__meta">Reg: {displayReg}</div>
        <div className="vehicle-card__meta">{priceLabel}: {displayPrice}</div>
        <div className="vehicle-card__meta">{monthlyLabel}: {displayMonthly}</div>
        {reelLocked ? <div className="vehicle-card__meta">{lockLabel}</div> : null}

        {!compact ? (
          <div className="card-actions">
            <button
              className="button button--primary"
              disabled={reelLocked}
              onClick={(event) => {
                event.stopPropagation();
                if (reelLocked) return;
                onGenerateReel?.(vehicle);
              }}
              title={reelLocked ? lockLabel : undefined}
            >
              {reelLocked ? "Reel Locked" : "Generate Reel"}
            </button>
            <button
              className="button button--ghost"
              onClick={(event) => {
                event.stopPropagation();
                onViewCreatives?.(vehicle);
              }}
            >
              View Creatives
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
