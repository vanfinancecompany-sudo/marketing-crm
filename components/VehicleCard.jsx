import {pendingRent2BuySpecialDeal} from "../lib/rent2BuyProtectedSpecialDeals.mjs";
export default function VehicleCard({
  vehicle,
  onGenerateReel,
  onViewCreatives,
  onSpecialDeal,
  specialDeal = null,
  onSelect,
  selected = false,
  selectable = false,
  compact = false,
  reelActionLock = null,
  displayMode,
  ignoreReelLock = false,
}) {
  const resolvedDisplayMode = displayMode || (vehicle.pipeline === "rent2buy" ? "rent2buy" : vehicle.pipeline === "cars" ? "cars" : "finance");
  const isRentDisplay = resolvedDisplayMode === "rent2buy";
  const isCarsDisplay = resolvedDisplayMode === "cars";
  const rentData = vehicle.rent2buyData || {};
  const displayVehicle = isRentDisplay ? { ...vehicle, ...rentData } : vehicle;
  const pipelineLabel = isRentDisplay ? "RENT2BUY" : isCarsDisplay ? "CAR FINANCE" : "VAN FINANCE";
  const displayReg = displayVehicle.reg || "No reg";
  const protectedSpecial = isRentDisplay ? pendingRent2BuySpecialDeal(displayReg) : null;
  const activeSpecial = protectedSpecial || (isRentDisplay && specialDeal?.enabled===true ? specialDeal : null);
  const priceLabel = isRentDisplay ? "Initial rental" : "Price";
  const monthlyLabel = isRentDisplay ? "Monthly rental" : "Finance monthly";
  const displayPrice = isRentDisplay
    ? activeSpecial ? `£${activeSpecial.initialExVat.toLocaleString("en-GB")} + VAT` : displayVehicle.initialRental || displayVehicle.price || "Initial rental available"
    : vehicle.price || "Finance price available";
  const displayMonthly = isRentDisplay
    ? activeSpecial ? `£${activeSpecial.monthlyExVat.toLocaleString("en-GB")} + VAT` : displayVehicle.monthly || "Monthly rental available"
    : vehicle.salePrice || "Finance monthly options available";
  const imageSrc =
    displayVehicle.image ||
    displayVehicle.picture ||
    displayVehicle.photo ||
    displayVehicle.mainImage ||
    displayVehicle.imageUrl ||
    "";
  const lockActive = Boolean(reelActionLock?.locked);
  const reelLocked = lockActive && !ignoreReelLock;
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
        <img src={imageSrc} alt={displayVehicle.name} className="vehicle-card__image" />
      ) : (
        <div className="vehicle-card__image vehicle-card__image--empty" aria-label={displayVehicle.name}>
          No vehicle image
        </div>
      )}

      <div className="vehicle-card__body">
        <div className="vehicle-card__pipeline">{pipelineLabel}</div>
        <h3>{displayVehicle.name}</h3>
        <div className="vehicle-card__meta">Reg: {displayReg}</div>
        <div className="vehicle-card__meta">{priceLabel}: {displayPrice}</div>
        <div className="vehicle-card__meta">{monthlyLabel}: {displayMonthly}</div>
        {lockActive ? (
          <div className="vehicle-card__meta">
            {ignoreReelLock ? "Reel lock bypass enabled" : lockLabel}
          </div>
        ) : null}

        {!compact ? (
          <div className="card-actions">
            {isRentDisplay&&onSpecialDeal?<button className="button button--ghost" aria-pressed={Boolean(activeSpecial)} title={protectedSpecial?"Protected existing special deal":activeSpecial?"Active manual special":"Review a manual special deal"} onClick={event=>{event.stopPropagation();onSpecialDeal(vehicle);}}>{activeSpecial?"✓ Special Deal":"Special Deal"}</button>:null}
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
