import { useEffect } from "react";
import VehicleCard from "../components/VehicleCard.jsx";
import FilterBar from "../components/FilterBar.jsx";

const STOCK_AUTO_REFRESH_MS = 30 * 60 * 1000;

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
  onAddSelectedToReelLabQueue,
  reelActionLocks = {},
  ignoreReelLock = false,
  onIgnoreReelLockChange,
  generationMessage = "",
  creativeError = "",
}) {
  const selectedCount = selectedVehicleIds.length;

  function refreshStockPage() {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  function openYoutubeGenerator() {
    if (typeof window !== "undefined") {
      window.location.assign("/reel-lab");
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const interval = window.setInterval(() => {
      refreshStockPage();
    }, STOCK_AUTO_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Stock</h3>
            <p>Browse vehicles and jump straight into YouTube Generator or creative generation.</p>
          </div>
          <div className="card-actions">
            <button
              className="button button--primary"
              type="button"
              onClick={openYoutubeGenerator}
            >
              Open YouTube Generator
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={refreshStockPage}
              disabled={vehiclesLoading}
            >
              {vehiclesLoading ? "Refreshing..." : "Refresh Stock"}
            </button>
            <span className="status-pill">{vehicles.length} visible</span>
            <span className="status-pill">Auto-refresh 30 mins</span>
          </div>
        </div>

        <FilterBar filters={filters} onChange={onFiltersChange} />

        <div className="selection-summary stock-selection-summary">
          <strong>{selectedCount} selected for YouTube Generator queue</strong>
          <span>Pick vehicles, then send them to the Finance or Rent2Buy YouTube Generator queue.</span>
          <div className="card-actions">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={ignoreReelLock}
                onChange={(event) => onIgnoreReelLockChange?.(event.target.checked)}
              />
              <span>Ignore reel reuse timer</span>
            </label>
            <button
              className="button button--primary"
              type="button"
              onClick={() => onAddSelectedToReelLabQueue?.("finance")}
              disabled={!selectedCount}
            >
              Add selected to Finance YouTube Queue
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => onAddSelectedToReelLabQueue?.("rent2buy")}
              disabled={!selectedCount}
            >
              Add selected to Rent2Buy YouTube Queue
            </button>
          </div>
          {generationMessage ? <div className="notice">{generationMessage}</div> : null}
          {creativeError ? <div className="notice notice--error">{creativeError}</div> : null}
        </div>

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
                displayMode={filters.pipeline === "rent2buy" ? "rent2buy" : "finance"}
                onGenerateReel={onGenerateReel}
                onViewCreatives={onViewCreatives}
                selectable
                selected={selectedVehicleIds.includes(String(vehicle.id || vehicle.reg || vehicle.registration || vehicle.name || ""))}
                onSelect={onToggleVehicle}
                reelActionLock={reelActionLocks[String(vehicle.id || vehicle.reg || vehicle.registration || vehicle.name || "")]}
                ignoreReelLock={ignoreReelLock}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
