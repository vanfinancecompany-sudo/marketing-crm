export default function VehicleCard({
  vehicle,
  onGenerateReel,
  onViewCreatives,
  onSelect,
  selected = false,
  selectable = false,
  compact = false,
}) {
  const pipelineLabel = vehicle.pipeline === "rent2buy" ? "Rent2Buy" : "Van Finance";
  const displayReg = vehicle.reg || "No reg";

  return (
    <article
      className={selected ? "vehicle-card is-selected" : "vehicle-card"}
      onClick={selectable ? () => onSelect?.(vehicle) : undefined}
    >
      {selectable ? (
        <button
          className={selected ? "vehicle-select is-selected" : "vehicle-select"}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(vehicle);
          }}
          aria-label={selected ? "Deselect vehicle" : "Select vehicle"}
        >
          {selected ? "Selected" : "Select"}
        </button>
      ) : null}

      <img src={vehicle.image} alt={vehicle.name} className="vehicle-card__image" />

      <div className="vehicle-card__body">
        <div className="vehicle-card__pipeline">{pipelineLabel}</div>
        <h3>{vehicle.name}</h3>
        <div className="vehicle-card__meta">Reg: {displayReg}</div>
        <div className="vehicle-card__meta">Price: {vehicle.price}</div>
        <div className="vehicle-card__meta">Monthly: {vehicle.monthly}</div>

        {!compact ? (
          <div className="card-actions">
            <button className="button button--primary" onClick={() => onGenerateReel?.(vehicle)}>
              Generate Reel
            </button>
            <button className="button button--ghost" onClick={() => onViewCreatives?.(vehicle)}>
              View Creatives
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
