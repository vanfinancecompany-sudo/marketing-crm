import { useEffect, useState } from "react";
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
  onAddSelectedToYouTubeQueue,
  onOpenYouTubeGenerator,
  youtubeSelectionSummary = null,
  carsStockStatus = null,
  reelActionLocks = {},
  ignoreReelLock = false,
  onIgnoreReelLockChange,
  generationMessage = "",
  creativeError = "",
}) {
  const selectedCount = selectedVehicleIds.length;
  const [carslinkSyncing, setCarslinkSyncing] = useState(false);
  const [carslinkMessage, setCarslinkMessage] = useState("");
  const [carslinkError, setCarslinkError] = useState("");
  const carsConfigured = Boolean(carsStockStatus?.configured);
  const carsTableName = carsStockStatus?.tableName || "";
  const carsLoaded = Number(carsStockStatus?.loaded || 0);
  const carsRawRows = Number(carsStockStatus?.rawRows || 0);
  const carsLoadError = carsStockStatus?.error || "";
  const carsEmptyMessage = !carsConfigured
    ? "Cars stock source is not configured yet. Set VITE_CARS_STOCK_TABLE to the correct Supabase table once confirmed."
    : carsLoadError
      ? `Cars stock table could not be loaded: ${carsLoadError}`
      : carsRawRows === 0
        ? `No cars found in ${carsTableName} yet. Import cars into this table to populate the Cars tab.`
        : "No usable cars found yet. Import cars with a valid registration and image to populate the Cars tab.";

  function refreshStockPage() {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  async function runCarslinkProductionSync() {
    if (carslinkSyncing) return;
    setCarslinkSyncing(true);
    setCarslinkMessage("");
    setCarslinkError("");

    try {
      const response = await fetch("/api/carslink-production-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmProduction: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `Carslink production returned HTTP ${response.status}.`);
      }

      const syncId = payload?.carslink?.sync_id || payload?.sync_id || "accepted";
      const queued = payload?.carslink?.queued_count ?? payload?.queued_count ?? payload?.sent_count ?? 0;
      const localSkipped = Array.isArray(payload?.local_skipped) ? payload.local_skipped.length : 0;
      const sourceCount = Number(payload?.source_count || 0);
      setCarslinkMessage(`Carslink LIVE full sync accepted. Sync ID: ${syncId} | source: ${sourceCount} | queued: ${queued} | local skipped: ${localSkipped}`);
    } catch (error) {
      setCarslinkError(error?.message || "Carslink live sync failed.");
    } finally {
      setCarslinkSyncing(false);
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
            <p>Browse vehicles and jump straight into creative generation.</p>
          </div>
          <div className="card-actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={runCarslinkProductionSync}
              disabled={carslinkSyncing || filters.pipeline !== "vanFinance"}
              title={filters.pipeline !== "vanFinance" ? "Switch to Finance stock to sync Carslink." : "Send the complete current Finance stock feed to live Carslink using full replace."}
            >
              {carslinkSyncing ? "Syncing Carslink Live..." : "Carslink LIVE: Sync All"}
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

        {carslinkMessage ? <div className="notice">{carslinkMessage}</div> : null}
        {carslinkError ? <div className="notice notice--error">{carslinkError}</div> : null}

        <FilterBar filters={filters} onChange={onFiltersChange} />

        <div className="selection-summary stock-selection-summary">
          <strong>{selectedCount} selected for manual reel queue</strong>
          <span>Pick vehicles, then send them to Reel Lab Beta or YouTube Generator queues.</span>
          {filters.pipeline === "cars" ? (
            <span>
              Cars table config: {carsConfigured ? "configured" : "not configured"} | Cars table name: {carsTableName || "none"} | Cars loaded: {carsLoaded}
            </span>
          ) : null}
          {youtubeSelectionSummary && selectedCount ? (
            <span>
              Ready for YouTube: {youtubeSelectionSummary.ready} | Warning: {youtubeSelectionSummary.skipped} may need more images
            </span>
          ) : null}
          <div className="card-actions">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={ignoreReelLock}
                onChange={(event) => onIgnoreReelLockChange?.(event.target.checked)}
              />
              <span>Ignore reel lock / allow reuse</span>
            </label>
            <button
              className="button button--primary"
              type="button"
              onClick={() => onAddSelectedToReelLabQueue?.("finance")}
              disabled={!selectedCount}
            >
              Add selected to Finance Reel Lab Queue
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => onAddSelectedToReelLabQueue?.("rent2buy")}
              disabled={!selectedCount}
            >
              Add selected to Rent2Buy Reel Lab Queue
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => onAddSelectedToYouTubeQueue?.(filters.pipeline === "cars" ? "cars" : filters.pipeline === "rent2buy" ? "rent2buy" : "vanFinance")}
              disabled={!selectedCount}
            >
              Add to YouTube Queue
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={onOpenYouTubeGenerator}
            >
              Open YouTube Generator
            </button>
          </div>
          {generationMessage ? <div className="notice">{generationMessage}</div> : null}
          {creativeError ? <div className="notice notice--error">{creativeError}</div> : null}
        </div>

        {vehiclesLoading ? (
          <div className="empty-state">Loading live stock...</div>
        ) : vehiclesError ? (
          <div className="empty-state">Unable to load stock: {vehiclesError}</div>
        ) : vehicles.length === 0 && filters.pipeline === "cars" ? (
          <div className="empty-state">{carsEmptyMessage}</div>
        ) : vehicles.length === 0 ? (
          <div className="empty-state">No vehicles are ready for marketing yet.</div>
        ) : (
          <div className="card-grid">
            {vehicles.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                displayMode={filters.pipeline === "rent2buy" ? "rent2buy" : filters.pipeline === "cars" ? "cars" : "finance"}
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
