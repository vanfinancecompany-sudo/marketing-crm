import VehicleCard from "../components/VehicleCard.jsx";
import FilterBar from "../components/FilterBar.jsx";

export default function StockPage({
  vehicles,
  vehiclesLoading,
  vehiclesError,
  filters,
  onFiltersChange,
  onGenerateReel,
  onViewCreatives,
  selectedVehicleIds = [],
  onToggleVehicle,
  onAddSelectedToQueue,
  reelActionLocks = {},
}) {
  const selectedCount = selectedVehicleIds.length;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Stock</h3>
            <p>Browse vehicles and jump straight into creative generation.</p>
          </div>
          <span className="status-pill">{vehicles.length} visible</span>
        </div>

        <FilterBar filters={filters} onChange={onFiltersChange} />

        <div className="selection-summary stock-selection-summary">
          <strong>{selectedCount} selected for manual reel queue</strong>
          <span>Pick 10-15 vehicles, then send them to the Finance or Rent2Buy Reel Factory queue.</span>
          <div className="card-actions">
            <button
              className="button button--primary"
              type="button"
              onClick={() => onAddSelectedToQueue?.("finance")}
              disabled={!selectedCount}
            >
              Add selected to Finance Reel Queue
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => onAddSelectedToQueue?.("rent2buy")}
              disabled={!selectedCount}
            >
              Add selected to Rent2Buy Reel Queue
            </button>
          </div>
        </div>

        {vehiclesError ? <div className="error-banner">{vehiclesError}</div> : null}

        {vehiclesLoading && vehicles.length === 0 ? (
          <div className="empty-state">Loading live stock...</div>
        ) : vehicles.length === 0 ? (
          <div className="empty-state">No vehicles are ready for marketing yet.</div>
        ) : (
          <div className="card-grid">
            {vehicles.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                onGenerateReel={onGenerateReel}
                onViewCreatives={onViewCreatives}
                selectable
                selected={selectedVehicleIds.includes(String(vehicle.id || vehicle.reg || vehicle.registration || vehicle.name || ""))}
                onSelect={onToggleVehicle}
                reelActionLock={reelActionLocks[String(vehicle.id || vehicle.reg || vehicle.registration || vehicle.name || "")]}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
