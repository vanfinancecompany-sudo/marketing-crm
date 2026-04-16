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
}) {
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

        {vehiclesLoading ? (
          <div className="empty-state">Loading live stock...</div>
        ) : vehiclesError ? (
          <div className="empty-state">Unable to load stock: {vehiclesError}</div>
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
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
