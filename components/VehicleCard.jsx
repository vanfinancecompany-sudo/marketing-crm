export default function VehicleCard({
  vehicle,
  onGenerateReel,
  onViewCreatives,
  onSelect,
  selected = false,
  selectable = false,
  compact = false,
  reelActionLock = null,
}) {
  const pipelineLabel = vehicle.pipeline === "rent2buy" ? "Rent2Buy" : "Van Finance";
  const displayReg = vehicle.reg || "No reg";
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

      <img src={vehicle.image} alt={vehicle.name} className="vehicle-card__image" />

      <div className="vehicle-card__body">
        <div className="vehicle-card__pipeline">{pipelineLabel}</div>
        <h3>{vehicle.name}</h3>
        <div className="vehicle-card__meta">Reg: {displayReg}</div>
        <div className="vehicle-card__meta">Price: {vehicle.price}</div>
        <div className="vehicle-card__meta">Monthly: {vehicle.monthly}</div>
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
